import { test, expect } from "@playwright/test";

test.skip(true, "X customer flows are retired; see customer-entry-visibility.spec.ts for current behavior.");

const code = "XCDK-PRIVATE-CODE-1234567890";
const plans = ["premium_3m", "premium_6m", "premium_12m", "premium_plus_3m", "premium_plus_6m", "premium_plus_12m"].map((key, i) => ({ key, label: `${i < 3 ? "Premium" : "Premium+"} · ${["3 个月", "6 个月", "1 年"][i % 3]}`, enabled: true }));

test("X direct CDK generation preserves authorization and retries one intent before exporting and revoking", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("session", JSON.stringify({ token: "", email: "issuer@example.test" })));
  await page.route("**/api/**", route => route.fulfill({ json: { code: 200, data: [] } }));
  await page.route("**/api/dashboard", route => route.fulfill({ json: { role: "customer", email: "issuer@example.test", walletBalance: "100", cardBalance: "0", cardCount: 1 } }));
  await page.route("**/api/x-direct/plans", route => route.fulfill({ json: { code: 200, data: { plans, paymentsEnabled: true, serviceFee: "0" } } }));
  await page.route("**/api/cards?*", route => route.fulfill({ json: { code: 200, data: { total: 1, list: [{ id: 7, cardNumberMasked: "**** 4242", status: "ACTIVE", balance: "0", pendingOperationId: null }] } } }));
  await page.route("**/api/products", route => route.fulfill({ json: { code: 200, data: [{ productCode: "VISA_TEST", issuer: "Test", network: "VISA", openFee: "1.50", rechargeRate: "0.01", minAmount: "5", maxAmount: "500" }] } }));
  let item = { id: "cdk-1", plan: "premium_3m", status: "unused", codePrefix: "XCDK-PRIVATE", serviceFee: "2.50", pricingVersion: 1, maxWalletDebitUsd: "20", maxOfficialAmountMinor: 100000, currency: "bdt", fundingAmountUsd: "10", totalWalletDebitUsd: "12.60", cardId: 7, fundingFeeUsd: "0.10", openFeeUsd: "0", fundingDispatched: false, paymentDispatched: false, createdAt: "2026-09-30T01:00:00Z" };
  let generated = false;
  const attempts: Array<{ body: Record<string, unknown>; key?: string }> = [];
  await page.route("**/api/x-direct/cdks", route => route.fulfill({ json: { code: 200, data: { list: generated ? [item] : [] } } }));
  await page.route("**/api/x-direct/cdks/generate", route => {
    attempts.push({ body: route.request().postDataJSON(), key: route.request().headers()["idempotency-key"] });
    if (attempts.length === 1) return route.fulfill({ status: 500, json: { error: "private backend error" } });
    generated = true;
    return route.fulfill({ json: { code: 200, data: { list: [{ ...item, code }], replayed: false } } });
  });
  await page.route("**/api/x-direct/cdks/cdk-1/export", route => route.fulfill({ json: { code: 200, data: { id: "cdk-1", code } } }));
  await page.route("**/api/x-direct/cdks/cdk-1/revoke", route => { item = { ...item, status: "revoked" }; return route.fulfill({ json: { code: 200, data: item } }); });
  await page.goto("/x-direct");
  await page.getByRole("tab", { name: "CDK", exact: true }).click();
  const panel = page.getByTestId("x-cdk-issuer");
  await panel.getByRole("combobox", { name: "支付卡", exact: true }).click();
  await page.getByRole("option", { name: /4242/ }).click();
  await panel.getByRole("spinbutton", { name: "每张卡固定充值金额（USD）" }).fill("10");
  await panel.getByRole("spinbutton", { name: "每张 CDK 钱包扣款上限（USD）" }).fill("20");
  await panel.getByRole("spinbutton", { name: "官方金额上限（BDT）" }).fill("1000");
  await panel.getByRole("button", { name: "免费生成 CDK" }).click();
  await expect(panel.getByRole("alert")).toContainText("生成失败");
  await panel.getByRole("button", { name: "免费生成 CDK" }).click();
  await expect(panel.getByText(code, { exact: true })).toBeVisible();
  await expect(panel.getByText(/支付卡 #7 · 开卡费 USD/)).toContainText("充值费 USD 0.1");
  expect(attempts[0].key).toBeTruthy();
  expect(attempts[1]).toEqual(attempts[0]);
  expect(attempts[1].body).toEqual({ plan: "premium_3m", quantity: 1, cardId: 7, fundingAmountUsd: "10", maxWalletDebitUsd: "20", maxOfficialAmountMinor: 100000, currency: "BDT" });
  const download = page.waitForEvent("download");
  await panel.getByRole("button", { name: "导出未用 CDK" }).click();
  expect((await download).suggestedFilename()).toBe("x-cdks.txt");
  await panel.getByRole("button", { name: "撤销未用 CDK" }).click();
  await expect(panel.getByRole("button", { name: "撤销未用 CDK" })).toHaveCount(0);
  await panel.getByRole("combobox", { name: "支付卡模式" }).click();
  await page.getByRole("option", { name: "每张 CDK 新开一张卡" }).click();
  await panel.getByRole("combobox", { name: "开卡产品" }).click();
  await page.getByRole("option", { name: /VISA_TEST/ }).click();
  await panel.getByRole("textbox", { name: "持卡人名" }).fill("Ada");
  await panel.getByRole("textbox", { name: "持卡人姓" }).fill("Lovelace");
  await panel.getByRole("combobox", { name: "会员类型", exact: true }).click();
  await page.getByRole("option", { name: "Premium+", exact: true }).click();
  await panel.getByRole("combobox", { name: "充值时长", exact: true }).click();
  await page.getByRole("option", { name: "6 个月", exact: true }).click();
  await panel.getByRole("button", { name: "免费生成 CDK" }).click();
  await expect.poll(() => attempts.length).toBe(3);
  expect(attempts[2].body.autoCard).toEqual({ productCode: "VISA_TEST", firstName: "Ada", lastName: "Lovelace" });
  expect(attempts[2].body.plan).toBe("premium_plus_6m");
  expect(attempts[2].body).not.toHaveProperty("cardId");
  expect(attempts[2].key).not.toBe(attempts[1].key);
  expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toContain(code);
});

