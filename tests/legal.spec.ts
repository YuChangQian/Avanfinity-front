import { expect, test } from "@playwright/test";

const documents = {
  code: 0,
  data: {
    terms: "最后更新：2026年9月1日\n\n重要提示\n\n禁止中华人民共和国大陆地区用户注册或使用本服务。\n\n一、充值规则\n\n仅支持 USDT。",
    userAgreement: "最后更新：2026年9月1日\n\n一、用户承诺\n\n用户确认年满 18 周岁，并同意遵守平台规则。",
    version: 1,
    updatedAt: "2026-09-01T00:00:00.000Z",
  },
};

test("legal pages render public content and registration requires consent", async ({ page }) => {
  await page.route("**/api/legal-documents", (route) => route.fulfill({ json: documents }));
  await page.route("**/api/features", (route) => route.fulfill({ json: { code: 0, data: {
    version: 1, registration: true, walletTransfer: true, cardOpening: true, cardRecharge: true,
    cardManagement: true, cardDelete: true, gptDirect: true, gptCdk: true, deposits: true,
    rewards: true, agent: true, market: true, developerApi: true, telegram: true,
  } } }));

  await page.goto("/terms");
  await expect(page.getByRole("heading", { name: "服务条款", level: 1 })).toBeVisible();
  await expect(page.getByText("禁止中华人民共和国大陆地区用户注册或使用本服务。")).toBeVisible();
  await page.getByRole("link", { name: "用户协议" }).click();
  await expect(page.getByRole("heading", { name: "用户协议", level: 1 })).toBeVisible();

  await page.goto("/register");
  const consent = page.getByRole("checkbox", { name: /我已年满 18 周岁/ });
  await expect(consent).toHaveAttribute("required", "");
  await expect(page.getByRole("link", { name: "服务条款" })).toHaveAttribute("target", "_blank");
  await expect(page.getByRole("link", { name: "用户协议" })).toHaveAttribute("target", "_blank");

  await page.goto("/login");
  await expect(page.getByRole("link", { name: "返回首页" })).toHaveAttribute("href", "/");
  await expect(page.getByRole("link", { name: "用户协议" })).toHaveAttribute("href", "/user-agreement");
  await expect(page.getByRole("link", { name: "服务条款（含隐私说明）" })).toHaveAttribute("href", "/terms");
});
