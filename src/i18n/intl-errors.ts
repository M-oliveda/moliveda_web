import { IntlErrorCode } from "next-intl";

import type { IntlError } from "next-intl";

/** Logger methods the handlers use; a pino `Logger` fits. */
export interface IIntlLogger {
  warn(fields: object, message: string): void;
  error(fields: object, message: string): void;
}

export interface IIntlErrorHandlerOptions {
  /** Throw on every error instead of logging and falling back. */
  readonly strict: boolean;
  /** English messages, rendered when a key is missing in production. */
  readonly fallbackMessages: unknown;
  readonly logger: IIntlLogger;
}

export interface IMessageFallbackInfo {
  readonly namespace?: string;
  readonly key: string;
  readonly error: IntlError;
}

export interface IIntlErrorHandlers {
  onError(error: IntlError): void;
  getMessageFallback(info: IMessageFallbackInfo): string;
}

/** Thrown in strict mode, so a missing or broken message fails the build. */
export class MessageError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "MessageError";
    this.code = code;
  }
}

function messagePath(namespace: string | undefined, key: string): string {
  return namespace === undefined ? key : `${namespace}.${key}`;
}

function lookup(messages: unknown, path: string): string | undefined {
  let node: unknown = messages;
  for (const segment of path.split(".")) {
    if (typeof node !== "object" || node === null) {
      return undefined;
    }
    node = (node as Record<string, unknown>)[segment];
  }
  return typeof node === "string" ? node : undefined;
}

/**
 * `onError` and `getMessageFallback` for next-intl (MASTERPLAN 4.4). Strict
 * mode (tests, CI and `next build`) throws. Otherwise a missing message is
 * logged with its key and rendered in English; a raw key is never rendered.
 */
export function createIntlErrorHandlers(
  options: IIntlErrorHandlerOptions
): IIntlErrorHandlers {
  return {
    onError(error) {
      if (options.strict) {
        throw new MessageError(error.code, error.message);
      }
      const fields = { code: error.code };
      if (error.code === IntlErrorCode.MISSING_MESSAGE) {
        options.logger.warn(fields, "Missing message");
      } else {
        options.logger.error(fields, "Message error");
      }
    },
    getMessageFallback({ namespace, key, error }) {
      const path = messagePath(namespace, key);
      if (options.strict) {
        throw new MessageError(error.code, `${error.code}: ${path}`);
      }
      return lookup(options.fallbackMessages, path) ?? "";
    },
  };
}

/** Strict outside a running server: Vitest, CI and the production build. */
export function isStrictIntlMode(
  source: Readonly<Record<string, string | undefined>>
): boolean {
  return (
    source.NODE_ENV === "test" ||
    source.CI === "true" ||
    source.NEXT_PHASE === "phase-production-build"
  );
}
