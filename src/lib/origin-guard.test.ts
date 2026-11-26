// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  guardOrigin,
  isOriginSecretValid,
  ORIGIN_VERIFY_HEADER,
} from "@/lib/origin-guard";

const CURRENT_SECRET = "c".repeat(32);
const PREVIOUS_SECRET = "p".repeat(32);
const PRODUCTION = {
  APP_ENV: "production",
  ORIGIN_VERIFY_SECRETS: [CURRENT_SECRET, PREVIOUS_SECRET],
} as const;

function requestTo(path: string, secret?: string): Request {
  const headers = new Headers();
  if (secret !== undefined) {
    headers.set(ORIGIN_VERIFY_HEADER, secret);
  }
  return new Request(`https://example.test${path}`, { headers });
}

describe("isOriginSecretValid", () => {
  it.each([
    ["the current secret", CURRENT_SECRET, true],
    ["the previous secret", PREVIOUS_SECRET, true],
    ["a wrong secret", "w".repeat(32), false],
    ["a prefix of the secret", CURRENT_SECRET.slice(0, 16), false],
    ["the secret with extra characters", `${CURRENT_SECRET}x`, false],
    ["an empty value", "", false],
    ["no header", null, false],
  ])("returns the right answer for %s", (_label, received, expected) => {
    expect(
      isOriginSecretValid(received, [CURRENT_SECRET, PREVIOUS_SECRET])
    ).toBe(expected);
  });

  it("refuses everything when no secret is accepted", () => {
    expect(isOriginSecretValid(CURRENT_SECRET, [])).toBe(false);
  });
});

describe("guardOrigin", () => {
  it.each(["local", "development", "preview", "staging"] as const)(
    "lets every request through on %s",
    (appEnv) => {
      const env = { APP_ENV: appEnv, ORIGIN_VERIFY_SECRETS: [] };

      expect(guardOrigin(requestTo("/"), env)).toBeNull();
    }
  );

  it.each(["/health", "/ready"])(
    "exempts the %s probe in production",
    (path) => {
      expect(guardOrigin(requestTo(path), PRODUCTION)).toBeNull();
    }
  );

  it.each([
    ["the current secret", CURRENT_SECRET],
    ["the previous secret", PREVIOUS_SECRET],
  ])("lets production requests with %s through", (_label, secret) => {
    expect(guardOrigin(requestTo("/en", secret), PRODUCTION)).toBeNull();
  });

  it.each([
    ["no header", undefined],
    ["a wrong secret", "w".repeat(32)],
  ])("answers 403 without a body for %s", async (_label, secret) => {
    const response = guardOrigin(requestTo("/en", secret), PRODUCTION);

    expect(response?.status).toBe(403);
    expect(response?.headers.get("Cache-Control")).toBe("no-store");
    expect(await response?.text()).toBe("");
  });

  it.each(["/health/", "/healthz", "/_next/static/chunk.js"])(
    "does not exempt %s",
    (path) => {
      expect(guardOrigin(requestTo(path), PRODUCTION)?.status).toBe(403);
    }
  );
});
