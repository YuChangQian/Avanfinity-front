import { test, expect, type Page } from "@playwright/test";

// Removing reload recovery must lose the open drawer and accepted batch rows.
// The network boundary is mocked so these tests cannot create charges.
async function setup(page: Page, options: { holdCreate?: boolean; capacity?: number; expiresMs?: number; loseResponse?: boolean } = {}) {
  let completed = false;
  let creates = 0;
  const details: string[] = [];
  await page.addInitScript(() => {
    if (!localStorage.getItem("session")) localStorage.setItem("session", JSON.stringify({ token: "", userId: 101, email: "owner@example.test" }));
  });
  const order = (id: string) => ({ id, plan: "plus", status: completed ? "completed" : "running", stage: completed ? "complete" : "payment_processing",
    maskedEmail: "s***@example.test", operationStatus: completed ? "SUCCEEDED" : "SUBMITTED", clientRequestId: "request-1",
    createdAt: "2026-10-19T00:00:00Z", updatedAt: new Date().toISOString() });
  await page.route("**/api/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let data: unknown = { total: 0, list: [] };
    if (path === "/api/features") data = { version: 1, gptDirect: true, cardOpening: true, gptCdk: true };
    else if (path === "/api/dashboard") return route.fulfill({ json: { email: "owner@example.test", role: "customer", walletBalance: "100", cardBalance: "100", cardCount: 1, inviteCode: "TEST" } });
    else if (path === "/api/cards") data = { total: 1, list: [{ id: 91, status: "ACTIVE", balance: "100", cardNumberMasked: "545020 **** 4242", productCode: "P1", network: "Mastercard", createdAt: "2026-10-19T00:00:00Z" }] };
    else if (path === "/api/cards/91") data = { id: 91, status: "ACTIVE", availableAmount: "100", minAmount: "1", maxAmount: "50000", pendingOperationId: null, upstreamSyncedAt: new Date().toISOString() };
    else if (path === "/api/products" || path === "/api/support/tickets" || path === "/api/announcements/unread") data = [];
    else if (path.endsWith("/plans")) data = { version: 1, batchConcurrencyByCountry: { PH: options.capacity ?? 1 }, checkoutCountries: [{ country: "PH", currency: "PHP" }], plans: [{ key: "plus", label: "Plus", enabled: true, serviceFeeUsdMinor: 100, customerServiceFee: "1.0000" }] };
    else if (path.endsWith("/preflight")) data = { email: "safe@example.test", currentPlan: "free", credentialMode: "session", preflightToken: "secret-preflight", preflightExpiresAt: options.expiresMs ? new Date(Date.now() + options.expiresMs).toISOString() : "2099-01-01T00:00:00Z", paymentCountry: "PH", paymentCurrency: "PHP", quoteEstimatesUsd: { plus: "16" }, quotes: { plus: { plan: "plus", country: "PH", currency: "PHP", amountMinor: 10000, amountMajor: 100, minorUnitExponent: 2 } } };
    else if (path.endsWith("/orders") && request.method() === "POST") {
      creates += 1;
      if (options.loseResponse) return route.fulfill({ status: 503, json: { error: "Submission acknowledgement lost" } });
      if (options.holdCreate) return; // Reload aborts an unresolved submission; never replay it.
      data = order(`accepted-${creates}`);
    } else if (/\/orders\/accepted-\d+$/.test(path)) {
      const id = path.split("/").at(-1)!;
      details.push(id);
      data = { order: order(id), events: [{ eventId: `event-${details.length}`, type: "gpt_direct.progress", status: completed ? "completed" : "running", stage: completed ? "complete" : "payment_processing", publicMessage: completed ? "Reload server completion" : "Server processing", createdAt: new Date().toISOString() }] };
    }
    await route.fulfill({ json: { code: 0, data } });
  });
  return { complete: () => { completed = true; }, creates: () => creates, details };
}

const exportedSession = (n: number) => JSON.stringify({ accessToken: `secret-access-${n}`, sessionToken: `secret-cookie-${n}`, user: { email: `secret${n}@example.test` } });

async function beginBatch(page: Page, count = 2) {
  await page.goto("/gpt-direct");
  await page.getByRole("radio", { name: "Session 批量直充", exact: true }).check();
  await page.getByLabel("批量 Session", { exact: true }).fill(Array.from({ length: count }, (_, i) => exportedSession(i)).join("\n"));
  await page.getByRole("button", { name: "开始批量直充", exact: true }).click();
  await page.getByRole("button", { name: "确认支付选中账号", exact: true }).click();
}

