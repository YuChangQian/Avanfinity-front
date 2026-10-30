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
      const row = (country: string, currency: string, plan: string, amountMajor: string, amountUsd: string | null) => ({ country, currency, plan, amountMajor, amountUsd, tax: 'exclusive', pspAmountMajor: null, pspTax: 'unknown', fetchedAt: Date.now(), pricingScope: 'regional', minorUnitExponent: 2, fxDate: '2026-10-30' });
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

async function selectFilter(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

async function openCatalog(page: Page) {
  const catalog = page.getByRole('region', { name: '各国家地区价格' });
  await catalog.getByRole('button', { name: '展开各国家地区价格', exact: true }).click();
  return catalog;
}

test('GPT regional catalog starts collapsed while lowest prices stay open and both toggle independently', async ({ page }) => {
  const writes = await setup(page);
  await page.goto('/gpt-direct');
  const catalog = page.getByRole('region', { name: '各国家地区价格' });
  const picks = page.getByRole('region', { name: '各套餐低价地区' });
  await expect(picks.locator('.gpt-lowest-prices-grid')).toBeVisible();
  await expect(catalog.locator('.gpt-catalog-filters')).toBeHidden();
  await picks.getByRole('button', { name: '收起各套餐低价地区', exact: true }).click();
  await expect(picks.locator('.gpt-lowest-prices-grid')).toBeHidden();
  await openCatalog(page);
  await selectFilter(page, '套餐筛选', '全部套餐');
  await catalog.getByRole('button', { name: '收起各国家地区价格', exact: true }).click();
  await expect(catalog.locator('.gpt-catalog-filters')).toBeHidden();
  await openCatalog(page);
  await expect(catalog.getByRole('combobox', { name: '套餐筛选' })).toContainText('全部套餐');
  await expect(picks.locator('.gpt-lowest-prices-grid')).toBeHidden();
  await picks.getByRole('button', { name: '展开各套餐低价地区', exact: true }).click();
  await expect(picks.locator('.gpt-lowest-prices-grid')).toBeVisible();
  expect(writes).toEqual([]);
});

test('GPT regional catalog sorts converted prices, filters type, and selects only available regions', async ({ page }) => {
  const writes = await setup(page);
  await page.goto('/gpt-direct');
  const catalog = await openCatalog(page);
  await expect(catalog).toBeVisible();
  await expect(catalog.getByRole('combobox', { name: '套餐筛选' })).toHaveAttribute('data-slot', 'select-trigger');
  await expect(catalog.getByRole('combobox', { name: '价格排序' })).toHaveAttribute('data-slot', 'select-trigger');
  await catalog.getByRole('combobox', { name: '套餐筛选' }).click();
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.screenshot({ path: `../artifacts/gpt-catalog-select-${test.info().project.name}.png`, animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(catalog.getByRole('combobox', { name: '套餐筛选' })).toBeFocused();
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
  await selectFilter(page, '价格排序', '美元估算：从高到低');
  await expect(rows.nth(0)).toContainText('美国');
  await selectFilter(page, '套餐筛选', '全部套餐');
  await expect(rows).toHaveCount(6);
  await selectFilter(page, '价格排序', '套餐类型，再按价格');
  await expect(rows.nth(4)).toContainText('Pro 5x');
  await catalog.getByLabel('搜索国家或地区').fill('PH');
  await expect(rows).toHaveCount(1);
  await catalog.getByRole('button', { name: '选择 菲律宾 Plus' }).click();
  await expect(page.getByRole('combobox', { name: '付款地区', exact: true })).toContainText('菲律宾');
  expect(writes).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await catalog.screenshot({ path: `../artifacts/gpt-regional-catalog-${test.info().project.name}.png` });
});

test('GPT regional catalog uses untaxed primary prices and falls back to final prices for sorting', async ({ page }) => {
  const writes = await setup(page);
  await page.route('**/api/gpt-direct/price-catalog', route => route.fulfill({ json: { code: 0, data: { countries: [
    { country: 'MX', currency: 'MXN', gross: ['1700', '8500'], usd: ['90.8412', '454.206'], net: null, tax: 'exclusive', psp: ['1972', '9860'] },
    { country: 'EG', currency: 'EGP', gross: ['5400', '27000'], usd: ['96.309', '481.545'], net: ['4736.84', '23684.21'], tax: 'inclusive', psp: null },
    { country: 'PH', currency: 'PHP', gross: ['6490', '32490'], usd: ['101.57499', '508.50099'], net: ['5794.64', '29008.93'], tax: 'inclusive', psp: null },
    { country: 'JP', currency: 'JPY', gross: ['12000', '60000'], usd: ['80', '400'], net: null, tax: 'inclusive', psp: null },
  ].map(country => ({ country: country.country, stale: false, lastError: null, rows: ['pro_5x', 'pro_25x'].map((plan, i) => ({
    country: country.country, currency: country.currency, plan, amountMajor: country.gross[i], amountUsd: country.usd[i], tax: country.tax,
    pspAmountMajor: country.net?.[i] ?? country.psp?.[i] ?? null, pspTax: country.net ? 'exclusive' : country.psp ? 'inclusive' : 'unknown',
    fetchedAt: Date.now(), pricingScope: 'regional', minorUnitExponent: 2, fxDate: '2026-10-30',
  })) })) } } }));
  await page.goto('/gpt-direct');
  const catalog = await openCatalog(page);
  const rows = catalog.locator('tbody tr');
  for (const [plan, net, gross, usd] of [['pro_5x', '4,736.84', '5,400', '84.48'], ['pro_25x', '23,684.21', '27,000', '422.41']]) {
    await selectFilter(page, '套餐筛选', plan === 'pro_5x' ? 'Pro 5x' : 'Pro 25x');
    await selectFilter(page, '价格排序', '美元估算：从低到高');
    await expect(rows).toHaveCount(4);
    for (const [i, name] of ['日本', '埃及', '菲律宾', '墨西哥'].entries()) await expect(rows.nth(i)).toContainText(name);
    const egyptPrice = rows.nth(1).locator('td').nth(1);
    await expect(egyptPrice.locator('strong')).toContainText(net);
    await expect(egyptPrice.locator('small').filter({ hasText: '含税参考价' })).toContainText(gross);
    await expect(rows.nth(1).locator('td').nth(2).locator('strong')).toContainText(usd);
    await expect(rows.nth(0).locator('td').nth(1).locator('small').first()).toContainText('最终价');
    await selectFilter(page, '价格排序', '美元估算：从高到低');
    for (const [i, name] of ['墨西哥', '菲律宾', '埃及', '日本'].entries()) await expect(rows.nth(i)).toContainText(name);
    await expect(rows.nth(0).locator('td').nth(1).locator('small').filter({ hasText: '含税参考价' })).toContainText(plan === 'pro_5x' ? '1,972' : '9,860');
  }
  expect(writes).toEqual([]);
});

test('GPT regional catalog shows a retryable fetch failure without starting preflight', async ({ page }) => {
  const writes = await setup(page, true);
  await page.goto('/gpt-direct');
  const catalog = await openCatalog(page);
  await expect(catalog.getByRole('alert')).toContainText('价格暂时无法加载');
  await expect(catalog.getByRole('button', { name: '重试' })).toBeVisible();
  expect(writes).toEqual([]);
});
