import { defineRouting } from "next-intl/routing";

/** Supported locales, in the order the language switcher shows them (D3). */
export const LOCALES = ["en", "es", "pt", "fr"] as const;

export type AppLocale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: AppLocale = "en";

/** Name of the cookie that remembers the visitor's language (MASTERPLAN 4.1). */
export const LOCALE_COOKIE_NAME = "NEXT_LOCALE";

/** One year, so the language choice sticks across visits. */
export const LOCALE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/** Value of `<html lang>` per locale. Portuguese is Brazilian (A2). */
export const HTML_LANG: Readonly<Record<AppLocale, string>> = {
  en: "en",
  es: "es",
  pt: "pt-BR",
  fr: "fr",
};

export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: "always",
  // `Secure` is added by the proxy outside local runs (src/proxy.ts), because
  // this config is also read in the browser, where `APP_ENV` is unknown.
  localeCookie: {
    name: LOCALE_COOKIE_NAME,
    maxAge: LOCALE_COOKIE_MAX_AGE_SECONDS,
    sameSite: "lax",
    path: "/",
  },
  // `hreflang` alternates come from `generateMetadata` in Phase 6, with the
  // `pt-BR` tag; the middleware's `Link` header would announce plain `pt`.
  alternateLinks: false,
});

/** Type guard for values read from the URL or the cookie. */
export function isAppLocale(value: unknown): value is AppLocale {
  return (LOCALES as readonly unknown[]).includes(value);
}
