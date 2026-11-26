// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  parseOpenPullRequests,
  parseServices,
  selectStalePreviews,
} from "./stale-previews.ts";

const NOW = new Date("2026-11-26T12:00:00Z");

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

describe("parseServices", () => {
  it("keeps preview services only", () => {
    const json = [
      {
        metadata: { name: "moliveda-web-pr-3", creationTimestamp: daysAgo(1) },
      },
      { metadata: { name: "moliveda-web", creationTimestamp: daysAgo(1) } },
      { metadata: { name: "other-app-pr-3", creationTimestamp: daysAgo(1) } },
      { metadata: { name: "moliveda-web-pr-4" } },
      {},
    ];

    expect(parseServices(json)).toStrictEqual([
      { name: "moliveda-web-pr-3", createdAt: daysAgo(1) },
    ]);
  });

  it("rejects anything but an array", () => {
    expect(() => parseServices({})).toThrow("services.json must be an array");
  });
});

describe("parseOpenPullRequests", () => {
  it("reads the numbers", () => {
    expect(
      parseOpenPullRequests([{ number: 3 }, { number: "4" }, {}])
    ).toStrictEqual(new Set([3]));
  });

  it("rejects anything but an array", () => {
    expect(() => parseOpenPullRequests(null)).toThrow(
      "open-prs.json must be an array"
    );
  });
});

describe("selectStalePreviews", () => {
  it("selects closed pull requests and previews older than 14 days", () => {
    const services = [
      { name: "moliveda-web-pr-1", createdAt: daysAgo(1) }, // open, fresh
      { name: "moliveda-web-pr-2", createdAt: daysAgo(1) }, // closed
      { name: "moliveda-web-pr-3", createdAt: daysAgo(15) }, // open, too old
    ];

    expect(selectStalePreviews(services, new Set([1, 3]), NOW)).toStrictEqual([
      "moliveda-web-pr-2",
      "moliveda-web-pr-3",
    ]);
  });
});
