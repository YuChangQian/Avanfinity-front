import { test, expect } from "@playwright/test";
for (const source of ["direct", "cdk"]) for (const branch of ["cs_live", "oaics", null]) {
  test(`admin list and detail show observed branch ${source} ${branch}`, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("session", JSON.stringify({ token: "", email: "admin@example.test" })));
    await page.route("**/api/**", r => r.fulfill({ json: { code: 0, data: [] } }));
    await page.route("**/api/features", r => r.fulfill({ json: { code: 0, data: { version: 1, gptDirect: true } } }));
    await page.route("**/api/dashboard", r => r.fulfill({ json: { role: "admin", email: "admin@example.test", cardCount: 0, walletBalance: "0" } }));
    const order = { id: "12345678-1234-4234-8234-123456789012", userId: 1, customerEmail: "user@example.test", plan: "plus", status: "failed_precharge", operationStatus: "COMPENSATED", checkoutBranch: branch, createdAt: "2026-10-26T01:00:00Z" };
    const endpoint = source === "cdk" ? "/admin/gpt-cdk-orders" : "/admin/gpt-direct/orders";
    await page.route(`**/api${endpoint}?**`, r => r.fulfill({ json: { code: 0, data: { list: [order], total: 1 } } }));
    await page.route(`**/api${endpoint}/${order.id}`, r => r.fulfill({ json: { code: 0, data: { order, events: [], funding: [] } } }));
    await page.goto(`/admin?panel=gptOrders&source=${source}`);
    await expect(page.getByText(`结账分支: ${branch || "未记录 / 待核对"}`, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "详情", exact: true }).click();
    const field = page.getByRole("dialog").locator(".transaction-detail-grid > div").filter({ has: page.locator("dt", { hasText: "结账分支" }) });
    await expect(field.locator("dd")).toHaveText(branch || "未记录 / 待核对");
  });
}
