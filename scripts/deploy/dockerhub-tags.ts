/**
 * Docker Hub tag cleanup (MASTERPLAN 10.2 and 10.4), used by `cleanup-preview.yml` and
 * `scheduled.yml` with the cleanup token (10.3).
 *
 *   node scripts/deploy/dockerhub-tags.ts preview <pr number>   # delete pr-<n>-* app tags
 *   node scripts/deploy/dockerhub-tags.ts prune                 # retention policy, both repos
 *
 * Retention: `v*` and unknown tags are kept forever; per environment (and for the gate) the 10
 * newest tags are kept, and the rest are deleted once they are older than 30 days. Set
 * `DRY_RUN=1` to only list what would be deleted.
 */

export const APP_REPOSITORY = "moliveda-web";
export const GATE_REPOSITORY = "moliveda-web-gate";
export const KEEP_NEWEST = 10;
export const MAX_AGE_DAYS = 30;

const HUB = "https://hub.docker.com";
const DAY_MS = 86_400_000;

export interface ITag {
  readonly name: string;
  readonly lastUpdated: string;
}

export interface IRetentionPolicy {
  readonly keepNewest: number;
  readonly maxAgeDays: number;
}

/** Thrown for bad arguments or a failed Docker Hub call. Never includes the token. */
export class DockerHubError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DockerHubError";
  }
}

// `<sha>-<run id>-<run attempt>` (10.4). The suffix is optional so that tags pushed before it
// existed (`<sha>` alone) are still cleaned up.
const BUILD_ID = String.raw`[0-9a-f]{12}(?:-[1-9][0-9]*-[1-9][0-9]*)?`;
const ENVIRONMENT_TAG = new RegExp(
  `^(development|staging|production)-${BUILD_ID}$`
);
const PREVIEW_TAG = new RegExp(`^pr-[1-9][0-9]*-${BUILD_ID}$`);
const GATE_TAG = new RegExp(`^${BUILD_ID}$`);

/** The retention group of a tag, or `undefined` for tags that are always kept. */
export function tagGroup(name: string): string | undefined {
  const environment = ENVIRONMENT_TAG.exec(name);
  if (environment) {
    return environment[1];
  }
  if (PREVIEW_TAG.test(name)) {
    return "preview";
  }
  if (GATE_TAG.test(name)) {
    return "gate";
  }
  return undefined;
}

/** Every app tag of pull request `prNumber`. */
export function selectPreviewTags(
  tags: readonly ITag[],
  prNumber: number
): string[] {
  const prefix = `pr-${String(prNumber)}-`;
  return tags
    .map((tag) => tag.name)
    .filter((name) => name.startsWith(prefix) && tagGroup(name) === "preview");
}

/** Tags outside the newest `keepNewest` of their group and older than `maxAgeDays`. */
export function selectExpiredTags(
  tags: readonly ITag[],
  now: Date,
  policy: IRetentionPolicy = {
    keepNewest: KEEP_NEWEST,
    maxAgeDays: MAX_AGE_DAYS,
  }
): string[] {
  const cutoff = now.getTime() - policy.maxAgeDays * DAY_MS;
  const groups = new Map<string, ITag[]>();
  for (const tag of tags) {
    const group = tagGroup(tag.name);
    if (group !== undefined) {
      groups.set(group, [...(groups.get(group) ?? []), tag]);
    }
  }
  const expired: string[] = [];
  for (const members of groups.values()) {
    const newestFirst = [...members].sort(
      (a, b) => Date.parse(b.lastUpdated) - Date.parse(a.lastUpdated)
    );
    for (const tag of newestFirst.slice(policy.keepNewest)) {
      if (Date.parse(tag.lastUpdated) < cutoff) {
        expired.push(tag.name);
      }
    }
  }
  return expired.sort();
}

interface ITagPage {
  readonly next?: string | null;
  readonly results?: readonly {
    readonly name: string;
    readonly last_updated?: string | null;
  }[];
}

export interface IDockerHubClient {
  listTags(repository: string): Promise<ITag[]>;
  deleteTag(repository: string, tag: string): Promise<void>;
}

