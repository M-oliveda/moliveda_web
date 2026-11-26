// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { proxy as Proxy } from "@/proxy";

const SECRET = "c".repeat(32);

async function loadProxy(): Promise<typeof Proxy> {
  vi.resetModules();
  const { proxy } = await import("@/proxy");
  return proxy;
}

function requestTo(path: string, headers?: HeadersInit): NextRequest {
  return new NextRequest(`https://example.test${path}`, {
    ...(headers === undefined ? {} : { headers }),
  });
}

describe("proxy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("continues outside production", async () => {
    vi.stubEnv("APP_ENV", "development");
    const proxy = await loadProxy();

    const response = proxy(requestTo("/"));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("refuses production requests without the origin header", async () => {
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("ORIGIN_VERIFY_SECRET", SECRET);
    const proxy = await loadProxy();

    expect(proxy(requestTo("/")).status).toBe(403);
  });

  it("continues production requests with the origin header", async () => {
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("ORIGIN_VERIFY_SECRET", SECRET);
    const proxy = await loadProxy();

    const response = proxy(requestTo("/", { "x-origin-verify": SECRET }));

    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});
