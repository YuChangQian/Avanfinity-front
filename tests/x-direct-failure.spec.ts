import { test, expect } from "@playwright/test";

test.skip(true, "X customer flows are retired; see customer-entry-visibility.spec.ts for current behavior.");

test("X direct failed payment shows failure and refunded fee without retrying payment", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("session", JSON.stringify({ token: "", userId: 1, email: "test@example.test", displayName: "Test" })));
  await page.route("**/api/**", route => route.fulfill({ json: { code: 200, data: [] } }));
  await page.route("**/api/dashboard", route => route.fulfill({ json: { userId: 1, role: "customer", walletBalance: "100", cardBalance: "100", cardCount: 1 } }));
  const order = { id: "4fa570de-ce90-4d48-a2b9-0dce94e6f65a", recipient: "Amyzhang1998", plan: "premium_3m", cardId: 4, status: "failed", amountMinor: 30000, currency: "bdt", serviceFee: "0.50", serviceFeeStatus: "refunded", paymentAttempted: true, paymentSubmitted: true, paymentIntentStatus: "requires_payment_method", errorCode: "card_declined" };
  let confirms = 0;
  await page.route("**/api/x-direct/orders", route => route.fulfill({ json: { code: 200, data: [order] } }));
  await page.route("**/api/x-direct/orders/*", route => route.fulfill({ json: { code: 200, data: order } }));
  await page.route("**/api/x-direct/orders/*/confirm", route => { confirms++; return route.fulfill({ json: { code: 200, data: order } }); });
  await page.goto("/x-direct");
  await page.getByRole("region", { name: "X 直充订单" }).getByRole("button", { name: "详情 / 账单" }).click();
  const drawer = page.getByRole("dialog", { name: "X 直充进度与账单" });
  await expect(drawer.getByText("支付失败", { exact: true }).first()).toBeVisible();
  await expect(drawer.getByRole("list", { name: "充值流程" })).toContainText("支付失败");
  await expect(drawer.getByText("USD 0.50（已退还）", { exact: true })).toBeVisible();
  await expect(drawer.getByText("结果待核对，请勿重复付款", { exact: true })).toHaveCount(0);
  await expect(drawer.getByRole("button", { name: /^确认支付/ })).toHaveCount(0);
  await drawer.getByRole("button", { name: "刷新订单和账单" }).click();
  expect(confirms).toBe(0);
});

test("X direct CDK shows supplier cooldown while keeping the original redemption", async ({ page }) => {
  const requestId = "11111111-1111-4111-8111-111111111111";
  await page.addInitScript(requestId => sessionStorage.setItem("xCdkIntent", JSON.stringify({ clientRequestId: requestId, recipient: "Amyzhang1998", plan: "premium_3m", submitted: true })), requestId);
  const message = "发卡平台请求过于频繁，请稍后继续原兑换；未提交付款、未扣服务费。";
  await page.route("**/api/**", route => route.fulfill({ json: { code: 200, data: [] } }));
  let confirms = 0;
  await page.route("**/api/public/x-cdk/result", route => route.fulfill({ json: { code: 200, data: { plan: "premium_3m", status: "prepared", amountMinor: 30000, currency: "bdt", errorCode: "X_CARD_READ_RATE_LIMITED", message } } }));
  await page.route("**/api/public/x-cdk/redeem", route => {
    confirms++;
    expect(route.request().postDataJSON().clientRequestId).toBe(requestId);
    return route.fulfill({ json: { code: 200, data: { plan: "premium_3m", status: "prepared", amountMinor: 30000, currency: "bdt", errorCode: "X_CARD_READ_RATE_LIMITED", message } } });
  });
  await page.goto("/x-cdk/redeem");
  await page.getByLabel("X CDK 兑换码").fill("XCDK-00000000000000000000000000000000");
  await page.getByRole("button", { name: "查询原兑换状态", exact: true }).click();
  await expect(page.getByText(message, { exact: true })).toBeVisible();
  expect(confirms).toBe(0);
  await page.getByRole("button", { name: /继续兑换/ }).click();
  await expect(page.getByText(message, { exact: true })).toBeVisible();
  expect(confirms).toBe(1);
  expect(JSON.parse(await page.evaluate(() => sessionStorage.getItem("xCdkIntent")!)).clientRequestId).toBe(requestId);
});
