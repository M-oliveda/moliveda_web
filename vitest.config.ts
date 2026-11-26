import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
    // `server-only` throws outside the `react-server` condition; Vitest runs
    // server modules directly, so it resolves to the package's empty build.
    alias: {
      "server-only": fileURLToPath(
        new URL("node_modules/server-only/empty.js", import.meta.url)
      ),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: [
      "src/**/*.test.{ts,tsx}",
      "scripts/**/*.test.ts",
      "infra/**/*.test.ts",
    ],
    exclude: [...configDefaults.exclude, "e2e/**"],
    restoreMocks: true,
    server: {
      deps: {
        // next-intl imports `next/server` without an extension, which Node's
        // ESM loader cannot resolve; let Vite transform it instead.
        inline: ["next-intl"],
      },
    },
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      // File-level exclusions only (MASTERPLAN section 7). Every entry says why.
      exclude: [
        // Tests themselves.
        "src/**/*.test.{ts,tsx}",
        // Test-only helpers (msw server, setup, stubs).
        "src/test/**",
        // Type-only modules: nothing runs.
        "src/types/**",
        "src/**/*.d.ts",
        // Thin framework wrappers that delegate to tested units. Async Server
        // Components cannot render in Vitest; Playwright exercises them.
        "src/app/**/page.tsx",
        "src/app/**/layout.tsx",
        "src/app/global-not-found.tsx",
        // Probe wrappers: `connection()` needs a live request scope. The
        // responses come from src/lib/health.ts (tested); Playwright and the
        // docker job call the routes themselves.
        "src/app/health/route.ts",
        "src/app/ready/route.ts",
        // Boot hooks; the validation they trigger is tested in env.test.ts.
        "src/instrumentation.ts",
        "src/instrumentation.node.ts",
      ],
      reporter: ["text", "html", "lcov", "json-summary"],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
