import "server-only";

import { z } from "@/lib/zod";

/**
 * Validated configuration (MASTERPLAN 4.7). Phase 2 added the keys the deploys
 * need (environment and origin guard), Phase 3 the logging keys; later phases
 * add theirs here.
 */
export const APP_ENVS = [
  "local",
  "development",
  "preview",
  "staging",
  "production",
] as const;

export type AppEnv = (typeof APP_ENVS)[number];

/** Pino levels the service accepts (README, "Environment variables"). */
export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

/** Shortest accepted origin secret, in bytes (README, "Environment variables"). */
export const MIN_ORIGIN_SECRET_BYTES = 32;

export interface IEnv {
  readonly APP_ENV: AppEnv;
  /**
   * Accepted `X-Origin-Verify` values in production: the current secret, then
   * the previous one while rotating. Always empty outside production.
   */
  readonly ORIGIN_VERIFY_SECRETS: readonly string[];
  readonly LOG_LEVEL: LogLevel;
  /**
   * Google Cloud project that hosts the service. Builds the Cloud Logging trace
   * field (`projects/<id>/traces/<trace>`); without it the field is omitted.
   */
  readonly GCP_PROJECT_ID: string | undefined;
}

/** Thrown when the environment is invalid. Lists key names only, never values. */
export class EnvValidationError extends Error {
  readonly keys: readonly string[];

  constructor(keys: readonly string[]) {
    super(`Invalid environment variables: ${keys.join(", ")}`);
    this.name = "EnvValidationError";
    this.keys = keys;
  }
}

// Empty strings count as unset.
function emptyAsUnset(value: unknown): unknown {
  return value === "" ? undefined : value;
}

const ORIGIN_SECRET = z
  .string()
  .refine((value) => Buffer.byteLength(value) >= MIN_ORIGIN_SECRET_BYTES);

// Google Cloud project id rules: 6 to 30 characters, lowercase letters, digits
// and hyphens, starting with a letter and not ending with a hyphen.
const GCP_PROJECT_ID = z.string().regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/);

const ENV_SCHEMA = z
  .object({
    // Required everywhere: a deployed service must never fall back to local.
    APP_ENV: z.preprocess(emptyAsUnset, z.enum(APP_ENVS)),
    ORIGIN_VERIFY_SECRET: z.preprocess(emptyAsUnset, ORIGIN_SECRET.optional()),
    ORIGIN_VERIFY_SECRET_PREVIOUS: z.preprocess(
      emptyAsUnset,
      ORIGIN_SECRET.optional()
    ),
    LOG_LEVEL: z.preprocess(emptyAsUnset, z.enum(LOG_LEVELS).default("info")),
    GCP_PROJECT_ID: z.preprocess(emptyAsUnset, GCP_PROJECT_ID.optional()),
  })
  .superRefine((env, context) => {
    if (
      env.APP_ENV === "production" &&
      env.ORIGIN_VERIFY_SECRET === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["ORIGIN_VERIFY_SECRET"],
        message: "required in production",
      });
    }
  });

/** Pure: validates `source` and returns the typed configuration. */
export function parseEnv(source: Readonly<Record<string, unknown>>): IEnv {
  const result = ENV_SCHEMA.safeParse(source);
  if (!result.success) {
    const keys = new Set(
      result.error.issues.map((issue) => String(issue.path[0]))
    );
    throw new EnvValidationError([...keys].sort());
  }

  const env = result.data;
  const secrets =
    env.APP_ENV === "production"
      ? [env.ORIGIN_VERIFY_SECRET, env.ORIGIN_VERIFY_SECRET_PREVIOUS].filter(
          (secret): secret is string => secret !== undefined
        )
      : [];

  return {
    APP_ENV: env.APP_ENV,
    ORIGIN_VERIFY_SECRETS: secrets,
    LOG_LEVEL: env.LOG_LEVEL,
    GCP_PROJECT_ID: env.GCP_PROJECT_ID,
  };
}

let cached: IEnv | undefined;

/** Reads `process.env` once and caches the result. Throws `EnvValidationError`. */
export function getEnv(): IEnv {
  cached ??= parseEnv(process.env);
  return cached;
}
