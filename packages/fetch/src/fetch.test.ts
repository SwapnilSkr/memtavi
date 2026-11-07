import { expect, test } from "bun:test";
import {
  FetchError,
  type FetchImpl,
  fetchDocument,
  type Lookup,
  type LookupAddress,
} from "./fetch";

const publicAddresses: LookupAddress[] = [{ address: "93.184.216.34", family: 4 }];

function countingLookup(addresses: LookupAddress[] = publicAddresses) {
  const calls: string[] = [];
  const lookup: Lookup = async (hostname) => {
    calls.push(hostname);
    return addresses;
  };
  return { lookup, calls };
}

test("returns the final status, URL, content type and decoded text", async () => {
  const { lookup } = countingLookup();
  const result = await fetchDocument("https://example.com/article", {
    lookup,
    fetchImpl: async () =>
      new Response("hello world", {
        status: 201,
        headers: { "content-type": "text/plain; charset=utf-8" },
      }),
  });
  expect(result).toEqual({
    status: 201,
    finalUrl: "https://example.com/article",
    contentType: "text/plain; charset=utf-8",
    text: "hello world",
  });
});

test("returns null content type when the response has none", async () => {
  const { lookup } = countingLookup();
  const result = await fetchDocument("https://example.com/", {
    lookup,
    fetchImpl: async () => new Response("x"),
  });
  expect(result.contentType).toBeNull();
});

test.each(["file:///etc/passwd", "data:text/plain,hello", "ftp://example.com/a", "not a url"])(
  "rejects the non-http URL %s without fetching",
  async (url) => {
    let fetched = 0;
    await expect(
      fetchDocument(url, {
        lookup: async () => publicAddresses,
        fetchImpl: async () => {
          fetched += 1;
          return new Response("never");
        },
      }),
    ).rejects.toMatchObject({ code: "invalid_url", retryable: false });
    expect(fetched).toBe(0);
  },
);

test("rejects a host that resolves to a private address before fetching", async () => {
  let fetched = 0;
  await expect(
    fetchDocument("https://internal.example/", {
      lookup: async () => [{ address: "10.0.0.5", family: 4 }],
      fetchImpl: async () => {
        fetched += 1;
        return new Response("never");
      },
    }),
  ).rejects.toMatchObject({ code: "blocked_address", retryable: false });
  expect(fetched).toBe(0);
});

test("rejects when any resolved address is private", async () => {
  await expect(
    fetchDocument("https://mixed.example/", {
      lookup: async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ],
      fetchImpl: async () => new Response("never"),
    }),
  ).rejects.toMatchObject({ code: "blocked_address", retryable: false });
});

test.each(["http://127.0.0.1/", "http://169.254.169.254/latest", "http://[::1]/"])(
  "rejects the private IP literal %s without resolving it",
  async (url) => {
    const { lookup, calls } = countingLookup();
    await expect(
      fetchDocument(url, { lookup, fetchImpl: async () => new Response("never") }),
    ).rejects.toMatchObject({ code: "blocked_address", retryable: false });
    expect(calls).toEqual([]);
  },
);

test("allows a public IP literal without resolving it", async () => {
  const { lookup, calls } = countingLookup();
  const result = await fetchDocument("http://8.8.8.8/", {
    lookup,
    fetchImpl: async () => new Response("ok"),
  });
  expect(result.text).toBe("ok");
  expect(calls).toEqual([]);
});

test("rejects a redirect into a private address", async () => {
  const { lookup } = countingLookup();
  let fetched = 0;
  await expect(
    fetchDocument("https://public.example/start", {
      lookup,
      fetchImpl: async () => {
        fetched += 1;
        return new Response(null, {
          status: 302,
          headers: { location: "http://127.0.0.1/secret" },
        });
      },
    }),
  ).rejects.toMatchObject({ code: "blocked_address", retryable: false });
  expect(fetched).toBe(1);
});

test.each(["file:///etc/passwd", "data:text/plain,hello"])(
  "rejects a redirect to %s",
  async (location) => {
    await expect(
      fetchDocument("https://public.example/start", {
        lookup: async () => publicAddresses,
        fetchImpl: async () => new Response(null, { status: 302, headers: { location } }),
      }),
    ).rejects.toMatchObject({ code: "invalid_url", retryable: false });
  },
);

