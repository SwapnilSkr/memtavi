import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalStore } from "./local";
import { type ObjectStore, StorageError } from "./types";

let root = "";
let store: ObjectStore;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "memtavi-storage-"));
  store = createLocalStore(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function readStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  return await new Response(stream).text();
}

test("round-trips put, get, exists and delete", async () => {
  const key = "sources/tenant/source/hash.txt";
  await store.put(key, "hello", "text/plain");

  expect(await store.exists(key)).toBe(true);
  expect(await readStream(await store.get(key))).toBe("hello");
  expect((await stat(join(root, key))).isFile()).toBe(true);

  await store.delete(key);
  expect(await store.exists(key)).toBe(false);
});

test("delete is idempotent for a missing key", async () => {
  await store.delete("sources/tenant/source/missing.txt");
  expect(await store.exists("sources/tenant/source/missing.txt")).toBe(false);
});

test("get reports a permanent not_found for a missing key", async () => {
  const error = await store
    .get("sources/tenant/source/missing.txt")
    .catch((cause: unknown) => cause);
  expect(error).toBeInstanceOf(StorageError);
  expect(error).toMatchObject({ code: "not_found", transient: false, status: 404 });
});

test("reads an ArrayBuffer body back as bytes", async () => {
  const key = "chunks/tenant/source/hash/0.txt";
  const bytes = new TextEncoder().encode("chunk text");
  await store.put(key, bytes.buffer as ArrayBuffer, "text/plain");
  expect(await readStream(await store.get(key))).toBe("chunk text");
});

test("treats an identical rewrite as a no-op", async () => {
  const key = "sources/tenant/source/hash.txt";
  await store.put(key, "hello", "text/plain");
  await store.put(key, "hello", "text/plain");
  expect(await readStream(await store.get(key))).toBe("hello");
});

test("refuses to replace an existing key with a different body", async () => {
  const key = "sources/tenant/source/hash.txt";
  await store.put(key, "hello", "text/plain");
  const error = await store.put(key, "replaced", "text/plain").catch((cause: unknown) => cause);
  expect(error).toBeInstanceOf(StorageError);
  expect(error).toMatchObject({ code: "conflict", transient: false, status: 409 });
  expect(await readStream(await store.get(key))).toBe("hello");
});

test("rejects a key that escapes the root without writing", async () => {
  const nested = createLocalStore(join(root, "root"));
  const escapeTarget = join(root, "escape.txt");
  const error = await nested
    .put("../escape.txt", "escape", "text/plain")
    .catch((cause: unknown) => cause);
  expect(error).toBeInstanceOf(StorageError);
  expect(error).toMatchObject({ code: "invalid_key", transient: false });
  expect(await readFile(escapeTarget).catch(() => null)).toBeNull();
});

test("rejects an absolute key", async () => {
  const error = await store.put("/etc/passwd", "no", "text/plain").catch((cause: unknown) => cause);
  expect(error).toBeInstanceOf(StorageError);
  expect(error).toMatchObject({ code: "invalid_key", transient: false });
});

test("returns null from signedUrl", async () => {
  expect(await store.signedUrl("sources/tenant/source/hash.txt", 600)).toBeNull();
});
