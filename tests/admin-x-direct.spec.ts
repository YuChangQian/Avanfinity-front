import { test, expect, type Page } from "@playwright/test";

const plans = ["premium_3m", "premium_6m", "premium_12m", "premium_plus_3m", "premium_plus_6m", "premium_plus_12m"].map((key, index) => ({ key, label: `${index < 3 ? "Premium" : "Premium+"} · ${["3 个月", "6 个月", "1 年"][index % 3]}`, serviceFee: "0", version: 1 }));

async function mockAdmin(page: Page) {
  await page.addInitScript(() => localStorage.setItem("session", JSON.stringify({ token: "", email: "admin@example.test" })));
  await page.route("**/api/**", route => route.fulfill({ json: { code: 0, data: route.request().url().includes("-direct/settings") ? { plans: [], currency: "USD" } : [] } }));
  await page.route("**/api/dashboard", route => route.fulfill({ json: { email: "admin@example.test", role: "admin", walletBalance: "0", cardBalance: "0", cardCount: 0 } }));
  const tier = { code: "none", nameZh: "普通会员", nameEn: "Standard", descriptionZh: "普通会员", descriptionEn: "Standard", thresholdAmount: "0", openMultiplier: "1", minimumOpenFee: "0", rechargeMultiplier: "1", minimumRechargeRate: "0", refundMultiplier: "1", declineFee: "0", gptDirectMultiplier: "1", gptDirectMinimumFee: "0", version: 1 };
  await page.route("**/api/admin/pricing", route => route.fulfill({ json: { code: 0, data: { tiers: [tier, { ...tier, code: "growth", nameZh: "进阶会员" }], overrides: [] } } }));
  await page.route("**/api/admin/x-direct/session", route => route.fulfill({ json: { code: 0, data: { configured: true, updatedAt: null, autoRefresh: false } } }));
  await page.route("**/api/admin/x-direct/settings*", route => route.fulfill({ json: { code: 0, data: { plans, currency: "USD" } } }));
  await page.route("**/api/admin/x-direct/orders?*", route => route.fulfill({ json: { code: 0, data: { list: [], total: 0, page: 1, pageSize: 20 } } }));
}

test("X direct admin edits each plan fee with decimal validation and current version", async ({ page }) => {
  await mockAdmin(page);
  let current = plans.map(plan => ({ ...plan }));
  const updates: unknown[] = [];
  await page.route("**/api/admin/x-direct/settings*", route => {
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON();
      updates.push(body);
      current = current.map(plan => plan.key === body.plan ? { ...plan, serviceFee: body.serviceFee, version: plan.version + 1 } : plan);
    }
    return route.fulfill({ json: { code: 0, data: { plans: current, currency: "USD" } } });
  });
  await page.goto("/admin?panel=tiers");
  await expect(page.getByTestId("admin-nav-tiers")).toHaveAttribute("aria-current", "page", { timeout: 15000 });
  const fees = page.getByTestId("pricing-tier-growth").getByTestId("admin-x-direct-fees");
  await expect(fees.getByRole("spinbutton")).toHaveCount(6);
  const row = fees.getByTestId("x-fee-premium_3m");
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
  await page.getByTestId("admin-nav-xDirect").click();
  await expect(page.getByTestId("admin-x-direct-session")).toHaveCount(1);
  await expect(page.getByTestId("admin-x-direct-fees")).toHaveCount(0);
});

test("X direct admin reloads conflicting fees and offers recent administrator authentication", async ({ page }) => {
  await mockAdmin(page);
  let conflict = true;
  let current = plans;
  await page.route("**/api/admin/x-direct/settings*", route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { code: 0, data: { plans: current, currency: "USD" } } });
    if (conflict) {
      current = plans.map(plan => ({ ...plan, version: 2, serviceFee: "3" }));
      return route.fulfill({ status: 409, json: { error: "private-fee-error" } });
    }
    return route.fulfill({ status: 403, json: { error: "private-auth-error", errorCode: "RECENT_AUTH_REQUIRED" } });
  });
  await page.goto("/admin?panel=tiers");
  const fees = page.getByTestId("pricing-tier-growth").getByTestId("admin-x-direct-fees");
  const row = fees.getByTestId("x-fee-premium_3m");
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

