import { afterEach, describe, expect, test } from "bun:test";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import {
  currentTraceId,
  currentTraceparent,
  enterSpan,
  extractTraceContext,
  initTelemetry,
  shutdownTelemetry,
  startSpan,
  telemetryEnabled,
  traceparentOf,
  withIsolatedTrace,
  withSpan,
} from "./telemetry";

const W3C_TRACEPARENT = /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/;

function exporter(): InMemorySpanExporter {
  return new InMemorySpanExporter();
}

afterEach(async () => {
  await shutdownTelemetry();
});

describe("telemetry", () => {
  test("stays disabled without an endpoint and starts no spans", async () => {
    const handle = initTelemetry({ endpoint: "" });

    expect(handle.enabled).toBe(false);
    expect(telemetryEnabled()).toBe(false);
    const value = await withSpan("ignored", { probe: "off" }, async () => 7);
    expect(value).toBe(7);
    expect(currentTraceId()).toBeNull();
    expect(currentTraceparent()).toBeNull();
    expect(traceparentOf(startSpan("manual"))).toBeNull();
  });

  test("records parent and child spans with their attributes", async () => {
    const memory = exporter();
    initTelemetry({ exporter: memory, serviceName: "unit" });

    const trace = await withSpan("parent", { step: "one" }, async (parent) => {
      const child = startSpan("child", { step: "two" });
      child.end();
      return { traceId: parent.spanContext().traceId, spanId: parent.spanContext().spanId };
    });

    const spans = memory.getFinishedSpans();
    expect(spans.map((span) => span.name).sort()).toEqual(["child", "parent"]);
    const parent = spans.find((span) => span.name === "parent");
    const child = spans.find((span) => span.name === "child");
    expect(parent?.attributes).toEqual({ step: "one" });
    expect(child?.attributes).toEqual({ step: "two" });
    expect(child?.spanContext().traceId).toBe(trace.traceId);
    expect(child?.parentSpanContext?.spanId).toBe(trace.spanId);
    expect(parent?.resource.attributes["service.name"]).toBe("unit");
  });

  test("injects a W3C traceparent that extracts back to the same parent", async () => {
    const memory = exporter();
    initTelemetry({ exporter: memory, serviceName: "unit" });

    const outer = await withSpan("outer", {}, async (span) => ({
      traceparent: currentTraceparent(),
      traceId: currentTraceId(),
      spanId: span.spanContext().spanId,
    }));

    expect(outer.traceparent).toMatch(W3C_TRACEPARENT);
    expect(outer.traceparent).toContain(outer.traceId ?? "");

    const parent = extractTraceContext(outer.traceparent);
    expect(parent).toBeDefined();
    const child = startSpan("remote-child", {}, parent === undefined ? {} : { parent });
    child.end();

    const recorded = memory.getFinishedSpans().find((span) => span.name === "remote-child");
    expect(recorded?.spanContext().traceId).toBe(outer.traceId ?? "");
    expect(recorded?.parentSpanContext?.spanId).toBe(outer.spanId);
  });

  test("enterSpan keeps a server span active for later helpers", async () => {
    const memory = exporter();
    initTelemetry({ exporter: memory, serviceName: "unit" });

    const span = startSpan("http.server");
    enterSpan(span);
    expect(currentTraceId()).toBe(span.spanContext().traceId);
    expect(currentTraceparent()).toMatch(W3C_TRACEPARENT);
    span.end();
    expect(memory.getFinishedSpans().map((item) => item.name)).toContain("http.server");
  });

  test("keeps concurrent request scopes apart", async () => {
    initTelemetry({ exporter: exporter(), serviceName: "unit" });

    let releaseFirst: () => void = () => undefined;
    let releaseSecond: () => void = () => undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });

    async function request(gate: Promise<void>) {
      return withIsolatedTrace(async () => {
        const span = startSpan("request");
        enterSpan(span);
        await gate;
        const traceparent = currentTraceparent();
        const traceId = currentTraceId();
        span.end();
        return { traceparent, traceId, spanTraceId: span.spanContext().traceId };
      });
    }

    const first = request(firstGate);
    const second = request(secondGate);
    releaseSecond();
    const secondResult = await second;
    releaseFirst();
    const firstResult = await first;

    expect(firstResult.traceId).toBe(firstResult.spanTraceId);
    expect(secondResult.traceId).toBe(secondResult.spanTraceId);
    expect(firstResult.traceparent).toContain(firstResult.spanTraceId);
    expect(secondResult.traceparent).toContain(secondResult.spanTraceId);
    expect(firstResult.spanTraceId).not.toBe(secondResult.spanTraceId);
  });

  test("ignores a malformed traceparent", () => {
    initTelemetry({ exporter: exporter(), serviceName: "unit" });
    expect(extractTraceContext("not-a-traceparent")).toBeUndefined();
    expect(extractTraceContext("")).toBeUndefined();
    expect(extractTraceContext(null)).toBeUndefined();
  });

  test("shutdown stops recording and leaves the callback untouched", async () => {
    const memory = exporter();
    initTelemetry({ exporter: memory, serviceName: "unit" });
    await withSpan("before", {}, async () => undefined);
    expect(memory.getFinishedSpans()).toHaveLength(1);

    await shutdownTelemetry();
    const count = memory.getFinishedSpans().length;

    expect(telemetryEnabled()).toBe(false);
    expect(await withSpan("after", {}, async () => 9)).toBe(9);
    expect(memory.getFinishedSpans()).toHaveLength(count);
    expect(currentTraceId()).toBeNull();
  });
});
