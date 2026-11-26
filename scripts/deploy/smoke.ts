/**
 * Post-deploy smoke test (MASTERPLAN 10.2 step 6). Gated environments: the probes answer
 * without credentials, `/` answers 401 without them and 200 with them, and every response
 * carries `X-Robots-Tag`. Production candidate: the probes answer, and `/` answers 403 without
 * the origin header and 200 with it. Phase 3 changes the production `/` to 307 (locale
 * redirect); the checks through `https://moliveda.dev` are added in Phase 7.
 *
 *   node scripts/deploy/smoke.ts <gated|production> <base URL>
 *
 * Credentials and the origin secret come from `process.env` and are never printed.
 */
export type SmokeMode = "gated" | "production";

export interface ISmokeCheck {
  readonly name: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly expectStatus: number;
  /** A response header that must contain this value (case-insensitive). */
  readonly expectHeader?: { readonly name: string; readonly contains: string };
}

export interface ISmokeResult {
  readonly check: ISmokeCheck;
  readonly ok: boolean;
  readonly detail: string;
}

export interface ISmokeSecrets {
  readonly basicAuthUsername?: string | undefined;
  readonly basicAuthPassword?: string | undefined;
  readonly originSecret?: string | undefined;
}

export interface ISmokeOptions {
  readonly fetch: typeof fetch;
  readonly attempts: number;
  readonly delayMs: number;
  readonly sleep: (ms: number) => Promise<void>;
}

/** Thrown when the smoke test cannot run at all (bad arguments or missing secrets). */
export class SmokeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SmokeConfigError";
  }
}

const NOINDEX = { name: "x-robots-tag", contains: "noindex" } as const;

function probes(): ISmokeCheck[] {
  return ["/health", "/ready"].map((path) => ({
    name: `${path} answers`,
    path,
    headers: {},
    expectStatus: 200,
  }));
}

export function smokeChecks(
  mode: SmokeMode,
  secrets: ISmokeSecrets
): ISmokeCheck[] {
  if (mode === "gated") {
    const { basicAuthUsername, basicAuthPassword } = secrets;
    if (!basicAuthUsername || !basicAuthPassword) {
      throw new SmokeConfigError(
        "BASIC_AUTH_USERNAME and BASIC_AUTH_PASSWORD are required"
      );
    }
    const authorization = `Basic ${Buffer.from(
      `${basicAuthUsername}:${basicAuthPassword}`
    ).toString("base64")}`;
    return [
      ...probes().map((check) => ({ ...check, expectHeader: NOINDEX })),
      {
        name: "/ asks for credentials",
        path: "/",
        headers: {},
        expectStatus: 401,
        expectHeader: NOINDEX,
      },
      {
        name: "/ is served with credentials",
        path: "/",
        headers: { authorization },
        expectStatus: 200,
        expectHeader: NOINDEX,
      },
    ];
  }
  if (!secrets.originSecret) {
    throw new SmokeConfigError("ORIGIN_VERIFY_SECRET is required");
  }
  return [
    ...probes(),
    {
      name: "/ is refused without the origin header",
      path: "/",
      headers: {},
      expectStatus: 403,
    },
    {
      name: "/ is served with the origin header",
      path: "/",
      headers: { "x-origin-verify": secrets.originSecret },
      expectStatus: 200,
    },
  ];
}

function evaluate(check: ISmokeCheck, response: Response): ISmokeResult {
  if (response.status !== check.expectStatus) {
    return {
      check,
      ok: false,
      detail: `status ${String(response.status)}, expected ${String(check.expectStatus)}`,
    };
  }
  if (check.expectHeader) {
    const value = response.headers.get(check.expectHeader.name) ?? "";
    if (!value.toLowerCase().includes(check.expectHeader.contains)) {
      return {
        check,
        ok: false,
        detail: `header ${check.expectHeader.name} lacks "${check.expectHeader.contains}"`,
      };
    }
  }
  return { check, ok: true, detail: `status ${String(response.status)}` };
}

/**
 * Runs each check, retrying a failing one (cold starts, a revision that is still becoming
 * ready) up to `attempts` times. Redirects are never followed.
 */
export async function runChecks(
  baseUrl: string,
  checks: readonly ISmokeCheck[],
  options: ISmokeOptions
): Promise<ISmokeResult[]> {
  const results: ISmokeResult[] = [];
  for (const check of checks) {
    let result: ISmokeResult = { check, ok: false, detail: "not run" };
    for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
      try {
        const response = await options.fetch(new URL(check.path, baseUrl), {
          headers: check.headers,
          redirect: "manual",
          cache: "no-store",
        });
        result = evaluate(check, response);
      } catch (error) {
        result = {
          check,
          ok: false,
          detail: error instanceof Error ? error.name : "request failed",
        };
      }
      if (result.ok) {
        break;
      }
      if (attempt < options.attempts) {
        await options.sleep(options.delayMs);
      }
    }
    results.push(result);
  }
  return results;
}

export function formatResult(result: ISmokeResult): string {
  return `${result.ok ? "ok  " : "FAIL"} GET ${result.check.path}: ${result.check.name} (${result.detail})`;
}

export function parseArguments(args: readonly string[]): {
  readonly mode: SmokeMode;
  readonly baseUrl: string;
} {
  const [mode, baseUrl] = args;
  if ((mode !== "gated" && mode !== "production") || !baseUrl) {
    throw new SmokeConfigError(
      "usage: node scripts/deploy/smoke.ts <gated|production> <base URL>"
    );
  }
  if (!/^https:\/\/[a-z0-9.-]+\.run\.app$/.test(baseUrl)) {
    throw new SmokeConfigError("the base URL must be an https run.app URL");
  }
  return { mode, baseUrl };
}

async function main(): Promise<void> {
  const { mode, baseUrl } = parseArguments(process.argv.slice(2));
  const checks = smokeChecks(mode, {
    basicAuthUsername: process.env.BASIC_AUTH_USERNAME,
    basicAuthPassword: process.env.BASIC_AUTH_PASSWORD,
    originSecret: process.env.ORIGIN_VERIFY_SECRET,
  });
  const results = await runChecks(baseUrl, checks, {
    fetch,
    attempts: 10,
    delayMs: 3000,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
  for (const result of results) {
    (result.ok ? console.warn : console.error)(formatResult(result));
  }
  if (results.some((result) => !result.ok)) {
    console.error(`Smoke test failed for ${baseUrl}`);
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  await main();
}