test("X direct admin filters customer orders and opens read-only receipts without credentials", async ({ page }) => {
  await mockAdmin(page);
  const order = { id: "11111111-1111-4111-8111-111111111111", recipient: "recipient", plan: "premium_3m", cardId: 7, cardLast4: "4242", status: "review_required", amountMinor: 90000, currency: "bdt", estimatedUsd: "7.32", serviceFee: "2.50", serviceFeeStatus: "charged", paymentAttempted: true, paymentSubmitted: true, ownerUserId: 12, ownerEmail: "customer@example.test", createdAt: "2026-09-30T01:00:00Z", cookie: "private-session-secret", message: "private-session-secret", invoiceUrls: ["https://pay.stripe.com/receipts/payment/test_receipt", "https://evil.test/private-session-secret", "https://user:password@pay.stripe.com/receipts/payment/test_receipt"] };
  const queries: URLSearchParams[] = [];
  let details = 0;
  const customerCalls: string[] = [];
  page.on("request", request => { if (request.url().includes("/api/x-direct/")) customerCalls.push(request.url()); });
  await page.route("**/api/admin/x-direct/orders?*", route => {
    const params = new URL(route.request().url()).searchParams;
    queries.push(params);
    return route.fulfill({ json: { code: 0, data: { list: [order], total: 21, page: Number(params.get("page") || 1), pageSize: 20 } } });
  });
  await page.route(`**/api/admin/x-direct/orders/${order.id}`, route => {
    details++;
    expect(route.request().method()).toBe("GET");
    return route.fulfill({ json: { code: 0, data: order } });
  });
  await page.goto("/admin?panel=xDirect");
  const orders = page.getByTestId("admin-x-direct-orders");
  await expect(orders.getByRole("cell", { name: /customer@example.test/ })).toBeVisible({ timeout: 15000 });
  await expect(orders).toContainText("BDT 900.00");
  await expect(orders).toContainText("USD 2.5");
  await expect(orders).not.toContainText("private-session-secret");
  await orders.getByRole("button", { name: "下一页" }).click();
  await expect.poll(() => queries.at(-1)?.get("page")).toBe("2");
  await orders.getByRole("textbox", { name: "X 用户名" }).fill("recipient");
  await orders.getByRole("spinbutton", { name: "用户 ID" }).fill("12");
  await orders.getByRole("combobox", { name: "订单状态" }).click();
  await expect(page.getByRole("option", { name: "正在检查资格和报价" })).toHaveCount(0);
  await expect(page.getByRole("option", { name: "待确认付款" })).toHaveCount(0);
  await page.getByRole("option", { name: "结果待核对" }).click();
  await orders.getByRole("button", { name: "筛选", exact: true }).click();
  await expect.poll(() => queries.at(-1)?.get("page")).toBe("1");
  expect(queries.at(-1)?.get("recipient")).toBe("recipient");
  expect(queries.at(-1)?.get("userId")).toBe("12");
  expect(queries.at(-1)?.get("status")).toBe("review_required");
  await orders.getByRole("button", { name: "详情 / 账单" }).click();
  const detail = page.getByRole("dialog", { name: "X 直充订单详情" });
  await expect(detail).toContainText("customer@example.test");
  await expect(detail).toContainText("USD 2.5");
  await expect(detail).toContainText("4242");
  await expect(detail).not.toContainText("private-session-secret");
  await expect(detail.getByRole("link", { name: "官方账单 / 收据 1" })).toHaveAttribute("href", "https://pay.stripe.com/receipts/payment/test_receipt");
  await expect(detail.getByRole("link")).toHaveCount(1);
  await page.clock.install();
  await page.clock.fastForward(30000);
  expect(details).toBe(1);
  expect(customerCalls).toEqual([]);
});

