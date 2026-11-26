import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// WCAG 2.0 to 2.2 A/AA plus best practices (MASTERPLAN section 7).
const AXE_TAGS = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22aa",
  "best-practice",
];

test("the home page renders a single h1 inside main", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
});

test("the home page has no axe violations", async ({ page }) => {
  await page.goto("/");

  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();

  expect(results.violations).toStrictEqual([]);
});

test("/health answers ok and is never cached", async ({ request }) => {
  const response = await request.get("/health");

  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  expect(await response.json()).toStrictEqual({ status: "ok" });
});

test("/ready answers ready and is never cached", async ({ request }) => {
  const response = await request.get("/ready");

  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  expect(await response.json()).toStrictEqual({ status: "ready" });
});

test("responses do not advertise the framework", async ({ request }) => {
  const response = await request.get("/");

  expect(response.headers()["x-powered-by"]).toBeUndefined();
});
