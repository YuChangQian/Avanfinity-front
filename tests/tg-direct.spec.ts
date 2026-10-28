import { test, expect } from "@playwright/test";

const plans = ["premium_3m", "premium_6m", "premium_12m"].map((key, i) => ({ key, label: `${i < 3 ? "Premium" : "Premium+"} · ${["3 个月", "6 个月", "1 年"][i % 3]}`, enabled: true, serviceFee: "2.50", pricingVersion: 1 }));
const ineligible = "该 Telegram 账号暂不能接收此套餐，请核对用户名或联系管理员。";

test("TG direct three plans eligibility exact payment and receipts", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("session", JSON.stringify({ token: "", userId: 1, email: "test@example.test", displayName: "Test" })));
  await page.route("**/api/**", route => route.fulfill({ json: { code: 200, data: [] } }));
  await page.route("**/api/dashboard", route => route.fulfill({ json: { userId: 1, email: "test@example.test", role: "customer", walletBalance: "0", cardBalance: "100", cardCount: 1 } }));
  await page.route("**/api/features", route => route.fulfill({ json: { code: 200, data: {} } }));
  await page.route("**/api/cards?*", route => route.fulfill({ json: { code: 200, data: { total: 1, list: [{ id: 4, cardNumberMasked: "**** 4242", status: "ACTIVE", balance: "100", pendingOperationId: null }] } } }));
  await page.route("**/api/tg-direct/plans", route => route.fulfill({ json: { code: 200, data: { plans, paymentsEnabled: true, serviceFee: "0" } } }));
  let order: Record<string, unknown> | null = null;
  let confirms = 0;
  const requestIds: string[] = [];
  const requestedPlans: string[] = [];
  await page.route("**/api/tg-direct/orders", route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { code: 200, data: order ? [order] : [] } });
    const body = route.request().postDataJSON();
    requestIds.push(body.clientRequestId);
    requestedPlans.push(body.plan);
    order = { id: "11111111-1111-4111-8111-111111111111", recipient: body.recipient.replace(/^@/, ""), plan: body.plan, cardId: body.cardId, status: body.recipient === "@ineligible" ? "ineligible" : "prepared", amountMinor: 90000, currency: "bdt", estimatedUsd: "7.32", fxRateDate: "2026-09-29", paymentAttempted: false, message: body.recipient === "@ineligible" ? ineligible : "", serviceFee: "2.50" };
    return route.fulfill({ json: { code: 200, data: order } });
  });
  await page.route("**/api/tg-direct/orders/*", route => route.fulfill({ json: { code: 200, data: order } }));
  await page.route("**/api/tg-direct/orders/*/cancel", route => {
    order = { ...order!, status: "cancelled" };
    return route.fulfill({ json: { code: 200, data: order } });
  });
  await page.route("**/api/tg-direct/orders/*/confirm", route => {
    expect(route.request().postDataJSON()).toEqual({ expectedAmountMinor: 90000, currency: "bdt", expectedServiceFee: "2.50" });
    confirms++;
    order = { ...order!, status: "completed", deliveryStatus: "delivered", giftMessageId: 1234, giftDays: 91, paymentAttempted: true, invoiceUrls: ["https://pay.stripe.com/receipts/payment/test_receipt", "https://evil.test/receipt"] };
    return route.fulfill({ json: { code: 200, data: order } });
  });
  await page.goto("/tg-direct");
  await expect(page.getByRole("heading", { name: "TG 直充", exact: true })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("combobox")).toHaveCount(3);
  await expect(page.getByText("Premium+", { exact: true })).toHaveCount(0);
  await page.getByLabel("TG 用户名", { exact: true }).fill("@ineligible");
  await page.getByRole("combobox", { name: "支付卡", exact: true }).click();
  await page.getByRole("option", { name: /4242/ }).click();
  {
    const tier = "premium";
    for (const [duration, durationLabel] of [["3m", "3 个月"], ["6m", "6 个月"], ["12m", "1 年"]]) {
      await page.getByRole("combobox", { name: "充值时长" }).click();
      await expect(page.getByRole("option")).toHaveCount(3);
      await page.getByRole("option", { name: durationLabel, exact: true }).click();
      await page.getByRole("button", { name: "检查资格并获取报价" }).click();
      await expect(page.getByText(ineligible, { exact: true })).toBeVisible();
      expect(requestedPlans.at(-1)).toBe(`${tier}_${duration}`);
    }
  }
  await expect(page.getByText(ineligible, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^确认支付/ })).toHaveCount(0);
  await page.getByLabel("TG 用户名", { exact: true }).fill("@eligible");
  await page.getByRole("button", { name: "检查资格并获取报价" }).click();
  await expect(page.getByText("@eligible · Premium · 1 年")).toBeVisible();
  await expect(page.getByText("约 USD 7.32").first()).toBeVisible();
  await expect(page.getByText("USD 2.50", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "TG 直充订单" }).getByText("暂无充值订单")).toBeVisible();
  await page.getByRole("button", { name: "取消此报价" }).click();
  await expect(page.getByRole("button", { name: "检查资格并获取报价" })).toBeEnabled();
  await page.getByRole("button", { name: "检查资格并获取报价" }).click();
  await expect(page.getByRole("button", { name: "确认支付 BDT 900.00" })).toBeVisible();
  expect(requestIds.at(-1)).not.toBe(requestIds.at(-2));
  await page.getByRole("button", { name: "确认支付 BDT 900.00" }).click();
  await expect(page.getByText(/已核验赠送记录/)).toBeVisible();
  await expect(page.locator('a[href*="evil.test"]')).toHaveCount(0);
  await page.getByRole("button", { name: "刷新订单状态" }).click();
  expect(confirms).toBe(1);
  await page.getByRole("dialog").getByRole("button", { name: "关闭" }).click();
  await page.getByRole("combobox", { name: "充值时长" }).click();
  await page.screenshot({ path: "test-results/tg-direct-select-desktop.png", fullPage: true });
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("combobox", { name: "充值时长" }).click();
  await page.screenshot({ path: "test-results/tg-direct-select-mobile.png", fullPage: true });
});

