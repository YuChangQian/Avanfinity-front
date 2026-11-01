import i18n from './i18n';
export async function cdkRequest<T>(path: string, input?: unknown, token?: string, method = input === undefined ? 'GET' : 'POST', idempotencyKey?: string): Promise<T> {
  const response = await fetch(`/api/${token !== undefined ? 'cdk-v2' : 'public/v2/cdk'}/${path}`, {
    credentials: 'same-origin',
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`${body.error?.message ?? i18n.t('cdkText.requestFailed')} (${body.requestId ?? response.status})`);
  return body.data;
}
