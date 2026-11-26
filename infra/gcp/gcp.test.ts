// @vitest-environment node
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  cpSync,
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

// bootstrap.sh and check.sh run under `sh` against a fake gcloud (test/gcloud) that keeps its
// state in files, so the tests see what a second run, or a check after a bootstrap, would see.

const GCP_DIR = import.meta.dirname;
const STUB_DIR = join(GCP_DIR, "test");
const NUMBER = "123456789012";
const REPOSITORY = "M-oliveda/moliveda_web";
const DEV_PROJECT = "moliveda-gcloudprojects-dev";
const PROD_PROJECT = "moliveda-gcloudprojects-prod";
const SHARED_DEPLOYER = `deployer@${DEV_PROJECT}.iam.gserviceaccount.com`;
const PROD_DEPLOYER = `moliveda-web-deployer@${PROD_PROJECT}.iam.gserviceaccount.com`;
const PROVIDER_JSON = JSON.stringify({
  attributeMapping: {
    "google.subject": "assertion.sub",
    "attribute.repository": "assertion.repository",
    "attribute.repository_owner": "assertion.repository_owner",
  },
  attributeCondition: "assertion.repository_owner == 'M-oliveda'",
});
// Matches gcloud subcommands that change something. `services list --enabled` must not match.
const MUTATING =
  /(^| )(create|enable|update|delete|add-iam-policy-binding|remove-iam-policy-binding|set-iam-policy|deploy|replace)( |$)/;

interface IRunResult {
  readonly status: number | null;
  readonly output: string;
}

let state: string;
let log: string;

function seed(file: string, content: string): void {
  writeFileSync(join(state, file), content);
}

/** The project before any bootstrap: billing, a budget and the shared identity resources. */
function seedProject(): void {
  seed("number", `${NUMBER}\n`);
  seed("billing", "True\tbillingAccounts/000000-000000-000000\n");
  seed("budgets", `projects/${NUMBER};projects/999\n`);
  seed("provider.json", PROVIDER_JSON);
  seed("pools", "github\n");
  seed("providers", "github-actions\n");
  seed("apis", "run.googleapis.com\n");
  seed("sas", `${SHARED_DEPLOYER}\n`);
  seed(
    "policy-project",
    `roles/run.admin\tserviceAccount:${SHARED_DEPLOYER}\n`
  );
}

