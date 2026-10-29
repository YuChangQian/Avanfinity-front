import { test, expect, type Page } from '@playwright/test';

async function setup(page: Page, unavailable = false) {
  const writes: string[] = [];
  await page.addInitScript(() => localStorage.setItem('session', JSON.stringify({ token: '', userId: 101, email: 'owner@example.test' })));
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === 'POST' && /preflight|orders/.test(path)) writes.push(path);
    let data: unknown = { total: 0, list: [] };
    if (path === '/api/features') data = { version: 1, gptDirect: true, cardOpening: true };
    else if (path === '/api/dashboard') return route.fulfill({ json: { email: 'owner@example.test', role: 'customer', walletBalance: '100', cardBalance: '100', cardCount: 0, inviteCode: 'TEST' } });
    else if (['/api/support/tickets', '/api/announcements/unread', '/api/products'].includes(path)) data = [];
    else if (path.endsWith('/plans')) data = { version: 2, checkoutCountries: [{ country: 'PH', currency: 'PHP' }, { country: 'US', currency: 'USD' }], plans: ['plus', 'pro_5x'].map(key => ({ key, label: key, enabled: true, serviceFeeUsdMinor: 100, customerServiceFee: '1' })) };
    else if (path.endsWith('/price-catalog')) {
      if (unavailable) return route.fulfill({ status: 503, json: { error: 'Unavailable' } });
      const row = (country: string, currency: string, plan: string, amountMajor: string, amountUsd: string | null) => ({ country, currency, plan, amountMajor, amountUsd, tax: 'inclusive', pspAmountMajor: '900', pspTax: 'exclusive', fetchedAt: Date.now(), pricingScope: 'regional', minorUnitExponent: 2, fxDate: '2026-10-30' });
      data = { countries: [
        { country: 'US', stale: false, lastError: null, rows: [row('US', 'USD', 'plus', '20', '20'), row('US', 'USD', 'pro_5x', '100', '100')] },
        { country: 'PH', stale: false, lastError: null, rows: [row('PH', 'PHP', 'plus', '1100', '18.8')] },
        { country: 'JP', stale: false, lastError: null, rows: [row('JP', 'JPY', 'plus', '3000', '19')] },
        { country: 'EG', stale: true, lastError: 'pricing_unavailable', rows: [row('EG', 'EGP', 'plus', '1000', null)] },
        { country: 'TR', stale: true, lastError: 'pricing_unavailable', rows: [] },
      ] };
    }
    await route.fulfill({ json: { code: 0, data } });
  });
  return writes;
}

test('GPT regional catalog sorts converted prices, filters type, and selects only available regions', async ({ page }) => {
  const writes = await setup(page);
  await page.goto('/gpt-direct');
  const catalog = page.getByRole('region', { name: '各国家地区价格' });
  await expect(catalog).toBeVisible();
  const rows = catalog.locator('tbody tr');
  await expect(rows).toHaveCount(5);
  await expect(rows.nth(0)).toContainText('菲律宾');
  await expect(rows.nth(1)).toContainText('日本');
  await expect(rows.nth(3)).toContainText('埃及');
  await expect(rows.nth(4)).toContainText('土耳其');
  await expect(catalog.getByRole('button', { name: '选择 日本 Plus' })).toBeDisabled();
  await expect(catalog.getByText('参考价已过期', { exact: true })).toHaveCount(1);
  await expect(catalog.getByText('暂不可用', { exact: true })).toHaveCount(1);
  await catalog.screenshot({ path: `../artifacts/gpt-regional-catalog-${test.info().project.name}-overview.png` });
  await catalog.getByLabel('价格排序').selectOption('price_desc');
  await expect(rows.nth(0)).toContainText('美国');
  await catalog.getByLabel('套餐筛选').selectOption('all');
  await expect(rows).toHaveCount(6);
  await catalog.getByLabel('价格排序').selectOption('type');
  await expect(rows.nth(4)).toContainText('Pro 5x');
  await catalog.getByLabel('搜索国家或地区').fill('PH');
  await expect(rows).toHaveCount(1);
  await catalog.getByRole('button', { name: '选择 菲律宾 Plus' }).click();
  await expect(page.getByRole('combobox', { name: '付款地区', exact: true })).toContainText('菲律宾');
  expect(writes).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await catalog.screenshot({ path: `../artifacts/gpt-regional-catalog-${test.info().project.name}.png` });
});

test('GPT regional catalog shows a retryable fetch failure without starting preflight', async ({ page }) => {
  const writes = await setup(page, true);
  await page.goto('/gpt-direct');
  const catalog = page.getByRole('region', { name: '各国家地区价格' });
  await expect(catalog.getByRole('alert')).toContainText('价格暂时无法加载');
  await expect(catalog.getByRole('button', { name: '重试' })).toBeVisible();
  expect(writes).toEqual([]);
});
