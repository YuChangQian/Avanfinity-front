import { test, expect, type Page } from '@playwright/test';

const id = '11111111-1111-4111-8111-111111111111';
const quoteId = '22222222-2222-4222-8222-222222222222';
async function setup(page: Page) {
  await page.addInitScript(() => localStorage.setItem('session', JSON.stringify({ token: '', userId: 1, email: 'sms@example.test' })));
  await page.route('**/api/**', r => r.fulfill({ json: { code: 200, data: [] } }));
  await page.route('**/api/dashboard', r => r.fulfill({ json: { email: 'sms@example.test', role: 'admin', walletBalance: '100', cardBalance: '0', cardCount: 0 } }));
  await page.route('**/api/sms/orders*', r => r.fulfill({ json: { code: 200, data: { list: [], page: 1, hasMore: false } } }));
  await page.route('**/api/features', r => r.fulfill({ json: { code: 200, data: {} } }));
  await page.route('**/api/sms/catalog', r => r.fulfill({ json: { code: 200, data: { enabled: true, currency: 'USD', services: [{ code: 'tg', name: 'Telegram' }], countries: [{ id: 6, name: '印度尼西亚' }] } } }));
  await page.route('**/api/sms/offers*', r => r.fulfill({ json: { code: 200, data: r.request().url().includes('service=') ? { currency: 'USD', countries: [{ country: 6, price: '1.1', count: 5 }] } : { currency: 'USD', services: [{ service: 'tg', price: '1.1', count: 5 }] } } }));
  await page.route('**/api/sms/quotes', r => r.fulfill({ json: { code: 200, data: { id: quoteId, price: '1.1', currency: 'USD', expiresAt: new Date(Date.now() + 60000).toISOString() } } }));
}

test('SMS service purchases once displays leading-zero codes and requests cancellation', async ({ page }) => {
  await setup(page);
  let order = { id, service: 'tg', country: 6, canCancel: true, cancelAvailableAt: null, status: 'waiting', price: '1.1', refundedAmount: '0', currency: 'USD', phone: '628123456789', expiresAt: null, createdAt: new Date().toISOString(), messages: [] as Array<{ id: string; code: string; text: string; receivedAt: string }> };
  const keys: string[] = [];
  await page.route('**/api/sms/orders*', r => {
    if (r.request().method() === 'POST') { expect(r.request().postDataJSON()).toEqual({ quoteId }); keys.push(r.request().headers()['idempotency-key']); return r.fulfill({ status: 202, json: { code: 202, data: order } }); }
    return r.fulfill({ json: { code: 200, data: { list: keys.length ? [order] : [], page: 1, hasMore: false } } });
  });
  await page.route(`**/api/sms/orders/${id}`, r => r.fulfill({ json: { code: 200, data: order } }));
  await page.goto('/sms');
  await expect(page.getByRole('link', { name: '收取验证码服务', exact: true })).toBeVisible();
  await page.getByTestId('sms-country-6').getByRole('button').click();
  await expect(page.getByTestId('sms-quote')).toContainText('1.1');
  await page.getByRole('button', { name: '确认购买', exact: true }).click();
  await expect(page.getByTestId('sms-order-detail')).toContainText('628123456789');
  expect(keys).toHaveLength(1); expect(keys[0]).toBeTruthy();
  order = { ...order, status: 'received', messages: [{ id: 'msg1', code: '001234', text: 'Your code 001234', receivedAt: new Date().toISOString() }] };
  await page.getByRole('button', { name: '刷新订单', exact: true }).click();
  await expect(page.getByTestId('sms-order-detail')).toContainText('001234');
  await expect(page.getByRole('button', { name: '取消并申请退款', exact: true })).toBeDisabled();
  await expect(page.locator('main')).not.toContainText(/hero-sms|api_key|activationId|markupPercent/i);
});

