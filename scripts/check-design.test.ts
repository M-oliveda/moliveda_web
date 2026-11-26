// @vitest-environment node
import { describe, expect, it } from "vitest";

import { findDesignViolations, formatViolation } from "./check-design.ts";

describe("findDesignViolations", () => {
  it.each([
    "bg-[#fff]",
    "text-[#0A0908]",
    "border-[rgb(0,0,0)]",
    "border-t-[#abc]",
    "ring-offset-[hsl(0_0%_0%)]",
    "fill-[oklch(0.5_0.1_30)]",
    "hover:bg-[#123456]",
  ])("rejects the arbitrary color %s", (className) => {
    const [violation] = findDesignViolations(
      "a.tsx",
      `<div className="${className}" />`
    );

    expect(violation?.reason).toContain("arbitrary color");
  });

  it.each([
    "dark:bg-brand-950",
    "dark:text-white",
    "dark:hover:border-primary",
    "dark:ring-ring",
  ])("rejects the dark color prefix %s", (className) => {
    const [violation] = findDesignViolations(
      "a.tsx",
      `<div className="${className}" />`
    );

    expect(violation?.reason).toContain("`dark:` color prefix");
  });

  it.each([
    "bg-background text-foreground",
    "w-[320px] grid-cols-[1fr_2fr]",
    "dark:hidden dark:block",
    "text-sm border-2 ring-2",
    "focus-visible:ring-ring",
  ])("accepts %s", (className) => {
    expect(
      findDesignViolations("a.tsx", `<div className="${className}" />`)
    ).toStrictEqual([]);
  });

  it("reports the line and column of each match", () => {
    const source =
      'const a = "p-4";\nconst b = "p-2 bg-[#fff] dark:bg-red-500";';

    expect(findDesignViolations("src/b.ts", source)).toStrictEqual([
      {
        file: "src/b.ts",
        line: 2,
        column: 16,
        match: "bg-[#fff]",
        reason: "arbitrary color value; use a DESIGN.md token",
      },
      {
        file: "src/b.ts",
        line: 2,
        column: 26,
        match: "dark:bg-red-500",
        reason: "`dark:` color prefix; use a semantic token",
      },
    ]);
  });
});

describe("formatViolation", () => {
  it("prints file, position, match and reason", () => {
    expect(
      formatViolation({
        file: "src/a.tsx",
        line: 3,
        column: 7,
        match: "bg-[#fff]",
        reason: "arbitrary color value; use a DESIGN.md token",
      })
    ).toBe(
      "src/a.tsx:3:7 bg-[#fff] (arbitrary color value; use a DESIGN.md token)"
    );
  });
});
