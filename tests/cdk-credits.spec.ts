import { test, expect, type Page } from '@playwright/test';

async function setup(page: Page, failFirst = false) {
  const generated: Array<{ body: Record<string, unknown>; key: string }> = [];
  const publicCalls: Array<{ path: string; body: Record<string, unknown> }> = [];
  await page.addInitScript(() => localStorage.setItem('session', JSON.stringify({ token: '', userId: 101, email: 'owner@example.test' })));
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    let data: unknown = { total: 0, list: [] };
    if (path === '/api/features') data = { version: 1, gptDirect: true, gptCdk: true };
    else if (path === '/api/dashboard') return route.fulfill({ json: { email: 'owner@example.test', role: 'customer', walletBalance: '100', cardBalance: '100', cardCount: 1, inviteCode: 'TEST' } });
    else if (path === '/api/support/tickets' || path === '/api/announcements/unread') data = [];
    else if (path.endsWith('/plans')) data = { version: 2, cdkRegionSelectionEnabled: true, checkoutCountries: [{ country: 'PH', currency: 'PHP' }, { country: 'US', currency: 'USD' }], plans: ['plus','credits_250','credits_1000','credits_2500','credits_5000'].map(key => ({ key, label: key, enabled: true, serviceFeeUsdMinor: 100, customerServiceFee: '1' })) };
    else if (path.endsWith('/cdks/generate')) {
      const body = request.postDataJSON(); generated.push({ body, key: request.headers()['idempotency-key'] });
      if (failFirst && generated.length === 1) return route.fulfill({ status: 503, json: { error: 'Synthetic temporary error' } });
      data = { plan: body.plan, quantity: body.quantity, items: Array.from({ length: body.quantity }, (_, i) => ({ cdkId: `synthetic-${i}`, code: `AVF-${'A'.repeat(31)}${i}`, codePrefix: 'AVF-AAAA' })), checkoutRegion: { country: body.paymentCountry, currency: body.paymentCountry === 'US' ? 'USD' : 'PHP' }, generated: true, totalSalePrice: '0' };
    } else if (path.startsWith('/api/public/cdk/')) {
      publicCalls.push({ path, body: request.postDataJSON() });
      if (path.endsWith('/preview')) data = { redemption_token: 'synthetic-redemption-token', plan: 'credits_800' };
      else if (path.endsWith('/preflight')) data = { preflight_token: 'synthetic-preflight-token' };
      else data = { status: 'completed', stage: 'complete', plan: 'credits_800', quotedAmountMinor: 3200, currency: 'USD', operationStatus: 'SUCCEEDED', serviceFee: '0' };
    }
    await route.fulfill({ json: { code: 0, data } });
  });
  return { generated, publicCalls };
}

async function openGenerator(page: Page) {
  await page.goto('/gpt-direct');
  await page.getByRole('tab', { name: '生成待售 CDK' }).click();
  return page.getByTestId('gpt-cdk-generate');
}

test('credits CDK presets generate selected points and region without direct orders', async ({ page }) => {
  const state = await setup(page), generator = await openGenerator(page);
  await generator.getByLabel('CDK 结账地区').selectOption('US');
  for (const points of [250, 1000, 2500, 5000]) {
    await generator.getByTestId(`gpt-cdk-generate-credits_${points}`).click();
    await expect(generator.locator('.gpt-cdk-purchase-result')).toBeVisible();
    await expect.poll(() => state.generated.length).toBe([250,1000,2500,5000].indexOf(points) + 1);
    expect(state.generated.at(-1)?.body).toMatchObject({ plan: `credits_${points}`, quantity: 1, paymentCountry: 'US' });
  }
  expect(state.publicCalls).toHaveLength(0);
});

test('credits CDK custom quantity validates bounds and preserves retry intent', async ({ page }, testInfo) => {
  const state = await setup(page, true), generator = await openGenerator(page);
  const points = generator.getByLabel('CDK 自定义点数'), button = generator.getByTestId('gpt-cdk-generate-credits_custom');
  for (const invalid of ['', '249', '10000000', '800.5', '-1']) {
    await points.fill(invalid); await expect(button).toBeDisabled();
  }
  await points.fill('9999999'); await expect(button).toBeEnabled();
  await points.fill('800');
  await generator.screenshot({ path: `../../cdk-credits-${testInfo.project.name}.png` });
  await generator.getByLabel('CDK 自定义张数').fill('2');
  await generator.getByLabel('CDK 结账地区').selectOption('US');
  await button.click(); await expect(generator.getByRole('alert')).toContainText('Synthetic temporary error');
  await button.click(); await expect(generator.locator('.gpt-cdk-purchase-result code')).toHaveCount(2);
  expect(state.generated[0]).toEqual(state.generated[1]);
  expect(state.generated[1].body).toMatchObject({ plan: 'credits_800', quantity: 2, paymentCountry: 'US' });
  await points.fill('801'); await button.click();
  await expect.poll(() => state.generated.length).toBe(3);
  expect(state.generated[2].key).not.toBe(state.generated[1].key);
  expect(state.generated[2].body.plan).toBe('credits_801');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('credits CDK redemption accepts custom points and completes original authorization', async ({ page }) => {
  const state = await setup(page);
  await page.goto('/cdk/redeem');
  await page.getByLabel('CDK 兑换码', { exact: true }).fill(`AVF-${'A'.repeat(32)}`);
  await page.getByRole('button', { name: /验证 CDK/ }).click();
  await expect(page.getByText(/800.*点|800.*额度|额度.*800/).first()).toBeVisible();
  await page.locator('textarea').fill(JSON.stringify({ accessToken: 'synthetic-access', sessionToken: 'synthetic-cookie' }));
  await page.getByRole('button', { name: /安全验证账户/ }).click();
  await page.getByRole('button', { name: /确认兑换/ }).click();
  await expect.poll(() => state.publicCalls.filter(c => c.path.endsWith('/redeem')).length).toBe(1);
  const redeem = state.publicCalls.find(c => c.path.endsWith('/redeem'))!;
  expect(redeem.body).toMatchObject({ redemption_token: 'synthetic-redemption-token', preflight_token: 'synthetic-preflight-token' });
  expect(redeem.body).not.toHaveProperty('plan');
  expect(redeem.body).not.toHaveProperty('paymentCountry');
});