test('SMS service mobile cancellation remains pending until confirmed refund', async ({ page }) => {
  await setup(page); await page.setViewportSize({ width: 390, height: 844 });
  let status = 'waiting';
  const order = () => ({ id, service: 'tg', country: 6, canCancel: status === 'waiting', cancelAvailableAt: null, status, price: status === 'refunded' ? '0' : '1.1', originalPrice: '1.1', refundedAmount: status === 'refunded' ? '1.1' : '0', currency: 'USD', phone: '628123456789', expiresAt: null, createdAt: new Date().toISOString(), messages: [] });
  await page.route('**/api/sms/orders*', r => r.fulfill({ json: { code: 200, data: { list: [order()], page: 1, hasMore: false } } }));
  await page.route(`**/api/sms/orders/${id}`, r => r.fulfill({ json: { code: 200, data: order() } }));
  await page.route(`**/api/sms/orders/${id}/cancel`, r => { status = 'cancel_requested'; return r.fulfill({ status: 202, json: { code: 202, data: order() } }); });
  await page.goto('/sms');
  await page.getByRole('button', { name: '查看订单', exact: true }).click();
  await page.getByRole('button', { name: '取消并申请退款', exact: true }).click();
  await expect(page.getByTestId('sms-order-detail')).toContainText('取消处理中');
  await expect(page.getByTestId('sms-order-detail')).toContainText('取消申请已提交，正在确认结果；退款尚未完成');
  status = 'refunded'; await page.getByRole('button', { name: '刷新订单', exact: true }).click();
  await expect(page.getByTestId('sms-order-detail')).toContainText('退款完成');
  await expect(page.getByTestId('sms-order-detail')).toContainText('已退回钱包，不再等待短信');
  await expect(page.getByTestId('sms-order-detail')).not.toContainText('订单会自动更新');
  await expect(page.getByTestId('sms-order-detail')).toContainText('订单金额USD 1.1');
  await expect(page.getByTestId('sms-order-detail')).not.toContainText('订单金额USD 0');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('SMS service administrator changes global markup with version and filters review orders', async ({ page }) => {
  await setup(page);
  let settings = { enabled: false, markupPercent: '10', version: 1, configured: true, purchasesReady: true, currency: 'USD' };
  const updates: unknown[] = [];
  await page.route('**/api/admin/sms/settings', r => {
    if (r.request().method() === 'PATCH') { const body = r.request().postDataJSON(); updates.push(body); settings = { ...settings, ...body, version: settings.version + 1 }; }
    return r.fulfill({ json: { code: 200, data: settings } });
  });
  await page.route('**/api/admin/sms/orders*', r => r.fulfill({ json: { code: 200, data: { list: [], page: 1, hasMore: false } } }));
  await page.goto('/admin?panel=sms');
  await expect(page.getByRole('heading', { name: '收取验证码服务', exact: true })).toBeVisible();
  await page.getByLabel('加价比例（%）', { exact: true }).fill('12.50');
  await page.getByRole('button', { name: '保存收码设置', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '设置已保存' })).toBeVisible();
  expect(updates).toEqual([{ enabled: false, markupPercent: '12.50', version: 1 }]);
});

for (const failure of ['network', '408'] as const) test(`SMS service locks selection during quote and keeps uncertain intent after reload ${failure}`, async ({ page }) => {
  await setup(page);
  let releaseQuote!: () => void;
  const quoteWait = new Promise<void>(resolve => { releaseQuote = resolve; });
  await page.route('**/api/sms/quotes', async r => { await quoteWait; return r.fulfill({ json: { code: 200, data: { id: quoteId, price: '1.1', currency: 'USD', expiresAt: new Date(Date.now() + 60000).toISOString() } } }); });
  const keys: string[] = [];
  const order = { id, service: 'tg', country: 6, canCancel: true, cancelAvailableAt: null, status: 'waiting', price: '1.1', refundedAmount: '0', currency: 'USD', phone: '628123456789', expiresAt: null, createdAt: new Date().toISOString(), messages: [] };
  await page.route('**/api/sms/orders*', r => {
    if (r.request().method() === 'POST') {
      keys.push(r.request().headers()['idempotency-key']);
      if (keys.length === 1) return failure === 'network' ? r.abort() : r.fulfill({ status: 408, json: { error: '请求超时' } });
      return r.fulfill({ status: 202, json: { code: 202, data: order } });
    }
    return r.fulfill({ json: { code: 200, data: { list: keys.length ? [order] : [], page: 1, hasMore: false } } });
  });
  await page.route(`**/api/sms/orders/${id}`, r => r.fulfill({ json: { code: 200, data: order } }));
  await page.goto('/sms');
  await page.getByTestId('sms-country-6').getByRole('button').click();
  await expect(page.getByRole('button', { name: '选择服务 Telegram', exact: true })).toBeDisabled();
  await expect(page.getByRole('searchbox', { name: '搜索国家或地区' })).toBeDisabled();
  releaseQuote(); await page.getByRole('button', { name: '确认购买', exact: true }).click();
  await expect(page.getByRole('button', { name: '重试同一订单', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '选择服务 Telegram', exact: true })).toBeDisabled();
  await page.reload();
  await expect(page.getByRole('button', { name: '重试同一订单', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '重试同一订单', exact: true }).click();
  await expect(page.getByTestId('sms-order-detail')).toContainText('628123456789');
  expect(keys).toHaveLength(2); expect(keys[0]).toBe(keys[1]);
});

test('SMS service known wallet rejection allows a fresh quote', async ({ page }) => {
  await setup(page);
  await page.route('**/api/sms/orders*', r => r.request().method() === 'POST'
    ? r.fulfill({ status: 400, json: { error: '钱包可用余额不足，请充值' } })
    : r.fulfill({ json: { code: 200, data: { list: [], page: 1, hasMore: false } } }));
  await page.goto('/sms');
  await page.getByTestId('sms-country-6').getByRole('button').click();
  await page.getByRole('button', { name: '确认购买', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('钱包可用余额不足');
  await expect(page.getByTestId('sms-country-6').getByRole('button')).toBeEnabled();
});

test('SMS service previews prices before country selection and searches services and countries', async ({ page }) => {
  await setup(page);
  await page.route('**/api/sms/offers*', r => r.fulfill({ json: { code: 200, data: r.request().url().includes('service=')
    ? { currency: 'USD', countries: [{ country: 6, price: '1.1', count: 15 }, { country: 22, price: '0.858', count: 5 }] }
    : { currency: 'USD', services: [{ service: 'tg', price: '0.858', count: 20 }] } } }));
  await page.route('**/api/sms/catalog', r => r.fulfill({ json: { code: 200, data: { enabled: true, currency: 'USD', services: [{ code: 'tg', name: 'Telegram' }, { code: 'dr', name: 'OpenAI' }], countries: [{ id: 6, name: '印度尼西亚' }, { id: 22, name: '印度' }, { id: 0, name: '俄罗斯' }] } } }));
  await page.goto('/sms');
  await expect(page.getByTestId('sms-country-6')).toContainText('1.1');
  await expect(page.getByTestId('sms-country-0')).toContainText('暂无库存');
  await expect(page.getByTestId('sms-country-0').getByRole('button')).toBeDisabled();
  await page.getByRole('searchbox', { name: '搜索服务' }).fill('openai');
  await expect(page.getByRole('button', { name: /选择服务 OpenAI/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /选择服务 Telegram/ })).toHaveCount(0);
  await page.getByRole('searchbox', { name: '搜索服务' }).fill('');
  await page.getByRole('searchbox', { name: '搜索国家或地区' }).fill('印度');
  await expect(page.getByTestId('sms-country-6')).toBeVisible();
  await expect(page.getByTestId('sms-country-0')).toHaveCount(0);
  await page.getByTestId('sms-country-6').getByRole('button').click();
  await expect(page.getByTestId('sms-quote')).toContainText('1.1');
});

test('SMS service unavailable country quote shows stock message and allows another country', async ({ page }) => {
  await setup(page);
  await page.route('**/api/sms/quotes', r => r.fulfill({ status: 409, json: { errorCode: 'SMS_OUT_OF_STOCK', error: '该服务在此国家暂无可用号码，请选择其他国家或稍后刷新' } }));
  await page.goto('/sms');
  await page.getByTestId('sms-country-6').getByRole('button').click();
  await expect(page.getByRole('alert')).toContainText('暂无可用号码');
  await expect(page.getByRole('button', { name: '选择服务 Telegram', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: '确认购买', exact: true })).toHaveCount(0);
});

async function setupFullRent(page: Page, unavailable = false) {
  await setup(page);
  await page.route('**/api/sms/catalog', r => r.fulfill({ json: { code: 200, data: { enabled: true, currency: 'USD', services: [{ code: 'tg', name: 'Telegram' }, { code: 'full', name: 'Full rent' }], countries: [{ id: 6, name: '印度尼西亚' }] } } }));
  await page.route('**/api/sms/offers*', r => {
    const service = new URL(r.request().url()).searchParams.get('service');
    if (service === 'full' && unavailable) return r.fulfill({ status: 503, json: { error: '价格暂不可获取' } });
    return r.fulfill({ json: { code: 200, data: service === 'full'
      ? { currency: 'USD', countries: [{ country: 6, price: '2.35', count: 8, durationHours: 72 }, { country: 6, price: '5.50', count: 3, durationHours: 168 }] }
      : service ? { currency: 'USD', countries: [] }
      : { currency: 'USD', services: unavailable ? [] : [{ service: 'full', price: '2.35', count: 8 }], unavailableServices: unavailable ? ['full'] : [] } } });
  });
}

test('SMS service Full rent selects an available duration and binds the quote on mobile', async ({ page }) => {
  await setupFullRent(page); await page.setViewportSize({ width: 390, height: 844 });
  const requests: unknown[] = [];
  let releaseQuote!: () => void;
  const waiting = new Promise<void>(resolve => { releaseQuote = resolve; });
  await page.route('**/api/sms/quotes', async r => {
    requests.push(r.request().postDataJSON()); await waiting;
    return r.fulfill({ json: { code: 200, data: { id: quoteId, price: '5.50', currency: 'USD', durationHours: r.request().postDataJSON().durationHours, expiresAt: new Date(Date.now() + 60000).toISOString() } } });
  });
  await page.route('**/api/sms/orders*', r => r.request().method() === 'POST' ? r.abort() : r.fulfill({ json: { code: 200, data: { list: [], page: 1, hasMore: false } } }));
  await page.goto('/sms');
  await expect(page.getByRole('button', { name: '选择服务 全租', exact: true })).toContainText('全租');
  await page.getByRole('button', { name: '选择服务 全租', exact: true }).click();
  const duration = page.getByLabel('租期', { exact: true });
  await expect(duration.locator('option')).toHaveText(['3 天', '7 天']);
  await expect(page.locator('.sms-sort')).toContainText('暂无质量/热度数据');
  await expect(page.getByTestId('sms-country-6')).toContainText('2.35');
  await duration.selectOption('168');
  await expect(page.getByTestId('sms-country-6')).toContainText('5.50');
  await page.getByTestId('sms-country-6').getByRole('button').click();
  await expect(duration).toBeDisabled(); releaseQuote();
  await expect(page.getByTestId('sms-quote')).toContainText('7 天');
  expect(requests).toEqual([{ service: 'full', country: 6, durationHours: 168 }]);
  await duration.selectOption('72');
  await expect(page.getByTestId('sms-quote')).toHaveCount(0);
  await page.getByTestId('sms-country-6').getByRole('button').click();
  await page.getByRole('button', { name: '确认购买', exact: true }).click();
  await expect(page.getByRole('button', { name: '重试同一订单', exact: true })).toBeVisible();
  await expect(duration).toBeDisabled();
  await expect(page.locator('.sms-policy')).toContainText('超过窗口不会因无短信自动退款');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('SMS service Full rent distinguishes price failure from no stock and retries', async ({ page }) => {
  await setupFullRent(page, true); await page.goto('/sms');
  const service = page.getByRole('button', { name: '选择服务 全租', exact: true });
  await expect(service).toContainText('价格暂不可获取'); await expect(service).not.toContainText('暂无库存'); await service.click();
  await expect(page.getByRole('alert').filter({ hasText: '国家价格' })).toContainText('价格暂不可获取');
  await expect(page.getByRole('button', { name: '重试国家价格' })).toBeVisible();
  await setupFullRent(page); await page.getByRole('button', { name: '重试国家价格' }).click();
  await expect(page.getByTestId('sms-country-6')).toContainText('2.35');
});

test('SMS service Full rent shows cancellation deadline and trusts canCancel while continuing received polling', async ({ page }) => {
  await setupFullRent(page);
  let order = { id, service: 'full', country: 6, durationHours: 72, cancelAvailableAt: null, canCancel: false, cancellationDeadline: '2026-11-01T12:20:00Z', status: 'waiting', price: '2.35', refundedAmount: '0', currency: 'USD', phone: '628123456789', expiresAt: '2026-11-04T12:00:00Z', createdAt: '2026-11-01T12:00:00Z', messages: [] as Array<{ id: string; code: string; text: string; receivedAt: string }> };
  await page.route('**/api/sms/orders*', r => r.fulfill({ json: { code: 200, data: { list: [order], page: 1, hasMore: false } } }));
  await page.route(`**/api/sms/orders/${id}`, r => r.fulfill({ json: { code: 200, data: order } }));
  await page.goto('/sms');
  await expect(page.locator('.sms-order-list')).toContainText('3 天'); await expect(page.locator('.sms-order-list')).toContainText('取消退款截止');
  await page.getByRole('button', { name: '查看订单', exact: true }).click();
  await expect(page.getByTestId('sms-order-detail')).toContainText('取消退款截止');
  await expect(page.getByRole('button', { name: '取消并申请退款', exact: true })).toBeDisabled();
  order = { ...order, canCancel: true }; await page.getByRole('button', { name: '刷新订单', exact: true }).click();
  await expect(page.getByRole('button', { name: '取消并申请退款', exact: true })).toBeEnabled();
  order = { ...order, status: 'received', canCancel: false, messages: [{ id: 'm1', code: '000001', text: 'first', receivedAt: new Date().toISOString() }] };
  await page.getByRole('button', { name: '刷新订单', exact: true }).click(); await expect(page.getByTestId('sms-order-detail')).toContainText('000001');
  order = { ...order, messages: [...order.messages, { id: 'm2', code: '000002', text: 'second', receivedAt: new Date().toISOString() }] };
  await expect(page.getByTestId('sms-order-detail')).toContainText('000002', { timeout: 10000 });
});


test('SMS service country sorting uses real ranks with honest missing-data fallback', async ({ page }) => {
  await setup(page);
  await page.route('**/api/sms/catalog', r => r.fulfill({ json: { code: 200, data: { enabled: true, currency: 'USD', services: [{ code: 'tg', name: 'Telegram' }], countries: [{ id: 6, name: '印度尼西亚' }, { id: 22, name: '印度' }, { id: 0, name: '俄罗斯' }] } } }));
  await page.route('**/api/sms/offers*', r => r.fulfill({ json: { code: 200, data: r.request().url().includes('service=') ? { currency: 'USD', countries: [{ country: 6, price: '1', count: 15, qualityRank: 2, popularityRank: 1 }, { country: 22, price: '3', count: 5, qualityRank: 1, popularityRank: 2 }, { country: 0, price: '2', count: 30 }] } : { currency: 'USD', services: [] } } }));
  await page.goto('/sms');
  const rows = page.locator('.sms-country-list article');
  const order = async () => rows.evaluateAll(elements => elements.map(e => e.getAttribute('data-testid')));
  await expect.poll(order).toEqual(['sms-country-22', 'sms-country-6', 'sms-country-0']);
  const sort = page.getByLabel('排序方式', { exact: true });
  await expect(sort.locator('option')).toHaveText(['按质量排序', '按受欢迎度', '便宜一点', '贵一点', '按数量']);
  for (const [mode, ids] of [['popularity', [6,22,0]], ['cheap', [6,0,22]], ['expensive', [22,0,6]], ['quantity', [0,6,22]]] as const) {
    await sort.selectOption(mode); await expect.poll(order).toEqual(ids.map(n => `sms-country-${n}`));
  }
});

test('SMS service countdown refreshes eligibility and messages block stale cancellation permission', async ({ page }) => {
  await setup(page);
  const available = new Date(Date.now() + 120000).toISOString();
  let order = { id, service: 'tg', country: 6, status: 'waiting', canCancel: false, cancelAvailableAt: available, price: '1.1', refundedAmount: '0', currency: 'USD', phone: '639350867078', expiresAt: null, createdAt: new Date().toISOString(), messages: [] as Array<{ id: string; code: string; text: string; receivedAt: string }> };
  await page.route('**/api/sms/orders*', r => r.fulfill({ json: { code: 200, data: { list: [order], page: 1, hasMore: false } } }));
  await page.route(`**/api/sms/orders/${id}`, r => r.fulfill({ json: { code: 200, data: order } }));
  await page.clock.install(); await page.goto('/sms'); await page.getByRole('button', { name: '查看订单', exact: true }).click();
  const cancel = page.getByRole('button', { name: '取消并申请退款', exact: true });
  await expect(cancel).toBeDisabled(); await expect(page.getByTestId('sms-order-detail')).toContainText('后可申请取消');
  await page.reload(); await page.getByRole('button', { name: '查看订单', exact: true }).click(); await expect(cancel).toBeDisabled();
  order = { ...order, canCancel: true }; await page.clock.runFor(120001);
  await expect(cancel).toBeEnabled();
  order = { ...order, status: 'received', messages: [{ id: 'm1', code: '001234', text: 'received', receivedAt: new Date().toISOString() }] };
  await page.getByRole('button', { name: '刷新订单', exact: true }).click(); await expect(cancel).toBeDisabled();
  await page.clock.fastForward(5001);
  await expect(page.locator('.sms-order-list')).toContainText('001234');
});

for (const [phone, prefix, local] of [['639350867078', '+63', '9350867078'], ['+12025550123', '+1', '2025550123'], ['79123456789', '+7', '9123456789'], ['442079460018', '+44', '2079460018'], ['971501234567', '+971', '501234567']]) test(`SMS service separates and copies international phone ${prefix}`, async ({ page, context }) => {
  await setup(page); await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const countryName = ({ '+63': '菲律宾', '+1': '美国', '+7': '俄罗斯', '+44': '英国', '+971': '阿联酋' })[prefix];
  await page.route('**/api/sms/catalog', r => r.fulfill({ json: { code: 200, data: { enabled: true, currency: 'USD', services: [{ code: 'tg', name: 'Telegram' }], countries: [{ id: 6, name: countryName }] } } }));
  await page.setViewportSize({ width: 390, height: 844 });
  const order = { id, service: 'tg', country: 6, status: 'waiting', canCancel: false, cancelAvailableAt: null, price: '1.1', refundedAmount: '0', currency: 'USD', phone, expiresAt: null, createdAt: new Date().toISOString(), messages: [] };
  await page.route('**/api/sms/orders*', r => r.fulfill({ json: { code: 200, data: { list: [order], page: 1, hasMore: false } } }));
  await page.route(`**/api/sms/orders/${id}`, r => r.fulfill({ json: { code: 200, data: order } }));
  await page.goto('/sms'); await page.getByRole('button', { name: '查看订单', exact: true }).click();
  const detail = page.getByTestId('sms-order-detail');
  await expect(detail.getByLabel('国家区号', { exact: true })).toHaveText(prefix);
  await expect(detail.getByLabel('本地号码', { exact: true })).toHaveText(local);
  await expect(page.locator('.sms-history-phone')).toContainText(`${prefix} ${local}`);
  await detail.getByRole('button', { name: '复制本地号码', exact: true }).click(); expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(local);
  await detail.getByRole('button', { name: '复制完整号码', exact: true }).click(); expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(prefix + local);
  if (prefix === '+63') {
    await detail.screenshot({ path: test.info().outputPath('order-mobile.png') });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await detail.screenshot({ path: test.info().outputPath('order-desktop.png') });
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});


test('SMS service leaves an unknown calling prefix unsplit', async ({ page }) => {
  await setup(page);
  const order = { id, service: 'tg', country: 6, status: 'waiting', canCancel: false, cancelAvailableAt: null, price: '1.1', refundedAmount: '0', currency: 'USD', phone: '999123456789', expiresAt: null, createdAt: new Date().toISOString(), messages: [] };
  await page.route('**/api/sms/orders*', r => r.fulfill({ json: { code: 200, data: { list: [order], page: 1, hasMore: false } } }));
  await page.route(`**/api/sms/orders/${id}`, r => r.fulfill({ json: { code: 200, data: order } }));
  await page.goto('/sms'); await page.getByRole('button', { name: '查看订单', exact: true }).click();
  const detail = page.getByTestId('sms-order-detail');
  await expect(detail.getByLabel('国家区号', { exact: true })).toHaveCount(0);
  await expect(detail.getByLabel('手机号码', { exact: true })).toHaveText('999123456789');
  await expect(detail.getByRole('button', { name: '复制本地号码', exact: true })).toHaveCount(0);
});


for (const [status, message] of [['finished', '订单已结束，不再等待短信'], ['failed', '取号失败，预扣金额已退回钱包']]) test(`SMS service explains terminal no-SMS state ${status}`, async ({ page }) => {
  await setup(page);
  const order = { id, service: 'tg', country: 6, status, canCancel: false, cancelAvailableAt: null, price: '0', originalPrice: '1.1', refundedAmount: status === 'failed' ? '1.1' : '0', currency: 'USD', phone: '639350867078', expiresAt: null, createdAt: new Date().toISOString(), messages: [] };
  await page.route('**/api/sms/orders*', r => r.fulfill({ json: { code: 200, data: { list: [order], page: 1, hasMore: false } } }));
  await page.route(`**/api/sms/orders/${id}`, r => r.fulfill({ json: { code: 200, data: order } }));
  await page.goto('/sms'); await page.getByRole('button', { name: '查看订单', exact: true }).click();
  await expect(page.getByTestId('sms-order-detail')).toContainText(message);
  await expect(page.getByTestId('sms-order-detail')).not.toContainText('订单会自动更新');
});
