import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { assertSafeKey, bodyBytes, sameBytes } from "./keys";
import { type ObjectBody, type ObjectStore, StorageError } from "./types";

function fsCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function toStorageError(error: unknown): StorageError {
  if (error instanceof StorageError) return error;
  const code = fsCode(error);
  if (code === "ENOENT") return new StorageError("not_found", false, "Object not found");
  if (code === "EACCES" || code === "EPERM") {
    return new StorageError("access_denied", false, "Object store rejected the request");
  }
  return new StorageError("unavailable", true, "Object store request failed");
}

function resolveKey(root: string, key: string): string {
  const safe = assertSafeKey(key);
  const target = resolve(root, safe);
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new StorageError("invalid_key", false, "Invalid storage key");
  }
  return target;
}

export function createLocalStore(rootDir = ".storage"): ObjectStore {
  const root = resolve(rootDir);

  return {
    async list(prefix: string): Promise<string[]> {
      const keys: string[] = [];
      async function visit(directory: string): Promise<void> {
        const entries = await readdir(resolveKey(root, directory), { withFileTypes: true });
        for (const entry of entries) {
          const key = `${directory}/${entry.name}`;
          if (entry.isDirectory()) await visit(key);
          else if (entry.isFile()) keys.push(key);
        }
      }
      try {
        await visit(prefix);
        return keys.sort();
      } catch (error) {
        const mapped = toStorageError(error);
        if (mapped.code === "not_found") return [];
        throw mapped;
      }
    },

    async put(key: string, body: ObjectBody): Promise<void> {
      const target = resolveKey(root, key);
      const bytes = bodyBytes(body);
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      try {
        await writeFile(target, bytes, { flag: "wx" });
      } catch (error) {
        if (fsCode(error) !== "EEXIST") throw toStorageError(error);
        const existing = await readFile(target).catch((cause: unknown) => {
          throw toStorageError(cause);
        });
        if (sameBytes(existing, bytes)) return;
        throw new StorageError("conflict", false, "Object key already exists");
      }
    },

    async get(key: string): Promise<ReadableStream<Uint8Array>> {
      const target = resolveKey(root, key);
      try {
        const stored = await readFile(target);
        const bytes = new Uint8Array(stored.byteLength);
        bytes.set(stored);
        return new Blob([bytes]).stream();
      } catch (error) {
        throw toStorageError(error);
      }
    },

    async delete(key: string): Promise<void> {
      const target = resolveKey(root, key);
      try {
        await rm(target, { force: true });
      } catch (error) {
        throw toStorageError(error);
      }
    },

    async signedUrl(): Promise<string | null> {
      return null;
    },

    async exists(key: string): Promise<boolean> {
      const target = resolveKey(root, key);
      try {
        const stored = await stat(target);
        return stored.isFile();
      } catch (error) {
        const mapped = toStorageError(error);
        if (mapped.code === "not_found") return false;
        throw mapped;
      }
    },
  };
}
