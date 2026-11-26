// @vitest-environment node
import { IntlError, IntlErrorCode } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MessageError } from "@/i18n/intl-errors";
import {
  createLazyIntlLogger,
  createRequestConfig,
} from "@/i18n/request-config";

const missing = new IntlError(IntlErrorCode.MISSING_MESSAGE, "x");

describe("createRequestConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the locale and its messages", async () => {
    const config = await createRequestConfig("es", {
      strict: true,
      logger: { warn: vi.fn(), error: vi.fn() },
    });

    expect(config.locale).toBe("es");
    expect(config.messages.UI.nav.about).toBe("Sobre mí");
  });

  it("falls back to English when lenient", async () => {
    const config = await createRequestConfig("fr", {
      strict: false,
      logger: { warn: vi.fn(), error: vi.fn() },
    });

    expect(
      config.getMessageFallback({
        namespace: "UI",
        key: "skipLink",
        error: missing,
      })
    ).toBe("Skip to main content");
  });

  it("is strict under Vitest by default", async () => {
    const config = await createRequestConfig("pt");

    expect(() => {
      config.onError(missing);
    }).toThrow(MessageError);
  });

  it("does not need the runtime environment by default", async () => {
    // As in `next build`: no APP_ENV.
    vi.stubEnv("APP_ENV", "");
    const config = await createRequestConfig("en");

    expect(config.locale).toBe("en");
  });
});

describe("createLazyIntlLogger", () => {
  it("creates the logger only on first use and delegates to it", () => {
    const logger = { warn: vi.fn(), error: vi.fn() };
    const factory = vi.fn(() => logger);
    const lazy = createLazyIntlLogger(factory);

    expect(factory).not.toHaveBeenCalled();

    lazy.warn({ code: "a" }, "Missing message");
    lazy.error({ code: "b" }, "Message error");

    expect(logger.warn).toHaveBeenCalledWith({ code: "a" }, "Missing message");
    expect(logger.error).toHaveBeenCalledWith({ code: "b" }, "Message error");
  });

  it("defaults to the shared logger", () => {
    expect(() => {
      createLazyIntlLogger();
    }).not.toThrow();
  });
});
