import { render, screen, waitFor } from "@testing-library/react";
import { domAnimation, m } from "framer-motion";
import { afterEach, describe, expect, it, vi } from "vitest";

import { loadMotionFeatures, Providers } from "@/components/layout/providers";

// jsdom has no matchMedia; next-themes reads the colour scheme from it.
function preferColorScheme(scheme: "light" | "dark"): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query === "(prefers-color-scheme: dark)" && scheme === "dark",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      onchange: null,
      dispatchEvent: vi.fn(),
    }))
  );
}

describe("Providers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.className = "";
    document.documentElement.removeAttribute("style");
    localStorage.clear();
  });

  it("renders its children", () => {
    preferColorScheme("light");

    render(
      <Providers>
        <p>child</p>
      </Providers>
    );

    expect(screen.getByText("child")).toBeInTheDocument();
  });

  it.each(["light", "dark"] as const)(
    "applies the system %s theme as a class",
    async (scheme) => {
      preferColorScheme(scheme);

      render(
        <Providers>
          <p>child</p>
        </Providers>
      );

      await waitFor(() => {
        expect(document.documentElement).toHaveClass(scheme);
      });
    }
  );

  it("renders lazy motion components", () => {
    preferColorScheme("light");

    render(
      <Providers>
        <m.p>animated</m.p>
      </Providers>
    );

    expect(screen.getByText("animated")).toBeInTheDocument();
  });
});

describe("loadMotionFeatures", () => {
  it("loads the domAnimation features", async () => {
    await expect(loadMotionFeatures()).resolves.toBe(domAnimation);
  });
});