test("X direct admin confirms one end request, disables repeats, and refreshes the saved result", async ({ page }) => {
  await mockAdmin(page);
  const id = "11111111-1111-4111-8111-111111111111";
  const base = { id, recipient: "recipient", plan: "premium_3m", cardId: 7, status: "review_required", serviceFee: "2.50", serviceFeeStatus: "charged", ownerUserId: 12, ownerEmail: "customer@example.test", createdAt: "2026-09-30T01:00:00Z" };
  let saved = base;
  let posts = 0;
  let details = 0;
  let lists = 0;
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/admin/x-direct/orders?*", route => { lists++; return route.fulfill({ json: { code: 200, data: { list: [saved], total: 1, page: 1, pageSize: 20 } } }); });
  await page.route(`**/api/admin/x-direct/orders/${id}`, route => { details++; return route.fulfill({ json: { code: 200, data: saved } }); });
  await page.route(`**/api/admin/x-direct/orders/${id}/end`, async route => { posts++; await pending; saved = { ...base, status: "failed", serviceFeeStatus: "refunded" }; await route.fulfill({ json: { code: 200, data: saved } }); });
  page.on("dialog", dialog => { void (dialog.message().includes("结束") ? dialog.accept() : dialog.dismiss()); });
  await page.goto("/admin?panel=xDirect");
  await page.getByRole("button", { name: "详情 / 账单" }).first().click();
  const dialog = page.getByRole("dialog", { name: "X 直充订单详情" });
  const end = dialog.getByRole("button", { name: "结束订单" });
  await end.click();
  await expect(end).toBeDisabled();
  await expect.poll(() => posts).toBe(1);
  release();
  await expect(dialog.getByRole("status")).toContainText("卡片占用已释放");
  await expect(dialog).toContainText("支付失败");
  await expect(end).toHaveCount(0);
  expect(details).toBeGreaterThan(1);
  expect(lists).toBeGreaterThan(1);
});

test("X direct admin cancel sends nothing and uncertain end keeps review status", async ({ page }) => {
  await mockAdmin(page);
  const id = "11111111-1111-4111-8111-111111111111";
  const order = { id, recipient: "recipient", plan: "premium_3m", cardId: 7, status: "review_required", serviceFee: "2.50", serviceFeeStatus: "charged", ownerUserId: 12, ownerEmail: "customer@example.test", createdAt: "2026-09-30T01:00:00Z" };
  const other = { ...order, id: "22222222-2222-4222-8222-222222222222", recipient: "other", ownerEmail: "other@example.test" };
  let posts = 0;
  let details = 0;
  await page.route("**/api/admin/x-direct/orders?*", route => route.fulfill({ json: { code: 200, data: { list: [order, other], total: 2, page: 1, pageSize: 20 } } }));
  await page.route(`**/api/admin/x-direct/orders/${id}`, route => { details++; return route.fulfill({ json: { code: 200, data: order } }); });
  await page.route(`**/api/admin/x-direct/orders/${other.id}`, route => route.fulfill({ json: { code: 200, data: other } }));
  await page.route(`**/api/admin/x-direct/orders/${id}/end`, route => { posts++; return route.fulfill({ status: 409, json: { code: 409, errorCode: "X_PAYMENT_REVIEW_REQUIRED", error: "付款结果待核查，卡片仍被占用，服务费暂不退还" } }); });
  let confirms = 0;
  page.on("dialog", dialog => { confirms++; void (confirms === 1 ? dialog.dismiss() : dialog.accept()); });
  await page.goto("/admin?panel=xDirect");
  await page.getByRole("button", { name: "详情 / 账单" }).first().click();
  const dialog = page.getByRole("dialog", { name: "X 直充订单详情" });
  await dialog.getByRole("button", { name: "结束订单" }).click();
  expect(posts).toBe(0);
  await dialog.getByRole("button", { name: "结束订单" }).click();
  await expect(dialog.getByRole("alert")).toContainText("付款结果待核查");
  await expect(dialog).toContainText("结果待核对");
  await expect(dialog.getByRole("status")).toHaveCount(0);
  expect(posts).toBe(1);
  await expect.poll(() => details).toBeGreaterThan(1);
  await dialog.locator(".card-transaction-drawer-head button").click();
  await page.getByRole("button", { name: "详情 / 账单" }).nth(1).click();
  await expect(dialog).toContainText("other@example.test");
  await expect(dialog.getByRole("alert")).toHaveCount(0);
});

