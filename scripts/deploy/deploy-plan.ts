/**
 * Deploy plan for `build-push-deploy.yml` (MASTERPLAN 10.1, 10.2 and 10.4): service and
 * revision names, image tags and URLs, derived from the workflow's environment variables.
 *
 *   node scripts/deploy/deploy-plan.ts   # appends the plan to $GITHUB_OUTPUT
 *
 * The functions are pure and tested; `main` only reads `process.env` and writes the output.
 */
import { appendFile } from "node:fs/promises";

export const DEPLOY_ENVIRONMENTS = [
  "development",
  "preview",
  "staging",
  "production",
] as const;

export type DeployEnvironment = (typeof DEPLOY_ENVIRONMENTS)[number];

export const SERVICE_NAME = "moliveda-web";

/** Cloud Run settings per environment (10.1). */
export interface IEnvironmentSettings {
  readonly gated: boolean;
  readonly minInstances: number;
  readonly maxInstances: number;
}

export const ENVIRONMENT_SETTINGS: Readonly<
  Record<DeployEnvironment, IEnvironmentSettings>
> = {
  development: { gated: true, minInstances: 0, maxInstances: 2 },
  preview: { gated: true, minInstances: 0, maxInstances: 1 },
  staging: { gated: true, minInstances: 0, maxInstances: 2 },
  production: { gated: false, minInstances: 1, maxInstances: 3 },
};

/** The Cloud Run tag of the production candidate revision (10.2 step 5). */
export const CANDIDATE_TAG = "candidate";

export interface IDeployInput {
  readonly environment: DeployEnvironment;
  readonly sha: string;
  readonly prNumber: number | undefined;
  readonly projectNumber: string;
  readonly region: string;
  readonly runId: string;
  readonly runAttempt: string;
}

export interface IDeployPlan {
  readonly environment: DeployEnvironment;
  readonly gated: boolean;
  readonly minInstances: number;
  readonly maxInstances: number;
  readonly service: string;
  readonly revision: string;
  readonly appTag: string;
  readonly gateTag: string;
  readonly url: string;
  /** Only in production: the tag URL of the no-traffic candidate. */
  readonly candidateUrl: string | undefined;
}

/** Thrown for a missing or malformed input. Names the variable, never its value. */
export class DeployConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeployConfigError";
  }
}

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const DIGITS = /^[1-9][0-9]*$/;
const REGION_PATTERN = /^[a-z]+-[a-z]+[0-9]+$/;
// Cloud Run resource names: lowercase letters, digits and hyphens, at most 63 characters.
const MAX_NAME_LENGTH = 63;

function isDeployEnvironment(value: string): value is DeployEnvironment {
  return (DEPLOY_ENVIRONMENTS as readonly string[]).includes(value);
}

function required(
  source: Readonly<Record<string, string | undefined>>,
  name: string,
  pattern: RegExp
): string {
  const value = source[name] ?? "";
  if (!pattern.test(value)) {
    throw new DeployConfigError(`${name} is missing or malformed`);
  }
  return value;
}

/** Reads and validates the inputs from the workflow's environment. */
export function parseDeployInput(
  source: Readonly<Record<string, string | undefined>>
): IDeployInput {
  const environment = source.DEPLOY_ENVIRONMENT ?? "";
  if (!isDeployEnvironment(environment)) {
    throw new DeployConfigError("DEPLOY_ENVIRONMENT is missing or malformed");
  }
  const prNumber =
    environment === "preview"
      ? Number(required(source, "PR_NUMBER", DIGITS))
      : undefined;
  return {
    environment,
    sha: required(source, "GITHUB_SHA", SHA_PATTERN),
    prNumber,
    projectNumber: required(source, "GCP_PROJECT_NUMBER", DIGITS),
    region: required(source, "GCP_REGION", REGION_PATTERN),
    runId: required(source, "GITHUB_RUN_ID", DIGITS),
    runAttempt: required(source, "GITHUB_RUN_ATTEMPT", DIGITS),
  };
}

/** `moliveda-web`, or `moliveda-web-pr-<n>` for a preview. */
export function serviceName(
  environment: DeployEnvironment,
  prNumber: number | undefined
): string {
  return environment === "preview"
    ? `${SERVICE_NAME}-pr-${String(prNumber)}`
    : SERVICE_NAME;
}

/** The 12-character commit SHA used in image tags (10.4). */
export function shortSha(sha: string): string {
  return sha.slice(0, 12);
}

/** App image tag: `<environment>-<sha>`, or `pr-<n>-<sha>` for a preview (10.4). */
export function appImageTag(input: IDeployInput): string {
  return input.environment === "preview"
    ? `pr-${String(input.prNumber)}-${shortSha(input.sha)}`
    : `${input.environment}-${shortSha(input.sha)}`;
}

/** The `run.app` URL is deterministic, so it is known before the first deploy (10.2 step 2). */
export function serviceUrl(
  service: string,
  projectNumber: string,
  region: string,
  tag?: string
): string {
  const prefix = tag === undefined ? "" : `${tag}---`;
  return `https://${prefix}${service}-${projectNumber}.${region}.run.app`;
}

/** One revision per workflow run attempt, so a re-run never collides with an earlier deploy. */
export function revisionName(input: IDeployInput, service: string): string {
  const name = `${service}-${shortSha(input.sha)}-${input.runId}-${input.runAttempt}`;
  if (name.length > MAX_NAME_LENGTH) {
    throw new DeployConfigError(
      `revision name is longer than ${String(MAX_NAME_LENGTH)} characters`
    );
  }
  return name;
}

export function createDeployPlan(input: IDeployInput): IDeployPlan {
  const settings = ENVIRONMENT_SETTINGS[input.environment];
  const service = serviceName(input.environment, input.prNumber);
  return {
    environment: input.environment,
    ...settings,
    service,
    revision: revisionName(input, service),
    appTag: appImageTag(input),
    gateTag: shortSha(input.sha),
    url: serviceUrl(service, input.projectNumber, input.region),
    candidateUrl:
      input.environment === "production"
        ? serviceUrl(service, input.projectNumber, input.region, CANDIDATE_TAG)
        : undefined,
  };
}

/** `key=value` lines for `$GITHUB_OUTPUT`. None of the values are secret. */
export function formatOutputs(plan: IDeployPlan): string {
  const outputs: Record<string, string> = {
    environment: plan.environment,
    gated: String(plan.gated),
    service: plan.service,
    revision: plan.revision,
    app_tag: plan.appTag,
    gate_tag: plan.gateTag,
    url: plan.url,
    candidate_url: plan.candidateUrl ?? "",
  };
  return Object.entries(outputs)
    .map(([key, value]) => `${key}=${value}\n`)
    .join("");
}

async function main(): Promise<void> {
  const output = process.env.GITHUB_OUTPUT;
  if (output === undefined || output === "") {
    throw new DeployConfigError("GITHUB_OUTPUT is not set");
  }
  const plan = createDeployPlan(parseDeployInput(process.env));
  await appendFile(output, formatOutputs(plan));
  console.warn(formatOutputs(plan).trimEnd());
}

if (import.meta.main) {
  await main();
}
