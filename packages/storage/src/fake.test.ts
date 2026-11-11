import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakeStore } from "./fake";
import { createLocalStore } from "./local";
import { type ObjectStore, StorageError } from "./types";

async function readStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  return await new Response(stream).text();
}

async function observe(store: ObjectStore) {
  const key = "sources/tenant/source/hash.txt";
  const missing = await store
    .get("sources/tenant/source/missing.txt")
    .catch((cause: unknown) => cause);
  await store.put(key, "hello", "text/plain");
  const body = await readStream(await store.get(key));
  const exists = await store.exists(key);
  const signed = await store.signedUrl(key, 60);
  await store.delete(key);
  const afterDelete = await store.exists(key);
  await store.delete(key);
  return {
    missing:
      missing instanceof StorageError
        ? { code: missing.code, transient: missing.transient }
        : missing,
    body,
    exists,
    signed,
    afterDelete,
  };
}

test("round-trips put, get, exists and delete", async () => {
  const store = createFakeStore();
  const key = "chunks/tenant/source/hash/0.txt";
  await store.put(key, "chunk", "text/plain");
  expect(await store.exists(key)).toBe(true);
  expect(await readStream(await store.get(key))).toBe("chunk");
  await store.delete(key);
  expect(await store.exists(key)).toBe(false);
});

test("get reports a permanent not_found for a missing key", async () => {
  const error = await createFakeStore()
    .get("sources/tenant/source/missing.txt")
    .catch((cause: unknown) => cause);
  expect(error).toBeInstanceOf(StorageError);
  expect(error).toMatchObject({ code: "not_found", transient: false, status: 404 });
});

test("delete is idempotent for a missing key", async () => {
  const store = createFakeStore();
  await store.delete("sources/tenant/source/missing.txt");
  expect(await store.exists("sources/tenant/source/missing.txt")).toBe(false);
});

test("treats an identical rewrite as a no-op", async () => {
  const store = createFakeStore();
  const key = "sources/tenant/source/hash.txt";
  await store.put(key, "hello", "text/plain");
  await store.put(key, "hello", "text/plain");
  expect(await readStream(await store.get(key))).toBe("hello");
});

test("refuses to replace an existing key with a different body", async () => {
  const store = createFakeStore();
  const key = "sources/tenant/source/hash.txt";
  await store.put(key, "hello", "text/plain");
  const error = await store.put(key, "replaced", "text/plain").catch((cause: unknown) => cause);
  expect(error).toBeInstanceOf(StorageError);
  expect(error).toMatchObject({ code: "conflict", transient: false, status: 409 });
  expect(await readStream(await store.get(key))).toBe("hello");
});

test("rejects a key that escapes the root", async () => {
  const store = createFakeStore();
  const error = await store
    .put("../escape.txt", "escape", "text/plain")
    .catch((cause: unknown) => cause);
  expect(error).toBeInstanceOf(StorageError);
  expect(error).toMatchObject({ code: "invalid_key", transient: false });
});

test("returns null from signedUrl", async () => {
  expect(await createFakeStore().signedUrl("sources/tenant/source/hash.txt", 60)).toBeNull();
});

test("behaves the same as the local driver", async () => {
  const root = await mkdtemp(join(tmpdir(), "memtavi-storage-"));
  try {
    const local = createLocalStore(root);
    const fake = createFakeStore();
    expect(await observe(fake)).toEqual(await observe(local));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("lists all nested objects only within a source directory in fake and local stores", async () => {
  const root = await mkdtemp(join(tmpdir(), "memtavi-storage-list-"));
  try {
    for (const store of [createFakeStore(), createLocalStore(root)]) {
      for (const key of [
        "sources/tenant/source/b.txt",
        "sources/tenant/source/nested/a.txt",
        "sources/tenant/source-other/c.txt",
        "sources/foreign/source/d.txt",
      ]) {
        await store.put(key, "body", "text/plain");
      }
      expect(await store.list?.("sources/tenant/source")).toEqual([
        "sources/tenant/source/b.txt",
        "sources/tenant/source/nested/a.txt",
      ]);
      expect(await store.list?.("sources/tenant/missing")).toEqual([]);
      await expect(store.list?.("../escape")).rejects.toMatchObject({ code: "invalid_key" });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
