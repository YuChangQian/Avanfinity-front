import { test, expect, type Page } from "@playwright/test";
const id = "11111111-1111-4111-8111-111111111111";
async function setup(page: Page, status: string, extra = {}) {
  await page.addInitScript(() => localStorage.setItem("session", JSON.stringify({ token: "", userId: 1, email: "test@example.test" })));
  await page.route("**/api/**", route => route.fulfill({ json: { code: 200, data: [] } }));
  await page.route("**/api/tg-direct/plans", route => route.fulfill({ json: { code: 200, data: { plans: [{ key: "premium_3m", label: "Premium · 3 个月", enabled: true, serviceFee: "0.00" }], paymentsEnabled: true } } }));
  const order = { id, recipient: "youflyfaraway", plan: "premium_3m", cardId: 4, status, amountMinor: 1199, currency: "usd", serviceFee: "0.00", paymentAttempted: true, paymentSubmitted: true, updatedAt: new Date().toISOString(), ...extra };
  await page.route("**/api/tg-direct/orders", route => route.fulfill({ json: { code: 200, data: [order] } }));
  return order;
}
for (const status of ["requires_action", "review_required"]) {
  test(`TG direct continues polling ${status} until gift delivery`, async ({ page }) => {
    const order = await setup(page, status); let reads = 0;
    await page.route("**/api/tg-direct/orders/*", route => route.fulfill({ json: { code: 200, data: ++reads > 1 ? { ...order, status: "completed", paymentStatus: "paid", deliveryStatus: "delivered", giftDays: 91, giftMessageId: 84 } : order } }));
    await page.goto("/tg-direct"); await page.getByRole("button", { name: "订单详情" }).click();
    const drawer = page.getByRole("dialog", { name: "TG 直充进度与到账" });
    await expect(drawer.getByRole("list", { name: "充值流程" })).toBeVisible();
    await expect(drawer.getByText("充值完成", { exact: true })).toBeVisible({ timeout: 12000 });
    await expect(drawer.getByText(/最近更新/)).toBeVisible();
    await expect(drawer.getByText(/91 天/)).toBeVisible();
  });
}
test("TG direct drawer shows loading then timeout reason on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const order = await setup(page, "requires_action", { executionTimedOut: true, errorCode: "payment_execution_timeout", deadlineAt: new Date(Date.now() - 1000).toISOString() });
  let finish!: () => void; const pending = new Promise<void>(resolve => { finish = resolve; });
  await page.route("**/api/tg-direct/orders/*", async route => { await pending; await route.fulfill({ json: { code: 200, data: order } }); });
  await page.goto("/tg-direct"); await page.getByRole("button", { name: "订单详情" }).click();
  const drawer = page.getByRole("dialog", { name: "TG 直充进度与到账" });
  try { await expect(drawer.getByText("正在读取原订单进度…", { exact: true })).toBeVisible(); } finally { finish(); }
  await expect(drawer.getByText("已超时，付款结果待核对", { exact: true })).toBeVisible();
  await expect(drawer.getByText(/8 分钟/).first()).toBeVisible();
  await expect(drawer.getByRole("list", { name: "充值流程" })).toBeInViewport();
  expect((await drawer.boundingBox())!.y).toBe(0);
  await drawer.getByText(/订单编号/).scrollIntoViewIfNeeded(); await expect(drawer.getByText(/订单编号/)).toBeInViewport();
  await page.screenshot({ path: "test-results/tg-progress-timeout-mobile.png", fullPage: false, animations: "disabled" });
});
test("TG direct shows the eight minute deadline without falsely cancelling an unknown payment", async ({ page }) => {
  const order = await setup(page, "processing", { executionStartedAt: new Date().toISOString(), deadlineAt: new Date(Date.now() + 470000).toISOString() });
  await page.route("**/api/tg-direct/orders/*", route => route.fulfill({ json: { code: 200, data: order } }));
  await page.goto("/tg-direct"); await page.getByRole("button", { name: "订单详情" }).click();
  const drawer = page.getByRole("dialog", { name: "TG 直充进度与到账" });
  await expect(drawer.getByText(/剩余处理时间/)).toBeVisible(); await expect(drawer.getByText(/最长 8 分钟/)).toBeVisible();
  await page.screenshot({ path: "test-results/tg-progress-desktop.png", fullPage: false, animations: "disabled" });
});
test("TG direct keeps polling a terminal snapshot until backend settlement", async ({ page }) => {
  const order = await setup(page, "processing"); let reads = 0;
  await page.route("**/api/tg-direct/orders/*", route => route.fulfill({ json: { code: 200, data: { ...order, status: "completed", paymentStatus: "paid", deliveryStatus: "delivered", giftDays: 91, giftMessageId: 84, statusSnapshot: ++reads === 1 } } }));
  await page.goto("/tg-direct"); await page.getByRole("button", { name: "订单详情" }).click();
  await expect(page.getByRole("dialog").getByText(/91 天/)).toBeVisible();
  await expect.poll(() => reads, { timeout: 8000 }).toBeGreaterThan(1);
});
test("TG direct keeps order context when status lookup fails and recovers on refresh", async ({ page }) => {
  const order = await setup(page, "review_required"); let failed = true;
  await page.route("**/api/tg-direct/orders/*", route => failed
    ? route.fulfill({ status: 503, json: { error: "状态暂不可用" } })
    : route.fulfill({ json: { code: 200, data: { ...order, status: "completed", paymentStatus: "paid", deliveryStatus: "delivered", giftDays: 91 } } }));
  await page.goto("/tg-direct"); await page.getByRole("button", { name: "订单详情" }).click();
  const drawer = page.getByRole("dialog", { name: "TG 直充进度与到账" });
  await expect(drawer.getByRole("alert")).toContainText("状态暂时无法获取", { timeout: 15000 });
  await expect(drawer.getByText("@youflyfaraway · Premium · 3 个月", { exact: true })).toBeVisible();
  failed = false; await drawer.getByRole("button", { name: "刷新订单状态" }).click();
  await expect(drawer.getByText("充值完成", { exact: true })).toBeVisible();
});
