import { assertSafeKey, bodyBytes, sameBytes } from "./keys";
import { type ObjectBody, type ObjectStore, StorageError } from "./types";

export function createFakeStore(): ObjectStore {
  const objects = new Map<string, Uint8Array>();

  return {
    async list(prefix: string): Promise<string[]> {
      const directory = `${assertSafeKey(prefix)}/`;
      return [...objects.keys()].filter((key) => key.startsWith(directory)).sort();
    },

    async put(key: string, body: ObjectBody): Promise<void> {
      assertSafeKey(key);
      const bytes = bodyBytes(body);
      const existing = objects.get(key);
      if (existing !== undefined) {
        if (!sameBytes(existing, bytes)) {
          throw new StorageError("conflict", false, "Object key already exists");
        }
        return;
      }
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      objects.set(key, copy);
    },

    async get(key: string): Promise<ReadableStream<Uint8Array>> {
      assertSafeKey(key);
      const stored = objects.get(key);
      if (stored === undefined) {
        throw new StorageError("not_found", false, "Object not found");
      }
      const copy = new Uint8Array(stored.byteLength);
      copy.set(stored);
      return new Blob([copy]).stream();
    },

    async delete(key: string): Promise<void> {
      assertSafeKey(key);
      objects.delete(key);
    },

    async signedUrl(): Promise<string | null> {
      return null;
    },

    async exists(key: string): Promise<boolean> {
      assertSafeKey(key);
      return objects.has(key);
    },
  };
}
