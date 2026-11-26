// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  cleanup,
  createDockerHubClient,
  DockerHubError,
  parseCommand,
  selectExpiredTags,
  selectPreviewTags,
  tagGroup,
} from "./dockerhub-tags.ts";

import type { IDockerHubClient, ITag } from "./dockerhub-tags.ts";

const SHA = "0123456789ab";
const NOW = new Date("2026-11-26T12:00:00Z");
const TOKEN = "dckr_pat_secret-value";

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

function sha(index: number): string {
  return index.toString(16).padStart(12, "0");
}

describe("tagGroup", () => {
  it.each([
    [`development-${SHA}`, "development"],
    [`staging-${SHA}`, "staging"],
    [`production-${SHA}`, "production"],
    [`pr-12-${SHA}`, "preview"],
    [SHA, "gate"],
    ["v1.0.0", undefined],
    ["latest", undefined],
    [`pr-0-${SHA}`, undefined],
    [`development-${SHA}0`, undefined],
    [`development-${SHA}-16000000001-1`, "development"],
    [`production-${SHA}-16000000001-12`, "production"],
    [`pr-12-${SHA}-16000000001-2`, "preview"],
    [`${SHA}-16000000001-1`, "gate"],
    [`${SHA}-16000000001`, undefined],
    [`${SHA}-0-1`, undefined],
    [`pr-12-${SHA}-16000000001-1-extra`, undefined],
  ])("%s belongs to %s", (name, group) => {
    expect(tagGroup(name)).toBe(group);
  });
});

describe("selectPreviewTags", () => {
  it("selects the tags of one pull request only", () => {
    const tags: ITag[] = [
      { name: `pr-1-${SHA}`, lastUpdated: daysAgo(1) },
      { name: `pr-1-${sha(2)}`, lastUpdated: daysAgo(1) },
      { name: `pr-1-${sha(3)}-16000000001-1`, lastUpdated: daysAgo(1) },
      { name: `pr-12-${SHA}-16000000001-1`, lastUpdated: daysAgo(1) },
      { name: `pr-12-${SHA}`, lastUpdated: daysAgo(1) },
      { name: `development-${SHA}`, lastUpdated: daysAgo(1) },
      { name: "pr-1-notasha", lastUpdated: daysAgo(1) },
    ];

    expect(selectPreviewTags(tags, 1)).toStrictEqual([
      `pr-1-${SHA}`,
      `pr-1-${sha(2)}`,
      `pr-1-${sha(3)}-16000000001-1`,
    ]);
  });
});

describe("selectExpiredTags", () => {
  it("keeps the 10 newest per group and deletes older ones past 30 days", () => {
    // Index 0 is the newest. 10, 11 and 12 fall outside the newest ten, but only 12 is older
    // than 30 days.
    const development = Array.from({ length: 13 }, (_, index) => ({
      name: `development-${sha(index)}`,
      lastUpdated: daysAgo(index === 12 ? 45 : index),
    }));
    const tags: ITag[] = [
      ...development,
      // Old, but the only staging tag: within its group's newest ten.
      { name: `staging-${SHA}`, lastUpdated: daysAgo(400) },
      { name: "v1.0.0", lastUpdated: daysAgo(400) },
      { name: "latest", lastUpdated: daysAgo(400) },
    ];

    expect(selectExpiredTags(tags, NOW)).toStrictEqual([
      `development-${sha(12)}`,
    ]);
  });

  it("accepts a custom policy", () => {
    const tags: ITag[] = [
      { name: sha(1), lastUpdated: daysAgo(3) },
      { name: sha(2), lastUpdated: daysAgo(2) },
    ];

    expect(
      selectExpiredTags(tags, NOW, { keepNewest: 1, maxAgeDays: 1 })
    ).toStrictEqual([sha(1)]);
  });
});

type Route = (url: string, init: RequestInit) => Response;

function hub(route: Route): {
  readonly fetch: typeof fetch;
  readonly requests: { url: string; init: RequestInit }[];
} {
  const requests: { url: string; init: RequestInit }[] = [];
  const impl = (input: string | URL | Request, init: RequestInit = {}) => {
    const url = input instanceof Request ? input.url : input.toString();
    requests.push({ url, init });
    return Promise.resolve(route(url, init));
  };
  return { fetch: impl, requests };
}

const LOGIN = "https://hub.docker.com/v2/auth/token";
const TAGS =
  "https://hub.docker.com/v2/namespaces/someone/repositories/moliveda-web/tags";

