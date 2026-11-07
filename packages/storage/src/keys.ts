import { createHash } from "node:crypto";
import { type ObjectBody, StorageError } from "./types";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hashPattern = /^[0-9a-f]{32}$/i;
const extensionPattern = /^[a-z0-9]{1,16}$/i;

export interface SourceKeyInput {
  tenantId: string;
  sourceId: string;
  body: ObjectBody;
}

export interface ChunkKeyInput extends SourceKeyInput {
  ordinal: number;
}

export interface OriginalKeyInput extends SourceKeyInput {
  extension: string;
}

export interface ExportKeyInput {
  tenantId: string;
  brainId: string;
  jobId: string;
}

function invalidKey(): never {
  throw new StorageError("invalid_key", false, "Invalid storage key");
}

function assertUuid(value: string): string {
  if (!uuidPattern.test(value)) invalidKey();
  return value;
}

function assertDomainId(value: string, prefix: string): string {
  if (!value.startsWith(`${prefix}_`)) invalidKey();
  if (!hashPattern.test(value.slice(prefix.length + 1))) invalidKey();
  return value;
}

export function assertSafeKey(key: string): string {
  if (typeof key !== "string" || key.length === 0 || key.length > 1024) invalidKey();
  if (key.startsWith("/") || key.includes("\\") || key.includes("\0")) invalidKey();
  if (key.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
    invalidKey();
  }
  return key;
}

export function bodyBytes(body: ObjectBody): Uint8Array {
  if (typeof body === "string") return new TextEncoder().encode(body);
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  throw new StorageError("invalid_body", false, "Unsupported object body");
}

export function contentHash(body: ObjectBody): string {
  return createHash("sha256").update(bodyBytes(body)).digest("hex");
}

export function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

export function sourceKey(input: SourceKeyInput): string {
  const tenantId = assertUuid(input.tenantId);
  const sourceId = assertDomainId(input.sourceId, "src");
  return `sources/${tenantId}/${sourceId}/${contentHash(input.body)}.txt`;
}

export function chunkKey(input: ChunkKeyInput): string {
  const tenantId = assertUuid(input.tenantId);
  const sourceId = assertDomainId(input.sourceId, "src");
  if (!Number.isInteger(input.ordinal) || input.ordinal < 0) invalidKey();
  return `chunks/${tenantId}/${sourceId}/${contentHash(input.body)}/${input.ordinal}.txt`;
}

export function originalKey(input: OriginalKeyInput): string {
  const tenantId = assertUuid(input.tenantId);
  const sourceId = assertDomainId(input.sourceId, "src");
  if (!extensionPattern.test(input.extension)) invalidKey();
  const extension = input.extension.toLowerCase();
  return `originals/${tenantId}/${sourceId}/${contentHash(input.body)}.${extension}`;
}

export function exportKey(input: ExportKeyInput): string {
  const tenantId = assertUuid(input.tenantId);
  const brainId = assertDomainId(input.brainId, "brn");
  const jobId = assertUuid(input.jobId);
  return `exports/${tenantId}/${brainId}/${jobId}.zip`;
}
