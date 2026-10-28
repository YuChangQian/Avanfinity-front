import { test, expect } from "@playwright/test";

for (const limited of [false, true]) {
  test(`card detail refreshes local balance and activity on first view ${limited ? "with supplier cooldown" : "without polling the supplier"}`, async ({ page }) => {
    await page.clock.install();
    await page.addInitScript(() => localStorage.setItem("session", JSON.stringify({ token: "", userId: 1, email: "view@example.test" })));
    await page.route("**/api/**", route => route.fulfill({ json: { code: 0, data: [] } }));
    await page.route("**/api/dashboard", route => route.fulfill({ json: { userId: 1, role: "user", walletBalance: "100", cardBalance: "42", cardCount: 2 } }));
    await page.route("**/api/features", route => route.fulfill({ json: { code: 0, data: { version: 1, cardManagement: true, cardRecharge: true, cardDelete: true } } }));
    let reads = 0;
    let cardStatus = "ACTIVE";
    const synced: number[] = [];
    await page.route(/\/api\/cards\/(91|92)$/, route => {
      reads++;
      const id = Number(new URL(route.request().url()).pathname.split("/").pop());
      return route.fulfill({ json: { code: 0, data: { id, cardNumberMasked: `•••• ${id}01`, status: id === 91 ? cardStatus : "ACTIVE", accountingStatus: id === 91 ? cardStatus : "ACTIVE", network: "VISA", issuingArea: "US", issuer: "Test", productCode: "TEST", availableAmount: "21.0000", firstName: "View", lastName: "Test", minAmount: "10", maxAmount: "100", rechargeRate: "0.01", refundRate: "0", createdAt: "2026-10-09T08:00:00Z" } } });
    });
    await page.route(/\/api\/cards\/(91|92)\/ledger$/, route => route.fulfill({ json: { code: 0, data: { activities: [], transactions: [] } } }));
    await page.route(/\/api\/cards\/(91|92)\/sync$/, route => {
      synced.push(Number(new URL(route.request().url()).pathname.split("/")[3]));
      return limited
        ? route.fulfill({ status: 429, json: { error: "supplier-private-error" } })
        : route.fulfill({ json: { code: 0, data: { cardId: synced.at(-1), reusedSnapshot: false, balanceSnapshotApplied: true } } });
    });
    await page.goto("/cards/91");
    await expect.poll(() => synced).toEqual([91]);
    await expect(page.locator("body")).toContainText("•••• 9101");
    await page.clock.fastForward(40_000);
    await expect.poll(() => reads).toBeGreaterThanOrEqual(3);
    expect(synced).toEqual([91]);
    await expect(page.locator("body")).not.toContainText("supplier-private-error");
    if (!limited) {
      await page.route("**/api/cards/91/actions", route => {
        const action = route.request().postDataJSON().action;
        expect(["freeze", "unfreeze"]).toContain(action);
        cardStatus = action === "freeze" ? "FROZEN" : "ACTIVE";
        return route.fulfill({ json: { code: 0, data: { cardId: 91, status: cardStatus } } });
      });
      await page.getByRole("button", { name: "冻结", exact: true }).click();
      await expect.poll(() => synced).toEqual([91, 91]);
      await page.getByRole("button", { name: "解冻", exact: true }).click();
      await expect.poll(() => synced).toEqual([91, 91, 91]);
    }
    await page.goto("/cards/92");
    await expect.poll(() => synced).toEqual(limited ? [91, 92] : [91, 91, 91, 92]);
  });
}
