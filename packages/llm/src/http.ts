import { ProviderError } from "./provider";

export type FetchImpl = (input: string, init: RequestInit) => Promise<Response>;

export const DEFAULT_TIMEOUT_MS = 30_000;

export interface PostJsonOptions {
  apiKey: string;
  body: unknown;
  fetchImpl: FetchImpl;
  timeoutMs: number;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isTokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function malformedResponse(): ProviderError {
  return new ProviderError("malformed_response", false, "Provider returned a malformed response");
}

export function classifyStatus(status: number): ProviderError {
  if (status === 429) {
    return new ProviderError("rate_limited", true, "Provider rate limited the request", status);
  }
  if (status >= 500) {
    return new ProviderError("server_error", true, "Provider is unavailable", status);
  }
  return new ProviderError("bad_request", false, "Provider rejected the request", status);
}

export async function postJson(url: string, options: PostJsonOptions): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const response = await options.fetchImpl(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${options.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(options.body),
    });
    const text = await response.text();
    if (!response.ok) throw classifyStatus(response.status);
    try {
      return JSON.parse(text);
    } catch {
      throw malformedResponse();
    }
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (controller.signal.aborted) {
      throw new ProviderError("timeout", true, "Provider request timed out");
    }
    throw new ProviderError("network", true, "Provider request failed");
  } finally {
    clearTimeout(timer);
  }
}

export function trimmedBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}
