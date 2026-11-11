import { expect, test } from "bun:test";
import type { S3Client } from "@aws-sdk/client-s3";
import { YAML } from "bun";
import { createS3Store, type SignedUrlInput } from "./s3";
import { StorageError } from "./types";

interface RecordedCall {
  name: string;
  input: Record<string, unknown>;
}

type Handler = (name: string, input: Record<string, unknown>) => Promise<unknown>;

function fakeClient(handler: Handler = async () => ({})) {
  const calls: RecordedCall[] = [];
  const client = {
    async send(command: object): Promise<unknown> {
      const name = command.constructor.name;
      const input = (command as { input: Record<string, unknown> }).input;
      calls.push({ name, input });
      return await handler(name, input);
    },
  } as unknown as S3Client;
  return { client, calls };
}

const base = {
  bucket: "memtavi-media-dev-209479287671",
  region: "ap-south-1",
  domain: "d2dmc3wnvzsf1d.cloudfront.net",
};

const key = "sources/tenant/source/hash.txt";

test("storage template limits worker bucket listing to retention body prefixes", async () => {
  const template = YAML.parse(
    await Bun.file(new URL("../../../infra/storage.yaml", import.meta.url)).text(),
  ) as {
    Resources: {
      WorkerStoragePolicy: {
        Properties: { PolicyDocument: { Statement: Record<string, unknown>[] } };
      };
    };
  };
  const statements = template.Resources.WorkerStoragePolicy.Properties.PolicyDocument.Statement;
  expect(statements).toHaveLength(2);
  expect(statements[1]).toEqual({
    Effect: "Allow",
    Action: "s3:ListBucket",
    Resource: "MediaBucket.Arn",
    Condition: {
      StringLike: { "s3:prefix": ["sources/*", "chunks/*", "originals/*"] },
    },
  });
});

function failure(status: number, name: string): Error {
  return Object.assign(new Error(name), { name, $metadata: { httpStatusCode: status } });
}

async function readStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  return await new Response(stream).text();
}

test("put sends the bucket, key, content type and SSE-S3", async () => {
  const { client, calls } = fakeClient();
  const store = createS3Store({ ...base, client });

  await store.put(key, "hello", "text/plain; charset=utf-8");

  expect(calls).toHaveLength(1);
  expect(calls[0]?.name).toBe("PutObjectCommand");
  expect(calls[0]?.input).toMatchObject({
    Bucket: base.bucket,
    Key: key,
    Body: "hello",
    ContentType: "text/plain; charset=utf-8",
    ServerSideEncryption: "AES256",
  });
});

test("put converts an ArrayBuffer body to bytes", async () => {
  const { client, calls } = fakeClient();
  const store = createS3Store({ ...base, client });

  await store.put(key, new TextEncoder().encode("hello").buffer as ArrayBuffer, "text/plain");

  const body = calls[0]?.input.Body;
  expect(body).toBeInstanceOf(Uint8Array);
  expect(new TextDecoder().decode(body as Uint8Array)).toBe("hello");
});

test("get streams the response body", async () => {
  const { client } = fakeClient(async () => ({ Body: new Blob(["hello"]).stream() }));
  const store = createS3Store({ ...base, client });

  expect(await readStream(await store.get(key))).toBe("hello");
});

test("get accepts a body with transformToWebStream", async () => {
  const { client } = fakeClient(async () => ({
    Body: { transformToWebStream: () => new Blob(["hello"]).stream() },
  }));
  const store = createS3Store({ ...base, client });

  expect(await readStream(await store.get(key))).toBe("hello");
});

test("get maps a 404 to a permanent not_found", async () => {
  const { client } = fakeClient(async () => {
    throw failure(404, "NoSuchKey");
  });
  const store = createS3Store({ ...base, client });

  const error = await store.get(key).catch((cause: unknown) => cause);
  expect(error).toBeInstanceOf(StorageError);
  expect(error).toMatchObject({ code: "not_found", transient: false, status: 404 });
});

test("get maps a server error to a transient failure", async () => {
  const { client } = fakeClient(async () => {
    throw failure(503, "ServiceUnavailable");
  });
  const store = createS3Store({ ...base, client });

  const error = await store.get(key).catch((cause: unknown) => cause);
  expect(error).toBeInstanceOf(StorageError);
  expect(error).toMatchObject({ code: "unavailable", transient: true, status: 503 });
});

test("delete sends DeleteObject and tolerates a missing object", async () => {
  const { client, calls } = fakeClient(async () => {
    throw failure(404, "NoSuchKey");
  });
  const store = createS3Store({ ...base, client });

  await store.delete(key);
  await store.delete(key);

  expect(calls.map((call) => call.name)).toEqual(["DeleteObjectCommand", "DeleteObjectCommand"]);
});

