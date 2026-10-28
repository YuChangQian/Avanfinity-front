import { test, expect, type Page } from '@playwright/test';

async function mockCustomer(page: Page) {
  await page.addInitScript(() => localStorage.setItem('session', JSON.stringify({ token: '', userId: 1, email: 'test@example.test' })));
  await page.route('**/api/**', route => route.fulfill({ json: { code: 0, data: [] } }));
  await page.route('**/api/v1/openapi.json', route => route.fulfill({ json: { openapi: '3.1.0', info: { title: 'API' }, paths: {} } }));
  await page.route('**/api/developer/webhooks/deliveries?*', route => route.fulfill({ json: { code: 0, data: { total: 0, page: 1, pageSize: 20, list: [] } } }));
  await page.route('**/api/dashboard', route => route.fulfill({ json: { email: 'test@example.test', role: 'customer', walletBalance: '0', cardBalance: '0', cardCount: 0 } }));
}

test('TG direct visibility: homepage shows login only for guests', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.landing-nav-actions a[href="/login"]')).toBeVisible();
  await expect(page.locator('a[href="/dashboard"]')).toHaveCount(0);
  await mockCustomer(page);
  await page.reload();
  await expect(page.locator('.landing-nav-actions a[href="/dashboard"]')).toBeVisible();
  await expect(page.locator('a[href="/login"], a[href="/register"]')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.landing-nav-actions a[href="/dashboard"]')).toBeVisible();
});

test('TG direct visibility: navigation retains TG GPT and hides retired X routes', async ({ page }) => {
  await mockCustomer(page);
  await page.goto('/developer');
  const nav = page.locator('#app-navigation');
  await expect(nav.locator('a[href="/tg-direct"]')).toBeVisible();
  for (const path of ['/gpt-direct', '/cdk/redeem', '/tg-cdk/redeem', '/developer']) await expect(nav.locator(`a[href="${path}"]`)).toBeVisible();
  await expect(nav.locator('a[href^="/x-"]')).toHaveCount(0);
  let xRequests = 0;
  page.on('request', request => { if (/\/api\/(?:public\/)?x-(?:direct|cdk)/.test(request.url())) xRequests++; });
  await page.goto('/x-direct?tab=cdk');
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto('/x-cdk/redeem');
  await expect(page).toHaveURL(/\/$/);
  expect(xRequests).toBe(0);
});

test('TG direct visibility: API docs and permissions exclude X and retain TG GPT', async ({ page }) => {
  await mockCustomer(page);
  await page.route('**/api/developer/keys', route => route.fulfill({ json: { code: 0, data: [{ id: 1, name: 'Test key', appId: 'app_test', scopes: ['gpt:read'], status: 'active', ipWhitelist: '', minuteLimit: 10, dailyLimit: 100, createdAt: '2026-01-01' }] } }));
  await page.route('**/api/v1/openapi.json', route => route.fulfill({ json: {
    openapi: '3.1.0', info: { title: 'API' }, tags: [{ name: 'X Direct' }, { name: 'TG Direct' }, { name: 'GPT Direct' }], paths: {
      '/x-direct/orders': { get: { operationId: 'xOrders', tags: ['X Direct'], responses: {} } },
      '/public/x-cdk/preview': { post: { operationId: 'xCdkPreview', tags: ['X Direct'], responses: {} } },
      '/tg-direct/orders': { get: { operationId: 'tgOrders', tags: ['TG Direct'], responses: {} } },
      '/gpt/orders': { get: { operationId: 'gptOrders', tags: ['GPT Direct'], responses: {} } },
    },
  } }));
  await page.goto('/developer');
  await expect(page.locator('[data-operation-id="tgOrders"]')).toBeVisible();
  await expect(page.locator('[data-operation-id="gptOrders"]')).toBeVisible();
  await expect(page.locator('[data-operation-id="xOrders"], [data-operation-id="xCdkPreview"]')).toHaveCount(0);
  await expect(page.locator('input[value="tg-direct:read"]')).toBeVisible();
  await expect(page.locator('input[value="gpt:read"]')).toBeVisible();
  await expect(page.locator('input[value^="x-direct:"]')).toHaveCount(0);
  const href = await page.locator('a[download="avanfinity-openapi.json"]').getAttribute('href');
  expect(Object.keys(JSON.parse(decodeURIComponent(href!.split(',').slice(1).join(','))).paths)).toEqual(['/tg-direct/orders', '/gpt/orders']);
});

for (const legacy of [true, false]) {
  test(`TG direct visibility: unified CDK blocks retired X redemption (legacy ${legacy})`, async ({ page }) => {
    await page.route('**/api/public/v2/cdk/preview', route => route.fulfill({ json: { data: legacy ? { legacy: true, redeemPath: '/x-cdk/redeem' } : { legacy: false, productId: 'x.premium_3m', inputType: 'recipient', authorizeEnabled: true } } }));
    await page.goto('/redeem');
    await page.getByLabel('兑换码', { exact: true }).fill('TEST-CODE');
    await page.getByRole('button', { name: '识别兑换码' }).click();
    await expect(page.getByRole('status')).toContainText('X 订阅兑换已停止提供');
    await expect(page.getByRole('button', { name: '预检账号与报价' })).toHaveCount(0);
    await expect(page.locator('a[href="/x-cdk/redeem"]')).toHaveCount(0);
  });
}

test('TG direct visibility: CDK issuance hides X products and saved X templates', async ({ page }) => {
  await mockCustomer(page);
  const policy = { cardStrategy: 'existing_only', fundingStrategy: 'none', declinePolicy: { mode: 'fail', maxPaymentAttempts: 1 }, maxWalletDebitPerCodeUsd: '30' };
  await page.route('**/api/cdk-v2/products', route => route.fulfill({ json: { data: { issueEnabled: true, authorizeEnabled: true, list: ['x.premium_3m', 'tg.premium_3m', 'gpt.plus'].map(id => ({ id, enabled: true })) } } }));
  await page.route('**/api/cdk-v2/profiles', route => route.fulfill({ json: { data: { list: ['x.premium_3m', 'tg.premium_3m', 'gpt.plus'].map(id => ({ id, enabled: true, version: 1, configuration: { name: id, productId: id, executionPolicy: policy } })) } } }));
  await page.goto('/cdk-v2');
  await expect(page.getByRole('combobox', { name: '发行模板', exact: true })).toBeVisible();
  const options = page.getByRole('combobox', { name: '发行模板', exact: true }).locator('option');
  await expect(options).toHaveCount(3);
  await expect(options).toHaveText(['选择一个已启用的模板', 'tg.premium_3m · v1', 'gpt.plus · v1']);
});