function run(
  script: string,
  args: readonly string[],
  env: Record<string, string> = {},
  dir: string = GCP_DIR
): IRunResult {
  const result = spawnSync("sh", [join(dir, script), ...args], {
    encoding: "utf8",
    env: {
      NODE_ENV: "test",
      PATH: `${STUB_DIR}:${process.env.PATH ?? ""}`,
      STUB_STATE: state,
      STUB_LOG: log,
      WIF_POOL: "github",
      WIF_PROVIDER: "github-actions",
      SHARED_DEPLOYER_SA: SHARED_DEPLOYER,
      ...env,
    },
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

/**
 * Runs a copy of the scripts whose config.sh has no default names, as before the owner filled
 * them in, so the "names not configured" paths stay tested.
 */
function runUnconfigured(
  script: string,
  args: readonly string[],
  env: Record<string, string> = {}
): IRunResult {
  const dir = join(state, "unconfigured");
  cpSync(GCP_DIR, dir, {
    recursive: true,
    filter: (source) => !source.endsWith(".test.ts"),
  });
  const config = join(dir, "config.sh");
  writeFileSync(
    config,
    readFileSync(config, "utf8").replace(
      /\$\{(OVERRIDE_\w+):-[^}]+\}/g,
      "${$1:-}"
    )
  );
  return run(script, args, env, dir);
}

function calls(): string[] {
  return readFileSync(log, "utf8").split("\n").filter(Boolean);
}

function mutatingCalls(): string[] {
  return calls().filter((call) => MUTATING.test(call));
}

function resetLog(): void {
  writeFileSync(log, "");
}

beforeEach(() => {
  state = mkdtempSync(join(tmpdir(), "gcp-stub-"));
  log = join(state, "calls.log");
  resetLog();
  chmodSync(join(STUB_DIR, "gcloud"), 0o755);
  seedProject();
});

afterEach(() => {
  rmSync(state, { recursive: true, force: true });
});

describe("bootstrap.sh", () => {
  it("sets up a development project, then a second run changes nothing", () => {
    const first = run("bootstrap.sh", ["dev"]);

    expect(first.status).toBe(0);
    expect(mutatingCalls()).toStrictEqual(
      expect.arrayContaining([
        `services enable iamcredentials.googleapis.com --project ${DEV_PROJECT}`,
        expect.stringContaining(
          "iam service-accounts create moliveda-web-runtime"
        ),
        expect.stringContaining(
          `--member serviceAccount:${SHARED_DEPLOYER} --role roles/iam.serviceAccountUser`
        ),
        expect.stringContaining(
          `--member principalSet://iam.googleapis.com/projects/${NUMBER}/locations/global/workloadIdentityPools/github/attribute.repository/${REPOSITORY} --role roles/iam.workloadIdentityUser`
        ),
      ])
    );
    expect(mutatingCalls().join("\n")).not.toContain(
      "run.googleapis.com --project"
    );

    resetLog();
    const second = run("bootstrap.sh", ["dev"]);

    expect(second.status).toBe(0);
    expect(mutatingCalls()).toStrictEqual([]);
    expect(run("check.sh", ["dev"]).status).toBe(0);
  });

  it("creates the production deployer and its role, and never touches the shared deployer", () => {
    const result = run("bootstrap.sh", ["prod"], { SHARED_DEPLOYER_SA: "" });

    expect(result.status).toBe(0);
    expect(mutatingCalls()).toStrictEqual(
      expect.arrayContaining([
        expect.stringContaining("iam roles create molivedaWebDeployer"),
        expect.stringContaining(
          "iam service-accounts create moliveda-web-deployer"
        ),
        expect.stringContaining(
          `projects add-iam-policy-binding ${PROD_PROJECT} --member serviceAccount:${PROD_DEPLOYER} --role projects/${PROD_PROJECT}/roles/molivedaWebDeployer --condition None`
        ),
      ])
    );
    expect(mutatingCalls().join("\n")).not.toContain(SHARED_DEPLOYER);
    expect(readFileSync(join(state, "role-perms"), "utf8")).not.toContain(
      "run.services.delete"
    );
    expect(run("check.sh", ["prod"]).status).toBe(0);
  });

  it("updates the production role when its permissions drift", () => {
    run("bootstrap.sh", ["prod"]);
    appendFileSync(join(state, "role-perms"), "run.services.delete\n");
    resetLog();

    const result = run("bootstrap.sh", ["prod"]);

    expect(result.status).toBe(0);
    expect(mutatingCalls()).toStrictEqual([
      expect.stringContaining("iam roles update molivedaWebDeployer"),
    ]);
  });

  it("only prints the commands with --dry-run", () => {
    const result = run("bootstrap.sh", ["dev", "--dry-run"]);

    expect(result.status).toBe(0);
    expect(result.output).toContain("would  gcloud services enable");
    expect(mutatingCalls()).toStrictEqual([]);
  });

  it("refuses to change a provider that does not map the repository", () => {
    // `attribute.repository_owner` alone must not pass for `attribute.repository`.
    seed(
      "provider.json",
      JSON.stringify({
        attributeMapping: {
          "google.subject": "assertion.sub",
          "attribute.repository_owner": "assertion.repository_owner",
        },
      })
    );

    const result = run("bootstrap.sh", ["dev"]);

    expect(result.status).toBe(2);
    expect(result.output).toContain("does not map attribute.repository");
    expect(mutatingCalls().join("\n")).not.toContain("workloadIdentityUser");
  });

  it.each([
    [["staging"], "usage"],
    [[], "usage"],
    [["dev", "--force"], "usage"],
  ])("rejects the arguments %j", (args, message) => {
    const result = run("bootstrap.sh", args);

    expect(result.status).toBe(2);
    expect(result.output).toContain(message);
    expect(calls()).toStrictEqual([]);
  });

  it.each(["WIF_POOL", "WIF_PROVIDER", "SHARED_DEPLOYER_SA"])(
    "stops before any call when %s is not set",
    (name) => {
      const result = runUnconfigured("bootstrap.sh", ["dev"], { [name]: "" });

      expect(result.status).toBe(2);
      expect(result.output).toContain(`${name} is not set`);
      expect(calls()).toStrictEqual([]);
    }
  );
});

describe("check.sh", () => {
  it("reports every gap of a fresh project without changing anything", () => {
    const result = run("check.sh", ["dev"]);

    expect(result.status).toBe(1);
    expect(result.output).toContain(
      "DRIFT  API iamcredentials.googleapis.com is not enabled"
    );
    expect(result.output).toContain("DRIFT  runtime service account");
    expect(result.output).toContain(
      "DRIFT  Workload Identity binding for M-oliveda/moliveda_web is missing"
    );
    expect(result.output).toContain(`project number ${NUMBER}`);
    expect(mutatingCalls()).toStrictEqual([]);
  });

  it("never calls a mutating command, for every environment", () => {
    const result = run("check.sh", ["all"]);

    expect(result.status).toBe(1);
    for (const key of ["dev", "prev", "stg", "prod"]) {
      expect(result.output).toContain(`== ${key}:`);
    }
    expect(calls().length).toBeGreaterThan(0);
    expect(mutatingCalls()).toStrictEqual([]);
  });

  it("checks each environment's own deployer when checking all of them", () => {
    run("check.sh", ["all"], { SHARED_DEPLOYER_SA: "" });

    for (const key of ["dev", "prev", "stg"]) {
      expect(calls()).toContain(
        `iam service-accounts describe cicd-deployer-${key}@moliveda-gcloudprojects-${key}.iam.gserviceaccount.com --project moliveda-gcloudprojects-${key} --format=value(email)`
      );
    }
  });

  it("lists the pools and providers when the identity names are not configured", () => {
    const result = runUnconfigured("check.sh", ["dev"], { WIF_POOL: "" });

    expect(result.status).toBe(1);
    expect(result.output).toContain(
      "found pool 'github', providers: github-actions"
    );
  });

  it("lists the service accounts when the shared deployer is not configured", () => {
    const result = runUnconfigured("check.sh", ["dev"], {
      SHARED_DEPLOYER_SA: "",
    });

    expect(result.status).toBe(1);
    expect(result.output).toContain(`found service account ${SHARED_DEPLOYER}`);
    expect(mutatingCalls()).toStrictEqual([]);
  });

  it("never lets gcloud prompt, even when the caller enabled prompts", () => {
    const result = run("check.sh", ["dev"], {
      CLOUDSDK_CORE_DISABLE_PROMPTS: "0",
    });

    expect(result.output).not.toContain("prompts enabled");
    expect(calls().length).toBeGreaterThan(0);
  });

  it("flags project roles on the runtime account and extra roles on the production deployer", () => {
    run("bootstrap.sh", ["prod"]);
    appendFileSync(
      join(state, "policy-project"),
      `roles/editor\tserviceAccount:moliveda-web-runtime@${PROD_PROJECT}.iam.gserviceaccount.com\n` +
        `roles/run.admin\tserviceAccount:${PROD_DEPLOYER}\n`
    );

    const result = run("check.sh", ["prod"]);

    expect(result.status).toBe(1);
    expect(result.output).toContain(
      "runtime service account has project roles: roles/editor"
    );
    expect(result.output).toContain("production deployer roles are");
  });

  it("reports billing, budget and project access problems", () => {
    seed("budgets", "projects/999\n");
    expect(run("check.sh", ["dev"]).output).toContain("no budget is scoped");

    rmSync(join(state, "budgets"));
    expect(run("check.sh", ["dev"]).output).toContain(
      "warn   cannot read the budgets"
    );

    seed("billing", "False\t\n");
    expect(run("check.sh", ["dev"]).output).toContain("billing is not enabled");

    rmSync(join(state, "number"));
    const missing = run("check.sh", ["dev"]);
    expect(missing.status).toBe(1);
    expect(missing.output).toContain(`cannot read project ${DEV_PROJECT}`);
  });

  it("warns when the shared provider does not restrict the owner", () => {
    run("bootstrap.sh", ["dev"]);
    seed(
      "provider.json",
      JSON.stringify({
        attributeMapping: {
          "attribute.repository": "assertion.repository",
        },
      })
    );

    const result = run("check.sh", ["dev"]);

    expect(result.status).toBe(0);
    expect(result.output).toContain(
      "provider condition does not restrict the owner"
    );
  });

  it("rejects unknown arguments", () => {
    expect(run("check.sh", ["staging"]).status).toBe(2);
    expect(run("check.sh", []).status).toBe(2);
  });
});
