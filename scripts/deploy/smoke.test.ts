// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import {
  formatResult,
  parseArguments,
  runChecks,
  SmokeConfigError,
  smokeChecks,
} from "./smoke.ts";

import type { ISmokeOptions } from "./smoke.ts";

const BASE_URL = "https://moliveda-web-123.us-central1.run.app";
const CREDENTIALS = {
  basicAuthUsername: "reviewer",
  basicAuthPassword: "gate-password",
};
const ORIGIN_SECRET = "o".repeat(48);

type Handler = (url: URL, init: RequestInit) => Response;

/** A fake fetch that answers from `handler` and records each request. */
function fakeFetch(handler: Handler): {
  readonly fetch: typeof fetch;
  readonly requests: { url: string; init: RequestInit }[];
} {
  const requests: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(input instanceof Request ? input.url : input);
    requests.push({ url: url.toString(), init });
    return Promise.resolve(handler(url, init));
  };
  return { fetch: fetchImpl, requests };
}

function options(fetchImpl: typeof fetch, attempts = 3): ISmokeOptions {
  return {
    fetch: fetchImpl,
    attempts,
    delayMs: 5,
    sleep: vi.fn(() => Promise.resolve()),
  };
}

function header(init: RequestInit, name: string): string | undefined {
  return (init.headers as Record<string, string> | undefined)?.[name];
}

/** The app's locale routing: `/` redirects to `/en`, pages are served. */
function localizedApp(url: URL, headers: Record<string, string>): Response {
  if (url.pathname === "/") {
    return new Response(null, {
      status: 307,
      headers: { ...headers, Location: `${BASE_URL}/en` },
    });
  }
  return new Response(null, { status: 200, headers });
}

/** The gate as deployed: probes open, pages behind basic auth, noindex everywhere. */
function gate(url: URL, init: RequestInit): Response {
  const headers = { "X-Robots-Tag": "noindex, nofollow" };
  if (url.pathname === "/health" || url.pathname === "/ready") {
    return new Response("{}", { status: 200, headers });
  }
  if (header(init, "authorization") === undefined) {
    return new Response(null, { status: 401, headers });
  }
  return localizedApp(url, headers);
}

/** The production app behind the origin guard. */
function guardedApp(url: URL, init: RequestInit): Response {
  if (url.pathname === "/health" || url.pathname === "/ready") {
    return new Response("{}", { status: 200 });
  }
  if (header(init, "x-origin-verify") !== ORIGIN_SECRET) {
    return new Response(null, { status: 403 });
  }
  return localizedApp(url, {});
}

describe("smokeChecks", () => {
  it("checks the gate with and without credentials", () => {
    const checks = smokeChecks("gated", CREDENTIALS);

    expect(
      checks.map((check) => [check.path, check.expectStatus])
    ).toStrictEqual([
      ["/health", 200],
      ["/ready", 200],
      ["/", 401],
      ["/", 307],
      ["/en", 200],
    ]);
    expect(
      checks.every((check) => check.expectHeaders?.[0]?.contains === "noindex")
    ).toBe(true);
    const authorization = `Basic ${Buffer.from("reviewer:gate-password").toString("base64")}`;
    expect(checks[3]?.headers).toStrictEqual({
      authorization,
      "accept-language": "en",
    });
    expect(checks[3]?.expectHeaders?.[1]).toStrictEqual({
      name: "location",
      contains: "/en",
    });
    expect(checks[4]?.headers).toStrictEqual({ authorization });
  });

  it("checks the production origin guard", () => {
    const checks = smokeChecks("production", { originSecret: ORIGIN_SECRET });

    expect(
      checks.map((check) => [check.path, check.expectStatus])
    ).toStrictEqual([
      ["/health", 200],
      ["/ready", 200],
      ["/", 403],
      ["/", 307],
      ["/en", 200],
    ]);
    expect(checks[3]?.headers).toStrictEqual({
      "x-origin-verify": ORIGIN_SECRET,
      "accept-language": "en",
    });
    expect(checks[4]?.headers).toStrictEqual({
      "x-origin-verify": ORIGIN_SECRET,
    });
  });

  it.each([
    ["gated", {}],
    ["gated", { basicAuthUsername: "reviewer" }],
    ["production", {}],
  ] as const)("refuses to run %s without its secrets", (mode, secrets) => {
    expect(() => smokeChecks(mode, secrets)).toThrow(SmokeConfigError);
  });
});

