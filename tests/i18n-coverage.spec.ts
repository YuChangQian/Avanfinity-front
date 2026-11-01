import { test, expect } from "@playwright/test";
import { useStylePreviewApi } from "./ui-preview-api";

test.beforeEach(async ({ page }) => {
  await useStylePreviewApi(page);
  await page.addInitScript(() => localStorage.setItem("language", "en"));
});

test("English navigation, overview, card ledger and API settings are translated", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("link", { name: "SMS verification", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Balance and spending · 30 days", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Card transactions", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Card transactions");
  await expect(page.getByRole("button", { name: "Search", exact: true })).toBeVisible();
  await page.goto("/developer");
  await expect(page.getByRole("navigation", { name: "API page navigation" })).toBeVisible();
  expect(await page.locator(".developer-scopes").allTextContents()).not.toEqual(expect.arrayContaining([expect.stringMatching(/\p{Script=Han}/u)]));
  await expect(page.locator(".openapi-operation").first()).toBeVisible();
  expect((await page.locator(".openapi-operation-copy strong").allTextContents()).join(" ")).not.toMatch(/\p{Script=Han}/u);
});

for (const width of [1440, 390]) {
  test(`English pages remain usable at ${width}px`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    for (const route of ["dashboard", "cards", "card-transactions", "finance", "deposit", "sms", "tg-direct", "cdk-v2", "redeem", "tg-cdk/redeem", "rewards", "developer", "settings", "admin", "terms", "user-agreement"]) {
      await page.goto(`/${route}`);
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), { message: route }).toBe(true);
      if (["sms", "admin", "developer", "card-transactions"].includes(route)) await page.screenshot({ path: test.info().outputPath(`english-${route}-${width}.png`), fullPage: true });
    }
    expect(errors).toEqual([]);
  });
}

test("English SMS country names and language switching follow the selected locale", async ({ page }) => {
  await page.goto("/sms");
  await expect(page.getByText("Indonesia", { exact: true }).first()).toBeVisible();
  await expect(page.locator(".sms-history")).not.toContainText(/订单历史|查看订单|暂无收码订单/);
  await page.getByRole("button", { name: "Chinese", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.getByText("印度尼西亚", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByText("Indonesia", { exact: true }).first()).toBeVisible();
});

test("English errors use translated floating notifications", async ({ page }) => {
  await page.route("**/api/admin/pricing", route => route.fulfill({ status: 503, json: { error: "unavailable" } }));
  await page.goto("/admin?panel=tiers");
  const toast = page.locator(".notification-stack").getByRole("alert");
  await expect(toast).toBeVisible();
  await expect(toast).not.toContainText(/\p{Script=Han}/u);
  await toast.getByRole("button", { name: "Dismiss notification", exact: true }).click();
  await expect(toast).toHaveCount(0);
});
