/**
 * Selects the preview services `scheduled.yml` deletes (MASTERPLAN 10.2): every
 * `moliveda-web-pr-<n>` whose pull request is no longer open, or that is older than 14 days.
 *
 *   node scripts/deploy/stale-previews.ts <services.json> <open-prs.json>
 *
 * `services.json` is `gcloud run services list --format=json`; `open-prs.json` is
 * `gh pr list --state open --json number`. Prints one service name per line.
 */
import { readFile } from "node:fs/promises";

export const MAX_PREVIEW_AGE_DAYS = 14;

const PREVIEW_SERVICE = /^moliveda-web-pr-([1-9][0-9]*)$/;
const DAY_MS = 86_400_000;

export interface IPreviewService {
  readonly name: string;
  readonly createdAt: string;
}

/** Reads `gcloud run services list --format=json`, keeping preview services only. */
export function parseServices(json: unknown): IPreviewService[] {
  if (!Array.isArray(json)) {
    throw new TypeError("services.json must be an array");
  }
  return json.flatMap((entry: unknown) => {
    const metadata = (
      entry as { metadata?: { name?: unknown; creationTimestamp?: unknown } }
    ).metadata;
    const name = metadata?.name;
    const createdAt = metadata?.creationTimestamp;
    return typeof name === "string" &&
      typeof createdAt === "string" &&
      PREVIEW_SERVICE.test(name)
      ? [{ name, createdAt }]
      : [];
  });
}

/** Reads `gh pr list --json number`. */
export function parseOpenPullRequests(json: unknown): Set<number> {
  if (!Array.isArray(json)) {
    throw new TypeError("open-prs.json must be an array");
  }
  return new Set(
    json.flatMap((entry: unknown) => {
      const number = (entry as { number?: unknown }).number;
      return typeof number === "number" ? [number] : [];
    })
  );
}

export function selectStalePreviews(
  services: readonly IPreviewService[],
  openPullRequests: ReadonlySet<number>,
  now: Date,
  maxAgeDays: number = MAX_PREVIEW_AGE_DAYS
): string[] {
  const cutoff = now.getTime() - maxAgeDays * DAY_MS;
  return services
    .filter(({ name, createdAt }) => {
      const prNumber = Number(PREVIEW_SERVICE.exec(name)?.[1]);
      return !openPullRequests.has(prNumber) || Date.parse(createdAt) < cutoff;
    })
    .map(({ name }) => name)
    .sort();
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

async function main(): Promise<void> {
  const [servicesPath, pullRequestsPath] = process.argv.slice(2);
  if (servicesPath === undefined || pullRequestsPath === undefined) {
    throw new TypeError(
      "usage: node scripts/deploy/stale-previews.ts <services.json> <open-prs.json>"
    );
  }
  const stale = selectStalePreviews(
    parseServices(await readJson(servicesPath)),
    parseOpenPullRequests(await readJson(pullRequestsPath)),
    new Date()
  );
  process.stdout.write(stale.map((name) => `${name}\n`).join(""));
}

if (import.meta.main) {
  await main();
}
