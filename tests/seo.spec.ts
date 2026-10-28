import { expect, test } from "@playwright/test";

test("CDK redeem page explains how to use search metadata in Chinese and English", async ({ page }) => {
  await page.goto("/cdk/redeem?campaign=ignored");

  await expect(page).toHaveTitle("兑换 GPT 直充 CDK | Avanfinity");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "index, follow, max-image-preview:large");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `${new URL(page.url()).origin}/cdk/redeem`);
  await expect(page.locator('link[rel="alternate"][hreflang="zh-CN"]')).toHaveAttribute("href", `${new URL(page.url()).origin}/cdk/redeem`);
  await expect(page.locator('link[rel="alternate"][hreflang="en"]')).toHaveAttribute("href", `${new URL(page.url()).origin}/cdk/redeem?lang=en`);
  await expect(page.locator('link[rel="alternate"][hreflang="x-default"]')).toHaveAttribute("href", `${new URL(page.url()).origin}/cdk/redeem`);
  await expect(page.locator('meta[property="og:locale:alternate"]')).toHaveAttribute("content", "en_US");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");

  await page.getByRole("button", { name: "English" }).click();
  await expect(page).toHaveURL(/\/cdk\/redeem\?campaign=ignored&lang=en$/);
  await expect(page).toHaveTitle("Redeem a GPT Direct CDK | Avanfinity");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `${new URL(page.url()).origin}/cdk/redeem?lang=en`);
  await expect(page.locator('meta[property="og:locale:alternate"]')).toHaveAttribute("content", "zh_CN");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

test("CDK redeem page explains how to use a direct English SEO URL in a new session", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("language", "zh"));
  await page.goto("/cdk/redeem?lang=en");

  await expect(page).toHaveTitle("Redeem a GPT Direct CDK | Avanfinity");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `${new URL(page.url()).origin}/cdk/redeem?lang=en`);
  await expect(page.locator('link[rel="alternate"][hreflang="zh-CN"]')).toHaveAttribute("href", `${new URL(page.url()).origin}/cdk/redeem`);
});

test("CDK redeem page explains how to use private route noindex metadata", async ({ page }) => {
  await page.goto("/login?lang=en");

  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow, noarchive");
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
  await expect(page.locator('link[rel="alternate"]')).toHaveCount(0);
  await expect(page.locator("#avanfinity-structured-data")).toHaveCount(0);
});
