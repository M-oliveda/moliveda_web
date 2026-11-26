// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  checkBudgets,
  extractScriptSources,
  formatResult,
  isSiteRoute,
  routeFromHtmlPath,
} from "./check-bundle-size.ts";

describe("extractScriptSources", () => {
  it("returns each Next.js script once, skipping nomodule and inline scripts", () => {
    const html = [
      '<script src="/_next/static/chunks/a.js" async=""></script>',
      '<script src="/_next/static/chunks/polyfill.js" noModule=""></script>',
      '<script src="/_next/static/chunks/a.js"></script>',
      "<script>self.__next_f=[]</script>",
      '<script src="https://static.cloudflareinsights.com/beacon.min.js"></script>',
      '<script async src="/_next/static/chunks/b.js"></script>',
    ].join("");

    expect(extractScriptSources(html)).toStrictEqual([
      "/_next/static/chunks/a.js",
      "/_next/static/chunks/b.js",
    ]);
  });
});

describe("routeFromHtmlPath", () => {
  it.each([
    ["index.html", "/"],
    ["experience.html", "/experience"],
    ["en/index.html", "/en"],
    ["en/skills.html", "/en/skills"],
  ])("maps %s to %s", (path, route) => {
    expect(routeFromHtmlPath(path)).toBe(route);
  });
});

describe("isSiteRoute", () => {
  it.each([
    ["/", true],
    ["/en/skills", true],
    ["/_not-found", false],
    ["/_global-error", false],
    ["/[locale]", false],
    ["/[locale]/experience", false],
  ])("%s is a site route: %s", (route, expected) => {
    expect(isSiteRoute(route)).toBe(expected);
  });
});

describe("checkBudgets", () => {
  const budget = { routes: { "/": 1000, "/en": 2000 } };

  it("passes routes within their budget and fails the rest", () => {
    expect(
      checkBudgets(
        [
          { route: "/", scripts: [], gzipBytes: 1000 },
          { route: "/en", scripts: [], gzipBytes: 2001 },
          { route: "/new", scripts: [], gzipBytes: 10 },
        ],
        budget
      )
    ).toStrictEqual([
      { route: "/", gzipBytes: 1000, maxGzipBytes: 1000, ok: true },
      { route: "/en", gzipBytes: 2001, maxGzipBytes: 2000, ok: false },
      { route: "/new", gzipBytes: 10, maxGzipBytes: undefined, ok: false },
    ]);
  });
});

describe("formatResult", () => {
  it("prints the size against the budget", () => {
    expect(
      formatResult({
        route: "/",
        gzipBytes: 2048,
        maxGzipBytes: 4096,
        ok: true,
      })
    ).toBe("ok   /: 2.0 kB gzip (budget 4.0 kB)");
    expect(
      formatResult({
        route: "/",
        gzipBytes: 5120,
        maxGzipBytes: 4096,
        ok: false,
      })
    ).toBe("FAIL /: 5.0 kB gzip (budget 4.0 kB)");
  });

  it("explains a missing budget", () => {
    expect(
      formatResult({
        route: "/new",
        gzipBytes: 1024,
        maxGzipBytes: undefined,
        ok: false,
      })
    ).toBe("FAIL /new: 1.0 kB gzip, no budget in bundle-budget.json");
  });
});
