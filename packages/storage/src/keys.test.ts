import { expect, test } from "bun:test";
import {
  assertSafeKey,
  bodyBytes,
  chunkKey,
  contentHash,
  exportKey,
  originalKey,
  sourceKey,
} from "./keys";
import { StorageError } from "./types";

const tenantId = "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const sourceId = "src_0123456789abcdef0123456789abcdef";
const brainId = "brn_fedcba9876543210fedcba9876543210";
const jobId = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const helloHash = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";

function capture(run: () => unknown): unknown {
  try {
    run();
    return null;
  } catch (error) {
    return error;
  }
}

function expectInvalidKey(run: () => unknown): void {
  const error = capture(run);
  expect(error).toBeInstanceOf(StorageError);
  expect(error).toMatchObject({ code: "invalid_key", transient: false, status: 400 });
}

test("builds the source key from the tenant, source and body hash", () => {
  expect(sourceKey({ tenantId, sourceId, body: "hello" })).toBe(
    `sources/${tenantId}/${sourceId}/${helloHash}.txt`,
  );
});

test("builds the chunk key under the source hash and ordinal", () => {
  expect(chunkKey({ tenantId, sourceId, body: "hello", ordinal: 12 })).toBe(
    `chunks/${tenantId}/${sourceId}/${helloHash}/12.txt`,
  );
});

test("builds the original key with a lowercased extension", () => {
  expect(originalKey({ tenantId, sourceId, body: "hello", extension: "PDF" })).toBe(
    `originals/${tenantId}/${sourceId}/${helloHash}.pdf`,
  );
});

test("builds the export key from the tenant, brain and job", () => {
  expect(exportKey({ tenantId, brainId, jobId })).toBe(
    `exports/${tenantId}/${brainId}/${jobId}.zip`,
  );
});

test("hashes string, bytes and buffer bodies identically", () => {
  const text = "same body";
  expect(contentHash(new TextEncoder().encode(text))).toBe(contentHash(text));
  expect(contentHash(bodyBytes(text).buffer as ArrayBuffer)).toBe(contentHash(text));
});

test("a changed body produces a different key", () => {
  expect(sourceKey({ tenantId, sourceId, body: "one" })).not.toBe(
    sourceKey({ tenantId, sourceId, body: "two" }),
  );
});

const invalidSourceCalls: Array<[string, () => string]> = [
  ["tenant traversal", () => sourceKey({ tenantId: "../../etc/passwd", sourceId, body: "hello" })],
  [
    "tenant with a slash",
    () => sourceKey({ tenantId: `${tenantId}/../../x`, sourceId, body: "hello" }),
  ],
  ["empty tenant", () => sourceKey({ tenantId: "", sourceId, body: "hello" })],
  ["source traversal", () => sourceKey({ tenantId, sourceId: "src_../escape", body: "hello" })],
  [
    "source with a slash",
    () => sourceKey({ tenantId, sourceId: `${sourceId}/../x`, body: "hello" }),
  ],
  ["source of the wrong domain", () => sourceKey({ tenantId, sourceId: brainId, body: "hello" })],
  ["source without a hash", () => sourceKey({ tenantId, sourceId: "src_", body: "hello" })],
  [
    "source with a non-hex hash",
    () => sourceKey({ tenantId, sourceId: `src_${"z".repeat(32)}`, body: "hello" }),
  ],
];

test.each(invalidSourceCalls)("rejects a source key with %s", (_label, build) => {
  expectInvalidKey(build);
});

const invalidOrdinals: Array<[string, number]> = [
  ["negative", -1],
  ["fractional", 1.5],
  ["NaN", Number.NaN],
  ["infinite", Number.POSITIVE_INFINITY],
];

test.each(invalidOrdinals)("rejects a %s chunk ordinal", (_label, ordinal) => {
  expectInvalidKey(() => chunkKey({ tenantId, sourceId, body: "hello", ordinal }));
});

const invalidExtensions = ["", "../pem", "p/df", "p df", "a".repeat(17), ".pem"];

test.each(invalidExtensions)("rejects the original extension %p", (extension) => {
  expectInvalidKey(() => originalKey({ tenantId, sourceId, body: "hello", extension }));
});

const invalidExportCalls: Array<[string, () => string]> = [
  ["a non-uuid tenant", () => exportKey({ tenantId: "tenant", brainId, jobId })],
  ["a traversing brain", () => exportKey({ tenantId, brainId: "brn_..", jobId })],
  ["a source id as the brain", () => exportKey({ tenantId, brainId: sourceId, jobId })],
  ["a non-uuid job", () => exportKey({ tenantId, brainId, jobId: "../job" })],
];

test.each(invalidExportCalls)("rejects an export key with %s", (_label, build) => {
  expectInvalidKey(build);
});

const unsafeKeys = ["", ".", "..", "../escape.txt", "/etc/passwd", "a//b", "a/./b", "a\\b"];
const safeKeys = ["sources/a/b.txt", "exports/a/b/c.zip", "a-b_c.d"];

test.each(unsafeKeys)("rejects the unsafe object key %p", (key) => {
  expectInvalidKey(() => assertSafeKey(key));
});

test.each(safeKeys)("accepts the object key %p", (key) => {
  expect(assertSafeKey(key)).toBe(key);
});
