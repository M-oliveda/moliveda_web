import { NextResponse } from "next/server";

import { getEnv } from "@/lib/env";
import { guardOrigin } from "@/lib/origin-guard";

import type { NextRequest } from "next/server";

// No matcher: in production the origin guard covers every request, static
// files included (D34). Phase 3 adds next-intl after the guard.
export function proxy(request: NextRequest): Response {
  return guardOrigin(request, getEnv()) ?? NextResponse.next();
}