test("X direct admin hides ending for active, paid, and terminal orders", async ({ page }) => {
  await mockAdmin(page);
  const id = "11111111-1111-4111-8111-111111111111";
  const base = { id, recipient: "recipient", plan: "premium_3m", cardId: 7, serviceFee: "2.50", serviceFeeStatus: "charged", ownerUserId: 12, ownerEmail: "customer@example.test", createdAt: "2026-09-30T01:00:00Z" };
  let status = "prepared";
  await page.route("**/api/admin/x-direct/orders?*", route => route.fulfill({ json: { code: 200, data: { list: [{ ...base, status }], total: 1, page: 1, pageSize: 20 } } }));
  await page.route(`**/api/admin/x-direct/orders/${id}`, route => route.fulfill({ json: { code: 200, data: { ...base, status } } }));
  await page.goto("/admin?panel=xDirect");
  await page.getByRole("button", { name: "详情 / 账单" }).click();
  const dialog = page.getByRole("dialog", { name: "X 直充订单详情" });
  await expect(dialog.getByRole("button", { name: "结束订单" })).toBeVisible();
  status = "requires_action";
  await dialog.getByRole("button", { name: "刷新已保存详情" }).click();
  await expect(dialog.getByRole("button", { name: "结束订单" })).toBeVisible();
  for (const next of ["processing", "paid_pending_delivery", "completed", "cancelled", "failed", "failed_precharge", "ineligible"]) {
    status = next;
    await dialog.getByRole("button", { name: "刷新已保存详情" }).click();
    await expect(dialog).toContainText(next === "processing" ? "正在充值" : next === "paid_pending_delivery" ? "已付款，等待到账" : next === "completed" ? "充值完成" : next === "cancelled" ? "已取消" : next === "failed" ? "支付失败" : next === "failed_precharge" ? "未扣款，充值未完成" : "账号暂不符合充值条件");
    await expect(dialog.getByRole("button", { name: "结束订单" })).toHaveCount(0);
  }
});

test("X direct admin isolates a late end response after switching orders on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockAdmin(page);
  const first = { id: "11111111-1111-4111-8111-111111111111", recipient: "first", plan: "premium_3m", cardId: 7, status: "review_required", serviceFee: "2.50", serviceFeeStatus: "charged", ownerUserId: 12, ownerEmail: "first@example.test", createdAt: "2026-09-30T01:00:00Z" };
  const second = { ...first, id: "22222222-2222-4222-8222-222222222222", recipient: "second", ownerEmail: "second@example.test" };
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/admin/x-direct/orders?*", route => route.fulfill({ json: { code: 200, data: { list: [first, second], total: 2, page: 1, pageSize: 20 } } }));
  await page.route(`**/api/admin/x-direct/orders/${first.id}`, route => route.fulfill({ json: { code: 200, data: first } }));
  await page.route(`**/api/admin/x-direct/orders/${second.id}`, route => route.fulfill({ json: { code: 200, data: second } }));
  await page.route(`**/api/admin/x-direct/orders/${first.id}/end`, async route => { await pending; await route.fulfill({ json: { code: 200, data: { ...first, status: "failed" } } }); });
  page.on("dialog", dialog => { void dialog.accept(); });
  await page.goto("/admin?panel=xDirect");
  await page.getByTestId("admin-nav-xDirect").click();
  await page.getByRole("button", { name: "详情 / 账单" }).first().click();
  const dialog = page.getByRole("dialog", { name: "X 直充订单详情" });
  await dialog.getByRole("button", { name: "结束订单" }).click();
  await dialog.locator(".card-transaction-drawer-head button").click();
  await page.getByRole("button", { name: "详情 / 账单" }).nth(1).click();
  await expect(dialog).toContainText("second@example.test");
  release();
  await expect(dialog.getByRole("status")).toHaveCount(0);
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "结束订单" })).toBeVisible();
});