describe("createDockerHubClient", () => {
  it("logs in, follows pagination and deletes with the bearer token", async () => {
    const { fetch, requests } = hub((url, init) => {
      if (url === LOGIN) {
        return Response.json({ access_token: "bearer-1" });
      }
      if (url === `${TAGS}?page_size=100`) {
        return Response.json({
          next: `${TAGS}?page=2&page_size=100`,
          results: [{ name: "a", last_updated: daysAgo(1) }],
        });
      }
      if (url === `${TAGS}?page=2&page_size=100`) {
        return Response.json({
          next: null,
          results: [{ name: "b", last_updated: null }],
        });
      }
      if (init.method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      return new Response(null, { status: 500 });
    });

    const client = await createDockerHubClient("someone", TOKEN, fetch);

    expect(await client.listTags("moliveda-web")).toStrictEqual([
      { name: "a", lastUpdated: daysAgo(1) },
      { name: "b", lastUpdated: "" },
    ]);
    await client.deleteTag("moliveda-web", `pr-1-${SHA}`);

    expect(JSON.parse(requests[0]?.init.body as string)).toStrictEqual({
      identifier: "someone",
      secret: TOKEN,
    });
    expect(requests.slice(1).map(({ init }) => init.headers)).toStrictEqual([
      { authorization: "Bearer bearer-1" },
      { authorization: "Bearer bearer-1" },
      { authorization: "Bearer bearer-1" },
    ]);
    expect(requests[3]?.url).toBe(`${TAGS}/pr-1-${SHA}`);
  });

  it("treats a missing repository and an already deleted tag as empty", async () => {
    const { fetch } = hub((url) =>
      url === LOGIN
        ? Response.json({ access_token: "bearer-1" })
        : new Response(null, { status: 404 })
    );
    const client = await createDockerHubClient("someone", TOKEN, fetch);

    expect(await client.listTags("moliveda-web")).toStrictEqual([]);
    await expect(
      client.deleteTag("moliveda-web", "x")
    ).resolves.toBeUndefined();
  });

  it("reads a page without results", async () => {
    const { fetch } = hub((url) =>
      url === LOGIN
        ? Response.json({ access_token: "bearer-1" })
        : Response.json({})
    );
    const client = await createDockerHubClient("someone", TOKEN, fetch);

    expect(await client.listTags("moliveda-web")).toStrictEqual([]);
  });

  it("fails without leaking the token", async () => {
    const failures: [string, Route][] = [
      [
        "login failed with status 401",
        () => new Response(null, { status: 401 }),
      ],
      ["returned no access token", () => Response.json({})],
    ];
    for (const [message, route] of failures) {
      const attempt = createDockerHubClient("someone", TOKEN, hub(route).fetch);

      await expect(attempt).rejects.toThrow(message);
      await expect(attempt).rejects.not.toThrow(TOKEN);
    }
  });

  it("reports failed list and delete calls, and refuses foreign next pages", async () => {
    let next = "https://evil.example/tags";
    const { fetch } = hub((url, init) => {
      if (url === LOGIN) {
        return Response.json({ access_token: "bearer-1" });
      }
      if (init.method === "DELETE") {
        return new Response(null, { status: 500 });
      }
      if (url.includes("moliveda-web-gate")) {
        return new Response(null, { status: 503 });
      }
      return Response.json({ next, results: [] });
    });
    const client = await createDockerHubClient("someone", TOKEN, fetch);

    await expect(client.listTags("moliveda-web")).rejects.toThrow(
      "unexpected next page"
    );
    next = "";
    await expect(client.listTags("moliveda-web-gate")).rejects.toThrow(
      "listing moliveda-web-gate tags failed with status 503"
    );
    await expect(client.deleteTag("moliveda-web", "x")).rejects.toThrow(
      "deleting moliveda-web:x failed with status 500"
    );
  });
});

function fakeClient(tags: Record<string, ITag[]>): {
  readonly client: IDockerHubClient;
  readonly deleted: string[];
} {
  const deleted: string[] = [];
  return {
    deleted,
    client: {
      listTags: (repository) => Promise.resolve(tags[repository] ?? []),
      deleteTag: (repository, tag) => {
        deleted.push(`${repository}:${tag}`);
        return Promise.resolve();
      },
    },
  };
}

describe("cleanup", () => {
  const tags = {
    "moliveda-web": [
      { name: `pr-3-${SHA}`, lastUpdated: daysAgo(1) },
      ...Array.from({ length: 11 }, (_, index) => ({
        name: `staging-${sha(index)}`,
        lastUpdated: daysAgo(40 + index),
      })),
    ],
    "moliveda-web-gate": Array.from({ length: 12 }, (_, index) => ({
      name: sha(index),
      lastUpdated: daysAgo(40 + index),
    })),
  };

  it("deletes a pull request's app tags", async () => {
    const { client, deleted } = fakeClient(tags);

    expect(
      await cleanup(client, { kind: "preview", prNumber: 3 }, NOW, false)
    ).toStrictEqual([`moliveda-web:pr-3-${SHA}`]);
    expect(deleted).toStrictEqual([`moliveda-web:pr-3-${SHA}`]);
  });

  it("prunes both repositories, and only lists with a dry run", async () => {
    const { client, deleted } = fakeClient(tags);

    const selected = await cleanup(client, { kind: "prune" }, NOW, true);

    expect(selected).toStrictEqual([
      `moliveda-web:staging-${sha(10)}`,
      `moliveda-web-gate:${sha(10)}`,
      `moliveda-web-gate:${sha(11)}`,
    ]);
    expect(deleted).toStrictEqual([]);
  });
});

describe("parseCommand", () => {
  it("parses both commands", () => {
    expect(parseCommand(["preview", "42"])).toStrictEqual({
      kind: "preview",
      prNumber: 42,
    });
    expect(parseCommand(["prune"])).toStrictEqual({ kind: "prune" });
  });

  it.each([
    [[]],
    [["preview"]],
    [["preview", "0"]],
    [["prune", "1"]],
    [["delete"]],
  ])("rejects %j", (args) => {
    expect(() => parseCommand(args)).toThrow(DockerHubError);
  });
});
