import { test, expect, type Page } from "@playwright/test";

// Starting must never charge, and retrying a busy pool must preserve the intent.
// All API requests are intercepted; only synthetic Session exports are used.
async function setup(page: Page, options: { failedAccount?: number; busyFirst?: boolean; expiredFirst?: boolean; capacity?: number; rateLimitedFirst?: boolean } = {}) {
  const preflights: Record<string, unknown>[] = [];
  const orders: Array<{ body: Record<string, unknown>; key: string }> = [];
  await page.addInitScript(() => localStorage.setItem("session", JSON.stringify({ token: "", userId: 101, email: "owner@example.test" })));
  await page.route("**/*", route => ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  const order = (id: string) => ({ id, plan: "plus", status: "completed", stage: "complete", maskedEmail: "s***@example.test", cardId: 91,
    serviceFee: "1", serviceFeeStatus: "settled", operationStatus: "SUCCEEDED", clientRequestId: "mock-request",
    createdAt: "2026-10-19T00:00:00Z", updatedAt: "2026-10-19T00:00:00Z" });
  await page.route("**/api/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    let data: unknown = { total: 0, list: [] };
    if (path === "/api/features") data = { version: 1, gptDirect: true, cardOpening: true, gptCdk: true };
    else if (path === "/api/dashboard") return route.fulfill({ json: { email: "owner@example.test", role: "customer", walletBalance: "100", cardBalance: "100", cardCount: 1, inviteCode: "TEST" } });
    else if (path === "/api/cards") data = { total: 1, list: [{ id: 91, status: "ACTIVE", balance: "100", cardNumberMasked: "545020 **** 4242", productCode: "P5378OX", network: "Mastercard", createdAt: "2026-10-19T00:00:00Z" }] };
    else if (path === "/api/products") data = [{ productCode: "P5378OX", issuer: "Test Bank", network: "MASTERCARD", issuingArea: "US", cardType: "Virtual", openFee: "1", rechargeRate: "0.01", openQuoteVersion: "a".repeat(64), minAmount: "1", maxAmount: "50000", restrictedMerchants: [], googleChatgptBlocked: false, displayBin: "537872", displayBins: ["537872"] }];
    else if (path === "/api/support/tickets" || path === "/api/announcements/unread") data = [];
    else if (path.endsWith("/plans")) data = { version: 2, batchConcurrencyByCountry: { PH: options.capacity ?? 2 }, checkoutCountries: [{ country: "PH", currency: "PHP" }], plans: [{ key: "plus", label: "Plus", enabled: true, serviceFeeUsdMinor: 100, customerServiceFee: "1" }] };
    else if (path.endsWith("/preflight")) {
      const body = request.postDataJSON() as Record<string, unknown>;
      preflights.push(body);
      const account = Number(JSON.parse((body.credential as { session: string }).session).accessToken.split("-").at(-1));
      if (account === options.failedAccount) return route.fulfill({ status: 400, json: { error: "Synthetic session rejected", errorCode: "SESSION_INVALID" } });
      data = { email: `account${account}@example.test`, currentPlan: account === 2 ? "plus" : "free", credentialMode: "session",
        preflightToken: `test-preflight-${account}`, preflightExpiresAt: options.expiredFirst && preflights.length === 1 ? "2000-01-01T00:00:00Z" : "2099-01-01T00:00:00Z", paymentCountry: "PH", paymentCurrency: "PHP",
        quotes: { plus: { plan: "plus", country: "PH", currency: "PHP", amountMinor: 98214, amountMajor: 982.14, minorUnitExponent: 2 } }, quoteEstimatesUsd: { plus: "16" } };
    } else if (path.endsWith("/orders") && request.method() === "POST") {
      orders.push({ body: request.postDataJSON(), key: request.headers()["idempotency-key"] ?? "" });
      if (options.busyFirst && orders.length === 1) return route.fulfill({ status: 409, json: { error: "Smart card pool busy", errorCode: "SMART_CARD_POOL_BUSY" } });
      if (options.rateLimitedFirst && orders.length === 1) return route.fulfill({ status: 429, headers: { "Retry-After": "1" }, json: { error: "Synthetic rate limit" } });
      data = order(`accepted-${orders.length}`);
    } else if (/\/orders\/accepted-\d+$/.test(path)) data = { order: order(path.split("/").at(-1)!), events: [] };
    await route.fulfill({ json: { code: 0, data } });
  });
  return { preflights, orders };
}

async function preview(page: Page, count = 2, smart = false, dedicated = false) {
  await page.goto("/gpt-direct");
  await page.getByRole("radio", { name: "Session 批量直充", exact: true }).check();
  if (smart) await page.getByText("智能卡池轮换", { exact: true }).click();
  if (dedicated) await page.getByRole("checkbox", { name: /^一卡一号/ }).check();
  await page.getByLabel("批量 Session", { exact: true }).fill(Array.from({ length: count }, (_, i) => JSON.stringify({ accessToken: `synthetic-access-${i + 1}`, sessionToken: `synthetic-cookie-${i + 1}` })).join("\n"));
  await page.getByRole("button", { name: "开始批量直充", exact: true }).click();
  await expect(page.locator(".gpt-batch-preview li")).toHaveCount(count);
}
const confirmPayment = (page: Page) => page.getByRole("button", { name: "确认支付选中账号", exact: true });

