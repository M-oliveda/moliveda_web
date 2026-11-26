/**
 * Post-deploy image check (MASTERPLAN 10.2 step 5 and 10.4). The manifest references the Docker
 * Hub images by tag, and Cloud Run resolves each tag to a digest when it creates the revision.
 * This checks that every container of the new revision runs the digest CI pushed, so a stale
 * cached tag can never ship.
 *
 *   node scripts/deploy/verify-digests.ts <revision.json> <container>=<digest>=<index.json>...
 *
 * `<revision.json>` is `gcloud run revisions describe --format=json`. `<index.json>` is
 * `docker buildx imagetools inspect --raw` of the pushed image. For a multi-platform index Cloud
 * Run records the digest of its linux/amd64 image, so that digest is accepted along with the
 * index's own. The raw bytes of `<index.json>` must hash to `<digest>`, so the file is proven
 * to be the pushed image before its linux/amd64 digest is trusted.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export interface IExpectedImage {
  readonly container: string;
  /** The digest `docker/build-push-action` reported for the pushed image. */
  readonly digest: string;
  /** The image index or manifest behind `digest`, as the registry returns it. */
  readonly index: unknown;
}

export interface IDigestResult {
  readonly container: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface IImageArgument {
  readonly container: string;
  readonly digest: string;
  readonly indexFile: string;
}

/** Thrown for bad arguments or input files that are not what gcloud and buildx produce. */
export class DigestCheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DigestCheckError";
  }
}

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const CONTAINER = /^[a-z][a-z0-9-]*$/;
const USAGE =
  "usage: node scripts/deploy/verify-digests.ts <revision.json> <container>=<digest>=<index.json>...";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** `digest`, plus the digest of each linux/amd64 image when `index` is an image index. */
export function acceptedDigests(digest: string, index: unknown): string[] {
  const manifests =
    isRecord(index) && Array.isArray(index.manifests) ? index.manifests : [];
  const children = manifests.flatMap((entry: unknown) => {
    if (!isRecord(entry) || !isRecord(entry.platform)) {
      return [];
    }
    const { os, architecture } = entry.platform;
    return os === "linux" &&
      architecture === "amd64" &&
      typeof entry.digest === "string" &&
      DIGEST.test(entry.digest)
      ? [entry.digest]
      : [];
  });
  return [digest, ...children];
}

/** Container name to resolved digest, from `status.containerStatuses` of a revision. */
export function resolvedDigests(revision: unknown): Map<string, string> {
  const statuses =
    isRecord(revision) && isRecord(revision.status)
      ? revision.status.containerStatuses
      : undefined;
  if (!Array.isArray(statuses)) {
    throw new DigestCheckError(
      "the revision has no status.containerStatuses (is it the right file?)"
    );
  }
  const resolved = new Map<string, string>();
  for (const status of statuses) {
    if (
      isRecord(status) &&
      typeof status.name === "string" &&
      typeof status.imageDigest === "string"
    ) {
      // `mirror.gcr.io/<user>/<repository>@sha256:<hex>`: keep the digest only.
      const digest = status.imageDigest.slice(
        status.imageDigest.lastIndexOf("@") + 1
      );
      if (DIGEST.test(digest)) {
        resolved.set(status.name, digest);
      }
    }
  }
  return resolved;
}

/** One result per expected container, plus a failure for any container nobody expected. */
export function verifyDigests(
  expected: readonly IExpectedImage[],
  resolved: ReadonlyMap<string, string>
): IDigestResult[] {
  const results = expected.map((image): IDigestResult => {
    const actual = resolved.get(image.container);
    if (actual === undefined) {
      return {
        container: image.container,
        ok: false,
        detail: "the revision reports no digest for it",
      };
    }
    return acceptedDigests(image.digest, image.index).includes(actual)
      ? { container: image.container, ok: true, detail: `runs ${actual}` }
      : {
          container: image.container,
          ok: false,
          detail: `runs ${actual}, expected ${image.digest} or its linux/amd64 image`,
        };
  });
  const names = new Set(expected.map((image) => image.container));
  for (const container of resolved.keys()) {
    if (!names.has(container)) {
      results.push({
        container,
        ok: false,
        detail: "not expected in this revision",
      });
    }
  }
  return results;
}

export function formatResult(result: IDigestResult): string {
  return `${result.ok ? "ok  " : "FAIL"} ${result.container}: ${result.detail}`;
}

export function parseArguments(args: readonly string[]): {
  readonly revisionFile: string;
  readonly images: readonly IImageArgument[];
} {
  const [revisionFile, ...rest] = args;
  if (revisionFile === undefined || revisionFile === "" || rest.length === 0) {
    throw new DigestCheckError(USAGE);
  }
  const images = rest.map((argument): IImageArgument => {
    const [container = "", digest = "", indexFile = "", ...extra] =
      argument.split("=");
    if (
      !CONTAINER.test(container) ||
      !DIGEST.test(digest) ||
      indexFile === "" ||
      extra.length > 0
    ) {
      throw new DigestCheckError(USAGE);
    }
    return { container, digest, indexFile };
  });
  if (new Set(images.map((image) => image.container)).size !== images.length) {
    throw new DigestCheckError("each container may be listed only once");
  }
  return { revisionFile, images };
}

/** `sha256:<hex>` of the exact bytes, as a registry computes a manifest digest. */
export function digestOf(raw: string): string {
  return `sha256:${createHash("sha256").update(raw, "utf8").digest("hex")}`;
}

function parseJson(file: string, raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new DigestCheckError(`${file} is not a JSON file`);
  }
}

async function readText(file: string): Promise<string> {
  try {
    return await readFile(file, "utf8");
  } catch {
    throw new DigestCheckError(`${file} is not readable`);
  }
}

/** Reads the files named in `args` and checks them. */
export async function checkFiles(
  args: readonly string[],
  read: (file: string) => Promise<string> = readText
): Promise<IDigestResult[]> {
  const { revisionFile, images } = parseArguments(args);
  const expected = await Promise.all(
    images.map(async (image): Promise<IExpectedImage> => {
      const raw = await read(image.indexFile);
      if (digestOf(raw) !== image.digest) {
        throw new DigestCheckError(
          `${image.indexFile} is not the image ${image.digest}`
        );
      }
      return {
        container: image.container,
        digest: image.digest,
        index: parseJson(image.indexFile, raw),
      };
    })
  );
  const revision = parseJson(revisionFile, await read(revisionFile));
  return verifyDigests(expected, resolvedDigests(revision));
}

async function main(): Promise<void> {
  const results = await checkFiles(process.argv.slice(2));
  for (const result of results) {
    (result.ok ? console.warn : console.error)(formatResult(result));
  }
  if (results.some((result) => !result.ok)) {
    console.error("The revision does not run the images this workflow pushed");
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  await main();
}
