import { test, expect } from "@playwright/test";

for (const channel of ["x", "tg"]) {
  test(`${channel === "x" ? "X" : "TG"} direct filters history on the server and resets pagination`, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("session", JSON.stringify({ token: "", userId: 1, email: "test@example.test" })));
    await page.route("**/api/**", route => route.fulfill({ json: { code: 200, data: [] } }));
    await page.route("**/api/dashboard", route => route.fulfill({ json: { userId: 1, role: "customer", walletBalance: "100", cardBalance: "100", cardCount: 1 } }));
    await page.route(`**/api/${channel}-direct/orders**`, route => {
      const query = new URL(route.request().url()).searchParams;
      const filtered = query.get("recipient") === "alice" && query.get("status") === "completed";
      return route.fulfill({ json: { code: 200, data: [{ id: "11111111-1111-4111-8111-111111111111", recipient: filtered ? "alice" : "other", plan: "premium_3m", status: "completed", paymentAttempted: true, serviceFee: "0.00" }], meta: { total: filtered ? 1 : 51, page: Number(query.get("page") ?? 1), pageSize: 50 } } });
    });
    await page.goto(`/${channel}-direct`);
    const history = page.getByRole("region", { name: `${channel.toUpperCase()} 直充订单` });
    await history.getByRole("button", { name: "下一页", exact: true }).click();
    await expect(history.getByText("第 2 页", { exact: true })).toBeVisible();
    await history.getByRole("textbox", { name: "订单用户名", exact: true }).fill("@alice");
    await history.getByRole("combobox", { name: "订单状态", exact: true }).click();
    await page.getByRole("option", { name: "充值完成", exact: true }).click();
    const request = page.waitForRequest(r => {
      const url = new URL(r.url());
      return url.pathname.endsWith(`/${channel}-direct/orders`) && url.searchParams.get("recipient") === "alice" && url.searchParams.get("status") === "completed" && url.searchParams.get("page") === "1";
    });
    await history.getByRole("button", { name: "筛选", exact: true }).click();
    await request;
    await expect(history.getByText("@alice", { exact: true })).toBeVisible();
    await expect(history.getByText("第 1 页", { exact: true })).toBeVisible();
    await expect(history.getByRole("button", { name: "下一页", exact: true })).toBeDisabled();
    await history.getByRole("button", { name: "重置", exact: true }).click();
    await expect(history.getByText("@other", { exact: true })).toBeVisible();
    await expect(history.getByRole("textbox", { name: "订单用户名", exact: true })).toHaveValue("");
  });
}
