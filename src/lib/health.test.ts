// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { EnvValidationError } from "@/lib/env";
import { createHealthResponse, createReadinessResponse } from "@/lib/health";

describe("createHealthResponse", () => {
  it("answers 200 with an ok status", async () => {
    const response = createHealthResponse();

    expect(response.status).toBe(200);
    expect(await response.json()).toStrictEqual({ status: "ok" });
  });

  it("is never cached", () => {
    const response = createHealthResponse();

    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Type")).toContain("application/json");
  });
});

describe("createReadinessResponse", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("answers 200 when the configuration is valid", async () => {
    const response = createReadinessResponse(() => ({}));

    expect(response.status).toBe(200);
    expect(await response.json()).toStrictEqual({ status: "ready" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("answers 503 when the configuration is invalid", async () => {
    const response = createReadinessResponse(() => {
      throw new EnvValidationError(["APP_ENV"]);
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toStrictEqual({ status: "unavailable" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("reads process.env by default", () => {
    vi.stubEnv("APP_ENV", "local");

    expect(createReadinessResponse().status).toBe(200);
  });
});