test("exists reports true for a head hit and false for a 404", async () => {
  const hit = fakeClient(async () => ({ ContentLength: 5 }));
  expect(await createS3Store({ ...base, client: hit.client }).exists(key)).toBe(true);

  const miss = fakeClient(async () => {
    throw failure(404, "NotFound");
  });
  expect(await createS3Store({ ...base, client: miss.client }).exists(key)).toBe(false);
});

test("signedUrl gives the signer the CloudFront URL, key pair and expiry", async () => {
  const { client } = fakeClient();
  const signerCalls: SignedUrlInput[] = [];
  const store = createS3Store({
    ...base,
    client,
    keyPairId: "K31OG46DC5R5Y8",
    privateKey: "test-private-key",
    signer: (input) => {
      signerCalls.push(input);
      return "https://signed.example/object";
    },
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  });

  expect(await store.signedUrl(key, 600)).toBe("https://signed.example/object");
  expect(signerCalls[0]).toMatchObject({
    url: `https://${base.domain}/${key}`,
    keyPairId: "K31OG46DC5R5Y8",
    privateKey: "test-private-key",
  });
  expect(signerCalls[0]?.dateLessThan.toISOString()).toBe("2026-01-01T00:10:00.000Z");
});

test("signedUrl is null when no key pair is configured", async () => {
  const { client } = fakeClient();
  let signed = 0;
  const signer = (input: SignedUrlInput) => {
    signed += 1;
    return `${input.url}?signed`;
  };

  const withoutKeyPair = createS3Store({ ...base, client, signer });
  expect(await withoutKeyPair.signedUrl(key, 60)).toBeNull();

  const withoutPrivateKey = createS3Store({ ...base, client, keyPairId: "K31OG46DC5R5Y8", signer });
  expect(await withoutPrivateKey.signedUrl(key, 60)).toBeNull();
  expect(signed).toBe(0);
});

test("signedUrl rejects a non-positive ttl", async () => {
  const { client } = fakeClient();
  const store = createS3Store({
    ...base,
    client,
    keyPairId: "K31OG46DC5R5Y8",
    privateKey: "test-private-key",
    signer: () => "https://signed.example/object",
  });

  const error = await store.signedUrl(key, 0).catch((cause: unknown) => cause);
  expect(error).toBeInstanceOf(StorageError);
  expect(error).toMatchObject({ code: "invalid_ttl", transient: false });
});

test("rejects a traversing key before calling the client", async () => {
  const { client, calls } = fakeClient();
  const store = createS3Store({ ...base, client });

  const error = await store
    .put("../escape.txt", "no", "text/plain")
    .catch((cause: unknown) => cause);
  expect(error).toBeInstanceOf(StorageError);
  expect(error).toMatchObject({ code: "invalid_key", transient: false });
  expect(calls).toHaveLength(0);
});

test("lists every page within the exact source directory", async () => {
  const { client, calls } = fakeClient(async (_name, input) =>
    input.ContinuationToken
      ? {
          Contents: [
            { Key: "sources/tenant/source/b.txt" },
            { Key: "sources/foreign/source/c.txt" },
          ],
          IsTruncated: false,
        }
      : {
          Contents: [{ Key: "sources/tenant/source/nested/a.txt" }],
          IsTruncated: true,
          NextContinuationToken: "next-page",
        },
  );
  const store = createS3Store({ ...base, client });
  expect(await store.list?.("sources/tenant/source")).toEqual([
    "sources/tenant/source/b.txt",
    "sources/tenant/source/nested/a.txt",
  ]);
  expect(calls.map((call) => call.name)).toEqual(["ListObjectsV2Command", "ListObjectsV2Command"]);
  expect(calls[0]?.input).toEqual({ Bucket: base.bucket, Prefix: "sources/tenant/source/" });
  expect(calls[1]?.input.ContinuationToken).toBe("next-page");
});

test("refuses incomplete object listings instead of losing cleanup keys", async () => {
  const { client } = fakeClient(async () => ({ IsTruncated: true }));
  const store = createS3Store({ ...base, client });
  await expect(store.list?.("sources/tenant/source")).rejects.toMatchObject({
    code: "unavailable",
    transient: true,
  });
});

test("rejects a traversing listing prefix before sending a request", async () => {
  const { client, calls } = fakeClient();
  const store = createS3Store({ ...base, client });
  await expect(store.list?.("../escape")).rejects.toMatchObject({ code: "invalid_key" });
  expect(calls).toHaveLength(0);
});
