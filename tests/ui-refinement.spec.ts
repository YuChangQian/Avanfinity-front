import { test, expect } from "@playwright/test";
import { useStylePreviewApi } from "./ui-preview-api";

test.beforeEach(async ({ page }) => useStylePreviewApi(page));
for (const width of [1440, 390]) {
  test(`finance filters have gutters and preserve submitted values at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/finance");
    const form = page.getByTestId("wallet-ledger-filter");
    const padding = await form.evaluate(element => {
      const css = getComputedStyle(element);
      return [parseFloat(css.paddingLeft), parseFloat(css.paddingRight)];
    });
    expect(Math.min(...padding)).toBeGreaterThanOrEqual(16);
    const input = form.getByRole("textbox", { name: "关键词" });
    await input.fill("OPENAI");
    const request = page.waitForRequest(r => new URL(r.url()).pathname === "/api/wallet/transactions" && new URL(r.url()).searchParams.get("q") === "OPENAI");
    await form.getByRole("button", { name: "筛选", exact: true }).click();
    await request;
    await form.getByRole("button", { name: "重置", exact: true }).click();
    await expect(input).toHaveValue("");
    const boxes = await form.locator("select, input").evaluateAll(elements => elements.map(element => {
      const rect = element.getBoundingClientRect(); const css = getComputedStyle(element);
      return { height: rect.height, padding: parseFloat(css.paddingLeft) };
    }));
    expect(boxes.every(box => box.height >= 40 && box.padding >= 10)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`finance-${width}.png`), fullPage: true });
  });

  test(`points exchange card stays compact at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/rewards");
    const balance = page.locator(".rewards-balance");
    await expect(balance).toContainText("120");
    expect((await balance.boundingBox())!.height).toBeLessThan(width > 600 ? 240 : 280);
    await expect(page.getByTestId("checkin-card").locator(".checkin-calendar")).toBeVisible();
    await page.screenshot({ path: test.info().outputPath(`rewards-${width}.png`), fullPage: true });
  });

  test(`API permission checkboxes remain compact and editable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/developer");
    const scopes = page.locator(".developer-keys .developer-scopes");
    const checkbox = scopes.getByRole("checkbox").first();
    await expect(checkbox).toBeVisible();
    expect((await checkbox.boundingBox())!.height).toBe(16);
    expect((await checkbox.boundingBox())!.width).toBe(16);
    await checkbox.check();
    await expect(checkbox).toBeChecked();
    await checkbox.uncheck();
    await expect(checkbox).not.toBeChecked();
    await expect(page.getByRole("navigation", { name: "API 页面导航" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator(".developer-keys").screenshot({ path: test.info().outputPath(`api-${width}.png`) });
  });

  test(`merged admin uses one sidebar and returns to the app at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/admin");
    await expect(page.getByTestId("admin-shell")).toBeVisible();
    await expect(page.getByTestId("app-sidebar")).toHaveCount(0);
    await expect(page.locator(".admin-local-sidebar")).toHaveCount(1);
    await expect(page.getByTestId("admin-nav-sms")).toBeVisible();
    await page.getByTestId("admin-nav-funds").click();
    await expect(page.getByTestId("admin-deposit-table")).toBeVisible();
    if (width < 600) await page.getByTestId("admin-mobile-menu").click();
    await expect(page.getByTestId("admin-back-to-app")).toBeVisible();
    await page.screenshot({ path: test.info().outputPath(`admin-${width}.png`), fullPage: true });
    await page.getByTestId("admin-back-to-app").click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByTestId("app-sidebar")).toHaveCount(1);
  });
}

test("admin pricing failure never substitutes demonstration fees", async ({ page }) => {
  await page.route("**/api/admin/pricing", route => route.fulfill({ status: 503, json: { error: "unavailable" } }));
  await page.goto("/admin?panel=tiers");
  const panel = page.getByTestId("admin-panel-tiers");
  await expect(panel.getByRole("alert")).toBeVisible();
  await expect(panel.locator(".pricing-tier-card")).toHaveCount(0);
  await expect(panel.getByText("静态预览", { exact: false })).toHaveCount(0);
});
