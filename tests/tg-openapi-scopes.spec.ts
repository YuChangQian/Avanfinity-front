import { test, expect } from "@playwright/test";

test("TG direct OpenAPI read scope saves without IP and write scope requires an allowlist", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("session", JSON.stringify({ token: "", email: "developer@example.test" })));
  const key = { id: 71, appId: "app_x_test", appSecretMasked: "sk_****ABCD", name: "X API", status: "active", ipWhitelist: "", webhookUrl: "", webhookSecretReady: true, scopes: ["products:read"], minuteLimit: 120, dailyLimit: 10000, createdAt: "2026-09-30T01:00:00Z" };
  const saves: Record<string, unknown>[] = [];
  await page.route("**/api/**", route => route.fulfill({ json: { code: 0, data: [] } }));
  await page.route("**/api/dashboard", route => route.fulfill({ json: { email: "developer@example.test", role: "customer", walletBalance: "0", cardBalance: "0", cardCount: 0 } }));
  await page.route("**/api/v1/openapi.json", route => route.fulfill({ json: { openapi: "3.1.0", info: { title: "Test API", version: "1.0" }, paths: {} } }));
  await page.route("**/api/developer/webhooks/deliveries?*", route => route.fulfill({ json: { code: 0, data: { total: 0, page: 1, pageSize: 20, list: [] } } }));
  await page.route("**/api/developer/keys", route => {
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON();
      saves.push(body);
      Object.assign(key, body);
      return route.fulfill({ json: { code: 0, msg: "ok" } });
    }
    return route.fulfill({ json: { code: 0, data: [key] } });
  });
  await page.goto("/developer");
  const form = page.locator(".developer-key-form");
  const read = form.getByRole("checkbox", { name: "读取 TG 套餐与订单", exact: true });
  const write = form.getByRole("checkbox", { name: "提交 TG 直充", exact: true });
  await expect(read).toBeVisible({ timeout: 15000 });
  await expect(write).toBeVisible();
  await read.check();
  await form.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => saves.length).toBe(1);
  expect(saves[0].scopes).toEqual(["products:read", "tg-direct:read"]);
  expect(saves[0].ipWhitelist).toBe("");
  await write.check();
  await form.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("必须配置 IP 或 CIDR 白名单");
  expect(saves).toHaveLength(1);
  await form.getByRole("textbox", { name: "IP 白名单", exact: true }).fill("203.0.113.10/32");
  await form.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => saves.length).toBe(2);
  expect(saves[1].scopes).toEqual(["products:read", "tg-direct:read", "tg-direct:write"]);
  expect(saves[1].ipWhitelist).toBe("203.0.113.10/32");
  await page.reload();
  await expect(read).toBeChecked();
  await expect(write).toBeChecked();
});

test("TG direct public CDK documentation uses the anonymous server without app secrets", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("session", JSON.stringify({ token: "", email: "developer@example.test" })));
  await page.route("**/api/**", route => route.fulfill({ json: { code: 0, data: [] } }));
  await page.route("**/api/dashboard", route => route.fulfill({ json: { email: "developer@example.test", role: "customer", walletBalance: "0", cardBalance: "0", cardCount: 0 } }));
  await page.route("**/api/developer/webhooks/deliveries?*", route => route.fulfill({ json: { code: 0, data: { total: 0, page: 1, pageSize: 20, list: [] } } }));
  await page.route("**/api/v1/openapi.json", route => route.fulfill({ json: {
    openapi: "3.1.0", info: { title: "X API" }, tags: [{ name: "TG CDK" }], paths: {
      "/public/tg-cdk/preview": { post: { operationId: "xPublicPreview", tags: ["TG CDK"], servers: [{ url: "/api" }], security: [], responses: { "200": { description: "OK" } } } },
      "/tg-direct/cdks": { get: { operationId: "xIssuerList", tags: ["TG CDK"], responses: { "200": { description: "OK" } } } },
    },
  } }));
  await page.goto("/developer");
  const preview = page.locator('[data-operation-id="xPublicPreview"]');
  await preview.locator(":scope > summary").click();
  const publicExample = preview.locator('[data-operation-example="xPublicPreview"]');
  await expect(publicExample).toContainText(`${new URL(page.url()).origin}/api/public/tg-cdk/preview`);
  await expect(publicExample).not.toContainText("X-App-Secret");
  await expect(publicExample).not.toContainText("X-App-Id");
  const issuer = page.locator('[data-operation-id="xIssuerList"]');
  await issuer.locator(":scope > summary").click();
  await expect(issuer.locator('[data-operation-example="xIssuerList"]')).toContainText("/api/v1/tg-direct/cdks");
  await expect(issuer.locator('[data-operation-example="xIssuerList"]')).toContainText("X-App-Secret");
});
