// @vitest-environment node
import { describe, expect, it } from "vitest";

import { createDeployPlan, parseDeployInput } from "./deploy-plan.ts";
import { renderService } from "./render-service.ts";

import type { DeployEnvironment } from "./deploy-plan.ts";
import type { IRenderInput } from "./render-service.ts";

const DIGEST = "a".repeat(64);
const APP_IMAGE = `docker.io/someone/moliveda-web@sha256:${DIGEST}`;
const GATE_IMAGE = `docker.io/someone/moliveda-web-gate@sha256:${DIGEST}`;
const GATE_SECRETS = {
  BASIC_AUTH_USERNAME: "reviewer",
  BASIC_AUTH_PASSWORD: "gate-password",
};
const ORIGIN_SECRET = "o".repeat(48);

function input(
  environment: DeployEnvironment,
  overrides: Partial<IRenderInput> = {}
): IRenderInput {
  const plan = createDeployPlan(
    parseDeployInput({
      DEPLOY_ENVIRONMENT: environment,
      PR_NUMBER: "7",
      GITHUB_SHA: "0123456789abcdef0123456789abcdef01234567",
      GCP_PROJECT_NUMBER: "123456789012",
      GCP_REGION: "us-central1",
      GITHUB_RUN_ID: "16000000001",
      GITHUB_RUN_ATTEMPT: "2",
    })
  );
  return {
    plan,
    projectId: "moliveda-gcloudprojects-dev",
    appImage: APP_IMAGE,
    gateImage: GATE_IMAGE,
    currentRevision: undefined,
    env: { ...GATE_SECRETS, ORIGIN_VERIFY_SECRET: ORIGIN_SECRET },
    ...overrides,
  };
}

function envNames(
  manifest: ReturnType<typeof renderService>,
  container: string
): string[] {
  return (
    manifest.spec.template.spec.containers
      .find((entry) => entry.name === container)
      ?.env.map((entry) => entry.name) ?? []
  );
}

describe("renderService for a gated environment", () => {
  const manifest = renderService(input("development"));
  const [gate, app] = manifest.spec.template.spec.containers;

  it("names the service and the revision, with the 10.1 labels", () => {
    expect(manifest.metadata.name).toBe("moliveda-web");
    expect(manifest.spec.template.metadata.name).toBe(
      "moliveda-web-0123456789ab-16000000001-2"
    );
    expect(manifest.metadata.labels).toStrictEqual({
      app: "moliveda-web",
      env: "development",
      "managed-by": "github-actions",
    });
    expect(manifest.metadata.annotations).toStrictEqual({
      "run.googleapis.com/invoker-iam-disabled": "true",
    });
  });

  it("applies the 10.1 service settings", () => {
    expect(manifest.spec.template.metadata.annotations).toStrictEqual({
      "autoscaling.knative.dev/minScale": "0",
      "autoscaling.knative.dev/maxScale": "2",
      "run.googleapis.com/execution-environment": "gen2",
      "run.googleapis.com/startup-cpu-boost": "true",
      "run.googleapis.com/container-dependencies": '{"gate":["app"]}',
    });
    expect(manifest.spec.template.spec).toMatchObject({
      containerConcurrency: 80,
      timeoutSeconds: 30,
      serviceAccountName:
        "moliveda-web-runtime@moliveda-gcloudprojects-dev.iam.gserviceaccount.com",
    });
  });

  it("puts the gate on the ingress port and the app on 3000 behind it", () => {
    expect(gate).toMatchObject({
      name: "gate",
      image: GATE_IMAGE,
      ports: [{ containerPort: 8080 }],
      startupProbe: { httpGet: { path: "/health", port: 8080 } },
    });
    expect(app).toMatchObject({
      name: "app",
      image: APP_IMAGE,
      command: ["env", "PORT=3000", "node", "server.js"],
      startupProbe: { httpGet: { path: "/health", port: 3000 } },
    });
    expect(app).not.toHaveProperty("ports");
  });

  it("sends the credentials to the gate only and the origin secret nowhere", () => {
    expect(envNames(manifest, "gate")).toStrictEqual([
      "APP_ENV",
      "BASIC_AUTH_USERNAME",
      "BASIC_AUTH_PASSWORD",
    ]);
    expect(envNames(manifest, "app")).toStrictEqual(["APP_ENV"]);
    expect(JSON.stringify(manifest)).not.toContain(ORIGIN_SECRET);
  });

  it("routes all traffic to the new revision", () => {
    expect(manifest.spec.traffic).toStrictEqual([
      { latestRevision: true, percent: 100 },
    ]);
  });

  it("passes the optional app variables through only when they are set", () => {
    const rendered = renderService(
      input("staging", {
        env: { ...GATE_SECRETS, EMAIL_DRIVER: "fake", LOG_LEVEL: "" },
      })
    );

    expect(envNames(rendered, "app")).toStrictEqual([
      "APP_ENV",
      "EMAIL_DRIVER",
    ]);
  });

  it.each([
    [{ BASIC_AUTH_USERNAME: "reviewer" }],
    [{ BASIC_AUTH_PASSWORD: "gate-password" }],
    [{ BASIC_AUTH_USERNAME: "", BASIC_AUTH_PASSWORD: "" }],
  ])("refuses to deploy the gate without both credentials (%j)", (env) => {
    expect(() => renderService(input("preview", { env }))).toThrow(
      "BASIC_AUTH_USERNAME and BASIC_AUTH_PASSWORD are required"
    );
  });

  it("refuses images that are not pinned by digest", () => {
    expect(() =>
      renderService(input("development", { gateImage: undefined }))
    ).toThrow("GATE_IMAGE must be a docker.io image pinned by digest");
    expect(() =>
      renderService(
        input("development", {
          appImage: "docker.io/someone/moliveda-web:latest",
        })
      )
    ).toThrow("APP_IMAGE must be a docker.io image pinned by digest");
  });
});

