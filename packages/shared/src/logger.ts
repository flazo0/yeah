export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  /** Same logger with extra fields on every line (e.g. `requestId`, `jobId`) — the correlation id. */
  child(fields: Record<string, unknown>): Logger;
}

export interface LoggerOptions {
  /** `json` (one object per line, for log shippers) or `text` (human-friendly). Default `json`. */
  format?: "json" | "text";
  /** Lines below this level are dropped. Default `info`. */
  minLevel?: LogLevel;
  /** Where lines go; defaults to stdout (errors/warnings to stderr). Injectable for tests. */
  sink?: (level: LogLevel, line: string) => void;
  now?: () => Date;
}

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function defaultSink(level: LogLevel, line: string) {
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

/** Errors don't survive JSON.stringify (no enumerable props) — flatten them into plain fields. */
function normalize(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = value instanceof Error ? { name: value.name, message: value.message, stack: value.stack } : value;
  }
  return out;
}

export function parseLogLevel(value: string | undefined): LogLevel {
  return value === "debug" || value === "info" || value === "warn" || value === "error" ? value : "info";
}

export function createLogger(service: string, options: LoggerOptions = {}, bound: Record<string, unknown> = {}): Logger {
  const { format = "json", minLevel = "info", sink = defaultSink, now = () => new Date() } = options;
  const emit = (level: LogLevel, msg: string, fields: Record<string, unknown> = {}) => {
    if (ORDER[level] < ORDER[minLevel]) return;
    const all = normalize({ ...bound, ...fields });
    if (format === "json") {
      sink(level, JSON.stringify({ ts: now().toISOString(), level, service, msg, ...all }));
      return;
    }
    const extra = Object.keys(all).length > 0 ? ` ${JSON.stringify(all)}` : "";
    sink(level, `${now().toISOString()} ${level.toUpperCase()} [${service}] ${msg}${extra}`);
  };
  return {
    debug: (msg, fields) => emit("debug", msg, fields),
    info: (msg, fields) => emit("info", msg, fields),
    warn: (msg, fields) => emit("warn", msg, fields),
    error: (msg, fields) => emit("error", msg, fields),
    child: (fields) => createLogger(service, options, { ...bound, ...fields }),
  };
}
