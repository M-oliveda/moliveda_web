// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { IAppRequestConfig } from "@/i18n/request-config";

// Framework boundaries only: the `[locale]` root param, `notFound()` and the
// next-intl wrapper, which needs the react-server condition.
const { rootLocale, notFound } = vi.hoisted(() => ({
  rootLocale: vi.fn<() => Promise<string>>(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("next/root-params", () => ({ locale: rootLocale }));
vi.mock("next/navigation", () => ({ notFound }));
vi.mock("next-intl/server", () => ({
  getRequestConfig: (create: unknown) => create,
}));

type CreateConfig = (params: { locale?: string }) => Promise<IAppRequestConfig>;

async function loadRequestConfig(): Promise<CreateConfig> {
  const { default: create } = await import("@/i18n/request");
  return create as unknown as CreateConfig;
}

describe("i18n request config", () => {
  beforeEach(() => {
    rootLocale.mockReset();
    notFound.mockClear();
    // The default logger validates the environment; do not rely on the shell.
    vi.stubEnv("APP_ENV", "local");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the [locale] root param", async () => {
    rootLocale.mockResolvedValue("pt");
    const create = await loadRequestConfig();

    const config = await create({});

    expect(config.locale).toBe("pt");
    expect(config.messages.UI.theme.dark).toBe("Escuro");
  });

  it("prefers an explicit locale", async () => {
    const create = await loadRequestConfig();

    const config = await create({ locale: "fr" });

    expect(config.locale).toBe("fr");
    expect(rootLocale).not.toHaveBeenCalled();
  });

  it("answers 404 for an unknown locale", async () => {
    rootLocale.mockResolvedValue("de");
    const create = await loadRequestConfig();

    await expect(create({})).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalledOnce();
  });
});
