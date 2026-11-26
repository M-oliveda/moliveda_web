// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { proxy as Proxy } from "@/proxy";

import type { NextResponse } from "next/server";

type ResponseCookie = NonNullable<ReturnType<NextResponse["cookies"]["get"]>>;

const SECRET = "c".repeat(32);

async function loadProxy(
  env: Record<string, string> = { APP_ENV: "local" }
): Promise<typeof Proxy> {
  for (const [key, value] of Object.entries(env)) {
    vi.stubEnv(key, value);
  }
  vi.resetModules();
  const { proxy } = await import("@/proxy");
  return proxy;
}

function requestTo(path: string, headers?: HeadersInit): NextRequest {
  return new NextRequest(`https://example.test${path}`, {
    ...(headers === undefined ? {} : { headers }),
  });
}

// The locale routes return a NextResponse; the guard's 403 is a plain Response.
function localeCookie(response: Response): ResponseCookie | undefined {
  return (response as NextResponse).cookies.get("NEXT_LOCALE");
}

// Next.js applies request header overrides from these response headers.
function forwardedHeader(response: Response, name: string): string | null {
  return response.headers.get(`x-middleware-request-${name}`);
}

describe("proxy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("origin guard", () => {
    it("refuses production requests without the origin header", async () => {
      const proxy = await loadProxy({
        APP_ENV: "production",
        ORIGIN_VERIFY_SECRET: SECRET,
      });

      const response = proxy(requestTo("/"));

      expect(response.status).toBe(403);
      expect(response.headers.get("location")).toBeNull();
    });

    it("guards static files too", async () => {
      const proxy = await loadProxy({
        APP_ENV: "production",
        ORIGIN_VERIFY_SECRET: SECRET,
      });

      expect(proxy(requestTo("/icon.svg")).status).toBe(403);
    });

    it("routes production requests with the origin header", async () => {
      const proxy = await loadProxy({
        APP_ENV: "production",
        ORIGIN_VERIFY_SECRET: SECRET,
      });

      const response = proxy(requestTo("/", { "x-origin-verify": SECRET }));

      expect(response.status).toBe(307);
    });
  });

  describe("locale negotiation on /", () => {
    it.each([
      ["en-US,en;q=0.9", "/en"],
      ["es-AR,es;q=0.9", "/es"],
      ["pt-BR,pt;q=0.9", "/pt"],
      ["fr-FR,fr;q=0.9", "/fr"],
      ["de-DE,de;q=0.9", "/en"],
      ["de-DE,fr;q=0.5", "/fr"],
    ])("redirects Accept-Language %s to %s", async (language, target) => {
      const proxy = await loadProxy();

      const response = proxy(requestTo("/", { "accept-language": language }));

      expect(response.status).toBe(307);
      expect(new URL(response.headers.get("location") ?? "").pathname).toBe(
        target
      );
    });

    it("falls back to English without Accept-Language", async () => {
      const proxy = await loadProxy();

      const response = proxy(requestTo("/"));

      expect(new URL(response.headers.get("location") ?? "").pathname).toBe(
        "/en"
      );
    });

    it("prefers the NEXT_LOCALE cookie over Accept-Language", async () => {
      const proxy = await loadProxy();

      const response = proxy(
        requestTo("/", {
          "accept-language": "es",
          cookie: "NEXT_LOCALE=fr",
        })
      );

      expect(new URL(response.headers.get("location") ?? "").pathname).toBe(
        "/fr"
      );
    });

    it("marks the redirect private and varying per visitor", async () => {
      const proxy = await loadProxy();

      const response = proxy(requestTo("/", { "accept-language": "pt" }));

      expect(response.headers.get("vary")).toBe("Accept-Language, Cookie");
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    });

    it("prefixes other unprefixed pages the same way", async () => {
      const proxy = await loadProxy();

      const response = proxy(
        requestTo("/experience", { "accept-language": "es" })
      );

      expect(response.status).toBe(307);
      expect(new URL(response.headers.get("location") ?? "").pathname).toBe(
        "/es/experience"
      );
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    });

    it("sends no hreflang Link header", async () => {
      const proxy = await loadProxy();

      expect(proxy(requestTo("/en")).headers.get("link")).toBeNull();
    });
  });

  describe("locale pages", () => {
    it("serves a prefixed page without a redirect", async () => {
      const proxy = await loadProxy();

      const response = proxy(requestTo("/es"));

      expect(response.status).toBe(200);
      expect(response.headers.get("x-middleware-next")).toBe("1");
      expect(response.headers.get("vary")).not.toBe("Accept-Language, Cookie");
    });

    it("updates the cookie when the visitor opens another locale", async () => {
      const proxy = await loadProxy();

      const response = proxy(requestTo("/pt", { cookie: "NEXT_LOCALE=en" }));
      const cookie = localeCookie(response);

      expect(cookie).toMatchObject({
        value: "pt",
        path: "/",
        sameSite: "lax",
        maxAge: 31_536_000,
      });
      expect(cookie?.secure).not.toBe(true);
    });

    it.each(["development", "preview", "staging"])(
      "marks the cookie Secure on %s",
      async (appEnv) => {
        const proxy = await loadProxy({ APP_ENV: appEnv });

        const response = proxy(requestTo("/fr", { cookie: "NEXT_LOCALE=en" }));

        expect(localeCookie(response)).toMatchObject({
          value: "fr",
          secure: true,
        });
      }
    );

    it("sets no cookie when nothing changed", async () => {
      const proxy = await loadProxy({ APP_ENV: "staging" });

      const response = proxy(requestTo("/en", { cookie: "NEXT_LOCALE=en" }));

      expect(localeCookie(response)).toBeUndefined();
    });
  });

  describe("unlocalized paths", () => {
    it.each([
      "/api/v1/contact",
      "/health",
      "/ready",
      "/_next/static/chunk.js",
      "/.well-known/security.txt",
      "/icon.svg",
      "/en/file.pdf",
    ])("passes %s through untouched", async (path) => {
      const proxy = await loadProxy();

      const response = proxy(requestTo(path, { "accept-language": "fr" }));

      expect(response.status).toBe(200);
      expect(response.headers.get("x-middleware-next")).toBe("1");
      expect(response.headers.get("location")).toBeNull();
    });
  });

  describe("correlation id", () => {
    it("keeps a safe caller id and forwards it", async () => {
      const proxy = await loadProxy();

      const response = proxy(
        requestTo("/health", { "x-correlation-id": "caller-id.1" })
      );

      expect(response.headers.get("x-correlation-id")).toBe("caller-id.1");
      expect(forwardedHeader(response, "x-correlation-id")).toBe("caller-id.1");
    });

    it("replaces an unsafe caller id", async () => {
      const proxy = await loadProxy();

      const response = proxy(
        requestTo("/health", { "x-correlation-id": "bad id" })
      );
      const id = response.headers.get("x-correlation-id");

      expect(id).not.toBe("bad id");
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("forwards the id to locale pages too", async () => {
      const proxy = await loadProxy();

      const response = proxy(requestTo("/en", { "x-correlation-id": "abc" }));

      expect(response.headers.get("x-correlation-id")).toBe("abc");
      expect(forwardedHeader(response, "x-correlation-id")).toBe("abc");
    });

    it("returns the id on redirects", async () => {
      const proxy = await loadProxy();

      const response = proxy(requestTo("/", { "x-correlation-id": "abc" }));

      expect(response.status).toBe(307);
      expect(response.headers.get("x-correlation-id")).toBe("abc");
    });
  });
});

describe("isLocalizedPath", () => {
  it.each([
    ["/", true],
    ["/en", true],
    ["/en/experience", true],
    ["/apis", true],
    ["/healthy", true],
    ["/api", false],
    ["/api/v1/contact", false],
    ["/health", false],
    ["/ready", false],
    ["/_next/image", false],
    ["/.well-known/security.txt", false],
    ["/robots.txt", false],
    ["/en/cv/resume.pdf", false],
  ])("%s -> %s", async (path, expected) => {
    const { isLocalizedPath } = await import("@/proxy");

    expect(isLocalizedPath(path)).toBe(expected);
  });
});
