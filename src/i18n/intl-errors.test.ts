// @vitest-environment node
import { IntlError, IntlErrorCode } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import {
  createIntlErrorHandlers,
  isStrictIntlMode,
  MessageError,
} from "@/i18n/intl-errors";
import type { IIntlLogger } from "@/i18n/intl-errors";

const FALLBACK = { UI: { nav: { about: "About" } }, Metadata: { title: "T" } };

function fakeLogger(): IIntlLogger & {
  readonly warnCalls: unknown[][];
  readonly errorCalls: unknown[][];
} {
  const warn = vi.fn<IIntlLogger["warn"]>();
  const error = vi.fn<IIntlLogger["error"]>();
  return {
    warn,
    error,
    get warnCalls() {
      return warn.mock.calls;
    },
    get errorCalls() {
      return error.mock.calls;
    },
  };
}

const missing = new IntlError(IntlErrorCode.MISSING_MESSAGE, "UI.nav.about");
const formatting = new IntlError(IntlErrorCode.FORMATTING_ERROR, "bad");

describe("strict handlers", () => {
  const handlers = createIntlErrorHandlers({
    strict: true,
    fallbackMessages: FALLBACK,
    logger: fakeLogger(),
  });

  it("throw from onError", () => {
    expect(() => {
      handlers.onError(missing);
    }).toThrow(MessageError);
  });

  it("throw from getMessageFallback with the code and the path", () => {
    const run = (): string =>
      handlers.getMessageFallback({
        namespace: "UI.nav",
        key: "about",
        error: missing,
      });

    expect(run).toThrow(MessageError);
    expect(run).toThrow("MISSING_MESSAGE: UI.nav.about");
  });

  it("keep the error code", () => {
    try {
      handlers.onError(formatting);
    } catch (error) {
      expect(error).toBeInstanceOf(MessageError);
      expect((error as MessageError).code).toBe("FORMATTING_ERROR");
      expect((error as MessageError).name).toBe("MessageError");
    }
    expect.assertions(3);
  });
});

describe("lenient handlers", () => {
  it("log a missing message as a warning, with the code only", () => {
    const logger = fakeLogger();
    const handlers = createIntlErrorHandlers({
      strict: false,
      fallbackMessages: FALLBACK,
      logger,
    });

    handlers.onError(missing);

    expect(logger.warnCalls).toStrictEqual([
      [{ code: "MISSING_MESSAGE" }, "Missing message"],
    ]);
    expect(logger.errorCalls).toStrictEqual([]);
  });

  it("log other errors as errors", () => {
    const logger = fakeLogger();
    const handlers = createIntlErrorHandlers({
      strict: false,
      fallbackMessages: FALLBACK,
      logger,
    });

    handlers.onError(formatting);

    expect(logger.errorCalls).toStrictEqual([
      [{ code: "FORMATTING_ERROR" }, "Message error"],
    ]);
  });

  it.each([
    ["a namespaced key", "UI.nav", "about", "About"],
    ["a key without namespace", undefined, "Metadata.title", "T"],
    ["a key missing in English", "UI.nav", "unknown", ""],
    ["a path through a string", "Metadata.title", "deeper", ""],
    ["a namespace, not a string", undefined, "UI", ""],
  ] as const)(
    "fall back to English for %s, never to the raw key",
    (_label, namespace, key, expected) => {
      const handlers = createIntlErrorHandlers({
        strict: false,
        fallbackMessages: FALLBACK,
        logger: fakeLogger(),
      });

      expect(
        handlers.getMessageFallback({
          ...(namespace === undefined ? {} : { namespace }),
          key,
          error: missing,
        })
      ).toBe(expected);
    }
  );
});

describe("isStrictIntlMode", () => {
  it.each([
    [{ NODE_ENV: "test" }],
    [{ CI: "true" }],
    [{ NEXT_PHASE: "phase-production-build" }],
  ])("is strict for %o", (source) => {
    expect(isStrictIntlMode(source)).toBe(true);
  });

  it.each([
    [{ NODE_ENV: "production" }],
    [{ CI: "false" }],
    [{ NEXT_PHASE: "phase-production-server" }],
    [{}],
  ])("is lenient for %o", (source) => {
    expect(isStrictIntlMode(source)).toBe(false);
  });
});
