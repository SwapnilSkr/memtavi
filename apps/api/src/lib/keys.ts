import { createHash, randomBytes } from "node:crypto";

export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function issueKey() {
  const key = `mtv_live_${randomBytes(32).toString("base64url")}`;
  return { key, prefix: key.slice(0, 16), hash: hashKey(key) };
}
