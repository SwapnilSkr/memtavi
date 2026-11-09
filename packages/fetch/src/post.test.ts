import { expect, test } from "bun:test";
import { type FetchImpl, type Lookup, type LookupAddress, postJson } from "./fetch";

const publicAddresses: LookupAddress[] = [{ address: "93.184.216.34", family: 4 }];

function countingLookup(addresses: LookupAddress[] = publicAddresses) {
  const calls: string[] = [];
  const lookup: Lookup = async (hostname) => {
    calls.push(hostname);
    return addresses;
  };
  return { lookup, calls };
}

test("sends a POST with the exact body, content type and caller headers", async () => {
  const { lookup, calls } = countingLookup();
  const requests: Array<{ input: string; init: Parameters<FetchImpl>[1] }> = [];
  const fetchImpl: FetchImpl = async (input, init) => {
    requests.push({ input, init });
    return new Response("accepted", {
      status: 202,
      headers: { "content-type": "text/plain" },
    });
  };
  const body = JSON.stringify({ deliveryId: "d-1", type: "created" });

  const result = await postJson(
    "https://hooks.example.com/memtavi",
    body,
    { "x-memtavi-event": "created", "x-memtavi-signature": "sha256=abc" },
    { lookup, fetchImpl },
  );

  expect(result).toEqual({
    status: 202,
    finalUrl: "https://hooks.example.com/memtavi",
    contentType: "text/plain",
    text: "accepted",
  });
  expect(calls).toEqual(["hooks.example.com"]);
  expect(requests).toHaveLength(1);
  expect(requests[0]?.input).toBe("https://hooks.example.com/memtavi");
  expect(requests[0]?.init.method).toBe("POST");
  expect(requests[0]?.init.body).toBe(body);
  expect(requests[0]?.init.headers).toEqual({
    "content-type": "application/json",
    "x-memtavi-event": "created",
    "x-memtavi-signature": "sha256=abc",
  });
  expect(requests[0]?.init.agent).toBe(false);
  expect(requests[0]?.init.autoSelectFamily).toBe(false);
});

test("rejects a host that resolves to a private address before sending", async () => {
  const { lookup } = countingLookup([{ address: "10.0.0.5", family: 4 }]);
  let sent = 0;
  await expect(
    postJson(
      "https://internal.example/hook",
      "{}",
      {},
      {
        lookup,
        fetchImpl: async () => {
          sent += 1;
          return new Response("never");
        },
      },
    ),
  ).rejects.toMatchObject({ code: "blocked_address", retryable: false });
  expect(sent).toBe(0);
});

test("rejects a private IP literal without resolving it", async () => {
  const { lookup, calls } = countingLookup();
  let sent = 0;
  await expect(
    postJson(
      "http://169.254.169.254/latest",
      "{}",
      {},
      {
        lookup,
        fetchImpl: async () => {
          sent += 1;
          return new Response("never");
        },
      },
    ),
  ).rejects.toMatchObject({ code: "blocked_address", retryable: false });
  expect(calls).toEqual([]);
  expect(sent).toBe(0);
});

test("returns a redirect status without following it", async () => {
  const { lookup } = countingLookup();
  let sent = 0;
  const result = await postJson(
    "https://hooks.example.com/start",
    "{}",
    {},
    {
      lookup,
      fetchImpl: async () => {
        sent += 1;
        return new Response(null, {
          status: 302,
          headers: { location: "https://elsewhere.example/destination" },
        });
      },
    },
  );
  expect(result.status).toBe(302);
  expect(result.finalUrl).toBe("https://hooks.example.com/start");
  expect(sent).toBe(1);
});

test("fails transiently when the wall clock expires", async () => {
  const hanging: FetchImpl = (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    });
  await expect(
    postJson(
      "https://hooks.example.com/slow",
      "{}",
      {},
      {
        lookup: async () => publicAddresses,
        fetchImpl: hanging,
        timeoutMs: 5,
      },
    ),
  ).rejects.toMatchObject({ code: "timeout", retryable: true });
});

test("classifies a transport failure as transient", async () => {
  await expect(
    postJson(
      "https://hooks.example.com/flaky",
      "{}",
      {},
      {
        lookup: async () => publicAddresses,
        fetchImpl: async () => {
          throw new TypeError("socket closed");
        },
      },
    ),
  ).rejects.toMatchObject({ code: "network", retryable: true });
});

test("caps the response body at 64 KB by default", async () => {
  await expect(
    postJson(
      "https://hooks.example.com/large",
      "{}",
      {},
      {
        lookup: async () => publicAddresses,
        fetchImpl: async () => new Response(new Uint8Array(64 * 1024 + 1)),
      },
    ),
  ).rejects.toMatchObject({ code: "too_large", retryable: false });
});

test("rejects a non-http URL without sending", async () => {
  let sent = 0;
  await expect(
    postJson(
      "file:///etc/passwd",
      "{}",
      {},
      {
        lookup: async () => publicAddresses,
        fetchImpl: async () => {
          sent += 1;
          return new Response("never");
        },
      },
    ),
  ).rejects.toMatchObject({ code: "invalid_url", retryable: false });
  expect(sent).toBe(0);
});
