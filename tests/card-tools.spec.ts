import { test, expect, type Page } from "@playwright/test";
async function setup(page: Page, enabled = true) {
  await page.addInitScript(() => { if (!localStorage.getItem("session")) localStorage.setItem("session", JSON.stringify({ token: "", userId: 7, email: "cards@example.test" })); });
  await page.route("**/api/**", r => r.fulfill({ json: { code: 0, data: [] } }));
  await page.route("**/api/features", r => r.fulfill({ json: { code: 0, data: { version: 1, cardDelete: enabled } } }));
  await page.route("**/api/dashboard", r => r.fulfill({ json: { userId: 7, role: "user", cardCount: 102, walletBalance: "10" } }));
  const searches: URLSearchParams[] = [];
  await page.route(/\/api\/cards(?:\?.*)?$/, r => {
    const q = new URL(r.request().url()).searchParams; searches.push(q);
    const search = q.get("search") ?? ""; const id = search ? 81 : Number(q.get("page") ?? 1);
    return r.fulfill({ json: { code: 0, data: { total: search ? 1 : 102, page: Number(q.get("page") ?? 1), pageSize: 20, list: [{ id, cardNumberMasked: `•••• ${id === 81 ? "8120" : "0001"}`, status: "ACTIVE", balance: "1", productCode: "TEST", network: "VISA", refundKeepMinimum: "0", firstName: "Test", lastName: "Card" }] } } });
  });
  return searches;
}
function batch(offset = 0, done = false) {
  return { id: "00000000-0000-4000-8000-000000000001", status: done ? "completed_with_errors" : "processing", total: 101,
    pending: done ? 0 : 1, succeeded: 99, failed: done ? 1 : 0, skipped: 1, reviewRequired: done ? 0 : 1, offset, limit: 100, hasMore: offset === 0,
    list: offset === 0 ? [{ cardId: 81, status: "skipped", operationId: null, reasonCode: "CARD_FROZEN" }] : [{ cardId: 201, status: done ? "failed" : "review_required", operationId: null, reasonCode: done ? "DELETE_FAILED" : "RECONCILIATION_REQUIRED" }],
  };
}
async function confirm(page: Page) {
  await page.getByRole("checkbox", { name: "我确认销掉当前账户的全部可销卡片" }).check();
  await page.getByRole("button", { name: "确认全部销卡", exact: true }).click();
}
test("owned card search resets pagination and clear restores all cards", async ({ page }) => {
  const searches = await setup(page); await page.goto("/cards/owned");
  await page.getByTestId("owned-cards-pagination").getByRole("button").last().click();
  await expect.poll(() => searches.at(-1)?.get("page")).toBe("2");
  await page.getByRole("textbox", { name: "搜索卡片" }).fill("812");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(page.locator(".bank-card")).toContainText("8120");
  expect(searches.at(-1)?.get("search")).toBe("812"); expect(searches.at(-1)?.get("page") ?? "1").toBe("1");
  await page.getByRole("button", { name: "清空搜索" }).click();
  await expect.poll(() => searches.at(-1)?.get("search")).toBeNull();
  await expect(page.locator(".bank-card")).toContainText("0001");
});
test("bulk close confirms all pages independent of search and restores paged results", async ({ page }) => {
  await setup(page); const writes: unknown[] = []; let done = false;
  await page.route("**/api/cards/closure-batches", r => { writes.push(r.request().postDataJSON()); return r.fulfill({ status: 202, json: { code: 0, data: batch() } }); });
  await page.route(/\/api\/cards\/closure-batches\/[^/?]+(?:\?.*)?$/, r => r.fulfill({ json: { code: 0, data: batch(Number(new URL(r.request().url()).searchParams.get("offset") ?? 0), done) } }));
  await page.goto("/cards/owned");
  await page.getByRole("textbox", { name: "搜索卡片" }).fill("812"); await page.getByRole("button", { name: "搜索", exact: true }).click();
  await page.getByRole("button", { name: "一键销卡", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("包括其他分页及搜索结果之外的卡片");
  await expect(page.getByRole("button", { name: "确认全部销卡", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "取消", exact: true }).click(); expect(writes).toEqual([]);
  await page.getByRole("button", { name: "一键销卡", exact: true }).click(); await confirm(page);
  await expect(page.getByTestId("card-closure-progress")).toContainText("等待核对"); expect(writes).toEqual([{ all: true }]);
  await expect(page.getByTestId("card-closure-progress")).toContainText("卡片已冻结");
  await page.reload(); await expect(page.getByTestId("card-closure-progress")).toContainText("卡片已冻结"); expect(writes).toHaveLength(1);
  await page.getByRole("button", { name: "下一页销卡结果" }).click(); await expect(page.getByTestId("card-closure-progress")).toContainText("#201");
  done = true;
  await expect(page.getByTestId("card-closure-progress")).toContainText("处理结束，部分卡片未销卡", { timeout: 12_000 }); expect(writes).toHaveLength(1);
});
test("bulk close lost response retries the same intent after reload", async ({ page }) => {
  await setup(page); const keys: string[] = [];
  await page.route("**/api/cards/closure-batches", r => {
    keys.push(r.request().headers()["idempotency-key"]);
    return keys.length === 1 ? r.abort("failed") : r.fulfill({ status: 202, json: { code: 0, data: batch() } });
  });
  await page.route(/\/api\/cards\/closure-batches\/[^/?]+(?:\?.*)?$/, r => r.fulfill({ json: { code: 0, data: batch() } }));
  await page.goto("/cards/owned"); await page.getByRole("button", { name: "一键销卡", exact: true }).click(); await confirm(page);
  await expect(page.getByRole("alert")).toContainText("提交结果尚未确认"); await page.reload();
  await page.getByRole("button", { name: "恢复销卡任务", exact: true }).click(); await confirm(page);
  await expect(page.getByTestId("card-closure-progress")).toBeVisible(); expect(keys).toHaveLength(2); expect(keys[0]).toBeTruthy(); expect(keys[1]).toBe(keys[0]);
});
test("bulk close hidden when disabled and batch not restored for another account", async ({ page }) => {
  await setup(page, false); await page.addInitScript(() => localStorage.setItem("card-closure:someone-else", JSON.stringify({ key: "old", id: "foreign" })));
  await page.goto("/cards/owned"); await expect(page.locator(".bank-card:not(.is-loading)")).toBeVisible();
  await expect(page.getByRole("button", { name: "一键销卡", exact: true })).toHaveCount(0); await expect(page.getByTestId("card-closure-progress")).toHaveCount(0);
});

test("bulk close on mobile never writes if local recovery storage is unavailable", async ({ page }) => {
  await setup(page); await page.setViewportSize({ width: 390, height: 844 });
  let writes = 0;
  await page.route("**/api/cards/closure-batches", r => { writes++; return r.fulfill({ status: 202, json: { code: 0, data: batch() } }); });
  await page.addInitScript(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) { if (key.startsWith("card-closure:")) throw new Error("Storage denied"); return set.call(this, key, value); };
  });
  await page.goto("/cards/owned"); await page.getByRole("button", { name: "一键销卡", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "/tmp/avan-card-tools-mobile.png", fullPage: true, animations: "disabled" });
  await confirm(page); await expect(page.getByRole("alert")).toContainText("提交结果尚未确认"); expect(writes).toBe(0);
});
test("bulk close prevents duplicate clicks and does not resubmit on status read failure", async ({ page }) => {
  await setup(page); let writes = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/cards/closure-batches", async r => { writes++; await gate; await r.fulfill({ status: 202, json: { code: 0, data: batch() } }); });
  await page.route(/\/api\/cards\/closure-batches\/[^/?]+(?:\?.*)?$/, r => r.fulfill({ status: 503, json: { error: "Unavailable" } }));
  await page.goto("/cards/owned"); await page.getByRole("button", { name: "一键销卡", exact: true }).click();
  await page.getByRole("checkbox", { name: "我确认销掉当前账户的全部可销卡片" }).check();
  const submit = page.getByRole("button", { name: "确认全部销卡", exact: true });
  await submit.dispatchEvent("click");
  await page.getByRole("dialog").getByRole("button").last().dispatchEvent("click");
  await expect.poll(() => writes).toBe(1); release();
  await expect(page.getByTestId("card-closure-progress").getByRole("alert")).toContainText("暂时无法读取");
  await expect(page.getByRole("button", { name: "一键销卡", exact: true })).toBeDisabled(); expect(writes).toBe(1);
});
test("owned card search stays usable after the first request fails", async ({ page }) => {
  await setup(page);
  await page.route(/\/api\/cards(?:\?.*)?$/, r => r.fulfill({ status: 503, json: { error: "Unavailable" } }));
  await page.goto("/cards/owned");
  await expect(page.getByRole("alert")).toContainText("卡片查询失败", { timeout: 15_000 });
  await expect(page.getByRole("textbox", { name: "搜索卡片" })).toBeVisible();
});
