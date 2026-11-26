import { expect, test } from "@playwright/test";

import { E2E_ORIGIN_SECRET, PRODUCTION_URL } from "./production-server";

// Origin guard against a production-mode server (D34, MASTERPLAN section 7).
// The current/previous rotation is covered by src/lib/origin-guard.test.ts.
test.describe("origin guard in production", () => {
  for (const path of ["/health", "/ready"]) {
    test(`${path} is exempt`, async ({ request }) => {
      const response = await request.get(`${PRODUCTION_URL}${path}`);

      expect(response.status()).toBe(200);
    });
  }

  test("a request without the header gets 403 and no body", async ({
    request,
  }) => {
    const response = await request.get(`${PRODUCTION_URL}/`);

    expect(response.status()).toBe(403);
    expect(await response.text()).toBe("");
  });

  test("a request with a wrong secret gets 403", async ({ request }) => {
    const response = await request.get(`${PRODUCTION_URL}/`, {
      headers: { "X-Origin-Verify": "w".repeat(48) },
    });

    expect(response.status()).toBe(403);
  });

  test("a request with the secret is served", async ({ request }) => {
    const response = await request.get(`${PRODUCTION_URL}/`, {
      headers: { "X-Origin-Verify": E2E_ORIGIN_SECRET },
    });

    expect(response.status()).toBe(200);
  });
});
