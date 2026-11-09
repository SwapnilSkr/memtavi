export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

export interface LogStream {
  write(line: string): void;
}

export interface LoggerOptions {
  level?: LogLevel;
  bindings?: Record<string, unknown>;
  stream?: LogStream;
}

export interface Logger {
  readonly level: LogLevel;
  debug(fields: Record<string, unknown>, msg?: string): void;
  info(fields: Record<string, unknown>, msg?: string): void;
  warn(fields: Record<string, unknown>, msg?: string): void;
  error(fields: Record<string, unknown>, msg?: string): void;
  child(bindings: Record<string, unknown>): Logger;
}

const priorities: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function normalizeLevel(value: string | undefined): LogLevel {
  if (value === "debug" || value === "info" || value === "warn" || value === "error") return value;
  return "info";
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? normalizeLevel(process.env.LOG_LEVEL);
  const stream = options.stream ?? process.stdout;
  const bindings = options.bindings ?? {};

  function emit(entryLevel: LogLevel, fields: Record<string, unknown>, msg?: string): void {
    if (priorities[entryLevel] < priorities[level]) return;
    const record: Record<string, unknown> = {};
    for (const source of [bindings, fields]) {
      for (const [key, value] of Object.entries(source)) {
        if (value !== undefined) record[key] = value;
      }
    }
    record.level = entryLevel;
    record.time = new Date().toISOString();
    record.msg = msg ?? (typeof record.msg === "string" ? record.msg : "");
    stream.write(`${JSON.stringify(record)}\n`);
  }

  return {
    level,
    debug: (fields, msg) => emit("debug", fields, msg),
    info: (fields, msg) => emit("info", fields, msg),
    warn: (fields, msg) => emit("warn", fields, msg),
    error: (fields, msg) => emit("error", fields, msg),
    child: (childBindings) =>
      createLogger({ level, stream, bindings: { ...bindings, ...childBindings } }),
  };
}
