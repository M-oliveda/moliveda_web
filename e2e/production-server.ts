// The second Playwright web server runs the build with APP_ENV=production
// (playwright.config.ts). The secret is a fixed, test-only value with no use
// outside this server.
export const PRODUCTION_PORT = 3101;
export const PRODUCTION_URL = `http://127.0.0.1:${String(PRODUCTION_PORT)}`;
export const E2E_ORIGIN_SECRET = "e2e-only-origin-secret-".padEnd(48, "0");
