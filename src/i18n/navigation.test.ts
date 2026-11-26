// @vitest-environment node
import { describe, expect, it } from "vitest";

import { getPathname } from "@/i18n/navigation";

describe("navigation", () => {
  it.each([
    ["en", "/", "/en"],
    ["pt", "/experience", "/pt/experience"],
  ] as const)("prefixes %s paths: %s", (locale, href, expected) => {
    expect(getPathname({ locale, href })).toBe(expected);
  });
});
