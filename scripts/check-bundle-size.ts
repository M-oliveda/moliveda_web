/**
 * `npm run check:bundle`: gzipped JavaScript that each prerendered route loads
 * on first visit, compared with the budgets in `bundle-budget.json`
 * (MASTERPLAN 4.9). Run it after `npm run build`.
 *
 * The scripts are read from the prerendered HTML in `.next/server/app`, so the
 * check does not depend on the bundler's manifest format. `nomodule` scripts
 * (legacy polyfills) are skipped because modern browsers never load them.
 */
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { gzipSync } from "node:zlib";

export interface IRouteSize {
  readonly route: string;
  readonly scripts: readonly string[];
  readonly gzipBytes: number;
}

export interface IBundleBudget {
  readonly routes: Readonly<Record<string, number>>;
}

export interface IBudgetResult {
  readonly route: string;
  readonly gzipBytes: number;
  readonly maxGzipBytes: number | undefined;
  readonly ok: boolean;
}

const SCRIPT_TAG = /<script\b[^>]*>/g;
const SRC_ATTRIBUTE = /\bsrc="([^"]+)"/;
const NOMODULE_ATTRIBUTE = /\bnomodule\b/i;

export function extractScriptSources(html: string): string[] {
  const sources: string[] = [];
  for (const [tag] of html.matchAll(SCRIPT_TAG)) {
    const src = SRC_ATTRIBUTE.exec(tag)?.[1];
    if (src?.startsWith("/_next/") && !NOMODULE_ATTRIBUTE.test(tag)) {
      sources.push(src);
    }
  }
  return [...new Set(sources)];
}

/** Maps `.next/server/app/experience.html` to `/experience`. */
export function routeFromHtmlPath(htmlPath: string): string {
  const path = htmlPath
    .split(sep)
    .join("/")
    .replace(/\.html$/, "");
  return path === "index" ? "/" : `/${path.replace(/\/index$/, "")}`;
}

/**
 * Next.js internals (`/_not-found`, `/_global-error`) and the fallback shells of
 * dynamic segments (`/[locale]`) are not routes a visitor loads.
 */
export function isSiteRoute(route: string): boolean {
  return !route
    .split("/")
    .some((segment) => segment.startsWith("_") || segment.startsWith("["));
}

export function checkBudgets(
  sizes: readonly IRouteSize[],
  budget: IBundleBudget
): IBudgetResult[] {
  return sizes.map(({ route, gzipBytes }) => {
    const maxGzipBytes = budget.routes[route];
    return {
      route,
      gzipBytes,
      maxGzipBytes,
      ok: maxGzipBytes !== undefined && gzipBytes <= maxGzipBytes,
    };
  });
}

export function formatResult(result: IBudgetResult): string {
  const size = `${(result.gzipBytes / 1024).toFixed(1)} kB`;
  if (result.maxGzipBytes === undefined) {
    return `FAIL ${result.route}: ${size} gzip, no budget in bundle-budget.json`;
  }
  const max = `${(result.maxGzipBytes / 1024).toFixed(1)} kB`;
  return `${result.ok ? "ok  " : "FAIL"} ${result.route}: ${size} gzip (budget ${max})`;
}

async function measureRoutes(nextDir: string): Promise<IRouteSize[]> {
  const appDir = join(nextDir, "server", "app");
  const entries = await readdir(appDir, { recursive: true });
  const htmlFiles = entries.filter((entry) => entry.endsWith(".html"));
  const gzipCache = new Map<string, number>();

  const gzipSize = async (src: string): Promise<number> => {
    const cached = gzipCache.get(src);
    if (cached !== undefined) {
      return cached;
    }
    const file = join(
      nextDir,
      src.replace(/^\/_next\//, "").split("?")[0] ?? ""
    );
    const bytes = gzipSync(await readFile(file)).byteLength;
    gzipCache.set(src, bytes);
    return bytes;
  };

  const sizes: IRouteSize[] = [];
  for (const htmlFile of htmlFiles) {
    const route = routeFromHtmlPath(relative(appDir, join(appDir, htmlFile)));
    if (!isSiteRoute(route)) {
      continue;
    }
    const scripts = extractScriptSources(
      await readFile(join(appDir, htmlFile), "utf8")
    );
    const bytes = await Promise.all(scripts.map(gzipSize));
    sizes.push({
      route,
      scripts,
      gzipBytes: bytes.reduce((total, size) => total + size, 0),
    });
  }
  return sizes.sort((a, b) => a.route.localeCompare(b.route));
}

async function main(): Promise<void> {
  const root = process.cwd();
  const budget = JSON.parse(
    await readFile(join(root, "bundle-budget.json"), "utf8")
  ) as IBundleBudget;
  const results = checkBudgets(
    await measureRoutes(join(root, ".next")),
    budget
  );

  for (const result of results) {
    (result.ok ? console.warn : console.error)(formatResult(result));
  }
  if (results.length === 0 || results.some((result) => !result.ok)) {
    console.error(
      "check:bundle failed. Run `npm run build` first, and raise a budget only in a reviewed change."
    );
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  await main();
}