/** Exchanges the access token for a short-lived bearer token, then lists or deletes tags. */
export async function createDockerHubClient(
  namespace: string,
  token: string,
  fetchImpl: typeof fetch = fetch
): Promise<IDockerHubClient> {
  const login = await fetchImpl(`${HUB}/v2/auth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identifier: namespace, secret: token }),
  });
  if (!login.ok) {
    throw new DockerHubError(
      `Docker Hub login failed with status ${String(login.status)}`
    );
  }
  const { access_token: bearer } = (await login.json()) as {
    access_token?: string;
  };
  if (!bearer) {
    throw new DockerHubError("Docker Hub login returned no access token");
  }
  const authorization = { authorization: `Bearer ${bearer}` };
  const repositoryUrl = (repository: string): string =>
    `${HUB}/v2/namespaces/${encodeURIComponent(namespace)}/repositories/${encodeURIComponent(repository)}`;

  return {
    async listTags(repository) {
      const tags: ITag[] = [];
      let url: string | null | undefined =
        `${repositoryUrl(repository)}/tags?page_size=100`;
      while (url) {
        if (!url.startsWith(`${HUB}/`)) {
          throw new DockerHubError(
            "Docker Hub returned an unexpected next page"
          );
        }
        const response: Response = await fetchImpl(url, {
          headers: authorization,
        });
        if (response.status === 404) {
          return tags;
        }
        if (!response.ok) {
          throw new DockerHubError(
            `listing ${repository} tags failed with status ${String(response.status)}`
          );
        }
        const page = (await response.json()) as ITagPage;
        for (const result of page.results ?? []) {
          tags.push({
            name: result.name,
            lastUpdated: result.last_updated ?? "",
          });
        }
        url = page.next;
      }
      return tags;
    },
    async deleteTag(repository, tag) {
      const response = await fetchImpl(
        `${repositoryUrl(repository)}/tags/${encodeURIComponent(tag)}`,
        { method: "DELETE", headers: authorization }
      );
      if (!response.ok && response.status !== 404) {
        throw new DockerHubError(
          `deleting ${repository}:${tag} failed with status ${String(response.status)}`
        );
      }
    },
  };
}

export type CleanupCommand =
  | { readonly kind: "preview"; readonly prNumber: number }
  | { readonly kind: "prune" };

export function parseCommand(args: readonly string[]): CleanupCommand {
  const [kind, value] = args;
  if (
    kind === "preview" &&
    value !== undefined &&
    /^[1-9][0-9]*$/.test(value)
  ) {
    return { kind, prNumber: Number(value) };
  }
  if (kind === "prune" && value === undefined) {
    return { kind };
  }
  throw new DockerHubError(
    "usage: node scripts/deploy/dockerhub-tags.ts <preview <pr number>|prune>"
  );
}

/** Deletes (or, with `dryRun`, lists) the selected tags. Returns `repository:tag` lines. */
export async function cleanup(
  client: IDockerHubClient,
  command: CleanupCommand,
  now: Date,
  dryRun: boolean
): Promise<string[]> {
  const plan: [string, string[]][] = [];
  if (command.kind === "preview") {
    plan.push([
      APP_REPOSITORY,
      selectPreviewTags(
        await client.listTags(APP_REPOSITORY),
        command.prNumber
      ),
    ]);
  } else {
    for (const repository of [APP_REPOSITORY, GATE_REPOSITORY]) {
      plan.push([
        repository,
        selectExpiredTags(await client.listTags(repository), now),
      ]);
    }
  }
  const deleted: string[] = [];
  for (const [repository, tags] of plan) {
    for (const tag of tags) {
      if (!dryRun) {
        await client.deleteTag(repository, tag);
      }
      deleted.push(`${repository}:${tag}`);
    }
  }
  return deleted;
}

async function main(): Promise<void> {
  const command = parseCommand(process.argv.slice(2));
  const namespace = process.env.DOCKERHUB_USERNAME ?? "";
  const token = process.env.DOCKERHUB_CLEANUP_TOKEN ?? "";
  if (namespace === "" || token === "") {
    throw new DockerHubError(
      "DOCKERHUB_USERNAME and DOCKERHUB_CLEANUP_TOKEN are required"
    );
  }
  const dryRun = process.env.DRY_RUN === "1";
  const client = await createDockerHubClient(namespace, token);
  const deleted = await cleanup(client, command, new Date(), dryRun);
  for (const line of deleted) {
    console.warn(`${dryRun ? "would delete" : "deleted"} ${line}`);
  }
  console.warn(
    `${String(deleted.length)} tag(s) ${dryRun ? "selected" : "deleted"}.`
  );
}

if (import.meta.main) {
  await main();
}