describe("renderService for production", () => {
  it("runs the app alone on the ingress port with the origin secrets", () => {
    const manifest = renderService(
      input("production", {
        gateImage: undefined,
        env: {
          ...GATE_SECRETS,
          ORIGIN_VERIFY_SECRET: ORIGIN_SECRET,
          ORIGIN_VERIFY_SECRET_PREVIOUS: "p".repeat(48),
        },
      })
    );
    const [app, ...others] = manifest.spec.template.spec.containers;

    expect(others).toStrictEqual([]);
    expect(app).toMatchObject({
      name: "app",
      ports: [{ containerPort: 8080 }],
      startupProbe: { httpGet: { path: "/health", port: 8080 } },
    });
    expect(app).not.toHaveProperty("command");
    expect(envNames(manifest, "app")).toStrictEqual([
      "APP_ENV",
      "ORIGIN_VERIFY_SECRET",
      "ORIGIN_VERIFY_SECRET_PREVIOUS",
    ]);
    expect(JSON.stringify(manifest)).not.toContain("gate-password");
    expect(manifest.spec.template.metadata.annotations).toMatchObject({
      "autoscaling.knative.dev/minScale": "1",
      "autoscaling.knative.dev/maxScale": "3",
    });
    expect(manifest.spec.template.metadata.annotations).not.toHaveProperty(
      "run.googleapis.com/container-dependencies"
    );
  });

  it("keeps traffic on the current revision and tags the candidate", () => {
    const manifest = renderService(
      input("production", { currentRevision: "moliveda-web-00042-abc" })
    );

    expect(manifest.spec.traffic).toStrictEqual([
      { revisionName: "moliveda-web-00042-abc", percent: 100 },
      {
        revisionName: "moliveda-web-0123456789ab-16000000001-2",
        tag: "candidate",
      },
    ]);
  });

  it("sends the first deploy's traffic to the new revision, still tagged", () => {
    for (const currentRevision of [undefined, ""]) {
      expect(
        renderService(input("production", { currentRevision })).spec.traffic
      ).toStrictEqual([
        { latestRevision: true, percent: 100 },
        {
          revisionName: "moliveda-web-0123456789ab-16000000001-2",
          tag: "candidate",
        },
      ]);
    }
  });

  it("rejects a malformed current revision", () => {
    expect(() =>
      renderService(input("production", { currentRevision: "a b" }))
    ).toThrow("CURRENT_REVISION is malformed");
  });

  it("refuses to deploy without the origin secret", () => {
    expect(() =>
      renderService(
        input("production", {
          env: { ORIGIN_VERIFY_SECRET_PREVIOUS: "p".repeat(48) },
        })
      )
    ).toThrow("ORIGIN_VERIFY_SECRET is required in production");
  });
});
