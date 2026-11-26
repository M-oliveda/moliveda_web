// @vitest-environment node
import { IntlError, IntlErrorCode } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import { MessageError } from "@/i18n/intl-errors";
import { createRequestConfig } from "@/i18n/request-config";

const missing = new IntlError(IntlErrorCode.MISSING_MESSAGE, "x");

describe("createRequestConfig", () => {
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
});
