// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  DEFAULT_LOCALE,
  HTML_LANG,
  isAppLocale,
  LOCALE_COOKIE_MAX_AGE_SECONDS,
  LOCALE_COOKIE_NAME,
  LOCALES,
  routing,
} from "@/i18n/routing";

describe("routing", () => {
  it("serves the four locales, always prefixed, English by default", () => {
    expect(routing.locales).toStrictEqual(["en", "es", "pt", "fr"]);
    expect(routing.defaultLocale).toBe("en");
    expect(DEFAULT_LOCALE).toBe("en");
    expect(routing.localePrefix).toBe("always");
  });

  it("keeps the language choice for a year", () => {
    expect(routing.localeCookie).toStrictEqual({
      name: LOCALE_COOKIE_NAME,
      maxAge: LOCALE_COOKIE_MAX_AGE_SECONDS,
      sameSite: "lax",
      path: "/",
    });
    expect(LOCALE_COOKIE_MAX_AGE_SECONDS).toBe(31_536_000);
  });

  it("leaves hreflang alternates to the metadata", () => {
    expect(routing.alternateLinks).toBe(false);
  });

  it("uses pt-BR as the Portuguese html lang", () => {
    expect(LOCALES.map((locale) => HTML_LANG[locale])).toStrictEqual([
      "en",
      "es",
      "pt-BR",
      "fr",
    ]);
  });
});

describe("isAppLocale", () => {
  it.each(LOCALES)("accepts %s", (locale) => {
    expect(isAppLocale(locale)).toBe(true);
  });

  it.each(["de", "EN", "pt-BR", "", undefined, 1])("rejects %s", (value) => {
    expect(isAppLocale(value)).toBe(false);
  });
});
