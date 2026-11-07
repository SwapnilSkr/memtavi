export type ObjectBody = string | Uint8Array | ArrayBuffer;

export type ObjectStore = {
  put(key: string, body: ObjectBody, contentType: string): Promise<void>;
  get(key: string): Promise<ReadableStream<Uint8Array>>;
  delete(key: string): Promise<void>;
  signedUrl(key: string, ttlSeconds: number): Promise<string | null>;
  exists(key: string): Promise<boolean>;
};

export type StorageErrorCode =
  | "not_found"
  | "invalid_key"
  | "invalid_body"
  | "invalid_ttl"
  | "access_denied"
  | "conflict"
  | "unavailable";

const statuses: Record<StorageErrorCode, number> = {
  not_found: 404,
  invalid_key: 400,
  invalid_body: 400,
  invalid_ttl: 400,
  access_denied: 403,
  conflict: 409,
  unavailable: 503,
};

export class StorageError extends Error {
  readonly code: StorageErrorCode;
  readonly status: number;
  readonly transient: boolean;

  constructor(code: StorageErrorCode, transient: boolean, message: string) {
    super(message);
    this.name = "StorageError";
    this.code = code;
    this.status = statuses[code];
    this.transient = transient;
  }
}