for (const outcome of ["completed", "uncertain", "rejected"] as const) {
  test(`TG direct shows live payment progress before a delayed ${outcome} response`, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("session", JSON.stringify({ token: "", userId: 1, email: "test@example.test", displayName: "Test" })));
    await page.route("**/api/**", route => route.fulfill({ json: { code: 200, data: [] } }));
    await page.route("**/api/dashboard", route => route.fulfill({ json: { userId: 1, role: "customer", walletBalance: "100", cardBalance: "100", cardCount: 1 } }));
    await page.route("**/api/cards?*", route => route.fulfill({ json: { code: 200, data: { total: 1, list: [{ id: 4, cardNumberMasked: "**** 4242", status: "ACTIVE", balance: "100" }] } } }));
    await page.route("**/api/tg-direct/plans", route => route.fulfill({ json: { code: 200, data: { plans, paymentsEnabled: true } } }));
    let order = { id: "11111111-1111-4111-8111-111111111111", recipient: "eligible", plan: "premium_3m", cardId: 4, status: "prepared", amountMinor: 90000, currency: "bdt", serviceFee: "2.50", paymentAttempted: false, invoiceUrls: [] as string[] };
    let confirms = 0;
    let detailReads = 0;
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    await page.route("**/api/tg-direct/orders", route => route.fulfill({ json: { code: 200, data: route.request().method() === "GET" ? (order.paymentAttempted ? [order] : []) : order } }));
    await page.route("**/api/tg-direct/orders/*", route => { detailReads++; return route.fulfill({ json: { code: 200, data: order } }); });
    await page.route("**/api/tg-direct/orders/*/confirm", async route => {
      confirms++;
      order = { ...order, status: "processing", paymentAttempted: true };
      await pending;
      if (outcome === "uncertain") return route.abort("failed");
      if (outcome === "rejected") { order = { ...order, status: "prepared", paymentAttempted: false }; return route.fulfill({ status: 422, json: { error: "钱包余额不足" } }); }
      order = { ...order, status: "completed", deliveryStatus: "delivered", giftMessageId: 1234, giftDays: 91, invoiceUrls: ["https://pay.stripe.com/receipts/payment/test_receipt"] };
      await route.fulfill({ json: { code: 200, data: order } });
    });
    await page.goto("/tg-direct");
    await page.getByLabel("TG 用户名", { exact: true }).fill("@eligible");
    await page.getByRole("combobox", { name: "支付卡", exact: true }).click();
    await page.getByRole("option", { name: /4242/ }).click();
    await page.getByRole("button", { name: "检查资格并获取报价" }).click();
    await page.getByRole("button", { name: "确认支付 BDT 900.00" }).click();
    const drawer = page.getByRole("dialog", { name: "TG 直充进度与到账" });
    try {
      await expect(drawer).toBeVisible();
      await expect(drawer.getByRole("list", { name: "充值流程" })).toContainText("支付 TG 订单");
      await expect(drawer.getByText("正在提交付款，请勿重复操作。", { exact: true })).toBeVisible();
      await expect(drawer.getByText("充值完成", { exact: true })).toHaveCount(0);
      const readsBefore = detailReads;
      await expect.poll(() => detailReads, { timeout: 10000 }).toBeGreaterThan(readsBefore);
    } finally { finish(); }
    if (outcome === "completed") {
      await expect(drawer.getByText("充值完成", { exact: true })).toBeVisible();
      await expect(drawer.getByText("赠送到账", { exact: true })).toBeVisible();
      await drawer.getByRole("button", { name: "关闭" }).click();
      await expect(drawer).not.toBeVisible();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole("region", { name: "TG 直充订单" }).getByRole("button", { name: "订单详情" }).click();
      await expect(drawer).toBeVisible();
      await expect(drawer.getByText(/订单编号：11111111/)).toBeVisible();
      await expect(drawer.getByText("赠送到账", { exact: true })).toBeVisible();
      await expect(drawer).toHaveCSS("top", "0px");
      await page.screenshot({ path: "test-results/tg-direct-details-mobile.png", fullPage: true, animations: "disabled" });
    } else if (outcome === "rejected") {
      await expect(drawer.getByRole("alert")).toContainText("钱包余额不足");
      await expect(drawer.getByRole("button", { name: "取消此报价" })).toBeEnabled();
    } else {
      await expect(drawer.getByRole("alert").filter({ hasText: "查询原订单" })).toBeVisible();
      await expect(drawer.getByRole("button", { name: /^确认支付/ })).toHaveCount(0);
      await drawer.getByRole("button", { name: "刷新订单状态" }).click();
      await expect(drawer.getByText("充值完成", { exact: true })).toHaveCount(0);
      order = { ...order, status: "completed" };
      await expect(drawer.getByText("充值完成", { exact: true })).toBeVisible({ timeout: 10000 });
      await expect(drawer.getByRole("alert")).toHaveCount(0);
      await expect(drawer.getByText("已通过 Telegram 赠送记录确认到账。", { exact: true })).toBeVisible();
    }
    expect(confirms).toBe(1);
  });
}