test("GPT batch preview shows membership and quotes without creating any order", async ({ page }) => {
  const state = await setup(page);
  await preview(page);
  const rows = page.locator(".gpt-batch-preview li");
  await expect(rows.nth(0)).toContainText(/Free|免费/i);
  await expect(rows.nth(1)).toContainText(/Plus/i);
  await expect(rows.nth(0)).toContainText("982.14");
  await expect(rows.nth(1)).toContainText("982.14");
  await expect(rows.nth(0)).toContainText("PHP");
  await expect(page.getByRole("checkbox", { name: "选择账号 1", exact: true })).toBeEnabled();
  await expect(confirmPayment(page)).toBeVisible();
  expect(state.preflights).toHaveLength(2);
  expect(state.orders).toHaveLength(0);
});

test("GPT batch selection pays only the selected valid row and excludes failed previews", async ({ page }) => {
  const state = await setup(page, { failedAccount: 3 });
  await preview(page, 3);
  const first = page.getByRole("checkbox", { name: "选择账号 1", exact: true });
  const second = page.getByRole("checkbox", { name: "选择账号 2", exact: true });
  const failed = page.getByRole("checkbox", { name: "选择账号 3", exact: true });
  await expect(failed).toBeDisabled();
  await page.getByRole("button", { name: "全选", exact: true }).click();
  await expect(first).toBeChecked();
  await expect(second).toBeChecked();
  await expect(failed).not.toBeChecked();
  await page.getByRole("button", { name: "反选", exact: true }).click();
  await expect(first).not.toBeChecked();
  await expect(second).not.toBeChecked();
  await expect(failed).not.toBeChecked();
  await expect(confirmPayment(page)).toBeDisabled();
  await second.check();
  expect(state.orders).toHaveLength(0);
  await confirmPayment(page).click();
  await expect(page.locator(".gpt-batch-results li.is-completed")).toHaveCount(1);
  expect(state.orders).toHaveLength(1);
  expect(state.orders[0].body.preflightToken).toBe("test-preflight-2");
  expect(state.orders[0].body.credential).toEqual({ mode: "session", session: JSON.stringify({ accessToken: "synthetic-access-2", sessionToken: "synthetic-cookie-2" }) });
  expect(state.preflights).toHaveLength(3);
});

test("GPT batch one-card-per-account disables existing card reuse", async ({ page }) => {
  const state = await setup(page);
  await preview(page, 1, true, true);
  await confirmPayment(page).click();
  await expect(page.locator(".gpt-batch-results li.is-completed")).toHaveCount(1);
  expect(state.orders).toHaveLength(1);
  expect(state.orders[0].body.autoCard).toMatchObject({ oneCardPerAccount: true, reuseExisting: false });
});

test("GPT batch busy smart-card retry preserves payload, client request ID and idempotency key", async ({ page }) => {
  const state = await setup(page, { busyFirst: true });
  await preview(page, 1, true);
  await confirmPayment(page).click();
  await expect(page.locator(".gpt-batch-results li.is-completed")).toHaveCount(1, { timeout: 15_000 });
  expect(state.orders).toHaveLength(2);
  expect(state.orders[0].key).not.toBe("");
  expect(state.orders[0].body.clientRequestId).toBeTruthy();
  expect(state.orders[1]).toEqual(state.orders[0]);
  expect(state.preflights).toHaveLength(1);
});


test("GPT batch expired quote refreshes and requires a second payment confirmation", async ({ page }) => {
  const state = await setup(page, { expiredFirst: true });
  await preview(page, 1);
  await confirmPayment(page).click();
  await expect(page.getByRole("alert")).toContainText("报价已刷新");
  expect(state.preflights).toHaveLength(2);
  expect(state.orders).toHaveLength(0);
  await confirmPayment(page).click();
  await expect(page.locator(".gpt-batch-results li.is-completed")).toHaveCount(1);
  expect(state.orders).toHaveLength(1);
  expect(state.preflights).toHaveLength(2);
});


test("GPT batch preserves a custom proxy when platform capacity is zero", async ({ page }) => {
  const state = await setup(page, { capacity: 0 });
  await page.goto("/gpt-direct");
  await page.getByRole("radio", { name: "Session 批量直充", exact: true }).check();
  await page.getByLabel("批量 Session", { exact: true }).fill(JSON.stringify({ accessToken: "synthetic-access-1", sessionToken: "synthetic-cookie-1" }));
  await page.getByPlaceholder("socks5://user:pass@host:port").fill("socks5://synthetic:proxy@proxy.example.test:1080");
  await page.getByRole("button", { name: "开始批量直充", exact: true }).click();
  await expect(page.locator(".gpt-batch-preview li")).toHaveCount(1);
  expect(state.orders).toHaveLength(0);
  await confirmPayment(page).click();
  await expect(page.locator(".gpt-batch-results li.is-completed")).toHaveCount(1);
  expect(state.orders).toHaveLength(1);
  expect(state.preflights).toHaveLength(1);
});


test("GPT batch rate-limit retry preserves its complete payment intent", async ({ page }) => {
  const state = await setup(page, { rateLimitedFirst: true });
  await preview(page, 1, true);
  await confirmPayment(page).click();
  await expect(page.locator(".gpt-batch-results li.is-completed")).toHaveCount(1, { timeout: 15_000 });
  expect(state.orders).toHaveLength(2);
  expect(state.orders[0].key).not.toBe("");
  expect(state.orders[1]).toEqual(state.orders[0]);
  expect(state.preflights).toHaveLength(1);
});
