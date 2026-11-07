import { lookup as dnsLookup } from "node:dns/promises";
import { isIP, type LookupFunction } from "node:net";
import { isPublicAddress } from "./address";
import { createFetchTransport, type FetchImpl } from "./transport";

export type { FetchImpl } from "./transport";

export type FetchFailureCode =
  | "invalid_url"
  | "blocked_address"
  | "too_many_redirects"
  | "too_large"
  | "timeout"
  | "network";

export class FetchError extends Error {
  constructor(
    readonly code: FetchFailureCode,
    readonly retryable: boolean,
    message: string,
  ) {
    super(message);
    this.name = "FetchError";
  }
}

export interface LookupAddress {
  address: string;
  family: number;
}

export type Lookup = (hostname: string) => Promise<LookupAddress[]>;

export interface FetchDocumentOptions {
  lookup?: Lookup;
  fetchImpl?: FetchImpl;
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
}

export interface FetchedDocument {
  status: number;
  finalUrl: string;
  contentType: string | null;
  text: string;
}

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const defaultTransport = createFetchTransport();

const defaultLookup: Lookup = async (hostname) => {
  const records = await dnsLookup(hostname, { all: true, verbatim: true });
  return records.map((record) => ({ address: record.address, family: record.family }));
};

function bareHost(hostname: string): string {
  if (hostname.startsWith("[") && hostname.endsWith("]")) return hostname.slice(1, -1);
  return hostname;
}

function parseTarget(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FetchError("invalid_url", false, "URL is not valid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new FetchError("invalid_url", false, "URL must use http or https");
  }
  if (!url.hostname) throw new FetchError("invalid_url", false, "URL has no host");
  return url;
}

async function resolvePublic(hostname: string, lookup: Lookup): Promise<LookupAddress> {
  const host = bareHost(hostname);
  if (isIP(host) !== 0) {
    if (!isPublicAddress(host)) {
      throw new FetchError("blocked_address", false, "URL target is not a public address");
    }
    return { address: host, family: isIP(host) };
  }

  let addresses: LookupAddress[];
  try {
    addresses = await lookup(host);
  } catch {
    throw new FetchError("network", true, "Host resolution failed");
  }
  const address = addresses[0];
  if (address === undefined) throw new FetchError("network", true, "Host resolution failed");
  if (!addresses.every((entry) => isPublicAddress(entry.address))) {
    throw new FetchError("blocked_address", false, "URL target is not a public address");
  }
  return { address: address.address, family: isIP(address.address) };
}

async function withinDeadline<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  let onAbort = () => {};
  const timeout = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new FetchError("timeout", true, "Fetch timed out"));
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

function translate(controller: AbortController, error: unknown): FetchError {
  if (error instanceof FetchError) return error;
  if (controller.signal.aborted) return new FetchError("timeout", true, "Fetch timed out");
  return new FetchError("network", true, "Fetch failed");
}

async function discard(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

async function readBody(
  response: Response,
  maxBytes: number,
  controller: AbortController,
): Promise<string> {
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (Number.isFinite(length) && length > maxBytes) {
      await discard(response);
      throw new FetchError("too_large", false, "Response body exceeds the size limit");
    }
  }
  if (response.body === null) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new FetchError("too_large", false, "Response body exceeds the size limit");
      }
      chunks.push(value);
    }
  } catch (error) {
    throw translate(controller, error);
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function fetchDocument(
  rawUrl: string,
  options: FetchDocumentOptions = {},
): Promise<FetchedDocument> {
  const lookup = options.lookup ?? defaultLookup;
  const fetchImpl = options.fetchImpl ?? defaultTransport;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;

  let current = parseTarget(rawUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      const address = await withinDeadline(
        resolvePublic(current.hostname, lookup),
        controller.signal,
      );
      const pinnedLookup: LookupFunction = (_hostname, lookupOptions, callback) => {
        if (lookupOptions.all) callback(null, [address]);
        else callback(null, address.address, address.family);
      };

      let response: Response;
      try {
        response = await withinDeadline(
          fetchImpl(current.toString(), {
            method: "GET",
            signal: controller.signal,
            lookup: pinnedLookup,
            family: address.family,
            autoSelectFamily: false,
            agent: false,
            ...(current.protocol === "https:" && isIP(bareHost(current.hostname)) === 0
              ? { servername: bareHost(current.hostname) }
              : {}),
            headers: {
              accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
              "accept-encoding": "gzip, deflate, br",
            },
          }),
          controller.signal,
        );
      } catch (error) {
        throw translate(controller, error);
      }

      const location = response.headers.get("location");
      if (REDIRECT_STATUSES.has(response.status) && location !== null) {
        if (hop === maxRedirects) {
          await discard(response);
          throw new FetchError("too_many_redirects", false, "Too many redirects");
        }
        await discard(response);
        let next: URL;
        try {
          next = new URL(location, current);
        } catch {
          throw new FetchError("invalid_url", false, "URL is not valid");
        }
        current = parseTarget(next.toString());
        continue;
      }

      const text = await withinDeadline(
        readBody(response, maxBytes, controller),
        controller.signal,
      );
      return {
        status: response.status,
        finalUrl: current.toString(),
        contentType: response.headers.get("content-type"),
        text,
      };
    }
  } finally {
    clearTimeout(timer);
  }

  throw new FetchError("too_many_redirects", false, "Too many redirects");
}