test("X direct CDK anonymous preflight retries fixed binding and recovers after reload without resubmitting payment", async ({ page }) => {
  await page.route("**/api/**", route => route.fulfill({ json: { code: 200, data: [] } }));
  const bodies: Record<string, Record<string, unknown>[]> = { preview: [], preflight: [], redeem: [], result: [] };
  let status = "prepared";
  await page.route("**/api/public/x-cdk/*", route => {
    const action = new URL(route.request().url()).pathname.split("/").pop()!;
    const body = route.request().postDataJSON();
    bodies[action].push(body);
    if (action === "preview") return route.fulfill({ json: { code: 200, data: { plan: "premium_plus_6m", status: "unused" } } });
    if (action === "preflight" && bodies.preflight.length === 1) return route.fulfill({ status: 500, json: { error: `secret ${code}` } });
    if (action === "redeem") { status = "completed"; return route.fulfill({ status: 500, json: { error: "uncertain" } }); }
    return route.fulfill({ json: { code: 200, data: { plan: "premium_plus_6m", status, recipient: "recipient", amountMinor: 90000, currency: "bdt", invoiceUrls: status === "completed" ? ["https://pay.stripe.com/receipts/payment/test_receipt", "https://evil.test/secret"] : [], issuerCookie: "private-cookie", message: "private-cookie" } } });
  });
  await page.goto("/x-cdk/redeem");
  await page.getByRole("textbox", { name: "X CDK 兑换码", exact: true }).fill(code);
  await page.getByRole("button", { name: "检查兑换码" }).click();
  await expect(page.getByText("Premium+ · 6 个月", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "X 用户名", exact: true }).fill("recipient");
  await page.getByRole("button", { name: "检查资格并获取报价" }).click();
  await expect(page.getByRole("alert")).not.toContainText(code);
  await page.getByRole("button", { name: "重试预检" }).click();
  await expect(page.getByText("BDT 900.00", { exact: true })).toBeVisible();
  expect(bodies.preflight[1]).toEqual(bodies.preflight[0]);
  expect(bodies.preflight[0].deviceToken).toMatch(/^[a-f0-9]{64}$/);
  await page.getByRole("button", { name: "确认兑换" }).click();
  await expect(page.getByRole("alert")).toContainText("查询原兑换状态");
  const original = bodies.redeem[0];
  expect(original.clientRequestId).toBe(bodies.preflight[0].clientRequestId);
  expect(original.expectedAmountMinor).toBe(90000);
  await page.reload();
  await page.getByRole("textbox", { name: "X CDK 兑换码", exact: true }).fill(code);
  await page.getByRole("button", { name: "查询原兑换状态" }).click();
  await expect(page.getByRole("status")).toContainText("兑换完成");
  expect(bodies.result.at(-1)?.clientRequestId).toBe(original.clientRequestId);
  expect(bodies.result.at(-1)?.deviceToken).toBe(original.deviceToken);
  expect(bodies.redeem).toHaveLength(1);
  await expect(page.getByRole("link", { name: "官方账单 / 收据 1" })).toHaveAttribute("href", "https://pay.stripe.com/receipts/payment/test_receipt");
  await expect(page.locator('a[href*="evil.test"]')).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("private-cookie");
  expect(page.url()).not.toContain(code);
  expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toContain(code);
});


