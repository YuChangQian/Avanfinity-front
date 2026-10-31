import { test, expect } from "@playwright/test";
import { useStylePreviewApi } from "./ui-preview-api";

test.beforeEach(async ({ page }) => useStylePreviewApi(page));

for (const width of [1440, 390]) {
  test(`unified UI pages remain usable at ${width}px`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    for (const route of ["dashboard", "cards", "cards/owned", "cards/81", "cards/open/EXPLICIT_BIN", "card-transactions", "finance", "deposit", "sms", "tg-direct", "gpt-direct", "cdk-v2", "redeem", "cdk/redeem", "tg-cdk/redeem", "rewards", "referral", "membership", "support", "announcements", "developer", "openai-prices", "settings", "admin"]) {
      await page.goto(`/${route}`);
      await expect(page.getByRole("heading", { level: 1 }).first(), route).toBeVisible();
      await expect(page.getByText("Something went wrong!", { exact: true })).toHaveCount(0);
      await expect(page.locator("main [aria-busy=\"true\"]"), route).toHaveCount(0);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), { message: `${route}: horizontal overflow` }).toBe(true);
      if (["finance", "deposit", "sms", "developer", "admin"].includes(route)) {
        await page.screenshot({ path: test.info().outputPath(`${route}-${width}.png`), fullPage: true });
      }
    }
    expect(errors).toEqual([]);
  });
}

test("unified UI native and Radix selectors share a skin and retain selection", async ({ page }) => {
  await page.goto("/finance");
  const native = page.getByRole("combobox", { name: "类型", exact: true });
  await native.selectOption({ label: "开卡" });
  await expect(native).toHaveValue("card_open");
  const skin = await native.evaluate(element => {
    const css = getComputedStyle(element);
    return { border: css.borderColor, radius: css.borderRadius, background: css.backgroundColor };
  });
  await page.goto("/deposit");
  const select = page.getByTestId("deposit-network-select");
  await expect(select).toHaveCSS("border-color", skin.border);
  await expect(select).toHaveCSS("border-radius", skin.radius);
  await expect(select).toHaveCSS("background-color", skin.background);
  await select.click();
  await page.getByRole("option", { name: /BNB Smart Chain/ }).click();
  await expect(select).toContainText("BNB Smart Chain");
  await expect(select).toBeFocused();
  await select.press("Space");
  await page.keyboard.press("Escape");
  await expect(select).toBeFocused();
});

test("unified UI confirmation keeps keyboard focus and cancellation never mutates", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", request => { if (request.method() !== "GET") requests.push(request.url()); });
  await page.goto("/developer");
  const rotate = page.getByRole("button", { name: "轮换 Webhook Secret", exact: true });
  await rotate.click();
  const dialog = page.getByRole("alertdialog");
  const cancel = dialog.getByRole("button", { name: "取消", exact: true });
  await expect(cancel).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(rotate).toBeFocused();
  await rotate.click();
  await cancel.click();
  expect(requests).toEqual([]);
});
