import "server-only";

import { getEnv } from "@/lib/env";

export interface IHealthStatus {
  readonly status: "ok";
}

export interface IReadinessStatus {
  readonly status: "ready" | "unavailable";
}

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * Liveness response for `GET /health` (MASTERPLAN 4.10): no dependency checks,
 * never cached.
 */
export function createHealthResponse(): Response {
  const body: IHealthStatus = { status: "ok" };
  return Response.json(body, { status: 200, headers: NO_STORE });
}

/**
 * Readiness response for `GET /ready`: `200` when the configuration is valid,
 * otherwise `503`. Phase 5 adds the email driver check. Never calls a provider.
 */
export function createReadinessResponse(
  readEnv: () => unknown = getEnv
): Response {
  let ready: boolean;
  try {
    readEnv();
    ready = true;
  } catch {
    ready = false;
  }
  const body: IReadinessStatus = { status: ready ? "ready" : "unavailable" };
  return Response.json(body, {
    status: ready ? 200 : 503,
    headers: NO_STORE,
  });
}