test("TG direct history details open a drawer for an existing order", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("session", JSON.stringify({ token: "", userId: 1, email: "test@example.test", displayName: "Test" })));
  await page.route("**/api/**", route => route.fulfill({ json: { code: 200, data: [] } }));
  await page.route("**/api/tg-direct/plans", route => route.fulfill({ json: { code: 200, data: { plans, paymentsEnabled: true } } }));
  const order = { id: "11111111-1111-4111-8111-111111111111", recipient: "existing", plan: "premium_3m", cardId: 4, status: "paid_pending_delivery", amountMinor: 90000, currency: "bdt", serviceFee: "2.50", paymentAttempted: true, paymentSubmitted: true, invoiceUrls: ["https://pay.stripe.com/receipts/payment/test_receipt"] };
  await page.route("**/api/tg-direct/orders", route => route.fulfill({ json: { code: 200, data: [order] } }));
  await page.route("**/api/tg-direct/orders/*", route => route.fulfill({ json: { code: 200, data: order } }));
  await page.goto("/tg-direct");
  await page.getByRole("button", { name: "订单详情" }).click();
  const drawer = page.getByRole("dialog", { name: "TG 直充进度与到账" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("已付款，等待到账", { exact: true })).toBeVisible();
  await expect(drawer.getByText("充值完成", { exact: true })).toHaveCount(0);
  await drawer.getByRole("button", { name: "关闭" }).click();
  await page.getByRole("button", { name: /@existing/ }).click();
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("赠送到账", { exact: true })).toBeVisible();
});

