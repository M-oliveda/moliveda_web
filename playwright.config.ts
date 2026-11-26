import { defineConfig, devices } from "@playwright/test";

import {
  E2E_ORIGIN_SECRET,
  PRODUCTION_PORT,
  PRODUCTION_URL,
} from "./e2e/production-server";

const PORT = 3100;
const BASE_URL = `http://127.0.0.1:${String(PORT)}`;
const IS_CI = Boolean(process.env.CI);

// Runs against the production build, never the dev server (MASTERPLAN section 7).
// CI runs the Chromium projects (`--project=chromium --project=mobile-chrome`);
// Firefox, WebKit and mobile Safari run locally and in the weekly workflow.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: IS_CI,
  retries: IS_CI ? 2 : 0,
  ...(IS_CI ? { workers: 1 } : {}),
  reporter: IS_CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chrome", use: { ...devices["Pixel 7"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "mobile-safari", use: { ...devices["iPhone 15"] } },
  ],
  webServer: [
    {
      command: "npm run start",
      env: { APP_ENV: "local", HOSTNAME: "127.0.0.1", PORT: String(PORT) },
      url: `${BASE_URL}/health`,
      reuseExistingServer: !IS_CI,
      timeout: 120_000,
    },
    // Same build with APP_ENV=production, for e2e/origin-guard.spec.ts. It
    // serves the standalone output directly: the spec needs no static assets,
    // and the copy step stays with the server above.
    {
      command: "node .next/standalone/server.js",
      env: {
        APP_ENV: "production",
        ORIGIN_VERIFY_SECRET: E2E_ORIGIN_SECRET,
        HOSTNAME: "127.0.0.1",
        PORT: String(PRODUCTION_PORT),
      },
      url: `${PRODUCTION_URL}/health`,
      reuseExistingServer: !IS_CI,
      timeout: 120_000,
    },
  ],
});
