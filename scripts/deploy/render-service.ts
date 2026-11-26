/**
 * Renders the Cloud Run service manifest that `build-push-deploy.yml` applies with
 * `gcloud run services replace` (MASTERPLAN 10.1 and 10.2 step 4).
 *
 *   node scripts/deploy/render-service.ts <output.json>
 *
 * A manifest is used instead of `gcloud run deploy` flags because the gated services need a
 * startup probe on the app container and a start order, which the CLI cannot set for
 * multi-container services. JSON is valid YAML, so gcloud reads the file as is.
 *
 * Secrets are read from `process.env` and written only into the output file (mode 0600), never
 * onto a command line or into the logs. The workflow deletes the file after the deploy.
 */
import { writeFile } from "node:fs/promises";

import {
  CANDIDATE_TAG,
  createDeployPlan,
  DeployConfigError,
  parseDeployInput,
  SERVICE_NAME,
} from "./deploy-plan.ts";

import type { IDeployPlan } from "./deploy-plan.ts";

/** App variables passed through when set (README, "Environment variables"). */
export const APP_PASSTHROUGH_KEYS = [
  "LOG_LEVEL",
  "EMAIL_DRIVER",
  "CONTACT_FROM_EMAIL",
  "CONTACT_TO_EMAIL",
  "RESEND_API_KEY",
  "TURNSTILE_SECRET_KEY",
  "RATE_LIMIT_MAX_REQUESTS",
  "RATE_LIMIT_WINDOW_SECONDS",
] as const;

/** Production only (D34): never sent to a gated environment. */
export const ORIGIN_KEYS = [
  "ORIGIN_VERIFY_SECRET",
  "ORIGIN_VERIFY_SECRET_PREVIOUS",
] as const;

export const GATE_KEYS = [
  "BASIC_AUTH_USERNAME",
  "BASIC_AUTH_PASSWORD",
] as const;

// Behind the gate the app listens on 3000; alone it is the ingress container on 8080.
export const GATED_APP_PORT = 3000;
export const INGRESS_PORT = 8080;

export interface IRenderInput {
  readonly plan: IDeployPlan;
  readonly projectId: string;
  readonly appImage: string;
  readonly gateImage: string | undefined;
  /** Production only: the revision that keeps 100% of traffic until the candidate passes. */
  readonly currentRevision: string | undefined;
  readonly env: Readonly<Record<string, string | undefined>>;
}

export interface IEnvVar {
  readonly name: string;
  readonly value: string;
}

interface IProbe {
  readonly httpGet: { readonly path: string; readonly port: number };
  readonly periodSeconds: number;
  readonly timeoutSeconds: number;
  readonly failureThreshold: number;
}

export interface IContainer {
  readonly name: string;
  readonly image: string;
  readonly command?: readonly string[];
  readonly ports?: readonly { readonly containerPort: number }[];
  readonly env: readonly IEnvVar[];
  readonly resources: {
    readonly limits: { readonly cpu: string; readonly memory: string };
  };
  readonly startupProbe: IProbe;
}

export type TrafficTarget =
  | { readonly latestRevision: true; readonly percent: number }
  | {
      readonly revisionName: string;
      readonly percent?: number;
      readonly tag?: string;
    };

export interface IServiceManifest {
  readonly apiVersion: "serving.knative.dev/v1";
  readonly kind: "Service";
  readonly metadata: {
    readonly name: string;
    readonly labels: Readonly<Record<string, string>>;
    readonly annotations: Readonly<Record<string, string>>;
  };
  readonly spec: {
    readonly template: {
      readonly metadata: {
        readonly name: string;
        readonly labels: Readonly<Record<string, string>>;
        readonly annotations: Readonly<Record<string, string>>;
      };
      readonly spec: {
        readonly containerConcurrency: number;
        readonly timeoutSeconds: number;
        readonly serviceAccountName: string;
        readonly containers: readonly IContainer[];
      };
    };
    readonly traffic: readonly TrafficTarget[];
  };
}

const REVISION_NAME = /^[a-z0-9-]+$/;

function startupProbe(port: number): IProbe {
  // Up to 60 s for a cold start, checked every 2 s.
  return {
    httpGet: { path: "/health", port },
    periodSeconds: 2,
    timeoutSeconds: 1,
    failureThreshold: 30,
  };
}

function present(env: IRenderInput["env"], keys: readonly string[]): IEnvVar[] {
  return keys.flatMap((name) => {
    const value = env[name];
    return value === undefined || value === "" ? [] : [{ name, value }];
  });
}

/**
 * The image must be the one the plan names: this environment's Artifact Registry repository and
 * this run's tag (10.4). Cloud Run resolves the tag to a digest when it creates the revision,
 * and `verify-digests.ts` checks that digest against the one CI pushed.
 */
function requirePlannedImage(
  image: string | undefined,
  name: string,
  expected: string
): string {
  if (image !== expected) {
    throw new DeployConfigError(`${name} must be ${expected}`);
  }
  return expected;
}

/** The app container's variables. Origin secrets go to production only. */
export function appEnv(input: IRenderInput): IEnvVar[] {
  const vars: IEnvVar[] = [
    { name: "APP_ENV", value: input.plan.environment },
    ...present(input.env, APP_PASSTHROUGH_KEYS),
  ];
  if (input.plan.environment === "production") {
    const origin = present(input.env, ORIGIN_KEYS);
    if (!origin.some((entry) => entry.name === "ORIGIN_VERIFY_SECRET")) {
      throw new DeployConfigError(
        "ORIGIN_VERIFY_SECRET is required in production"
      );
    }
    vars.push(...origin);
  }
  return vars;
}

