// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  createDeployPlan,
  DeployConfigError,
  formatOutputs,
  parseDeployInput,
  revisionName,
  serviceUrl,
} from "./deploy-plan.ts";

const SHA = "0123456789abcdef0123456789abcdef01234567";

function source(
  overrides: Record<string, string | undefined> = {}
): Record<string, string | undefined> {
  return {
    DEPLOY_ENVIRONMENT: "development",
    GITHUB_SHA: SHA,
    GCP_PROJECT_NUMBER: "123456789012",
    GCP_REGION: "us-central1",
    GITHUB_RUN_ID: "16000000001",
    GITHUB_RUN_ATTEMPT: "1",
    ...overrides,
  };
}

describe("parseDeployInput", () => {
  it("reads a development deploy", () => {
    expect(parseDeployInput(source())).toStrictEqual({
      environment: "development",
      sha: SHA,
      prNumber: undefined,
      projectNumber: "123456789012",
      region: "us-central1",
      runId: "16000000001",
      runAttempt: "1",
    });
  });

  it("requires the pull request number for a preview only", () => {
    expect(
      parseDeployInput(
        source({ DEPLOY_ENVIRONMENT: "preview", PR_NUMBER: "42" })
      ).prNumber
    ).toBe(42);
    expect(
      parseDeployInput(
        source({ DEPLOY_ENVIRONMENT: "staging", PR_NUMBER: "42" })
      ).prNumber
    ).toBeUndefined();
    expect(() =>
      parseDeployInput(source({ DEPLOY_ENVIRONMENT: "preview" }))
    ).toThrow("PR_NUMBER is missing or malformed");
  });

  it.each([
    ["DEPLOY_ENVIRONMENT", "local"],
    ["DEPLOY_ENVIRONMENT", undefined],
    ["GITHUB_SHA", "0123456"],
    ["GCP_PROJECT_NUMBER", "moliveda-gcloudprojects-dev"],
    ["GCP_REGION", "us central1"],
    ["GITHUB_RUN_ID", "0"],
    ["GITHUB_RUN_ATTEMPT", ""],
  ])("rejects %s=%j and names only the variable", (name, value) => {
    const run = (): unknown => parseDeployInput(source({ [name]: value }));

    expect(run).toThrow(DeployConfigError);
    expect(run).toThrow(`${name} is missing or malformed`);
  });
});

describe("createDeployPlan", () => {
  it("plans a gated development deploy", () => {
    expect(createDeployPlan(parseDeployInput(source()))).toStrictEqual({
      environment: "development",
      gated: true,
      minInstances: 0,
      maxInstances: 2,
      service: "moliveda-web",
      revision: "moliveda-web-0123456789ab-16000000001-1",
      appTag: "development-0123456789ab",
      gateTag: "0123456789ab",
      url: "https://moliveda-web-123456789012.us-central1.run.app",
      candidateUrl: undefined,
    });
  });

  it("plans one service per pull request", () => {
    const plan = createDeployPlan(
      parseDeployInput(
        source({ DEPLOY_ENVIRONMENT: "preview", PR_NUMBER: "7" })
      )
    );

    expect(plan.service).toBe("moliveda-web-pr-7");
    expect(plan.appTag).toBe("pr-7-0123456789ab");
    expect(plan.maxInstances).toBe(1);
    expect(plan.url).toBe(
      "https://moliveda-web-pr-7-123456789012.us-central1.run.app"
    );
  });

  it("plans production without the gate and with a candidate URL", () => {
    const plan = createDeployPlan(
      parseDeployInput(source({ DEPLOY_ENVIRONMENT: "production" }))
    );

    expect(plan).toMatchObject({
      gated: false,
      minInstances: 1,
      maxInstances: 3,
      appTag: "production-0123456789ab",
      candidateUrl:
        "https://candidate---moliveda-web-123456789012.us-central1.run.app",
    });
  });
});

describe("revisionName", () => {
  it("refuses names longer than Cloud Run allows", () => {
    const input = parseDeployInput(source({ GITHUB_RUN_ID: "9".repeat(40) }));

    expect(() => revisionName(input, "moliveda-web")).toThrow(
      "revision name is longer than 63 characters"
    );
  });
});

describe("serviceUrl", () => {
  it("prefixes a traffic tag", () => {
    expect(serviceUrl("moliveda-web", "1", "us-central1", "candidate")).toBe(
      "https://candidate---moliveda-web-1.us-central1.run.app"
    );
  });
});

describe("formatOutputs", () => {
  it("writes one key=value line per output", () => {
    const plan = createDeployPlan(parseDeployInput(source()));

    expect(formatOutputs(plan).split("\n")).toStrictEqual([
      "environment=development",
      "gated=true",
      "service=moliveda-web",
      "revision=moliveda-web-0123456789ab-16000000001-1",
      "app_tag=development-0123456789ab",
      "gate_tag=0123456789ab",
      "url=https://moliveda-web-123456789012.us-central1.run.app",
      "candidate_url=",
      "",
    ]);
  });
});
