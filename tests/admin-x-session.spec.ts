import { test, expect, type Page } from "@playwright/test";

const cookie = "auth_token=x-session-secret; ct0=x-session-csrf";
const status = { configured: true, updatedAt: "2026-09-30T01:00:00Z", autoRefresh: false };

async function openSettings(page: Page) {
  await page.addInitScript(() => localStorage.setItem("session", JSON.stringify({ token: "", email: "admin@example.test" })));
  await page.route("**/api/**", route => route.fulfill({ json: { code: 0, data: [] } }));
  await page.route("**/api/dashboard", route => route.fulfill({ json: { email: "admin@example.test", role: "admin", walletBalance: "0", cardBalance: "0", cardCount: 0 } }));
  await page.route("**/api/admin/x-direct/settings", route => route.fulfill({ json: { code: 0, data: { plans: [], currency: "USD" } } }));
  await page.route("**/api/admin/x-direct/orders?*", route => route.fulfill({ json: { code: 0, data: { list: [], total: 0, page: 1, pageSize: 20 } } }));
}

test("X direct admin checks a draft and clears its secret after saving", async ({ page }) => {
  await openSettings(page);
  const actions: string[] = [];
  await page.route("**/api/admin/x-direct/session", route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { code: 0, data: status } });
    const body = route.request().postDataJSON();
    expect(body.cookie).toBe(cookie);
    actions.push(body.action);
    return route.fulfill({ json: { code: 0, data: { ...status, valid: true } } });
  });
  await page.goto("/admin?panel=xDirect");
  const panel = page.getByTestId("admin-x-direct-session");
  const draft = panel.getByRole("textbox", { name: "X 会话 Cookie", exact: true });
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
  expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toContain("x-session-secret");
  await page.reload();
  await expect(draft).toHaveValue("");
});

test("X direct admin hides upstream secret errors on authentication and save failures", async ({ page }) => {
  await openSettings(page);
  let responseStatus = 403;
  await page.route("**/api/admin/x-direct/session", route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { code: 0, data: status } });
    return route.fulfill({ status: responseStatus, json: { error: `upstream echoed ${cookie}` } });
  });
  await page.goto("/admin?panel=xDirect");
  const panel = page.getByTestId("admin-x-direct-session");
  await panel.getByRole("textbox", { name: "X 会话 Cookie", exact: true }).fill(cookie);
  await panel.getByRole("button", { name: "检查会话", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("管理员");
  await expect(panel.getByRole("alert")).not.toContainText("x-session-secret");
  responseStatus = 500;
  await panel.getByRole("button", { name: "保存会话", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("保存失败");
  await expect(panel.getByRole("alert")).not.toContainText("x-session-secret");
  await expect(panel.getByRole("status")).toHaveCount(0);
  expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toContain("x-session-secret");
});

test("X direct admin distinguishes expired checks from successful validation", async ({ page }) => {
  await openSettings(page);
  await page.route("**/api/admin/x-direct/session", route => route.fulfill({ json: { code: 0, data: { ...status, ...(route.request().method() === "POST" ? { valid: false } : {}) } } }));
  await page.goto("/admin?panel=xDirect");
  const panel = page.getByTestId("admin-x-direct-session");
  await panel.getByRole("textbox", { name: "X 会话 Cookie", exact: true }).fill(cookie);
  await panel.getByRole("button", { name: "检查会话", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("重新登录 X");
  await expect(panel.getByRole("status")).toHaveCount(0);
});

test("X direct admin safely retries a failed status load", async ({ page }) => {
  await openSettings(page);
  let fail = true;
  await page.route("**/api/admin/x-direct/session", route => fail
    ? route.fulfill({ status: 403, json: { error: `private ${cookie}` } })
    : route.fulfill({ json: { code: 0, data: { ...status, configured: false, updatedAt: null } } }));
  await page.goto("/admin?panel=xDirect");
  const panel = page.getByTestId("admin-x-direct-session");
  await expect(panel.getByRole("alert")).toContainText("会话状态加载失败", { timeout: 15000 });
  await expect(panel.getByRole("alert")).not.toContainText("x-session-secret");
  await expect(panel.getByRole("textbox", { name: "X 会话 Cookie", exact: true })).toBeDisabled();
  fail = false;
  await panel.getByRole("button", { name: "重试", exact: true }).click();
  await expect(panel.getByRole("textbox", { name: "X 会话 Cookie", exact: true })).toBeEnabled();
  await expect(panel).toContainText("未配置");
});

test("X direct admin session recent authentication preserves only the return path", async ({ page }) => {
  await openSettings(page);
  await page.route("**/api/admin/x-direct/session", route => route.request().method() === "GET"
    ? route.fulfill({ json: { code: 0, data: status } })
    : route.fulfill({ status: 403, json: { error: `private ${cookie}`, errorCode: "RECENT_AUTH_REQUIRED" } }));
  await page.goto("/admin?panel=xDirect");
  const panel = page.getByTestId("admin-x-direct-session");
  await panel.getByRole("textbox", { name: "X 会话 Cookie", exact: true }).fill(cookie);
  await panel.getByRole("button", { name: "保存会话", exact: true }).click();
  await expect(panel.getByRole("alert")).not.toContainText("x-session-secret");
  await panel.getByRole("button", { name: "重新认证", exact: true }).click();
  await expect(page).toHaveURL(/\/login/);
  expect(await page.evaluate(() => sessionStorage.getItem("recentAuthReturnPath"))).toBe("/admin?panel=xDirect");
  expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toContain("x-session-secret");
});
