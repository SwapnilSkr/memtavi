import { describe, expect, test } from "bun:test";
import { clearSession, readSession, type SessionStorage, saveSession } from "./session";

function stubStorage(): SessionStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

const session = {
  baseUrl: "",
  apiKey: "test-session-key",
  subjectId: "00000000-0000-4000-8000-000000000001",
};

describe("session storage", () => {
  test("round-trips only connection settings and clears the session", () => {
    const storage = stubStorage();
    expect(readSession(storage)).toBeNull();
    saveSession(session, storage);
    expect(readSession(storage)).toEqual(session);
    clearSession(storage);
    expect(readSession(storage)).toBeNull();
  });

  test("preserves a custom base URL", () => {
    const storage = stubStorage();
    saveSession({ ...session, baseUrl: "https://api.example.test" }, storage);
    expect(readSession(storage)?.baseUrl).toBe("https://api.example.test");
  });

  test.each([
    "not json",
    "null",
    "{}",
    '{"baseUrl":"","apiKey":"","subjectId":"subject"}',
    '{"baseUrl":3,"apiKey":"key","subjectId":"subject"}',
    '{"baseUrl":"","apiKey":"key","subjectId":" "}',
  ])("rejects incomplete or corrupt storage: %s", (raw) => {
    expect(readSession({ ...stubStorage(), getItem: () => raw })).toBeNull();
  });

  test("falls back to setup when storage cannot be read", () => {
    expect(
      readSession({
        ...stubStorage(),
        getItem: () => {
          throw new Error("Storage unavailable");
        },
      }),
    ).toBeNull();
  });

  test("surfaces write failures so setup cannot claim it saved settings", () => {
    expect(() =>
      saveSession(session, {
        ...stubStorage(),
        setItem: () => {
          throw new Error("Storage unavailable");
        },
      }),
    ).toThrow("Storage unavailable");
  });
});
