// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  acceptedDigests,
  checkFiles,
  DigestCheckError,
  digestOf,
  formatResult,
  parseArguments,
  resolvedDigests,
  verifyDigests,
} from "./verify-digests.ts";

function digest(character: string): string {
  return `sha256:${character.repeat(64)}`;
}

const APP_INDEX = digest("a");
const APP_AMD64 = digest("b");
const ATTESTATION = digest("c");
const GATE_INDEX = digest("d");
const GATE_AMD64 = digest("e");

/** What `docker buildx imagetools inspect --raw` returns for a build with attestations. */
function index(amd64: string): unknown {
  return {
    mediaType: "application/vnd.oci.image.index.v1+json",
    manifests: [
      { digest: amd64, platform: { os: "linux", architecture: "amd64" } },
      {
        digest: ATTESTATION,
        platform: { os: "unknown", architecture: "unknown" },
      },
    ],
  };
}

/** What `gcloud run revisions describe --format=json` returns, trimmed to the status. */
function revision(statuses: readonly Record<string, string>[]): unknown {
  return { status: { containerStatuses: statuses } };
}

const GATED_REVISION = revision([
  {
    name: "gate",
    imageDigest: `mirror.gcr.io/someone/moliveda-web-gate@${GATE_AMD64}`,
  },
  {
    name: "app",
    imageDigest: `mirror.gcr.io/someone/moliveda-web@${APP_AMD64}`,
  },
]);

describe("acceptedDigests", () => {
  it("accepts the index and its linux/amd64 image, never the attestation", () => {
    expect(acceptedDigests(APP_INDEX, index(APP_AMD64))).toStrictEqual([
      APP_INDEX,
      APP_AMD64,
    ]);
  });

  it.each([
    ["a single-platform manifest", { mediaType: "manifest", layers: [] }],
    ["not an object", "text"],
    ["null", null],
    [
      "malformed entries",
      {
        manifests: [
          "text",
          { digest: APP_AMD64 },
          {
            digest: "sha256:short",
            platform: { os: "linux", architecture: "amd64" },
          },
          { digest: 7, platform: { os: "linux", architecture: "amd64" } },
          {
            digest: APP_AMD64,
            platform: { os: "linux", architecture: "arm64" },
          },
        ],
      },
    ],
  ])("accepts only the pushed digest for %s", (_, value) => {
    expect(acceptedDigests(APP_INDEX, value)).toStrictEqual([APP_INDEX]);
  });
});

describe("resolvedDigests", () => {
  it("keeps the digest of each container's resolved image", () => {
    expect(resolvedDigests(GATED_REVISION)).toStrictEqual(
      new Map([
        ["gate", GATE_AMD64],
        ["app", APP_AMD64],
      ])
    );
  });

  it("skips malformed statuses", () => {
    const resolved = resolvedDigests(
      revision([
        { name: "app", imageDigest: "mirror.gcr.io/someone/moliveda-web:tag" },
        { imageDigest: `mirror.gcr.io/someone/moliveda-web@${APP_AMD64}` },
      ])
    );

    expect(resolved.size).toBe(0);
    expect(
      resolvedDigests({ status: { containerStatuses: ["text", null] } }).size
    ).toBe(0);
  });

  it.each([
    ["no status", {}],
    ["no container statuses", { status: {} }],
    ["not an object", null],
  ])("refuses a revision with %s", (_, value) => {
    expect(() => resolvedDigests(value)).toThrow(DigestCheckError);
  });
});

describe("verifyDigests", () => {
  const expected = [
    { container: "gate", digest: GATE_INDEX, index: index(GATE_AMD64) },
    { container: "app", digest: APP_INDEX, index: index(APP_AMD64) },
  ];

  it("passes when every container runs the pushed image", () => {
    expect(
      verifyDigests(expected, resolvedDigests(GATED_REVISION))
    ).toStrictEqual([
      { container: "gate", ok: true, detail: `runs ${GATE_AMD64}` },
      { container: "app", ok: true, detail: `runs ${APP_AMD64}` },
    ]);
  });

  it("passes when Cloud Run records the index digest itself", () => {
    expect(
      verifyDigests(
        [{ container: "app", digest: APP_INDEX, index: {} }],
        new Map([["app", APP_INDEX]])
      )
    ).toStrictEqual([
      { container: "app", ok: true, detail: `runs ${APP_INDEX}` },
    ]);
  });

  it("fails a container that runs an earlier build of the same tag", () => {
    const stale = digest("f");
    const [, app] = verifyDigests(
      expected,
      new Map([
        ["gate", GATE_AMD64],
        ["app", stale],
      ])
    );

    expect(app).toStrictEqual({
      container: "app",
      ok: false,
      detail: `runs ${stale}, expected ${APP_INDEX} or its linux/amd64 image`,
    });
  });

  it("fails a missing container and an unexpected one", () => {
    expect(
      verifyDigests(expected.slice(1), new Map([["gate", GATE_AMD64]]))
    ).toStrictEqual([
      {
        container: "app",
        ok: false,
        detail: "the revision reports no digest for it",
      },
      { container: "gate", ok: false, detail: "not expected in this revision" },
    ]);
  });
});

