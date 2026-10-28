import { test, expect, type Page } from "@playwright/test";

const plans = ["premium_3m", "premium_6m", "premium_12m"].map((key, index) => ({ key, label: `${index < 3 ? "Premium" : "Premium+"} · ${["3 个月", "6 个月", "1 年"][index % 3]}`, serviceFee: "0", version: 1 }));

async function mockAdmin(page: Page) {
  await page.addInitScript(() => localStorage.setItem("session", JSON.stringify({ token: "", email: "admin@example.test" })));
  await page.route("**/api/**", route => route.fulfill({ json: { code: 0, data: route.request().url().includes("-direct/settings") ? { plans: [], currency: "USD" } : [] } }));
  await page.route("**/api/dashboard", route => route.fulfill({ json: { email: "admin@example.test", role: "admin", walletBalance: "0", cardBalance: "0", cardCount: 0 } }));
  const tier = { code: "none", nameZh: "普通会员", nameEn: "Standard", descriptionZh: "普通会员", descriptionEn: "Standard", thresholdAmount: "0", openMultiplier: "1", minimumOpenFee: "0", rechargeMultiplier: "1", minimumRechargeRate: "0", refundMultiplier: "1", declineFee: "0", gptDirectMultiplier: "1", gptDirectMinimumFee: "0", version: 1 };
  await page.route("**/api/admin/pricing", route => route.fulfill({ json: { code: 0, data: { tiers: [tier, { ...tier, code: "growth", nameZh: "进阶会员" }], overrides: [] } } }));
  await page.route("**/api/admin/tg-direct/session", route => route.fulfill({ json: { code: 0, data: { configured: true, updatedAt: null, autoRefresh: false } } }));
  await page.route("**/api/admin/tg-direct/settings*", route => route.fulfill({ json: { code: 0, data: { plans, currency: "USD" } } }));
  await page.route("**/api/admin/tg-direct/orders?*", route => route.fulfill({ json: { code: 0, data: { list: [], total: 0, page: 1, pageSize: 20 } } }));
}

test("TG direct admin edits each plan fee with decimal validation and current version", async ({ page }) => {
  await mockAdmin(page);
  let current = plans.map(plan => ({ ...plan }));
  const updates: unknown[] = [];
  await page.route("**/api/admin/tg-direct/settings*", route => {
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON();
      updates.push(body);
      current = current.map(plan => plan.key === body.plan ? { ...plan, serviceFee: body.serviceFee, version: plan.version + 1 } : plan);
    }
    return route.fulfill({ json: { code: 0, data: { plans: current, currency: "USD" } } });
  });
  await page.goto("/admin?panel=tiers");
  await expect(page.getByTestId("admin-nav-tiers")).toHaveAttribute("aria-current", "page", { timeout: 15000 });
  const fees = page.getByTestId("pricing-tier-growth").getByTestId("admin-tg-direct-fees");
  await expect(fees.getByRole("spinbutton")).toHaveCount(3);
  const row = fees.getByTestId("tg-fee-premium_3m");
  const input = row.getByRole("spinbutton");
  await expect(input).toHaveValue("0");
  await input.fill("-1");
  await expect(row.getByRole("button", { name: "保存服务费" })).toBeDisabled();
  await input.fill("1.001");
  await expect(row.getByRole("button", { name: "保存服务费" })).toBeDisabled();
  await input.fill("10000.01");
  await expect(row.getByRole("button", { name: "保存服务费" })).toBeDisabled();
  await input.fill("2.50");
  await row.getByRole("button", { name: "保存服务费" }).click();
  await expect(fees.getByRole("status")).toContainText("已保存");
  expect(updates).toEqual([{ tierCode: "growth", plan: "premium_3m", serviceFee: "2.50", version: 1 }]);
  await input.fill("0");
  await row.getByRole("button", { name: "保存服务费" }).click();
  await expect.poll(() => updates.length).toBe(2);
  expect(updates[1]).toEqual({ tierCode: "growth", plan: "premium_3m", serviceFee: "0", version: 2 });
  await page.getByTestId("admin-nav-tgDirect").click();
  await expect(page.getByTestId("admin-tg-direct-session")).toHaveCount(1);
  await expect(page.getByTestId("admin-tg-direct-fees")).toHaveCount(0);
});

