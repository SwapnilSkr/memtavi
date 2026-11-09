import { describe, expect, test } from "bun:test";
import {
  decryptWebhookSecret,
  encryptWebhookSecret,
  generateWebhookSecret,
  signWebhookPayload,
  WEBHOOK_EVENTS,
} from "./webhooks";

const key = Buffer.alloc(32, 7).toString("base64");

describe("WEBHOOK_EVENTS", () => {
  test("lists the change actions in enum order", () => {
    expect([...WEBHOOK_EVENTS]).toEqual([
      "created",
      "updated",
      "renamed",
      "merged",
      "split",
      "archived",
      "restored",
      "recovered",
      "routed",
    ]);
  });
});

describe("generateWebhookSecret", () => {
  test("returns a prefixed 32-byte secret", () => {
    const secret = generateWebhookSecret();
    expect(/^whsec_[A-Za-z0-9_-]{43}$/.test(secret)).toBe(true);
    expect(secret).not.toBe(generateWebhookSecret());
  });
});

describe("encryptWebhookSecret", () => {
  test("round-trips the plaintext", () => {
    const secret = generateWebhookSecret();
    const encrypted = encryptWebhookSecret(secret, key);
    expect(encrypted).not.toContain(secret);
    expect(decryptWebhookSecret(encrypted, key)).toBe(secret);
  });

  test("uses a fresh IV so the same secret encrypts differently", () => {
    const secret = generateWebhookSecret();
    expect(encryptWebhookSecret(secret, key)).not.toBe(encryptWebhookSecret(secret, key));
  });

  test("rejects tampered ciphertext", () => {
    const encrypted = encryptWebhookSecret(generateWebhookSecret(), key);
    const parts = encrypted.split(".");
    const body = parts[3] ?? "";
    const flipped = `${body.slice(0, 2)}${body.slice(2, 3) === "A" ? "B" : "A"}${body.slice(3)}`;
    const tampered = [parts[0], parts[1], parts[2], flipped].join(".");
    expect(() => decryptWebhookSecret(tampered, key)).toThrow();
  });

  test("rejects a tampered auth tag", () => {
    const encrypted = encryptWebhookSecret(generateWebhookSecret(), key);
    const parts = encrypted.split(".");
    const tag = parts[2] ?? "";
    const flipped = `${tag.slice(0, 2)}${tag.slice(2, 3) === "A" ? "B" : "A"}${tag.slice(3)}`;
    expect(() =>
      decryptWebhookSecret([parts[0], parts[1], flipped, parts[3]].join("."), key),
    ).toThrow();
  });

  test("rejects the wrong key", () => {
    const encrypted = encryptWebhookSecret(generateWebhookSecret(), key);
    const other = Buffer.alloc(32, 9).toString("base64");
    expect(() => decryptWebhookSecret(encrypted, other)).toThrow();
  });

  test("rejects keys that are not 32 bytes", () => {
    expect(() => encryptWebhookSecret("whsec_x", Buffer.alloc(16).toString("base64"))).toThrow(
      "32-byte",
    );
    expect(() => encryptWebhookSecret("whsec_x", "not-base64!!")).toThrow("32-byte");
  });

  test("rejects a malformed envelope", () => {
    expect(() => decryptWebhookSecret("not-an-envelope", key)).toThrow("Invalid encrypted");
    expect(() => decryptWebhookSecret("v2.a.b.c", key)).toThrow("Invalid encrypted");
  });
});

describe("signWebhookPayload", () => {
  test("is stable, lowercase hex and keyed by the secret", () => {
    const body = JSON.stringify({ event: "created", id: "chg_1" });
    const signature = signWebhookPayload("whsec_abc", body);
    expect(signature).toBe(signWebhookPayload("whsec_abc", body));
    expect(/^[0-9a-f]{64}$/.test(signature)).toBe(true);
    expect(signWebhookPayload("whsec_other", body)).not.toBe(signature);
  });

  test("matches a known HMAC-SHA256 vector", () => {
    expect(signWebhookPayload("secret", "")).toBe(
      "f9e66e179b6747ae54108f82f8ade8b3c25d76fd30afde6c395822c530196169",
    );
  });
});
