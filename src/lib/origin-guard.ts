import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

import type { IEnv } from "@/lib/env";

/**
 * Origin guard (D34, MASTERPLAN 4.8). In production, Cloudflare adds
 * `X-Origin-Verify` to every proxied request; anything without a matching value
 * reached Google's front end directly and is refused. Never log this header.
 */
export const ORIGIN_VERIFY_HEADER = "x-origin-verify";

/** Probes stay reachable for Cloud Run, the smoke tests and the uptime checks. */
export const PROBE_PATHS: ReadonlySet<string> = new Set(["/health", "/ready"]);

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/**
 * Constant-time check of `received` against every accepted secret. Hashing
 * first gives equal-length inputs to `timingSafeEqual`, and every secret is
 * compared so the timing does not reveal which one matched.
 */
export function isOriginSecretValid(
  received: string | null,
  accepted: readonly string[]
): boolean {
  if (received === null || received === "") {
    return false;
  }
  const receivedDigest = digest(received);
  let valid = false;
  for (const secret of accepted) {
    valid = timingSafeEqual(receivedDigest, digest(secret)) || valid;
  }
  return valid;
}

/**
 * Returns the `403` to send, or `null` when the request may continue: outside
 * production, on the probes, or with a valid header.
 */
export function guardOrigin(
  request: Request,
  env: Pick<IEnv, "APP_ENV" | "ORIGIN_VERIFY_SECRETS">
): Response | null {
  if (env.APP_ENV !== "production") {
    return null;
  }
  if (PROBE_PATHS.has(new URL(request.url).pathname)) {
    return null;
  }
  const received = request.headers.get(ORIGIN_VERIFY_HEADER);
  if (isOriginSecretValid(received, env.ORIGIN_VERIFY_SECRETS)) {
    return null;
  }
  return new Response(null, {
    status: 403,
    headers: { "Cache-Control": "no-store" },
  });
}
