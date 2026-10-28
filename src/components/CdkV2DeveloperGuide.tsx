const example = `const base = process.env.BASE_URL + "/api/v2/cdk";
const headers = { "X-App-Id": process.env.APP_ID, "X-App-Secret": process.env.APP_SECRET, "Content-Type": "application/json" };
async function call(path, method = "GET", body, extra = {}) {
  const response = await fetch(base + path, { method, headers: { ...headers, ...extra }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const envelope = await response.json();
  if (!response.ok) throw new Error(envelope.error.code + ": " + envelope.error.message + " [" + envelope.requestId + "]");
  return envelope.data;
}
const products = await call("/products");
// Explicitly grant the chosen product to this API key in Developer settings.
const profile = await call("/profiles", "POST", {
  name: "GPT Plus", productId: "gpt.plus", enabled: true,
  executionPolicy: { cardStrategy: "existing_first", fundingStrategy: "auto_topup", declinePolicy: { mode: "switch_card", maxPaymentAttempts: 3 }, maxWalletDebitPerCodeUsd: "30.00" },
  autoCard: { productCode: "YOUR_CARD_PRODUCT", firstName: "Ada", lastName: "Lovelace" }
});
// GPT: choose paymentCountry from products.checkoutCountries; currency is server-controlled.
// Omitted: snapshot the default region at issuance. TG must omit this field.
const issuanceKey = crypto.randomUUID(); // Persist alongside the exact request BEFORE sending.
const issuance = { profileId: profile.id, quantity: 1, externalReference: "order-123", paymentCountry: "US" };
const batch = await call("/batches", "POST", issuance, { "Idempotency-Key": issuanceKey });
// Timeout: repeat the same issuance and key. Changed arguments require a NEW key.
await call("/batches/" + batch.id);
const fullCodes = await call("/batches/" + batch.id + "/export", "POST");
await call("/codes?productId=gpt.plus&page=1&pageSize=20");
await call("/codes/" + batch.list[0].id + "/revoke", "POST"); // Only before authorization/funding.
// For an existing redemption ID: read attempts and creator-key-only events.
// await call("/redemptions/" + redemptionId);
// Full configuration update with optimistic version:
// await call("/profiles/" + profile.id, "PATCH", { ...profile.configuration, expectedVersion: profile.version });

// Public redemption: secrets belong ONLY in POST bodies, never URLs.
async function redeem(action, body) {
  const response = await fetch(process.env.BASE_URL + "/api/public/v2/cdk/" + action, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const envelope = await response.json();
  if (!response.ok) throw new Error(envelope.error.message);
  return envelope.data;
}
// Use a different available code: the example above revoked its issued code.
const code = "CDK2-YOUR_AVAILABLE_CODE";
const preview = await redeem("preview", { code });
// If preview.legacy, open preview.redeemPath without secret URL parameters.
const deviceToken = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
const clientRequestId = crypto.randomUUID(); // Retain with deviceToken until complete.
const prepared = await redeem("prepare", { code, deviceToken, clientRequestId, credential: { mode: "access_token", accessToken: "USER_ACCESS_TOKEN" } });
// TG instead supplies recipient: "username".
// Show prepared.quote and ask the user to confirm before calling confirm.
const proof = { redemptionToken: prepared.redemptionToken, deviceToken };
// await redeem("confirm", { ...proof, quoteId: prepared.quoteId });
// Poll ONLY result for wait/unknown/paid pending delivery; never replay payment.
// const result = await redeem("result", proof);
// A changed quote requires prepare, then a new explicit confirmation.
`;
export function CdkV2DeveloperGuide() {
  return <section><h2>CDK v2 接口与完整示例</h2><p><a href="/cdk-v2">发行管理</a> · <a href="/redeem">统一兑换</a> · 基址 /api/v2/cdk</p><p>需要 cdk:read / configure / issue / export / revoke 和显式产品授权。导出为写权限，需要 IP 白名单。批次、尝试、事件及 Webhook 仅对创建 key 可见。未知付款只恢复原操作；已付款待交付不重付。</p><p>GPT 发码可传 paymentCountry（如 US、PH），可选地区见 products.checkoutCountries。批次返回 checkoutRegion，地区及币种生成后固定；未传则保存生成当时的默认地区。兑换时地区停用不会自动切换，需联系发行者。改变地区重发须使用新的幂等键。</p><pre style={{ overflowX: 'auto', maxWidth: '100%' }}><code>{example}</code></pre></section>;
}
