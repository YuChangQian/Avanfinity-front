import { test, expect, type Page } from '@playwright/test';

const id = '11111111-1111-4111-8111-111111111111';
const order = { id, ownerUserId: 42, ownerEmail: 'owner@example.test', ownerDisplayName: 'owner@example.test', service: 'tg', country: 6, durationHours: 72, status: 'needs_review', price: '1.1', originalPrice: '1.1', refundedAmount: '0', currency: 'USD', canCancel: false, cancelAvailableAt: null, phone: '628123456789', createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:01:00Z', expiresAt: null, activationId: null, actualCost: '1', costLimit: '1.05', markupPercent: '10', pricingVersion: 3, creatorApiKeyId: 7, purchaseStartedAt: '2026-11-01T00:00:01Z', cancellationConfirmedAt: null, messages: [{ id: 'm1', code: '001234', text: 'Your code 001234', receivedAt: '2026-11-01T00:01:00Z' }], walletEntries: [{ id: 10, type: 'sms_purchase', amount: '-1.1', balanceBefore: '100', balanceAfter: '98.9', remark: '预扣收码订单', createdAt: '2026-11-01T00:00:00Z' }] };
async function setup(page: Page) {
  await page.addInitScript(() => localStorage.setItem('session', JSON.stringify({ token: '', userId: 1, email: 'admin@example.test' })));
  await page.route('**/api/**', r => r.fulfill({ json: { code: 200, data: [] } }));
  await page.route('**/api/dashboard', r => r.fulfill({ json: { email: 'admin@example.test', role: 'admin', walletBalance: '100', cardBalance: '0', cardCount: 0 } }));
  await page.route('**/api/admin/sms/settings', r => r.fulfill({ json: { code: 200, data: { enabled: true, markupPercent: '10', version: 1, configured: true, purchasesReady: true } } }));
  await page.route('**/api/sms/catalog', r => r.fulfill({ json: { code: 200, data: { enabled: true, currency: 'USD', services: [{ code: 'tg', name: 'Telegram' }], countries: [{ id: 6, name: '印度尼西亚' }] } } }));
  await page.route('**/api/admin/sms/orders?*', r => r.fulfill({ json: { code: 200, data: { list: [order], page: 1, hasMore: false } } }));
  await page.route(`**/api/admin/sms/orders/${id}`, r => r.fulfill({ json: { code: 200, data: order } }));
}

test('SMS service admin identifies customer and opens financial order drawer', async ({ page }) => {
  await setup(page); await page.goto('/admin?panel=sms');
  const table = page.getByTestId('admin-sms-table');
  await expect(table).toContainText('owner@example.test'); await expect(table).toContainText('Telegram'); await expect(table).toContainText('印度尼西亚');
  await table.getByRole('button', { name: '查看订单', exact: true }).click();
  const drawer = page.getByRole('dialog'); await expect(drawer).toContainText('001234'); await expect(drawer).toContainText('API 密钥 #7'); await expect(drawer).toContainText('sms_purchase'); await expect(drawer).toContainText('98.9');
  await expect(drawer.getByRole('button', { name: /owner@example.test/ })).toBeVisible();
  await expect(drawer.locator('.admin-drawer-hero')).toBeVisible();
  expect((await drawer.locator('.admin-drawer-hero').boundingBox())!.height).toBeGreaterThan(100);
  await drawer.screenshot({ path: test.info().outputPath('admin-sms-desktop.png') });
  await drawer.getByRole('button', { name: '关闭', exact: true }).click(); await expect(drawer).toHaveCount(0);
});

test('SMS service admin searches account and order fields and preserves anomaly resolution', async ({ page }) => {
  await setup(page);
  const searches: URL[] = [];
  await page.route('**/api/admin/sms/orders?*', r => { searches.push(new URL(r.request().url())); return r.fulfill({ json: { code: 200, data: { list: [order], page: 1, hasMore: false } } }); });
  let resolved: unknown;
  await page.route(`**/api/admin/sms/orders/${id}/resolve`, r => { resolved = r.request().postDataJSON(); return r.fulfill({ json: { code: 200, data: { ...order, activationId: '123456', status: 'waiting' } } }); });
  await page.goto('/admin?panel=sms');
  await page.getByLabel('搜索', { exact: true }).fill('@owner'); await page.getByLabel('用户 ID', { exact: true }).fill('42'); await page.getByLabel('订单状态', { exact: true }).selectOption('needs_review'); await page.getByRole('button', { name: '查询订单', exact: true }).click();
  await expect.poll(() => searches.at(-1)?.searchParams.get('q')).toBe('@owner'); expect(searches.at(-1)?.searchParams.get('userId')).toBe('42'); expect(searches.at(-1)?.searchParams.get('status')).toBe('needs_review'); expect(searches.at(-1)?.searchParams.get('page')).toBe('1');
  await page.getByLabel('搜索', { exact: true }).fill('+62 8123456789'); await page.getByRole('button', { name: '查询订单', exact: true }).click();
  await expect.poll(() => searches.at(-1)?.searchParams.get('q')).toBe('628123456789');
  await page.getByRole('button', { name: '查看订单', exact: true }).click();
  const drawer = page.getByRole('dialog'); await drawer.getByLabel('已核实的激活编号').fill('123456'); await drawer.getByLabel('核对说明').fill('人工核实激活编号正确'); await drawer.getByRole('button', { name: '提交核对结果' }).click();
  await expect(page.getByRole('status').filter({ hasText: '核对结果已保存' })).toBeVisible(); expect(resolved).toEqual({ activationId: '123456', note: '人工核实激活编号正确' }); await expect(drawer.getByRole('button', { name: '提交核对结果' })).toHaveCount(0);
});

test('SMS service admin drawer retries failed details and links to customer on mobile', async ({ page }) => {
  await setup(page); await page.setViewportSize({ width: 390, height: 844 });
  let failed = true;
  await page.route(`**/api/admin/sms/orders/${id}`, r => failed ? r.fulfill({ status: 503, json: { error: 'unavailable' } }) : r.fulfill({ json: { code: 200, data: order } }));
  await page.goto('/admin?panel=sms'); await page.getByRole('button', { name: '查看订单', exact: true }).click();
  const drawer = page.getByRole('dialog'); await expect(drawer).toContainText('订单详情加载失败'); failed = false; await drawer.getByRole('button', { name: '重试', exact: true }).click(); await expect(drawer).toContainText('owner@example.test');
  await drawer.screenshot({ path: test.info().outputPath('admin-sms-mobile.png') });
  expect(await drawer.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.route('**/api/admin/customers/42**', r => r.fulfill({ json: { code: 200, data: { customer: { id: 42, email: 'owner@example.test', walletBalance: '98.9', cardBalance: '0', status: 'active', role: 'user', createdAt: order.createdAt }, cards: [], walletEntries: [], orders: [] } } }));
  await drawer.getByRole('button', { name: /owner@example.test/ }).click(); await expect(drawer).toHaveCount(0); await expect(page).toHaveURL(/customerId=42/);
});

test('SMS service admin keeps catalog failures independent and labels fallback codes', async ({ page }) => {
  await setup(page); await page.route('**/api/sms/catalog', r => r.fulfill({ status: 503, json: { error: 'unavailable' } })); await page.goto('/admin?panel=sms');
  await expect(page.getByTestId('admin-sms-table')).toContainText('服务代码 tg'); await expect(page.getByTestId('admin-sms-table')).toContainText('国家 / 地区 #6');
});

test('SMS service admin polls open orders and clears earlier details while loading another', async ({ page }) => {
  await setup(page);
  const second = '22222222-2222-4222-8222-222222222222';
  let current = { ...order, status: 'waiting' };
  let requests = 0;
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/admin/sms/orders?*', r => r.fulfill({ json: { code: 200, data: { list: [order, { ...order, id: second, ownerDisplayName: '@verifieduser', ownerEmail: null }], page: 1, hasMore: false } } }));
  await page.route(`**/api/admin/sms/orders/${id}`, r => { requests++; return r.fulfill({ json: { code: 200, data: current } }); });
  await page.route(`**/api/admin/sms/orders/${second}`, async r => { await waiting; return r.fulfill({ json: { code: 200, data: { ...order, id: second, ownerDisplayName: '@verifieduser', ownerEmail: null, status: 'refunded', price: '0', refundedAmount: '1.1' } } }); });
  await page.clock.install(); await page.goto('/admin?panel=sms');
  await page.getByTestId('admin-sms-table').getByRole('button', { name: '查看订单', exact: true }).first().click(); const drawer = page.getByRole('dialog'); await expect(drawer).toContainText('001234');
  current = { ...current, status: 'received' }; const previous = requests; await page.clock.runFor(5001); await expect.poll(() => requests).toBeGreaterThan(previous); await expect(drawer).toContainText('已收到验证码');
  await drawer.getByRole('button', { name: '关闭', exact: true }).click(); await page.getByTestId('admin-sms-table').getByRole('button', { name: '查看订单', exact: true }).nth(1).click();
  await expect(drawer).toContainText('订单详情加载中'); await expect(drawer).not.toContainText('owner@example.test'); release();
  await expect(drawer).toContainText('@verifieduser'); await expect(drawer).toContainText('退款完成'); await expect(drawer).toContainText('原始金额 USD 1.1'); await expect(drawer).not.toContainText('利润');
});

test('SMS service admin confirms an unpurchased review order before refunding', async ({ page }) => {
  await setup(page);
  let resolved: unknown;
  await page.route(`**/api/admin/sms/orders/${id}/resolve`, r => { resolved = r.request().postDataJSON(); return r.fulfill({ json: { code: 200, data: { ...order, status: 'refunded', price: '0', refundedAmount: '1.1' } } }); });
  await page.goto('/admin?panel=sms'); await page.getByRole('button', { name: '查看订单', exact: true }).click();
  const drawer = page.getByRole('dialog'); await drawer.getByLabel('核对说明').fill('人工核实未发生上游购买'); await drawer.getByLabel('已人工核实未购买成功，退回预扣金额').check(); await drawer.getByRole('button', { name: '提交核对结果' }).click();
  await expect(drawer).toContainText('退款完成'); expect(resolved).toEqual({ note: '人工核实未发生上游购买', confirmNoPurchase: true });
});
