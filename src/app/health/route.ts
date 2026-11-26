import { connection } from "next/server";

import { createHealthResponse } from "@/lib/health";

// `connection()` keeps the probe out of the build-time prerender (Cache Components).
export async function GET(): Promise<Response> {
  await connection();
  return createHealthResponse();
}
