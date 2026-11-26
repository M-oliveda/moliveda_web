import "server-only";

import pino from "pino";

import { CLOUD_TRACE_LOG_FIELD } from "@/lib/correlation-id";
import { getEnv } from "@/lib/env";
import type { AppEnv, LogLevel } from "@/lib/env";

import type { DestinationStream, Logger } from "pino";

export type { Logger } from "pino";

/** `service` field on every log line (MASTERPLAN 4.10). */
export const SERVICE_NAME = "moliveda-web";

export const REDACTED = "[REDACTED]";

// Sensitive fields, at the top level and up to two levels down (for example
// `headers.cookie` and `request.headers.cookie`). The log message itself is
// written under `message`, so a visitor's message must be logged as a length
// (`messageLength`), never as a field: redaction cannot cover the message key.
const SENSITIVE_KEYS = [
  "authorization",
  "cookie",
  '["set-cookie"]',
  '["x-origin-verify"]',
  "email",
  "replyTo",
  "body",
  "token",
  "turnstileToken",
  "apiKey",
  "password",
  "secret",
] as const;

export const REDACT_PATHS: readonly string[] = SENSITIVE_KEYS.flatMap((key) => {
  const nested = key.startsWith("[") ? key : `.${key}`;
  return [key, `*${nested}`, `*.*${nested}`];
});

// Cloud Logging reads `severity`; pino's numeric `level` would be ignored.
const SEVERITY: Readonly<Record<string, string>> = {
  trace: "DEBUG",
  debug: "DEBUG",
  info: "INFO",
  warn: "WARNING",
  error: "ERROR",
  fatal: "CRITICAL",
};

/** Cloud Logging severity for a pino level label. */
export function toSeverity(label: string): string {
  return SEVERITY[label] ?? "DEFAULT";
}

export interface ILoggerOptions {
  readonly level: LogLevel;
  readonly env: AppEnv;
  /** Where lines go. Defaults to stdout; tests pass a capturing stream. */
  readonly destination?: DestinationStream;
}

/** Creates a JSON logger with Cloud Logging field names and redaction. */
export function createLogger(options: ILoggerOptions): Logger {
  return pino(
    {
      level: options.level,
      messageKey: "message",
      base: { service: SERVICE_NAME, env: options.env },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level: (label) => ({ severity: toSeverity(label) }),
      },
      redact: { paths: [...REDACT_PATHS], censor: REDACTED },
    },
    options.destination
  );
}

export interface IRequestContext {
  readonly correlationId: string;
  /** Cloud Logging trace value, from `parseCloudTraceContext`. */
  readonly trace?: string | undefined;
}

/** Child logger that adds the correlation id and trace to every line. */
export function withRequestContext(
  logger: Logger,
  context: IRequestContext
): Logger {
  return logger.child({
    correlationId: context.correlationId,
    ...(context.trace === undefined
      ? {}
      : { [CLOUD_TRACE_LOG_FIELD]: context.trace }),
  });
}

let cached: Logger | undefined;

/** Shared logger for the process (Module pattern), configured from `env`. */
export function getLogger(): Logger {
  if (cached === undefined) {
    const env = getEnv();
    cached = createLogger({ level: env.LOG_LEVEL, env: env.APP_ENV });
  }
  return cached;
}
