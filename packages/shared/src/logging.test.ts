import { describe, expect, test } from "bun:test";
import { createLogger } from "./logging";

function capture() {
  const lines: string[] = [];
  return {
    lines,
    stream: {
      write(line: string) {
        lines.push(line);
      },
    },
  };
}

function record(lines: string[]): Record<string, unknown> {
  const line = lines.at(-1);
  if (line === undefined) throw new Error("no log line");
  return JSON.parse(line) as Record<string, unknown>;
}

describe("createLogger", () => {
  test("writes one JSON line with level, time, msg, merged bindings and fields", () => {
    const { lines, stream } = capture();
    const logger = createLogger({ level: "debug", bindings: { service: "api" }, stream });

    logger.info({ requestId: "r1", status: 200 }, "request");

    expect(lines).toHaveLength(1);
    expect(record(lines)).toMatchObject({
      level: "info",
      msg: "request",
      service: "api",
      requestId: "r1",
      status: 200,
    });
    const time = record(lines).time;
    expect(typeof time).toBe("string");
    expect(new Date(String(time)).toISOString()).toBe(String(time));
  });

  test("filters entries below the configured level", () => {
    const { lines, stream } = capture();
    const logger = createLogger({ level: "warn", stream });

    logger.debug({}, "debug");
    logger.info({}, "info");
    logger.warn({}, "warn");
    logger.error({}, "error");

    expect(lines.map((line) => (JSON.parse(line) as { msg: string }).msg)).toEqual([
      "warn",
      "error",
    ]);
  });

  test("child merges bindings and overrides the parent", () => {
    const { lines, stream } = capture();
    const logger = createLogger({
      level: "info",
      bindings: { service: "api", tenantId: "t1" },
      stream,
    });

    logger.child({ requestId: "r1", tenantId: "t2" }).info({ route: "/v1/brains" }, "request");

    expect(record(lines)).toMatchObject({
      service: "api",
      tenantId: "t2",
      requestId: "r1",
      route: "/v1/brains",
      msg: "request",
    });
  });

  test("drops undefined fields instead of emitting them", () => {
    const { lines, stream } = capture();
    const logger = createLogger({ level: "info", stream });

    logger.info({ present: 1, missing: undefined, nested: { ok: true } }, "shape");

    expect(Object.keys(record(lines))).not.toContain("missing");
    expect(lines[0]).not.toContain("undefined");
  });

  test("reads the level from LOG_LEVEL and defaults to info", () => {
    const previous = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = "error";
    try {
      const { lines, stream } = capture();
      const logger = createLogger({ stream });
      logger.info({}, "hidden");
      logger.error({}, "shown");
      expect(lines.map((line) => (JSON.parse(line) as { msg: string }).msg)).toEqual(["shown"]);
    } finally {
      if (previous === undefined) delete process.env.LOG_LEVEL;
      else process.env.LOG_LEVEL = previous;
    }

    const { lines: defaults, stream: defaultStream } = capture();
    createLogger({ stream: defaultStream }).info({}, "default");
    expect(record(defaults).level).toBe("info");
  });
});
