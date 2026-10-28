import { test, expect, type Page } from "@playwright/test";

const operationId = "b7abf0da-89e1-48dc-ac98-d60234199a22";
const waiting = "正在开卡并确认结果，通常需要 1–3 分钟。请留在此页等待，无需重复提交。";
const delayed = "开卡耗时较长，系统仍在后台确认。这不代表开卡失败，请勿重复开卡。可继续查询，或稍后到「我的卡片」查看。";

async function openingPage(page: Page) {
  await page.clock.install();
  await page.addInitScript(() => localStorage.setItem("session", JSON.stringify({ token: "", userId: 1, email: "open@example.test" })));
  await page.route("**/api/**", route => route.fulfill({ json: { code: 0, data: [] } }));
  await page.route("**/api/dashboard", route => route.fulfill({ json: { userId: 1, role: "user", walletBalance: "100", cardBalance: "10", cardCount: 1 } }));
  await page.route("**/api/features", route => route.fulfill({ json: { code: 0, data: { version: 1, cardOpening: true, cardManagement: true, cardRecharge: true, market: false } } }));
  await page.route("**/api/products", route => route.fulfill({ json: { code: 0, data: [{
    productCode: "WAIT", issuer: "Test", network: "VISA", issuingArea: "US", cardType: "Virtual",
    openFee: "1", openQuoteVersion: "a".repeat(64), rechargeRate: "0", refundRate: "0", minAmount: "10", maxAmount: "100",
  }] } }));
  await page.route("**/api/cards/81", route => route.fulfill({ json: { code: 0, data: {
    id: 81, cardNumberMasked: "•••• 8101", productCode: "WAIT", status: "ACTIVE", network: "VISA", issuingArea: "US",
    availableAmount: "10", firstName: "Open", lastName: "Test", minAmount: "10", maxAmount: "100", rechargeRate: "0", refundRate: "0",
  } } }));
  await page.goto("/cards/open/WAIT");
  await page.getByPlaceholder("Ada").fill("Open");
  await page.getByPlaceholder("Lovelace").fill("Test");
}

for (const intermediate of ["PENDING", "RECONCILE_REQUIRED"]) {
  test(`open card waits through ${intermediate} and opens the confirmed card once`, async ({ page }) => {
    await openingPage(page);
    let posts = 0;
    let reads = 0;
    let succeeded = false;
    await page.route("**/api/cards/open", route => {
      posts++;
      return route.fulfill({ status: 202, json: { error: "开卡结果未知，等待对账", operationId } });
    });
    await page.route(`**/api/operations/${operationId}`, route => {
      reads++;
      return route.fulfill({ json: { code: 0, data: {
        operationId, type: "OPEN_CARD", status: succeeded ? "SUCCEEDED" : intermediate, terminal: succeeded,
        result: succeeded ? { cardIds: [81] } : null,
      } } });
    });
    await page.getByRole("button", { name: "确认开卡", exact: true }).click();
    await expect.poll(() => reads).toBe(1);
    await expect(page.getByRole("status").filter({ hasText: waiting })).toBeVisible();
    await expect(page.getByRole("button", { name: "开卡中…", exact: true })).toBeDisabled();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await page.clock.fastForward(60_000);
    await expect.poll(() => reads).toBe(2);
    await expect(page).toHaveURL(/\/cards\/open\/WAIT$/);
    succeeded = true;
    await page.clock.fastForward(2_000);
    await expect(page).toHaveURL(/\/cards\/81$/);
    expect(posts).toBe(1);
  });
}

test("open card reports a confirmed failure without waiting three minutes", async ({ page }) => {
  await openingPage(page);
  await page.route("**/api/cards/open", route => route.fulfill({ status: 202, json: { operationId } }));
  await page.route(`**/api/operations/${operationId}`, route => route.fulfill({ json: { code: 0, data: {
    operationId, type: "OPEN_CARD", status: "FAILED", terminal: true, result: null, error: "发卡失败，款项已退回钱包",
  } } }));
  await page.getByRole("button", { name: "确认开卡", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("发卡失败，款项已退回钱包");
  await expect(page.getByRole("button", { name: "确认开卡", exact: true })).toBeEnabled();
});

test("open card counts the submit time in its wait limit and can continue checking the same operation", async ({ page }, testInfo) => {
  await openingPage(page);
  let posts = 0;
  let reads = 0;
  let succeeded = false;
  let respond: (() => Promise<void>) | undefined;
  await page.route("**/api/cards/open", route => {
    posts++;
    respond = () => route.fulfill({ status: 202, json: { operationId } });
  });
  await page.route(`**/api/operations/${operationId}`, route => {
    reads++;
    return route.fulfill({ json: { code: 0, data: {
      operationId, type: "OPEN_CARD", status: succeeded ? "SUCCEEDED" : "RECONCILE_REQUIRED", terminal: succeeded,
      result: succeeded ? { cardIds: [81] } : null,
    } } });
  });
  await page.getByRole("button", { name: "确认开卡", exact: true }).click();
  await expect.poll(() => posts).toBe(1);
  await page.clock.fastForward(30_000);
  await respond!();
  await expect.poll(() => reads).toBe(1);
  for (const expected of [2, 3]) {
    await page.clock.fastForward(60_000);
    await expect.poll(() => reads).toBe(expected);
  }
  await expect(page.getByRole("status").filter({ hasText: waiting })).toBeVisible();
  await page.clock.fastForward(30_000);
  await expect(page.getByRole("status").filter({ hasText: delayed })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: delayed })).toContainText(operationId);
  await expect(page.getByRole("button", { name: "确认开卡", exact: true })).toBeDisabled();
  await expect(page.getByRole("link", { name: "查看我的卡片", exact: true })).toHaveAttribute("href", "/cards/owned");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `../../pending-${testInfo.project.name}.png`, fullPage: true });
  const readsAtLimit = reads;
  await page.clock.fastForward(60_000);
  expect(reads).toBe(readsAtLimit);
  succeeded = true;
  await page.getByRole("button", { name: "继续查询开卡结果", exact: true }).click();
  await expect(page).toHaveURL(/\/cards\/81$/);
  expect(posts).toBe(1);
});

test("open card keeps waiting when a result query has a temporary service failure", async ({ page }) => {
  await openingPage(page);
  let reads = 0;
  await page.route("**/api/cards/open", route => route.fulfill({ status: 202, json: { operationId } }));
  await page.route(`**/api/operations/${operationId}`, route => {
    reads++;
    return reads === 1
      ? route.fulfill({ status: 503, json: { error: "temporary" } })
      : route.fulfill({ json: { code: 0, data: { operationId, type: "OPEN_CARD", status: "SUCCEEDED", terminal: true, result: { cardIds: [81] } } } });
  });
  await page.getByRole("button", { name: "确认开卡", exact: true }).click();
  await expect.poll(() => reads).toBe(1);
  await expect(page.getByRole("status").filter({ hasText: waiting })).toBeVisible();
  await page.clock.fastForward(2_000);
  await expect(page).toHaveURL(/\/cards\/81$/);
});

test("open card still accepts an immediate success", async ({ page }) => {
  await openingPage(page);
  await page.route("**/api/cards/open", route => route.fulfill({ json: { code: 0, data: { cardIds: [81], balance: "89", replayed: false } } }));
  await page.getByRole("button", { name: "确认开卡", exact: true }).click();
  await expect(page).toHaveURL(/\/cards\/81$/);
});