/** The gate's variables. Both credentials are required: the gate fails closed (8.1). */
export function gateEnv(input: IRenderInput): IEnvVar[] {
  const credentials = present(input.env, GATE_KEYS);
  if (credentials.length !== GATE_KEYS.length) {
    throw new DeployConfigError(
      "BASIC_AUTH_USERNAME and BASIC_AUTH_PASSWORD are required on gated environments"
    );
  }
  return [{ name: "APP_ENV", value: input.plan.environment }, ...credentials];
}

export function containers(input: IRenderInput): IContainer[] {
  const appImage = requirePlannedImage(
    input.appImage,
    "APP_IMAGE",
    input.plan.appImage
  );
  if (!input.plan.gated) {
    return [
      {
        name: "app",
        image: appImage,
        ports: [{ containerPort: INGRESS_PORT }],
        env: appEnv(input),
        resources: { limits: { cpu: "1", memory: "512Mi" } },
        startupProbe: startupProbe(INGRESS_PORT),
      },
    ];
  }
  return [
    {
      name: "gate",
      image: requirePlannedImage(
        input.gateImage,
        "GATE_IMAGE",
        input.plan.gateImage
      ),
      ports: [{ containerPort: INGRESS_PORT }],
      env: gateEnv(input),
      resources: { limits: { cpu: "1", memory: "128Mi" } },
      startupProbe: startupProbe(INGRESS_PORT),
    },
    {
      name: "app",
      image: appImage,
      // PORT is reserved on Cloud Run and only injected into the ingress container, so the
      // port is set for this process alone. The image's default (8080) belongs to the gate.
      command: ["env", `PORT=${String(GATED_APP_PORT)}`, "node", "server.js"],
      env: appEnv(input),
      resources: { limits: { cpu: "1", memory: "512Mi" } },
      startupProbe: startupProbe(GATED_APP_PORT),
    },
  ];
}

/**
 * Non-production routes all traffic to the new revision. Production keeps it on the current
 * revision and tags the new one `candidate`, so the smoke test reaches it before any visitor
 * does (10.2 step 5). The first production deploy has no current revision to keep.
 */
export function traffic(input: IRenderInput): TrafficTarget[] {
  if (input.plan.environment !== "production") {
    return [{ latestRevision: true, percent: 100 }];
  }
  const candidate = { revisionName: input.plan.revision, tag: CANDIDATE_TAG };
  if (input.currentRevision === undefined || input.currentRevision === "") {
    return [{ latestRevision: true, percent: 100 }, candidate];
  }
  if (!REVISION_NAME.test(input.currentRevision)) {
    throw new DeployConfigError("CURRENT_REVISION is malformed");
  }
  return [{ revisionName: input.currentRevision, percent: 100 }, candidate];
}

export function renderService(input: IRenderInput): IServiceManifest {
  const { plan } = input;
  const labels = {
    app: SERVICE_NAME,
    env: plan.environment,
    "managed-by": "github-actions",
  };
  const templateAnnotations: Record<string, string> = {
    "autoscaling.knative.dev/minScale": String(plan.minInstances),
    "autoscaling.knative.dev/maxScale": String(plan.maxInstances),
    "run.googleapis.com/execution-environment": "gen2",
    "run.googleapis.com/startup-cpu-boost": "true",
  };
  if (plan.gated) {
    // The gate starts only after the app's startup probe passes.
    templateAnnotations["run.googleapis.com/container-dependencies"] =
      JSON.stringify({ gate: ["app"] });
  }
  return {
    apiVersion: "serving.knative.dev/v1",
    kind: "Service",
    metadata: {
      name: plan.service,
      labels,
      // Public on purpose: the gate (or, in production, the origin guard) protects it.
      annotations: { "run.googleapis.com/invoker-iam-disabled": "true" },
    },
    spec: {
      template: {
        metadata: {
          name: plan.revision,
          labels,
          annotations: templateAnnotations,
        },
        spec: {
          containerConcurrency: 80,
          timeoutSeconds: 30,
          serviceAccountName: `moliveda-web-runtime@${input.projectId}.iam.gserviceaccount.com`,
          containers: containers(input),
        },
      },
      traffic: traffic(input),
    },
  };
}

async function main(): Promise<void> {
  const output = process.argv[2];
  if (output === undefined) {
    throw new DeployConfigError(
      "usage: node scripts/deploy/render-service.ts <output.json>"
    );
  }
  const env = process.env;
  const plan = createDeployPlan(parseDeployInput(env));
  const projectId = env.GCP_PROJECT_ID ?? "";
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) {
    throw new DeployConfigError("GCP_PROJECT_ID is missing or malformed");
  }
  const manifest = renderService({
    plan,
    projectId,
    appImage: env.APP_IMAGE ?? "",
    gateImage: env.GATE_IMAGE,
    currentRevision: env.CURRENT_REVISION,
    env,
  });
  await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: 0o600,
  });
  // Names only: the manifest itself contains secrets.
  const names = manifest.spec.template.spec.containers.map(
    (container) =>
      `${container.name}: ${container.env.map((entry) => entry.name).join(", ")}`
  );
  console.warn(
    `Rendered ${plan.service} (${plan.revision}). ${names.join("; ")}`
  );
}

if (import.meta.main) {
  await main();
}
