import { test, expect } from '@playwright/test';
import fs from 'node:fs';
const spec = JSON.parse(fs.readFileSync(new URL('../public/docs/downstream-v1.json', import.meta.url), 'utf8'));

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('session', JSON.stringify({ token: '', userId: 1, email: 'docs@example.test' }));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text: string) => { (window as unknown as { copiedCode: string }).copiedCode = text; } } });
  });
  await page.route('**/api/**', r => r.fulfill({ json: { code: 200, data: [] } }));
  await page.route('**/api/dashboard', r => r.fulfill({ json: { email: 'docs@example.test', role: 'customer', walletBalance: '0', cardCount: 0 } }));
  await page.route('**/api/v1/openapi.json', r => r.fulfill({ json: spec }));
});

test('unified CDK docs styled guide has readable steps and exact copyable folded code', async ({ page }) => {
  await page.goto('/developer');
  const guide = page.getByTestId('cdk-region-guide');
  await expect(page.locator('.developer-quickstart').getByTestId('cdk-region-guide')).toHaveCount(0);
  await expect(guide.locator('ol li')).toHaveCount(3);
  await expect(guide.locator('pre')).not.toBeVisible();
  await guide.getByRole('button', { name: '查看 TypeScript 完整示例' }).click();
  const block = guide.locator('.api-code-block');
  await expect(block.locator('.api-token-keyword').first()).toBeVisible();
  await block.getByRole('button', { name: '复制 TypeScript 代码' }).click();
  await expect(block.getByRole('button', { name: '已复制' })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { copiedCode: string }).copiedCode)).toBe(await block.locator('code').textContent());
  await guide.screenshot({ path: '/tmp/developer-guide-desktop.png' });
  const all = page.locator('.developer-guide');
  await expect(all).toContainText('X-App-Id');
  await expect(all).toContainText('GET /operations/{id}');
  await expect(all).toContainText('HMAC-SHA256');
  await all.getByText('curl', { exact: true }).click();
  await expect(all.locator('.api-code-block[data-language="curl"] code')).toContainText('Idempotency-Key: $OPEN_IDEMPOTENCY_KEY');

});

test('unified CDK docs styled guide and JSON examples fit mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/developer');
  const guide = page.getByTestId('cdk-region-guide');
  await expect(guide.locator('ol li')).toHaveCount(3);
  await guide.screenshot({ path: '/tmp/developer-guide-mobile.png' });
  const quote = page.locator('[data-operation-id="smsQuote"]');
  await quote.locator(':scope > summary').click();
  await expect(quote.locator('.api-code-block[data-language="JSON"]').first()).toBeVisible();
  await expect(quote.locator('.api-token-property').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
