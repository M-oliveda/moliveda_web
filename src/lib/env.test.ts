// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EnvValidationError,
  MIN_ORIGIN_SECRET_BYTES,
  parseEnv,
} from "@/lib/env";

const CURRENT_SECRET = "c".repeat(MIN_ORIGIN_SECRET_BYTES);
const PREVIOUS_SECRET = "p".repeat(MIN_ORIGIN_SECRET_BYTES);

function captureError(run: () => unknown): EnvValidationError {
  try {
    run();
  } catch (error) {
    if (error instanceof EnvValidationError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected an EnvValidationError");
}

describe("parseEnv", () => {
  it.each(["local", "development", "preview", "staging"] as const)(
    "accepts APP_ENV=%s without origin secrets",
    (appEnv) => {
      expect(parseEnv({ APP_ENV: appEnv })).toStrictEqual({
        APP_ENV: appEnv,
        ORIGIN_VERIFY_SECRETS: [],
      });
    }
  );

  it("ignores origin secrets outside production", () => {
    const env = parseEnv({
      APP_ENV: "staging",
      ORIGIN_VERIFY_SECRET: CURRENT_SECRET,
    });

    expect(env.ORIGIN_VERIFY_SECRETS).toStrictEqual([]);
  });

  it("accepts production with the current secret", () => {
    const env = parseEnv({
      APP_ENV: "production",
      ORIGIN_VERIFY_SECRET: CURRENT_SECRET,
    });

    expect(env).toStrictEqual({
      APP_ENV: "production",
      ORIGIN_VERIFY_SECRETS: [CURRENT_SECRET],
    });
  });

  it("accepts the previous secret while rotating, current first", () => {
    const env = parseEnv({
      APP_ENV: "production",
      ORIGIN_VERIFY_SECRET: CURRENT_SECRET,
      ORIGIN_VERIFY_SECRET_PREVIOUS: PREVIOUS_SECRET,
    });

    expect(env.ORIGIN_VERIFY_SECRETS).toStrictEqual([
      CURRENT_SECRET,
      PREVIOUS_SECRET,
    ]);
  });

  it("treats an empty previous secret as unset", () => {
    const env = parseEnv({
      APP_ENV: "production",
      ORIGIN_VERIFY_SECRET: CURRENT_SECRET,
      ORIGIN_VERIFY_SECRET_PREVIOUS: "",
    });

    expect(env.ORIGIN_VERIFY_SECRETS).toStrictEqual([CURRENT_SECRET]);
  });

  it.each([
    ["missing", {}],
    ["empty", { APP_ENV: "" }],
    ["unknown", { APP_ENV: "qa" }],
  ])("rejects a %s APP_ENV", (_label, source) => {
    expect(captureError(() => parseEnv(source)).keys).toStrictEqual([
      "APP_ENV",
    ]);
  });

  it.each([
    ["missing", {}],
    ["empty", { ORIGIN_VERIFY_SECRET: "" }],
  ])("rejects production with a %s origin secret", (_label, extra) => {
    const error = captureError(() =>
      parseEnv({ APP_ENV: "production", ...extra })
    );

    expect(error.keys).toStrictEqual(["ORIGIN_VERIFY_SECRET"]);
  });

  it("rejects secrets shorter than the minimum", () => {
    const short = "s".repeat(MIN_ORIGIN_SECRET_BYTES - 1);
    const error = captureError(() =>
      parseEnv({
        APP_ENV: "production",
        ORIGIN_VERIFY_SECRET: short,
        ORIGIN_VERIFY_SECRET_PREVIOUS: short,
      })
    );

    expect(error.keys).toStrictEqual([
      "ORIGIN_VERIFY_SECRET",
      "ORIGIN_VERIFY_SECRET_PREVIOUS",
    ]);
  });

  it("names the failing keys without leaking values", () => {
    const short = "leaky-value";
    const error = captureError(() =>
      parseEnv({ APP_ENV: "production", ORIGIN_VERIFY_SECRET: short })
    );

    expect(error.name).toBe("EnvValidationError");
    expect(error.message).toBe(
      "Invalid environment variables: ORIGIN_VERIFY_SECRET"
    );
    expect(error.message).not.toContain(short);
  });
});

describe("getEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("reads process.env once and caches the result", async () => {
    vi.stubEnv("APP_ENV", "development");
    const { getEnv } = await import("@/lib/env");

    const first = getEnv();
    vi.stubEnv("APP_ENV", "staging");

    expect(first.APP_ENV).toBe("development");
    expect(getEnv()).toBe(first);
  });

  it("throws EnvValidationError when process.env is invalid", async () => {
    vi.stubEnv("APP_ENV", "");
    const { getEnv, EnvValidationError: FreshError } =
      await import("@/lib/env");

    expect(() => getEnv()).toThrow(FreshError);
  });
});
