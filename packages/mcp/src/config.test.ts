import { describe, expect, test } from "bun:test";
import { ConfigError, loadConfig } from "./config";

describe("loadConfig", () => {
  test("defaults the API URL when it is absent", () => {
    const config = loadConfig({ MEMTAVI_API_KEY: "mtv_live_x", MEMTAVI_SUBJECT_ID: "sub_1" });
    expect(config.apiUrl).toBe("http://localhost:3000");
    expect(config.brainId).toBeUndefined();
  });

  test("trims a trailing slash from the API URL", () => {
    const config = loadConfig({
      MEMTAVI_API_URL: "https://api.example.com/",
      MEMTAVI_API_KEY: "mtv_live_x",
      MEMTAVI_SUBJECT_ID: "sub_1",
    });
    expect(config.apiUrl).toBe("https://api.example.com");
  });

  test("treats an empty API URL as absent", () => {
    const config = loadConfig({
      MEMTAVI_API_URL: "  ",
      MEMTAVI_API_KEY: "mtv_live_x",
      MEMTAVI_SUBJECT_ID: "sub_1",
    });
    expect(config.apiUrl).toBe("http://localhost:3000");
  });

  test("keeps the optional brain id when supplied", () => {
    const config = loadConfig({
      MEMTAVI_API_KEY: "mtv_live_x",
      MEMTAVI_SUBJECT_ID: "sub_1",
      MEMTAVI_BRAIN_ID: "brn_1",
    });
    expect(config.brainId).toBe("brn_1");
  });

  test("drops an empty optional brain id", () => {
    const config = loadConfig({
      MEMTAVI_API_KEY: "mtv_live_x",
      MEMTAVI_SUBJECT_ID: "sub_1",
      MEMTAVI_BRAIN_ID: "  ",
    });
    expect(config.brainId).toBeUndefined();
  });

  test("rejects a missing API key without echoing any value", () => {
    expect(() => loadConfig({ MEMTAVI_SUBJECT_ID: "sub_1" })).toThrow(ConfigError);
    expect(() => loadConfig({ MEMTAVI_SUBJECT_ID: "sub_1" })).toThrow(
      /MEMTAVI_API_KEY is required/,
    );
  });

  test("rejects a missing subject id", () => {
    expect(() => loadConfig({ MEMTAVI_API_KEY: "mtv_live_x" })).toThrow(
      /MEMTAVI_SUBJECT_ID is required/,
    );
  });

  test("rejects a malformed API URL", () => {
    expect(() =>
      loadConfig({
        MEMTAVI_API_URL: "not a url",
        MEMTAVI_API_KEY: "mtv_live_x",
        MEMTAVI_SUBJECT_ID: "sub_1",
      }),
    ).toThrow(/not a valid URL/);
  });

  test("rejects a non-http API URL", () => {
    expect(() =>
      loadConfig({
        MEMTAVI_API_URL: "ftp://example.com",
        MEMTAVI_API_KEY: "mtv_live_x",
        MEMTAVI_SUBJECT_ID: "sub_1",
      }),
    ).toThrow(/must use http or https/);
  });
});
