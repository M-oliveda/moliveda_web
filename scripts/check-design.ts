/**
 * `npm run check:design`: fails on color classes that bypass the DESIGN.md
 * tokens. Two patterns are rejected in source files under `src/`:
 *
 * - arbitrary color values, such as `bg-[#fff]` or `text-[rgb(0,0,0)]`;
 * - `dark:` color prefixes, because every color has a semantic token that
 *   already switches with the theme.
 *
 * Runs with Node's built-in type stripping: `node scripts/check-design.ts`.
 */
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

export interface IDesignViolation {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly match: string;
  readonly reason: string;
}

const COLOR_UTILITIES =
  "bg|text|border(?:-[trblxyse])?|ring(?:-offset)?|outline|fill|stroke|from|via|to|decoration|shadow|accent|caret|divide|placeholder";

const ARBITRARY_COLOR = new RegExp(
  String.raw`(?<![\w-])(?:${COLOR_UTILITIES})-\[(?:#[0-9a-fA-F]{3,8}|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\()[^\]]*\]`,
  "g"
);

const DARK_COLOR_PREFIX = new RegExp(
  String.raw`(?<![\w-])dark:(?:[\w-]+:)*(?:${COLOR_UTILITIES})-[^\s"'\x60]+`,
  "g"
);

const RULES: readonly { readonly pattern: RegExp; readonly reason: string }[] =
  [
    {
      pattern: ARBITRARY_COLOR,
      reason: "arbitrary color value; use a DESIGN.md token",
    },
    {
      pattern: DARK_COLOR_PREFIX,
      reason: "`dark:` color prefix; use a semantic token",
    },
  ];

const SOURCE_FILE = /\.(?:ts|tsx|js|jsx|mdx)$/;

export function findDesignViolations(
  file: string,
  source: string
): IDesignViolation[] {
  const violations: IDesignViolation[] = [];
  const lines = source.split("\n");

  lines.forEach((text, index) => {
    for (const { pattern, reason } of RULES) {
      for (const found of text.matchAll(pattern)) {
        violations.push({
          file,
          line: index + 1,
          column: found.index + 1,
          match: found[0],
          reason,
        });
      }
    }
  });

  return violations;
}

export function formatViolation(violation: IDesignViolation): string {
  return `${violation.file}:${String(violation.line)}:${String(violation.column)} ${violation.match} (${violation.reason})`;
}

async function listSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, {
    recursive: true,
    withFileTypes: true,
  });
  return entries
    .filter((entry) => entry.isFile() && SOURCE_FILE.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name));
}

async function main(): Promise<void> {
  const root = process.cwd();
  const files = await listSourceFiles(join(root, "src"));
  const violations = (
    await Promise.all(
      files.map(async (file) =>
        findDesignViolations(relative(root, file), await readFile(file, "utf8"))
      )
    )
  ).flat();

  if (violations.length > 0) {
    console.error(violations.map(formatViolation).join("\n"));
    console.error(
      `check:design found ${String(violations.length)} violation(s).`
    );
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  await main();
}
