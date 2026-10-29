import { test, expect } from '@playwright/test';
const prepared = { id: 'r1', productId: 'tg.premium_3m', status: 'prepared', paymentStatus: 'unpaid', deliveryStatus: 'pending', attemptCount: 0, nextAction: 'confirm', stopReason: null, quoteId: 'q1', quote: { amountMinor: 1000, currency: 'USD', expiresAt: '2030-01-01' }, recipient: 'alice', canRetryPreflight: false, redemptionToken: 'secret' };
test('CDK v2 preflight requires explicit confirmation and queries unknown payment without resubmitting', async ({ page }) => {
  let confirmations = 0; let results = 0;
  await page.route('**/api/public/v2/cdk/*', async route => {
    const action = route.request().url().split('/').at(-1);
    const input = route.request().postDataJSON();
    expect(route.request().url()).not.toContain('secret');
    let data: unknown;
    if (action === 'preview') data = { legacy: false, productId: 'tg.premium_3m', inputType: 'recipient', authorizeEnabled: true };
    else if (action === 'prepare') { expect(input.recipient).toBe('alice'); expect(input.deviceToken.length).toBeGreaterThanOrEqual(32); data = prepared; }
    else if (action === 'confirm') { confirmations++; expect(input.quoteId).toBe('q1'); data = { ...prepared, status: 'payment_unknown', paymentStatus: 'unknown', nextAction: 'wait', attemptCount: 1 }; }
    else { results++; if (results === 1) return route.fulfill({ status: 503, json: { error: { code: 'TEMPORARY', message: '稍后查询' }, requestId: 'test' } }); data = { ...prepared, status: 'completed', paymentStatus: 'paid', deliveryStatus: 'delivered', nextAction: 'none', attemptCount: 1 }; }
    await route.fulfill({ json: { data, requestId: 'test' } });
  });
  await page.goto('/redeem');
  await page.getByLabel('兑换码').fill('CDK2-TEST'); await page.getByRole('button', { name: '识别兑换码' }).click();
  await page.getByLabel('接收账号').fill('alice'); await page.getByRole('button', { name: '预检账号与报价' }).click();
  await expect(page.getByRole('button', { name: '确认兑换' })).toBeVisible(); expect(confirmations).toBe(0);
  await page.getByRole('button', { name: '确认兑换' }).click();
  await expect(page.getByText('兑换成功', { exact: true })).toBeVisible({ timeout: 10000 });
  expect(confirmations).toBe(1); expect(results).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('CDK v2 legacy code uses original channel and disabled authorization prevents confirm', async ({ page }) => {
  await page.route('**/api/public/v2/cdk/preview', route => route.fulfill({ json: { data: { legacy: true, redeemPath: '/tg-cdk/redeem' }, requestId: 'test' } }));
  await page.goto('/redeem'); await page.getByLabel('兑换码').fill('TGCDK-TEST'); await page.getByRole('button', { name: '识别兑换码' }).click();
  await expect(page.getByRole('link', { name: '前往原渠道兑换' })).toHaveAttribute('href', '/tg-cdk/redeem');
  await expect(page.getByRole('button', { name: '确认兑换' })).toHaveCount(0);
});
test('CDK v2 management retains issuance intent after timeout and snapshots the profile version', async ({ page }) => {
  const config = { name: 'TG template', productId: 'tg.premium_3m', enabled: true, executionPolicy: { cardStrategy: 'existing_only', fundingStrategy: 'none', declinePolicy: { mode: 'switch_card', maxPaymentAttempts: 3 }, maxWalletDebitPerCodeUsd: '30' } };
  const keys: string[] = [];
  await page.addInitScript(() => localStorage.setItem('session', JSON.stringify({ token: 'test', userId: 1, displayName: 'Issuer', email: 'issuer@example.com' })));
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/cdk-v2/products')) return route.fulfill({ json: { data: { list: [{ id: 'tg.premium_3m', label: 'TG', enabled: true, inputType: 'recipient' }], issueEnabled: true, authorizeEnabled: true } } });
    if (path.endsWith('/cdk-v2/profiles')) return route.fulfill({ json: { data: { list: [{ id: 'p1', version: 2, enabled: true, configuration: config }] } } });
    if (path.endsWith('/cdk-v2/codes')) return route.fulfill({ json: { data: { list: [], total: 0, page: 1, pageSize: 20 } } });
    if (path.endsWith('/cdk-v2/batches')) {
      keys.push(route.request().headers()['idempotency-key']);
      expect(route.request().postDataJSON()).toEqual({ profileId: 'p1', quantity: 1, externalReference: '' });
      if (keys.length === 1) return route.fulfill({ status: 503, json: { error: { code: 'TIMEOUT', message: '请求超时' }, requestId: 'test' } });
      return route.fulfill({ json: { data: { id: 'b1', profileId: 'p1', profileVersion: 2, productId: 'tg.premium_3m', quantity: 1, list: [], replayed: true } } });
    }
    if (path.endsWith('/dashboard')) return route.fulfill({ json: { code: 0, data: { userId: 1, role: 'user', walletBalance: '100', cardBalance: '0', cardCount: 0, inviteCode: 'x' } } });
    if (path.endsWith('/features')) return route.fulfill({ json: { code: 0, data: { developerApi: true } } });
    return route.fulfill({ json: { code: 0, data: [] } });
  });
  await page.goto('/cdk-v2'); await page.getByRole('combobox', { name: '发行模板', exact: true }).selectOption('p1');
  await page.getByRole('button', { name: '免费生成兑换码', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('请求超时');
  await page.getByRole('button', { name: '免费生成兑换码', exact: true }).click(); await expect(page.getByText('原批次重放', { exact: false })).toBeVisible();
  expect(keys).toHaveLength(2); expect(keys[0]).toBe(keys[1]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('GPT issuance sends the chosen region and keeps it after reload', async ({ page }) => {
  const config = { name: 'GPT template', productId: 'gpt.plus', enabled: true, executionPolicy: { cardStrategy: 'existing_only', fundingStrategy: 'none', declinePolicy: { mode: 'fail', maxPaymentAttempts: 1 }, maxWalletDebitPerCodeUsd: '30' } };
  const keys: string[] = [];
  await page.addInitScript(() => localStorage.setItem('session', JSON.stringify({ token: 'test', userId: 1, displayName: 'Issuer', email: 'issuer@example.test' })));
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/cdk-v2/products')) return route.fulfill({ json: { data: { list: [{ id: 'gpt.plus', enabled: true, inputType: 'gpt_credential' }], checkoutCountries: [{ country: 'PH', currency: 'PHP' }, { country: 'US', currency: 'USD' }], issueEnabled: true, authorizeEnabled: true } } });
    if (path.endsWith('/cdk-v2/profiles')) return route.fulfill({ json: { data: { list: [{ id: 'p1', version: 1, enabled: true, configuration: config }] } } });
    if (path.endsWith('/cdk-v2/codes')) return route.fulfill({ json: { data: { list: [], total: 0, page: 1, pageSize: 20 } } });
    if (path.endsWith('/cdk-v2/batches')) {
      keys.push(route.request().headers()['idempotency-key']);
      expect(route.request().postDataJSON()).toEqual({ profileId: 'p1', quantity: 1, externalReference: '', paymentCountry: 'US' });
      if (keys.length === 1) return route.fulfill({ status: 503, json: { error: { code: 'TIMEOUT', message: '请求超时' } } });
      return route.fulfill({ json: { data: { id: 'b1', profileId: 'p1', profileVersion: 1, productId: 'gpt.plus', checkoutRegion: { country: 'US', currency: 'USD' }, quantity: 1, list: [], replayed: true } } });
    }
    if (path.endsWith('/dashboard')) return route.fulfill({ json: { code: 0, data: { userId: 1, role: 'user', walletBalance: '100', cardBalance: '0', cardCount: 0, inviteCode: 'x' } } });
    if (path.endsWith('/features')) return route.fulfill({ json: { code: 0, data: { developerApi: true } } });
    return route.fulfill({ json: { code: 0, data: [] } });
  });
  await page.goto('/cdk-v2');
  await page.getByRole('combobox', { name: '发行模板', exact: true }).selectOption('p1');
  await page.getByLabel('结账地区', { exact: true }).selectOption('US');
  await page.getByRole('button', { name: '免费生成兑换码', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('请求超时');
  await page.reload();
  await expect(page.getByLabel('结账地区', { exact: true })).toHaveValue('US');
  await page.getByRole('button', { name: '免费生成兑换码', exact: true }).click();
  await expect(page.getByText('结账地区：美国 · USD')).toBeVisible();
  expect(keys).toHaveLength(2); expect(keys[0]).toBe(keys[1]);
});

for (const savedCountry of [undefined, 'US']) test(`saved GPT issuance replays ${savedCountry ?? 'legacy'} request when regions change`, async ({ page }) => {
  const body = { profileId: 'p1', quantity: 1, externalReference: '', ...(savedCountry ? { paymentCountry: savedCountry } : {}) };
  const requests: unknown[] = [];
  await page.addInitScript(({ body }) => {
    localStorage.setItem('session', JSON.stringify({ token: 'test', userId: 1, displayName: 'Issuer', email: 'issuer@example.test' }));
    sessionStorage.setItem('cdk-v2-issuance-1', JSON.stringify({ key: 'saved-request-key', body }));
  }, { body });
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/cdk-v2/products')) return route.fulfill({ json: { data: { list: [{ id: 'gpt.plus', enabled: true }], checkoutCountries: [{ country: 'PH', currency: 'PHP' }], issueEnabled: true, authorizeEnabled: true } } });
    if (path.endsWith('/cdk-v2/profiles')) return route.fulfill({ json: { data: { list: [{ id: 'p1', version: 1, enabled: true, configuration: { name: 'Saved GPT', productId: 'gpt.plus', executionPolicy: { cardStrategy: 'existing_only', fundingStrategy: 'none', declinePolicy: { mode: 'fail', maxPaymentAttempts: 1 }, maxWalletDebitPerCodeUsd: '30' } } }] } } });
    if (path.endsWith('/cdk-v2/codes')) return route.fulfill({ json: { data: { list: [], total: 0, page: 1, pageSize: 20 } } });
    if (path.endsWith('/cdk-v2/batches')) {
      requests.push({ key: route.request().headers()['idempotency-key'], body: route.request().postDataJSON() });
      return route.fulfill({ json: { data: { id: 'b1', profileId: 'p1', profileVersion: 1, productId: 'gpt.plus', quantity: 1, list: [], replayed: true } } });
    }
    if (path.endsWith('/dashboard')) return route.fulfill({ json: { code: 0, data: { userId: 1, role: 'user', walletBalance: '100', cardBalance: '0', cardCount: 0, inviteCode: 'x' } } });
    if (path.endsWith('/features')) return route.fulfill({ json: { code: 0, data: { developerApi: true } } });
    return route.fulfill({ json: { code: 0, data: [] } });
  });
  await page.goto('/cdk-v2');
  const generate = page.getByRole('button', { name: '免费生成兑换码', exact: true });
  await expect(generate).toBeEnabled(); await generate.click();
  await expect.poll(() => requests).toEqual([{ key: 'saved-request-key', body }]);
});
