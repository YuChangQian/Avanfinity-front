import { test, expect } from "@playwright/test";
import { useStylePreviewApi } from "./ui-preview-api";

test.use({ reducedMotion: "reduce" });

test.beforeEach(async ({ page }) => useStylePreviewApi(page));
for (const width of [1440, 390]) {
  test(`error floats above layout and survives navigation at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route("**/api/admin/pricing", route => route.fulfill({ status: 503, json: { error: "unavailable" } }));
    await page.goto("/admin?panel=tiers");
    const toast = page.locator(".notification-stack [role=alert]").first();
    await expect(toast).toBeVisible();
    await expect(page.locator("main [role=alert]")).toHaveCount(0);
    const box = await toast.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(12);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width - 12);
    expect(await page.locator(".notification-stack").evaluate(el => getComputedStyle(el).position)).toBe("fixed");
    if (width < 600) await page.getByTestId("admin-mobile-menu").click();
    await page.getByTestId("admin-back-to-app").click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(toast).toBeVisible();
    await page.screenshot({ path: test.info().outputPath(`floating-error-${width}.png`) });
    await toast.getByRole("button", { name: "关闭提示" }).click();
    await expect(toast).toHaveCount(0);
  });
}

test("success notifications survive client navigation and expire", async ({ page }) => {
  await page.route("**/api/points/redeem", route => route.fulfill({ json: { code: 0, data: { itemName: "USD 1", pointBalance: 0, walletBalance: "101", replayed: false } } }));
  await page.goto("/rewards");
  await page.getByRole("button", { name: "120 积分兑换 $1", exact: true }).click();
  const toast = page.locator(".notification-stack [role=status]").filter({ hasText: "积分兑换成功" });
  await expect(toast).toBeVisible();
  await page.getByRole("link", { name: "财务", exact: true }).click();
  await expect(page).toHaveURL(/\/finance$/);
  await expect(toast).toBeVisible();
  await expect(toast).toHaveCount(0, { timeout: 9_000 });
});

test("warning is floating and hover pauses dismissal", async ({ page }) => {
  await page.clock.install();
  await page.route("**/api/tg-direct/plans", route => route.fulfill({ json: { code: 0, data: { plans: [], paymentsEnabled: false, serviceFee: "0" } } }));
  await page.goto("/tg-direct");
  const toast = page.locator(".notification-card.is-warning");
  await expect(toast).toContainText("付款暂未开启");
  await toast.hover();
  await page.clock.fastForward(12_000);
  await expect(toast).toBeVisible();
  await page.mouse.move(0, 800);
  await page.clock.fastForward(10_000);
  await expect(toast).toHaveCount(0);
});

test("retry inside an error notification still calls its page action", async ({ page }) => {
  let attempts = 0;
  await page.route("**/api/admin/tg-direct/session", route => { attempts++; return route.fulfill({ status: 503, json: { error: "unavailable" } }); });
  await page.goto("/admin?panel=tgDirect");
  const toast = page.locator(".notification-stack [role=alert]").filter({ has: page.getByRole("button", { name: /重试|Retry/ }) });
  await expect(toast.first()).toBeVisible();
  const before = attempts;
  await toast.first().getByRole("button", { name: /重试|Retry/ }).click();
  await expect.poll(() => attempts).toBeGreaterThan(before);
});

test("drawer error stays announced and its retry can receive keyboard focus", async ({ page }) => {
  let attempts = 0;
  const order = { id: "toast-test-order", userId: 9, email: "preview@local", plan: "plus", status: "failed", operationStatus: "FAILED", customerServiceFee: "1", createdAt: "2026-11-01T00:00:00Z" };
  await page.route("**/api/admin/gpt-direct/orders?**", route => route.fulfill({ json: { code: 0, data: { list: [order], total: 1, page: 1, pageSize: 50 } } }));
  await page.route("**/api/admin/gpt-direct/orders/toast-test-order", route => { attempts++; return route.fulfill({ status: 503, json: { error: "unavailable" } }); });
  await page.goto("/admin?panel=gptOrders");
  await page.getByTestId("admin-gpt-direct-table").getByRole("button", { name: "详情", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const toast = dialog.locator(".notification-card.is-error");
  await expect(toast).toBeVisible();
  expect(await toast.evaluate(el => Boolean(el.closest('[aria-hidden="true"]')))).toBe(false);
  const retry = toast.getByRole("button", { name: "重试", exact: true });
  const beforeScroll = await toast.boundingBox();
  await dialog.evaluate(el => { const spacer = document.createElement("div"); spacer.style.height = "2000px"; el.prepend(spacer); el.scrollTop = 600; });
  await expect(toast).toBeInViewport();
  expect(Math.abs((await toast.boundingBox())!.y - beforeScroll!.y)).toBeLessThan(2);
  await retry.focus();
  await expect(retry).toBeFocused();
  const before = attempts;
  await page.keyboard.press("Enter");
  await expect.poll(() => attempts).toBeGreaterThan(before);
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".notification-stack .is-error")).toBeVisible();
  await expect(page.locator(".notification-stack").getByRole("button", { name: "重试", exact: true })).toHaveCount(0);
});