test("rejects a malformed redirect location", async () => {
  await expect(
    fetchDocument("https://public.example/start", {
      lookup: async () => publicAddresses,
      fetchImpl: async () =>
        new Response(null, { status: 302, headers: { location: "http://[::1" } }),
    }),
  ).rejects.toMatchObject({ code: "invalid_url", retryable: false });
});

test("resolves a relative redirect against the current URL", async () => {
  const { lookup } = countingLookup();
  const fetchImpl: FetchImpl = async (url) => {
    if (url.endsWith("/start")) {
      return new Response(null, { status: 307, headers: { location: "../final" } });
    }
    return new Response("done");
  };
  const result = await fetchDocument("https://example.com/a/start", { lookup, fetchImpl });
  expect(result.finalUrl).toBe("https://example.com/final");
  expect(result.text).toBe("done");
});

test("follows at most five redirects", async () => {
  const { lookup } = countingLookup();
  const fetchImpl: FetchImpl = async (url) => {
    const hop = Number(new URL(url).pathname.slice(1));
    if (hop < 5) {
      return new Response(null, { status: 302, headers: { location: `/${hop + 1}` } });
    }
    return new Response("done");
  };
  const result = await fetchDocument("https://example.com/0", { lookup, fetchImpl });
  expect(result.finalUrl).toBe("https://example.com/5");
  expect(result.text).toBe("done");
});

test("rejects a sixth redirect", async () => {
  const fetchImpl: FetchImpl = async (url) => {
    const hop = Number(new URL(url).pathname.slice(1));
    return new Response(null, { status: 302, headers: { location: `/${hop + 1}` } });
  };
  await expect(
    fetchDocument("https://example.com/0", {
      lookup: async () => publicAddresses,
      fetchImpl,
    }),
  ).rejects.toMatchObject({ code: "too_many_redirects", retryable: false });
});

test("rejects a body whose declared length exceeds 10 MB", async () => {
  const body = new Uint8Array(10 * 1024 * 1024 + 1);
  await expect(
    fetchDocument("https://example.com/big", {
      lookup: async () => publicAddresses,
      fetchImpl: async () => new Response(body),
    }),
  ).rejects.toMatchObject({ code: "too_large", retryable: false });
});

test("rejects a streamed body that grows past the cap", async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(6));
      controller.enqueue(new Uint8Array(6));
      controller.close();
    },
  });
  await expect(
    fetchDocument("https://example.com/stream", {
      lookup: async () => publicAddresses,
      fetchImpl: async () => new Response(stream),
      maxBytes: 8,
    }),
  ).rejects.toMatchObject({ code: "too_large", retryable: false });
});

test("accepts a body exactly at the cap", async () => {
  const result = await fetchDocument("https://example.com/exact", {
    lookup: async () => publicAddresses,
    fetchImpl: async () => new Response("12345"),
    maxBytes: 5,
  });
  expect(result.text).toBe("12345");
});

test("fails transiently when the wall clock expires", async () => {
  const hanging: FetchImpl = (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    });
  await expect(
    fetchDocument("https://example.com/slow", {
      lookup: async () => publicAddresses,
      fetchImpl: hanging,
      timeoutMs: 5,
    }),
  ).rejects.toMatchObject({ code: "timeout", retryable: true });
});

test("classifies a transport failure as transient", async () => {
  await expect(
    fetchDocument("https://example.com/", {
      lookup: async () => publicAddresses,
      fetchImpl: async () => {
        throw new TypeError("socket closed");
      },
    }),
  ).rejects.toMatchObject({ code: "network", retryable: true });
});

test("classifies a resolution failure as transient", async () => {
  await expect(
    fetchDocument("https://missing.example/", {
      lookup: async () => {
        throw new Error("ENOTFOUND");
      },
      fetchImpl: async () => new Response("never"),
    }),
  ).rejects.toMatchObject({ code: "network", retryable: true });
});

test("returns an upstream error status as a result rather than a fetch failure", async () => {
  const result = await fetchDocument("https://example.com/missing", {
    lookup: async () => publicAddresses,
    fetchImpl: async () => new Response("gone", { status: 404 }),
  });
  expect(result.status).toBe(404);
  expect(result.text).toBe("gone");
});

test("FetchError is identifiable by code", async () => {
  const error = await fetchDocument("file:///etc/passwd").catch((cause: unknown) => cause);
  expect(error).toBeInstanceOf(FetchError);
  expect((error as FetchError).code).toBe("invalid_url");
});
