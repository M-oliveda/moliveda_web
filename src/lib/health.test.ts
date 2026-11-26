// @vitest-environment node
import { describe, expect, it } from "vitest";

import { createHealthResponse } from "@/lib/health";

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