test("X direct CDK funded recovery requires another explicit confirmation with the original quote", async ({ page }) => {
  await page.route("**/api/**", route => route.fulfill({ json: { code: 200, data: [] } }));
  let status = "unused";
  const payments: Record<string, unknown>[] = [];
  const checks: Record<string, unknown>[] = [];
  await page.route("**/api/public/x-cdk/*", route => {
    const action = new URL(route.request().url()).pathname.split("/").pop()!;
    if (action === "preflight") { status = payments.length ? "funded" : "prepared"; checks.push(route.request().postDataJSON()); }
    if (action === "redeem") { payments.push(route.request().postDataJSON()); status = payments.length === 1 ? "funded" : "completed"; }
    return route.fulfill({ json: { code: 200, data: { plan: "premium_3m", status, recipient: "recipient", amountMinor: 12345, currency: "bdt" } } });
  });
  await page.goto("/x-cdk/redeem");
  await page.getByRole("textbox", { name: "X CDK 兑换码", exact: true }).fill(code);
  await page.getByRole("button", { name: "检查兑换码" }).click();
  await page.getByRole("textbox", { name: "X 用户名", exact: true }).fill("recipient");
  await page.getByRole("button", { name: "检查资格并获取报价" }).click();
  await page.getByRole("button", { name: "刷新官方报价" }).click();
  await expect(page.getByRole("button", { name: "确认兑换" })).toBeEnabled();
  expect(checks[1]).toEqual(checks[0]);
  expect(payments).toHaveLength(0);
  await page.getByRole("button", { name: "确认兑换" }).click();
  await expect(page.getByRole("status")).toContainText("支付卡已准备完成");
  expect(payments).toHaveLength(1);
  await page.reload();
  await page.getByRole("textbox", { name: "X CDK 兑换码", exact: true }).fill(code);
  await page.getByRole("button", { name: "查询原兑换状态" }).click();
  await expect(page.getByRole("button", { name: "继续兑换" })).toBeVisible();
  expect(payments).toHaveLength(1);
  await page.getByRole("button", { name: "刷新官方报价" }).click();
  await expect(page.getByRole("button", { name: "继续兑换" })).toBeEnabled();
  expect(checks[2]).toEqual(checks[0]);
  expect(payments).toHaveLength(1);
  expect((await page.locator(".cdk-card").boundingBox())!.width).toBeGreaterThan(900);
  await page.screenshot({ path: "test-results/x-cdk/redeem-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".cdk-card").screenshot({ path: "test-results/x-cdk/redeem-mobile.png" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "继续兑换" }).click();
  await expect(page.getByRole("status")).toContainText("兑换完成");
  expect(payments[1]).toEqual(payments[0]);
  expect(payments[0].clientRequestId).toBe(checks[0].clientRequestId);
  expect(payments[0].expectedAmountMinor).toBe(12345);
  expect(checks).toHaveLength(3);
});

test("X direct CDK only retries a no-charge failure with explicit server permission and a fresh request", async ({ page }) => {
  await page.route("**/api/**", route => route.fulfill({ json: { code: 200, data: [] } }));
  const checks: Record<string, unknown>[] = [];
  const payments: Record<string, unknown>[] = [];
  await page.route("**/api/public/x-cdk/*", route => {
    const action = new URL(route.request().url()).pathname.split("/").pop()!;
    const body = route.request().postDataJSON();
    let data: Record<string, unknown> = { plan: "premium_3m", status: "unused" };
    if (action === "preflight") {
      checks.push(body);
      data = { ...data, status: checks.length === 1 ? "prepared" : "ineligible", recipient: body.recipient, amountMinor: 12345, currency: "bdt", canRetryPreflight: false };
    }
    if (action === "redeem") {
      payments.push(body);
      data = { ...data, status: "failed_precharge", recipient: "recipient", errorCode: "X_CDK_NOT_READY", canRetryPreflight: true, message: "issuer-wallet-private-balance" };
    }
    return route.fulfill({ json: { code: 200, data } });
  });
  await page.goto("/x-cdk/redeem");
  await page.getByRole("textbox", { name: "X CDK 兑换码", exact: true }).fill(code);
  await page.getByRole("button", { name: "检查兑换码" }).click();
  await page.getByRole("textbox", { name: "X 用户名", exact: true }).fill("recipient");
  await page.getByRole("button", { name: "检查资格并获取报价" }).click();
  await page.getByRole("button", { name: "确认兑换" }).click();
  await expect(page.getByRole("status")).toContainText("兑换未完成");
  await expect(page.locator("body")).not.toContainText("issuer-wallet-private-balance");
  await page.getByRole("button", { name: "重新核对账号并预检" }).click();
  await page.getByRole("textbox", { name: "X 用户名", exact: true }).fill("corrected");
  await page.getByRole("button", { name: "检查资格并获取报价" }).click();
  await expect(page.getByRole("status")).toContainText("账号暂不符合充值条件");
  expect(checks[1].clientRequestId).not.toBe(checks[0].clientRequestId);
  expect(checks[1].deviceToken).toBe(checks[0].deviceToken);
  expect(checks[1].recipient).toBe("corrected");
  expect(payments).toHaveLength(1);
  await expect(page.getByRole("button", { name: "重新核对账号并预检" })).toHaveCount(0);
  await expect(page.getByText("72小时内没有改过资料、个人信息、密码，以及陌生设备登录，才可以进行充值，您提供的账号暂不满足此条件。")).toBeVisible();
  expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toContain(code);
});