describe("formatResult", () => {
  it("marks each result", () => {
    expect(formatResult({ container: "app", ok: true, detail: "runs x" })).toBe(
      "ok   app: runs x"
    );
    expect(
      formatResult({ container: "app", ok: false, detail: "runs y" })
    ).toBe("FAIL app: runs y");
  });
});

describe("parseArguments", () => {
  it("reads the revision file and each image", () => {
    expect(
      parseArguments([
        "/tmp/revision.json",
        `gate=${GATE_INDEX}=/tmp/gate.json`,
        `app=${APP_INDEX}=/tmp/app.json`,
      ])
    ).toStrictEqual({
      revisionFile: "/tmp/revision.json",
      images: [
        { container: "gate", digest: GATE_INDEX, indexFile: "/tmp/gate.json" },
        { container: "app", digest: APP_INDEX, indexFile: "/tmp/app.json" },
      ],
    });
  });

  it.each([
    [[]],
    [["/tmp/revision.json"]],
    [["", `app=${APP_INDEX}=/tmp/app.json`]],
    [["/tmp/revision.json", `App=${APP_INDEX}=/tmp/app.json`]],
    [["/tmp/revision.json", "app=sha256:short=/tmp/app.json"]],
    [["/tmp/revision.json", `app=${APP_INDEX}=`]],
    [["/tmp/revision.json", `app=${APP_INDEX}`]],
    [["/tmp/revision.json", `app=${APP_INDEX}=/tmp/a=b.json`]],
  ])("refuses %j", (args) => {
    expect(() => parseArguments(args)).toThrow(/^usage: /);
  });

  it("refuses a container listed twice", () => {
    expect(() =>
      parseArguments([
        "/tmp/revision.json",
        `app=${APP_INDEX}=/tmp/app.json`,
        `app=${APP_INDEX}=/tmp/app.json`,
      ])
    ).toThrow("each container may be listed only once");
  });
});

describe("digestOf", () => {
  it("hashes the exact bytes, as a registry does", () => {
    expect(digestOf("")).toBe(
      "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
    expect(digestOf("{}\n")).not.toBe(digestOf("{}"));
  });
});

describe("checkFiles", () => {
  // Registry digests are the SHA-256 of the raw manifest bytes.
  const gateRaw = `${JSON.stringify(index(GATE_AMD64), null, 2)}\n`;
  const appRaw = `${JSON.stringify(index(APP_AMD64), null, 2)}\n`;
  const gateDigest = `sha256:${createHash("sha256").update(gateRaw).digest("hex")}`;
  const appDigest = `sha256:${createHash("sha256").update(appRaw).digest("hex")}`;
  let directory = "";

  function path(file: string): string {
    return join(directory, file);
  }

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "verify-digests-"));
    await writeFile(path("revision.json"), JSON.stringify(GATED_REVISION));
    await writeFile(path("gate.json"), gateRaw);
    await writeFile(path("app.json"), appRaw);
    await writeFile(path("broken.json"), "{");
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("checks the revision against the files on disk", async () => {
    const results = await checkFiles([
      path("revision.json"),
      `gate=${gateDigest}=${path("gate.json")}`,
      `app=${appDigest}=${path("app.json")}`,
    ]);

    expect(results.map((result) => result.ok)).toStrictEqual([true, true]);
  });

  it("refuses an index file that is not the pushed image", async () => {
    // The file lists the running linux/amd64 digest, but it is not the image CI pushed, so its
    // children must not be trusted.
    await expect(
      checkFiles([
        path("revision.json"),
        `app=${APP_INDEX}=${path("app.json")}`,
      ])
    ).rejects.toThrow(`${path("app.json")} is not the image ${APP_INDEX}`);
  });

  it("refuses a missing file", async () => {
    await expect(
      checkFiles([
        path("revision.json"),
        `app=${appDigest}=${path("missing.json")}`,
      ])
    ).rejects.toThrow(`${path("missing.json")} is not readable`);
  });

  it("refuses a revision file that is not JSON", async () => {
    await expect(
      checkFiles([path("broken.json"), `app=${appDigest}=${path("app.json")}`])
    ).rejects.toThrow(`${path("broken.json")} is not a JSON file`);
  });

  it("refuses an index file that is not JSON", async () => {
    await expect(
      checkFiles([
        path("revision.json"),
        `app=${digestOf("{")}=${path("broken.json")}`,
      ])
    ).rejects.toThrow(`${path("broken.json")} is not a JSON file`);
  });

  it("accepts an injected reader", async () => {
    const files = new Map([
      [
        "revision",
        JSON.stringify(
          revision([{ name: "app", imageDigest: `x@${APP_AMD64}` }])
        ),
      ],
      ["app", appRaw],
    ]);

    await expect(
      checkFiles(["revision", `app=${appDigest}=app`], (file) =>
        Promise.resolve(files.get(file) ?? "")
      )
    ).resolves.toStrictEqual([
      { container: "app", ok: true, detail: `runs ${APP_AMD64}` },
    ]);
  });
});
