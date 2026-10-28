import { test, expect, type Page } from "@playwright/test";

const cookie = JSON.stringify({ userId: 123, dcId: 2, authKey: "a".repeat(512) });
const status = { configured: true, updatedAt: "2026-09-30T01:00:00Z", autoRefresh: false };

async function openSettings(page: Page) {
  await page.addInitScript(() => localStorage.setItem("session", JSON.stringify({ token: "", email: "admin@example.test" })));
  await page.route("**/api/**", route => route.fulfill({ json: { code: 0, data: [] } }));
  await page.route("**/api/dashboard", route => route.fulfill({ json: { email: "admin@example.test", role: "admin", walletBalance: "0", cardBalance: "0", cardCount: 0 } }));
  await page.route("**/api/admin/tg-direct/settings", route => route.fulfill({ json: { code: 0, data: { plans: [], currency: "USD" } } }));
  await page.route("**/api/admin/tg-direct/orders?*", route => route.fulfill({ json: { code: 0, data: { list: [], total: 0, page: 1, pageSize: 20 } } }));
}

test("TG direct admin checks a draft and clears its secret after saving", async ({ page }) => {
  await openSettings(page);
  const actions: string[] = [];
  await page.route("**/api/admin/tg-direct/session", route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { code: 0, data: status } });
    const body = route.request().postDataJSON();
    expect(body.session).toEqual(JSON.parse(cookie));
    actions.push(body.action);
    return route.fulfill({ json: { code: 0, data: { ...status, valid: true } } });
  });
  await page.goto("/admin?panel=tgDirect");
  const panel = page.getByTestId("admin-tg-direct-session");
  const draft = panel.getByRole("textbox", { name: "TG 会话 JSON", exact: true });
  await expect(draft).toHaveValue("", { timeout: 15000 });
  await expect(panel.getByRole("button", { name: "保存会话", exact: true })).toBeDisabled();
  await draft.fill(cookie);
  await panel.getByRole("button", { name: "检查会话", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("检查通过");
  await expect(draft).toHaveValue(cookie);
  await panel.getByRole("button", { name: "保存会话", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("已保存");
  await expect(draft).toHaveValue("");
  expect(actions).toEqual(["check", "save"]);
  expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toContain("a".repeat(512));
  await page.reload();
  await expect(draft).toHaveValue("");
});

test("TG direct admin hides upstream secret errors on authentication and save failures", async ({ page }) => {
  await openSettings(page);
  let responseStatus = 403;
  await page.route("**/api/admin/tg-direct/session", route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { code: 0, data: status } });
    return route.fulfill({ status: responseStatus, json: { error: `upstream echoed ${cookie}` } });
  });
  await page.goto("/admin?panel=tgDirect");
  const panel = page.getByTestId("admin-tg-direct-session");
  await panel.getByRole("textbox", { name: "TG 会话 JSON", exact: true }).fill(cookie);
  await panel.getByRole("button", { name: "检查会话", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("管理员");
  await expect(panel.getByRole("alert")).not.toContainText("tg-session-secret");
  responseStatus = 500;
  await panel.getByRole("button", { name: "保存会话", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("保存失败");
  await expect(panel.getByRole("alert")).not.toContainText("tg-session-secret");
  await expect(panel.getByRole("status")).toHaveCount(0);
  expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toContain("a".repeat(512));
});

test("TG direct admin distinguishes expired checks from successful validation", async ({ page }) => {
  await openSettings(page);
  await page.route("**/api/admin/tg-direct/session", route => route.fulfill({ json: { code: 0, data: { ...status, ...(route.request().method() === "POST" ? { valid: false } : {}) } } }));
  await page.goto("/admin?panel=tgDirect");
  const panel = page.getByTestId("admin-tg-direct-session");
  await panel.getByRole("textbox", { name: "TG 会话 JSON", exact: true }).fill(cookie);
  await panel.getByRole("button", { name: "检查会话", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("重新登录 Telegram");
  await expect(panel.getByRole("status")).toHaveCount(0);
});

test("TG direct admin safely retries a failed status load", async ({ page }) => {
  await openSettings(page);
  let fail = true;
  await page.route("**/api/admin/tg-direct/session", route => fail
    ? route.fulfill({ status: 403, json: { error: `private ${cookie}` } })
    : route.fulfill({ json: { code: 0, data: { ...status, configured: false, updatedAt: null } } }));
  await page.goto("/admin?panel=tgDirect");
  const panel = page.getByTestId("admin-tg-direct-session");
  await expect(panel.getByRole("alert")).toContainText("会话状态加载失败", { timeout: 15000 });
  await expect(panel.getByRole("alert")).not.toContainText("tg-session-secret");
  await expect(panel.getByRole("textbox", { name: "TG 会话 JSON", exact: true })).toBeDisabled();
  fail = false;
  await panel.getByRole("button", { name: "重试", exact: true }).click();
  await expect(panel.getByRole("textbox", { name: "TG 会话 JSON", exact: true })).toBeEnabled();
  await expect(panel).toContainText("未配置");
});

test("TG direct admin session recent authentication preserves only the return path", async ({ page }) => {
  await openSettings(page);
  await page.route("**/api/admin/tg-direct/session", route => route.request().method() === "GET"
    ? route.fulfill({ json: { code: 0, data: status } })
    : route.fulfill({ status: 403, json: { error: `private ${cookie}`, errorCode: "RECENT_AUTH_REQUIRED" } }));
  await page.goto("/admin?panel=tgDirect");
  const panel = page.getByTestId("admin-tg-direct-session");
  await panel.getByRole("textbox", { name: "TG 会话 JSON", exact: true }).fill(cookie);
  await panel.getByRole("button", { name: "保存会话", exact: true }).click();
  await expect(panel.getByRole("alert")).not.toContainText("tg-session-secret");
  await panel.getByRole("button", { name: "重新认证", exact: true }).click();
  await expect(page).toHaveURL(/\/login/);
  expect(await page.evaluate(() => sessionStorage.getItem("recentAuthReturnPath"))).toBe("/admin?panel=tgDirect");
  expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toContain("a".repeat(512));
});

test("TG direct admin imports a web account export without sending extra secrets", async ({ page }) => {
  await openSettings(page);
  const exported = `account1\t${JSON.stringify({ userId: 123, dcId: 2, dc1_auth_key: "b".repeat(512), dc2_auth_key: "a".repeat(512), dc2_server_salt: "12", push_key: "unused-secret" })}\nuser_auth\t{"id":123,"dcID":2}`;
  let saves = 0;
  await page.route("**/api/admin/tg-direct/session", route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { code: 200, data: status } });
    expect(route.request().postDataJSON().session).toEqual({ userId: 123, dcId: 2, authKey: "a".repeat(512) });
    saves++;
    return route.fulfill({ json: { code: 200, data: { ...status, valid: true } } });
  });
  await page.goto("/admin?panel=tgDirect");
  const panel = page.getByTestId("admin-tg-direct-session");
  await panel.getByRole("textbox", { name: "TG 会话 JSON", exact: true }).fill(exported);
  await panel.getByRole("button", { name: "保存会话", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("已保存");
  expect(saves).toBe(1);
  await expect(panel.getByRole("textbox", { name: "TG 会话 JSON", exact: true })).toHaveValue("");
  expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toContain("unused-secret");
});

test("TG direct session parser rejects ambiguous accounts and missing active DC keys", async () => {
  const { parseTgSession } = await import("../src/tgSession");
  const normalized = { userId: 123, dcId: 2, authKey: "A".repeat(512) };
  expect(parseTgSession(JSON.stringify(normalized))).toEqual({ ...normalized, authKey: "a".repeat(512) });
  for (const value of [
    "account1\t" + JSON.stringify(normalized) + "\naccount2\t" + JSON.stringify(normalized),
    JSON.stringify({ userId: 123, dcId: 2, dc1_auth_key: "a".repeat(512) }),
    JSON.stringify({ ...normalized, authKey: "a".repeat(511) }),
    JSON.stringify({ ...normalized, userId: -1 }),
    JSON.stringify({ ...normalized, dcId: 6 }),
    "[]", "null", "invalid",
  ]) expect(() => parseTgSession(value)).toThrow(SyntaxError);
});
