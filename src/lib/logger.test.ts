// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  REDACTED,
  SERVICE_NAME,
  toSeverity,
  withRequestContext,
} from "@/lib/logger";
import { captureLogs } from "@/test/capture-logs";

describe("createLogger", () => {
  it("writes Cloud Logging fields", () => {
    const { logger, lines } = captureLogs({ env: "staging" });

    logger.info("hello");

    expect(lines).toHaveLength(1);
    const line = lines[0];
    expect(line).toMatchObject({
      severity: "INFO",
      message: "hello",
      service: SERVICE_NAME,
      env: "staging",
    });
    expect(line).not.toHaveProperty("level");
    expect(line).not.toHaveProperty("pid");
    expect(line).not.toHaveProperty("hostname");
    expect(typeof line?.time).toBe("string");
  });

  it.each([
    ["debug", "DEBUG"],
    ["info", "INFO"],
    ["warn", "WARNING"],
    ["error", "ERROR"],
    ["fatal", "CRITICAL"],
  ] as const)("maps %s to severity %s", (method, severity) => {
    const { logger, lines } = captureLogs();

    logger[method]("x");

    expect(lines[0]?.severity).toBe(severity);
  });

  it("maps trace, below every accepted level, to DEBUG", () => {
    const { logger, lines } = captureLogs();
    logger.level = "trace";

    logger.trace("x");

    expect(lines[0]?.severity).toBe("DEBUG");
  });

  it("maps an unknown level label to DEFAULT", () => {
    expect(toSeverity("notice")).toBe("DEFAULT");
  });

  it("drops lines below the configured level", () => {
    const { logger, lines } = captureLogs({ level: "warn" });

    logger.info("quiet");
    logger.warn("loud");

    expect(lines.map((line) => line.message)).toStrictEqual(["loud"]);
  });

  it.each([
    ["authorization", { authorization: "Basic abc" }],
    ["cookie", { cookie: "NEXT_LOCALE=en" }],
    ["set-cookie", { "set-cookie": "a=b" }],
    ["x-origin-verify", { "x-origin-verify": "secret" }],
    ["email", { email: "visitor@example.test" }],
    ["replyTo", { replyTo: "visitor@example.test" }],
    ["body", { body: "message text" }],
    ["token", { token: "t" }],
    ["turnstileToken", { turnstileToken: "t" }],
    ["apiKey", { apiKey: "k" }],
    ["password", { password: "p" }],
    ["secret", { secret: "s" }],
  ])("redacts %s at every depth", (key, fields) => {
    const { logger, lines } = captureLogs();

    logger.info(fields, "top");
    logger.info({ headers: fields }, "nested");
    logger.info({ request: { headers: fields } }, "deep");

    const [top, nested, deep] = lines;
    expect(top?.[key]).toBe(REDACTED);
    expect((nested?.headers as Record<string, unknown>)[key]).toBe(REDACTED);
    expect(
      (
        (deep?.request as Record<string, unknown>).headers as Record<
          string,
          unknown
        >
      )[key]
    ).toBe(REDACTED);
  });

  it("keeps safe fields such as lengths and ids", () => {
    const { logger, lines } = captureLogs();

    logger.info({ messageLength: 42, submissionId: "id-1" }, "sent");

    expect(lines[0]).toMatchObject({ messageLength: 42, submissionId: "id-1" });
  });
});

describe("withRequestContext", () => {
  it("adds the correlation id and the trace", () => {
    const { logger, lines } = captureLogs();

    withRequestContext(logger, {
      correlationId: "abc",
      trace: "projects/p/traces/t",
    }).info("x");

    expect(lines[0]).toMatchObject({
      correlationId: "abc",
      "logging.googleapis.com/trace": "projects/p/traces/t",
    });
  });

  it("omits the trace when it is unknown", () => {
    const { logger, lines } = captureLogs();

    withRequestContext(logger, { correlationId: "abc" }).info("x");

    expect(lines[0]).toMatchObject({ correlationId: "abc" });
    expect(lines[0]).not.toHaveProperty("logging.googleapis.com/trace");
  });
});

describe("getLogger", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("is configured from the environment and cached", async () => {
    vi.stubEnv("APP_ENV", "development");
    vi.stubEnv("LOG_LEVEL", "warn");
    const { getLogger } = await import("@/lib/logger");

    const logger = getLogger();

    expect(logger.level).toBe("warn");
    expect(logger.bindings()).toMatchObject({ env: "development" });
    expect(getLogger()).toBe(logger);
  });
});