for (const [status, firstStep, secondStep] of [
  ["failed_precharge", "获取报价失败", "未开始"],
  ["ineligible", "资格未通过", "未开始"],
  ["review_required", "待核对", "未开始"],
  ["prepared", "已完成", "待确认"],
  ["cancelled", "已完成", "未开始"],
]) {
  test(`TG direct preview ${status} never implies payment has started`, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("session", JSON.stringify({ token: "", userId: 1, email: "test@example.test" })));
    await page.route("**/api/**", route => route.fulfill({ json: { code: 200, data: [] } }));
    await page.route("**/api/cards?*", route => route.fulfill({ json: { code: 200, data: { total: 1, list: [{ id: 4, cardNumberMasked: "**** 4242", status: "ACTIVE", balance: "100" }] } } }));
    await page.route("**/api/tg-direct/plans", route => route.fulfill({ json: { code: 200, data: { plans, paymentsEnabled: true } } }));
    const quoted = ["prepared", "cancelled"].includes(status);
    const order = { id: "11111111-1111-4111-8111-111111111111", recipient: "liu_jingdong", plan: "premium_3m", cardId: 4, status, amountMinor: quoted ? 30000 : null, currency: quoted ? "bdt" : null, serviceFee: "0.00", serviceFeeStatus: "unpaid", paymentAttempted: false, paymentSubmitted: false, message: status === "failed_precharge" ? "创建请求未返回有效 Checkout；保留标记，不重建订单。" : "" };
    await page.route("**/api/tg-direct/orders", route => route.fulfill({ json: { code: 200, data: route.request().method() === "GET" ? [] : order } }));
    await page.route("**/api/tg-direct/orders/*", route => route.fulfill({ json: { code: 200, data: order } }));
    await page.goto("/tg-direct");
    await page.getByLabel("TG 用户名", { exact: true }).fill("@liu_jingdong");
    await page.getByRole("combobox", { name: "支付卡", exact: true }).click();
    await page.getByRole("option", { name: /4242/ }).click();
    await page.getByRole("button", { name: "检查资格并获取报价" }).click();
    const steps = page.getByRole("list", { name: "充值流程" }).getByRole("listitem");
    await expect(steps.nth(0)).toHaveText(`检查资格与报价${firstStep}`);
    await expect(steps.nth(1)).toHaveText(`支付 TG 订单${secondStep}`);
    await expect(steps.nth(2)).toHaveText("确认充值到账未开始");
    await expect(page.getByText("已暂停", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "报价预览", exact: true })).toBeVisible();
    if (status === "failed_precharge") {
      await expect(page.getByText("报价获取失败，未开始充值", { exact: true })).toBeVisible();
      await expect(page.getByText("未获取", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: /^确认支付/ })).toHaveCount(0);
    }
  });
}
