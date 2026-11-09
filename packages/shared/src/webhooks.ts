import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

export const WEBHOOK_EVENTS = [
  "created",
  "updated",
  "renamed",
  "merged",
  "split",
  "archived",
  "restored",
  "recovered",
  "routed",
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

const SECRET_PREFIX = "whsec_";
const CIPHER_VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

function decodeKey(key: string): Buffer {
  const decoded = Buffer.from(key, "base64");
  if (decoded.length !== KEY_BYTES) {
    throw new Error("WEBHOOK_SECRET_KEY must be a base64-encoded 32-byte key");
  }
  return decoded;
}

export function generateWebhookSecret(): string {
  return `${SECRET_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function encryptWebhookSecret(secret: string, key: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", decodeKey(key), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    CIPHER_VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptWebhookSecret(enc: string, key: string): string {
  const parts = enc.split(".");
  if (parts.length !== 4 || parts[0] !== CIPHER_VERSION) {
    throw new Error("Invalid encrypted webhook secret");
  }
  const iv = Buffer.from(parts[1] ?? "", "base64url");
  const tag = Buffer.from(parts[2] ?? "", "base64url");
  const ciphertext = Buffer.from(parts[3] ?? "", "base64url");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error("Invalid encrypted webhook secret");
  }
  const decipher = createDecipheriv("aes-256-gcm", decodeKey(key), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export function signWebhookPayload(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}
