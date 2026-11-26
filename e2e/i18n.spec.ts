import { expect, test } from "@playwright/test";

// Locale negotiation and the i18n shell (MASTERPLAN 4.1, Phase 3).
const LOCALES = [
  { locale: "en", acceptLanguage: "en-US,en;q=0.9", htmlLang: "en" },
  { locale: "es", acceptLanguage: "es-AR,es;q=0.9", htmlLang: "es" },
  { locale: "pt", acceptLanguage: "pt-BR,pt;q=0.9", htmlLang: "pt-BR" },
  { locale: "fr", acceptLanguage: "fr-FR,fr;q=0.9", htmlLang: "fr" },
] as const;

test.describe("the / redirect", () => {
  for (const { locale, acceptLanguage } of LOCALES) {
    test(`sends Accept-Language ${acceptLanguage} to /${locale}`, async ({
      request,
    }) => {
      const response = await request.get("/", {
        headers: { "Accept-Language": acceptLanguage },
        maxRedirects: 0,
      });

      expect(response.status()).toBe(307);
      expect(
        new URL(response.headers().location ?? "", "http://x").pathname
      ).toBe(`/${locale}`);
    });
  }

  test("falls back to English for an unsupported language", async ({
    request,
  }) => {
    const response = await request.get("/", {
      headers: { "Accept-Language": "de-DE,de;q=0.9" },
      maxRedirects: 0,
    });

    expect(
      new URL(response.headers().location ?? "", "http://x").pathname
    ).toBe("/en");
  });

  test("prefers the NEXT_LOCALE cookie", async ({ request }) => {
    const response = await request.get("/", {
      headers: { "Accept-Language": "es", Cookie: "NEXT_LOCALE=pt" },
      maxRedirects: 0,
    });

    expect(
      new URL(response.headers().location ?? "", "http://x").pathname
    ).toBe("/pt");
  });

  test("is private and varies per visitor", async ({ request }) => {
    const response = await request.get("/", { maxRedirects: 0 });

    expect(response.headers().vary).toContain("Accept-Language");
    expect(response.headers().vary).toContain("Cookie");
    expect(response.headers()["cache-control"]).toBe("private, no-store");
  });
});

test.describe("locale pages", () => {
  for (const { locale, htmlLang } of LOCALES) {
    test(`/${locale} sets <html lang="${htmlLang}">`, async ({ page }) => {
      await page.goto(`/${locale}`);

      await expect(page.locator("html")).toHaveAttribute("lang", htmlLang);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    });
  }

  test("the browser lands on its language from /", async ({ browser }) => {
    const context = await browser.newContext({ locale: "fr-FR" });
    const page = await context.newPage();

    await page.goto("/");

    expect(new URL(page.url()).pathname).toBe("/fr");
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    await context.close();
  });

  test("opening another locale remembers it for /", async ({ browser }) => {
    const context = await browser.newContext({ locale: "en-US" });
    const page = await context.newPage();

    await page.goto("/es");
    await page.goto("/");

    expect(new URL(page.url()).pathname).toBe("/es");
    await context.close();
  });
});

test.describe("theme", () => {
  for (const colorScheme of ["light", "dark"] as const) {
    test(`follows the system ${colorScheme} scheme`, async ({ browser }) => {
      const context = await browser.newContext({ colorScheme });
      const page = await context.newPage();

      await page.goto("/en");

      await expect(page.locator("html")).toHaveClass(
        new RegExp(`\\b${colorScheme}\\b`)
      );
      await context.close();
    });
  }
});

test.describe("correlation id", () => {
  for (const path of ["/", "/en", "/health"]) {
    test(`${path} returns X-Correlation-ID`, async ({ request }) => {
      const response = await request.get(path, { maxRedirects: 0 });

      expect(response.headers()["x-correlation-id"]).toMatch(/^[0-9a-f-]{36}$/);
    });
  }

  test("keeps a safe caller id", async ({ request }) => {
    const response = await request.get("/en", {
      headers: { "X-Correlation-ID": "e2e-caller.1" },
    });

    expect(response.headers()["x-correlation-id"]).toBe("e2e-caller.1");
  });
});

test.describe("not found", () => {
  test("a path outside a locale shows the global 404", async ({ request }) => {
    const response = await request.get("/missing.txt");

    expect(response.status()).toBe(404);
  });

  test("an unknown page inside a locale answers 404", async ({ page }) => {
    const response = await page.goto("/en/does-not-exist");

    expect(response?.status()).toBe(404);
  });
});
