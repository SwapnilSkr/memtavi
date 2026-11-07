import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { brotliCompressSync, deflateSync, gzipSync } from "node:zlib";
import { fetchDocument, type Lookup } from "./fetch";
import { createFetchTransport, type FetchImpl } from "./transport";

function recordingTransport(
  body = Buffer.from("ok"),
  rawHeaders: string[] = [],
  statusCode = 200,
  all = false,
) {
  const connected: string[] = [];
  const requests: { input: string; init: Parameters<FetchImpl>[1] }[] = [];
  const fetchImpl = createFetchTransport((input, init, onResponse) => {
    requests.push({ input, init });
    const outgoing = Object.assign(new EventEmitter(), {
      end() {
        init.lookup(new URL(input).hostname, { all }, (error, addresses) => {
          if (error) {
            outgoing.emit("error", error);
            return;
          }
          const address = typeof addresses === "string" ? addresses : addresses[0]?.address;
          if (address === undefined) throw new Error("No connection address");
          connected.push(address);
          const incoming = Object.assign(Readable.from([body], { objectMode: false }), {
            statusCode,
            rawHeaders,
          });
          onResponse?.(incoming as IncomingMessage);
        });
        return outgoing;
      },
    });
    return outgoing as ClientRequest;
  });
  return { fetchImpl, connected, requests };
}

test.each(["http", "https"])(
  "pins the %s connection to the validated address when DNS rebinds",
  async (protocol) => {
    let resolutions = 0;
    const lookup: Lookup = async () => {
      resolutions += 1;
      return [{ address: resolutions === 1 ? "93.184.216.34" : "127.0.0.1", family: 4 }];
    };
    const { fetchImpl, connected, requests } = recordingTransport();
    const url = `${protocol}://rebind.example/article`;
    const result = await fetchDocument(url, { lookup, fetchImpl });

    expect(result.text).toBe("ok");
    expect(connected).toEqual(["93.184.216.34"]);
    expect(resolutions).toBe(1);
    expect(requests[0]?.input).toBe(url);
    expect(requests[0]?.init.servername).toBe(protocol === "https" ? "rebind.example" : undefined);
    expect(requests[0]?.init.agent).toBe(false);
  },
);

test("rejects a mixed public and private answer set before connecting", async () => {
  const { fetchImpl, connected, requests } = recordingTransport();
  await expect(
    fetchDocument("https://mixed.example/", {
      lookup: async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ],
      fetchImpl,
    }),
  ).rejects.toMatchObject({ code: "blocked_address", retryable: false });
  expect(connected).toEqual([]);
  expect(requests).toHaveLength(0);
});

test("revalidates a rebinding hostname before connecting to a redirect", async () => {
  let resolutions = 0;
  const { fetchImpl, connected } = recordingTransport(Buffer.alloc(0), ["Location", "/next"], 302);
  await expect(
    fetchDocument("https://rebind.example/start", {
      lookup: async () => {
        resolutions += 1;
        return [{ address: resolutions === 1 ? "93.184.216.34" : "127.0.0.1", family: 4 }];
      },
      fetchImpl,
    }),
  ).rejects.toMatchObject({ code: "blocked_address", retryable: false });
  expect(connected).toEqual(["93.184.216.34"]);
  expect(resolutions).toBe(2);
});

test("supplies only a validated IPv6 address when the connection requests all addresses", async () => {
  const { fetchImpl, connected, requests } = recordingTransport(Buffer.from("ok"), [], 200, true);
  await fetchDocument("https://ipv6.example/", {
    lookup: async () => [{ address: "2606:4700:4700::1111", family: 6 }],
    fetchImpl,
  });
  expect(connected).toEqual(["2606:4700:4700::1111"]);
  expect(requests[0]?.init.family).toBe(6);
});

test.each([
  ["gzip", gzipSync],
  ["deflate", deflateSync],
  ["br", brotliCompressSync],
] as const)("decodes %s bodies before applying the size cap", async (encoding, compress) => {
  const { fetchImpl } = recordingTransport(compress(Buffer.alloc(1024)), [
    "Content-Encoding",
    encoding,
  ]);
  await expect(
    fetchDocument("https://compressed.example/", {
      lookup: async () => [{ address: "93.184.216.34", family: 4 }],
      fetchImpl,
      maxBytes: 100,
    }),
  ).rejects.toMatchObject({ code: "too_large", retryable: false });
});

test("returns decompressed text with the upstream status and headers", async () => {
  const { fetchImpl } = recordingTransport(
    gzipSync(Buffer.from("hello world")),
    ["Content-Encoding", "gzip", "Content-Type", "text/plain"],
    201,
  );
  const result = await fetchDocument("https://compressed.example/", {
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    fetchImpl,
  });
  expect(result.text).toBe("hello world");
  expect(result.status).toBe(201);
  expect(result.contentType).toBe("text/plain");
});

test("classifies a corrupt compressed response as a transient network failure", async () => {
  const { fetchImpl } = recordingTransport(Buffer.from("invalid gzip"), [
    "Content-Encoding",
    "gzip",
  ]);
  await expect(
    fetchDocument("https://compressed.example/", {
      lookup: async () => [{ address: "93.184.216.34", family: 4 }],
      fetchImpl,
    }),
  ).rejects.toMatchObject({ code: "network", retryable: true });
});

test.each([204, 205, 304])("accepts a bodyless %d response", async (statusCode) => {
  const { fetchImpl } = recordingTransport(Buffer.alloc(0), [], statusCode);
  const result = await fetchDocument("https://empty.example/", {
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    fetchImpl,
  });
  expect(result.status).toBe(statusCode);
  expect(result.text).toBe("");
});