test("TG direct admin reloads conflicting fees and offers recent administrator authentication", async ({ page }) => {
  await mockAdmin(page);
  let conflict = true;
  let current = plans;
  await page.route("**/api/admin/tg-direct/settings*", route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { code: 0, data: { plans: current, currency: "USD" } } });
    if (conflict) {
      current = plans.map(plan => ({ ...plan, version: 2, serviceFee: "3" }));
      return route.fulfill({ status: 409, json: { error: "private-fee-error" } });
    }
    return route.fulfill({ status: 403, json: { error: "private-auth-error", errorCode: "RECENT_AUTH_REQUIRED" } });
  });
  await page.goto("/admin?panel=tiers");
  const fees = page.getByTestId("pricing-tier-growth").getByTestId("admin-tg-direct-fees");
  const row = fees.getByTestId("tg-fee-premium_3m");
  await row.getByRole("spinbutton").fill("2");
  await row.getByRole("button", { name: "保存服务费" }).click();
  await expect(fees.getByRole("alert")).toContainText("其他管理员");
  await fees.getByRole("button", { name: "重新加载费用" }).click();
  await expect(row.getByRole("spinbutton")).toHaveValue("3");
  conflict = false;
  await row.getByRole("spinbutton").fill("4");
  await row.getByRole("button", { name: "保存服务费" }).click();
  await expect(fees.getByRole("button", { name: "重新认证" })).toBeVisible();
  await expect(fees).not.toContainText("private-auth-error");
  await fees.getByRole("button", { name: "重新认证" }).click();
  await expect(page).toHaveURL(/\/login/);
  expect(await page.evaluate(() => sessionStorage.getItem("recentAuthReturnPath"))).toBe("/admin?panel=tiers");
});

test("TG direct admin filters customer orders and opens read-only receipts without credentials", async ({ page }) => {
  await mockAdmin(page);
  const order = { id: "11111111-1111-4111-8111-111111111111", recipient: "recipient", plan: "premium_3m", cardId: 7, cardLast4: "4242", status: "review_required", amountMinor: 90000, currency: "bdt", estimatedUsd: "7.32", serviceFee: "2.50", serviceFeeStatus: "charged", paymentAttempted: true, paymentSubmitted: true, ownerUserId: 12, ownerEmail: "customer@example.test", createdAt: "2026-09-30T01:00:00Z", cookie: "private-session-secret", message: "private-session-secret", invoiceUrls: ["https://pay.stripe.com/receipts/payment/test_receipt", "https://evil.test/private-session-secret", "https://user:password@pay.stripe.com/receipts/payment/test_receipt"] };
  const queries: URLSearchParams[] = [];
  let details = 0;
  const customerCalls: string[] = [];
  page.on("request", request => { if (request.url().includes("/api/tg-direct/")) customerCalls.push(request.url()); });
  await page.route("**/api/admin/tg-direct/orders?*", route => {
    const params = new URL(route.request().url()).searchParams;
    queries.push(params);
    return route.fulfill({ json: { code: 0, data: { list: [order], total: 21, page: Number(params.get("page") || 1), pageSize: 20 } } });
  });
  await page.route(`**/api/admin/tg-direct/orders/${order.id}`, route => {
    details++;
    expect(route.request().method()).toBe("GET");
    return route.fulfill({ json: { code: 0, data: order } });
  });
  await page.goto("/admin?panel=tgDirect");
  const orders = page.getByTestId("admin-tg-direct-orders");
  await expect(orders.getByRole("cell", { name: /customer@example.test/ })).toBeVisible({ timeout: 15000 });
  await expect(orders).toContainText("BDT 900.00");
  await expect(orders).toContainText("USD 2.5");
  await expect(orders).not.toContainText("private-session-secret");
  await orders.getByRole("button", { name: "下一页" }).click();
  await expect.poll(() => queries.at(-1)?.get("page")).toBe("2");
  await orders.getByRole("textbox", { name: "TG 用户名" }).fill("recipient_with_long_tg_username");
  await orders.getByRole("spinbutton", { name: "用户 ID" }).fill("12");
  await orders.getByRole("combobox", { name: "订单状态" }).click();
  await expect(page.getByRole("option", { name: "正在检查资格和报价" })).toHaveCount(0);
  await expect(page.getByRole("option", { name: "待确认付款" })).toHaveCount(0);
  await page.getByRole("option", { name: "结果待核对" }).click();
  await orders.getByRole("button", { name: "筛选", exact: true }).click();
  await expect.poll(() => queries.at(-1)?.get("page")).toBe("1");
  expect(queries.at(-1)?.get("recipient")).toBe("recipient_with_long_tg_username");
  expect(queries.at(-1)?.get("userId")).toBe("12");
  expect(queries.at(-1)?.get("status")).toBe("review_required");
  await orders.getByRole("button", { name: "订单详情" }).click();
  const detail = page.getByRole("dialog", { name: "TG 直充订单详情" });
  await expect(detail).toContainText("customer@example.test");
  await expect(detail).toContainText("USD 2.5");
  await expect(detail).toContainText("4242");
  await expect(detail).not.toContainText("private-session-secret");
  await expect(detail.getByText("尚未核验到账")).toBeVisible();
  await expect(detail.getByRole("link")).toHaveCount(0);
  await page.clock.install();
  await page.clock.fastForward(30000);
  expect(details).toBe(1);
  expect(customerCalls).toEqual([]);
});
