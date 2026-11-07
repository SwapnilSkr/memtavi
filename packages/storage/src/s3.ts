import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/cloudfront-signer";
import { assertSafeKey } from "./keys";
import { type ObjectBody, type ObjectStore, StorageError } from "./types";

export interface SignedUrlInput {
  url: string;
  keyPairId: string;
  privateKey: string;
  dateLessThan: Date;
}

export type CloudFrontSigner = (input: SignedUrlInput) => string;

export interface S3StoreOptions {
  bucket: string;
  region: string;
  domain: string;
  keyPairId?: string;
  privateKey?: string;
  client?: S3Client;
  signer?: CloudFrontSigner;
  now?: () => Date;
}

const defaultSigner: CloudFrontSigner = (input) =>
  getSignedUrl({
    url: input.url,
    keyPairId: input.keyPairId,
    privateKey: input.privateKey,
    dateLessThan: input.dateLessThan,
  });

function baseUrl(domain: string): string {
  const trimmed = domain.replace(/\/+$/, "");
  if (trimmed.startsWith("https://") || trimmed.startsWith("http://")) return trimmed;
  return `https://${trimmed}`;
}

function encodeKey(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

function toSdkBody(body: ObjectBody): string | Uint8Array {
  return body instanceof ArrayBuffer ? new Uint8Array(body) : body;
}

function httpStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const metadata = (error as { $metadata?: { httpStatusCode?: unknown } }).$metadata;
  return typeof metadata?.httpStatusCode === "number" ? metadata.httpStatusCode : null;
}

function errorName(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const name = (error as { name?: unknown }).name;
  return typeof name === "string" ? name : null;
}

function toStorageError(error: unknown): StorageError {
  if (error instanceof StorageError) return error;
  const status = httpStatus(error);
  const name = errorName(error);
  if (status === 404 || name === "NoSuchKey" || name === "NotFound") {
    return new StorageError("not_found", false, "Object not found");
  }
  if (status === 403 || name === "AccessDenied" || name === "Forbidden") {
    return new StorageError("access_denied", false, "Object store rejected the request");
  }
  return new StorageError(
    "unavailable",
    status === null || status >= 500,
    "Object store request failed",
  );
}

function isTransformableBody(value: unknown): value is { transformToWebStream(): ReadableStream } {
  if (typeof value !== "object" || value === null) return false;
  if (!("transformToWebStream" in value)) return false;
  return typeof (value as { transformToWebStream?: unknown }).transformToWebStream === "function";
}

function toWebStream(body: unknown): ReadableStream<Uint8Array> {
  if (body instanceof ReadableStream) return body as ReadableStream<Uint8Array>;
  if (isTransformableBody(body)) return body.transformToWebStream() as ReadableStream<Uint8Array>;
  throw new StorageError("unavailable", true, "Object body is not a stream");
}

export function createS3Store(options: S3StoreOptions): ObjectStore {
  const client = options.client ?? new S3Client({ region: options.region });
  const signer = options.signer ?? defaultSigner;
  const clock = options.now ?? (() => new Date());
  const domain = baseUrl(options.domain);
  const { bucket, keyPairId, privateKey } = options;

  return {
    async put(key: string, body: ObjectBody, contentType: string): Promise<void> {
      assertSafeKey(key);
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: toSdkBody(body),
            ContentType: contentType,
            ServerSideEncryption: "AES256",
          }),
        );
      } catch (error) {
        throw toStorageError(error);
      }
    },

    async get(key: string): Promise<ReadableStream<Uint8Array>> {
      assertSafeKey(key);
      try {
        const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        if (response.Body === undefined) {
          throw new StorageError("not_found", false, "Object not found");
        }
        return toWebStream(response.Body);
      } catch (error) {
        throw toStorageError(error);
      }
    },

    async delete(key: string): Promise<void> {
      assertSafeKey(key);
      try {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      } catch (error) {
        const mapped = toStorageError(error);
        if (mapped.code === "not_found") return;
        throw mapped;
      }
    },

    async signedUrl(key: string, ttlSeconds: number): Promise<string | null> {
      if (keyPairId === undefined || keyPairId === "") return null;
      if (privateKey === undefined || privateKey === "") return null;
      assertSafeKey(key);
      if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
        throw new StorageError("invalid_ttl", false, "Signed URL TTL must be positive");
      }
      return signer({
        url: `${domain}/${encodeKey(key)}`,
        keyPairId,
        privateKey,
        dateLessThan: new Date(clock().getTime() + ttlSeconds * 1000),
      });
    },

    async exists(key: string): Promise<boolean> {
      assertSafeKey(key);
      try {
        await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return true;
      } catch (error) {
        const mapped = toStorageError(error);
        if (mapped.code === "not_found") return false;
        throw mapped;
      }
    },
  };
}