describe("runChecks", () => {
  it("passes against a working gate and never follows redirects", async () => {
    const { fetch, requests } = fakeFetch(gate);

    const results = await runChecks(
      BASE_URL,
      smokeChecks("gated", CREDENTIALS),
      options(fetch)
    );

    expect(results.every((result) => result.ok)).toBe(true);
    expect(requests).toHaveLength(5);
    expect(requests.every(({ init }) => init.redirect === "manual")).toBe(true);
    expect(requests[0]?.url).toBe(`${BASE_URL}/health`);
  });

  it("passes against a guarded production candidate", async () => {
    const { fetch } = fakeFetch(guardedApp);

    const results = await runChecks(
      BASE_URL,
      smokeChecks("production", { originSecret: ORIGIN_SECRET }),
      options(fetch)
    );

    expect(results.map((result) => result.ok)).toStrictEqual([
      true,
      true,
      true,
      true,
      true,
    ]);
  });

  it("fails an open gate, a missing noindex header and an unguarded production", async () => {
    const open = await runChecks(
      BASE_URL,
      smokeChecks("gated", CREDENTIALS),
      options(fakeFetch(() => new Response(null, { status: 200 })).fetch, 1)
    );

    expect(open.map((result) => result.detail)).toStrictEqual([
      'header x-robots-tag lacks "noindex"',
      'header x-robots-tag lacks "noindex"',
      "status 200, expected 401",
      "status 200, expected 307",
      'header x-robots-tag lacks "noindex"',
    ]);

    const unguarded = await runChecks(
      BASE_URL,
      smokeChecks("production", { originSecret: ORIGIN_SECRET }),
      options(fakeFetch(() => new Response(null, { status: 200 })).fetch, 1)
    );

    expect(unguarded.map((result) => result.ok)).toStrictEqual([
      true,
      true,
      false,
      false,
      true,
    ]);
  });

  it("fails a redirect to the wrong locale", async () => {
    const { fetch } = fakeFetch(
      () =>
        new Response(null, {
          status: 307,
          headers: { Location: `${BASE_URL}/fr` },
        })
    );
    const [redirect] = smokeChecks("production", {
      originSecret: ORIGIN_SECRET,
    }).filter((check) => check.expectStatus === 307);

    const results = await runChecks(
      BASE_URL,
      redirect === undefined ? [] : [redirect],
      options(fetch, 1)
    );

    expect(results.map((result) => result.detail)).toStrictEqual([
      'header location lacks "/en"',
    ]);
  });

  it("retries a failing check until it passes", async () => {
    let calls = 0;
    const { fetch } = fakeFetch(() => {
      calls += 1;
      return new Response(null, { status: calls < 3 ? 503 : 200 });
    });
    const smokeOptions = options(fetch, 5);

    const [result] = await runChecks(
      BASE_URL,
      smokeChecks("production", { originSecret: ORIGIN_SECRET }).slice(0, 1),
      smokeOptions
    );

    expect(result?.ok).toBe(true);
    expect(calls).toBe(3);
    expect(smokeOptions.sleep).toHaveBeenCalledTimes(2);
  });

  it("reports network errors by name after the last attempt", async () => {
    const failing = (() =>
      Promise.reject(new TypeError("fetch failed"))) as typeof fetch;
    const smokeOptions = options(failing, 2);

    const [result] = await runChecks(
      BASE_URL,
      smokeChecks("production", { originSecret: ORIGIN_SECRET }).slice(0, 1),
      smokeOptions
    );

    expect(result).toMatchObject({ ok: false, detail: "TypeError" });
    expect(smokeOptions.sleep).toHaveBeenCalledTimes(1);

    const [other] = await runChecks(
      BASE_URL,
      smokeChecks("production", { originSecret: ORIGIN_SECRET }).slice(0, 1),
      options(() => Promise.reject(new Error("x")), 1)
    );
    expect(other?.detail).toBe("Error");

    const [thrown] = await runChecks(
      BASE_URL,
      smokeChecks("production", { originSecret: ORIGIN_SECRET }).slice(0, 1),
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a non-Error rejection
      options(() => Promise.reject("boom"), 1)
    );
    expect(thrown?.detail).toBe("request failed");
  });
});

describe("formatResult", () => {
  it("never prints the headers that were sent", async () => {
    const { fetch } = fakeFetch(gate);
    const results = await runChecks(
      BASE_URL,
      smokeChecks("gated", CREDENTIALS),
      options(fetch)
    );
    const lines = results.map(formatResult);

    expect(lines[3]).toBe(
      "ok   GET /: / redirects to a locale with credentials (status 307)"
    );
    expect(lines[4]).toBe(
      "ok   GET /en: /en is served with credentials (status 200)"
    );
    expect(lines.join("\n")).not.toContain("gate-password");
    expect(lines.join("\n")).not.toContain(
      Buffer.from("reviewer:gate-password").toString("base64")
    );
  });

  it("marks failures", () => {
    const [check] = smokeChecks("production", { originSecret: ORIGIN_SECRET });

    expect(
      formatResult({
        check: check!,
        ok: false,
        detail: "status 500, expected 200",
      })
    ).toBe("FAIL GET /health: /health answers (status 500, expected 200)");
  });
});

describe("parseArguments", () => {
  it("accepts a mode and a run.app URL", () => {
    expect(parseArguments(["gated", BASE_URL])).toStrictEqual({
      mode: "gated",
      baseUrl: BASE_URL,
    });
  });

  it.each([
    [[]],
    [["staging", BASE_URL]],
    [["gated"]],
    [["gated", "http://moliveda-web-123.us-central1.run.app"]],
    [["production", "https://moliveda.dev"]],
  ])("rejects %j", (args) => {
    expect(() => parseArguments(args)).toThrow(SmokeConfigError);
  });
});
