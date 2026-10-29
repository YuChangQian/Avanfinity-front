const example = `// BASE_URL 例如 https://www.avanfinity.com/api/v1；仅在服务端保存密钥。
const base = process.env.BASE_URL;
const headers = { "X-App-Id": process.env.APP_ID, "X-App-Secret": process.env.APP_SECRET, "Content-Type": "application/json" };
async function call(path, options = {}) {
  const response = await fetch(base + path, { ...options, headers: { ...headers, ...options.headers } });
  const result = await response.json();
  if (!response.ok) throw new Error(result.errorCode ?? "CDK_REQUEST_FAILED");
  return result.data;
}

// 1. 生成之前，查询套餐和当前可选地区。
const plans = await call("/gpt-direct/plans");
if (plans.cdkRegionSelectionEnabled !== true) throw new Error("当前服务未开放 CDK 手动选区");
// 将 plans.checkoutCountries 渲染为下拉选项，由用户选择 country。
const paymentCountry = "US"; // 示例，必须存在于当前 checkoutCountries 中。
const selected = plans.checkoutCountries.find(region => region.country === paymentCountry);
if (!selected) throw new Error("所选地区当前不可用");

// 2. 把所选国家放入生成请求；币种由服务端根据地区确定。
// plan 可选订阅，或 credits_250 / credits_1000 / credits_2500 / credits_5000；
// 自定义点数用 credits_N，N 为 250–9,999,999 的整数；quantity 是 CDK 张数。
const body = { plan: "credits_800", quantity: 1, forceNewCard: false, paymentCountry };
const issuanceKey = crypto.randomUUID();
// 发送前，持久保存 issuanceKey 与 body。超时重试复用原键和完全相同的 body。
const batch = await call("/gpt-direct/cdks/generate", {
  method: "POST", headers: { "Idempotency-Key": issuanceKey }, body: JSON.stringify(body),
});

// 3. 读取实际固定的地区和币种；完整兑换码应安全交付，不写入日志。
console.log(batch.checkoutRegion); // 例如 { country: "US", currency: "USD" }
// 改地区、套餐、数量或开卡策略，须创建新的请求键。`;

export function CdkRegionGuide() {
  return <section data-testid="cdk-region-guide">
    <h2>CDK 生成前选区</h2>
    <p>统一使用 API v1。需要 <code>gpt:read</code> 与 <code>cdk:purchase</code> 权限；生成请求需要 IP 白名单。</p>
    <ol>
      <li><strong>先查询地区：</strong><code>GET /api/v1/gpt-direct/plans</code> 返回 <code>checkoutCountries</code> 和 <code>cdkRegionSelectionEnabled</code>。</li>
      <li><strong>选择后再生成：</strong>从目录选择国家，将 <code>paymentCountry</code> 传给 <code>POST /api/v1/gpt-direct/cdks/generate</code>。币种由服务端确定。</li>
      <li><strong>核对返回值：</strong><code>data.checkoutRegion</code> 是生成后固定的地区和币种，兑换时不可更改。</li>
    </ol>
    <p>点数 CDK 支持 250、1,000、2,500、5,000 点及自定义 250–9,999,999 整数点；使用 <code>plan: "credits_N"</code>，<code>quantity</code> 是张数。点数与地区生成后固定，充值不变更订阅套餐。</p>
    <p>选区仅适用于 GPT CDK。未指定国家时保存生成当时的默认地区；未开放手动选区的服务须省略该字段。当前地区以每次查询结果为准。</p>
    <p><a href="/api/v1/openapi.json" target="_blank" rel="noreferrer">统一 API OpenAPI</a> · <a href="/docs/avanfinity-downstream-api.md" download>下载完整对接文档</a></p>
    <pre style={{ overflowX: 'auto', maxWidth: '100%' }}><code>{example}</code></pre>
  </section>;
}
