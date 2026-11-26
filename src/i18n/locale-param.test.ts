// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { toAppLocale } from "@/i18n/locale-param";

const { notFound } = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("next/navigation", () => ({ notFound }));

describe("toAppLocale", () => {
  it("returns a supported locale", () => {
    expect(toAppLocale("pt")).toBe("pt");
  });

  it("answers 404 for an unknown locale", () => {
    expect(() => toAppLocale("de")).toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalledOnce();
  });
});