test("GPT direct restores the accepted single order drawer from current server state after reload", async ({ page }) => {
  const state = await setup(page);
  await page.goto("/gpt-direct");
  await page.getByLabel("Session 凭据", { exact: true }).fill(exportedSession(1));
  await page.getByRole("button", { name: "验证凭据与获取报价", exact: true }).click();
  await page.getByRole("button", { name: "提交开通", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  state.complete();
  await page.reload();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("Reload server completion");
  expect(state.creates()).toBe(1);
  await expect(page.getByLabel("Session 凭据", { exact: true })).toHaveValue("");
});

test("GPT batch reload polls accepted orders and halts queued accounts without retaining credentials", async ({ page }) => {
  const state = await setup(page);
  await beginBatch(page);
  await expect(page.locator(".gpt-batch-results li.is-processing")).toHaveCount(1);
  await expect(page.locator(".gpt-batch-results li.is-queued")).toHaveCount(1);
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  for (const secret of ["secret-access", "secret-cookie", "secret-preflight", "secret0@", "secret1@"]) expect(stored).not.toContain(secret);
  await page.reload();
  await expect(page.locator(".gpt-batch-results li")).toHaveCount(2);
  await expect(page.locator(".gpt-batch-results li").nth(1)).toContainText("未提交");
  const before = state.details.length;
  state.complete();
  await expect(page.locator(".gpt-batch-results li.is-completed")).toHaveCount(1, { timeout: 10_000 });
  expect(state.details.length).toBeGreaterThan(before);
  expect(state.creates()).toBe(1);
});

test("GPT batch reload halts an ambiguous submission and does not submit its queued successor", async ({ page }) => {
  const state = await setup(page, { holdCreate: true });
  await beginBatch(page);
  await expect(page.locator(".gpt-batch-results li.is-submitting")).toHaveCount(1);
  await page.reload();
  await expect(page.locator(".gpt-batch-results li")).toHaveCount(2);
  await expect(page.locator(".gpt-batch-results li").first()).toContainText("结果待确认");
  await expect(page.locator(".gpt-batch-results li").nth(1)).toContainText("未提交");
  expect(state.creates()).toBe(1);
});

test("GPT progress belongs only to its logged-in user", async ({ page }) => {
  const state = await setup(page);
  await beginBatch(page, 1);
  await expect(page.locator(".gpt-batch-results li.is-processing")).toHaveCount(1);
  await page.evaluate(() => localStorage.setItem("session", JSON.stringify({ token: "", userId: 202, email: "other@example.test" })));
  const before = state.details.length;
  await page.reload();
  await expect(page.locator(".gpt-direct-form")).toBeVisible();
  await expect(page.locator(".gpt-batch-results li")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(state.details.length).toBe(before);
});


test("GPT batch never pays a queued account after its confirmed quote expires", async ({ page }) => {
  const state = await setup(page, { expiresMs: 20_000 });
  await page.clock.install();
  await beginBatch(page);
  await expect(page.locator(".gpt-batch-results li.is-processing")).toHaveCount(1);
  await page.clock.fastForward(30_000);
  state.complete();
  await page.clock.fastForward(3_000);
  await expect(page.locator(".gpt-batch-results li.is-completed")).toHaveCount(1);
  await expect(page.locator(".gpt-batch-results li.is-failed")).toHaveCount(1);
  expect(state.creates()).toBe(1);
});

test("GPT batch preview shows verified email on mobile and reload requires reimport without payment", async ({ page }) => {
  const state = await setup(page);
  await page.goto("/gpt-direct");
  await page.getByRole("radio", { name: "Session 批量直充", exact: true }).check();
  await page.getByLabel("批量 Session", { exact: true }).fill(exportedSession(0));
  await page.getByRole("button", { name: "开始批量直充", exact: true }).click();
  await expect(page.locator(".gpt-batch-preview")).toContainText("safe@example.test");
  await page.locator(".gpt-batch-preview").screenshot({ path: "../artifacts/gpt-smart-pool-20261019/workspace-gpt-batch-preview-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".gpt-batch-preview").screenshot({ path: "../artifacts/gpt-smart-pool-20261019/workspace-gpt-batch-preview-mobile.png" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.reload();
  await expect(page.locator(".gpt-batch-preview")).toHaveCount(0);
  await expect(page.getByText("页面已刷新，未确认的账号没有提交。请重新导入凭据并预检后再确认支付。", { exact: true })).toBeVisible();
  await expect(page.locator("textarea").first()).toHaveValue("");
  expect(state.creates()).toBe(0);
});


test("GPT single accepted-response loss remains unknown after reload and blocks another payment until history is checked", async ({ page }) => {
  const state = await setup(page, { loseResponse: true });
  await page.goto("/gpt-direct");
  await page.getByLabel("Session 凭据", { exact: true }).fill(exportedSession(1));
  await page.getByRole("button", { name: "验证凭据与获取报价", exact: true }).click();
  await page.getByRole("button", { name: "提交开通", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Submission acknowledgement lost");
  await page.reload();
  await expect(page.getByRole("button", { name: "已核对订单记录", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "提交开通", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "已核对订单记录", exact: true }).click();
  await expect(page.getByRole("button", { name: "已核对订单记录", exact: true })).toHaveCount(0);
  expect(state.creates()).toBe(1);
});


test("GPT restored batch final statuses are rechecked with the server", async ({ page }) => {
  const state = await setup(page);
  await page.addInitScript(() => localStorage.setItem("gpt-direct-progress:101", JSON.stringify({ activeOrderId: "", batch: [{ orderId: "accepted-1", status: "completed" }] })));
  await page.goto("/gpt-direct");
  await expect(page.locator(".gpt-batch-results li.is-processing")).toHaveCount(1);
  expect(state.details).toContain("accepted-1");
  expect(state.creates()).toBe(0);
});
