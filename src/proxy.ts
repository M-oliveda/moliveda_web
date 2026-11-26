import { NextRequest, NextResponse } from "next/server";
import createMiddleware from "next-intl/middleware";

import { LOCALE_COOKIE_NAME, routing } from "@/i18n/routing";
import {
  CORRELATION_ID_HEADER,
  resolveCorrelationId,
} from "@/lib/correlation-id";
import { getEnv } from "@/lib/env";
import type { IEnv } from "@/lib/env";
import { guardOrigin } from "@/lib/origin-guard";

const handleI18nRouting = createMiddleware(routing);

// Paths next-intl must not touch (MASTERPLAN 4.1). The proxy has no matcher,
// so the origin guard still covers every request, static files included (D34).
const UNLOCALIZED_PREFIXES = [
  "/api",
  "/health",
  "/ready",
  "/_next",
  "/.well-known",
] as const;

/** True for page paths; false for APIs, probes, Next.js assets and files. */
export function isLocalizedPath(pathname: string): boolean {
  const excluded = UNLOCALIZED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
  if (excluded) {
    return false;
  }
  const lastSegment = pathname.slice(pathname.lastIndexOf("/") + 1);
  return !lastSegment.includes(".");
}

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}

// A locale redirect depends on the visitor's cookie and `Accept-Language`, so
// no shared cache (Cloudflare included) may store it (MASTERPLAN 4.1).
function markRedirectPrivate(response: NextResponse): void {
  response.headers.set("Vary", "Accept-Language, Cookie");
  response.headers.set("Cache-Control", "private, no-store");
}

// The routing config is shared with the browser, which cannot know `APP_ENV`,
// so `Secure` is added here for every deployed environment.
function secureLocaleCookie(response: NextResponse, env: IEnv): void {
  const cookie = response.cookies.get(LOCALE_COOKIE_NAME);
  if (cookie !== undefined && env.APP_ENV !== "local") {
    response.cookies.set({ ...cookie, secure: true });
  }
}

export function proxy(request: NextRequest): Response {
  const env = getEnv();
  const refused = guardOrigin(request, env);
  if (refused !== null) {
    return refused;
  }

  // Forward the id to route handlers and return it to the caller (4.10).
  const correlationId = resolveCorrelationId(request.headers);
  const headers = new Headers(request.headers);
  headers.set(CORRELATION_ID_HEADER, correlationId);

  let response: NextResponse;
  if (isLocalizedPath(request.nextUrl.pathname)) {
    // next-intl forwards the headers of the request it receives.
    response = handleI18nRouting(new NextRequest(request, { headers }));
    if (isRedirect(response.status)) {
      markRedirectPrivate(response);
    }
    secureLocaleCookie(response, env);
  } else {
    response = NextResponse.next({ request: { headers } });
  }

  response.headers.set(CORRELATION_ID_HEADER, correlationId);
  return response;
}
