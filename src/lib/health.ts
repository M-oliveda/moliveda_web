export interface IHealthStatus {
  readonly status: "ok";
}

/**
 * Liveness response for `GET /health` (MASTERPLAN 4.10): no dependency checks,
 * never cached. Readiness (`/ready`) is added in Phase 3.
 */
export function createHealthResponse(): Response {
  const body: IHealthStatus = { status: "ok" };
  return Response.json(body, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
