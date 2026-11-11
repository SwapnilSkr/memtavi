import { AsyncLocalStorage } from "node:async_hooks";
import {
  type Attributes,
  type Context,
  INVALID_SPAN_CONTEXT,
  context as otelContext,
  propagation,
  type Span,
  type SpanKind,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { CompositePropagator, W3CTraceContextPropagator } from "@opentelemetry/core";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  AlwaysOffSampler,
  AlwaysOnSampler,
  BatchSpanProcessor,
  ParentBasedSampler,
  type Sampler,
  SimpleSpanProcessor,
  type SpanExporter,
  TraceIdRatioBasedSampler,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

export type { Span } from "@opentelemetry/api";
export { SpanKind, SpanStatusCode } from "@opentelemetry/api";

const TRACER_NAME = "memtavi";
const TRACE_PARENT_HEADER = "traceparent";

interface RequestTrace {
  context: Context;
  span: Span | undefined;
  traceparent: string | null;
}

const storage = new AsyncLocalStorage<RequestTrace>();
const state: { provider: NodeTracerProvider | null; enabled: boolean } = {
  provider: null,
  enabled: false,
};

export interface TelemetryOptions {
  exporter?: SpanExporter;
  serviceName?: string;
  endpoint?: string;
  sampler?: Sampler;
}

export interface TelemetryHandle {
  readonly enabled: boolean;
  shutdown(): Promise<void>;
}

export interface SpanOptions {
  parent?: Context;
  kind?: SpanKind;
}

const DISABLED: TelemetryHandle = { enabled: false, shutdown: async () => undefined };

function samplerFromEnv(): Sampler {
  const name = (process.env.OTEL_TRACES_SAMPLER ?? "").trim().toLowerCase();
  if (name === "always_off") return new AlwaysOffSampler();
  if (name === "always_on") return new AlwaysOnSampler();
  if (name === "traceidratio") return new TraceIdRatioBasedSampler(samplerRatio());
  if (name === "parentbased_always_off")
    return new ParentBasedSampler({ root: new AlwaysOffSampler() });
  if (name === "parentbased_traceidratio") {
    return new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(samplerRatio()) });
  }
  return new ParentBasedSampler({ root: new AlwaysOnSampler() });
}

function samplerRatio(): number {
  const value = Number(process.env.OTEL_TRACES_SAMPLER_ARG ?? "");
  if (!Number.isFinite(value) || value < 0 || value > 1) return 1;
  return value;
}

function endpointFromEnv(): string | undefined {
  const value = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  return value === undefined || value === "" ? undefined : value;
}

function tracesUrl(endpoint: string): string {
  const base = endpoint.replace(/\/+$/, "");
  return base.endsWith("/v1/traces") ? base : `${base}/v1/traces`;
}

export function initTelemetry(options: TelemetryOptions = {}): TelemetryHandle {
  const endpoint = options.endpoint?.trim() || endpointFromEnv();
  if (options.exporter === undefined && endpoint === undefined) return DISABLED;
  if (state.provider !== null) return { enabled: state.enabled, shutdown: shutdownTelemetry };

  const serviceName = options.serviceName ?? (process.env.OTEL_SERVICE_NAME?.trim() || "memtavi");
  const exporter = options.exporter ?? new OTLPTraceExporter({ url: tracesUrl(endpoint ?? "") });
  const processor =
    options.exporter === undefined
      ? new BatchSpanProcessor(exporter)
      : new SimpleSpanProcessor(exporter);
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({ "service.name": serviceName }),
    sampler: options.sampler ?? samplerFromEnv(),
    spanProcessors: [processor],
  });
  provider.register({
    contextManager: new AsyncLocalStorageContextManager(),
    propagator: new CompositePropagator({ propagators: [new W3CTraceContextPropagator()] }),
  });
  state.provider = provider;
  state.enabled = true;
  return { enabled: true, shutdown: shutdownTelemetry };
}

export async function shutdownTelemetry(): Promise<void> {
  const provider = state.provider;
  state.provider = null;
  state.enabled = false;
  if (provider !== null) await provider.shutdown();
  trace.disable();
  otelContext.disable();
  propagation.disable();
}

export function telemetryEnabled(): boolean {
  return state.enabled;
}

export function currentSpan(): Span | undefined {
  return storage.getStore()?.span;
}

export function currentTraceId(): string | null {
  const spanContext = storage.getStore()?.span?.spanContext();
  return spanContext !== undefined && trace.isSpanContextValid(spanContext)
    ? spanContext.traceId
    : null;
}

export function currentTraceparent(): string | null {
  return storage.getStore()?.traceparent ?? null;
}

function injectContext(context: Context): string | null {
  const carrier: Record<string, string> = {};
  propagation.inject(context, carrier);
  return carrier[TRACE_PARENT_HEADER] ?? null;
}

export function traceparentOf(span: Span): string | null {
  return injectContext(trace.setSpan(otelContext.active(), span));
}

function parentContext(options: SpanOptions): Context {
  return options.parent ?? storage.getStore()?.context ?? otelContext.active();
}

export function startSpan(
  name: string,
  attributes: Attributes = {},
  options: SpanOptions = {},
): Span {
  return trace
    .getTracer(TRACER_NAME)
    .startSpan(
      name,
      { attributes, ...(options.kind === undefined ? {} : { kind: options.kind }) },
      parentContext(options),
    );
}

export function enterSpan(span: Span, parent: Context = otelContext.active()): void {
  const context = trace.setSpan(parent, span);
  storage.enterWith({ context, span, traceparent: injectContext(context) });
}

export function withIsolatedTrace<T>(fn: () => T): T {
  return storage.run({ context: otelContext.active(), span: undefined, traceparent: null }, fn);
}

export async function withSpan<T>(
  name: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T>,
  options: SpanOptions = {},
): Promise<T> {
  if (!state.enabled) return fn(trace.wrapSpanContext(INVALID_SPAN_CONTEXT));
  const parent = parentContext(options);
  const span = startSpan(name, attributes, { ...options, parent });
  const context = trace.setSpan(parent, span);
  return storage.run({ context, span, traceparent: injectContext(context) }, async () => {
    try {
      return await fn(span);
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}

export function extractTraceContext(traceparent: string | null | undefined): Context | undefined {
  if (traceparent === null || traceparent === undefined || traceparent === "") return undefined;
  const context = propagation.extract(otelContext.active(), {
    [TRACE_PARENT_HEADER]: traceparent,
  });
  const spanContext = trace.getSpanContext(context);
  if (spanContext === undefined || !trace.isSpanContextValid(spanContext)) return undefined;
  return context;
}
