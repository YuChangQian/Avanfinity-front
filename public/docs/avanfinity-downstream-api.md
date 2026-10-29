# Avanfinity 统一对接文档（API v1）

本文档描述当前 API v1 的 72 个对外 API 操作与 23 类 Webhook 事件合约。机器可读规范：[`backend/openapi/downstream-v1.json`](../backend/openapi/downstream-v1.json)。接口只有在本轮验收矩阵中的功能、隔离和安全门禁全部通过后才视为可发布；当前证据状态见 [`docs/downstream-api-acceptance-matrix.md`](../docs/downstream-api-acceptance-matrix.md)。


## 本次同步：2026-10-29

- 公共兑换接口使用 `/api/public/cdk`、`/api/public/tg-cdk` 等实际地址；相应 OpenAPI 操作通过 `servers=/api` 覆盖默认 v1 基址。生成示例时必须遵循操作级基址，不能统一拼接 `/api/v1`。
- 机器规范：[API v1](/api/v1/openapi.json)。线上「开发者」页面同步提供参数说明和示例。本文末尾完整接口参考与字段定义直接由同版本 OpenAPI 生成；调用时以实时返回的套餐、地区、权限和报价为准。
- GPT 直充订阅档位：`go`、`plus`、`pro_5x`、`pro_20x`、`pro_25x`。点数下单使用 `credits_N`，N 为 250–9999999 的整数，例如 `credits_800`。目录列出的常用点数档位与自定义数量分别处理；必须预检目标套餐，不能按比例自行计算付款金额。
- CDK 生成支持可选 `paymentCountry`。国家从套餐目录的 `checkoutCountries` 选择，币种由服务端决定。返回 `checkoutRegion={country,currency}`；省略国家时固定发行当时的默认地区。生成后不可改变，地区停用或币种变化时停止兑换，不自动换区。旧码没有地区快照时保留原行为。
- 改变国家、套餐、数量或开卡策略时使用新幂等键；网络超时重试保留原键和完全相同的请求体。地区参与请求幂等校验。同一请求重放返回原地区，即使后来默认地区变化。
- CDK 只开放其产品目录列出的档位，不能因为直充支持自定义点数就推断 CDK 也支持。自动开卡任务当前仍只接受其接口列出的四个订阅档位。
- 完整 Session 用 JSON **字符串**提交，含 `sessionToken` 与 `accessToken`，UTF-8 最多 65536 字节；不直接传 JSON 对象。订单恢复换 Session 的接口只接受 Session 模式。其他凭据模式是否可完成付款取决于账户及实际流程；需要 Session 时返回明确错误。
- 指定卡付款结果未知时只查询原订单；不要重新建单。`cs_live` 交接沿用本次选卡，禁止自动换卡，新增服务成本由平台承担，客户已确认价格不变；该路径接受自动尝试取消续费，以订单 `willRenew` 和续费结果为准。

### CDK 生成前选区：先查询，再生成

**第一步：查询当前可选地区。**

```http
GET /api/v1/gpt-direct/plans
X-App-Id: YOUR_APP_ID
X-App-Secret: YOUR_APP_SECRET
```

响应示例（国家及币种以实时返回值为准）：

```json
{"code":0,"data":{"cdkRegionSelectionEnabled":true,"checkoutCountries":[{"country":"US","currency":"USD"},{"country":"PH","currency":"PHP"}]}}
```

**第二步：在客户端从 `checkoutCountries` 选择国家。** 国家值是 `country`，币种由服务端绑定。选区适用于 GPT CDK；TG/X CDK 不发送此字段。查询地区需要 `gpt:read` 权限，生成需要 `cdk:purchase` 和 IP 白名单。

**第三步：在生成请求中传入 `paymentCountry`。**

仅在 `cdkRegionSelectionEnabled=true` 时从 `checkoutCountries` 选择并传 `paymentCountry`；false或旧服务缺少该能力字段时省略地区参数，保持旧接口行为。示例：

```http
POST /api/v1/gpt-direct/cdks/generate
X-App-Id: YOUR_APP_ID
X-App-Secret: YOUR_APP_SECRET
Idempotency-Key: YOUR_PERSISTED_REQUEST_KEY
Content-Type: application/json
```
```json
{"plan":"plus","quantity":2,"forceNewCard":true,"paymentCountry":"US"}
```

`US` 仅为示例，必须在当前开放列表内。响应的 `data.checkoutRegion` 是实际固定的国家及币种。

## 1. 快速开始

### 环境与版本

- API 基础路径：`https://<你的站点>/api/v1`
- OpenAPI：`GET /api/v1/openapi.json`，不需要 API key
- 当前 API 版本：`v1`
- 当前事件载荷版本：`2026-08-01`
- 请求和响应编码：UTF-8 JSON
- 时间：服务返回数据库时间字符串；Webhook `createdAt` 为带时区时间

在账户的「开发者」页面创建 API key。App Secret 和独立 Webhook Secret 都只展示一次：

```bash
export AVANFINITY_BASE_URL='https://<你的站点>/api/v1'
export AVANFINITY_APP_ID='<保存在服务端密钥库的 App ID>'
export AVANFINITY_APP_SECRET='<保存在服务端密钥库的 App Secret>'

curl --fail-with-body \
  -H "X-App-Id: ${AVANFINITY_APP_ID}" \
  -H "X-App-Secret: ${AVANFINITY_APP_SECRET}" \
  "${AVANFINITY_BASE_URL}/products"
```

同步完成或已进入终态的成功响应通常使用：

```json
{ "code": 0, "data": {} }
```

卡片资金写入在外部结果暂时未知时会返回 `202 PendingOperationResponse`，其字段位于响应顶层；OpenAI 下单的 `202` 仍使用 `{ "code": 0, "data": GptOrder }`。调用方必须按各接口的 OpenAPI 响应 schema 解析，不能把所有 `2xx` 强制当成同一种包装。

失败响应统一使用：

```json
{
  "error": "脱敏的人类可读信息",
  "errorCode": "RECENT_AUTH_REQUIRED"
}
```

`errorCode` 是可选的稳定机器码；不是所有错误都会返回。程序应先按 HTTP 状态码分支，存在 `errorCode` 时再细分，并容忍未知码值。`error` 仅供人阅读，文案可能调整。

## 2. 鉴权、scope 与 IP 白名单

每个 API 请求都必须同时发送：

```http
X-App-Id: <App ID>
X-App-Secret: <App Secret>
```

`X-App-Id` 格式为 `app_` 加 32 位十六进制字符；`X-App-Secret` 格式为 `sk_` 加 64 位十六进制字符。不要在浏览器、移动端、URL、异常信息或日志中使用 Secret。

密钥默认仅有 `products:read`。按最小权限配置以下 13 个 scope：

| scope | 能力 | 来源 IP 白名单 |
| --- | --- | --- |
| `products:read` | 产品和客户价 | 不强制 |
| `account:read` | 钱包余额、账本 | 不强制 |
| `cards:read` | 卡列表、详情、本地交易与充值快照 | 不强制 |
| `cards:sensitive` | 完整卡号、安全码、有效期 | **强制** |
| `cards:manage` | 退款、冻结、解冻、删除 | **强制** |
| `cards:open` | 开卡 | **强制** |
| `cards:recharge` | 卡充值 | **强制** |
| `deposits:create` | 创建和取消钱包充值订单 | **强制** |
| `gpt:read` | OpenAI 套餐和订单 | 不强制 |
| `gpt:write` | OpenAI 预检、下单、取消 | **强制** |
| `cdk:read` | CDK 报价和已购列表 | 不强制 |
| `cdk:purchase` | 生成 CDK（保留的 scope 名） | **强制** |
| `operations:read` | 查询当前 key 创建的资金操作 | 不强制 |

白名单接受单个 IPv4/IPv6 地址或受限 CIDR：IPv4 前缀只允许 `/24`–`/32`，IPv6 只允许 `/64`–`/128`。不带前缀的单个地址分别按 `/32` 和 `/128` 处理。多项以逗号或空白分隔，例如 `198.51.100.20/32,2001:db8::10/128`。更宽网段会被拒绝。包含任一高风险 scope 的 key 必须配置非空白名单。代理部署时，平台只应信任受控反向代理提供的真实源地址头；客户端自行伪造的地址头不构成授权。

禁用或删除 key 会立即阻止 API 请求；待投递 Webhook 也会取消。“删除”是不可恢复的软删除：Secret 同时作废，密钥不再出现在控制台，但资金操作和 Webhook 审计历史会保留原 key 所有权。新建 key 不会继承已删除 key 的操作查询或幂等重放权限。轮换前应先等待关键操作进入终态并完成对账。

控制台创建 key、删除 key，以及修改状态、IP 白名单、Webhook URL、scope 或限流额度时，要求当前会话在最近 **5 分钟**内完成登录认证。未登录或会话失效返回 `401` 和可选 `errorCode: "AUTH_REQUIRED"`；登录时间超过 5 分钟返回 `403` 和 `errorCode: "RECENT_AUTH_REQUIRED"`。重新登录后再提交，不要通过自动重试绕过该门禁。

控制台会话管理接口的密钥返回规则（不属于下方 29 个服务端 API）：

- `POST /api/developer/keys` 创建成功时，`data` 同时返回 `appSecret` 和 `webhookSecret`；`webhookSecret` 格式为 `whsec_` 加 64 位小写十六进制字符。两者都只返回这一次，列表和后续查询绝不返回。
- `PATCH /api/developer/keys` 传入 `{ "id": <keyId>, "rotateWebhookSecret": true }` 可轮换 Webhook Secret；该操作也要求最近 5 分钟内登录，成功响应只在本次 `data.webhookSecret` 返回新值。
- 轮换事务提交后，尚未开始及后续重试的事件统一使用新值。已通过发送前检查的在途 HTTP 请求无法被撤回，仍可能在最长 10 秒的请求超时内使用旧 Secret 到达；其迟到响应不会被平台记为投递成功。计划轮换时，接收端可将旧 Secret 额外保留 15 秒用于双验签；紧急泄露处置应立即拒绝旧 Secret，并容忍在途事件随后按新 Secret 重试。禁用或删除 key 会取消尚未开始和平台侧仍在处理的任务。

App Secret 只用于 API 鉴权，Webhook Secret 只用于验签；应在服务端密钥库分开保存，不得从其中一个推导另一个。

## 3. 通用协议

### 请求 ID

平台为已通过鉴权并被接受处理的请求返回：

```http
X-Request-Id: <UUID>
```

调用方应把它和自己的业务订单号一起记录。不得记录 Secret、完整卡信息、OpenAI 凭据、预检令牌或完整 CDK。

### 限流

每个 key 有独立的分钟和 UTC 日固定窗口配额。控制台可配置：分钟 `1–10000`，日配额必须不小于分钟配额且不超过 `1000000`。超限返回 `429`；当前所有 `/api/v1` 的 `429` 响应都带 `Retry-After: 60`。OpenAI 预检和下单还有更严格的账户级分钟限制。

收到 `429` 后等待 `Retry-After`，加入随机抖动再重试。资金写请求必须复用原 `Idempotency-Key`。

### 金额、费率与最小货币单位

- 钱包、卡、手续费字段使用十进制字符串，例如 `"10.00"`。
- 不要用 JavaScript `number` 或二进制浮点进行资金计算；使用十进制定点库或整数最小单位。
- `rechargeRate` 是比例字符串：`"0.010000"` 表示 1%，不是 0.01 美元。
- `*Minor` 字段是整数最小货币单位；结合接口返回的币种和 `minorUnitExponent` 解释。
- 输入金额最多四位小数；最终可接受范围还受产品、余额和业务状态约束。

### 分页

分页接口接受 `page` 和 `page_size`：

| 参数 | 默认 | 范围 |
| --- | ---: | ---: |
| `page` | 1 | 1–100000 |
| `page_size` | 通常 20；交易列表 50 | 1–100 |

服务会把超范围值限制到合法范围。响应 `data.total` 是过滤后的总记录数，`data.list` 是当前页。

### 幂等与 202

所有卡资金写入、钱包充值订单创建、OpenAI 下单和 CDK 生成必须发送 `Idempotency-Key`。长度 8–128，只能包含可打印 ASCII 且不能包含双引号。OpenAI 取消按订单 ID 天然幂等，不要求该请求头。

规则：

1. 一个业务动作生成一个 key，并永久绑定原始请求语义。
2. 网络超时、5xx 或 202 后，重试必须发送完全相同的请求和原 key。
3. 同一 key 配不同参数返回 `409`。
4. 卡资金接口返回 `202` 时，保存顶层 `operationId`，轮询 `GET /operations/{id}`。
5. `PENDING` 和 `RECONCILE_REQUIRED` 都不是成功终态；只有 `terminal=true` 才停止轮询。
6. `SUCCEEDED` 是成功；`FAILED` 是失败。不得因本地超时自行退款或重新扣款。
7. 操作状态和幂等重放均绑定创建它的 API key；同一账户的另一个 key 也会得到 `404`。原 key 被删除后历史归属仍保留，但没有其他 key 可以接管该操作。

### 报价确认与重新报价

开卡和卡片充值都必须先取得服务端报价，再把报价确认值原样提交：

1. 开卡：读取 `/products`，向客户展示 `openFee` 与初始充值手续费 `ceil(initAmount × rechargeRate, 4)`；分别提交为 `expectedOpenFee`、`expectedInitialRechargeFee`，并提交同一产品的 `openQuoteVersion`。
2. 卡片充值：先调用 `/cards/{id}/recharge-quote`，向客户展示 `amount`、`fee` 与 `totalDebit`，再将 `data.fee` 原样提交为 `expectedFee`。
3. 如写入返回 `409` 且 `errorCode: "PRICE_CHANGED"`，该请求不会创建资金操作、扣减钱包或发送卡渠道写入。开卡应重新读取 `/products`，充值应重新调用 `/cards/{id}/recharge-quote`；向客户展示并确认新价格后，使用新的 `Idempotency-Key` 提交。不得静默接受涨价或自动盲重试。

TypeScript 轮询示例（Node 18+，无额外 HTTP 依赖）：

```ts
import { randomUUID } from "node:crypto";

const baseUrl = process.env.AVANFINITY_BASE_URL!;
const auth = {
  "X-App-Id": process.env.AVANFINITY_APP_ID!,
  "X-App-Secret": process.env.AVANFINITY_APP_SECRET!,
};

async function json(path: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { ...auth, "Content-Type": "application/json", ...init.headers },
  });
  const body = await response.json();
  if (!response.ok && response.status !== 202) {
    throw new Error(`HTTP ${response.status}; request=${response.headers.get("x-request-id") ?? "-"}`);
  }
  return { status: response.status, body };
}

async function pollOperation(operationId: string, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  for (let delay = 500; Date.now() < deadline; delay = Math.min(delay * 2, 5_000)) {
    const { body } = await json(`/operations/${operationId}`);
    if (body.data.terminal) return body.data;
    await new Promise((resolve) => setTimeout(resolve, delay + Math.random() * 200));
  }
  throw new Error("operation polling timed out; keep the original idempotency key");
}

const products = await json("/products");
const product = products.body.data.find((item: { productCode: string }) => item.productCode === "PRODUCT_CODE");
if (!product) throw new Error("product is unavailable");

const units = (value: string, scale: number) => {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 10n ** BigInt(scale)
    + BigInt((fraction + "0".repeat(scale)).slice(0, scale));
};
const initAmount = "10.00";
const initialFeeUnits = (units(initAmount, 4) * units(product.rechargeRate, 6) + 999_999n) / 1_000_000n;
const expectedInitialRechargeFee = `${initialFeeUnits / 10_000n}.${String(initialFeeUnits % 10_000n).padStart(4, "0")}`;

const idempotencyKey = `order-${randomUUID()}`;
const result = await json("/cards/open", {
  method: "POST",
  headers: { "Idempotency-Key": idempotencyKey },
  body: JSON.stringify({
    productCode: product.productCode,
    firstName: "Ada",
    lastName: "Lovelace",
    initAmount,
    count: 1,
    expectedOpenFee: product.openFee,
    expectedInitialRechargeFee,
    openQuoteVersion: product.openQuoteVersion,
  }),
});
const finalResult = result.status === 202
  ? await pollOperation(result.body.operationId)
  : result.body.data;
console.log(finalResult);
```

## 4. 接口总览

| 方法 | 路径 | scope | IP | 幂等 |
| --- | --- | --- | --- | --- |
| GET | `/products` | `products:read` | — | — |
| GET | `/balance` | `account:read` | — | — |
| GET | `/balance-logs` | `account:read` | — | — |
| POST | `/deposits` | `deposits:create` | 必须 | 必须 |
| GET | `/deposits/{gatewayRef}` | `account:read` | — | — |
| POST | `/deposits/{gatewayRef}/cancel` | `deposits:create` | 必须 | — |
| GET | `/cards` | `cards:read` | — | — |
| GET | `/cards/all-transactions` | `cards:read` | — | — |
| GET | `/cards/{id}` | `cards:read` | — | — |
| GET | `/cards/{id}/sensitive` | `cards:sensitive` | 必须 | — |
| GET | `/cards/{id}/transactions` | `cards:read` | — | — |
| GET | `/cards/{id}/recharges` | `cards:read` | — | — |
| POST | `/cards/open` | `cards:open` | 必须 | 必须 |
| POST | `/cards/{id}/recharge-quote` | `cards:recharge` | 必须 | — |
| POST | `/cards/{id}/recharge` | `cards:recharge` | 必须 | 必须 |
| POST | `/cards/{id}/refund` | `cards:manage` | 必须 | 必须 |
| POST | `/cards/{id}/freeze` | `cards:manage` | 必须 | 必须 |
| POST | `/cards/{id}/unfreeze` | `cards:manage` | 必须 | 必须 |
| DELETE | `/cards/{id}` | `cards:manage` | 必须 | 必须 |
| GET | `/gpt-direct/plans` | `gpt:read` | — | — |
| POST | `/gpt-direct/preflight` | `gpt:write` | 必须 | — |
| GET | `/gpt-direct/orders` | `gpt:read` | — | — |
| POST | `/gpt-direct/orders` | `gpt:write` | 必须 | 必须 |
| GET | `/gpt-direct/orders/{id}` | `gpt:read` | — | — |
| POST | `/gpt-direct/orders/{id}/cancel` | `gpt:write` | 必须 | 订单 ID |
| POST | `/gpt-direct/orders/{id}/cancel-renewal` | `gpt:write` | 必须 | — |
| GET | `/gpt-direct/cdks` | `cdk:read` | — | — |
| GET | `/gpt-direct/cdk-offers` | `cdk:read` | — | — |
| POST | `/gpt-direct/cdks/generate` | `cdk:purchase` | 必须 | 必须 |
| GET | `/operations/{id}` | `operations:read` | — | — |

机器可读 `operationId` 索引：

| operationId | 方法与路径 |
| --- | --- |
| `listProducts` | `GET /products` |
| `getBalance` | `GET /balance` |
| `listBalanceLogs` | `GET /balance-logs` |
| `createWalletDeposit` | `POST /deposits` |
| `getWalletDepositStatus` | `GET /deposits/{gatewayRef}` |
| `cancelWalletDeposit` | `POST /deposits/{gatewayRef}/cancel` |
| `listCards` | `GET /cards` |
| `listAllCardTransactions` | `GET /cards/all-transactions` |
| `getCard` | `GET /cards/{id}` |
| `deleteCard` | `DELETE /cards/{id}` |
| `getCardSensitive` | `GET /cards/{id}/sensitive` |
| `listCardTransactions` | `GET /cards/{id}/transactions` |
| `listCardRecharges` | `GET /cards/{id}/recharges` |
| `openCard` | `POST /cards/open` |
| `quoteCardRecharge` | `POST /cards/{id}/recharge-quote` |
| `rechargeCard` | `POST /cards/{id}/recharge` |
| `refundCard` | `POST /cards/{id}/refund` |
| `freezeCard` | `POST /cards/{id}/freeze` |
| `unfreezeCard` | `POST /cards/{id}/unfreeze` |
| `listOpenAIPlans` | `GET /gpt-direct/plans` |
| `preflightOpenAIAccount` | `POST /gpt-direct/preflight` |
| `listOpenAIOrders` | `GET /gpt-direct/orders` |
| `createOpenAIOrder` | `POST /gpt-direct/orders` |
| `getOpenAIOrder` | `GET /gpt-direct/orders/{id}` |
| `cancelOpenAIOrder` | `POST /gpt-direct/orders/{id}/cancel` |
| `cancelOpenAIRenewal` | `POST /gpt-direct/orders/{id}/cancel-renewal` |
| `listPurchasedCdks` | `GET /gpt-direct/cdks` |
| `listCdkOffers` | `GET /gpt-direct/cdk-offers` |
| `generateCdks` | `POST /gpt-direct/cdks/generate` |
| `getOperation` | `GET /operations/{id}` |

## 5. 产品、账户与钱包充值

### GET `/products`

无参数。返回当前账户实际可用的产品和最终客户价：

- `productCode`：开卡使用的产品编码。
- `openFee`：每张卡固定开卡费，不含初始充值本金和初始充值手续费。
- `openQuoteVersion`：当前开卡联合报价快照标识；必须和同次返回的 `openFee`、`rechargeRate` 一起使用。
- `rechargeRate`：所有卡充值的手续费比例，开卡时的首笔充值同样收费；正数费用向上取整到 4 位小数。
- `refundRate`：商户消费退款事件为 `Refund COMPLETE` 时按退款金额收取的费率，不适用于卡余额退回。
- `declineFee`：授权最终为 `DECLINED` 时按笔收取的当前客户固定拒付售价；它不等同于渠道账户级的实际拒付成本阶梯，后者由平台单独对账。
- `authorizationReversalRate`：`Reversal COMPLETE` 时按被撤销授权金额收取的费率。
- `authorizationFee`：授权最终成功进入 `Settlement COMPLETE` 或 `Reversal COMPLETE` 时按笔收取的授权费；最终拒付不收。
- `lowAuthorizationThreshold` / `lowAuthorizationFee`：两者非空时，金额严格低于阈值且最终未拒付的授权按笔收取专项费用。
- `lowAuthorizationStackMode`：专项低额授权费的叠加方式；`replace_platform_small_tx` 表示替代平台小额交易费，不重复收取。
- `smallTransactionFee` / `crossBorderFee`：渠道提供的小额交易费和跨境费。当前仅销售触发条件已被确认并可安全计费的产品；不得由调用方自行推测触发条件。
- `refundKeepMinimum`：卡余额退回后必须保留的最低余额；`0` 表示允许全额退回。该值会在开卡时随卡片冻结。
- `binNotes`：产品内按 BIN 绑定的使用提醒。规则必须按 `productCode` 使用，不得把同一 BIN 在不同产品间合并。
- `minAmount` / `maxAmount`：初始充值范围。
- `displayBin`：兼容字段；仅当产品只有一个明确卡头时返回该 6 位卡头，多个或未知时返回 `null`。
- `displayBins`：卡服务明确返回的全部 6 位卡头字符串，按返回顺序去重；未知时返回空数组。仅供卡面展示，不得用于付款、路由或业务校验。
- `network`、`issuer`、`issuingArea`、`cardType`：卡组织和发行信息。
- `restrictedMerchants`、`googleChatgptBlocked`、`description`、`category`：使用限制和场景说明。

成功：`200 data: Product[]`。产品同步尚未完成、成本超过十分钟或最近一次产品同步失败时返回 `503`，不会用 `200 []` 伪装为“没有产品”。其它错误：`401` 凭据、`403` 账户/scope、`429` 限流、`500` 平台错误。

### GET `/balance`

无参数。`200 data`：

```json
{
  "balance": "80.00",
  "totalBalance": "100.00",
  "riskLockedBalance": "20.00",
  "paymentRisk": {
    "enabled": true,
    "windowDays": 30,
    "minAttempts": 100,
    "lockThresholdBps": 3000,
    "releaseThresholdBps": 2000,
    "reserveBps": 2000,
    "attempts": 120,
    "successes": 82,
    "declines": 38,
    "successRateBps": 6833,
    "declineRateBps": 3167,
    "reserveActive": true,
    "evaluatedAt": "2026-08-17T10:00:00Z"
  },
  "promoBalance": "0",
  "cumulativeDeposit": "100.00",
  "cumulativeSpend": "20.00"
}
```

`balance` 继续表示可用钱包余额，兼容现有调用方；`totalBalance` 是包含锁定部分的钱包总余额，`riskLockedBalance` 是自动拒付率比例策略或既有账户级风险冻结造成的全部不可用余额，恒满足 `balance + riskLockedBalance = totalBalance`。`paymentRisk.reserveActive` 只表示自动比例策略是否生效；账户被其它风险规则完全冻结时它可以为 `false`。锁定或释放只改变可用切片，不生成充值、消费或调账流水。

`paymentRisk` 按最近 `windowDays` 天、跨该客户全部卡和全部商户的授权身份 `(渠道, auth_id)` 折叠统计。存在 `Settlement COMPLETE` 的授权始终计成功；否则在 `Authorization DECLINED` 与 `Reversal COMPLETE` 中以最先记录的终态为准，前者计拒绝、后者排除。退款、未决和未知状态不进入分母。比率单位为基点（`10000 = 100%`）；没有权威样本时两个比率均为 `null`，不得当作 `0%`。达到 `minAttempts` 且拒绝率达到 `lockThresholdBps` 时按 `reserveBps` 锁定余额；锁定生效后的绝对锁额只会在余额补足时增加，下调 `reserveBps` 不会释放已有锁额，只有策略停用或拒绝率低于 `releaseThresholdBps` 时才释放。推广余额独立展示。错误：`401`、`403`、`429`、`503`、`500`。

### GET `/balance-logs`

查询参数：`page`、`page_size`。`200 data` 为 `{ total, list }`；每条记录包含：

`id`、`type`、`amount`、`balanceBefore`、`balanceAfter`、可空 `remark`、`createdAt`。

这是平台本地账本，应使用 `balanceBefore + amount = balanceAfter` 做核对。错误：`401`、`403`、`429`、`503`、`500`。

### POST `/deposits`

operationId：`createWalletDeposit`。scope：`deposits:create`；必须配置调用服务器的 IP/CIDR 白名单，并为每个客户充值意图发送稳定的幂等键：

```http
Idempotency-Key: wallet-deposit-order-001
Content-Type: application/json
```

```json
{
  "currency": "USDT",
  "network": "TRON",
  "amount": "10.00"
}
```

- `currency` 当前固定为 `USDT`；`network` 只能是 `TRON`、`BSC` 或 `SOL`。
- `amount` 是字符串，范围 `10.00`–`1000000.00`，最多两位小数；不得发送 JSON 数字、浮点数或科学计数法。
- 订单 15 分钟有效。TRON/BSC 向 `address` 转账；SOL 必须把 SPL USDT 转入非空的 `tokenAccount`，`address` 仅是其 owner 地址。无论哪条网络，都必须转入响应中的**精确 `expectedAmount`**；它是为防止同金额订单混淆而生成的唯一应付金额，不能只转 `requestedAmount`。
- 不接受 `callbackUrl`、`notifyUrl` 或其他单次回调地址。回调地址只能预先在开发者控制台配置，并经过平台的 HTTPS/SSRF 安全校验。
- 同一 API key 下，同一 `Idempotency-Key` 与规范化请求参数永久绑定。网络超时时原样重放；参数不同返回 `409`，不得更换幂等键猜测结果。

新建订单返回 `201`；同幂等请求安全重放返回 `200` 且 `reused=true`，两者的 `data` 形状相同：

```json
{
  "gatewayRef": "018f6d10-7c1a-4b2c-9d3e-a4f5b6c7d8e9",
  "address": "TExampleReceivingAddress",
  "currency": "USDT",
  "network": "TRON",
  "tokenAccount": null,
  "requestedAmount": "10.00",
  "expectedAmount": "10.034550",
  "creditedEstimate": "10.034550",
  "createdAt": "2026-08-01T10:00:00Z",
  "expiredAt": "2026-08-01T10:15:00Z",
  "cancellable": true,
  "reused": false
}
```

`gatewayRef` 是对外唯一订单号，必须与调用方本地订单持久化绑定。`tokenAccount` 仅 SOL 订单非空，且是 SOL 上的实际 SPL USDT 收款目标。`creditedEstimate` 是当前规则下的预估；实际到账以查询接口在 `confirmed` 状态返回的 `creditedAmount` 为准。错误：`400` 请求/金额/幂等键无效、`401`、`403` scope/IP、`409` 幂等或订单冲突、`413`、`415`、`429`、`503` 链路未就绪、`500`。

### GET `/deposits/{gatewayRef}`

operationId：`getWalletDepositStatus`。scope：`account:read`；不强制 IP 白名单。只能查询当前 API 账户所属的订单，未知或跨账户 `gatewayRef` 统一返回 `404`。成功 `200 data`：

```json
{
  "gatewayRef": "018f6d10-7c1a-4b2c-9d3e-a4f5b6c7d8e9",
  "address": "TExampleReceivingAddress",
  "currency": "USDT",
  "network": "TRON",
  "tokenAccount": null,
  "requestedAmount": "10.00",
  "expectedAmount": "10.034550",
  "creditedEstimate": "10.034550",
  "actualAmount": "10.034550",
  "creditedAmount": "10.034550",
  "fee": "0.000000",
  "txHash": "2f4d8c6a",
  "status": "confirmed",
  "createdAt": "2026-08-01T10:00:00Z",
  "expiredAt": "2026-08-01T10:15:00Z",
  "confirmedAt": "2026-08-01T10:03:00Z",
  "cancelledAt": null,
  "cancellable": false
}
```

`status` 只有 `pending`、`expired`、`confirmed`、`failed`、`cancelled`；**只有 `confirmed` 表示链上付款已确认且钱包已入账**。其他状态不得记账。`expired` 只表示支付时间窗已过，迟到的有效链上转账仍可使订单转为 `confirmed`；`cancelled` 表示客户已成功取消未付款订单，是不可变终态，后续转账不会再匹配该订单或自动入账。`cancelledAt` 是可空的取消时间，非空即表示已进入该终态；`cancellable` 为真实时可取消判定。Webhook 用于低延迟通知；本查询接口是订单状态的最终事实来源。错误：`400` 订单号格式、`401`、`403`、`404`、`429`、`503`、`500`。

### POST `/deposits/{gatewayRef}/cancel`

operationId：`cancelWalletDeposit`。scope：`deposits:create`；必须通过 IP/CIDR 白名单。无请求体，也不发送 `Idempotency-Key`：`gatewayRef` 本身就是幂等资源键。只有创建它的同一 API key 可取消；未知、跨账户或由其他 key 创建的订单统一返回 `404`。

只应在查询结果 `status=pending` 且 `cancellable=true`、并确认尚未发起链上转账时调用。成功返回 `200 data`：

```json
{
  "gatewayRef": "018f6d10-7c1a-4b2c-9d3e-a4f5b6c7d8e9",
  "status": "cancelled",
  "cancelledAt": "2026-08-01T10:04:00Z",
  "replayed": false
}
```

重复取消不会重复执行，固定返回 `status=cancelled`、相同 `cancelledAt` 且 `replayed=true`。成功返回 `200` 后，该 `gatewayRef` 已进入不可变终态，迟到或之后发送的转账都不会再匹配该订单或自动入账。如链上确认在取消竞态中先完成，取消返回 `409`，不会先返回取消成功再把订单改为 `confirmed`。取消后如需修改金额或网络，必须使用新的 `Idempotency-Key` 创建新订单；原订单的精确金额绝不复用。错误：`400` 订单号格式、`401`、`403` scope/IP、`404`、`409` 订单过期、已确认、已失败或已检测到资金、`429`、`503`、`500`。

### POST `/deposits/{gatewayRef}/cancel`

无请求体，不要求 `Idempotency-Key`。scope 为 `deposits:create`，必须配置调用服务器的 IP/CIDR 白名单。只可取消当前 API 账户名下仍可取消的充值订单；未知或跨账户 `gatewayRef` 统一返回 `404`。成功返回当前充值订单的 `DepositResponse`。错误：`400`、`401`、`403`、`404`、`409` 订单已不可取消、`429`、`503`、`500`。

## 6. 卡片查询

余额/状态查询不因挂起充值、退款或销卡而停止同步。`status` 会反映上游确认的关闭状态；`upstreamStatus` 是可空上游状态，`accountingStatus` 是本站尚在核验的财务状态。`balance` / `availableAmount` 使用已验证的上游可用余额，不表示原资金请求已完成。上游已关闭但财务未结束的卡仍可能出现在列表中，必须同时检查 `pendingOperationId`，不得仅凭余额变化自行记退款到账。

已关闭卡同样支持列表、详情、消费及充值历史读取，不再被 OpenAPI 隐藏；归属及 `cards:read` 权限校验不变。敏感卡资料和资金操作仍按各自权限与状态限制。

商户待清算授权不阻止充值；退款、销卡可能返回 `409 CARD_TRANSACTIONS_UNSETTLED`，应提示清算后重试。本站原资金请求结果未知时，必须查询原请求，不能换幂等键重发同一意图。

### GET `/cards`

查询参数：`page`、`page_size`。返回 `{ total, page, pageSize, list }`，只含当前账户未删除的卡片；单页最多 100 条。列表字段：

`id`、`cardNumberMasked`、`productCode`、`network`、`issuingArea`、`status`、`balance`、`refundKeepMinimum`、`firstName`、`lastName`、`createdAt`。`id` 是稳定的本站卡片标识；内部渠道引用不会对外暴露。`refundKeepMinimum` 是该卡开卡时冻结的余额退回下限。

错误：`401`、`403`、`429`、`503`、`500`。

### GET `/cards/{id}`

`id` 是本站开卡响应中的卡片 ID，不是卡号。返回脱敏详情：

`id`、`cardNumberMasked`、`status`、`network`、`issuingArea`、`issuer`、`availableAmount`、`firstName`、`lastName`、`note`、`productCode`、`expiry`、`createdAt`，以及 `refundRate`、`declineFee`、`authorizationReversalRate`、`authorizationFee`、`smallTransactionFee`、`crossBorderFee`、`lowAuthorizationThreshold`、`lowAuthorizationFee`、`lowAuthorizationStackMode`、`refundKeepMinimum`。授权类产品成本规则和余额退回下限在开卡时冻结；`declineFee` 还会取当前会员拒付费与成本快照中的较高值，`refundRate` 仍按当前有效且不低于开卡成本快照的消费退款定价返回。

错误：`401`、`403`、`404`（不存在或不属于当前账户）、`429`、`503`、`500`。

### GET `/cards/{id}/sensitive`

返回 `cardNumber`、`cvv`、`expire`，并带：

```http
Cache-Control: no-store
```

此调用被审计。调用方必须：仅在服务端按需读取；不缓存响应；不把完整卡号或安全码写入数据库、APM、日志、报错、分析平台或客户端持久化；按适用的支付卡安全要求处理。错误：`401`、`403`、`404`、`429`、`502`、`503`、`500`。

### GET `/cards/all-transactions`

查询参数：

| 参数 | 说明 |
| --- | --- |
| `page` / `page_size` | 分页 |
| `card_id` | 可选本站卡片 ID |
| `source` | 当前只能是 `db` |
| `status` | `PENDING`、`COMPLETE`、`DECLINED` |
| `type` | `Authorization`、`Settlement`、`Refund`、`Reversal` |
| `q` | 最长 200，匹配商户名或授权 ID |

返回 `{ total, list, source: "db" }`。交易字段包括授权/结算金额和币种、商户信息、失败原因、账单状态、授权时间、来源交易时间 `sourceCreatedAt`、本地 `createdAt` 和脱敏卡号。可空字段会返回 `null`。错误：`400` 状态/类型/ID/搜索条件无效、`401`、`403` scope 不足或请求非本地数据源、`429`、`503`、`500`。

### GET `/cards/{id}/transactions`

查询参数仅 `page`、`page_size`。响应结构与全部交易相同，固定过滤当前卡；数据来自本地数据库。错误：`401`、`403`、`404`、`429`、`503`、`500`。

### GET `/cards/{id}/recharges`

查询参数：`page`、`page_size`。返回 `{ total, list, source: "db" }`；每条包含 `id`、`amount`、`fee`、`status`、`createdAt`、`syncedAt`。错误：`401`、`403`、`404`、`429`、`503`、`500`。

## 7. 卡片资金与状态操作

### POST `/cards/open`

```http
Idempotency-Key: <调用方生成的唯一键>
Content-Type: application/json
```

```json
{
  "productCode": "PRODUCT_CODE",
  "firstName": "Ada",
  "lastName": "Lovelace",
  "initAmount": "10.00",
  "count": 1,
  "expectedOpenFee": "1.50",
  "expectedInitialRechargeFee": "0.10",
  "openQuoteVersion": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
}
```

约束：`productCode` 最长 32；姓名 1–64；`count` **只能为 1**；`initAmount` 在产品实时范围内。总扣款为 `initAmount + expectedOpenFee + expectedInitialRechargeFee`。`expectedOpenFee` 必须来自 `GET /products`；`expectedInitialRechargeFee` 必须由同次响应的 `rechargeRate` 精确计算，正数向上取整到 4 位小数；`openQuoteVersion` 必须来自同一次响应。任一报价字段变化都会返回 `409 / PRICE_CHANGED`，不会扣款。成功 `200 data`：

```json
{
  "operationId": "018f6d10-7c1a-4b2c-9d3e-a4f5b6c7d8e9",
  "cardIds": [123],
  "balance": "78.20",
  "replayed": false
}
```

错误：`400` 输入/幂等键、`401`、`403`、`404` 产品、`409` 幂等/状态或 `PRICE_CHANGED`、`422` 余额、`429`、`502`、`503`、`500`；未知结果为 `202`。

### POST `/cards/{id}/recharge-quote`

先获取当前卡片充值报价；该请求不需要 `Idempotency-Key`，不会创建资金操作或扣款。

```json
{ "amount": "10.00" }
```

成功 `200 data`：

```json
{
  "amount": "10.00",
  "fee": "0.10",
  "totalDebit": "10.10",
  "effectiveRechargeRate": "0.010000"
}
```

`fee` 是后续充值请求必须原样提交的确认值；`totalDebit = amount + fee`。错误：`400`、`401`、`403`、`404`、`422`、`429`、`502`、`503`、`500`。

### POST `/cards/{id}/recharge`

```http
Idempotency-Key: <调用方生成的唯一键>
Content-Type: application/json
```

```json
{ "amount": "10.00", "expectedFee": "0.10" }
```

钱包扣除本金和手续费。`expectedFee` 必须是相同 `amount` 的最新 `/cards/{id}/recharge-quote` 响应中的 `data.fee`。成功 `200 data`：`operationId`、`status`、`cardBalance`、`walletBalance`、`fee`、`replayed`。错误：`400`、`401`、`403`、`404`、`409` 幂等/状态或 `PRICE_CHANGED`、`422`、`429`、`502`、`503`、`500`；未知结果为 `202`。

### POST `/cards/{id}/refund`

请求体：`{ "amount": "..." }`，退款不使用 `expectedFee`。本金从卡余额退回本站钱包；退回后卡内余额不得低于该卡的 `refundKeepMinimum` 快照，值为 `0` 时允许全额退回。本接口当前不收手续费，只按发卡通道明确确认的实际退回金额入账。它不同于商户消费退款事件及其风险费用。响应字段同卡操作。错误：`400`、`401`、`403`、`404`、`409`、`422`、`429`、`502`、`503`、`500`；未知结果为 `202`。

退款前会同步上游最新可用余额，消费扣款及预授权占用会减少可退金额。提交金额超过最新可退余额时返回 `409 / REFUND_BALANCE_CHANGED`；此次未提交上游退款，应重新读取卡片详情，刷新展示并按最新可退金额使用新幂等键重新确认。无法同步余额时返回 `503 / REFUND_BALANCE_UNAVAILABLE`，同样未提交上游退款；原操作保持可安全重试，请稍后复用原幂等键重试。

若预检后上游明确返回 `insufficient_balance`，原申请结束为失败并释放本站卡片占用，返回 `409 / REFUND_BALANCE_REJECTED`。客户端应刷新卡片余额，清空旧金额和原申请意图，待用户重新确认后使用新幂等键申请；不自动缩减金额或重新退款。普通业务错误、网络超时及历史 `UNKNOWN` 请求不属于明确拒绝，不因余额不足推测而释放占用。

### POST `/cards/{id}/freeze`

无请求体。必须带幂等键。成功响应字段同卡操作。错误：`400`、`401`、`403`、`404`、`409`、`429`、`502`、`503`、`500`；未知结果为 `202`。

### POST `/cards/{id}/unfreeze`

无请求体。必须带幂等键。成功响应字段同卡操作。错误：`400`、`401`、`403`、`404`、`409`、`429`、`502`、`503`、`500`；未知结果为 `202`。

### DELETE `/cards/{id}`

无请求体。必须带幂等键。删除成功后仍可查询该用户的卡片状态与历史，资金操作和敏感资料继续受状态限制。响应字段同卡操作。错误：`400`、`401`、`403`、`404`、`409`、`429`、`502`、`503`、`500`；未知结果为 `202`。

### GET `/operations/{id}`

只查询当前 API key 创建的操作。`200 data`：

```json
{
  "operationId": "018f6d10-7c1a-4b2c-9d3e-a4f5b6c7d8e9",
  "type": "RECHARGE",
  "status": "SUCCEEDED",
  "terminal": true,
  "dispatchState": "CONFIRMED",
  "result": {},
  "error": null,
  "updatedAt": "2026-08-01 10:00:00+00"
}
```

`type` 可能为 `OPEN_CARD`、`RECHARGE`、`REFUND`、`FREEZE`、`UNFREEZE`、`DELETE`、`GPT_DIRECT`、`GPT_CDK`。`dispatchState` 仅供诊断，业务逻辑只使用 `status` 与 `terminal`。错误：`401`、`403`、`404`、`429`、`503`、`500`。

## 8. OpenAI 直充

本节与 OpenAPI `2026-09-06` 对齐。OpenAI 凭据是最高敏感信息，只能通过 TLS 提交；禁止写入业务日志、工单、错误追踪、分析系统或明文数据库。协议服务在订单执行及有期限的恢复窗口内加密保存完整 Session，用于原订单恢复，不在订单查询中回显。

支持的 `credential` 形状：

```json
{ "mode": "session", "session": "<完整会话 JSON>" }
```

Session JSON 必须同时包含 `sessionToken` 和 `accessToken`。不支持独立 `mode=access_token`（返回 `GPT_ACCESS_TOKEN_UNSUPPORTED`）。有效 accessToken 可先用于账号核验，收到认证拒绝才进入刷新；JWT/Session 中的到期时间不代表上游一定接受该凭据。

```json
{ "mode": "mailbox", "email": "<邮箱>", "password": "<密码>" }
```

邮箱登录仅适用于服务已启用的预检入口；补交 Session 接口只接受完整 Session。不要把任一真实凭据复制到工单或聊天中。

### GET `/gpt-direct/plans`

返回 `data.version` 和 `data.plans[]`。当前套餐键为 `go`、`plus`、`pro_5x`、`pro_20x`、`pro_25x`；套餐字段：`key`、`label`、`currency`、`enabled`、`serviceFeeUsdMinor`、`customerServiceFee`、可空的 `expectedAmountMinor`、`minAmountMinor`、`maxAmountMinor`。

创建订单时必须原样回传 `version` 与 `customerServiceFee`，防止报价变化。错误：`401`、`403`、`429`、`502`、`503`、`500`。

### POST `/gpt-direct/preflight`

```json
{
  "credential": { "mode": "session", "session": "<完整会话 JSON>" },
  "paymentCountry": "PH",
  "paymentCurrency": "PHP"
}
```

`paymentCountry` 是可选两位大写国家码，`paymentCurrency` 是可选三位大写币种。完整 Session JSON 的 UTF-8 上限为 65536 字节（64 KiB）；access_token 上限仍为 32768 字节。返回：脱敏 `email`、`currentPlan`、`credentialMode`、短期 `preflightToken`、`preflightExpiresAt`、实际国家/币种、`quotes`、`quoteError`，并带 `Cache-Control: no-store`。

预检每账户每分钟最多 10 次。错误：`400` 凭据/地区、`401`、`403`、`429`、`502`、`503`、`500`。

### POST `/gpt-direct/orders`

```json
{
  "cardId": 123,
  "plan": "plus",
  "credential": { "mode": "session", "session": "<与预检相同的完整会话 JSON>" },
  "preflightToken": "<预检返回的短期令牌>",
  "clientRequestId": "merchant-order-001",
  "pricingVersion": 1,
  "expectedCustomerServiceFee": "1.00"
}
```

`cardId>0` 必须属于当前账户且状态为 `ACTIVE`；`cardId=0` 时必须且只能传 `externalCard` 或 `autoCard`，详见 OpenAPI `GptExternalCard` / `GptAutoCard`。`plan` 为 `go`、`plus`、`pro_5x` 或 `pro_20x`；`clientRequestId` 最长 80，只能含字母、数字、`_ . : -`。每账户每分钟最多 5 次新下单。

自动开卡需传 `productCode`、`initAmount`、`expectedOpenFee`、`expectedInitialRechargeFee`、`openQuoteVersion`、`quoteCountry`、`quoteCurrency`、`quotedAmountUsd`。金额和版本必须来自当前预检及开卡报价；`initAmount` 至少为对应套餐美元估算加 3 美元并向上保留两位。可选 `reuseExisting` 默认 false；启用时 `excludedCardIds` 最多 8 个不重复的正整数，否则该列表须为空。报价变更须重新询价，不得硬编码价格。

正常受理返回 `202 { code: 0, data: GptOrder }`，不是失败。使用 `GET /gpt-direct/orders/{id}` 或 Webhook 获取进度。错误：`400`、`401`、`403`、`404`、`409` 报价/幂等/卡忙、`422` 钱包余额、`429`、`502`、`503`、`500`。

### GET `/gpt-direct/orders`

查询参数：`page`、`page_size`、`q`。`q` 为本人订单邮箱的大小写不敏感子串，去首尾空格后最多 320 字节，不允许控制字符；不会搜索其他客户订单。返回 `{ total, list }`。每个订单包含：

`id`、`clientRequestId`、`plan`、`status`、`stage`、本人订单 `email`（可空）及 `maskedEmail`、`cardNumberMasked`、`pricingVersion`、金额最小单位字段、`currency`、`customerServiceFee`、服务费与资金状态、`operationStatus`、创建/更新时间、可空完成时间，以及可空 `invoiceUrl` 和多阶段 `invoiceUrls`。另有 `cardId`、`autoOpenedCard`、`willRenew`、`needsRenewalCancel`、实际流程 `progress`、`publicCode`、`nextAction`、`recoveryMessage`。列表和详情使用同一快照，关闭抽屉后仍须按最新快照更新进度。

#### 明确的用户下一步

客户端应按 `nextAction` 展示入口，以 `recoveryMessage` 展示解释；不得解析中文文案决定是否支付。

| nextAction | 用户操作 |
| --- | --- |
| `none` | 已完成，无需恢复 |
| `wait` | 继续查询；不要重复下单 |
| `submit_session` | 在原订单补交原账号的新完整 Session；禁止新订单 |
| `refresh_session_and_reorder` | 旧订单已结束且平台资金处理完成，重新登录获取 Session，再预检下单 |
| `change_card_and_reorder` | 旧订单已结束且平台资金处理完成，核对卡资料、银行验证/余额，联系发卡方或换卡后再预检 |
| `retry_preflight` | 旧订单已结束且平台资金处理完成，稍后重新预检；持续失败联系客服 |
| `resolve_account` | 先处理账号风控、逾期订阅或原有账单，再预检 |
| `contact_support` 或未知值 | 提供订单号联系客服，不自动重试支付 |

`upgrade_card_declined` 表示上游明确拒绝绑定卡；`upgrade_card_authentication_required` 表示需要持卡人验证；`upgrade_risk_rejected` 仅在上游明确返回风控时使用，可能涉及账号或支付环境。未知绑卡错误不推断为风控或余额不足。`GPT_SESSION_REAUTH_REQUIRED` 应重新登录获取凭据。支付边界后的任何失败（包括 Plus 已付款但 Pro 绑卡失败）均不得仅凭错误码重新下单。`COMPENSATED` 表示平台资金处理完成，不代表银行临时绑卡预授权已撤销。

新建订单请求超时：先按原订单查询，或用相同 `Idempotency-Key`、`clientRequestId` 和相同请求体重放。禁止为同一支付意图生成新键重下。GET 查询可采用退避及抖动，尊重 `429` / `Retry-After`；服务异常应保留最后状态并提示数据暂未同步，不得推断失败退款。

#### 订单状态与终态判定

| `order.status` | 中文含义 | 是否终态 | 调用方应如何处理 |
| --- | --- | --- | --- |
| `ready` | 本站订单已创建，尚未完成派发 | 否 | 保持处理中并继续查询 |
| `queued` | 已进入处理队列 | 否 | 保持处理中并继续查询 |
| `running` | 正在执行充值流程 | 否 | 保持处理中并继续查询 |
| `awaiting_card` | 正在选择或准备支付卡 | 否 | 保持处理中并继续查询 |
| `funding_pending` | 支付卡资金准备中 | 否 | 保持处理中并继续查询 |
| `pending` | 支付已经提交，正在等待结果确认 | 否 | 不得提前判定成功或失败，继续查询 |
| `requires_action` | 需要进一步操作或人工处理 | 否 | 根据订单事件中的公开提示处理，并继续查询 |
| `cancel_requested` | 取消请求已受理，正在等待取消结果 | 否 | 不得当作已取消，继续查询到终态 |
| `completed` | 充值成功 | 是 | 还要确认 `operationStatus=SUCCEEDED` 才能按成功结算 |
| `declined` | 支付被拒绝 | 是 | 还要确认 `operationStatus=COMPENSATED` 才表示退款或资金释放完成 |
| `failed_precharge` | 扣款前失败，未发起扣款 | 是 | 还要确认 `operationStatus=COMPENSATED` 才表示退款或资金释放完成 |
| `cancelled` | 取消已经确认 | 是 | 还要确认 `operationStatus=COMPENSATED` 才表示退款或资金释放完成 |

`order.status` 是业务状态，`operationStatus` 是平台资金操作状态。调用方只有在以下组合出现时，才应关闭本地订单并执行最终结算：

- 成功：`order.status=completed` 且 `operationStatus=SUCCEEDED`。
- 失败或取消：`order.status` 为 `declined`、`failed_precharge` 或 `cancelled`，且 `operationStatus=COMPENSATED`。
- `operationStatus=RECONCILE_REQUIRED` 表示需要人工对账，不得自动按成功或失败结算。
- 任何其他组合都视为尚未完全收口，应继续调用 `GET /gpt-direct/orders/{id}` 查询。

Webhook 只用于低延迟通知，不是额外的终态条件，也不是最终事实来源。Webhook 可能重复、延迟或乱序；收到后必须先验签，再按 `X-Avanfinity-Webhook-Id` 去重，然后异步查询 `GET /gpt-direct/orders/{id}`。本地状态应以查询返回的最新 `order.status` 和 `operationStatus` 为准，不能仅凭某一条 Webhook 直接入账、退款或关闭订单。订单详情中的 `events` 只是进度时间线，也不能代替订单快照。

`invoiceUrl` 在账单尚未生成或不可用时为 `null`。网页端只向已登录客户展示本人订单的“查看账单”；外部 API 通过订单列表或详情读取时，API key 必须拥有 `gpt:read` scope，且只能访问所属账户的订单，跨账户仍返回 `404`。该 URL 是敏感 Stripe bearer link，持有者可能无需再次登录即可打开，禁止写入日志、聊天、工单或分析平台，也不应长期缓存或转发。

错误：`401`、`403`、`429`、`503`、`500`。

### GET `/gpt-direct/orders/{id}`

返回 `{ order, events }`。事件包含 `eventId`、`type`、状态/阶段/分类/步骤、`publicCode`、`publicMessage` 和 `occurredAt`；不返回内部 `message`。`eventId` 是平台生成的稳定本地 UUID，不是外部系统 ID。跨账户访问返回 `404`。错误：`401`、`403`、`404`、`429`、`503`、`500`。

### POST `/gpt-direct/orders/{id}/cancel`

无请求体。只有 `queued`、`awaiting_card`、`funding_pending` 阶段可取消。该操作按订单资源 ID 天然幂等，不要求 `Idempotency-Key`：受理返回 `202` 的订单摘要；对同一订单的重复取消请求会继续返回当前摘要，不会再派发第二次取消。继续查询订单终态。错误：`400`、`401`、`403`、`404`、`409` 已进入不可取消阶段、`429`、`502`、`503`、`500`。

### POST `/gpt-direct/orders/{id}/cancel-renewal`

```json
{
  "credential": { "mode": "session", "session": "<该订单 ChatGPT 账户的最新完整会话 JSON>" }
}
```

scope 为 `gpt:write`，必须配置调用服务器的 IP/CIDR 白名单，不要求 `Idempotency-Key`。仅适用于已经完成、已确认扣款且仍会自动续费的当前账户订单；Session 必须属于该订单开通的同一 ChatGPT 账户。成功返回 `200 { code: 0, data: GptOrder }` 并带 `Cache-Control: no-store`。错误：`400` 凭据无效、`401`、`403`、`404`、`409` 无需取消/账户不一致/续费仍开启、`413`、`415`、`429`、`502`、`503`、`500`。

### POST `/gpt-direct/orders/{id}/session`

```json
{
  "credential": { "mode": "session", "session": "<原账号的新完整 Session JSON，同时包含 sessionToken 与 accessToken>" }
}
```

scope 为 `gpt:write`，要求 IP 白名单，不要求 `Idempotency-Key`。仅最新快照 `nextAction=submit_session`（`requires_action` 且 `publicCode=session_refresh_required`）可提交。必须与订单绑定的 ChatGPT 账号一致；不接受 access_token 或邮箱登录模式，不允许恢复已结束订单。

验证通过返回 `202 { code: 0, data: GptOrder }`，仅代表受理；订单快照可能仍待同步，继续 GET 查询。该操作保留原订单、原账单、原支付 checkpoint，必要时完成原账单支付，不重复支付已成功款项，不重新支付已成功的 Plus。重复提交可能返回 `409`，先查询，不应创建新订单。账号不一致/状态不允许为 `409`，无权读取为 `404`，凭据格式错误为 `400`，上游认证/服务异常可能为 `502` / `503`；错误响应中的机器码和提示应同时保留供客户支持核对，但绝不可记录 Session。

## 9. OpenAI CDK

### GET `/gpt-direct/cdk-offers`

返回 `data.offers[]`：`plan`、`enabled`、可空的 `salePrice`、`pricingStatus`、`stock`。`plan` 当前为 `go`、`plus`、`pro_5x`、`pro_20x`、`pro_25x`；`salePrice` 是美元十进制字符串；购买前必须实时读取报价，不能缓存后长期复用。

平台支持三种 CDK 定价策略：

| 策略 | 计算方式 |
| --- | --- |
| 固定售价 | 直接使用管理员配置的美元售价 |
| 最低报价 + 固定加价 | `最低有效美元报价 + 固定美元加价` |
| 最低报价 + 百分比 | `最低有效美元报价 × (1 + 加价百分比 / 100)` |

动态计算结果向上取整到美分。客户预检产生的有效地区报价会按套餐保存；非美元报价先按其最小货币单位还原，再使用平台参考汇率折算为美元，最后才参与最低价比较。例如 PHP 报价不会被当作同数值美元处理。预检凭据、邮箱和令牌不会进入报价记录。

动态报价样本的有效期当前为 24 小时，对应参考汇率的有效期为 6 小时；两者必须同时有效，因此实际可用窗口通常受 6 小时汇率新鲜度限制。任一条件不满足时，该套餐返回：

```json
{
  "enabled": false,
  "salePrice": null,
  "pricingStatus": "WAITING_QUOTE"
}
```

调用方应停止购买并稍后重新获取报价。`pricingStatus: "READY"` 只表示当前价格可以校验；仍需同时检查 `enabled=true` 和 `stock > 0`。最终售价受当前未售库存最大资金成本保护：动态售价低于成本底价时使用成本底价；固定售价低于成本的配置会被拒绝。错误：`401`、`403`、`429`、`503`、`500`。

### GET `/gpt-direct/cdks`

返回当前账户最近 100 个归属 CDK 的摘要：`id`、`codePrefix`、`plan`、`forceNewCard`、`status`、`inventoryStatus`、可空 `salePrice`、`updatedAt`，并返回能力位 `forceNewCardEnabled`。只有它为 `true` 时才可提交 `forceNewCard=true`；该能力位用于保证滚动发布期间旧、新副本混跑时不会提前生成新语义 CDK。`forceNewCard=true` 表示该 CDK 兑换时只新开并绑定一张卡。`id` 是稳定的本地公开 UUID，不是外系统库存 ID；列表中的 `codePrefix` 固定显示为 `AVF-********`，不泄露任何可用于拼接兑换凭证的片段。错误：`401`、`403`、`429`、`503`、`500`。

### POST `/gpt-direct/cdks/generate`

```json
{ "plan": "plus", "quantity": 2, "forceNewCard": true }
```

必须带幂等键。`plan` 可为 `go`、`plus`、`pro_5x`、`pro_20x`、`pro_25x`；`quantity` 可省略，默认 1，范围 1–50。`forceNewCard` 可省略，默认 `false`，保持原有逻辑：只复用并轮换生成者名下已有的 `ACTIVE` 卡；没有可用卡时兑换失败、无法支付，不自动开卡。

`forceNewCard=true` 时，每张 CDK 在首次兑换时恰好新开并绑定一张卡，不使用或轮换生成者的已有卡。后续幂等重试只复用已绑定的该张卡；支付失败时不再开第二张，也不回退到已有卡。绑定后的专用卡不会进入普通 CDK 的自动选卡池。生成时不扣套餐费；兑换时的新卡初始充值本金、开卡费和初始充值手续费由 CDK 生成者承担。

成功返回批次的 `saleId`、`cdkId`、可空 `code`、`codePrefix`、`plan`、`quantity`、`items`、`balance`、`replayed`、`generated=true`和 `forceNewCard`，并带 `Cache-Control: no-store`。`items[]` 每项包含独立的 `saleId`、`cdkId`、`code`和 `codePrefix`。`code` 是 `AVF-` 加 32 位大写十六进制字符的 bearer 兑换凭证；禁止记录在日志、聊天、工单或分析平台。同一业务意图的网络重试必须复用原幂等键和完全相同的请求体；改变 `plan`、`quantity` 或 `forceNewCard` 必须使用新幂等键。恢复窗口结束后 `code=null` 且 `codePrefix="AVF-********"`，不会重复生成。错误：`400`、`401`、`403`、`404`、`409` 幂等语义冲突、`429`、`503`、`500`。

## 10. Webhook

### 注册与端点要求

在开发者控制台为 API key 设置 `webhookUrl`。事件只会投递给事件产生时已启用、配置 URL 且拥有对应只读 scope 的 key；Webhook 订阅不会绕过 API 最小权限。

| 事件族 | 必需 scope |
| --- | --- |
| `card.*` | `cards:read` |
| `wallet.transaction.created`、`deposit.updated` | `account:read` |
| `openai.direct.*` | `gpt:read` |
| `openai.cdk.*` | `cdk:read` |
| `money.operation.updated` | `operations:read` |
| `webhook.test` | 无；仅由当前 key 的显式测试操作产生 |

停用 key、移除对应 scope、修改 URL 或轮换 Webhook Secret 后，旧配置下尚未完成的投递会取消。已经发出的 HTTP 请求可能仍返回，但配置版本不一致时不会被记为成功。

生产端点要求：

- `https://` 且使用 443 端口；
- 公网可解析地址，不允许本机、私网、链路本地、保留或文档地址；
- URL 不含用户名、密码或 fragment；
- 平台不使用系统代理、不跟随重定向，并把 DNS 解析结果固定到本次连接；
- 连接超时 5 秒，请求总超时 10 秒；接收方应在 **5 秒内** 完成持久化并返回任意 `2xx`。

业务处理应放入自己的队列，不能在 HTTP 回调里同步执行耗时资金逻辑。

### 请求头与签名

```http
Content-Type: application/json
User-Agent: Avanfinity-Webhook/1.0
X-Avanfinity-Webhook-Id: evt_<8hex>_<8hex>_<8hex>_<8hex>
X-Avanfinity-Webhook-Timestamp: <Unix 秒>
X-Avanfinity-Signature: v1=<64 hex>
```

签名直接使用当前 key 的独立 `webhookSecret`，不使用也不派生自 App Secret：

```text
signedPayload = UTF8(timestamp + ".") || rawBody
signature = HMAC-SHA256(UTF8(webhookSecret), signedPayload)
```

必须使用**未经 JSON 解析、格式化或编码转换的原始 HTTP body 字节**验签。校验步骤：

1. 检查三项签名头存在且格式合法。
2. 把 timestamp 解析为 Unix 秒；建议拒绝与本机时间相差超过 300 秒的请求。
3. 校验 `webhookSecret` 符合 `whsec_` 加 64 位小写十六进制字符的格式。
4. 以 `webhookSecret` 原始 UTF-8 字节为 HMAC key，对 `timestamp + "." + rawBody` 计算 HMAC-SHA256。
5. 使用常量时间比较。
6. 在数据库中以 `X-Avanfinity-Webhook-Id` 建唯一约束；同一事件直接返回 `2xx`。
7. **先持久化，后返回 2xx**。

可运行示例：

- [TypeScript / Node](examples/avanfinity-webhook-verify.ts)
- [Rust](examples/avanfinity-webhook-verify.rs)

两份示例都包含可直接运行的自检，覆盖正确签名、分组事件 ID、未分组 ID 拒绝和请求体篡改拒绝。

### Envelope

```json
{
  "id": "evt_a18f6d10_7c1a4b2c_9d3ea4f5_b6c7d8e9",
  "type": "card.recharge.updated",
  "apiVersion": "2026-08-01",
  "createdAt": "2026-08-01T10:00:00Z",
  "data": {
    "object": {
      "operationId": "018f6d10-7c1a-4b2c-9d3e-a4f5b6c7d8e9",
      "operationType": "RECHARGE",
      "eventKind": "completed",
      "status": "SUCCEEDED",
      "amount": "10.00",
      "fee": "0.10",
      "totalAmount": "10.10"
    }
  }
}
```

Webhook 永不包含 App Secret、Webhook Secret、完整卡号、安全码、OpenAI 凭据、完整 CDK、原始外部响应或内部接入信息。

`type` 与 `data.object` 是绑定合约：卡资金、卡交易、钱包交易、充值订单和 OpenAI 生命周期分别使用自己的严格对象 schema，不接受未定义字段。`webhook.test` 只接受 `{ "test": true }`。接收方仍应按版本兼容策略处理未来新事件，不得把其误当已知资金事件执行。

### 事件目录

| 事件 | `data.object` 主要字段 |
| --- | --- |
| `card.open.updated` | 资金操作字段 |
| `card.recharge.updated` | 资金操作字段 |
| `card.refund.updated` | 资金操作字段 |
| `card.freeze.updated` | 资金操作字段 |
| `card.unfreeze.updated` | 资金操作字段 |
| `card.delete.updated` | 资金操作字段 |
| `money.operation.updated` | 未细分资金操作字段 |
| `card.transaction.updated` | `transactionId`、`cardId`、类型/状态、授权/结算金额币种、商户、`authTime` |
| `wallet.transaction.created` | `transactionId`、`type`、`amount`、`balanceBefore`、`balanceAfter` |
| `deposit.updated` | `depositId`、`gatewayRef`、币种/网络、请求/期望/实际/入账金额、费用、状态、可空链上确认字段与 `cancelledAt` |
| `openai.direct.completed` | OpenAI 生命周期字段 |
| `openai.direct.failed` | OpenAI 生命周期字段 |
| `openai.direct.cancelled` | OpenAI 生命周期字段 |
| `openai.direct.progress` | OpenAI 生命周期字段 |
| `openai.direct.updated` | OpenAI 其他生命周期字段 |
| `openai.cdk.released` | CDK 生命周期字段 |
| `openai.cdk.reserved` | CDK 生命周期字段 |
| `openai.cdk.consumed` | CDK 生命周期字段 |
| `openai.cdk.frozen` | CDK 生命周期字段 |
| `openai.cdk.unfrozen` | CDK 生命周期字段 |
| `openai.cdk.disabled` | CDK 生命周期字段 |
| `openai.cdk.updated` | CDK 其他生命周期字段 |
| `webhook.test` | `test` 固定为 `true`；用于验证 URL、签名、去重和应答流程，不表示业务变更 |

资金操作字段：`operationId`、`operationType`、`eventKind`，以及存在时的 `statusBefore`、`status`、`amount`、`fee`、`totalAmount`。

OpenAI 生命周期字段：`eventId`，以及存在时的 `orderId`、`cdkId`、`status`、`stage`、`fromStatus`、`toStatus`、`category`、`step`、`occurredAt`。`eventId` 和 `cdkId` 均为稳定本地公开 UUID；不使用外部系统的数字 ID。

### 钱包充值状态回调

第三方客户不需要、也不得调用平台内部的链上确认入口。订单取消或链上交易确认时，平台在同一数据库事务中完成订单状态、必要的钱包入账和待投递事件持久化，然后向客户预先配置的 Webhook URL 发送 `deposit.updated`。成功取消的快照含 `status=cancelled` 和 `cancelledAt`，对该 `gatewayRef` 是最终快照；后续转账不会再匹配或自动入账，也不会因此再发送 `status=confirmed` 快照。如链上确认在取消竞态中先完成，取消返回 `409`，平台只发送确认快照。要接收该事件，API key 必须已启用、已配置合法 Webhook URL 且具有 `account:read`；只有 `deposits:create` 不会收到回调。

```json
{
  "id": "evt_b28f7e21_8d2b5c3d_ae4fb506_c7d8e9f0",
  "type": "deposit.updated",
  "apiVersion": "2026-08-01",
  "createdAt": "2026-08-01T10:03:00Z",
  "data": {
    "object": {
      "depositId": 123,
      "gatewayRef": "018f6d10-7c1a-4b2c-9d3e-a4f5b6c7d8e9",
      "currency": "USDT",
      "network": "TRON",
      "requestedAmount": "10.00",
      "expectedAmount": "10.034550",
      "actualAmount": "10.034550",
      "creditedAmount": "10.034550",
      "fee": "0.000000",
      "status": "confirmed",
      "transactionHash": "2f4d8c6a",
      "confirmedAt": "2026-08-01T10:03:00Z",
      "expiredAt": "2026-08-01T10:15:00Z"
    }
  }
}
```

安全与资金处理边界：

1. 先按本章“请求头与签名”使用**未解析的原始 body 字节**校验 `X-Avanfinity-Webhook-Timestamp` 和 `X-Avanfinity-Signature`；使用独立 Webhook Secret，不使用 App Secret。
2. 验证时间窗后用常量时间比较签名，再以 `X-Avanfinity-Webhook-Id` 建唯一约束去重；重复事件返回 `2xx`，不再入账或执行业务。
3. **只有 `data.object.status === "confirmed"` 可视为到账**。`pending`、`expired`、`failed` 和 `cancelled` 只更新本地状态，不给下游客户加款。
4. `expired` 不是不可变终态；迟到的有效转账可使同一 `gatewayRef` 后续变为 `confirmed`。`cancelled` 是不可变终态，迟到转账不会匹配该订单或自动入账。按订单状态机处理，不得用旧事件覆盖已确认或已取消状态。
5. 以 `gatewayRef` 绑定客户订单，并以 `GET /deposits/{gatewayRef}` 的最新结果作为最终事实来源。Webhook 中的链上哈希字段名为 `transactionHash`，查询接口对应字段为 `txHash`。
6. `deposit.updated` 已表示同一笔钱包充值订单的状态及入账结果。如同时订阅 `wallet.transaction.created`，不得再根据后者对该笔充值重复入账；账本事件只用于对账。
7. 验签、去重和事件持久化成功后尽快返回 `2xx`，异步查询与执行下游入账，不在 HTTP 回调中进行耗时调用。

### 重试、重复与乱序

- 任意 `2xx` 视为成功；其他 HTTP 状态、瞬时 DNS/连接错误或超时均视为失败。
- 最多尝试 5 次。失败后的退避间隔依次为约 2、4、8、16 秒；进程恢复可能使实际时间更晚。
- URL 结构无效、解析到非公网地址或签名材料损坏属于永久错误，可在首次尝试后直接进入 `DEAD`。
- 每次重试 `X-Avanfinity-Webhook-Id` 和 JSON envelope 不变；签名时间戳与签名会重新生成。
- 第 5 次失败后进入 `DEAD`，不会无限重试。
- 不保证不同事件严格按创建顺序到达。按事件 ID 去重，并按业务对象状态机处理；旧状态不得覆盖已确认的新终态。
- API 响应与 Webhook 可能竞速。资金真相以平台查询接口和本地账本为准。

## 11. HTTP 错误码

| 状态 | 含义 | 是否可重试 |
| ---: | --- | --- |
| `400` | JSON、参数、金额、幂等键或凭据形状无效 | 修正请求后新业务 key |
| `401` | App ID/Secret 不匹配，或 key 已禁用 | 否；检查密钥 |
| `403` | 缺 scope、账户不可用或 IP 不在白名单 | 否；修正授权配置 |
| `404` | 资源不存在或不属于当前账户/key | 否 |
| `408` | 应用处理超过 30 秒；外层网关也可能使用自己的超时格式，结果仍可能未知 | 资金写请求使用原幂等键查询/重放 |
| `409` | 幂等键冲突、报价变化、资源忙或状态不允许 | 先查询/刷新状态；不要盲重试 |
| `413` | 请求体超过网关或应用上限 | 否；缩小请求，不得拆分凭据或资金语义 |
| `415` | 有请求体的接口未使用 `Content-Type: application/json` | 修正 Content-Type 后按原幂等语义提交 |
| `422` | 钱包、可用钱包或卡余额不足 | 读取 `/balance` 区分总额、风控锁定额和可用额；补足可用余额后创建新业务请求 |
| `429` | 固定窗口或端点频率限制 | 按 `Retry-After` 与退避 |
| `500` | 平台内部错误 | 同请求、同幂等键退避重试 |
| `502` | 依赖服务已知失败或响应无效 | 查询状态；资金写同幂等键 |
| `503` | 服务、配置或安全保护暂不可用 | 退避；资金写同幂等键 |

常用 `errorCode`：

- `AUTH_REQUIRED`：请求需要有效登录或 API 凭据。
- `RECENT_AUTH_REQUIRED`：敏感控制台操作需要在最近 5 分钟内重新登录。
- `PRICE_CHANGED`：开卡或充值报价已变化；不要使用原请求盲重试，按“报价确认与重新报价”流程获取新价格并使用新的 `Idempotency-Key`。
- `SPENDABLE_BALANCE_INSUFFICIENT`：钱包总余额可能足够，但扣除自动拒付率锁定或其它账户级风险冻结后可用余额不足；读取 `/balance` 的 `totalBalance`、`riskLockedBalance` 与 `balance`，不要把锁定额当作资金丢失。

连接中断或客户端超时不表示失败，也不表示成功。资金请求永远先使用原 key 查询/重放，不能生成新 key 猜测结果。

## 12. 变更与弃用

- `/api/v1` 内可新增可选字段、新枚举值、新 Webhook 类型和新错误文案；客户端必须忽略未知 JSON 字段和未知事件类型。
- 现有字段删除、语义变化、鉴权弱化或必填请求变化属于破坏性修改，必须进入新的主版本路径。
- `apiVersion` 标识 Webhook envelope 合约。接收方应记录版本，并对不支持的版本安全返回非 2xx，而不是错误执行资金逻辑。
- 弃用项会在本文件和 OpenAPI 说明中标记；在替代接口验收通过前，不把未实现能力写入正式文档。

## 13. 安全责任边界

平台负责：账户与 key 隔离、scope、来源 IP、限流、资金幂等、敏感响应禁缓存、审计、Webhook 签名/重试与载荷脱敏。

调用方负责：

- TLS、服务端密钥库、最小 scope、独立 key、来源 IP 收敛和 App/Webhook Secret 定期轮换；
- 不在前端、移动端、日志、URL、工单或聊天中泄露 App Secret、Webhook Secret 和高敏数据；
- 完整卡号只按需使用，安全码不持久化；
- OpenAI 凭据与预检令牌只存在于短期内存；
- 资金请求生成稳定业务幂等键，保存请求/响应 `X-Request-Id`，执行账本核对；
- Webhook 使用原始 body 验签、时间窗校验、事件 ID 唯一约束、先持久化后应答、重复/乱序安全；
- 不把 `error` 文案、`dispatchState` 或 Webhook 到达顺序当作资金终态。

<!-- generated-api-reference -->

## 完整接口参考（由 OpenAPI 生成）

以下接口、请求与响应定义来自本次发布的同一份规范。字段约束详见末尾模型定义，响应码不等于付款或交付终态。

## API v1 · 2026-10-28

### GET `/api/v1/products`

查询可用产品

操作：`listProducts`；权限：`products:read`。

返回当前 API 账户可购买的产品和最终客户价，不返回内部成本或服务接入信息。

响应：
```json
{
  "200": {
    "description": "产品列表",
    "headers": {
      "X-Request-Id": {
        "$ref": "#/components/headers/RequestId"
      }
    },
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/ProductsResponse"
        }
      }
    }
  },
  "401": {
    "$ref": "#/components/responses/Unauthorized"
  },
  "403": {
    "$ref": "#/components/responses/Forbidden"
  },
  "408": {
    "$ref": "#/components/responses/RequestTimeout"
  },
  "429": {
    "$ref": "#/components/responses/RateLimited"
  },
  "500": {
    "$ref": "#/components/responses/ServerError"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### GET `/api/v1/balance`

查询钱包余额

操作：`getBalance`；权限：`account:read`。

返回当前调用方的可用余额、总余额、支付风险锁定余额、支付成功/拒绝率及累计充值/消费汇总。金额均为十进制字符串；支付率按基点返回，10000 表示 100%。

响应：
```json
{
  "200": {
    "description": "钱包汇总",
    "headers": {
      "X-Request-Id": {
        "$ref": "#/components/headers/RequestId"
      }
    },
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/BalanceResponse"
        }
      }
    }
  },
  "401": {
    "$ref": "#/components/responses/Unauthorized"
  },
  "403": {
    "$ref": "#/components/responses/Forbidden"
  },
  "408": {
    "$ref": "#/components/responses/RequestTimeout"
  },
  "429": {
    "$ref": "#/components/responses/RateLimited"
  },
  "500": {
    "$ref": "#/components/responses/ServerError"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### GET `/api/v1/balance-logs`

查询钱包账本

操作：`listBalanceLogs`；权限：`account:read`。

按创建时间和 ID 倒序返回当前账户的本地账本。

参数：
```json
[
  {
    "$ref": "#/components/parameters/Page"
  },
  {
    "$ref": "#/components/parameters/PageSize"
  }
]
```

响应：
```json
{
  "200": {
    "description": "分页账本",
    "headers": {
      "X-Request-Id": {
        "$ref": "#/components/headers/RequestId"
      }
    },
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/BalanceLogsResponse"
        }
      }
    }
  },
  "401": {
    "$ref": "#/components/responses/Unauthorized"
  },
  "403": {
    "$ref": "#/components/responses/Forbidden"
  },
  "408": {
    "$ref": "#/components/responses/RequestTimeout"
  },
  "429": {
    "$ref": "#/components/responses/RateLimited"
  },
  "500": {
    "$ref": "#/components/responses/ServerError"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### POST `/api/v1/deposits`

创建钱包充值订单

操作：`createWalletDeposit`；权限：`deposits:create`。

为当前 API 账户创建 15 分钟有效的 USDT 充值订单。TRON/BSC 向 address 转账；SOL 必须把 SPL USDT 转入 tokenAccount，address 仅是 owner。必须按 expectedAmount 精确转账，平台以唯一小数匹配链上付款；多付的实际到账金额会按当前规则入账。同一 API key 下同一 Idempotency-Key 只能绑定一组请求参数；安全重试返回原订单且 reused=true。不接受请求体中的回调地址；deposit.updated 只投递到当前账户下预先配置 Webhook URL 且具有 account:read 的 API key。

参数：
```json
[
  {
    "$ref": "#/components/parameters/IdempotencyKey"
  }
]
```

请求：
```json
{
  "required": true,
  "content": {
    "application/json": {
      "schema": {
        "$ref": "#/components/schemas/CreateDepositInput"
      },
      "example": {
        "currency": "USDT",
        "network": "TRON",
        "amount": "10.00"
      }
    }
  }
}
```

响应：
```json
{
  "200": {
    "description": "同一幂等请求的安全重放；返回原订单且 reused 为 true",
    "headers": {
      "X-Request-Id": {
        "$ref": "#/components/headers/RequestId"
      }
    },
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/CreateDepositResponse"
        }
      }
    }
  },
  "201": {
    "description": "充值订单已创建",
    "headers": {
      "X-Request-Id": {
        "$ref": "#/components/headers/RequestId"
      }
    },
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/CreateDepositResponse"
        }
      }
    }
  },
  "400": {
    "$ref": "#/components/responses/InvalidRequest"
  },
  "401": {
    "$ref": "#/components/responses/Unauthorized"
  },
  "403": {
    "$ref": "#/components/responses/Forbidden"
  },
  "408": {
    "$ref": "#/components/responses/RequestTimeout"
  },
  "409": {
    "$ref": "#/components/responses/Conflict"
  },
  "413": {
    "$ref": "#/components/responses/PayloadTooLarge"
  },
  "415": {
    "$ref": "#/components/responses/UnsupportedMediaType"
  },
  "429": {
    "$ref": "#/components/responses/RateLimited"
  },
  "500": {
    "$ref": "#/components/responses/ServerError"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### GET `/api/v1/deposits/{gatewayRef}`

查询钱包充值订单

操作：`getWalletDepositStatus`；权限：`account:read`。

按 gatewayRef 查询当前 API 账户的充值订单，跨账户访问统一返回 404。status=confirmed 才表示链上付款已确认且钱包已入账；expired 订单仍可因迟到的有效转账变为 confirmed。cancelled 是不可变终态，后续转账不会再匹配该订单或自动入账。Webhook 用于及时通知，本查询接口是订单最终事实来源。

参数：
```json
[
  {
    "$ref": "#/components/parameters/DepositGatewayRef"
  }
]
```

响应：
```json
{
  "200": {
    "description": "充值订单当前状态",
    "headers": {
      "X-Request-Id": {
        "$ref": "#/components/headers/RequestId"
      }
    },
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/DepositResponse"
        }
      }
    }
  },
  "400": {
    "$ref": "#/components/responses/InvalidRequest"
  },
  "401": {
    "$ref": "#/components/responses/Unauthorized"
  },
  "403": {
    "$ref": "#/components/responses/Forbidden"
  },
  "404": {
    "$ref": "#/components/responses/NotFound"
  },
  "408": {
    "$ref": "#/components/responses/RequestTimeout"
  },
  "429": {
    "$ref": "#/components/responses/RateLimited"
  },
  "500": {
    "$ref": "#/components/responses/ServerError"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### POST `/api/v1/deposits/{gatewayRef}/cancel`

取消钱包充值订单

操作：`cancelWalletDeposit`；权限：`deposits:create`。

只取消当前 API key 创建、尚未付款且仍有效的订单。无请求体和 Idempotency-Key，按 gatewayRef 资源幂等；重复取消返回 replayed=true。成功返回 200 后，该 gatewayRef 保持 cancelled 不可变终态，后续转账不会再匹配该订单或自动入账；如链上确认在取消竞态中先完成，则返回 409。取消不会复用原订单的精确金额；如需修改金额或网络，必须使用新的 Idempotency-Key 创建新订单。

参数：
```json
[
  {
    "$ref": "#/components/parameters/DepositGatewayRef"
  }
]
```

响应：
```json
{
  "200": {
    "description": "订单已取消，或返回同一资源的幂等取消结果",
    "headers": {
      "X-Request-Id": {
        "$ref": "#/components/headers/RequestId"
      }
    },
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/CancelDepositResponse"
        }
      }
    }
  },
  "400": {
    "$ref": "#/components/responses/InvalidRequest"
  },
  "401": {
    "$ref": "#/components/responses/Unauthorized"
  },
  "403": {
    "$ref": "#/components/responses/Forbidden"
  },
  "404": {
    "$ref": "#/components/responses/NotFound"
  },
  "408": {
    "$ref": "#/components/responses/RequestTimeout"
  },
  "409": {
    "$ref": "#/components/responses/Conflict"
  },
  "429": {
    "$ref": "#/components/responses/RateLimited"
  },
  "500": {
    "$ref": "#/components/responses/ServerError"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### GET `/api/v1/cards`

查询虚拟卡

操作：`listCards`；权限：`cards:read`。

返回当前账户未删除卡片的本地快照；卡号始终脱敏。

参数：
```json
[
  {
    "$ref": "#/components/parameters/Page"
  },
  {
    "$ref": "#/components/parameters/PageSize"
  }
]
```

响应：
```json
{
  "200": {
    "description": "卡片列表",
    "headers": {
      "X-Request-Id": {
        "$ref": "#/components/headers/RequestId"
      }
    },
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/CardsResponse"
        }
      }
    }
  },
  "401": {
    "$ref": "#/components/responses/Unauthorized"
  },
  "403": {
    "$ref": "#/components/responses/Forbidden"
  },
  "408": {
    "$ref": "#/components/responses/RequestTimeout"
  },
  "429": {
    "$ref": "#/components/responses/RateLimited"
  },
  "500": {
    "$ref": "#/components/responses/ServerError"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### GET `/api/v1/cards/all-transactions`

查询全部卡片交易

操作：`listAllCardTransactions`；权限：`cards:read`。

只读取当前账户已同步到本地数据库的交易快照。

参数：
```json
[
  {
    "$ref": "#/components/parameters/Page"
  },
  {
    "$ref": "#/components/parameters/TransactionPageSize"
  },
  {
    "name": "card_id",
    "in": "query",
    "schema": {
      "type": "integer",
      "format": "int64",
      "minimum": 1
    },
    "description": "可选本站卡片 ID"
  },
  {
    "name": "source",
    "in": "query",
    "schema": {
      "type": "string",
      "enum": [
        "db"
      ]
    },
    "description": "当前仅支持 db"
  },
  {
    "name": "status",
    "in": "query",
    "schema": {
      "type": "string",
      "enum": [
        "PENDING",
        "COMPLETE",
        "DECLINED"
      ]
    }
  },
  {
    "name": "type",
    "in": "query",
    "schema": {
      "type": "string",
      "enum": [
        "Authorization",
        "Settlement",
        "Refund",
        "Reversal"
      ]
    }
  },
  {
    "name": "q",
    "in": "query",
    "schema": {
      "type": "string",
      "maxLength": 200
    },
    "description": "按商户名或授权 ID 模糊查询"
  }
]
```

响应：
```json
{
  "200": {
    "description": "分页交易",
    "headers": {
      "X-Request-Id": {
        "$ref": "#/components/headers/RequestId"
      }
    },
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/CardTransactionsResponse"
        }
      }
    }
  },
  "400": {
    "$ref": "#/components/responses/InvalidRequest"
  },
  "401": {
    "$ref": "#/components/responses/Unauthorized"
  },
  "403": {
    "$ref": "#/components/responses/Forbidden"
  },
  "408": {
    "$ref": "#/components/responses/RequestTimeout"
  },
  "429": {
    "$ref": "#/components/responses/RateLimited"
  },
  "500": {
    "$ref": "#/components/responses/ServerError"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### GET `/api/v1/cards/{id}`

查询卡片详情

操作：`getCard`；权限：`cards:read`。

返回持卡人姓名、状态和脱敏卡信息的本地快照。跨账户访问统一返回 404。

参数：
```json
[
  {
    "$ref": "#/components/parameters/CardId"
  }
]
```

响应：
```json
{
  "200": {
    "description": "卡片详情",
    "headers": {
      "X-Request-Id": {
        "$ref": "#/components/headers/RequestId"
      }
    },
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/CardDetailResponse"
        }
      }
    }
  },
  "401": {
    "$ref": "#/components/responses/Unauthorized"
  },
  "403": {
    "$ref": "#/components/responses/Forbidden"
  },
  "404": {
    "$ref": "#/components/responses/NotFound"
  },
  "408": {
    "$ref": "#/components/responses/RequestTimeout"
  },
  "429": {
    "$ref": "#/components/responses/RateLimited"
  },
  "500": {
    "$ref": "#/components/responses/ServerError"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### DELETE `/api/v1/cards/{id}`

删除卡片

操作：`deleteCard`；权限：`cards:manage`。

删除成功后卡片不再出现在查询接口。资金操作可能返回 202；按 operationId 查询终态。

参数：
```json
[
  {
    "$ref": "#/components/parameters/CardId"
  },
  {
    "$ref": "#/components/parameters/IdempotencyKey"
  }
]
```

响应：
```json
{
  "200": {
    "$ref": "#/components/responses/CardActionSucceeded"
  },
  "202": {
    "$ref": "#/components/responses/OperationPending"
  },
  "400": {
    "$ref": "#/components/responses/InvalidRequest"
  },
  "401": {
    "$ref": "#/components/responses/Unauthorized"
  },
  "403": {
    "$ref": "#/components/responses/Forbidden"
  },
  "404": {
    "$ref": "#/components/responses/NotFound"
  },
  "408": {
    "$ref": "#/components/responses/RequestTimeout"
  },
  "409": {
    "$ref": "#/components/responses/Conflict"
  },
  "429": {
    "$ref": "#/components/responses/RateLimited"
  },
  "500": {
    "$ref": "#/components/responses/ServerError"
  },
  "502": {
    "$ref": "#/components/responses/BadGateway"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### GET `/api/v1/cards/{id}/sensitive`

读取完整卡片安全信息

操作：`getCardSensitive`；权限：`cards:sensitive`。

高敏接口。响应包含完整卡号、安全码和有效期，带 Cache-Control: no-store；平台记录访问审计。禁止保存安全码。

参数：
```json
[
  {
    "$ref": "#/components/parameters/CardId"
  }
]
```

响应：
```json
{
  "200": {
    "description": "敏感卡信息",
    "headers": {
      "Cache-Control": {
        "schema": {
          "type": "string",
          "pattern": "(?:^|,)\\s*no-store(?:,|$)",
          "example": "no-store, private"
        }
      },
      "X-Request-Id": {
        "$ref": "#/components/headers/RequestId"
      }
    },
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/CardSensitiveResponse"
        }
      }
    }
  },
  "401": {
    "$ref": "#/components/responses/Unauthorized"
  },
  "403": {
    "$ref": "#/components/responses/Forbidden"
  },
  "404": {
    "$ref": "#/components/responses/NotFound"
  },
  "408": {
    "$ref": "#/components/responses/RequestTimeout"
  },
  "429": {
    "$ref": "#/components/responses/RateLimited"
  },
  "500": {
    "$ref": "#/components/responses/ServerError"
  },
  "502": {
    "$ref": "#/components/responses/BadGateway"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### GET `/api/v1/cards/{id}/transactions`

查询单卡交易

操作：`listCardTransactions`；权限：`cards:read`。

只读取当前卡片已同步到本地数据库的交易快照。

参数：
```json
[
  {
    "$ref": "#/components/parameters/CardId"
  },
  {
    "$ref": "#/components/parameters/Page"
  },
  {
    "$ref": "#/components/parameters/TransactionPageSize"
  }
]
```

响应：
```json
{
  "200": {
    "description": "分页交易",
    "headers": {
      "X-Request-Id": {
        "$ref": "#/components/headers/RequestId"
      }
    },
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/CardTransactionsResponse"
        }
      }
    }
  },
  "401": {
    "$ref": "#/components/responses/Unauthorized"
  },
  "403": {
    "$ref": "#/components/responses/Forbidden"
  },
  "404": {
    "$ref": "#/components/responses/NotFound"
  },
  "408": {
    "$ref": "#/components/responses/RequestTimeout"
  },
  "429": {
    "$ref": "#/components/responses/RateLimited"
  },
  "500": {
    "$ref": "#/components/responses/ServerError"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### GET `/api/v1/cards/{id}/recharges`

查询单卡充值记录

操作：`listCardRecharges`；权限：`cards:read`。

只读取当前卡片已同步到本地数据库的充值快照。

参数：
```json
[
  {
    "$ref": "#/components/parameters/CardId"
  },
  {
    "$ref": "#/components/parameters/Page"
  },
  {
    "$ref": "#/components/parameters/PageSize"
  }
]
```

响应：
```json
{
  "200": {
    "description": "分页充值记录",
    "headers": {
      "X-Request-Id": {
        "$ref": "#/components/headers/RequestId"
      }
    },
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/CardRechargesResponse"
        }
      }
    }
  },
  "401": {
    "$ref": "#/components/responses/Unauthorized"
  },
  "403": {
    "$ref": "#/components/responses/Forbidden"
  },
  "404": {
    "$ref": "#/components/responses/NotFound"
  },
  "408": {
    "$ref": "#/components/responses/RequestTimeout"
  },
  "429": {
    "$ref": "#/components/responses/RateLimited"
  },
  "500": {
    "$ref": "#/components/responses/ServerError"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### POST `/api/v1/cards/open`

开通一张虚拟卡

操作：`openCard`；权限：`cards:open`。

当前 count 只能为 1。初始金额必须处于产品返回的 minAmount 与 maxAmount 之间。开卡扣款为 initAmount + openFee + 初始充值手续费；初始充值手续费按 products.rechargeRate 计算并向上取整到 4 位小数。提交前必须原样提交 expectedOpenFee、expectedInitialRechargeFee 与 openQuoteVersion；报价变化时返回 409 / PRICE_CHANGED，重新读取 products 后以新幂等键提交。

参数：
```json
[
  {
    "$ref": "#/components/parameters/IdempotencyKey"
  }
]
```

请求：
```json
{
  "required": true,
  "content": {
    "application/json": {
      "schema": {
        "$ref": "#/components/schemas/OpenCardInput"
      },
      "examples": {
        "open": {
          "value": {
            "productCode": "PRODUCT_CODE",
            "firstName": "Ada",
            "lastName": "Lovelace",
            "initAmount": "10.00",
            "count": 1,
            "expectedOpenFee": "1.50",
            "expectedInitialRechargeFee": "0.10",
            "openQuoteVersion": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
          }
        }
      }
    }
  }
}
```

响应：
```json
{
  "200": {
    "description": "开卡完成或成功重放",
    "headers": {
      "X-Request-Id": {
        "$ref": "#/components/headers/RequestId"
      }
    },
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/OpenCardResponse"
        }
      }
    }
  },
  "202": {
    "$ref": "#/components/responses/OperationPending"
  },
  "400": {
    "$ref": "#/components/responses/InvalidRequest"
  },
  "401": {
    "$ref": "#/components/responses/Unauthorized"
  },
  "403": {
    "$ref": "#/components/responses/Forbidden"
  },
  "404": {
    "$ref": "#/components/responses/NotFound"
  },
  "408": {
    "$ref": "#/components/responses/RequestTimeout"
  },
  "409": {
    "$ref": "#/components/responses/Conflict"
  },
  "413": {
    "$ref": "#/components/responses/PayloadTooLarge"
  },
  "415": {
    "$ref": "#/components/responses/UnsupportedMediaType"
  },
  "422": {
    "$ref": "#/components/responses/Unprocessable"
  },
  "429": {
    "$ref": "#/components/responses/RateLimited"
  },
  "500": {
    "$ref": "#/components/responses/ServerError"
  },
  "502": {
    "$ref": "#/components/responses/BadGateway"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### POST `/api/v1/cards/{id}/recharge-quote`

获取卡片充值报价

操作：`quoteCardRecharge`；权限：`cards:recharge`。

按当前产品规则计算 amount 的充值费和钱包总扣款；不会创建资金操作、不会扣款，也不需要 Idempotency-Key。将 data.fee 原样作为后续 recharge 的 expectedFee；若写入返回 409 / PRICE_CHANGED，重新报价后使用新的 Idempotency-Key。

参数：
```json
[
  {
    "$ref": "#/components/parameters/CardId"
  }
]
```

请求：
```json
{
  "$ref": "#/components/requestBodies/RechargeQuote"
}
```

响应：
```json
{
  "200": {
    "description": "当前充值报价；不会产生资金或卡片状态变更",
    "headers": {
      "X-Request-Id": {
        "$ref": "#/components/headers/RequestId"
      }
    },
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/RechargeQuoteResponse"
        }
      }
    }
  },
  "400": {
    "$ref": "#/components/responses/InvalidRequest"
  },
  "401": {
    "$ref": "#/components/responses/Unauthorized"
  },
  "403": {
    "$ref": "#/components/responses/Forbidden"
  },
  "404": {
    "$ref": "#/components/responses/NotFound"
  },
  "408": {
    "$ref": "#/components/responses/RequestTimeout"
  },
  "409": {
    "$ref": "#/components/responses/Conflict"
  },
  "413": {
    "$ref": "#/components/responses/PayloadTooLarge"
  },
  "415": {
    "$ref": "#/components/responses/UnsupportedMediaType"
  },
  "422": {
    "$ref": "#/components/responses/Unprocessable"
  },
  "429": {
    "$ref": "#/components/responses/RateLimited"
  },
  "500": {
    "$ref": "#/components/responses/ServerError"
  },
  "502": {
    "$ref": "#/components/responses/BadGateway"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### POST `/api/v1/cards/{id}/recharge`

卡片充值

操作：`rechargeCard`；权限：`cards:recharge`。

amount 为充入卡片的本金；钱包另按当前产品 rechargeRate 扣除手续费。提交前必须调用 recharge-quote，并将返回的 data.fee 原样作为 expectedFee；报价变化时返回 409 / PRICE_CHANGED，重新报价后以新幂等键提交。

参数：
```json
[
  {
    "$ref": "#/components/parameters/CardId"
  },
  {
    "$ref": "#/components/parameters/IdempotencyKey"
  }
]
```

请求：
```json
{
  "$ref": "#/components/requestBodies/Recharge"
}
```

响应：
```json
{
  "200": {
    "$ref": "#/components/responses/CardActionSucceeded"
  },
  "202": {
    "$ref": "#/components/responses/OperationPending"
  },
  "400": {
    "$ref": "#/components/responses/InvalidRequest"
  },
  "401": {
    "$ref": "#/components/responses/Unauthorized"
  },
  "403": {
    "$ref": "#/components/responses/Forbidden"
  },
  "404": {
    "$ref": "#/components/responses/NotFound"
  },
  "408": {
    "$ref": "#/components/responses/RequestTimeout"
  },
  "409": {
    "$ref": "#/components/responses/Conflict"
  },
  "413": {
    "$ref": "#/components/responses/PayloadTooLarge"
  },
  "415": {
    "$ref": "#/components/responses/UnsupportedMediaType"
  },
  "422": {
    "$ref": "#/components/responses/Unprocessable"
  },
  "429": {
    "$ref": "#/components/responses/RateLimited"
  },
  "500": {
    "$ref": "#/components/responses/ServerError"
  },
  "502": {
    "$ref": "#/components/responses/BadGateway"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### POST `/api/v1/cards/{id}/refund`

从卡片退回钱包

操作：`refundCard`；权限：`cards:manage`。

amount 为从卡余额退回本站钱包的本金。退款前同步上游最新可用余额，消费扣款和预授权占用不可按旧余额退回。金额超过最新可退余额时返回 409 / REFUND_BALANCE_CHANGED；未提交上游退款，请重新读取卡片详情，按最新可退金额使用新幂等键重新确认。无法同步余额时返回 503 / REFUND_BALANCE_UNAVAILABLE，也未提交上游退款；原操作保持可安全重试，必须复用原幂等键。本接口当前不收手续费，仅按发卡通道明确确认的实际退回金额入账。它不同于商户消费退款事件及其风险费用。

参数：
```json
[
  {
    "$ref": "#/components/parameters/CardId"
  },
  {
    "$ref": "#/components/parameters/IdempotencyKey"
  }
]
```

请求：
```json
{
  "$ref": "#/components/requestBodies/Amount"
}
```

响应：
```json
{
  "200": {
    "$ref": "#/components/responses/CardActionSucceeded"
  },
  "202": {
    "$ref": "#/components/responses/OperationPending"
  },
  "400": {
    "$ref": "#/components/responses/InvalidRequest"
  },
  "401": {
    "$ref": "#/components/responses/Unauthorized"
  },
  "403": {
    "$ref": "#/components/responses/Forbidden"
  },
  "404": {
    "$ref": "#/components/responses/NotFound"
  },
  "408": {
    "$ref": "#/components/responses/RequestTimeout"
  },
  "409": {
    "$ref": "#/components/responses/Conflict"
  },
  "413": {
    "$ref": "#/components/responses/PayloadTooLarge"
  },
  "415": {
    "$ref": "#/components/responses/UnsupportedMediaType"
  },
  "422": {
    "$ref": "#/components/responses/Unprocessable"
  },
  "429": {
    "$ref": "#/components/responses/RateLimited"
  },
  "500": {
    "$ref": "#/components/responses/ServerError"
  },
  "502": {
    "$ref": "#/components/responses/BadGateway"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### POST `/api/v1/cards/{id}/freeze`

冻结卡片

操作：`freezeCard`；权限：`cards:manage`。

提交异步冻结操作。重复业务请求必须复用同一个 Idempotency-Key，并通过 operations 接口查询最终状态。

参数：
```json
[
  {
    "$ref": "#/components/parameters/CardId"
  },
  {
    "$ref": "#/components/parameters/IdempotencyKey"
  }
]
```

响应：
```json
{
  "200": {
    "$ref": "#/components/responses/CardActionSucceeded"
  },
  "202": {
    "$ref": "#/components/responses/OperationPending"
  },
  "400": {
    "$ref": "#/components/responses/InvalidRequest"
  },
  "401": {
    "$ref": "#/components/responses/Unauthorized"
  },
  "403": {
    "$ref": "#/components/responses/Forbidden"
  },
  "404": {
    "$ref": "#/components/responses/NotFound"
  },
  "408": {
    "$ref": "#/components/responses/RequestTimeout"
  },
  "409": {
    "$ref": "#/components/responses/Conflict"
  },
  "429": {
    "$ref": "#/components/responses/RateLimited"
  },
  "500": {
    "$ref": "#/components/responses/ServerError"
  },
  "502": {
    "$ref": "#/components/responses/BadGateway"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### POST `/api/v1/cards/{id}/unfreeze`

解冻卡片

操作：`unfreezeCard`；权限：`cards:manage`。

提交异步解冻操作。重复业务请求必须复用同一个 Idempotency-Key，并通过 operations 接口查询最终状态。

参数：
```json
[
  {
    "$ref": "#/components/parameters/CardId"
  },
  {
    "$ref": "#/components/parameters/IdempotencyKey"
  }
]
```

响应：
```json
{
  "200": {
    "$ref": "#/components/responses/CardActionSucceeded"
  },
  "202": {
    "$ref": "#/components/responses/OperationPending"
  },
  "400": {
    "$ref": "#/components/responses/InvalidRequest"
  },
  "401": {
    "$ref": "#/components/responses/Unauthorized"
  },
  "403": {
    "$ref": "#/components/responses/Forbidden"
  },
  "404": {
    "$ref": "#/components/responses/NotFound"
  },
  "408": {
    "$ref": "#/components/responses/RequestTimeout"
  },
  "409": {
    "$ref": "#/components/responses/Conflict"
  },
  "429": {
    "$ref": "#/components/responses/RateLimited"
  },
  "500": {
    "$ref": "#/components/responses/ServerError"
  },
  "502": {
    "$ref": "#/components/responses/BadGateway"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### GET `/api/v1/gpt-direct/card-successes`

查询本人卡片支付成功率

操作：`listOpenAICardSuccesses`；权限：`gpt:read`。

只读、无付款副作用。与站内页面复用查询及统计口径，禁止缓存；受同一账户限流。零样本成功率为 null。

响应：
```json
{
  "200": {
    "description": "公开统计",
    "content": {
      "application/json": {
        "schema": {
          "type": "object",
          "required": [
            "code",
            "data"
          ],
          "properties": {
            "code": {
              "const": 0
            },
            "data": {
              "type": "object",
              "required": [
                "list",
                "statistics"
              ],
              "properties": {
                "list": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "required": [
                      "cardId",
                      "overall",
                      "plans"
                    ],
                    "properties": {
                      "cardId": {
                        "type": "integer"
                      },
                      "overall": {
                        "type": "object",
                        "required": [
                          "attempts",
                          "successes",
                          "declines",
                          "successRateBps",
                          "declineRateBps"
                        ],
                        "properties": {
                          "attempts": {
                            "type": "integer",
                            "minimum": 0
                          },
                          "successes": {
                            "type": "integer",
                            "minimum": 0
                          },
                          "declines": {
                            "type": "integer",
                            "minimum": 0
                          },
                          "successRateBps": {
                            "type": [
                              "integer",
                              "null"
                            ],
                            "minimum": 0,
                            "maximum": 10000
                          },
                          "declineRateBps": {
                            "type": [
                              "integer",
                              "null"
                            ],
                            "minimum": 0,
                            "maximum": 10000
                          }
                        }
                      },
                      "plans": {
                        "type": "array",
                        "items": {
                          "type": "object",
                          "required": [
                            "plan",
                            "attempts",
                            "successes",
                            "declines",
                            "successRateBps",
                            "declineRateBps",
                            "latestSuccess"
                          ],
                          "properties": {
                            "plan": {
                              "type": "string"
                            },
                            "attempts": {
                              "type": "integer",
                              "minimum": 0
                            },
                            "successes": {
                              "type": "integer",
                              "minimum": 0
                            },
                            "declines": {
                              "type": "integer",
                              "minimum": 0
                            },
                            "successRateBps": {
                              "type": [
                                "integer",
                                "null"
                              ],
                              "minimum": 0,
                              "maximum": 10000
                            },
                            "declineRateBps": {
                              "type": [
                                "integer",
                                "null"
                              ],
                              "minimum": 0,
                              "maximum": 10000
                            },
                            "latestSuccess": {
                              "type": [
                                "object",
                                "null"
                              ],
                              "required": [
                                "type",
                                "plan",
                                "priceMajor",
                                "currency",
                                "completedAt"
                              ],
                              "properties": {
                                "type": {
                                  "type": "string"
                                },
                                "plan": {
                                  "type": "string"
                                },
                                "priceMajor": {
                                  "type": "string"
                                },
                                "currency": {
                                  "type": "string"
                                },
                                "completedAt": {
                                  "type": "string"
                                },
                                "estimatedUsd": {
                                  "type": "string"
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                },
                "statistics": {
                  "$ref": "#/components/schemas/GptStatistics"
                }
              }
            }
          }
        }
      }
    }
  },
  "401": {
    "$ref": "#/components/responses/Unauthorized"
  },
  "403": {
    "$ref": "#/components/responses/Forbidden"
  },
  "408": {
    "$ref": "#/components/responses/RequestTimeout"
  },
  "429": {
    "$ref": "#/components/responses/RateLimited"
  },
  "500": {
    "$ref": "#/components/responses/ServerError"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### GET `/api/v1/openai-prices`

查询匿名成功支付参考与 BIN 成功率

操作：`listOpenAIPaymentReferences`；权限：`gpt:read`。

只读、无付款副作用。与站内页面复用查询及统计口径，禁止缓存；受同一账户限流。零样本成功率为 null。

响应：
```json
{
  "200": {
    "description": "公开统计",
    "content": {
      "application/json": {
        "schema": {
          "type": "object",
          "required": [
            "code",
            "data"
          ],
          "properties": {
            "code": {
              "const": 0
            },
            "data": {
              "type": "object",
              "required": [
                "references",
                "binStats",
                "referenceLimit",
                "statistics"
              ],
              "properties": {
                "references": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "required": [
                      "bin6",
                      "type",
                      "plan",
                      "priceMajor",
                      "currency",
                      "completedAt"
                    ],
                    "properties": {
                      "bin6": {
                        "type": [
                          "string",
                          "null"
                        ]
                      },
                      "type": {
                        "type": "string"
                      },
                      "plan": {
                        "type": "string"
                      },
                      "priceMajor": {
                        "type": "string"
                      },
                      "currency": {
                        "type": "string"
                      },
                      "completedAt": {
                        "type": "string"
                      },
                      "estimatedUsd": {
                        "type": "string"
                      }
                    }
                  }
                },
                "binStats": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "required": [
                      "bin6",
                      "overall",
                      "plans"
                    ],
                    "properties": {
                      "bin6": {
                        "type": "string"
                      },
                      "overall": {
                        "type": "object",
                        "required": [
                          "attempts",
                          "successes",
                          "declines",
                          "successRateBps",
                          "declineRateBps"
                        ],
                        "properties": {
                          "attempts": {
                            "type": "integer",
                            "minimum": 0
                          },
                          "successes": {
                            "type": "integer",
                            "minimum": 0
                          },
                          "declines": {
                            "type": "integer",
                            "minimum": 0
                          },
                          "successRateBps": {
                            "type": [
                              "integer",
                              "null"
                            ],
                            "minimum": 0,
                            "maximum": 10000
                          },
                          "declineRateBps": {
                            "type": [
                              "integer",
                              "null"
                            ],
                            "minimum": 0,
                            "maximum": 10000
                          }
                        }
                      },
                      "plans": {
                        "type": "array",
                        "items": {
                          "type": "object",
                          "required": [
                            "plan",
                            "attempts",
                            "successes",
                            "declines",
                            "successRateBps",
                            "declineRateBps",
                            "latestSuccess"
                          ],
                          "properties": {
                            "plan": {
                              "type": "string"
                            },
                            "attempts": {
                              "type": "integer",
                              "minimum": 0
                            },
                            "successes": {
                              "type": "integer",
                              "minimum": 0
                            },
                            "declines": {
                              "type": "integer",
                              "minimum": 0
                            },
                            "successRateBps": {
                              "type": [
                                "integer",
                                "null"
                              ],
                              "minimum": 0,
                              "maximum": 10000
                            },
                            "declineRateBps": {
                              "type": [
                                "integer",
                                "null"
                              ],
                              "minimum": 0,
                              "maximum": 10000
                            },
                            "latestSuccess": {
                              "type": [
                                "object",
                                "null"
                              ],
                              "required": [
                                "type",
                                "plan",
                                "priceMajor",
                                "currency",
                                "completedAt"
                              ],
                              "properties": {
                                "type": {
                                  "type": "string"
                                },
                                "plan": {
                                  "type": "string"
                                },
                                "priceMajor": {
                                  "type": "string"
                                },
                                "currency": {
                                  "type": "string"
                                },
                                "completedAt": {
                                  "type": "string"
                                },
                                "estimatedUsd": {
                                  "type": "string"
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                },
                "referenceLimit": {
                  "type": "integer",
                  "minimum": 0
                },
                "statistics": {
                  "$ref": "#/components/schemas/GptStatistics"
                }
              }
            }
          }
        }
      }
    }
  },
  "401": {
    "$ref": "#/components/responses/Unauthorized"
  },
  "403": {
    "$ref": "#/components/responses/Forbidden"
  },
  "408": {
    "$ref": "#/components/responses/RequestTimeout"
  },
  "429": {
    "$ref": "#/components/responses/RateLimited"
  },
  "500": {
    "$ref": "#/components/responses/ServerError"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### GET `/api/v1/gpt-direct/observed-quotes`

查询近期预检实时报价

操作：`listObservedOpenAIQuotes`；权限：`gpt:read`。

只读、无付款副作用。与站内页面复用查询及统计口径，禁止缓存；受同一账户限流。零样本成功率为 null。

响应：
```json
{
  "200": {
    "description": "公开统计",
    "content": {
      "application/json": {
        "schema": {
          "type": "object",
          "required": [
            "code",
            "data"
          ],
          "properties": {
            "code": {
              "const": 0
            },
            "data": {
              "type": "object",
              "required": [
                "list",
                "statistics"
              ],
              "properties": {
                "list": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "description": "每个套餐最新有效样本，包含该样本的付款地区；非本账号最终报价。",
                    "required": [
                      "plan",
                      "country",
                      "currency",
                      "amountMajor",
                      "amountUsd",
                      "observedAt",
                      "fxDate"
                    ],
                    "properties": {
                      "plan": {
                        "type": "string"
                      },
                      "country": {
                        "type": "string"
                      },
                      "currency": {
                        "type": "string"
                      },
                      "amountMajor": {
                        "type": "string"
                      },
                      "amountUsd": {
                        "type": "string"
                      },
                      "observedAt": {
                        "type": "string"
                      },
                      "fxDate": {
                        "type": "string",
                        "format": "date"
                      }
                    }
                  }
                },
                "statistics": {
                  "$ref": "#/components/schemas/GptStatistics"
                }
              }
            }
          }
        }
      }
    }
  },
  "401": {
    "$ref": "#/components/responses/Unauthorized"
  },
  "403": {
    "$ref": "#/components/responses/Forbidden"
  },
  "408": {
    "$ref": "#/components/responses/RequestTimeout"
  },
  "429": {
    "$ref": "#/components/responses/RateLimited"
  },
  "500": {
    "$ref": "#/components/responses/ServerError"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### GET `/api/v1/gpt-direct/plans`

查询 OpenAI 套餐和报价

操作：`listOpenAIPlans`；权限：`gpt:read`。

返回当前可购买的 OpenAI 直充套餐、币种、服务费和金额边界；报价以响应时版本为准。

响应：
```json
{
  "200": {
    "description": "套餐报价",
    "headers": {
      "X-Request-Id": {
        "$ref": "#/components/headers/RequestId"
      }
    },
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/GptPlansResponse"
        }
      }
    }
  },
  "401": {
    "$ref": "#/components/responses/Unauthorized"
  },
  "403": {
    "$ref": "#/components/responses/Forbidden"
  },
  "408": {
    "$ref": "#/components/responses/RequestTimeout"
  },
  "429": {
    "$ref": "#/components/responses/RateLimited"
  },
  "500": {
    "$ref": "#/components/responses/ServerError"
  },
  "502": {
    "$ref": "#/components/responses/BadGateway"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### POST `/api/v1/gpt-direct/preflight`

预检 OpenAI 账户

操作：`preflightOpenAIAccount`；权限：`gpt:write`。

提交完整凭据进行短期预检。可选 customProxyUrl 会先验证连通性与出口国家，填写后本次链路不会使用平台代理。请求与响应不得写入日志；preflightToken 仅保存不可逆摘要、只可由发起预检的用户对当前服务商使用一次，且到期后必须重新预检。

请求：
```json
{
  "required": true,
  "content": {
    "application/json": {
      "schema": {
        "$ref": "#/components/schemas/GptPreflightInput"
      },
      "examples": {
        "session": {
          "summary": "使用完整会话 JSON 预检",
          "value": {
            "credential": {
              "mode": "session",
              "session": "{\"sessionToken\":\"REDACTED_EXAMPLE\",\"accessToken\":\"REDACTED_EXAMPLE\"}"
            },
            "paymentCountry": "PH",
            "paymentCurrency": "PHP",
            "customProxyUrl": "socks5://user:password@proxy.example.com:1080"
          }
        }
      }
    }
  }
}
```

响应：
```json
{
  "200": {
    "description": "预检结果",
    "headers": {
      "Cache-Control": {
        "schema": {
          "type": "string",
          "pattern": "(?:^|,)\\s*no-store(?:,|$)",
          "example": "no-store, private"
        }
      },
      "X-Request-Id": {
        "$ref": "#/components/headers/RequestId"
      }
    },
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/GptPreflightResponse"
        }
      }
    }
  },
  "400": {
    "$ref": "#/components/responses/InvalidRequest"
  },
  "401": {
    "$ref": "#/components/responses/Unauthorized"
  },
  "403": {
    "$ref": "#/components/responses/Forbidden"
  },
  "408": {
    "$ref": "#/components/responses/RequestTimeout"
  },
  "413": {
    "$ref": "#/components/responses/PayloadTooLarge"
  },
  "415": {
    "$ref": "#/components/responses/UnsupportedMediaType"
  },
  "429": {
    "$ref": "#/components/responses/RateLimited"
  },
  "500": {
    "$ref": "#/components/responses/ServerError"
  },
  "502": {
    "$ref": "#/components/responses/BadGateway"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### POST `/api/v1/gpt-direct/orders/{id}/session`

补交 Session 继续核对原订单

操作：`replaceOpenAIOrderSession`；权限：`gpt:write`。

仅 nextAction=submit_session（requires_action + session_refresh_required）允许补交原账号完整 Session。验证同账号后继续原订单、原账单和支付 checkpoint；不重复支付成功款项，必要时完成原支付。202仅表示受理，快照可能尚未同步；重复提交可能409，请先查订单。不可用于已结束订单或任意重启支付。

参数：
```json
[
  {
    "$ref": "#/components/parameters/UuidId"
  }
]
```

请求：
```json
{
  "required": true,
  "content": {
    "application/json": {
      "schema": {
        "$ref": "#/components/schemas/GptReplaceSessionInput"
      },
      "example": {
        "credential": {
          "mode": "session",
          "session": "{\"sessionToken\":\"REDACTED_EXAMPLE\",\"accessToken\":\"REDACTED_EXAMPLE\"}"
        }
      }
    }
  }
}
```

响应：
```json
{
  "202": {
    "description": "Session 已受理，请继续查询原订单",
    "headers": {
      "Cache-Control": {
        "description": "敏感响应禁止缓存。",
        "schema": {
          "type": "string",
          "pattern": "(?:^|,)\\s*no-store(?:,|$)",
          "example": "no-store, private"
        }
      },
      "X-Request-Id": {
        "$ref": "#/components/headers/RequestId"
      }
    },
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/GptOrderResponse"
        }
      }
    }
  },
  "400": {
    "$ref": "#/components/responses/InvalidRequest"
  },
  "401": {
    "$ref": "#/components/responses/Unauthorized"
  },
  "403": {
    "$ref": "#/components/responses/Forbidden"
  },
  "404": {
    "$ref": "#/components/responses/NotFound"
  },
  "408": {
    "$ref": "#/components/responses/RequestTimeout"
  },
  "409": {
    "$ref": "#/components/responses/Conflict"
  },
  "413": {
    "$ref": "#/components/responses/PayloadTooLarge"
  },
  "415": {
    "$ref": "#/components/responses/UnsupportedMediaType"
  },
  "429": {
    "$ref": "#/components/responses/RateLimited"
  },
  "500": {
    "$ref": "#/components/responses/ServerError"
  },
  "502": {
    "$ref": "#/components/responses/BadGateway"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### GET `/api/v1/gpt-direct/orders`

查询直充订单

操作：`listOpenAIOrders`；权限：`gpt:read`。

分页返回当前调用方创建的 OpenAI 直充订单，不返回会话凭据或完整支付卡信息。

参数：
```json
[
  {
    "$ref": "#/components/parameters/Page"
  },
  {
    "$ref": "#/components/parameters/PageSize"
  },
  {
    "name": "q",
    "in": "query",
    "schema": {
      "type": "string",
      "maxLength": 320
    },
    "description": "本人订单邮箱大小写不敏感子串搜索。"
  }
]
```

响应：
```json
{
  "200": {
    "description": "分页订单",
    "headers": {
      "X-Request-Id": {
        "$ref": "#/components/headers/RequestId"
      }
    },
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/GptOrdersResponse"
        }
      }
    }
  },
  "401": {
    "$ref": "#/components/responses/Unauthorized"
  },
  "403": {
    "$ref": "#/components/responses/Forbidden"
  },
  "408": {
    "$ref": "#/components/responses/RequestTimeout"
  },
  "429": {
    "$ref": "#/components/responses/RateLimited"
  },
  "500": {
    "$ref": "#/components/responses/ServerError"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### POST `/api/v1/gpt-direct/orders`

创建直充订单

操作：`createOpenAIOrder`；权限：`gpt:write`。

自动取消续费按当前API Key的设置固定到新订单，默认开启；在开发者页面关闭后跳过本站自动取消步骤。若在GPT中重新开启自动续费，下个账单日仍可能扣款。使用当前预检结果创建订单。cardId>0 使用本人 ACTIVE 卡；cardId=0 时只能且必须提供 externalCard 或 autoCard。受理202不是支付成功；请求超时先查询或使用原 Idempotency-Key 重放，禁止为同一支付意图换键重下。

参数：
```json
[
  {
    "$ref": "#/components/parameters/IdempotencyKey"
  }
]
```

请求：
```json
{
  "required": true,
  "content": {
    "application/json": {
      "schema": {
        "$ref": "#/components/schemas/GptCreateOrderInput"
      },
      "examples": {
        "create": {
          "summary": "使用预检报价创建订单",
          "value": {
            "cardId": 123,
            "plan": "plus",
            "credential": {
              "mode": "session",
              "session": "{\"sessionToken\":\"REDACTED_EXAMPLE\",\"accessToken\":\"REDACTED_EXAMPLE\"}"
            },
            "preflightToken": "preflight_example_token",
            "clientRequestId": "merchant-order-001",
            "pricingVersion": 1,
            "expectedCustomerServiceFee": "1.00"
          }
        },
        "externalCard": {
          "summary": "使用站外卡和自定义代理创建订单",
          "value": {
            "cardId": 0,
            "externalCard": {
              "number": "4242424242424242",
              "expiry": "12/30",
              "cvv": "123"
            },
            "plan": "plus",
            "credential": {
              "mode": "session",
              "session": "{\"sessionToken\":\"REDACTED_EXAMPLE\",\"accessToken\":\"REDACTED_EXAMPLE\"}"
            },
            "preflightToken": "preflight_example_token",
            "clientRequestId": "merchant-order-external-001",
            "pricingVersion": 1,
            "expectedCustomerServiceFee": "1.00"
          }
        }
      }
    }
  }
}
```

响应：
```json
{
  "202": {
    "description": "订单已受理或幂等重放",
    "headers": {
      "X-Request-Id": {
        "$ref": "#/components/headers/RequestId"
      }
    },
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/GptOrderResponse"
        }
      }
    }
  },
  "400": {
    "$ref": "#/components/responses/InvalidRequest"
  },
  "401": {
    "$ref": "#/components/responses/Unauthorized"
  },
  "403": {
    "$ref": "#/components/responses/Forbidden"
  },
  "404": {
    "$ref": "#/components/responses/NotFound"
  },
  "408": {
    "$ref": "#/components/responses/RequestTimeout"
  },
  "409": {
    "$ref": "#/components/responses/Conflict"
  },
  "413": {
    "$ref": "#/components/responses/PayloadTooLarge"
  },
  "415": {
    "$ref": "#/components/responses/UnsupportedMediaType"
  },
  "422": {
    "$ref": "#/components/responses/Unprocessable"
  },
  "429": {
    "$ref": "#/components/responses/RateLimited"
  },
  "500": {
    "$ref": "#/components/responses/ServerError"
  },
  "502": {
    "$ref": "#/components/responses/BadGateway"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### GET `/api/v1/gpt-direct/orders/{id}`

查询直充订单详情与事件

操作：`getOpenAIOrder`；权限：`gpt:read`。

跨账户访问统一返回 404。事件可能重复或延迟，业务终态以 order.status 为准。

参数：
```json
[
  {
    "$ref": "#/components/parameters/UuidId"
  }
]
```

响应：
```json
{
  "200": {
    "description": "订单详情",
    "headers": {
      "X-Request-Id": {
        "$ref": "#/components/headers/RequestId"
      }
    },
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/GptOrderDetailResponse"
        }
      }
    }
  },
  "401": {
    "$ref": "#/components/responses/Unauthorized"
  },
  "403": {
    "$ref": "#/components/responses/Forbidden"
  },
  "404": {
    "$ref": "#/components/responses/NotFound"
  },
  "408": {
    "$ref": "#/components/responses/RequestTimeout"
  },
  "429": {
    "$ref": "#/components/responses/RateLimited"
  },
  "500": {
    "$ref": "#/components/responses/ServerError"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### POST `/api/v1/gpt-direct/orders/{id}/cancel`

请求取消直充订单

操作：`cancelOpenAIOrder`；权限：`gpt:write`。

仅可取消尚未开始支付的订单。该操作按订单资源天然幂等：受理返回 202；重复请求会返回当前订单摘要和 202，不会再次派发取消。

参数：
```json
[
  {
    "$ref": "#/components/parameters/UuidId"
  }
]
```

响应：
```json
{
  "202": {
    "description": "取消请求已受理",
    "headers": {
      "X-Request-Id": {
        "$ref": "#/components/headers/RequestId"
      }
    },
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/GptOrderResponse"
        }
      }
    }
  },
  "400": {
    "$ref": "#/components/responses/InvalidRequest"
  },
  "401": {
    "$ref": "#/components/responses/Unauthorized"
  },
  "403": {
    "$ref": "#/components/responses/Forbidden"
  },
  "404": {
    "$ref": "#/components/responses/NotFound"
  },
  "408": {
    "$ref": "#/components/responses/RequestTimeout"
  },
  "409": {
    "$ref": "#/components/responses/Conflict"
  },
  "429": {
    "$ref": "#/components/responses/RateLimited"
  },
  "500": {
    "$ref": "#/components/responses/ServerError"
  },
  "502": {
    "$ref": "#/components/responses/BadGateway"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### POST `/api/v1/gpt-direct/orders/{id}/cancel-renewal`

取消直充订单自动续费

操作：`cancelOpenAIRenewal`；权限：`gpt:write`。

为当前账户已完成且仍会自动续费的订单提交一份新的 ChatGPT 凭据，并关闭自动续费。跨账户访问统一返回 404；成功响应和凭据均不得缓存。该操作不要求 Idempotency-Key。

参数：
```json
[
  {
    "$ref": "#/components/parameters/UuidId"
  }
]
```

请求：
```json
{
  "required": true,
  "content": {
    "application/json": {
      "schema": {
        "$ref": "#/components/schemas/GptCancelRenewalInput"
      },
      "example": {
        "credential": {
          "mode": "session",
          "session": "{\"sessionToken\":\"REDACTED_EXAMPLE\",\"accessToken\":\"REDACTED_EXAMPLE\"}"
        }
      }
    }
  }
}
```

响应：
```json
{
  "200": {
    "description": "自动续费已关闭",
    "headers": {
      "Cache-Control": {
        "description": "敏感响应禁止缓存。",
        "schema": {
          "type": "string",
          "pattern": "(?:^|,)\\s*no-store(?:,|$)",
          "example": "no-store, private"
        }
      },
      "X-Request-Id": {
        "$ref": "#/components/headers/RequestId"
      }
    },
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/GptOrderResponse"
        }
      }
    }
  },
  "400": {
    "$ref": "#/components/responses/InvalidRequest"
  },
  "401": {
    "$ref": "#/components/responses/Unauthorized"
  },
  "403": {
    "$ref": "#/components/responses/Forbidden"
  },
  "404": {
    "$ref": "#/components/responses/NotFound"
  },
  "408": {
    "$ref": "#/components/responses/RequestTimeout"
  },
  "409": {
    "$ref": "#/components/responses/Conflict"
  },
  "413": {
    "$ref": "#/components/responses/PayloadTooLarge"
  },
  "415": {
    "$ref": "#/components/responses/UnsupportedMediaType"
  },
  "429": {
    "$ref": "#/components/responses/RateLimited"
  },
  "500": {
    "$ref": "#/components/responses/ServerError"
  },
  "502": {
    "$ref": "#/components/responses/BadGateway"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### GET `/api/v1/gpt-direct/cdks`

查询当前账户的 CDK

操作：`listPurchasedCdks`；权限：`cdk:read`。

最多返回最近 100 条；列表只显示 codePrefix，不返回完整兑换码。forceNewCard 标记该 CDK 兑换时是否必须新开并绑定一张卡。forceNewCardEnabled 只有在全部后端副本完成兼容升级并由平台开放后才为 true。

参数：
```json
[
  {
    "$ref": "#/components/parameters/Page"
  },
  {
    "$ref": "#/components/parameters/PageSize"
  }
]
```

响应：
```json
{
  "200": {
    "description": "CDK 列表",
    "headers": {
      "X-Request-Id": {
        "$ref": "#/components/headers/RequestId"
      }
    },
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/CdksResponse"
        }
      }
    }
  },
  "401": {
    "$ref": "#/components/responses/Unauthorized"
  },
  "403": {
    "$ref": "#/components/responses/Forbidden"
  },
  "408": {
    "$ref": "#/components/responses/RequestTimeout"
  },
  "429": {
    "$ref": "#/components/responses/RateLimited"
  },
  "500": {
    "$ref": "#/components/responses/ServerError"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### GET `/api/v1/gpt-direct/cdk-offers`

查询 CDK 售价和库存

操作：`listCdkOffers`；权限：`cdk:read`。

返回当前 OpenAI CDK 套餐的有效美元售价、报价状态和可用库存，不返回未购买的兑换码。平台可使用固定售价，或按最低有效美元报价叠加固定美元/百分比加价；非美元报价会先按参考汇率折算为美元。动态报价有效期为 24 小时，参考汇率有效期独立为 6 小时；任一过期时返回 enabled=false、salePrice=null、pricingStatus=WAITING_QUOTE。最终有效售价受平台未售库存资金成本底价保护。

响应：
```json
{
  "200": {
    "description": "当前报价",
    "headers": {
      "X-Request-Id": {
        "$ref": "#/components/headers/RequestId"
      }
    },
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/CdkOffersResponse"
        }
      }
    }
  },
  "401": {
    "$ref": "#/components/responses/Unauthorized"
  },
  "403": {
    "$ref": "#/components/responses/Forbidden"
  },
  "408": {
    "$ref": "#/components/responses/RequestTimeout"
  },
  "429": {
    "$ref": "#/components/responses/RateLimited"
  },
  "500": {
    "$ref": "#/components/responses/ServerError"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### POST `/api/v1/gpt-direct/cdks/generate`

生成 CDK

操作：`generateCdks`；权限：`cdk:purchase`。

生成 1–50 张当前账户自有 CDK，生成时不扣套餐费。forceNewCard 默认 false；为 true 时，每张 CDK 兑换只新开并绑定一张卡，不使用已有卡；该卡支付失败时不再开第二张，且不会进入普通 CDK 的自动选卡池。开卡费由 CDK 生成者承担。同一 Idempotency-Key 和完全相同的请求只生成一个批次；改变 plan、quantity 或 forceNewCard 必须使用新幂等键。完整兑换码只在成功响应及同幂等请求的恢复窗口内返回。 paymentCountry 可选择结账地区，省略时固定生成当时的默认地区；成功及幂等重放返回 checkoutRegion。改变地区须使用新的幂等键。

参数：
```json
[
  {
    "$ref": "#/components/parameters/IdempotencyKey"
  }
]
```

请求：
```json
{
  "required": true,
  "content": {
    "application/json": {
      "schema": {
        "$ref": "#/components/schemas/CdkGenerateInput"
      },
      "example": {
        "plan": "plus",
        "quantity": 2,
        "forceNewCard": true,
        "paymentCountry": "US"
      }
    }
  }
}
```

响应：
```json
{
  "200": {
    "description": "生成完成或成功重放",
    "headers": {
      "Cache-Control": {
        "schema": {
          "type": "string",
          "pattern": "(?:^|,)\\s*no-store(?:,|$)",
          "example": "no-store, private"
        }
      },
      "X-Request-Id": {
        "$ref": "#/components/headers/RequestId"
      }
    },
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/CdkGenerateResponse"
        }
      }
    }
  },
  "400": {
    "$ref": "#/components/responses/InvalidRequest"
  },
  "401": {
    "$ref": "#/components/responses/Unauthorized"
  },
  "403": {
    "$ref": "#/components/responses/Forbidden"
  },
  "404": {
    "$ref": "#/components/responses/NotFound"
  },
  "408": {
    "$ref": "#/components/responses/RequestTimeout"
  },
  "409": {
    "$ref": "#/components/responses/Conflict"
  },
  "413": {
    "$ref": "#/components/responses/PayloadTooLarge"
  },
  "415": {
    "$ref": "#/components/responses/UnsupportedMediaType"
  },
  "422": {
    "$ref": "#/components/responses/Unprocessable"
  },
  "429": {
    "$ref": "#/components/responses/RateLimited"
  },
  "500": {
    "$ref": "#/components/responses/ServerError"
  },
  "502": {
    "$ref": "#/components/responses/BadGateway"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### POST `/api/public/cdk/preview`

预览直充 CDK

操作：`previewPublicCdk`；权限：`按接口鉴权要求`。

校验兑换码并返回套餐与一次性 redemptionToken，不会开始扣款。公开兑换接口不使用 App-Id/App-Secret；同一兑换设备必须在后续步骤持续传递同一个 UUID。

参数：
```json
[
  {
    "$ref": "#/components/parameters/RedemptionDevice"
  }
]
```

请求：
```json
{
  "required": true,
  "content": {
    "application/json": {
      "schema": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "code"
        ],
        "properties": {
          "code": {
            "type": "string",
            "minLength": 8
          }
        }
      },
      "example": {
        "code": "GPTD-XXXX-XXXX-XXXX"
      }
    }
  }
}
```

响应：
```json
{
  "200": {
    "description": "CDK 预览",
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/PublicCdkResponse"
        }
      }
    }
  },
  "400": {
    "$ref": "#/components/responses/InvalidRequest"
  },
  "404": {
    "$ref": "#/components/responses/NotFound"
  },
  "409": {
    "$ref": "#/components/responses/Conflict"
  },
  "429": {
    "$ref": "#/components/responses/RateLimited"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### POST `/api/public/cdk/preflight`

检查直充账号与报价

操作：`preflightPublicCdk`；权限：`按接口鉴权要求`。

使用 preview 返回的 redemptionToken 和 ChatGPT session 完成账号、套餐与实时报价预检，返回一次性 preflightToken。session 只用于本次直充，不会在响应中回显。

参数：
```json
[
  {
    "$ref": "#/components/parameters/RedemptionDevice"
  }
]
```

请求：
```json
{
  "required": true,
  "content": {
    "application/json": {
      "schema": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "redemptionToken",
          "credential"
        ],
        "properties": {
          "redemptionToken": {
            "type": "string"
          },
          "credential": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "mode",
              "session"
            ],
            "properties": {
              "mode": {
                "type": "string",
                "const": "session"
              },
              "session": {
                "type": "string",
                "minLength": 20
              }
            }
          }
        }
      },
      "example": {
        "redemptionToken": "<preview 返回值>",
        "credential": {
          "mode": "session",
          "session": "<ChatGPT session JSON>"
        }
      }
    }
  }
}
```

响应：
```json
{
  "200": {
    "description": "预检结果",
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/PublicCdkResponse"
        }
      }
    }
  },
  "400": {
    "$ref": "#/components/responses/InvalidRequest"
  },
  "409": {
    "$ref": "#/components/responses/Conflict"
  },
  "422": {
    "$ref": "#/components/responses/Unprocessable"
  },
  "429": {
    "$ref": "#/components/responses/RateLimited"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### POST `/api/public/cdk/redeem`

提交 CDK 直充

操作：`redeemPublicCdk`；权限：`按接口鉴权要求`。

提交预检令牌并创建直充订单。clientRequestId 必须是客户端生成的 UUID；网络重试必须复用原值，避免创建重复订单。

参数：
```json
[
  {
    "$ref": "#/components/parameters/RedemptionDevice"
  }
]
```

请求：
```json
{
  "required": true,
  "content": {
    "application/json": {
      "schema": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "redemptionToken",
          "preflightToken",
          "clientRequestId"
        ],
        "properties": {
          "redemptionToken": {
            "type": "string"
          },
          "preflightToken": {
            "type": "string"
          },
          "clientRequestId": {
            "type": "string",
            "format": "uuid"
          }
        }
      }
    }
  }
}
```

响应：
```json
{
  "200": {
    "description": "订单已创建或幂等重放",
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/PublicCdkResponse"
        }
      }
    }
  },
  "202": {
    "description": "订单处理中",
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/PublicCdkResponse"
        }
      }
    }
  },
  "400": {
    "$ref": "#/components/responses/InvalidRequest"
  },
  "409": {
    "$ref": "#/components/responses/Conflict"
  },
  "429": {
    "$ref": "#/components/responses/RateLimited"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### POST `/api/public/cdk/result`

查询 CDK 直充结果

操作：`getPublicCdkResult`；权限：`按接口鉴权要求`。

使用 redemptionToken 轮询订单进度、公开步骤时间线和最终结果。cardLastFour 为当前支付尝试记录的支付卡后四位，未记录时为 null，不代表扣款已成功。终态后停止轮询。

参数：
```json
[
  {
    "$ref": "#/components/parameters/RedemptionDevice"
  }
]
```

请求：
```json
{
  "required": true,
  "content": {
    "application/json": {
      "schema": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "redemptionToken"
        ],
        "properties": {
          "redemptionToken": {
            "type": "string"
          }
        }
      }
    }
  }
}
```

响应：
```json
{
  "200": {
    "description": "当前订单结果",
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/PublicCdkResponse"
        }
      }
    }
  },
  "400": {
    "$ref": "#/components/responses/InvalidRequest"
  },
  "404": {
    "$ref": "#/components/responses/NotFound"
  },
  "429": {
    "$ref": "#/components/responses/RateLimited"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### POST `/api/public/cdk/receipt`

按兑换码查询直充凭证

操作：`getPublicCdkReceipt`；权限：`按接口鉴权要求`。

在原兑换设备上使用完整 CDK 查询已创建订单的公开凭证；不会返回支付卡敏感信息。

参数：
```json
[
  {
    "$ref": "#/components/parameters/RedemptionDevice"
  }
]
```

请求：
```json
{
  "required": true,
  "content": {
    "application/json": {
      "schema": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "code"
        ],
        "properties": {
          "code": {
            "type": "string"
          }
        }
      }
    }
  }
}
```

响应：
```json
{
  "200": {
    "description": "直充凭证",
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/PublicCdkResponse"
        }
      }
    }
  },
  "400": {
    "$ref": "#/components/responses/InvalidRequest"
  },
  "404": {
    "$ref": "#/components/responses/NotFound"
  },
  "429": {
    "$ref": "#/components/responses/RateLimited"
  }
}
```

### POST `/api/public/cdk/cancel-renewal`

取消 CDK 直充自动续费

操作：`cancelPublicCdkRenewal`；权限：`按接口鉴权要求`。

直充成功后，可使用 redemptionToken 和同一 ChatGPT session 请求取消自动续费，并通过 result 查询结果。

参数：
```json
[
  {
    "$ref": "#/components/parameters/RedemptionDevice"
  }
]
```

请求：
```json
{
  "required": true,
  "content": {
    "application/json": {
      "schema": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "redemptionToken",
          "credential"
        ],
        "properties": {
          "redemptionToken": {
            "type": "string"
          },
          "credential": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "mode",
              "session"
            ],
            "properties": {
              "mode": {
                "type": "string",
                "const": "session"
              },
              "session": {
                "type": "string"
              }
            }
          }
        }
      }
    }
  }
}
```

响应：
```json
{
  "200": {
    "description": "取消请求结果",
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/PublicCdkResponse"
        }
      }
    }
  },
  "202": {
    "description": "取消处理中",
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/PublicCdkResponse"
        }
      }
    }
  },
  "400": {
    "$ref": "#/components/responses/InvalidRequest"
  },
  "409": {
    "$ref": "#/components/responses/Conflict"
  },
  "429": {
    "$ref": "#/components/responses/RateLimited"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### GET `/api/v1/operations/{id}`

查询资金操作状态

操作：`getOperation`；权限：`operations:read`。

只能读取由当前 API key 创建的操作；同一账户的其他 key 也会得到 404。key 删除后历史归属仍保留，新 key 不能接管查询或幂等重放。terminal=true 后停止轮询，并根据 status 判断成功或失败。

参数：
```json
[
  {
    "$ref": "#/components/parameters/UuidId"
  }
]
```

响应：
```json
{
  "200": {
    "description": "操作状态",
    "headers": {
      "X-Request-Id": {
        "$ref": "#/components/headers/RequestId"
      }
    },
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/OperationResponse"
        }
      }
    }
  },
  "401": {
    "$ref": "#/components/responses/Unauthorized"
  },
  "403": {
    "$ref": "#/components/responses/Forbidden"
  },
  "404": {
    "$ref": "#/components/responses/NotFound"
  },
  "408": {
    "$ref": "#/components/responses/RequestTimeout"
  },
  "429": {
    "$ref": "#/components/responses/RateLimited"
  },
  "500": {
    "$ref": "#/components/responses/ServerError"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### GET `/api/v1/x-direct/plans`

查询 X 套餐及服务费

操作：`listXDirectPlans`；权限：`x-direct:read`。

六种固定套餐；官方扣卡金额在 prepare 后取得。目录不保证账号有资格或卡片可付款。每项 serviceFee 是 USD 钱包费用，pricingVersion 是配置版本。

响应：
```json
{
  "200": {
    "description": "六个套餐及当前服务费配置。",
    "headers": {
      "X-Request-Id": {
        "$ref": "#/components/headers/RequestId"
      },
      "Cache-Control": {
        "schema": {
          "type": "string",
          "const": "no-store"
        },
        "description": "响应不可缓存。"
      }
    },
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/XDirectPlansResponse"
        }
      }
    }
  },
  "401": {
    "$ref": "#/components/responses/Unauthorized"
  },
  "403": {
    "$ref": "#/components/responses/Forbidden"
  },
  "408": {
    "description": "请求超过处理时限。不得据此判断是否付款；已知订单 ID 时先查询该订单，prepare 丢失响应时复用原 clientRequestId 和 Idempotency-Key。",
    "headers": {
      "X-Request-Id": {
        "$ref": "#/components/headers/RequestId"
      }
    },
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/Error"
        }
      }
    }
  },
  "429": {
    "$ref": "#/components/responses/RateLimited"
  },
  "500": {
    "$ref": "#/components/responses/ServerError"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### GET `/api/v1/x-direct/orders`

查询当前 key 的 X 付款订单

操作：`listXDirectOrders`；权限：`x-direct:read`。

仅当前账户且由当前 API key 创建、已派发资金操作的最近 50 条，按创建时间倒序，无分页。prepare-only 报价不进入此列表；应保存 prepare 返回的订单 ID。其他 key 或控制台创建的订单不可通过该 key 访问。

响应：
```json
{
  "200": {
    "description": "返回当前快照；请检查 data.status 和付款证据，勿以 HTTP 200 视为支付成功。",
    "headers": {
      "X-Request-Id": {
        "$ref": "#/components/headers/RequestId"
      },
      "Cache-Control": {
        "schema": {
          "type": "string",
          "const": "no-store"
        },
        "description": "响应不可缓存。"
      }
    },
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/XDirectOrdersResponse"
        }
      }
    }
  },
  "401": {
    "$ref": "#/components/responses/Unauthorized"
  },
  "403": {
    "$ref": "#/components/responses/Forbidden"
  },
  "408": {
    "description": "请求超过处理时限。不得据此判断是否付款；已知订单 ID 时先查询该订单，prepare 丢失响应时复用原 clientRequestId 和 Idempotency-Key。",
    "headers": {
      "X-Request-Id": {
        "$ref": "#/components/headers/RequestId"
      }
    },
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/Error"
        }
      }
    }
  },
  "429": {
    "$ref": "#/components/responses/RateLimited"
  },
  "500": {
    "$ref": "#/components/responses/ServerError"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### POST `/api/v1/x-direct/orders/prepare`

校验 X 账号并取得官方报价

操作：`prepareXDirectOrder`；权限：`x-direct:write`。

不提交卡片付款、不扣钱包服务费。使用本人已有可用卡片；服务端校验接收方和套餐，取得官方报价并保存服务费与配置版本。每账户每分钟最多创建 5 个新报价。同一 clientRequestId 必须复用相同 header 和参数，重放返回原订单当前快照。可返回 ineligible / review_required，只有 prepared 可确认。禁止提交 X Session/Cookie 或卡号/CVC。

参数：
```json
[
  {
    "$ref": "#/components/parameters/XDirectIdempotencyKey"
  }
]
```

请求：
```json
{
  "required": true,
  "content": {
    "application/json": {
      "schema": {
        "$ref": "#/components/schemas/XDirectPrepareInput"
      },
      "example": {
        "recipient": "example_user",
        "plan": "premium_3m",
        "cardId": 123,
        "clientRequestId": "00000000-0000-4000-8000-000000000001"
      }
    }
  }
}
```

响应：
```json
{
  "200": {
    "description": "返回当前快照；请检查 data.status 和付款证据，勿以 HTTP 200 视为支付成功。",
    "headers": {
      "X-Request-Id": {
        "$ref": "#/components/headers/RequestId"
      },
      "Cache-Control": {
        "schema": {
          "type": "string",
          "const": "no-store"
        },
        "description": "响应不可缓存。"
      }
    },
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/XDirectOrderResponse"
        }
      }
    }
  },
  "400": {
    "$ref": "#/components/responses/InvalidRequest"
  },
  "401": {
    "$ref": "#/components/responses/Unauthorized"
  },
  "403": {
    "$ref": "#/components/responses/Forbidden"
  },
  "408": {
    "description": "请求超过处理时限。不得据此判断是否付款；已知订单 ID 时先查询该订单，prepare 丢失响应时复用原 clientRequestId 和 Idempotency-Key。",
    "headers": {
      "X-Request-Id": {
        "$ref": "#/components/headers/RequestId"
      }
    },
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/Error"
        }
      }
    }
  },
  "409": {
    "$ref": "#/components/responses/Conflict"
  },
  "413": {
    "$ref": "#/components/responses/PayloadTooLarge"
  },
  "415": {
    "$ref": "#/components/responses/UnsupportedMediaType"
  },
  "422": {
    "$ref": "#/components/responses/Unprocessable"
  },
  "429": {
    "$ref": "#/components/responses/RateLimited"
  },
  "500": {
    "$ref": "#/components/responses/ServerError"
  },
  "502": {
    "$ref": "#/components/responses/BadGateway"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### GET `/api/v1/x-direct/orders/{id}`

查询或恢复 X 订单状态

操作：`getXDirectOrder`；权限：`x-direct:read`。

仅创建 key 可读。需要时查询原付款状态及账单，绝不重新付款。处理中可先返回持久快照；客户端退避查询。成功后 invoiceUrls 仍可稍后出现。付款不确定时保持原订单，不新建订单重试。

参数：
```json
[
  {
    "$ref": "#/components/parameters/UuidId"
  }
]
```

响应：
```json
{
  "200": {
    "description": "返回当前快照；请检查 data.status 和付款证据，勿以 HTTP 200 视为支付成功。",
    "headers": {
      "X-Request-Id": {
        "$ref": "#/components/headers/RequestId"
      },
      "Cache-Control": {
        "schema": {
          "type": "string",
          "const": "no-store"
        },
        "description": "响应不可缓存。"
      }
    },
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/XDirectOrderResponse"
        }
      }
    }
  },
  "401": {
    "$ref": "#/components/responses/Unauthorized"
  },
  "403": {
    "$ref": "#/components/responses/Forbidden"
  },
  "404": {
    "$ref": "#/components/responses/NotFound"
  },
  "408": {
    "description": "请求超过处理时限。不得据此判断是否付款；已知订单 ID 时先查询该订单，prepare 丢失响应时复用原 clientRequestId 和 Idempotency-Key。",
    "headers": {
      "X-Request-Id": {
        "$ref": "#/components/headers/RequestId"
      }
    },
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/Error"
        }
      }
    }
  },
  "429": {
    "$ref": "#/components/responses/RateLimited"
  },
  "500": {
    "$ref": "#/components/responses/ServerError"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### POST `/api/v1/x-direct/orders/{id}/confirm`

确认官方扣卡金额及钱包服务费并付款

操作：`confirmXDirectOrder`；权限：`x-direct:write`。

真实付款入口。应先向最终用户展示 recipient、plan、amountMinor/currency 和 serviceFee，确认后原样回传报价。报价自创建起 30 分钟内有效，配置版本改变返回 QUOTE_CHANGED；过期返回 QUOTE_EXPIRED。服务费从本站 USD 钱包扣除，官方金额从 cardId 对应卡片扣除。按订单原子状态转换防止重复派发：非 prepared 的重复请求返回当前状态；并发请求也可能 409，应 GET 同一订单。确定未扣卡的失败会退服务费；结果不确定时保持订单与资金锁，先查询，不新建付款。

参数：
```json
[
  {
    "$ref": "#/components/parameters/UuidId"
  },
  {
    "$ref": "#/components/parameters/XDirectIdempotencyKey"
  }
]
```

请求：
```json
{
  "required": true,
  "content": {
    "application/json": {
      "schema": {
        "$ref": "#/components/schemas/XDirectConfirmInput"
      },
      "example": {
        "expectedAmountMinor": 12345,
        "currency": "bdt",
        "expectedServiceFee": "1.00"
      }
    }
  }
}
```

响应：
```json
{
  "200": {
    "description": "返回当前快照；请检查 data.status 和付款证据，勿以 HTTP 200 视为支付成功。",
    "headers": {
      "X-Request-Id": {
        "$ref": "#/components/headers/RequestId"
      },
      "Cache-Control": {
        "schema": {
          "type": "string",
          "const": "no-store"
        },
        "description": "响应不可缓存。"
      }
    },
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/XDirectOrderResponse"
        }
      }
    }
  },
  "400": {
    "$ref": "#/components/responses/InvalidRequest"
  },
  "401": {
    "$ref": "#/components/responses/Unauthorized"
  },
  "403": {
    "$ref": "#/components/responses/Forbidden"
  },
  "404": {
    "$ref": "#/components/responses/NotFound"
  },
  "408": {
    "description": "请求超过处理时限。不得据此判断是否付款；已知订单 ID 时先查询该订单，prepare 丢失响应时复用原 clientRequestId 和 Idempotency-Key。",
    "headers": {
      "X-Request-Id": {
        "$ref": "#/components/headers/RequestId"
      }
    },
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/Error"
        }
      }
    }
  },
  "409": {
    "$ref": "#/components/responses/Conflict"
  },
  "413": {
    "$ref": "#/components/responses/PayloadTooLarge"
  },
  "415": {
    "$ref": "#/components/responses/UnsupportedMediaType"
  },
  "422": {
    "$ref": "#/components/responses/Unprocessable"
  },
  "429": {
    "$ref": "#/components/responses/RateLimited"
  },
  "500": {
    "$ref": "#/components/responses/ServerError"
  },
  "502": {
    "$ref": "#/components/responses/BadGateway"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### POST `/api/v1/x-direct/orders/{id}/cancel`

取消尚未派发付款的 X 报价

操作：`cancelXDirectOrder`；权限：`x-direct:write`。

仅未派发资金操作且状态为 prepared 或 review_required 时可取消。此接口不能撤销已提交付款，不能办理退款。无需请求体。重复取消已取消订单会返回 409，此时 GET 确认 cancelled 即可。

参数：
```json
[
  {
    "$ref": "#/components/parameters/UuidId"
  },
  {
    "$ref": "#/components/parameters/XDirectIdempotencyKey"
  }
]
```

响应：
```json
{
  "200": {
    "description": "返回当前快照；请检查 data.status 和付款证据，勿以 HTTP 200 视为支付成功。",
    "headers": {
      "X-Request-Id": {
        "$ref": "#/components/headers/RequestId"
      },
      "Cache-Control": {
        "schema": {
          "type": "string",
          "const": "no-store"
        },
        "description": "响应不可缓存。"
      }
    },
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/XDirectOrderResponse"
        }
      }
    }
  },
  "400": {
    "$ref": "#/components/responses/InvalidRequest"
  },
  "401": {
    "$ref": "#/components/responses/Unauthorized"
  },
  "403": {
    "$ref": "#/components/responses/Forbidden"
  },
  "404": {
    "$ref": "#/components/responses/NotFound"
  },
  "408": {
    "description": "请求超过处理时限。不得据此判断是否付款；已知订单 ID 时先查询该订单，prepare 丢失响应时复用原 clientRequestId 和 Idempotency-Key。",
    "headers": {
      "X-Request-Id": {
        "$ref": "#/components/headers/RequestId"
      }
    },
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/Error"
        }
      }
    }
  },
  "409": {
    "$ref": "#/components/responses/Conflict"
  },
  "413": {
    "$ref": "#/components/responses/PayloadTooLarge"
  },
  "415": {
    "$ref": "#/components/responses/UnsupportedMediaType"
  },
  "422": {
    "$ref": "#/components/responses/Unprocessable"
  },
  "429": {
    "$ref": "#/components/responses/RateLimited"
  },
  "500": {
    "$ref": "#/components/responses/ServerError"
  },
  "502": {
    "$ref": "#/components/responses/BadGateway"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### GET `/api/v1/x-direct/cdks`

查询发行的 X CDK

操作：`listXCdks`；权限：`x-direct:read`。

仅当前账户、当前创建 API key 的最近 100 张，无分页。生成免费，兑换时才由发行者承担费用。

响应：
```json
{
  "200": {
    "description": "当前业务结果；HTTP 200 不等于付款完成，检查 data.status。",
    "headers": {
      "X-Request-Id": {
        "$ref": "#/components/headers/RequestId"
      },
      "Cache-Control": {
        "schema": {
          "type": "string",
          "const": "no-store"
        }
      }
    },
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/XCdkListResponse"
        }
      }
    }
  },
  "400": {
    "$ref": "#/components/responses/InvalidRequest"
  },
  "401": {
    "$ref": "#/components/responses/Unauthorized"
  },
  "403": {
    "$ref": "#/components/responses/Forbidden"
  },
  "404": {
    "$ref": "#/components/responses/NotFound"
  },
  "408": {
    "description": "处理超时不证明没有资金操作。保留原标识，发行时同幂等键重试，兑换时先 result 查询原绑定。",
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/Error"
        }
      }
    }
  },
  "409": {
    "$ref": "#/components/responses/Conflict"
  },
  "422": {
    "$ref": "#/components/responses/Unprocessable"
  },
  "429": {
    "$ref": "#/components/responses/RateLimited"
  },
  "500": {
    "$ref": "#/components/responses/ServerError"
  },
  "502": {
    "$ref": "#/components/responses/BadGateway"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### POST `/api/v1/x-direct/cdks/generate`

免费生成 X CDK 并授权兑换资金上限

操作：`generateXCdks`；权限：`x-direct:write`。

固定每张钱包支出上限、官方金额上限和一次注资额，快照开卡/充值/X服务费。发行不扣款或冻结钱包；兑换时检查钱包余额、实际报价与配置。cardId/autoCard 二选一。同幂等键和相同参数重试返回原批次；不得换键重发以恢复丢失响应。示例金额均为占位值。

参数：
```json
[
  {
    "$ref": "#/components/parameters/XCdkIdempotencyKey"
  }
]
```

请求：
```json
{
  "required": true,
  "content": {
    "application/json": {
      "schema": {
        "$ref": "#/components/schemas/XCdkGenerateInput"
      },
      "example": {
        "plan": "premium_3m",
        "quantity": 1,
        "maxWalletDebitUsd": "30.00",
        "maxOfficialAmountMinor": 12345,
        "currency": "BDT",
        "fundingAmountUsd": "20.00",
        "cardId": 123
      }
    }
  }
}
```

响应：
```json
{
  "200": {
    "description": "当前业务结果；HTTP 200 不等于付款完成，检查 data.status。",
    "headers": {
      "X-Request-Id": {
        "$ref": "#/components/headers/RequestId"
      },
      "Cache-Control": {
        "schema": {
          "type": "string",
          "const": "no-store"
        }
      }
    },
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/XCdkGenerateResponse"
        }
      }
    }
  },
  "400": {
    "$ref": "#/components/responses/InvalidRequest"
  },
  "401": {
    "$ref": "#/components/responses/Unauthorized"
  },
  "403": {
    "$ref": "#/components/responses/Forbidden"
  },
  "404": {
    "$ref": "#/components/responses/NotFound"
  },
  "408": {
    "description": "处理超时不证明没有资金操作。保留原标识，发行时同幂等键重试，兑换时先 result 查询原绑定。",
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/Error"
        }
      }
    }
  },
  "409": {
    "$ref": "#/components/responses/Conflict"
  },
  "413": {
    "$ref": "#/components/responses/PayloadTooLarge"
  },
  "415": {
    "$ref": "#/components/responses/UnsupportedMediaType"
  },
  "422": {
    "$ref": "#/components/responses/Unprocessable"
  },
  "429": {
    "$ref": "#/components/responses/RateLimited"
  },
  "500": {
    "$ref": "#/components/responses/ServerError"
  },
  "502": {
    "$ref": "#/components/responses/BadGateway"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### GET `/api/v1/x-direct/cdks/{id}/export`

导出完整 X 兑换码

操作：`exportXCdk`；权限：`x-direct:write`。

返回 bearer 兑换码，要求 x-direct:write 和来源 IP 白名单；虽为 GET，不能授予只读 key。无 Idempotency-Key 要求，不记录响应正文。

参数：
```json
[
  {
    "$ref": "#/components/parameters/UuidId"
  }
]
```

响应：
```json
{
  "200": {
    "description": "当前业务结果；HTTP 200 不等于付款完成，检查 data.status。",
    "headers": {
      "X-Request-Id": {
        "$ref": "#/components/headers/RequestId"
      },
      "Cache-Control": {
        "schema": {
          "type": "string",
          "const": "no-store"
        }
      }
    },
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/XCdkExportResponse"
        }
      }
    }
  },
  "400": {
    "$ref": "#/components/responses/InvalidRequest"
  },
  "401": {
    "$ref": "#/components/responses/Unauthorized"
  },
  "403": {
    "$ref": "#/components/responses/Forbidden"
  },
  "404": {
    "$ref": "#/components/responses/NotFound"
  },
  "408": {
    "description": "处理超时不证明没有资金操作。保留原标识，发行时同幂等键重试，兑换时先 result 查询原绑定。",
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/Error"
        }
      }
    }
  },
  "409": {
    "$ref": "#/components/responses/Conflict"
  },
  "422": {
    "$ref": "#/components/responses/Unprocessable"
  },
  "429": {
    "$ref": "#/components/responses/RateLimited"
  },
  "500": {
    "$ref": "#/components/responses/ServerError"
  },
  "502": {
    "$ref": "#/components/responses/BadGateway"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### POST `/api/v1/x-direct/cdks/{id}/revoke`

撤销未派发资金操作的 X CDK

操作：`revokeXCdk`；权限：`x-direct:write`。

不能撤销已开卡/充值/付款的资金操作，不能退款；结果未知时不能以撤销解锁重兑。先查询状态。 支持重复撤销已撤销的码；header必填但不用于缓存响应。

参数：
```json
[
  {
    "$ref": "#/components/parameters/UuidId"
  },
  {
    "$ref": "#/components/parameters/XCdkIdempotencyKey"
  }
]
```

响应：
```json
{
  "200": {
    "description": "当前业务结果；HTTP 200 不等于付款完成，检查 data.status。",
    "headers": {
      "X-Request-Id": {
        "$ref": "#/components/headers/RequestId"
      },
      "Cache-Control": {
        "schema": {
          "type": "string",
          "const": "no-store"
        }
      }
    },
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/XCdkIssuerResponse"
        }
      }
    }
  },
  "400": {
    "$ref": "#/components/responses/InvalidRequest"
  },
  "401": {
    "$ref": "#/components/responses/Unauthorized"
  },
  "403": {
    "$ref": "#/components/responses/Forbidden"
  },
  "404": {
    "$ref": "#/components/responses/NotFound"
  },
  "408": {
    "description": "处理超时不证明没有资金操作。保留原标识，发行时同幂等键重试，兑换时先 result 查询原绑定。",
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/Error"
        }
      }
    }
  },
  "409": {
    "$ref": "#/components/responses/Conflict"
  },
  "422": {
    "$ref": "#/components/responses/Unprocessable"
  },
  "429": {
    "$ref": "#/components/responses/RateLimited"
  },
  "500": {
    "$ref": "#/components/responses/ServerError"
  },
  "502": {
    "$ref": "#/components/responses/BadGateway"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### POST `/api/public/x-cdk/preview`

预览 X 兑换码

操作：`previewXCdk`；权限：`按接口鉴权要求`。

仅查看套餐和兑换状态，不作资金操作。无需 App ID/Secret；使用独立 IP 频控。

请求：
```json
{
  "required": true,
  "content": {
    "application/json": {
      "schema": {
        "$ref": "#/components/schemas/XCdkPreviewInput"
      },
      "example": {
        "code": "<CDK_CODE>",
        "deviceToken": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
      }
    }
  }
}
```

响应：
```json
{
  "200": {
    "description": "当前业务结果；HTTP 200 不等于付款完成，检查 data.status。",
    "headers": {
      "X-Request-Id": {
        "$ref": "#/components/headers/RequestId"
      },
      "Cache-Control": {
        "schema": {
          "type": "string",
          "const": "no-store"
        }
      }
    },
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/XCdkPublicResponse"
        }
      }
    }
  },
  "400": {
    "$ref": "#/components/responses/InvalidRequest"
  },
  "404": {
    "$ref": "#/components/responses/NotFound"
  },
  "408": {
    "description": "处理超时不证明没有资金操作。保留原标识，发行时同幂等键重试，兑换时先 result 查询原绑定。",
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/Error"
        }
      }
    }
  },
  "409": {
    "$ref": "#/components/responses/Conflict"
  },
  "413": {
    "$ref": "#/components/responses/PayloadTooLarge"
  },
  "415": {
    "$ref": "#/components/responses/UnsupportedMediaType"
  },
  "422": {
    "$ref": "#/components/responses/Unprocessable"
  },
  "429": {
    "description": "此动作每来源 IP 每分钟最多 60 次；客户端退避等待下个窗口，保留原绑定，不重新生成请求标识。",
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/Error"
        }
      }
    }
  },
  "500": {
    "$ref": "#/components/responses/ServerError"
  },
  "502": {
    "$ref": "#/components/responses/BadGateway"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### POST `/api/public/x-cdk/preflight`

预检 X CDK 接收方和官方报价

操作：`preflightXCdk`；权限：`按接口鉴权要求`。

首次绑定code、随机deviceToken、clientRequestId和接收方，取得真实官方报价，不作资金操作。丢失响应原样重试。仅canRetryPreflight严格为true时，同设备可用新请求ID更正接收方。已prepared但过期、或已funded且付款尚未派发时，可以原设备/原请求ID/原接收方显式刷新官方报价，不重复开卡充值。已资CDK继续使用发行时授权的服务费快照；普通订单仍受当前服务费版本约束。

请求：
```json
{
  "required": true,
  "content": {
    "application/json": {
      "schema": {
        "$ref": "#/components/schemas/XCdkPreflightInput"
      },
      "example": {
        "code": "<CDK_CODE>",
        "deviceToken": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        "clientRequestId": "00000000-0000-4000-8000-000000000002",
        "recipient": "example_user"
      }
    }
  }
}
```

响应：
```json
{
  "200": {
    "description": "当前业务结果；HTTP 200 不等于付款完成，检查 data.status。",
    "headers": {
      "X-Request-Id": {
        "$ref": "#/components/headers/RequestId"
      },
      "Cache-Control": {
        "schema": {
          "type": "string",
          "const": "no-store"
        }
      }
    },
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/XCdkPublicResponse"
        }
      }
    }
  },
  "400": {
    "$ref": "#/components/responses/InvalidRequest"
  },
  "404": {
    "$ref": "#/components/responses/NotFound"
  },
  "408": {
    "description": "处理超时不证明没有资金操作。保留原标识，发行时同幂等键重试，兑换时先 result 查询原绑定。",
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/Error"
        }
      }
    }
  },
  "409": {
    "$ref": "#/components/responses/Conflict"
  },
  "413": {
    "$ref": "#/components/responses/PayloadTooLarge"
  },
  "415": {
    "$ref": "#/components/responses/UnsupportedMediaType"
  },
  "422": {
    "$ref": "#/components/responses/Unprocessable"
  },
  "429": {
    "description": "此动作每来源 IP 每分钟最多 10 次；客户端退避等待下个窗口，保留原绑定，不重新生成请求标识。",
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/Error"
        }
      }
    }
  },
  "500": {
    "$ref": "#/components/responses/ServerError"
  },
  "502": {
    "$ref": "#/components/responses/BadGateway"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### POST `/api/public/x-cdk/redeem`

兑换并由发行者钱包资助 X 付款

操作：`redeemXCdk`；权限：`按接口鉴权要求`。

两阶段真实资金入口。首次在 prepared 状态调用只执行授权的开卡/充值并返回 funding 或 funded；funded 后用户明确继续，第二次携带同一绑定和报价调用才派发 X 付款。result 只读，不自动推进付款。全部费用由发行者承担，不追加资金或FX缓冲。未知结果先查询原兑换，不换请求标识；卡内余款留给发行者，不自动退钱包。 已资CDK的服务费按数据库关联验证的发行快照收取，后续调价不会增加该授权；未资CDK若费用/版本变化则拒绝资金派发并要求发行者处理。

请求：
```json
{
  "required": true,
  "content": {
    "application/json": {
      "schema": {
        "$ref": "#/components/schemas/XCdkRedeemInput"
      },
      "example": {
        "code": "<CDK_CODE>",
        "deviceToken": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        "clientRequestId": "00000000-0000-4000-8000-000000000002",
        "expectedAmountMinor": 12345,
        "currency": "bdt"
      }
    }
  }
}
```

响应：
```json
{
  "200": {
    "description": "当前业务结果；HTTP 200 不等于付款完成，检查 data.status。",
    "headers": {
      "X-Request-Id": {
        "$ref": "#/components/headers/RequestId"
      },
      "Cache-Control": {
        "schema": {
          "type": "string",
          "const": "no-store"
        }
      }
    },
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/XCdkPublicResponse"
        }
      }
    }
  },
  "400": {
    "$ref": "#/components/responses/InvalidRequest"
  },
  "404": {
    "$ref": "#/components/responses/NotFound"
  },
  "408": {
    "description": "处理超时不证明没有资金操作。保留原标识，发行时同幂等键重试，兑换时先 result 查询原绑定。",
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/Error"
        }
      }
    }
  },
  "409": {
    "$ref": "#/components/responses/Conflict"
  },
  "413": {
    "$ref": "#/components/responses/PayloadTooLarge"
  },
  "415": {
    "$ref": "#/components/responses/UnsupportedMediaType"
  },
  "422": {
    "$ref": "#/components/responses/Unprocessable"
  },
  "429": {
    "description": "此动作每来源 IP 每分钟最多 10 次；客户端退避等待下个窗口，保留原绑定，不重新生成请求标识。",
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/Error"
        }
      }
    }
  },
  "500": {
    "$ref": "#/components/responses/ServerError"
  },
  "502": {
    "$ref": "#/components/responses/BadGateway"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### POST `/api/public/x-cdk/result`

查询 X CDK 兑换结果和官方账单

操作：`getXCdkResult`；权限：`按接口鉴权要求`。

使用原 code/deviceToken/clientRequestId 查询；只读恢复，不自动发起开卡、充值或 X 付款。付款成功后可返回过滤后的官方 invoiceUrls。不得返回发行者、卡片、钱包或服务费信息。

请求：
```json
{
  "required": true,
  "content": {
    "application/json": {
      "schema": {
        "$ref": "#/components/schemas/XCdkResultInput"
      },
      "example": {
        "code": "<CDK_CODE>",
        "deviceToken": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        "clientRequestId": "00000000-0000-4000-8000-000000000002"
      }
    }
  }
}
```

响应：
```json
{
  "200": {
    "description": "当前业务结果；HTTP 200 不等于付款完成，检查 data.status。",
    "headers": {
      "X-Request-Id": {
        "$ref": "#/components/headers/RequestId"
      },
      "Cache-Control": {
        "schema": {
          "type": "string",
          "const": "no-store"
        }
      }
    },
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/XCdkPublicResponse"
        }
      }
    }
  },
  "400": {
    "$ref": "#/components/responses/InvalidRequest"
  },
  "404": {
    "$ref": "#/components/responses/NotFound"
  },
  "408": {
    "description": "处理超时不证明没有资金操作。保留原标识，发行时同幂等键重试，兑换时先 result 查询原绑定。",
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/Error"
        }
      }
    }
  },
  "409": {
    "$ref": "#/components/responses/Conflict"
  },
  "413": {
    "$ref": "#/components/responses/PayloadTooLarge"
  },
  "415": {
    "$ref": "#/components/responses/UnsupportedMediaType"
  },
  "422": {
    "$ref": "#/components/responses/Unprocessable"
  },
  "429": {
    "description": "此动作每来源 IP 每分钟最多 120 次；客户端退避等待下个窗口，保留原绑定，不重新生成请求标识。",
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/Error"
        }
      }
    }
  },
  "500": {
    "$ref": "#/components/responses/ServerError"
  },
  "502": {
    "$ref": "#/components/responses/BadGateway"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### GET `/api/v1/tg-direct/plans`

查询 TG 套餐及服务费

操作：`listTgDirectPlans`；权限：`tg-direct:read`。

六种固定套餐；官方扣卡金额在 prepare 后取得。目录不保证账号有资格或卡片可付款。每项 serviceFee 是 USD 钱包费用，pricingVersion 是配置版本。

响应：
```json
{
  "200": {
    "description": "六个套餐及当前服务费配置。",
    "headers": {
      "X-Request-Id": {
        "$ref": "#/components/headers/RequestId"
      },
      "Cache-Control": {
        "schema": {
          "type": "string",
          "const": "no-store"
        },
        "description": "响应不可缓存。"
      }
    },
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/TgDirectPlansResponse"
        }
      }
    }
  },
  "401": {
    "$ref": "#/components/responses/Unauthorized"
  },
  "403": {
    "$ref": "#/components/responses/Forbidden"
  },
  "408": {
    "description": "请求超过处理时限。不得据此判断是否付款；已知订单 ID 时先查询该订单，prepare 丢失响应时复用原 clientRequestId 和 Idempotency-Key。",
    "headers": {
      "X-Request-Id": {
        "$ref": "#/components/headers/RequestId"
      }
    },
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/Error"
        }
      }
    }
  },
  "429": {
    "$ref": "#/components/responses/RateLimited"
  },
  "500": {
    "$ref": "#/components/responses/ServerError"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### POST `/api/public/tg-cdk/preview`

预览 TG 兑换码

操作：`previewTgCdk`；权限：`按接口鉴权要求`。

仅查看套餐和兑换状态，不作资金操作。无需 App ID/Secret；使用独立 IP 频控。

请求：
```json
{
  "required": true,
  "content": {
    "application/json": {
      "schema": {
        "$ref": "#/components/schemas/TgCdkPreviewInput"
      },
      "example": {
        "code": "<CDK_CODE>",
        "deviceToken": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
      }
    }
  }
}
```

响应：
```json
{
  "200": {
    "description": "当前业务结果；HTTP 200 不等于付款完成，检查 data.status。",
    "headers": {
      "X-Request-Id": {
        "$ref": "#/components/headers/RequestId"
      },
      "Cache-Control": {
        "schema": {
          "type": "string",
          "const": "no-store"
        }
      }
    },
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/TgCdkPublicResponse"
        }
      }
    }
  },
  "400": {
    "$ref": "#/components/responses/InvalidRequest"
  },
  "404": {
    "$ref": "#/components/responses/NotFound"
  },
  "408": {
    "description": "处理超时不证明没有资金操作。保留原标识，发行时同幂等键重试，兑换时先 result 查询原绑定。",
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/Error"
        }
      }
    }
  },
  "409": {
    "$ref": "#/components/responses/Conflict"
  },
  "413": {
    "$ref": "#/components/responses/PayloadTooLarge"
  },
  "415": {
    "$ref": "#/components/responses/UnsupportedMediaType"
  },
  "422": {
    "$ref": "#/components/responses/Unprocessable"
  },
  "429": {
    "description": "此动作每来源 IP 每分钟最多 60 次；客户端退避等待下个窗口，保留原绑定，不重新生成请求标识。",
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/Error"
        }
      }
    }
  },
  "500": {
    "$ref": "#/components/responses/ServerError"
  },
  "502": {
    "$ref": "#/components/responses/BadGateway"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### POST `/api/public/tg-cdk/redeem`

兑换并由发行者钱包资助 TG 付款

操作：`redeemTgCdk`；权限：`按接口鉴权要求`。

两阶段真实资金入口。首次在 prepared 状态调用只执行授权的开卡/充值并返回 funding 或 funded；funded 后用户明确继续，第二次携带同一绑定和报价调用才派发 TG 付款。result 只读，不自动推进付款。全部费用由发行者承担，不追加资金或FX缓冲。未知结果先查询原兑换，不换请求标识；卡内余款留给发行者，不自动退钱包。 已资CDK的服务费按数据库关联验证的发行快照收取，后续调价不会增加该授权；未资CDK若费用/版本变化则拒绝资金派发并要求发行者处理。

请求：
```json
{
  "required": true,
  "content": {
    "application/json": {
      "schema": {
        "$ref": "#/components/schemas/TgCdkRedeemInput"
      },
      "example": {
        "code": "<CDK_CODE>",
        "deviceToken": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        "clientRequestId": "00000000-0000-4000-8000-000000000002",
        "expectedAmountMinor": 12345,
        "currency": "bdt"
      }
    }
  }
}
```

响应：
```json
{
  "200": {
    "description": "当前业务结果；HTTP 200 不等于付款完成，检查 data.status。",
    "headers": {
      "X-Request-Id": {
        "$ref": "#/components/headers/RequestId"
      },
      "Cache-Control": {
        "schema": {
          "type": "string",
          "const": "no-store"
        }
      }
    },
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/TgCdkPublicResponse"
        }
      }
    }
  },
  "400": {
    "$ref": "#/components/responses/InvalidRequest"
  },
  "404": {
    "$ref": "#/components/responses/NotFound"
  },
  "408": {
    "description": "处理超时不证明没有资金操作。保留原标识，发行时同幂等键重试，兑换时先 result 查询原绑定。",
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/Error"
        }
      }
    }
  },
  "409": {
    "$ref": "#/components/responses/Conflict"
  },
  "413": {
    "$ref": "#/components/responses/PayloadTooLarge"
  },
  "415": {
    "$ref": "#/components/responses/UnsupportedMediaType"
  },
  "422": {
    "$ref": "#/components/responses/Unprocessable"
  },
  "429": {
    "description": "此动作每来源 IP 每分钟最多 10 次；客户端退避等待下个窗口，保留原绑定，不重新生成请求标识。",
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/Error"
        }
      }
    }
  },
  "500": {
    "$ref": "#/components/responses/ServerError"
  },
  "502": {
    "$ref": "#/components/responses/BadGateway"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### POST `/api/public/tg-cdk/preflight`

预检 TG CDK 接收方和官方报价

操作：`preflightTgCdk`；权限：`按接口鉴权要求`。

首次绑定code、随机deviceToken、clientRequestId和接收方，取得真实官方报价，不作资金操作。丢失响应原样重试。仅canRetryPreflight严格为true时，同设备可用新请求ID更正接收方。已prepared但过期、或已funded且付款尚未派发时，可以原设备/原请求ID/原接收方显式刷新官方报价，不重复开卡充值。已资CDK继续使用发行时授权的服务费快照；普通订单仍受当前服务费版本约束。

请求：
```json
{
  "required": true,
  "content": {
    "application/json": {
      "schema": {
        "$ref": "#/components/schemas/TgCdkPreflightInput"
      },
      "example": {
        "code": "<CDK_CODE>",
        "deviceToken": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        "clientRequestId": "00000000-0000-4000-8000-000000000002",
        "recipient": "example_user"
      }
    }
  }
}
```

响应：
```json
{
  "200": {
    "description": "当前业务结果；HTTP 200 不等于付款完成，检查 data.status。",
    "headers": {
      "X-Request-Id": {
        "$ref": "#/components/headers/RequestId"
      },
      "Cache-Control": {
        "schema": {
          "type": "string",
          "const": "no-store"
        }
      }
    },
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/TgCdkPublicResponse"
        }
      }
    }
  },
  "400": {
    "$ref": "#/components/responses/InvalidRequest"
  },
  "404": {
    "$ref": "#/components/responses/NotFound"
  },
  "408": {
    "description": "处理超时不证明没有资金操作。保留原标识，发行时同幂等键重试，兑换时先 result 查询原绑定。",
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/Error"
        }
      }
    }
  },
  "409": {
    "$ref": "#/components/responses/Conflict"
  },
  "413": {
    "$ref": "#/components/responses/PayloadTooLarge"
  },
  "415": {
    "$ref": "#/components/responses/UnsupportedMediaType"
  },
  "422": {
    "$ref": "#/components/responses/Unprocessable"
  },
  "429": {
    "description": "此动作每来源 IP 每分钟最多 10 次；客户端退避等待下个窗口，保留原绑定，不重新生成请求标识。",
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/Error"
        }
      }
    }
  },
  "500": {
    "$ref": "#/components/responses/ServerError"
  },
  "502": {
    "$ref": "#/components/responses/BadGateway"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### POST `/api/public/tg-cdk/result`

查询 TG CDK 兑换结果和赠送到账记录

操作：`getTgCdkResult`；权限：`按接口鉴权要求`。

使用原 code/deviceToken/clientRequestId 查询；只读恢复，不自动发起开卡、充值或 TG 付款。付款成功后可返回已核验的 deliveryStatus、giftMessageId 和 giftDays。不得返回发行者、卡片、钱包或服务费信息。

请求：
```json
{
  "required": true,
  "content": {
    "application/json": {
      "schema": {
        "$ref": "#/components/schemas/TgCdkResultInput"
      },
      "example": {
        "code": "<CDK_CODE>",
        "deviceToken": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        "clientRequestId": "00000000-0000-4000-8000-000000000002"
      }
    }
  }
}
```

响应：
```json
{
  "200": {
    "description": "当前业务结果；HTTP 200 不等于付款完成，检查 data.status。",
    "headers": {
      "X-Request-Id": {
        "$ref": "#/components/headers/RequestId"
      },
      "Cache-Control": {
        "schema": {
          "type": "string",
          "const": "no-store"
        }
      }
    },
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/TgCdkPublicResponse"
        }
      }
    }
  },
  "400": {
    "$ref": "#/components/responses/InvalidRequest"
  },
  "404": {
    "$ref": "#/components/responses/NotFound"
  },
  "408": {
    "description": "处理超时不证明没有资金操作。保留原标识，发行时同幂等键重试，兑换时先 result 查询原绑定。",
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/Error"
        }
      }
    }
  },
  "409": {
    "$ref": "#/components/responses/Conflict"
  },
  "413": {
    "$ref": "#/components/responses/PayloadTooLarge"
  },
  "415": {
    "$ref": "#/components/responses/UnsupportedMediaType"
  },
  "422": {
    "$ref": "#/components/responses/Unprocessable"
  },
  "429": {
    "description": "此动作每来源 IP 每分钟最多 120 次；客户端退避等待下个窗口，保留原绑定，不重新生成请求标识。",
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/Error"
        }
      }
    }
  },
  "500": {
    "$ref": "#/components/responses/ServerError"
  },
  "502": {
    "$ref": "#/components/responses/BadGateway"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### GET `/api/v1/tg-direct/orders/{id}`

查询或恢复 TG 订单状态

操作：`getTgDirectOrder`；权限：`tg-direct:read`。

仅创建 key 可读。需要时查询原付款状态及账单，绝不重新付款。处理中可先返回持久快照；客户端退避查询。成功后 invoiceUrls 仍可稍后出现。付款不确定时保持原订单，不新建订单重试。

参数：
```json
[
  {
    "$ref": "#/components/parameters/UuidId"
  }
]
```

响应：
```json
{
  "200": {
    "description": "返回当前快照；请检查 data.status 和付款证据，勿以 HTTP 200 视为支付成功。",
    "headers": {
      "X-Request-Id": {
        "$ref": "#/components/headers/RequestId"
      },
      "Cache-Control": {
        "schema": {
          "type": "string",
          "const": "no-store"
        },
        "description": "响应不可缓存。"
      }
    },
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/TgDirectOrderResponse"
        }
      }
    }
  },
  "401": {
    "$ref": "#/components/responses/Unauthorized"
  },
  "403": {
    "$ref": "#/components/responses/Forbidden"
  },
  "404": {
    "$ref": "#/components/responses/NotFound"
  },
  "408": {
    "description": "请求超过处理时限。不得据此判断是否付款；已知订单 ID 时先查询该订单，prepare 丢失响应时复用原 clientRequestId 和 Idempotency-Key。",
    "headers": {
      "X-Request-Id": {
        "$ref": "#/components/headers/RequestId"
      }
    },
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/Error"
        }
      }
    }
  },
  "429": {
    "$ref": "#/components/responses/RateLimited"
  },
  "500": {
    "$ref": "#/components/responses/ServerError"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### POST `/api/v1/tg-direct/orders/{id}/confirm`

确认官方扣卡金额及钱包服务费并付款

操作：`confirmTgDirectOrder`；权限：`tg-direct:write`。

真实付款入口。应先向最终用户展示 recipient、plan、amountMinor/currency 和 serviceFee，确认后原样回传报价。报价自创建起 30 分钟内有效，配置版本改变返回 QUOTE_CHANGED；过期返回 QUOTE_EXPIRED。服务费从本站 USD 钱包扣除，官方金额从 cardId 对应卡片扣除。按订单原子状态转换防止重复派发：非 prepared 的重复请求返回当前状态；并发请求也可能 409，应 GET 同一订单。确定未扣卡的失败会退服务费；结果不确定时保持订单与资金锁，先查询，不新建付款。

参数：
```json
[
  {
    "$ref": "#/components/parameters/UuidId"
  },
  {
    "$ref": "#/components/parameters/TgDirectIdempotencyKey"
  }
]
```

请求：
```json
{
  "required": true,
  "content": {
    "application/json": {
      "schema": {
        "$ref": "#/components/schemas/TgDirectConfirmInput"
      },
      "example": {
        "expectedAmountMinor": 12345,
        "currency": "bdt",
        "expectedServiceFee": "1.00"
      }
    }
  }
}
```

响应：
```json
{
  "200": {
    "description": "返回当前快照；请检查 data.status 和付款证据，勿以 HTTP 200 视为支付成功。",
    "headers": {
      "X-Request-Id": {
        "$ref": "#/components/headers/RequestId"
      },
      "Cache-Control": {
        "schema": {
          "type": "string",
          "const": "no-store"
        },
        "description": "响应不可缓存。"
      }
    },
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/TgDirectOrderResponse"
        }
      }
    }
  },
  "400": {
    "$ref": "#/components/responses/InvalidRequest"
  },
  "401": {
    "$ref": "#/components/responses/Unauthorized"
  },
  "403": {
    "$ref": "#/components/responses/Forbidden"
  },
  "404": {
    "$ref": "#/components/responses/NotFound"
  },
  "408": {
    "description": "请求超过处理时限。不得据此判断是否付款；已知订单 ID 时先查询该订单，prepare 丢失响应时复用原 clientRequestId 和 Idempotency-Key。",
    "headers": {
      "X-Request-Id": {
        "$ref": "#/components/headers/RequestId"
      }
    },
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/Error"
        }
      }
    }
  },
  "409": {
    "$ref": "#/components/responses/Conflict"
  },
  "413": {
    "$ref": "#/components/responses/PayloadTooLarge"
  },
  "415": {
    "$ref": "#/components/responses/UnsupportedMediaType"
  },
  "422": {
    "$ref": "#/components/responses/Unprocessable"
  },
  "429": {
    "$ref": "#/components/responses/RateLimited"
  },
  "500": {
    "$ref": "#/components/responses/ServerError"
  },
  "502": {
    "$ref": "#/components/responses/BadGateway"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### POST `/api/v1/tg-direct/cdks/generate`

免费生成 TG CDK 并授权兑换资金上限

操作：`generateTgCdks`；权限：`tg-direct:write`。

固定每张钱包支出上限、官方金额上限和一次注资额，快照开卡/充值/X服务费。发行不扣款或冻结钱包；兑换时检查钱包余额、实际报价与配置。cardId/autoCard 二选一。同幂等键和相同参数重试返回原批次；不得换键重发以恢复丢失响应。示例金额均为占位值。

参数：
```json
[
  {
    "$ref": "#/components/parameters/TgCdkIdempotencyKey"
  }
]
```

请求：
```json
{
  "required": true,
  "content": {
    "application/json": {
      "schema": {
        "$ref": "#/components/schemas/TgCdkGenerateInput"
      },
      "example": {
        "plan": "premium_3m",
        "quantity": 1,
        "maxWalletDebitUsd": "30.00",
        "maxOfficialAmountMinor": 12345,
        "currency": "USD",
        "fundingAmountUsd": "20.00",
        "cardId": 123
      }
    }
  }
}
```

响应：
```json
{
  "200": {
    "description": "当前业务结果；HTTP 200 不等于付款完成，检查 data.status。",
    "headers": {
      "X-Request-Id": {
        "$ref": "#/components/headers/RequestId"
      },
      "Cache-Control": {
        "schema": {
          "type": "string",
          "const": "no-store"
        }
      }
    },
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/TgCdkGenerateResponse"
        }
      }
    }
  },
  "400": {
    "$ref": "#/components/responses/InvalidRequest"
  },
  "401": {
    "$ref": "#/components/responses/Unauthorized"
  },
  "403": {
    "$ref": "#/components/responses/Forbidden"
  },
  "404": {
    "$ref": "#/components/responses/NotFound"
  },
  "408": {
    "description": "处理超时不证明没有资金操作。保留原标识，发行时同幂等键重试，兑换时先 result 查询原绑定。",
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/Error"
        }
      }
    }
  },
  "409": {
    "$ref": "#/components/responses/Conflict"
  },
  "413": {
    "$ref": "#/components/responses/PayloadTooLarge"
  },
  "415": {
    "$ref": "#/components/responses/UnsupportedMediaType"
  },
  "422": {
    "$ref": "#/components/responses/Unprocessable"
  },
  "429": {
    "$ref": "#/components/responses/RateLimited"
  },
  "500": {
    "$ref": "#/components/responses/ServerError"
  },
  "502": {
    "$ref": "#/components/responses/BadGateway"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### GET `/api/v1/tg-direct/orders`

查询当前 key 的 TG 付款订单

操作：`listTgDirectOrders`；权限：`tg-direct:read`。

仅当前账户且由当前 API key 创建、已派发资金操作的最近 50 条，按创建时间倒序，无分页。prepare-only 报价不进入此列表；应保存 prepare 返回的订单 ID。其他 key 或控制台创建的订单不可通过该 key 访问。

响应：
```json
{
  "200": {
    "description": "返回当前快照；请检查 data.status 和付款证据，勿以 HTTP 200 视为支付成功。",
    "headers": {
      "X-Request-Id": {
        "$ref": "#/components/headers/RequestId"
      },
      "Cache-Control": {
        "schema": {
          "type": "string",
          "const": "no-store"
        },
        "description": "响应不可缓存。"
      }
    },
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/TgDirectOrdersResponse"
        }
      }
    }
  },
  "401": {
    "$ref": "#/components/responses/Unauthorized"
  },
  "403": {
    "$ref": "#/components/responses/Forbidden"
  },
  "408": {
    "description": "请求超过处理时限。不得据此判断是否付款；已知订单 ID 时先查询该订单，prepare 丢失响应时复用原 clientRequestId 和 Idempotency-Key。",
    "headers": {
      "X-Request-Id": {
        "$ref": "#/components/headers/RequestId"
      }
    },
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/Error"
        }
      }
    }
  },
  "429": {
    "$ref": "#/components/responses/RateLimited"
  },
  "500": {
    "$ref": "#/components/responses/ServerError"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### GET `/api/v1/tg-direct/cdks/{id}/export`

导出完整 TG 兑换码

操作：`exportTgCdk`；权限：`tg-direct:write`。

返回 bearer 兑换码，要求 tg-direct:write 和来源 IP 白名单；虽为 GET，不能授予只读 key。无 Idempotency-Key 要求，不记录响应正文。

参数：
```json
[
  {
    "$ref": "#/components/parameters/UuidId"
  }
]
```

响应：
```json
{
  "200": {
    "description": "当前业务结果；HTTP 200 不等于付款完成，检查 data.status。",
    "headers": {
      "X-Request-Id": {
        "$ref": "#/components/headers/RequestId"
      },
      "Cache-Control": {
        "schema": {
          "type": "string",
          "const": "no-store"
        }
      }
    },
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/TgCdkExportResponse"
        }
      }
    }
  },
  "400": {
    "$ref": "#/components/responses/InvalidRequest"
  },
  "401": {
    "$ref": "#/components/responses/Unauthorized"
  },
  "403": {
    "$ref": "#/components/responses/Forbidden"
  },
  "404": {
    "$ref": "#/components/responses/NotFound"
  },
  "408": {
    "description": "处理超时不证明没有资金操作。保留原标识，发行时同幂等键重试，兑换时先 result 查询原绑定。",
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/Error"
        }
      }
    }
  },
  "409": {
    "$ref": "#/components/responses/Conflict"
  },
  "422": {
    "$ref": "#/components/responses/Unprocessable"
  },
  "429": {
    "$ref": "#/components/responses/RateLimited"
  },
  "500": {
    "$ref": "#/components/responses/ServerError"
  },
  "502": {
    "$ref": "#/components/responses/BadGateway"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### POST `/api/v1/tg-direct/cdks/{id}/revoke`

撤销未派发资金操作的 TG CDK

操作：`revokeTgCdk`；权限：`tg-direct:write`。

不能撤销已开卡/充值/付款的资金操作，不能退款；结果未知时不能以撤销解锁重兑。先查询状态。 支持重复撤销已撤销的码；header必填但不用于缓存响应。

参数：
```json
[
  {
    "$ref": "#/components/parameters/UuidId"
  },
  {
    "$ref": "#/components/parameters/TgCdkIdempotencyKey"
  }
]
```

响应：
```json
{
  "200": {
    "description": "当前业务结果；HTTP 200 不等于付款完成，检查 data.status。",
    "headers": {
      "X-Request-Id": {
        "$ref": "#/components/headers/RequestId"
      },
      "Cache-Control": {
        "schema": {
          "type": "string",
          "const": "no-store"
        }
      }
    },
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/TgCdkIssuerResponse"
        }
      }
    }
  },
  "400": {
    "$ref": "#/components/responses/InvalidRequest"
  },
  "401": {
    "$ref": "#/components/responses/Unauthorized"
  },
  "403": {
    "$ref": "#/components/responses/Forbidden"
  },
  "404": {
    "$ref": "#/components/responses/NotFound"
  },
  "408": {
    "description": "处理超时不证明没有资金操作。保留原标识，发行时同幂等键重试，兑换时先 result 查询原绑定。",
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/Error"
        }
      }
    }
  },
  "409": {
    "$ref": "#/components/responses/Conflict"
  },
  "422": {
    "$ref": "#/components/responses/Unprocessable"
  },
  "429": {
    "$ref": "#/components/responses/RateLimited"
  },
  "500": {
    "$ref": "#/components/responses/ServerError"
  },
  "502": {
    "$ref": "#/components/responses/BadGateway"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### POST `/api/v1/tg-direct/orders/prepare`

校验 TG 账号并取得官方报价

操作：`prepareTgDirectOrder`；权限：`tg-direct:write`。

不提交卡片付款、不扣钱包服务费。使用本人已有可用卡片；服务端校验接收方和套餐，取得官方报价并保存服务费与配置版本。每账户每分钟最多创建 5 个新报价。同一 clientRequestId 必须复用相同 header 和参数，重放返回原订单当前快照。可返回 ineligible / review_required，只有 prepared 可确认。禁止提交 TG Session 或卡号/CVC。

参数：
```json
[
  {
    "$ref": "#/components/parameters/TgDirectIdempotencyKey"
  }
]
```

请求：
```json
{
  "required": true,
  "content": {
    "application/json": {
      "schema": {
        "$ref": "#/components/schemas/TgDirectPrepareInput"
      },
      "example": {
        "recipient": "example_user",
        "plan": "premium_3m",
        "cardId": 123,
        "clientRequestId": "00000000-0000-4000-8000-000000000001"
      }
    }
  }
}
```

响应：
```json
{
  "200": {
    "description": "返回当前快照；请检查 data.status 和付款证据，勿以 HTTP 200 视为支付成功。",
    "headers": {
      "X-Request-Id": {
        "$ref": "#/components/headers/RequestId"
      },
      "Cache-Control": {
        "schema": {
          "type": "string",
          "const": "no-store"
        },
        "description": "响应不可缓存。"
      }
    },
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/TgDirectOrderResponse"
        }
      }
    }
  },
  "400": {
    "$ref": "#/components/responses/InvalidRequest"
  },
  "401": {
    "$ref": "#/components/responses/Unauthorized"
  },
  "403": {
    "$ref": "#/components/responses/Forbidden"
  },
  "408": {
    "description": "请求超过处理时限。不得据此判断是否付款；已知订单 ID 时先查询该订单，prepare 丢失响应时复用原 clientRequestId 和 Idempotency-Key。",
    "headers": {
      "X-Request-Id": {
        "$ref": "#/components/headers/RequestId"
      }
    },
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/Error"
        }
      }
    }
  },
  "409": {
    "$ref": "#/components/responses/Conflict"
  },
  "413": {
    "$ref": "#/components/responses/PayloadTooLarge"
  },
  "415": {
    "$ref": "#/components/responses/UnsupportedMediaType"
  },
  "422": {
    "$ref": "#/components/responses/Unprocessable"
  },
  "429": {
    "$ref": "#/components/responses/RateLimited"
  },
  "500": {
    "$ref": "#/components/responses/ServerError"
  },
  "502": {
    "$ref": "#/components/responses/BadGateway"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### POST `/api/v1/tg-direct/orders/{id}/cancel`

取消尚未派发付款的 TG 报价

操作：`cancelTgDirectOrder`；权限：`tg-direct:write`。

仅未派发资金操作且状态为 prepared 或 review_required 时可取消。此接口不能撤销已提交付款，不能办理退款。无需请求体。重复取消已取消订单会返回 409，此时 GET 确认 cancelled 即可。

参数：
```json
[
  {
    "$ref": "#/components/parameters/UuidId"
  },
  {
    "$ref": "#/components/parameters/TgDirectIdempotencyKey"
  }
]
```

响应：
```json
{
  "200": {
    "description": "返回当前快照；请检查 data.status 和付款证据，勿以 HTTP 200 视为支付成功。",
    "headers": {
      "X-Request-Id": {
        "$ref": "#/components/headers/RequestId"
      },
      "Cache-Control": {
        "schema": {
          "type": "string",
          "const": "no-store"
        },
        "description": "响应不可缓存。"
      }
    },
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/TgDirectOrderResponse"
        }
      }
    }
  },
  "400": {
    "$ref": "#/components/responses/InvalidRequest"
  },
  "401": {
    "$ref": "#/components/responses/Unauthorized"
  },
  "403": {
    "$ref": "#/components/responses/Forbidden"
  },
  "404": {
    "$ref": "#/components/responses/NotFound"
  },
  "408": {
    "description": "请求超过处理时限。不得据此判断是否付款；已知订单 ID 时先查询该订单，prepare 丢失响应时复用原 clientRequestId 和 Idempotency-Key。",
    "headers": {
      "X-Request-Id": {
        "$ref": "#/components/headers/RequestId"
      }
    },
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/Error"
        }
      }
    }
  },
  "409": {
    "$ref": "#/components/responses/Conflict"
  },
  "413": {
    "$ref": "#/components/responses/PayloadTooLarge"
  },
  "415": {
    "$ref": "#/components/responses/UnsupportedMediaType"
  },
  "422": {
    "$ref": "#/components/responses/Unprocessable"
  },
  "429": {
    "$ref": "#/components/responses/RateLimited"
  },
  "500": {
    "$ref": "#/components/responses/ServerError"
  },
  "502": {
    "$ref": "#/components/responses/BadGateway"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### GET `/api/v1/tg-direct/cdks`

查询发行的 TG CDK

操作：`listTgCdks`；权限：`tg-direct:read`。

仅当前账户、当前创建 API key 的最近 100 张，无分页。生成免费，兑换时才由发行者承担费用。

响应：
```json
{
  "200": {
    "description": "当前业务结果；HTTP 200 不等于付款完成，检查 data.status。",
    "headers": {
      "X-Request-Id": {
        "$ref": "#/components/headers/RequestId"
      },
      "Cache-Control": {
        "schema": {
          "type": "string",
          "const": "no-store"
        }
      }
    },
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/TgCdkListResponse"
        }
      }
    }
  },
  "400": {
    "$ref": "#/components/responses/InvalidRequest"
  },
  "401": {
    "$ref": "#/components/responses/Unauthorized"
  },
  "403": {
    "$ref": "#/components/responses/Forbidden"
  },
  "404": {
    "$ref": "#/components/responses/NotFound"
  },
  "408": {
    "description": "处理超时不证明没有资金操作。保留原标识，发行时同幂等键重试，兑换时先 result 查询原绑定。",
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/Error"
        }
      }
    }
  },
  "409": {
    "$ref": "#/components/responses/Conflict"
  },
  "422": {
    "$ref": "#/components/responses/Unprocessable"
  },
  "429": {
    "$ref": "#/components/responses/RateLimited"
  },
  "500": {
    "$ref": "#/components/responses/ServerError"
  },
  "502": {
    "$ref": "#/components/responses/BadGateway"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### POST `/api/v1/gpt-direct/auto-orders`

自动选卡、充值并直充

操作：`createGptAutoTask`；权限：`gpt:write`。

先调用地区预检并选择套餐；expectedAmountUsd 取该套餐 quoteEstimatesUsd，服务费及版本取套餐目录。总钱包预算覆盖全部尝试的开卡、注资及服务费。forceNewCard=false 最多两张不同卡；任何新卡失败终止。true 一卡一付，不开第二张。付款未知、已付款待交付及不可重试拒绝不会换卡。

参数：
```json
[
  {
    "$ref": "#/components/parameters/IdempotencyKey"
  }
]
```

请求：
```json
{
  "required": true,
  "content": {
    "application/json": {
      "schema": {
        "$ref": "#/components/schemas/GptAutoInput"
      }
    }
  }
}
```

响应：
```json
{
  "202": {
    "description": "任务受理；查询终态",
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/GptAutoResponse"
        }
      }
    }
  },
  "400": {
    "$ref": "#/components/responses/InvalidRequest"
  },
  "401": {
    "$ref": "#/components/responses/Unauthorized"
  },
  "403": {
    "$ref": "#/components/responses/Forbidden"
  },
  "404": {
    "$ref": "#/components/responses/NotFound"
  },
  "408": {
    "$ref": "#/components/responses/RequestTimeout"
  },
  "409": {
    "$ref": "#/components/responses/Conflict"
  },
  "429": {
    "$ref": "#/components/responses/RateLimited"
  },
  "500": {
    "$ref": "#/components/responses/ServerError"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### GET `/api/v1/gpt-direct/auto-orders/{id}`

查询自动直充任务

操作：`getGptAutoTask`；权限：`gpt:read`。

仅创建密钥可读取；completed 才代表成功，pending/requires_action 不能另建订单重付。

参数：
```json
[
  {
    "$ref": "#/components/parameters/UuidId"
  }
]
```

响应：
```json
{
  "200": {
    "description": "任务状态",
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/GptAutoResponse"
        }
      }
    }
  },
  "401": {
    "$ref": "#/components/responses/Unauthorized"
  },
  "403": {
    "$ref": "#/components/responses/Forbidden"
  },
  "404": {
    "$ref": "#/components/responses/NotFound"
  },
  "408": {
    "$ref": "#/components/responses/RequestTimeout"
  },
  "429": {
    "$ref": "#/components/responses/RateLimited"
  },
  "500": {
    "$ref": "#/components/responses/ServerError"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### POST `/api/v1/cards/closure-batches`

全部或批量注销卡片

操作：`createCardClosureBatch`；权限：`cards:manage`。

all=true 固定提交时的本人卡片清单；或传入1–1000个cardIds。占用或冻结卡逐项跳过，待对账卡继续查询。原幂等键重放不会添加后来开的卡。

参数：
```json
[
  {
    "$ref": "#/components/parameters/IdempotencyKey"
  }
]
```

请求：
```json
{
  "required": true,
  "content": {
    "application/json": {
      "schema": {
        "$ref": "#/components/schemas/CardClosureInput"
      }
    }
  }
}
```

响应：
```json
{
  "202": {
    "description": "任务受理；查询终态",
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/CardClosureResponse"
        }
      }
    }
  },
  "400": {
    "$ref": "#/components/responses/InvalidRequest"
  },
  "401": {
    "$ref": "#/components/responses/Unauthorized"
  },
  "403": {
    "$ref": "#/components/responses/Forbidden"
  },
  "404": {
    "$ref": "#/components/responses/NotFound"
  },
  "408": {
    "$ref": "#/components/responses/RequestTimeout"
  },
  "409": {
    "$ref": "#/components/responses/Conflict"
  },
  "429": {
    "$ref": "#/components/responses/RateLimited"
  },
  "500": {
    "$ref": "#/components/responses/ServerError"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

### GET `/api/v1/cards/closure-batches/{id}`

查询批量注销结果

操作：`getCardClosureBatch`；权限：`cards:read`。

仅创建密钥可读取。逐卡报告注销、跳过、失败和待对账状态；completed_with_errors 须检查逐项原因。

参数：
```json
[
  {
    "$ref": "#/components/parameters/UuidId"
  },
  {
    "name": "offset",
    "in": "query",
    "schema": {
      "type": "integer",
      "minimum": 0,
      "default": 0
    }
  },
  {
    "name": "limit",
    "in": "query",
    "schema": {
      "type": "integer",
      "minimum": 1,
      "maximum": 200,
      "default": 100
    }
  }
]
```

响应：
```json
{
  "200": {
    "description": "任务状态",
    "content": {
      "application/json": {
        "schema": {
          "$ref": "#/components/schemas/CardClosureResponse"
        }
      }
    }
  },
  "401": {
    "$ref": "#/components/responses/Unauthorized"
  },
  "403": {
    "$ref": "#/components/responses/Forbidden"
  },
  "404": {
    "$ref": "#/components/responses/NotFound"
  },
  "408": {
    "$ref": "#/components/responses/RequestTimeout"
  },
  "429": {
    "$ref": "#/components/responses/RateLimited"
  },
  "500": {
    "$ref": "#/components/responses/ServerError"
  },
  "503": {
    "$ref": "#/components/responses/Unavailable"
  }
}
```

## v1 完整模型及公共定义

本节保留规范中的字段约束、必填项、错误结构、鉴权定义与 Webhook 模型。

```json
{
  "securitySchemes": {
    "AppId": {
      "type": "apiKey",
      "in": "header",
      "name": "X-App-Id",
      "description": "在开发者控制台创建；格式 app_ 加 32 位十六进制字符。创建、敏感配置更新和删除要求登录时间不超过 5 分钟。禁用或删除后立即停止鉴权；删除不转移历史操作所有权。"
    },
    "AppSecret": {
      "type": "apiKey",
      "in": "header",
      "name": "X-App-Secret",
      "description": "仅创建时显示；格式 sk_ 加 64 位十六进制字符。只能保存在服务端密钥库；删除 key 会使 Secret 不可恢复地作废。"
    }
  },
  "headers": {
    "RequestId": {
      "description": "平台为已接受请求生成的追踪 ID；联系支持时提供。",
      "schema": {
        "type": "string",
        "format": "uuid"
      }
    }
  },
  "parameters": {
    "CardId": {
      "name": "id",
      "in": "path",
      "required": true,
      "description": "本站卡片 ID，不是卡号。",
      "schema": {
        "type": "integer",
        "format": "int64",
        "minimum": 1
      }
    },
    "UuidId": {
      "name": "id",
      "in": "path",
      "required": true,
      "schema": {
        "type": "string",
        "format": "uuid"
      }
    },
    "DepositGatewayRef": {
      "name": "gatewayRef",
      "in": "path",
      "required": true,
      "description": "创建充值订单时返回的唯一订单号。",
      "schema": {
        "type": "string",
        "format": "uuid"
      }
    },
    "Page": {
      "name": "page",
      "in": "query",
      "schema": {
        "type": "integer",
        "format": "int64",
        "minimum": 1,
        "maximum": 100000,
        "default": 1
      }
    },
    "PageSize": {
      "name": "page_size",
      "in": "query",
      "schema": {
        "type": "integer",
        "format": "int64",
        "minimum": 1,
        "maximum": 100,
        "default": 20
      },
      "description": "服务会把超出范围的值限制到 1–100。"
    },
    "TransactionPageSize": {
      "name": "page_size",
      "in": "query",
      "schema": {
        "type": "integer",
        "format": "int64",
        "minimum": 1,
        "maximum": 100,
        "default": 50
      },
      "description": "服务会把超出范围的值限制到 1–100。"
    },
    "IdempotencyKey": {
      "name": "Idempotency-Key",
      "in": "header",
      "required": true,
      "description": "8–128 个可打印 ASCII 字符（不得含双引号）。同一业务重试必须复用；不同请求复用返回 409。",
      "schema": {
        "type": "string",
        "minLength": 8,
        "maxLength": 128,
        "pattern": "^[\\x21\\x23-\\x7E]+$"
      }
    },
    "RedemptionDevice": {
      "name": "X-Redemption-Device",
      "in": "header",
      "required": true,
      "description": "客户端首次兑换时生成并在整条 CDK 直充链路中保持不变的 UUID。不要跨最终客户共享。",
      "schema": {
        "type": "string",
        "format": "uuid"
      }
    },
    "WebhookId": {
      "name": "X-Avanfinity-Webhook-Id",
      "in": "header",
      "required": true,
      "description": "稳定事件 ID；重试不变，用于去重。",
      "schema": {
        "type": "string",
        "pattern": "^evt_[0-9a-f]{8}(?:_[0-9a-f]{8}){3}$"
      }
    },
    "WebhookTimestamp": {
      "name": "X-Avanfinity-Webhook-Timestamp",
      "in": "header",
      "required": true,
      "description": "签名时的 Unix 秒。建议只接受与本机时间相差不超过 300 秒的请求。",
      "schema": {
        "type": "string",
        "pattern": "^[0-9]{10,}$"
      }
    },
    "WebhookSignature": {
      "name": "X-Avanfinity-Signature",
      "in": "header",
      "required": true,
      "description": "v1=<hex>。签名内容为 timestamp + '.' + rawBody。",
      "schema": {
        "type": "string",
        "pattern": "^v1=[0-9a-f]{64}$"
      }
    },
    "XDirectIdempotencyKey": {
      "name": "Idempotency-Key",
      "in": "header",
      "required": true,
      "schema": {
        "type": "string",
        "minLength": 8,
        "maxLength": 128,
        "pattern": "^[!#-~]+$"
      },
      "description": "8–128 个可打印 ASCII 字符，不含空格或双引号。同一业务重试复用。prepare 将此值与 clientRequestId、请求参数及创建 key 绑定，冲突返回 409；confirm/cancel 必须携带，但去重依赖订单状态，不承诺响应缓存或相同 header 的请求体冲突校验。"
    },
    "XCdkIdempotencyKey": {
      "name": "Idempotency-Key",
      "in": "header",
      "required": true,
      "schema": {
        "type": "string",
        "minLength": 8,
        "maxLength": 128,
        "pattern": "^[!#-~]+$"
      },
      "description": "生成CDK时相同key与相同参数重放原批次，不同参数返回409；撤销时必须携带此头，但依赖CDK状态防重，不承诺header响应缓存。"
    },
    "TgDirectIdempotencyKey": {
      "name": "Idempotency-Key",
      "in": "header",
      "required": true,
      "schema": {
        "type": "string",
        "minLength": 8,
        "maxLength": 128,
        "pattern": "^[!#-~]+$"
      },
      "description": "8–128 个可打印 ASCII 字符，不含空格或双引号。同一业务重试复用。prepare 将此值与 clientRequestId、请求参数及创建 key 绑定，冲突返回 409；confirm/cancel 必须携带，但去重依赖订单状态，不承诺响应缓存或相同 header 的请求体冲突校验。"
    },
    "TgCdkIdempotencyKey": {
      "name": "Idempotency-Key",
      "in": "header",
      "required": true,
      "schema": {
        "type": "string",
        "minLength": 8,
        "maxLength": 128,
        "pattern": "^[!#-~]+$"
      },
      "description": "生成CDK时相同key与相同参数重放原批次，不同参数返回409；撤销时必须携带此头，但依赖CDK状态防重，不承诺header响应缓存。"
    }
  },
  "requestBodies": {
    "Amount": {
      "required": true,
      "content": {
        "application/json": {
          "schema": {
            "$ref": "#/components/schemas/AmountInput"
          },
          "example": {
            "amount": "10.00"
          }
        }
      }
    },
    "RechargeQuote": {
      "required": true,
      "content": {
        "application/json": {
          "schema": {
            "$ref": "#/components/schemas/RechargeQuoteInput"
          },
          "example": {
            "amount": "10.00"
          }
        }
      }
    },
    "Recharge": {
      "required": true,
      "content": {
        "application/json": {
          "schema": {
            "$ref": "#/components/schemas/RechargeInput"
          },
          "example": {
            "amount": "10.00",
            "expectedFee": "0.10"
          }
        }
      }
    }
  },
  "responses": {
    "InvalidRequest": {
      "description": "参数、请求体或幂等键无效",
      "content": {
        "application/json": {
          "schema": {
            "$ref": "#/components/schemas/Error"
          }
        }
      }
    },
    "PayloadTooLarge": {
      "description": "请求体超过 64 KiB 限制",
      "content": {
        "application/json": {
          "schema": {
            "$ref": "#/components/schemas/Error"
          }
        }
      }
    },
    "UnsupportedMediaType": {
      "description": "有请求体的接口必须使用 Content-Type: application/json",
      "content": {
        "application/json": {
          "schema": {
            "$ref": "#/components/schemas/Error"
          }
        }
      }
    },
    "Unauthorized": {
      "description": "App ID、App Secret 或密钥状态无效",
      "content": {
        "application/json": {
          "schema": {
            "$ref": "#/components/schemas/Error"
          }
        }
      }
    },
    "Forbidden": {
      "description": "账户、scope 或来源 IP 不允许",
      "content": {
        "application/json": {
          "schema": {
            "$ref": "#/components/schemas/Error"
          }
        }
      }
    },
    "NotFound": {
      "description": "资源不存在；跨账户资源也返回 404",
      "content": {
        "application/json": {
          "schema": {
            "$ref": "#/components/schemas/Error"
          }
        }
      }
    },
    "Conflict": {
      "description": "幂等冲突、资源状态冲突或报价已变化",
      "content": {
        "application/json": {
          "schema": {
            "$ref": "#/components/schemas/Error"
          }
        }
      }
    },
    "Unprocessable": {
      "description": "钱包或卡余额不足",
      "content": {
        "application/json": {
          "schema": {
            "$ref": "#/components/schemas/Error"
          }
        }
      }
    },
    "RequestTimeout": {
      "description": "应用在 30 秒内未完成请求处理。该响应不保证包含 X-Request-Id；外层网关可能使用自己的超时状态和格式。",
      "content": {
        "application/json": {
          "schema": {
            "$ref": "#/components/schemas/Error"
          }
        }
      }
    },
    "RateLimited": {
      "description": "超过 API key 分钟/日配额或端点附加频率限制",
      "headers": {
        "Retry-After": {
          "description": "可重试前等待秒数；当前所有 /api/v1 的 429 均返回 60。",
          "schema": {
            "type": "string"
          }
        },
        "X-Request-Id": {
          "$ref": "#/components/headers/RequestId"
        }
      },
      "content": {
        "application/json": {
          "schema": {
            "$ref": "#/components/schemas/Error"
          }
        }
      }
    },
    "BadGateway": {
      "description": "依赖服务返回已知失败或无效响应",
      "content": {
        "application/json": {
          "schema": {
            "$ref": "#/components/schemas/Error"
          }
        }
      }
    },
    "Unavailable": {
      "description": "服务、配置或只读保护暂不可用",
      "content": {
        "application/json": {
          "schema": {
            "$ref": "#/components/schemas/Error"
          }
        }
      }
    },
    "ServerError": {
      "description": "平台内部错误",
      "content": {
        "application/json": {
          "schema": {
            "$ref": "#/components/schemas/Error"
          }
        }
      }
    },
    "OperationPending": {
      "description": "结果尚未确定；保存 operationId 并轮询，禁止换幂等键重复扣款。",
      "headers": {
        "X-Request-Id": {
          "$ref": "#/components/headers/RequestId"
        }
      },
      "content": {
        "application/json": {
          "schema": {
            "$ref": "#/components/schemas/PendingOperationResponse"
          }
        }
      }
    },
    "CardActionSucceeded": {
      "description": "操作完成或成功重放",
      "headers": {
        "X-Request-Id": {
          "$ref": "#/components/headers/RequestId"
        }
      },
      "content": {
        "application/json": {
          "schema": {
            "$ref": "#/components/schemas/CardActionResponse"
          }
        }
      }
    }
  },
  "schemas": {
    "PublicCdkResponse": {
      "type": "object",
      "required": [
        "code",
        "data"
      ],
      "properties": {
        "code": {
          "type": "integer",
          "const": 0
        },
        "data": {
          "type": "object",
          "description": "按步骤返回 redemptionToken、preflightToken、套餐、报价、订单、公开进度时间线或续费取消状态。令牌均视为敏感信息且不得跨设备共享。",
          "properties": {
            "cardLastFour": {
              "type": [
                "string",
                "null"
              ],
              "pattern": "^[0-9]{4}$",
              "examples": [
                "0910",
                null
              ],
              "description": "当前支付尝试记录的支付卡后四位（保留前导零）；未提交、待选卡、待补款或历史无记录时为 null。仅供查卡，不代表扣款成功，不返回完整卡号、有效期或 CVV。result、receipt 和已记录的 redeem 结果均返回；登录后的 CDK 列表使用同名字段。"
            }
          },
          "additionalProperties": true
        }
      },
      "additionalProperties": true
    },
    "Decimal": {
      "type": "string",
      "pattern": "^-?[0-9]+(\\.[0-9]{1,6})?$",
      "description": "十进制字符串。不得转成二进制浮点数进行资金计算。"
    },
    "NonNegativeDecimal": {
      "type": "string",
      "pattern": "^[0-9]+(\\.[0-9]{1,6})?$"
    },
    "InputAmount": {
      "type": "string",
      "pattern": "^[0-9]+(\\.[0-9]{1,4})?$",
      "description": "非负十进制输入，最多四位小数；业务规则会进一步要求大于零及处于允许范围。"
    },
    "Error": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "error"
      ],
      "properties": {
        "error": {
          "type": "string",
          "description": "脱敏的人类可读信息；程序分支应使用 HTTP 状态，不应匹配本字段文本。"
        },
        "errorCode": {
          "type": "string",
          "pattern": "^[A-Z][A-Z0-9_]{1,63}$",
          "examples": [
            "AUTH_REQUIRED",
            "RECENT_AUTH_REQUIRED",
            "PRICE_CHANGED",
            "REFUND_BALANCE_CHANGED",
            "REFUND_BALANCE_UNAVAILABLE",
            "WAITING_QUOTE",
            "PREFLIGHT_REQUIRED",
            "SPENDABLE_BALANCE_INSUFFICIENT"
          ],
          "description": "可选的稳定机器码；存在时可用于细分同一 HTTP 状态。AUTH_REQUIRED 表示需要登录，RECENT_AUTH_REQUIRED 表示敏感会话写操作需要最近 5 分钟内重新登录，PRICE_CHANGED 表示开卡、充值或 CDK 报价已变化，应重新报价后以新幂等键提交；REFUND_BALANCE_CHANGED 表示退款前余额已变化，应刷新余额并以新幂等键重新确认；REFUND_BALANCE_UNAVAILABLE 表示退款尚未提交且原操作可重试，必须复用原幂等键；WAITING_QUOTE 表示动态 CDK 定价正在等待新的有效报价；PREFLIGHT_REQUIRED 表示预检令牌缺失、过期、归属不匹配或已被其他订单使用，必须重新预检；SPENDABLE_BALANCE_INSUFFICIENT 表示钱包总余额可能足够，但支付风控锁定后可用余额不足。"
        }
      }
    },
    "SuccessCode": {
      "type": "integer",
      "const": 0
    },
    "Product": {
      "type": "object",
      "required": [
        "productCode",
        "issuer",
        "network",
        "issuingArea",
        "cardType",
        "openFee",
        "openQuoteVersion",
        "rechargeRate",
        "refundRate",
        "declineFee",
        "authorizationReversalRate",
        "authorizationFee",
        "smallTransactionFee",
        "crossBorderFee",
        "lowAuthorizationThreshold",
        "lowAuthorizationFee",
        "lowAuthorizationStackMode",
        "refundKeepMinimum",
        "minAmount",
        "maxAmount",
        "displayBin",
        "displayBins",
        "binNotes",
        "restrictedMerchants",
        "googleChatgptBlocked",
        "description",
        "category"
      ],
      "properties": {
        "productCode": {
          "type": "string"
        },
        "issuer": {
          "type": "string"
        },
        "network": {
          "type": "string"
        },
        "issuingArea": {
          "type": "string"
        },
        "cardType": {
          "type": "string"
        },
        "openFee": {
          "$ref": "#/components/schemas/NonNegativeDecimal"
        },
        "openQuoteVersion": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$",
          "description": "当前开卡与初始充值联合报价版本；开卡时必须原样提交。"
        },
        "rechargeRate": {
          "allOf": [
            {
              "$ref": "#/components/schemas/NonNegativeDecimal"
            }
          ],
          "description": "卡片充值费率，也用于开卡时的初始充值；费用按金额乘费率后向上取整到 4 位小数。"
        },
        "refundRate": {
          "allOf": [
            {
              "$ref": "#/components/schemas/NonNegativeDecimal"
            }
          ],
          "description": "消费交易发生 Refund COMPLETE 时按退款金额收取的客户手续费率。该字段不适用于 /cards/{id}/refund 的卡余额退回操作。"
        },
        "declineFee": {
          "$ref": "#/components/schemas/NonNegativeDecimal",
          "description": "Authorization 最终为 DECLINED 时按笔收取的当前客户固定拒付售价；渠道账户级实际拒付成本另行对账。"
        },
        "authorizationReversalRate": {
          "$ref": "#/components/schemas/NonNegativeDecimal",
          "description": "Reversal COMPLETE 时按被撤销授权金额收取的手续费率。"
        },
        "authorizationFee": {
          "$ref": "#/components/schemas/NonNegativeDecimal",
          "description": "成功授权最终进入 Settlement COMPLETE 或 Reversal COMPLETE 时按笔收取的交易授权手续费。"
        },
        "smallTransactionFee": {
          "$ref": "#/components/schemas/NonNegativeDecimal",
          "description": "产品返回的小额交易手续费；触发条件未被渠道正式定义时产品不会开放销售。"
        },
        "crossBorderFee": {
          "$ref": "#/components/schemas/NonNegativeDecimal",
          "description": "产品返回的跨境交易手续费；触发条件未被渠道正式定义时产品不会开放销售。"
        },
        "lowAuthorizationThreshold": {
          "type": [
            "string",
            "null"
          ],
          "pattern": "^(0|[1-9][0-9]*)(\\.[0-9]+)?$",
          "description": "专项低额授权阈值；null 表示该产品没有专项规则。"
        },
        "lowAuthorizationFee": {
          "type": [
            "string",
            "null"
          ],
          "pattern": "^(0|[1-9][0-9]*)(\\.[0-9]+)?$",
          "description": "授权金额严格低于专项阈值且最终未拒付时按笔收取的费用。"
        },
        "lowAuthorizationStackMode": {
          "type": [
            "string",
            "null"
          ],
          "description": "专项低额授权费与平台小额交易费的叠加方式；replace_platform_small_tx 表示替代、不重复收取。"
        },
        "refundKeepMinimum": {
          "$ref": "#/components/schemas/NonNegativeDecimal",
          "description": "执行 /cards/{id}/refund 后卡内必须保留的最低余额；该值为 0 时允许全额退回。"
        },
        "minAmount": {
          "$ref": "#/components/schemas/NonNegativeDecimal"
        },
        "maxAmount": {
          "$ref": "#/components/schemas/NonNegativeDecimal"
        },
        "displayBin": {
          "type": [
            "string",
            "null"
          ],
          "pattern": "^[0-9]{6}$",
          "readOnly": true,
          "description": "仅供卡面展示的 6 位卡头。产品只有一个明确卡头时返回该值；多个或未知时返回 null。不得用于付款、路由或业务校验。"
        },
        "displayBins": {
          "type": "array",
          "items": {
            "type": "string",
            "pattern": "^[0-9]{6}$"
          },
          "readOnly": true,
          "description": "仅供卡面展示的全部明确 6 位卡头，按卡服务返回顺序去重；未知时返回空数组。不得用于付款、路由或业务校验。"
        },
        "binNotes": {
          "type": "object",
          "additionalProperties": {
            "type": "string"
          },
          "description": "按产品内 BIN 绑定的渠道使用提醒；不得跨产品复用。"
        },
        "restrictedMerchants": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "googleChatgptBlocked": {
          "type": "boolean"
        },
        "description": {
          "type": [
            "string",
            "null"
          ]
        },
        "category": {
          "type": [
            "string",
            "null"
          ]
        }
      }
    },
    "ProductsResponse": {
      "type": "object",
      "required": [
        "code",
        "data"
      ],
      "properties": {
        "code": {
          "$ref": "#/components/schemas/SuccessCode"
        },
        "data": {
          "type": "array",
          "items": {
            "$ref": "#/components/schemas/Product"
          }
        }
      }
    },
    "PaymentRisk": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "enabled",
        "windowDays",
        "minAttempts",
        "lockThresholdBps",
        "releaseThresholdBps",
        "reserveBps",
        "attempts",
        "successes",
        "declines",
        "successRateBps",
        "declineRateBps",
        "reserveActive",
        "evaluatedAt"
      ],
      "properties": {
        "enabled": {
          "type": "boolean"
        },
        "windowDays": {
          "type": "integer",
          "minimum": 1,
          "maximum": 365
        },
        "minAttempts": {
          "type": "integer",
          "minimum": 1,
          "maximum": 10000
        },
        "lockThresholdBps": {
          "type": "integer",
          "minimum": 1,
          "maximum": 10000
        },
        "releaseThresholdBps": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9999
        },
        "reserveBps": {
          "type": "integer",
          "minimum": 1,
          "maximum": 10000
        },
        "attempts": {
          "type": "integer",
          "minimum": 0
        },
        "successes": {
          "type": "integer",
          "minimum": 0
        },
        "declines": {
          "type": "integer",
          "minimum": 0
        },
        "successRateBps": {
          "type": [
            "integer",
            "null"
          ],
          "minimum": 0,
          "maximum": 10000
        },
        "declineRateBps": {
          "type": [
            "integer",
            "null"
          ],
          "minimum": 0,
          "maximum": 10000
        },
        "reserveActive": {
          "type": "boolean"
        },
        "evaluatedAt": {
          "type": [
            "string",
            "null"
          ],
          "format": "date-time"
        }
      },
      "description": "调用方全部卡消费在滚动窗口内按 (渠道, auth_id) 折叠后的权威统计。Settlement COMPLETE 始终计成功；否则 Authorization DECLINED 与 Reversal COMPLETE 以最先记录的终态为准，前者计拒绝、后者排除。退款、未决与未知状态不进入分母。自动比例锁定生效后，绝对锁额只会随余额补足而增加；下调 reserveBps 不会释放已有锁额，只有策略停用或拒绝率低于释放阈值才释放。"
    },
    "Balance": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "balance",
        "totalBalance",
        "riskLockedBalance",
        "retryReservedBalance",
        "paymentRisk",
        "promoBalance",
        "cumulativeDeposit",
        "cumulativeSpend"
      ],
      "properties": {
        "balance": {
          "allOf": [
            {
              "$ref": "#/components/schemas/Decimal"
            }
          ],
          "description": "兼容字段：当前可用余额，即 totalBalance - riskLockedBalance。riskLockedBalance 已包含新卡重试预留，不要重复扣除 retryReservedBalance。"
        },
        "totalBalance": {
          "allOf": [
            {
              "$ref": "#/components/schemas/Decimal"
            }
          ],
          "description": "钱包总余额，包含支付风险锁定部分。"
        },
        "riskLockedBalance": {
          "allOf": [
            {
              "$ref": "#/components/schemas/Decimal"
            }
          ],
          "description": "因自动支付拒绝率比例策略或既有账户级风险冻结而暂不可用于普通消费的余额；锁定和释放不会产生钱包收支流水。paymentRisk.reserveActive 仅表示自动比例策略是否生效。"
        },
        "paymentRisk": {
          "$ref": "#/components/schemas/PaymentRisk"
        },
        "retryReservedBalance": {
          "allOf": [
            {
              "$ref": "#/components/schemas/Decimal"
            }
          ],
          "description": "已授权新卡重试的未消耗预算预留，USD；已经包含在 riskLockedBalance 中，不能再次扣除。"
        },
        "promoBalance": {
          "$ref": "#/components/schemas/Decimal"
        },
        "cumulativeDeposit": {
          "$ref": "#/components/schemas/Decimal"
        },
        "cumulativeSpend": {
          "$ref": "#/components/schemas/Decimal"
        }
      }
    },
    "BalanceResponse": {
      "type": "object",
      "required": [
        "code",
        "data"
      ],
      "properties": {
        "code": {
          "$ref": "#/components/schemas/SuccessCode"
        },
        "data": {
          "$ref": "#/components/schemas/Balance"
        }
      }
    },
    "CreateDepositInput": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "currency",
        "network",
        "amount"
      ],
      "properties": {
        "currency": {
          "type": "string",
          "const": "USDT"
        },
        "network": {
          "type": "string",
          "enum": [
            "TRON",
            "BSC",
            "SOL"
          ]
        },
        "amount": {
          "type": "string",
          "pattern": "^[0-9]+(?:\\.[0-9]{1,2})?$",
          "description": "期望充值的 USDT 金额，范围 10.00–1,000,000.00，最多两位小数。请使用字符串，不得使用浮点数或科学计数法。"
        }
      }
    },
    "CreateDepositResult": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "gatewayRef",
        "address",
        "currency",
        "network",
        "tokenAccount",
        "requestedAmount",
        "expectedAmount",
        "creditedEstimate",
        "createdAt",
        "expiredAt",
        "cancellable",
        "reused"
      ],
      "properties": {
        "gatewayRef": {
          "type": "string",
          "format": "uuid",
          "description": "充值订单唯一标识；客户系统应与本地订单持久化绑定。"
        },
        "address": {
          "type": "string",
          "description": "TRON/BSC 的实际收款地址；SOL 时仅为 tokenAccount 的 owner 地址，不是 SPL USDT 转账目标。"
        },
        "currency": {
          "type": "string",
          "const": "USDT"
        },
        "network": {
          "type": "string",
          "enum": [
            "TRON",
            "BSC",
            "SOL"
          ]
        },
        "tokenAccount": {
          "type": [
            "string",
            "null"
          ],
          "description": "SOL 订单的实际 SPL USDT 收款目标，必须向此地址转账；其他网络为 null。"
        },
        "requestedAmount": {
          "$ref": "#/components/schemas/NonNegativeDecimal"
        },
        "expectedAmount": {
          "allOf": [
            {
              "$ref": "#/components/schemas/NonNegativeDecimal"
            }
          ],
          "description": "链上实际应支付的唯一金额；请勿仅支付 requestedAmount。"
        },
        "creditedEstimate": {
          "allOf": [
            {
              "$ref": "#/components/schemas/NonNegativeDecimal"
            }
          ],
          "description": "按当前规则估算的钱包入账金额；最终以 confirmed 订单的 creditedAmount 为准。"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "expiredAt": {
          "type": "string",
          "format": "date-time"
        },
        "cancellable": {
          "type": "boolean",
          "description": "true 表示订单当前尚未付款、仍有效且可由创建它的调用方取消。"
        },
        "reused": {
          "type": "boolean",
          "description": "true 表示同一 Idempotency-Key 的安全重放，未创建新订单。"
        }
      }
    },
    "CreateDepositResponse": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "code",
        "data"
      ],
      "properties": {
        "code": {
          "$ref": "#/components/schemas/SuccessCode"
        },
        "data": {
          "$ref": "#/components/schemas/CreateDepositResult"
        }
      }
    },
    "CancelDepositResponse": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "code",
        "data"
      ],
      "properties": {
        "code": {
          "$ref": "#/components/schemas/SuccessCode"
        },
        "data": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "gatewayRef",
            "status",
            "cancelledAt",
            "replayed"
          ],
          "properties": {
            "gatewayRef": {
              "type": "string",
              "format": "uuid"
            },
            "status": {
              "type": "string",
              "enum": [
                "cancelled"
              ],
              "description": "首次成功取消和任何资源幂等重放都固定返回 cancelled。"
            },
            "cancelledAt": {
              "type": "string",
              "format": "date-time",
              "description": "首次成功取消时间；资源幂等重放返回同一时间。"
            },
            "replayed": {
              "type": "boolean",
              "description": "true 表示订单曾经成功取消，本次仅返回已有结果。"
            }
          }
        }
      }
    },
    "Deposit": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "gatewayRef",
        "address",
        "currency",
        "network",
        "tokenAccount",
        "requestedAmount",
        "expectedAmount",
        "creditedEstimate",
        "actualAmount",
        "creditedAmount",
        "fee",
        "txHash",
        "status",
        "createdAt",
        "expiredAt",
        "confirmedAt",
        "cancelledAt",
        "cancellable"
      ],
      "properties": {
        "gatewayRef": {
          "type": "string",
          "format": "uuid"
        },
        "address": {
          "type": "string",
          "description": "TRON/BSC 的实际收款地址；SOL 时仅为 tokenAccount 的 owner 地址，不是 SPL USDT 转账目标。"
        },
        "currency": {
          "type": "string",
          "const": "USDT"
        },
        "network": {
          "type": "string",
          "enum": [
            "TRON",
            "BSC",
            "SOL"
          ]
        },
        "tokenAccount": {
          "type": [
            "string",
            "null"
          ],
          "description": "SOL 订单的实际 SPL USDT 收款目标；其他网络为 null。"
        },
        "requestedAmount": {
          "$ref": "#/components/schemas/NonNegativeDecimal"
        },
        "expectedAmount": {
          "allOf": [
            {
              "$ref": "#/components/schemas/NonNegativeDecimal"
            }
          ],
          "description": "链上实际应支付的唯一金额。"
        },
        "creditedEstimate": {
          "$ref": "#/components/schemas/NonNegativeDecimal"
        },
        "actualAmount": {
          "type": [
            "string",
            "null"
          ],
          "pattern": "^[0-9]+(?:\\.[0-9]{1,6})?$"
        },
        "creditedAmount": {
          "type": [
            "string",
            "null"
          ],
          "pattern": "^[0-9]+(?:\\.[0-9]{1,6})?$",
          "description": "status=confirmed 时已实际记入客户钱包的金额。"
        },
        "fee": {
          "type": [
            "string",
            "null"
          ],
          "pattern": "^[0-9]+(?:\\.[0-9]{1,6})?$"
        },
        "txHash": {
          "type": [
            "string",
            "null"
          ]
        },
        "status": {
          "type": "string",
          "enum": [
            "pending",
            "expired",
            "confirmed",
            "failed",
            "cancelled"
          ],
          "description": "只有 confirmed 表示到账且钱包已入账。expired 仍可因迟到的有效链上转账变为 confirmed；cancelled 是不可变终态，后续转账不会匹配该订单或自动入账。"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "expiredAt": {
          "type": "string",
          "format": "date-time"
        },
        "confirmedAt": {
          "type": [
            "string",
            "null"
          ],
          "format": "date-time"
        },
        "cancelledAt": {
          "type": [
            "string",
            "null"
          ],
          "format": "date-time",
          "description": "取消成功时间；非 null 表示订单已进入不可变 cancelled 终态。"
        },
        "cancellable": {
          "type": "boolean",
          "description": "true 表示订单当前可取消。在发起链上转账后不应调用取消接口。"
        }
      }
    },
    "DepositResponse": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "code",
        "data"
      ],
      "properties": {
        "code": {
          "$ref": "#/components/schemas/SuccessCode"
        },
        "data": {
          "$ref": "#/components/schemas/Deposit"
        }
      }
    },
    "BalanceLog": {
      "type": "object",
      "required": [
        "id",
        "type",
        "amount",
        "balanceBefore",
        "balanceAfter",
        "remark",
        "createdAt"
      ],
      "properties": {
        "id": {
          "type": "integer",
          "format": "int64"
        },
        "type": {
          "type": "string"
        },
        "amount": {
          "$ref": "#/components/schemas/Decimal"
        },
        "balanceBefore": {
          "$ref": "#/components/schemas/Decimal"
        },
        "balanceAfter": {
          "$ref": "#/components/schemas/Decimal"
        },
        "remark": {
          "type": [
            "string",
            "null"
          ]
        },
        "createdAt": {
          "type": "string"
        }
      }
    },
    "BalanceLogsResponse": {
      "type": "object",
      "required": [
        "code",
        "data"
      ],
      "properties": {
        "code": {
          "$ref": "#/components/schemas/SuccessCode"
        },
        "data": {
          "type": "object",
          "required": [
            "total",
            "list",
            "forceNewCardEnabled"
          ],
          "properties": {
            "total": {
              "type": "integer",
              "format": "int64"
            },
            "list": {
              "type": "array",
              "items": {
                "$ref": "#/components/schemas/BalanceLog"
              }
            }
          }
        }
      }
    },
    "CardSummary": {
      "type": "object",
      "required": [
        "id",
        "cardNumberMasked",
        "productCode",
        "network",
        "issuingArea",
        "status",
        "balance",
        "refundKeepMinimum",
        "firstName",
        "lastName",
        "note",
        "pendingOperationId",
        "pendingOperationType",
        "createdAt"
      ],
      "properties": {
        "id": {
          "type": "integer",
          "format": "int64"
        },
        "cardNumberMasked": {
          "type": "string",
          "description": "脱敏卡号；不得假设固定掩码格式。"
        },
        "productCode": {
          "type": "string"
        },
        "network": {
          "type": "string"
        },
        "issuingArea": {
          "type": "string"
        },
        "status": {
          "type": "string",
          "description": "卡片可用状态，反映已确认的上游关闭状态；不表示资金核验结束。"
        },
        "upstreamStatus": {
          "type": [
            "string",
            "null"
          ],
          "description": "最近一次已验证的上游状态。"
        },
        "accountingStatus": {
          "type": "string",
          "description": "本站财务状态；可能与上游状态不同，不能据此重复派发资金请求。"
        },
        "balance": {
          "$ref": "#/components/schemas/Decimal"
        },
        "refundKeepMinimum": {
          "$ref": "#/components/schemas/NonNegativeDecimal",
          "description": "该卡执行余额退回后必须保留的最低余额快照。"
        },
        "firstName": {
          "type": "string"
        },
        "lastName": {
          "type": "string"
        },
        "note": {
          "type": "string",
          "description": "客户为该卡填写的备注；列表接口直接返回，无需再请求详情。"
        },
        "pendingOperationId": {
          "type": [
            "string",
            "null"
          ],
          "format": "uuid",
          "description": "当前挂起卡片资金操作的编号；无挂起操作时为 null。"
        },
        "pendingOperationType": {
          "type": [
            "string",
            "null"
          ],
          "description": "当前挂起卡片资金操作类型；无挂起操作时为 null。"
        },
        "pendingOperationError": {
          "type": [
            "string",
            "null"
          ],
          "description": "挂起退款的客户可见说明，包含已核验的消费占用及最新可退余额；不表示退款已经完成。"
        },
        "createdAt": {
          "type": "string"
        }
      }
    },
    "CardsResponse": {
      "type": "object",
      "required": [
        "code",
        "data"
      ],
      "properties": {
        "code": {
          "$ref": "#/components/schemas/SuccessCode"
        },
        "data": {
          "type": "object",
          "required": [
            "total",
            "page",
            "pageSize",
            "list"
          ],
          "properties": {
            "total": {
              "type": "integer"
            },
            "page": {
              "type": "integer",
              "minimum": 1
            },
            "pageSize": {
              "type": "integer",
              "minimum": 1,
              "maximum": 100
            },
            "list": {
              "type": "array",
              "items": {
                "$ref": "#/components/schemas/CardSummary"
              }
            }
          }
        }
      }
    },
    "CardDetail": {
      "type": "object",
      "required": [
        "id",
        "cardNumberMasked",
        "status",
        "network",
        "issuingArea",
        "issuer",
        "availableAmount",
        "firstName",
        "lastName",
        "note",
        "productCode",
        "minAmount",
        "maxAmount",
        "rechargeRate",
        "refundRate",
        "declineFee",
        "authorizationReversalRate",
        "authorizationFee",
        "smallTransactionFee",
        "crossBorderFee",
        "lowAuthorizationThreshold",
        "lowAuthorizationFee",
        "lowAuthorizationStackMode",
        "refundKeepMinimum",
        "pendingOperationId",
        "pendingOperationType",
        "expiry",
        "createdAt"
      ],
      "properties": {
        "id": {
          "type": "integer",
          "format": "int64"
        },
        "cardNumberMasked": {
          "type": "string"
        },
        "status": {
          "type": "string",
          "description": "卡片可用状态，反映已确认的上游关闭状态；不表示资金核验结束。"
        },
        "upstreamStatus": {
          "type": [
            "string",
            "null"
          ],
          "description": "最近一次已验证的上游状态。"
        },
        "accountingStatus": {
          "type": "string",
          "description": "本站财务状态；可能与上游状态不同，不能据此重复派发资金请求。"
        },
        "network": {
          "type": "string"
        },
        "issuingArea": {
          "type": "string"
        },
        "issuer": {
          "type": "string"
        },
        "availableAmount": {
          "$ref": "#/components/schemas/Decimal"
        },
        "firstName": {
          "type": "string"
        },
        "lastName": {
          "type": "string"
        },
        "note": {
          "type": "string"
        },
        "productCode": {
          "type": "string"
        },
        "minAmount": {
          "$ref": "#/components/schemas/NonNegativeDecimal"
        },
        "maxAmount": {
          "$ref": "#/components/schemas/NonNegativeDecimal"
        },
        "rechargeRate": {
          "allOf": [
            {
              "$ref": "#/components/schemas/NonNegativeDecimal"
            }
          ],
          "description": "该卡当前适用的充值手续费率。"
        },
        "refundRate": {
          "allOf": [
            {
              "$ref": "#/components/schemas/NonNegativeDecimal"
            }
          ],
          "description": "消费交易发生 Refund COMPLETE 时按退款金额收取的当前客户手续费率。该字段不适用于 /cards/{id}/refund 的卡余额退回操作。"
        },
        "declineFee": {
          "$ref": "#/components/schemas/NonNegativeDecimal",
          "description": "该卡当前适用的 Authorization DECLINED 按笔手续费。"
        },
        "authorizationReversalRate": {
          "$ref": "#/components/schemas/NonNegativeDecimal",
          "description": "该卡开卡时冻结的授权撤销手续费率。"
        },
        "authorizationFee": {
          "$ref": "#/components/schemas/NonNegativeDecimal",
          "description": "该卡开卡时冻结的成功授权按笔手续费。"
        },
        "smallTransactionFee": {
          "$ref": "#/components/schemas/NonNegativeDecimal",
          "description": "该卡开卡时冻结的小额交易手续费字段。"
        },
        "crossBorderFee": {
          "$ref": "#/components/schemas/NonNegativeDecimal",
          "description": "该卡开卡时冻结的跨境交易手续费字段。"
        },
        "lowAuthorizationThreshold": {
          "type": [
            "string",
            "null"
          ],
          "pattern": "^(0|[1-9][0-9]*)(\\.[0-9]+)?$"
        },
        "lowAuthorizationFee": {
          "type": [
            "string",
            "null"
          ],
          "pattern": "^(0|[1-9][0-9]*)(\\.[0-9]+)?$"
        },
        "lowAuthorizationStackMode": {
          "type": [
            "string",
            "null"
          ]
        },
        "refundKeepMinimum": {
          "$ref": "#/components/schemas/NonNegativeDecimal",
          "description": "该卡执行余额退回后必须保留的最低余额快照。"
        },
        "pendingOperationId": {
          "type": [
            "string",
            "null"
          ],
          "format": "uuid",
          "description": "当前挂起卡片资金操作的编号；无挂起操作时为 null。"
        },
        "pendingOperationType": {
          "type": [
            "string",
            "null"
          ],
          "description": "当前挂起卡片资金操作类型；无挂起操作时为 null。"
        },
        "expiry": {
          "type": "string"
        },
        "createdAt": {
          "type": "string"
        }
      }
    },
    "CardDetailResponse": {
      "type": "object",
      "required": [
        "code",
        "data"
      ],
      "properties": {
        "code": {
          "$ref": "#/components/schemas/SuccessCode"
        },
        "data": {
          "$ref": "#/components/schemas/CardDetail"
        }
      }
    },
    "CardAddress": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "addressLineOne",
        "addressLineTwo",
        "city",
        "state",
        "country",
        "postCode"
      ],
      "properties": {
        "addressLineOne": {
          "type": "string",
          "maxLength": 200
        },
        "addressLineTwo": {
          "type": "string",
          "maxLength": 200
        },
        "city": {
          "type": "string",
          "maxLength": 100
        },
        "state": {
          "type": "string",
          "maxLength": 100
        },
        "country": {
          "type": "string",
          "maxLength": 100
        },
        "postCode": {
          "type": "string",
          "maxLength": 32
        }
      },
      "description": "账单地址。与完整卡号相同，仅由敏感卡信息接口返回；禁止写日志或浏览器存储。"
    },
    "CardSensitive": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "cardNumber",
        "cvv",
        "expire",
        "cardAddress"
      ],
      "properties": {
        "cardNumber": {
          "type": "string",
          "pattern": "^[0-9]{12,19}$",
          "description": "仅在内存中使用；禁止写日志。"
        },
        "cvv": {
          "type": "string",
          "pattern": "^[0-9]{3,4}$",
          "description": "禁止持久化。"
        },
        "expire": {
          "type": "string"
        },
        "cardAddress": {
          "anyOf": [
            {
              "$ref": "#/components/schemas/CardAddress"
            },
            {
              "type": "null"
            }
          ]
        }
      }
    },
    "CardSensitiveResponse": {
      "type": "object",
      "required": [
        "code",
        "data"
      ],
      "properties": {
        "code": {
          "$ref": "#/components/schemas/SuccessCode"
        },
        "data": {
          "$ref": "#/components/schemas/CardSensitive"
        }
      }
    },
    "CardTransaction": {
      "type": "object",
      "required": [
        "id",
        "authId",
        "cardId",
        "type",
        "status",
        "authAmount",
        "settleAmount",
        "authCurrency",
        "settleCurrency",
        "merchantName",
        "description",
        "merchantLocation",
        "merchantRegion",
        "merchantCountry",
        "failedReason",
        "billStatus",
        "merchantAmount",
        "merchantCurrency",
        "sourceCreatedAt",
        "source",
        "channel",
        "authTime",
        "createdAt",
        "cardNumberMasked"
      ],
      "properties": {
        "id": {
          "type": "integer",
          "format": "int64"
        },
        "authId": {
          "type": "string"
        },
        "cardId": {
          "type": "integer",
          "format": "int64"
        },
        "type": {
          "type": "string"
        },
        "status": {
          "type": "string"
        },
        "authAmount": {
          "$ref": "#/components/schemas/Decimal"
        },
        "settleAmount": {
          "$ref": "#/components/schemas/Decimal"
        },
        "authCurrency": {
          "type": "string"
        },
        "settleCurrency": {
          "type": "string"
        },
        "merchantName": {
          "type": [
            "string",
            "null"
          ]
        },
        "description": {
          "type": [
            "string",
            "null"
          ]
        },
        "merchantLocation": {
          "type": [
            "string",
            "null"
          ]
        },
        "merchantRegion": {
          "type": [
            "string",
            "null"
          ]
        },
        "merchantCountry": {
          "type": [
            "string",
            "null"
          ]
        },
        "failedReason": {
          "type": [
            "string",
            "null"
          ]
        },
        "billStatus": {
          "type": [
            "string",
            "null"
          ]
        },
        "merchantAmount": {
          "type": [
            "string",
            "null"
          ]
        },
        "merchantCurrency": {
          "type": [
            "string",
            "null"
          ]
        },
        "sourceCreatedAt": {
          "type": [
            "string",
            "null"
          ],
          "description": "来源系统记录的交易创建时间。"
        },
        "source": {
          "type": [
            "string",
            "null"
          ]
        },
        "channel": {
          "type": [
            "string",
            "null"
          ]
        },
        "authTime": {
          "type": "string"
        },
        "createdAt": {
          "type": "string"
        },
        "cardNumberMasked": {
          "type": "string"
        }
      }
    },
    "CardFundingActivity": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "operationId",
        "type",
        "cardId",
        "amount",
        "fee",
        "totalAmount",
        "openFee",
        "rechargeFee",
        "status",
        "occurredAt"
      ],
      "properties": {
        "operationId": {
          "type": "string",
          "format": "uuid"
        },
        "type": {
          "type": "string",
          "enum": [
            "OPEN_CARD",
            "RECHARGE"
          ]
        },
        "cardId": {
          "type": "integer",
          "format": "int64"
        },
        "amount": {
          "$ref": "#/components/schemas/Decimal"
        },
        "fee": {
          "$ref": "#/components/schemas/Decimal"
        },
        "totalAmount": {
          "$ref": "#/components/schemas/Decimal"
        },
        "openFee": {
          "type": [
            "string",
            "null"
          ]
        },
        "rechargeFee": {
          "type": [
            "string",
            "null"
          ]
        },
        "status": {
          "type": "string",
          "const": "SUCCEEDED"
        },
        "occurredAt": {
          "type": "string"
        }
      },
      "description": "平台本地账本中已成功的开卡首充或卡片充值活动；不会伪装成卡组织消费交易。"
    },
    "CardTransactionsResponse": {
      "type": "object",
      "required": [
        "code",
        "data"
      ],
      "properties": {
        "code": {
          "$ref": "#/components/schemas/SuccessCode"
        },
        "data": {
          "type": "object",
          "required": [
            "total",
            "list",
            "source",
            "activityTotal",
            "activities"
          ],
          "properties": {
            "total": {
              "type": "integer",
              "format": "int64"
            },
            "list": {
              "type": "array",
              "items": {
                "$ref": "#/components/schemas/CardTransaction"
              }
            },
            "source": {
              "type": "string",
              "const": "db"
            },
            "activityTotal": {
              "type": "integer",
              "format": "int64"
            },
            "activities": {
              "type": "array",
              "items": {
                "$ref": "#/components/schemas/CardFundingActivity"
              }
            }
          }
        }
      }
    },
    "CardRecharge": {
      "type": "object",
      "required": [
        "id",
        "amount",
        "fee",
        "status",
        "createdAt",
        "syncedAt"
      ],
      "properties": {
        "id": {
          "type": "integer",
          "format": "int64"
        },
        "amount": {
          "$ref": "#/components/schemas/Decimal"
        },
        "fee": {
          "$ref": "#/components/schemas/Decimal"
        },
        "status": {
          "type": "string"
        },
        "createdAt": {
          "type": "string"
        },
        "syncedAt": {
          "type": "string"
        }
      }
    },
    "CardRechargesResponse": {
      "type": "object",
      "required": [
        "code",
        "data"
      ],
      "properties": {
        "code": {
          "$ref": "#/components/schemas/SuccessCode"
        },
        "data": {
          "type": "object",
          "required": [
            "total",
            "list",
            "source"
          ],
          "properties": {
            "total": {
              "type": "integer",
              "format": "int64"
            },
            "list": {
              "type": "array",
              "items": {
                "$ref": "#/components/schemas/CardRecharge"
              }
            },
            "source": {
              "type": "string",
              "const": "db"
            }
          }
        }
      }
    },
    "OpenCardInput": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "productCode",
        "firstName",
        "lastName",
        "initAmount",
        "count",
        "expectedOpenFee",
        "expectedInitialRechargeFee",
        "openQuoteVersion"
      ],
      "properties": {
        "productCode": {
          "type": "string",
          "minLength": 1,
          "maxLength": 32
        },
        "firstName": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "\\S"
        },
        "lastName": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "\\S"
        },
        "initAmount": {
          "$ref": "#/components/schemas/InputAmount"
        },
        "count": {
          "type": "integer",
          "const": 1
        },
        "expectedOpenFee": {
          "$ref": "#/components/schemas/NonNegativeDecimal"
        },
        "expectedInitialRechargeFee": {
          "allOf": [
            {
              "$ref": "#/components/schemas/NonNegativeDecimal"
            }
          ],
          "description": "本次 initAmount 按产品 rechargeRate 计算的初始充值手续费，正数结果向上取整到 4 位小数；必须与服务端当前报价完全一致。"
        },
        "openQuoteVersion": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        }
      }
    },
    "OpenCardResult": {
      "type": "object",
      "required": [
        "operationId",
        "cardIds",
        "balance",
        "replayed"
      ],
      "properties": {
        "operationId": {
          "type": "string",
          "format": "uuid"
        },
        "cardIds": {
          "type": "array",
          "minItems": 1,
          "maxItems": 1,
          "items": {
            "type": "integer",
            "format": "int64"
          }
        },
        "balance": {
          "$ref": "#/components/schemas/Decimal"
        },
        "replayed": {
          "type": "boolean"
        }
      }
    },
    "OpenCardResponse": {
      "type": "object",
      "required": [
        "code",
        "data"
      ],
      "properties": {
        "code": {
          "$ref": "#/components/schemas/SuccessCode"
        },
        "data": {
          "$ref": "#/components/schemas/OpenCardResult"
        }
      }
    },
    "AmountInput": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "amount"
      ],
      "properties": {
        "amount": {
          "$ref": "#/components/schemas/InputAmount"
        }
      }
    },
    "RechargeQuoteInput": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "amount"
      ],
      "properties": {
        "amount": {
          "$ref": "#/components/schemas/InputAmount"
        }
      }
    },
    "RechargeInput": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "amount",
        "expectedFee"
      ],
      "properties": {
        "amount": {
          "$ref": "#/components/schemas/InputAmount"
        },
        "expectedFee": {
          "$ref": "#/components/schemas/NonNegativeDecimal"
        }
      }
    },
    "RechargeQuoteResult": {
      "type": "object",
      "required": [
        "amount",
        "fee",
        "totalDebit",
        "effectiveRechargeRate"
      ],
      "properties": {
        "amount": {
          "$ref": "#/components/schemas/Decimal"
        },
        "fee": {
          "$ref": "#/components/schemas/Decimal"
        },
        "totalDebit": {
          "$ref": "#/components/schemas/Decimal"
        },
        "effectiveRechargeRate": {
          "$ref": "#/components/schemas/NonNegativeDecimal"
        }
      }
    },
    "RechargeQuoteResponse": {
      "type": "object",
      "required": [
        "code",
        "data"
      ],
      "properties": {
        "code": {
          "$ref": "#/components/schemas/SuccessCode"
        },
        "data": {
          "$ref": "#/components/schemas/RechargeQuoteResult"
        }
      }
    },
    "CardActionResult": {
      "type": "object",
      "required": [
        "operationId",
        "status",
        "cardBalance",
        "walletBalance",
        "fee",
        "replayed"
      ],
      "properties": {
        "operationId": {
          "type": "string",
          "format": "uuid"
        },
        "status": {
          "type": "string"
        },
        "cardBalance": {
          "$ref": "#/components/schemas/Decimal"
        },
        "walletBalance": {
          "$ref": "#/components/schemas/Decimal"
        },
        "fee": {
          "$ref": "#/components/schemas/Decimal"
        },
        "replayed": {
          "type": "boolean"
        }
      }
    },
    "CardActionResponse": {
      "type": "object",
      "required": [
        "code",
        "data"
      ],
      "properties": {
        "code": {
          "$ref": "#/components/schemas/SuccessCode"
        },
        "data": {
          "$ref": "#/components/schemas/CardActionResult"
        }
      }
    },
    "PendingOperationResponse": {
      "type": "object",
      "required": [
        "error",
        "operationId",
        "status"
      ],
      "properties": {
        "error": {
          "type": "string"
        },
        "operationId": {
          "type": "string",
          "format": "uuid"
        },
        "status": {
          "type": "string",
          "const": "PENDING"
        }
      }
    },
    "GptAutoCard": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "productCode",
        "initAmount",
        "expectedOpenFee",
        "expectedInitialRechargeFee",
        "openQuoteVersion",
        "quoteCountry",
        "quoteCurrency",
        "quotedAmountUsd"
      ],
      "properties": {
        "productCode": {
          "type": "string",
          "minLength": 1,
          "maxLength": 32
        },
        "initAmount": {
          "$ref": "#/components/schemas/InputAmount"
        },
        "expectedOpenFee": {
          "$ref": "#/components/schemas/InputAmount"
        },
        "expectedInitialRechargeFee": {
          "$ref": "#/components/schemas/InputAmount"
        },
        "openQuoteVersion": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        },
        "quoteCountry": {
          "type": "string",
          "pattern": "^[A-Z]{2}$"
        },
        "quoteCurrency": {
          "type": "string",
          "pattern": "^[A-Z]{3}$"
        },
        "quotedAmountUsd": {
          "type": "string"
        },
        "reuseExisting": {
          "type": "boolean",
          "default": false
        },
        "excludedCardIds": {
          "type": "array",
          "maxItems": 8,
          "uniqueItems": true,
          "items": {
            "type": "integer",
            "minimum": 1
          }
        },
        "oneCardPerAccount": {
          "type": "boolean",
          "default": false,
          "description": "每个账号新开卡；该卡不再进入共享卡池。启用时 reuseExisting 必须为 false。"
        }
      },
      "description": "报价须来自本次预检和开卡报价。initAmount 至少为 quotedAmountUsd+3 美元向上保留两位。reuseExisting=false 时 excludedCardIds 必须为空。 oneCardPerAccount=true 时每个账号新开卡并排除后续卡池复用。"
    },
    "GptReplaceSessionInput": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "credential"
      ],
      "properties": {
        "credential": {
          "$ref": "#/components/schemas/GptSessionCredential"
        }
      }
    },
    "GptCredential": {
      "oneOf": [
        {
          "$ref": "#/components/schemas/GptSessionCredential"
        },
        {
          "$ref": "#/components/schemas/GptAccessTokenCredential"
        },
        {
          "$ref": "#/components/schemas/GptMailboxCredential"
        },
        {
          "$ref": "#/components/schemas/GptPasswordCredential"
        }
      ],
      "discriminator": {
        "propertyName": "mode",
        "mapping": {
          "session": "#/components/schemas/GptSessionCredential",
          "mailbox": "#/components/schemas/GptMailboxCredential",
          "access_token": "#/components/schemas/GptAccessTokenCredential",
          "password": "#/components/schemas/GptPasswordCredential"
        }
      }
    },
    "GptSessionCredential": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "mode",
        "session"
      ],
      "properties": {
        "mode": {
          "type": "string",
          "const": "session"
        },
        "session": {
          "type": "string",
          "minLength": 8,
          "maxLength": 65536,
          "writeOnly": true,
          "description": "完整会话 JSON 字符串，必须包含 sessionToken 和 accessToken；UTF-8 编码后不超过 65536 字节。禁止日志记录、分享或缓存；服务端执行期间加密保存，用于原订单恢复。"
        }
      }
    },
    "GptAccessTokenCredential": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "mode",
        "accessToken"
      ],
      "properties": {
        "mode": {
          "type": "string",
          "const": "access_token"
        },
        "accessToken": {
          "type": "string",
          "minLength": 8,
          "maxLength": 32768,
          "writeOnly": true
        }
      },
      "deprecated": true,
      "description": "旧格式，仅为兼容历史文档保留。当前直充返回 GPT_ACCESS_TOKEN_UNSUPPORTED；请使用同时包含 sessionToken、accessToken 的完整 Session JSON。"
    },
    "GptMailboxCredential": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "mode",
        "email",
        "password"
      ],
      "properties": {
        "mode": {
          "type": "string",
          "const": "mailbox"
        },
        "email": {
          "type": "string",
          "maxLength": 320,
          "writeOnly": true
        },
        "password": {
          "type": "string",
          "minLength": 1,
          "maxLength": 1024,
          "writeOnly": true
        }
      },
      "description": "仅限服务端已启用的邮箱登录预检；不能把邮箱模式当作 Session 恢复接口的输入。"
    },
    "GptPlan": {
      "type": "object",
      "required": [
        "key",
        "label",
        "currency",
        "enabled",
        "serviceFeeUsdMinor",
        "customerServiceFee",
        "expectedAmountMinor",
        "minAmountMinor",
        "maxAmountMinor"
      ],
      "properties": {
        "key": {
          "type": "string",
          "enum": [
            "go",
            "plus",
            "pro_5x",
            "pro_20x",
            "pro_25x",
            "credits_250",
            "credits_1000",
            "credits_2500",
            "credits_5000"
          ]
        },
        "label": {
          "type": "string"
        },
        "currency": {
          "type": "string",
          "minLength": 3,
          "maxLength": 3
        },
        "enabled": {
          "type": "boolean"
        },
        "serviceFeeUsdMinor": {
          "type": "integer",
          "format": "int64",
          "minimum": 0
        },
        "customerServiceFee": {
          "$ref": "#/components/schemas/NonNegativeDecimal"
        },
        "expectedAmountMinor": {
          "type": [
            "integer",
            "null"
          ],
          "format": "int64"
        },
        "minAmountMinor": {
          "type": [
            "integer",
            "null"
          ],
          "format": "int64"
        },
        "maxAmountMinor": {
          "type": [
            "integer",
            "null"
          ],
          "format": "int64"
        }
      }
    },
    "GptPlansResponse": {
      "type": "object",
      "required": [
        "code",
        "data"
      ],
      "properties": {
        "code": {
          "$ref": "#/components/schemas/SuccessCode"
        },
        "data": {
          "type": "object",
          "required": [
            "version",
            "plans",
            "externalCardServiceFee",
            "checkoutCountries",
            "batchConcurrencyByCountry",
            "cdkRegionSelectionEnabled"
          ],
          "properties": {
            "version": {
              "type": "integer",
              "format": "int64",
              "minimum": 1
            },
            "plans": {
              "type": "array",
              "items": {
                "$ref": "#/components/schemas/GptPlan"
              }
            },
            "externalCardServiceFee": {
              "$ref": "#/components/schemas/InputAmount"
            },
            "checkoutCountries": {
              "type": "array",
              "items": {
                "$ref": "#/components/schemas/CheckoutRegion"
              },
              "description": "当前可选的结账地区及服务端指定币种；CDK生成和直充预检均从此列表选择。"
            },
            "batchConcurrencyByCountry": {
              "type": [
                "object",
                "null"
              ],
              "additionalProperties": {
                "type": "integer",
                "minimum": 0
              },
              "description": "当前各地区可用的批量并发能力；只代表容量快照。"
            },
            "cdkRegionSelectionEnabled": {
              "type": "boolean",
              "description": "是否支持在v1 CDK生成时指定结账地区。仅为true时发送paymentCountry；false或旧服务缺少此字段时省略。"
            }
          }
        }
      }
    },
    "GptPreflightInput": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "credential"
      ],
      "properties": {
        "credential": {
          "$ref": "#/components/schemas/GptCredential"
        },
        "paymentCountry": {
          "type": "string",
          "pattern": "^[A-Z]{2}$"
        },
        "paymentCurrency": {
          "type": "string",
          "pattern": "^[A-Z]{3}$"
        },
        "customProxyUrl": {
          "type": "string",
          "format": "uri",
          "maxLength": 512,
          "writeOnly": true,
          "description": "可选的 HTTP、HTTPS 或 SOCKS5 代理。必须带端口；服务端会验证公网地址、连通性和出口国家。末尾 #备注 会被忽略。"
        }
      }
    },
    "GptQuote": {
      "type": "object",
      "required": [
        "country",
        "currency",
        "plan",
        "amountMinor",
        "amountMajor",
        "minorUnitExponent",
        "fetchedAt"
      ],
      "properties": {
        "country": {
          "type": "string"
        },
        "currency": {
          "type": "string"
        },
        "plan": {
          "type": "string"
        },
        "amountMinor": {
          "type": "integer",
          "format": "int64"
        },
        "amountMajor": {
          "$ref": "#/components/schemas/Decimal"
        },
        "minorUnitExponent": {
          "type": "integer",
          "minimum": 0
        },
        "fetchedAt": {
          "type": "integer",
          "format": "int64"
        }
      }
    },
    "GptPreflightResult": {
      "type": "object",
      "required": [
        "email",
        "currentPlan",
        "credentialMode",
        "preflightToken",
        "preflightExpiresAt",
        "paymentCountry",
        "paymentCurrency",
        "quotes",
        "quoteError"
      ],
      "properties": {
        "email": {
          "type": "string",
          "description": "脱敏邮箱"
        },
        "currentPlan": {
          "type": "string"
        },
        "credentialMode": {
          "type": "string"
        },
        "preflightToken": {
          "type": "string",
          "maxLength": 16384,
          "description": "短期单次令牌；服务端仅保存不可逆摘要，禁止日志记录。"
        },
        "preflightExpiresAt": {
          "type": "string"
        },
        "paymentCountry": {
          "type": "string"
        },
        "paymentCurrency": {
          "type": "string"
        },
        "quotes": {
          "type": "object",
          "additionalProperties": {
            "$ref": "#/components/schemas/GptQuote"
          }
        },
        "quoteError": {
          "type": "string"
        },
        "quoteEstimatesUsd": {
          "type": "object",
          "additionalProperties": {
            "type": "string"
          },
          "description": "各套餐的实时美元估算；自动开卡须使用本次预检对应套餐值。"
        }
      }
    },
    "GptPreflightResponse": {
      "type": "object",
      "required": [
        "code",
        "data"
      ],
      "properties": {
        "code": {
          "$ref": "#/components/schemas/SuccessCode"
        },
        "data": {
          "$ref": "#/components/schemas/GptPreflightResult"
        }
      }
    },
    "GptCreateOrderInput": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "cardId",
        "plan",
        "credential",
        "preflightToken",
        "clientRequestId",
        "pricingVersion",
        "expectedCustomerServiceFee"
      ],
      "properties": {
        "cardId": {
          "type": "integer",
          "format": "int64",
          "minimum": 0,
          "description": "账户内 ACTIVE 卡 ID；externalCard 或 autoCard 模式须为 0。三种支付卡模式互斥。"
        },
        "externalCard": {
          "$ref": "#/components/schemas/GptExternalCard"
        },
        "plan": {
          "type": "string",
          "anyOf": [
            {
              "enum": [
                "go",
                "plus",
                "pro_5x",
                "pro_20x",
                "pro_25x"
              ]
            },
            {
              "pattern": "^credits_(?:25[0-9]|2[6-9][0-9]|[3-9][0-9]{2}|[1-9][0-9]{3,6})$"
            }
          ],
          "description": "订阅档位或 credits_N（N 为250–9999999的整数，不得有前导零）。必须使用本次预检返回且已确认的对应套餐报价；套餐实际开放状态取实时目录。"
        },
        "credential": {
          "$ref": "#/components/schemas/GptCredential"
        },
        "preflightToken": {
          "type": "string",
          "minLength": 8,
          "maxLength": 16384,
          "writeOnly": true
        },
        "clientRequestId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 80,
          "pattern": "^[A-Za-z0-9_.:-]+$"
        },
        "pricingVersion": {
          "type": "integer",
          "format": "int64",
          "minimum": 1
        },
        "expectedCustomerServiceFee": {
          "$ref": "#/components/schemas/InputAmount"
        },
        "autoCard": {
          "$ref": "#/components/schemas/GptAutoCard"
        },
        "retryPolicy": {
          "$ref": "#/components/schemas/GptRetryPolicy"
        }
      }
    },
    "GptRetryPolicy": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "enabled"
      ],
      "description": "默认关闭。仅 Plus / Pro：授权一次额外开新卡尝试及其钱包支出上限，不保证执行或成功。API 密钥同时需要 gpt:write、cards:open。费用上涨、未知付款、风控、已支付步骤均禁止自动换卡。未开放时返回 RETRY_DISABLED。省略或 enabled=false 不改变原请求幂等摘要。",
      "properties": {
        "enabled": {
          "type": "boolean"
        },
        "maxAdditionalAttempts": {
          "type": "integer",
          "enum": [
            1
          ]
        },
        "productCode": {
          "type": "string",
          "minLength": 1,
          "maxLength": 32,
          "pattern": "^[A-Za-z0-9_.-]+$"
        },
        "maxAdditionalWalletDebitUsd": {
          "type": "string",
          "maxLength": 16,
          "pattern": "^(?!0+(?:\\.0+)?$)(?:[0-9]{1,6}(?:\\.[0-9]{1,4})?|1000000(?:\\.0{1,4})?)$",
          "description": "额外钱包支出的总授权上限，含初始余额、开卡费、初充手续费和直充服务费；最多四位小数且不超过 1000000。退款不会恢复本次已消费的授权额度。"
        },
        "openQuoteVersion": {
          "type": "string",
          "pattern": "^[0-9a-fA-F]{64}$"
        },
        "expectedOpenFee": {
          "$ref": "#/components/schemas/InputAmount"
        },
        "expectedInitialRechargeFee": {
          "$ref": "#/components/schemas/InputAmount"
        }
      },
      "anyOf": [
        {
          "properties": {
            "enabled": {
              "enum": [
                false
              ]
            }
          }
        },
        {
          "properties": {
            "enabled": {
              "enum": [
                true
              ]
            }
          },
          "required": [
            "maxAdditionalAttempts",
            "productCode",
            "maxAdditionalWalletDebitUsd",
            "openQuoteVersion",
            "expectedOpenFee",
            "expectedInitialRechargeFee"
          ]
        }
      ]
    },
    "GptExternalCard": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "number",
        "expiry",
        "cvv"
      ],
      "properties": {
        "number": {
          "type": "string",
          "pattern": "^[0-9]{12,19}$",
          "writeOnly": true
        },
        "expiry": {
          "type": "string",
          "pattern": "^(0[1-9]|1[0-2])/[0-9]{2}$",
          "writeOnly": true
        },
        "cvv": {
          "type": "string",
          "pattern": "^[0-9]{3,4}$",
          "writeOnly": true
        },
        "holder": {
          "type": "string",
          "maxLength": 80,
          "writeOnly": true,
          "description": "可选。留空或省略时，系统会为本订单生成稳定的英文持卡人姓名。"
        }
      }
    },
    "GptCancelRenewalInput": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "credential"
      ],
      "properties": {
        "credential": {
          "$ref": "#/components/schemas/GptCredential"
        }
      }
    },
    "GptFailure": {
      "type": [
        "object",
        "null"
      ],
      "required": [
        "code",
        "source",
        "upstreamCode",
        "stage",
        "message",
        "causeConfirmed"
      ],
      "properties": {
        "code": {
          "type": "string",
          "enum": [
            "checkout_type_unsupported",
            "blocked",
            "missing_client_secret",
            "upgrade_risk_rejected",
            "checkout_environment_rejected",
            "risk_rejected",
            "insufficient_funds",
            "card_velocity_exceeded",
            "expired_card",
            "card_not_supported",
            "currency_not_supported",
            "incorrect_cvc",
            "invalid_cvc",
            "incorrect_zip",
            "incorrect_address",
            "generic_decline",
            "do_not_honor",
            "card_declined",
            "payment_declined",
            "payment_restricted",
            "authentication_required",
            "upgrade_card_authentication_required",
            "session_expired",
            "session_invalid",
            "GPT_SESSION_INVALID",
            "GPT_SESSION_REAUTH_REQUIRED",
            "session_refresh_required",
            "network_error",
            "network_timeout",
            "proxy_error",
            "http_error",
            "quote_out_of_range",
            "quote_changed",
            "quote_missing",
            "quote_currency_mismatch",
            "currency_mismatch",
            "funding_quote_expired",
            "account_not_payable",
            "delinquent_subscription",
            "promotion_ineligible",
            "payment_unconfirmed",
            "upgrade_unconfirmed",
            "checkout_confirm_failed",
            "unknown_failure"
          ]
        },
        "source": {
          "type": "string",
          "enum": [
            "stripe",
            "openai",
            "service",
            "unknown"
          ]
        },
        "upstreamCode": {
          "type": [
            "string",
            "null"
          ]
        },
        "stage": {
          "type": "string"
        },
        "message": {
          "type": "string"
        },
        "causeConfirmed": {
          "type": "boolean"
        }
      },
      "description": "null 表示无当前失败。causeConfirmed=false 时具体根因未证实；换卡不保证成功。upstreamCode 仅公开白名单，敏感风控分类不公开。"
    },
    "GptPayment": {
      "type": "object",
      "required": [
        "submitted",
        "status",
        "evidenceSource",
        "evidenceAt",
        "authorizationObserved",
        "targetConfirmed"
      ],
      "properties": {
        "submitted": {
          "type": [
            "boolean",
            "null"
          ]
        },
        "status": {
          "type": "string",
          "enum": [
            "not_submitted",
            "declined",
            "paid",
            "partially_paid",
            "pending_verification",
            "unknown"
          ]
        },
        "evidenceSource": {
          "type": [
            "string",
            "null"
          ],
          "enum": [
            "stripe_payment_intent",
            "paid_invoice",
            "payment_boundary",
            "stripe_decline",
            "upstream_order",
            null
          ]
        },
        "evidenceAt": {
          "type": [
            "string",
            "null"
          ],
          "format": "date-time"
        },
        "authorizationObserved": {
          "type": "boolean"
        },
        "targetConfirmed": {
          "type": "boolean"
        }
      },
      "description": "submitted=true 仅说明曾提交，不代表已付。unknown/null 不是未扣款；平台 COMPENSATED 只代表平台资金收口。部分付款、结果未知或已开通不可重下单。"
    },
    "GptProcessing": {
      "type": "object",
      "required": [
        "status",
        "active"
      ],
      "properties": {
        "status": {
          "type": "string",
          "enum": [
            "running",
            "waiting_upstream",
            "waiting_retry",
            "waiting_user",
            "manual_review",
            "finished"
          ]
        },
        "active": {
          "type": "boolean"
        }
      }
    },
    "GptRetryAdvice": {
      "type": "object",
      "required": [
        "allowed",
        "automaticNewCardAllowed",
        "blockedReason",
        "nextAction",
        "attemptNumber",
        "maxAttempts"
      ],
      "properties": {
        "allowed": {
          "type": "boolean"
        },
        "automaticNewCardAllowed": {
          "type": "boolean"
        },
        "blockedReason": {
          "type": [
            "string",
            "null"
          ],
          "enum": [
            "retry_in_progress",
            "authorization_unresolved",
            "upstream_or_evidence_veto",
            "already_paid_or_activated",
            "order_or_funds_pending",
            "payment_unknown",
            "failure_not_eligible",
            "retry_finished",
            null
          ]
        },
        "nextAction": {
          "type": "string",
          "enum": [
            "official_checkout",
            "check_official_account",
            "contact_support",
            "fund_or_change_card",
            "contact_issuer_or_change_card",
            "change_card_and_preflight",
            "correct_billing_details",
            "contact_issuer",
            "complete_official_verification",
            "refresh_session",
            "query_original_order",
            "confirm_new_quote",
            "reconcile_original_payment",
            "wait",
            "none"
          ]
        },
        "attemptNumber": {
          "type": "integer",
          "minimum": 1,
          "maximum": 2
        },
        "maxAttempts": {
          "type": "integer",
          "enum": [
            1,
            2
          ]
        },
        "phase": {
          "type": "string",
          "enum": [
            "armed",
            "checking",
            "reserved",
            "opening",
            "dispatching",
            "reconciling",
            "completed",
            "stopped",
            "needs_review",
            "needs_user"
          ],
          "description": "仅显式启用的根订单返回协调阶段；不是单次支付状态。"
        },
        "stoppedReason": {
          "type": [
            "string",
            "null"
          ]
        },
        "cancelRequested": {
          "type": "boolean"
        },
        "maxAdditionalWalletDebitUsd": {
          "$ref": "#/components/schemas/InputAmount"
        },
        "reservedUsd": {
          "$ref": "#/components/schemas/InputAmount"
        },
        "consumedUsd": {
          "$ref": "#/components/schemas/InputAmount"
        },
        "newCard": {
          "type": [
            "object",
            "null"
          ],
          "required": [
            "cardId",
            "cardLastFour"
          ],
          "properties": {
            "cardId": {
              "type": "integer",
              "format": "int64"
            },
            "cardLastFour": {
              "type": [
                "string",
                "null"
              ],
              "pattern": "^[0-9]{4}$"
            }
          },
          "description": "开卡成功但尚未创建第二次直充时也可能返回；不代表套餐已付款。"
        }
      },
      "description": "不能仅凭旧 nextAction 自动付款。allowed 仍须重新预检；automaticNewCardAllowed 另需明确预算授权和服务端执行门槛。未知枚举按禁止重试处理。"
    },
    "GptDisplay": {
      "type": "object",
      "required": [
        "statusLabel",
        "stageLabel",
        "message",
        "progressPercent"
      ],
      "properties": {
        "statusLabel": {
          "type": "string"
        },
        "stageLabel": {
          "type": "string"
        },
        "message": {
          "type": "string"
        },
        "progressPercent": {
          "type": "integer",
          "minimum": 0,
          "maximum": 100
        }
      }
    },
    "GptFinancialEntry": {
      "type": "object",
      "required": [
        "amount",
        "currency",
        "status",
        "attemptOrderId"
      ],
      "properties": {
        "amount": {
          "type": [
            "string",
            "null"
          ],
          "pattern": "^[0-9]+(?:\\.[0-9]+)?$"
        },
        "currency": {
          "type": [
            "string",
            "null"
          ]
        },
        "status": {
          "type": "string",
          "enum": [
            "held",
            "released",
            "charged",
            "pending",
            "unknown"
          ]
        },
        "attemptOrderId": {
          "type": "string",
          "format": "uuid"
        },
        "plan": {
          "type": "string"
        },
        "evidenceReferences": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "关联的付款或账单标识，不包含访问密钥。"
        }
      },
      "description": "实证金额，未知为 null 而不是 0。卡充值本金与费用分列；不可把各币种直接相加。订阅项可能另含 plan/evidenceReferences。"
    },
    "GptFinancials": {
      "type": "object",
      "required": [
        "subscriptionPayments",
        "serviceFees",
        "cardFunding",
        "cardOpenFees",
        "cardRechargeFees"
      ],
      "properties": {
        "subscriptionPayments": {
          "type": "array",
          "items": {
            "$ref": "#/components/schemas/GptFinancialEntry"
          }
        },
        "serviceFees": {
          "type": "array",
          "items": {
            "$ref": "#/components/schemas/GptFinancialEntry"
          }
        },
        "cardFunding": {
          "type": "array",
          "items": {
            "$ref": "#/components/schemas/GptFinancialEntry"
          }
        },
        "cardOpenFees": {
          "type": "array",
          "items": {
            "$ref": "#/components/schemas/GptFinancialEntry"
          }
        },
        "cardRechargeFees": {
          "type": "array",
          "items": {
            "$ref": "#/components/schemas/GptFinancialEntry"
          }
        }
      }
    },
    "GptStatistics": {
      "type": "object",
      "required": [
        "generatedAt",
        "windowStart",
        "windowEnd",
        "denominator"
      ],
      "properties": {
        "sampleCount": {
          "type": "integer",
          "minimum": 0,
          "description": "仅实时报价接口携带，为此次返回的每套餐最新样本数。"
        },
        "futureClockSkewSeconds": {
          "type": "integer",
          "const": 300,
          "description": "报价采样允许的上游时钟超前秒数。"
        },
        "generatedAt": {
          "type": "string",
          "format": "date-time"
        },
        "windowStart": {
          "type": [
            "string",
            "null"
          ],
          "format": "date-time"
        },
        "windowEnd": {
          "type": "string",
          "format": "date-time"
        },
        "denominator": {
          "type": "string",
          "enum": [
            "confirmed_successes_plus_declines",
            "realtime_quote_observations"
          ]
        }
      },
      "description": "成功率分母仅明确成功+明确拒付；零样本 rate=null。全历史 windowStart=null。实时报价为24小时窗口每套餐最新有效样本，不是承诺成交价。"
    },
    "GptOrder": {
      "type": "object",
      "description": "OpenAI 直充订单当前快照。查询与通知共用公开投影；通知可能重复、延迟或乱序，应按 revision 并查询最新状态处理。operationStatus 仅表示平台资金状态，银行付款以 payment 证据判断；未知、部分付款或待核对时不得自动重下单。新增字段不改变旧字段的兼容结构。",
      "required": [
        "revision",
        "failure",
        "payment",
        "processing",
        "retry",
        "display",
        "financials",
        "originalPlan",
        "observedPlan",
        "cardLastFour",
        "id",
        "clientRequestId",
        "plan",
        "status",
        "stage",
        "email",
        "cardNumberMasked",
        "paymentCardSource",
        "pricingVersion",
        "quotedAmountMinor",
        "finalAmountMinor",
        "currency",
        "customerServiceFee",
        "serviceFeeStatus",
        "fundingState",
        "fundingHoldStatus",
        "operationStatus",
        "createdAt",
        "updatedAt",
        "completedAt",
        "invoiceUrl"
      ],
      "properties": {
        "revision": {
          "type": "integer",
          "minimum": 0,
          "description": "单订单公开快照版本，事件可能重复/乱序。旧订单为0。"
        },
        "originalPlan": {
          "type": [
            "string",
            "null"
          ]
        },
        "observedPlan": {
          "type": [
            "string",
            "null"
          ]
        },
        "cardLastFour": {
          "type": [
            "string",
            "null"
          ],
          "pattern": "^[0-9]{4}$"
        },
        "publicMessage": {
          "type": [
            "string",
            "null"
          ]
        },
        "failure": {
          "$ref": "#/components/schemas/GptFailure"
        },
        "payment": {
          "$ref": "#/components/schemas/GptPayment"
        },
        "processing": {
          "$ref": "#/components/schemas/GptProcessing"
        },
        "retry": {
          "$ref": "#/components/schemas/GptRetryAdvice"
        },
        "display": {
          "$ref": "#/components/schemas/GptDisplay"
        },
        "financials": {
          "$ref": "#/components/schemas/GptFinancials"
        },
        "id": {
          "type": "string",
          "format": "uuid"
        },
        "clientRequestId": {
          "type": "string"
        },
        "plan": {
          "type": "string"
        },
        "status": {
          "type": "string",
          "enum": [
            "ready",
            "queued",
            "running",
            "awaiting_card",
            "funding_pending",
            "pending",
            "requires_action",
            "cancel_requested",
            "completed",
            "declined",
            "failed",
            "failed_precharge",
            "cancelled"
          ],
          "description": "订单业务状态；启用策略时是根任务整体状态。ready/queued 等待处理，running 执行中，awaiting_card/funding_pending 准备卡片或资金，pending 等待结果，requires_action 需用户或人工处理。cancel_requested 不是终态。completed/declined/failed/failed_precharge/cancelled 是业务结束分类，不单独证明是否扣款或资金结清；历史 failed_precharge 也不能替代 payment 证据。收到 Webhook 后查询原订单，用 payment/processing/retry 判断下一步。"
        },
        "stage": {
          "type": "string"
        },
        "email": {
          "type": [
            "string",
            "null"
          ],
          "description": "本人订单邮箱，属于个人信息。"
        },
        "cardNumberMasked": {
          "type": "string"
        },
        "paymentCardSource": {
          "type": "string",
          "enum": [
            "platform",
            "external"
          ]
        },
        "pricingVersion": {
          "type": "integer"
        },
        "quotedAmountMinor": {
          "type": [
            "integer",
            "null"
          ],
          "format": "int64"
        },
        "finalAmountMinor": {
          "type": [
            "integer",
            "null"
          ],
          "format": "int64"
        },
        "currency": {
          "type": [
            "string",
            "null"
          ]
        },
        "customerServiceFee": {
          "$ref": "#/components/schemas/Decimal"
        },
        "serviceFeeStatus": {
          "type": [
            "string",
            "null"
          ]
        },
        "fundingState": {
          "type": [
            "string",
            "null"
          ]
        },
        "fundingHoldStatus": {
          "type": [
            "string",
            "null"
          ]
        },
        "operationStatus": {
          "type": "string",
          "description": "平台资金状态，不是银行卡是否扣款的证据。未启用重试时保持原单语义；启用时是整体资金投影，原操作保留在 attempts。新卡已开但直充失败可为 FAILED，不能声称开卡费和卡内本金已退回。是否结束看 processing；是否允许重新下单须同时核对 retry 与 payment。RECONCILE_REQUIRED 需要核对，禁止重新付款。"
        },
        "createdAt": {
          "type": "string"
        },
        "updatedAt": {
          "type": "string"
        },
        "completedAt": {
          "type": [
            "string",
            "null"
          ]
        },
        "invoiceUrl": {
          "type": [
            "string",
            "null"
          ],
          "format": "uri",
          "maxLength": 2048,
          "readOnly": true,
          "description": "账单可用时返回敏感 Stripe bearer link，不可用时为 null；仅向有权读取该订单的主体返回，禁止记录、分享或长期缓存。"
        },
        "maskedEmail": {
          "type": "string"
        },
        "cardId": {
          "type": [
            "integer",
            "null"
          ],
          "format": "int64"
        },
        "autoOpenedCard": {
          "type": [
            "boolean",
            "null"
          ]
        },
        "invoiceUrls": {
          "type": "array",
          "items": {
            "type": "string",
            "format": "uri"
          },
          "description": "多阶段敏感 Stripe 账单链接，禁止缓存和分享。"
        },
        "willRenew": {
          "type": [
            "boolean",
            "null"
          ]
        },
        "autoCancelRenewal": {
          "type": "boolean",
          "description": "创建订单时固定的自动取消续费设置。默认true；可在开发者页面按API Key关闭，仅影响该Key创建的新直充订单。false表示跳过自动取消，不表示主动开启续费。"
        },
        "needsRenewalCancel": {
          "type": "boolean"
        },
        "publicCode": {
          "type": [
            "string",
            "null"
          ],
          "description": "最新事件的公开错误码。"
        },
        "nextAction": {
          "type": "string",
          "enum": [
            "none",
            "wait",
            "submit_session",
            "refresh_session_and_reorder",
            "resolve_account",
            "change_card_and_reorder",
            "retry_preflight",
            "contact_support",
            "reconcile_original_payment"
          ],
          "description": "按订单和资金状态计算的下一步。未知值应联系客服，禁止自动扣款重试。所有重新下单动作均须先重新预检。"
        },
        "recoveryMessage": {
          "type": "string",
          "description": "用户下一步提示；程序分支请使用 nextAction。"
        },
        "attempts": {
          "type": "array",
          "minItems": 1,
          "maxItems": 2,
          "items": {
            "$ref": "#/components/schemas/GptOrder"
          },
          "description": "仅显式启用策略的根订单返回，按尝试顺序保留首次及最多一次新卡尝试。顶层 revision 属于根任务，各尝试 revision 属于该单，不可跨订单比较。未创建第二次直充时只有首次记录，新卡状态见 retry.newCard。"
        },
        "progress": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "stage": {
                "type": "string"
              },
              "status": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "publicMessage": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "occurredAt": {
                "type": [
                  "string",
                  "null"
                ]
              }
            }
          },
          "description": "实际观测到的有序流程，多阶段升级可能重复同名步骤。"
        }
      }
    },
    "GptOrderResponse": {
      "type": "object",
      "required": [
        "code",
        "data"
      ],
      "properties": {
        "code": {
          "$ref": "#/components/schemas/SuccessCode"
        },
        "data": {
          "$ref": "#/components/schemas/GptOrder"
        }
      }
    },
    "GptOrdersResponse": {
      "type": "object",
      "required": [
        "code",
        "data"
      ],
      "properties": {
        "code": {
          "$ref": "#/components/schemas/SuccessCode"
        },
        "data": {
          "type": "object",
          "required": [
            "total",
            "list"
          ],
          "properties": {
            "total": {
              "type": "integer",
              "format": "int64"
            },
            "list": {
              "type": "array",
              "items": {
                "$ref": "#/components/schemas/GptOrder"
              }
            }
          }
        }
      }
    },
    "GptOrderEvent": {
      "type": "object",
      "required": [
        "eventId",
        "type",
        "status",
        "stage",
        "category",
        "step",
        "publicCode",
        "publicMessage",
        "occurredAt"
      ],
      "properties": {
        "eventId": {
          "type": "string",
          "format": "uuid",
          "description": "平台生成的稳定本地公开事件 ID；不是外部系统 ID。"
        },
        "type": {
          "type": "string"
        },
        "status": {
          "type": [
            "string",
            "null"
          ]
        },
        "stage": {
          "type": [
            "string",
            "null"
          ]
        },
        "category": {
          "type": [
            "string",
            "null"
          ]
        },
        "step": {
          "type": [
            "string",
            "null"
          ]
        },
        "publicCode": {
          "type": [
            "string",
            "null"
          ]
        },
        "publicMessage": {
          "type": [
            "string",
            "null"
          ]
        },
        "occurredAt": {
          "type": "string"
        }
      }
    },
    "GptOrderDetailResponse": {
      "type": "object",
      "required": [
        "code",
        "data"
      ],
      "properties": {
        "code": {
          "$ref": "#/components/schemas/SuccessCode"
        },
        "data": {
          "type": "object",
          "required": [
            "order",
            "events"
          ],
          "properties": {
            "order": {
              "$ref": "#/components/schemas/GptOrder"
            },
            "events": {
              "type": "array",
              "items": {
                "$ref": "#/components/schemas/GptOrderEvent"
              }
            }
          }
        }
      }
    },
    "Cdk": {
      "type": "object",
      "required": [
        "id",
        "codePrefix",
        "plan",
        "forceNewCard",
        "status",
        "inventoryStatus",
        "salePrice",
        "updatedAt"
      ],
      "properties": {
        "id": {
          "type": "string",
          "format": "uuid",
          "description": "稳定的本地公开 CDK ID；不是外部系统 ID。"
        },
        "codePrefix": {
          "type": "string",
          "pattern": "^AVF-\\*{8}$",
          "examples": [
            "AVF-********"
          ],
          "description": "固定掩码；列表和 Webhook 不披露兑换凭证的任何可拼接片段。"
        },
        "plan": {
          "type": "string"
        },
        "forceNewCard": {
          "type": "boolean",
          "description": "true 表示兑换时只新开并绑定一张卡，不使用已有卡。"
        },
        "status": {
          "type": "string"
        },
        "inventoryStatus": {
          "type": "string"
        },
        "salePrice": {
          "type": [
            "string",
            "null"
          ]
        },
        "updatedAt": {
          "type": "string"
        }
      }
    },
    "CdksResponse": {
      "type": "object",
      "required": [
        "code",
        "data"
      ],
      "properties": {
        "code": {
          "$ref": "#/components/schemas/SuccessCode"
        },
        "data": {
          "type": "object",
          "required": [
            "total",
            "list"
          ],
          "properties": {
            "total": {
              "type": "integer"
            },
            "list": {
              "type": "array",
              "items": {
                "$ref": "#/components/schemas/Cdk"
              }
            },
            "forceNewCardEnabled": {
              "type": "boolean",
              "description": "true 表示当前集群已完成滚动升级，可以安全生成 forceNewCard CDK。"
            }
          }
        }
      }
    },
    "CdkOffer": {
      "type": "object",
      "required": [
        "plan",
        "enabled",
        "salePrice",
        "pricingStatus",
        "stock"
      ],
      "properties": {
        "plan": {
          "type": "string",
          "description": "OpenAI 套餐标识。"
        },
        "enabled": {
          "type": "boolean",
          "description": "只有套餐已开放且当前存在有效售价时为 true。"
        },
        "salePrice": {
          "type": [
            "string",
            "null"
          ],
          "pattern": "^[0-9]+(\\.[0-9]{1,6})?$",
          "description": "当前有效美元售价。动态报价或参考汇率超过有效期时为 null。"
        },
        "pricingStatus": {
          "type": "string",
          "enum": [
            "READY",
            "WAITING_QUOTE"
          ],
          "description": "READY 表示可校验当前售价；WAITING_QUOTE 表示动态定价正在等待新的有效报价。"
        },
        "stock": {
          "type": "integer",
          "format": "int64",
          "minimum": 0,
          "description": "当前平台可售库存数量；定价不可用时不得仅凭库存数量发起购买。"
        }
      }
    },
    "CdkOffersResponse": {
      "type": "object",
      "required": [
        "code",
        "data"
      ],
      "properties": {
        "code": {
          "$ref": "#/components/schemas/SuccessCode"
        },
        "data": {
          "type": "object",
          "required": [
            "offers"
          ],
          "properties": {
            "offers": {
              "type": "array",
              "items": {
                "$ref": "#/components/schemas/CdkOffer"
              }
            }
          }
        }
      }
    },
    "CdkGenerateInput": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "plan"
      ],
      "properties": {
        "plan": {
          "type": "string",
          "enum": [
            "go",
            "plus",
            "pro_5x",
            "pro_20x",
            "pro_25x"
          ]
        },
        "quantity": {
          "type": "integer",
          "minimum": 1,
          "maximum": 50,
          "default": 1,
          "description": "同一批次生成的 CDK 数量。"
        },
        "forceNewCard": {
          "type": "boolean",
          "default": false,
          "description": "true 时每张 CDK 兑换只新开并绑定一张卡，不使用已有卡；支付失败也不再开第二张。省略或 false 时只使用并轮换已有 ACTIVE 卡；没有可用卡则兑换失败，不自动开卡。"
        },
        "paymentCountry": {
          "type": "string",
          "pattern": "^[A-Z]{2}$",
          "description": "GPT 结账地区，如 US、PH；可选值取 /gpt-direct/plans 的 checkoutCountries。生成后固定地区及币种，省略则保存生成时默认地区。改变地区须用新幂等键。"
        }
      }
    },
    "CdkGenerateItem": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "saleId",
        "cdkId",
        "code",
        "codePrefix"
      ],
      "properties": {
        "saleId": {
          "type": "string",
          "format": "uuid"
        },
        "cdkId": {
          "type": "string",
          "format": "uuid",
          "description": "稳定的本地公开 CDK ID。"
        },
        "code": {
          "type": [
            "string",
            "null"
          ],
          "pattern": "^AVF-[0-9A-F]{32}$",
          "readOnly": true,
          "description": "高熵 bearer 兑换凭证；恢复窗口结束后为 null。"
        },
        "codePrefix": {
          "type": "string",
          "pattern": "^AVF-(?:[0-9A-F]{8}|\\*{8})$",
          "description": "恢复窗口内为 8 位前缀，窗口结束后固定掩码。"
        }
      }
    },
    "CdkGenerateResult": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "saleId",
        "cdkId",
        "code",
        "codePrefix",
        "plan",
        "salePrice",
        "quantity",
        "totalSalePrice",
        "items",
        "balance",
        "replayed",
        "generated",
        "forceNewCard"
      ],
      "properties": {
        "saleId": {
          "type": "string",
          "format": "uuid"
        },
        "cdkId": {
          "type": "string",
          "format": "uuid",
          "description": "稳定的本地公开 CDK ID；不是外部系统 ID。"
        },
        "code": {
          "type": [
            "string",
            "null"
          ],
          "pattern": "^AVF-[0-9A-F]{32}$",
          "examples": [
            "AVF-018F6D107C1A4B2C9D3EA4F5B6C7D8E9"
          ],
          "readOnly": true,
          "description": "与 cdkId 独立生成的高熵 AVF bearer 兑换凭证；首次响应及创建后两分钟内的同主体同幂等请求返回，恢复窗口结束后为 null。禁止日志记录或转发给非最终客户。"
        },
        "codePrefix": {
          "type": "string",
          "pattern": "^AVF-(?:[0-9A-F]{8}|\\*{8})$",
          "examples": [
            "AVF-018F6D10",
            "AVF-********"
          ],
          "description": "恢复窗口内为本地 alias 的 8 位前缀，窗口结束后固定掩码。"
        },
        "plan": {
          "type": "string"
        },
        "salePrice": {
          "$ref": "#/components/schemas/Decimal"
        },
        "quantity": {
          "type": "integer",
          "minimum": 1,
          "maximum": 50
        },
        "totalSalePrice": {
          "$ref": "#/components/schemas/Decimal"
        },
        "items": {
          "type": "array",
          "minItems": 1,
          "maxItems": 50,
          "items": {
            "$ref": "#/components/schemas/CdkGenerateItem"
          }
        },
        "balance": {
          "$ref": "#/components/schemas/Decimal"
        },
        "replayed": {
          "type": "boolean"
        },
        "generated": {
          "type": "boolean",
          "const": true
        },
        "forceNewCard": {
          "type": "boolean",
          "description": "本批次 CDK 是否强制每张只新开并绑定一张卡。"
        },
        "checkoutRegion": {
          "type": [
            "object",
            "null"
          ],
          "properties": {
            "country": {
              "type": "string"
            },
            "currency": {
              "type": "string"
            }
          },
          "required": [
            "country",
            "currency"
          ]
        }
      }
    },
    "CdkGenerateResponse": {
      "type": "object",
      "required": [
        "code",
        "data"
      ],
      "properties": {
        "code": {
          "$ref": "#/components/schemas/SuccessCode"
        },
        "data": {
          "$ref": "#/components/schemas/CdkGenerateResult"
        }
      }
    },
    "Operation": {
      "type": "object",
      "required": [
        "operationId",
        "type",
        "status",
        "terminal",
        "dispatchState",
        "result",
        "error",
        "updatedAt"
      ],
      "properties": {
        "operationId": {
          "type": "string",
          "format": "uuid"
        },
        "type": {
          "type": "string",
          "enum": [
            "OPEN_CARD",
            "RECHARGE",
            "REFUND",
            "FREEZE",
            "UNFREEZE",
            "DELETE",
            "GPT_DIRECT",
            "GPT_CDK"
          ]
        },
        "status": {
          "type": "string",
          "enum": [
            "PENDING",
            "RECONCILE_REQUIRED",
            "SUCCEEDED",
            "FAILED"
          ]
        },
        "terminal": {
          "type": "boolean"
        },
        "dispatchState": {
          "type": "string",
          "description": "诊断字段；业务分支只使用 status 和 terminal。"
        },
        "result": {
          "type": [
            "object",
            "null"
          ],
          "additionalProperties": true,
          "description": "仅 SUCCEEDED 时返回。"
        },
        "error": {
          "type": [
            "string",
            "null"
          ]
        },
        "updatedAt": {
          "type": "string"
        }
      }
    },
    "OperationResponse": {
      "type": "object",
      "required": [
        "code",
        "data"
      ],
      "properties": {
        "code": {
          "$ref": "#/components/schemas/SuccessCode"
        },
        "data": {
          "$ref": "#/components/schemas/Operation"
        }
      }
    },
    "WebhookEvent": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "type",
        "apiVersion",
        "createdAt",
        "data"
      ],
      "properties": {
        "id": {
          "type": "string",
          "pattern": "^evt_[0-9a-f]{8}(?:_[0-9a-f]{8}){3}$"
        },
        "type": {
          "type": "string",
          "enum": [
            "card.open.updated",
            "card.recharge.updated",
            "card.refund.updated",
            "card.freeze.updated",
            "card.unfreeze.updated",
            "card.delete.updated",
            "money.operation.updated",
            "card.transaction.updated",
            "wallet.transaction.created",
            "deposit.updated",
            "openai.direct.updated",
            "openai.direct.progress",
            "openai.direct.completed",
            "openai.direct.failed",
            "openai.direct.cancelled",
            "openai.cdk.updated",
            "openai.cdk.released",
            "openai.cdk.reserved",
            "openai.cdk.consumed",
            "openai.cdk.frozen",
            "openai.cdk.unfrozen",
            "openai.cdk.disabled",
            "webhook.test"
          ]
        },
        "apiVersion": {
          "type": "string",
          "const": "2026-08-01"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "data": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "object"
          ],
          "properties": {
            "object": {}
          }
        }
      },
      "allOf": [
        {
          "oneOf": [
            {
              "title": "卡片与资金操作事件",
              "properties": {
                "type": {
                  "enum": [
                    "card.open.updated",
                    "card.recharge.updated",
                    "card.refund.updated",
                    "card.freeze.updated",
                    "card.unfreeze.updated",
                    "card.delete.updated",
                    "money.operation.updated"
                  ]
                },
                "data": {
                  "properties": {
                    "object": {
                      "$ref": "#/components/schemas/MoneyOperationWebhookObject"
                    }
                  }
                }
              }
            },
            {
              "title": "卡片交易事件",
              "properties": {
                "type": {
                  "const": "card.transaction.updated"
                },
                "data": {
                  "properties": {
                    "object": {
                      "$ref": "#/components/schemas/CardTransactionWebhookObject"
                    }
                  }
                }
              }
            },
            {
              "title": "钱包交易事件",
              "properties": {
                "type": {
                  "const": "wallet.transaction.created"
                },
                "data": {
                  "properties": {
                    "object": {
                      "$ref": "#/components/schemas/WalletTransactionWebhookObject"
                    }
                  }
                }
              }
            },
            {
              "title": "充值订单事件",
              "properties": {
                "type": {
                  "const": "deposit.updated"
                },
                "data": {
                  "properties": {
                    "object": {
                      "$ref": "#/components/schemas/DepositWebhookObject"
                    }
                  }
                }
              }
            },
            {
              "title": "OpenAI 生命周期事件",
              "properties": {
                "type": {
                  "enum": [
                    "openai.direct.updated",
                    "openai.direct.progress",
                    "openai.direct.completed",
                    "openai.direct.failed",
                    "openai.direct.cancelled",
                    "openai.cdk.updated",
                    "openai.cdk.released",
                    "openai.cdk.reserved",
                    "openai.cdk.consumed",
                    "openai.cdk.frozen",
                    "openai.cdk.unfrozen",
                    "openai.cdk.disabled"
                  ]
                },
                "data": {
                  "properties": {
                    "object": {
                      "$ref": "#/components/schemas/OpenAILifecycleWebhookObject"
                    }
                  }
                }
              }
            },
            {
              "title": "Webhook 测试事件",
              "properties": {
                "type": {
                  "const": "webhook.test"
                },
                "data": {
                  "properties": {
                    "object": {
                      "$ref": "#/components/schemas/WebhookTestObject"
                    }
                  }
                }
              }
            }
          ]
        }
      ]
    },
    "MoneyOperationWebhookObject": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "operationId",
        "operationType",
        "eventKind"
      ],
      "properties": {
        "operationId": {
          "type": "string",
          "format": "uuid"
        },
        "operationType": {
          "type": "string"
        },
        "eventKind": {
          "type": "string"
        },
        "statusBefore": {
          "type": "string"
        },
        "status": {
          "type": "string"
        },
        "amount": {
          "$ref": "#/components/schemas/Decimal"
        },
        "fee": {
          "$ref": "#/components/schemas/Decimal"
        },
        "totalAmount": {
          "$ref": "#/components/schemas/Decimal"
        }
      }
    },
    "CardTransactionWebhookObject": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "transactionId",
        "cardId",
        "type",
        "status",
        "authAmount",
        "settleAmount",
        "authCurrency",
        "settleCurrency",
        "authTime"
      ],
      "properties": {
        "transactionId": {
          "type": "integer",
          "format": "int64"
        },
        "cardId": {
          "type": "integer",
          "format": "int64"
        },
        "type": {
          "type": "string"
        },
        "status": {
          "type": "string"
        },
        "authAmount": {
          "$ref": "#/components/schemas/Decimal"
        },
        "settleAmount": {
          "$ref": "#/components/schemas/Decimal"
        },
        "authCurrency": {
          "type": "string"
        },
        "settleCurrency": {
          "type": "string"
        },
        "merchantName": {
          "type": "string"
        },
        "merchantLocation": {
          "type": "string"
        },
        "merchantRegion": {
          "type": "string"
        },
        "merchantCountry": {
          "type": "string"
        },
        "authTime": {
          "type": "string"
        }
      }
    },
    "WalletTransactionWebhookObject": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "transactionId",
        "type",
        "amount",
        "balanceBefore",
        "balanceAfter"
      ],
      "properties": {
        "transactionId": {
          "type": "integer",
          "format": "int64"
        },
        "type": {
          "type": "string"
        },
        "amount": {
          "$ref": "#/components/schemas/Decimal"
        },
        "balanceBefore": {
          "$ref": "#/components/schemas/Decimal"
        },
        "balanceAfter": {
          "$ref": "#/components/schemas/Decimal"
        }
      }
    },
    "DepositWebhookObject": {
      "type": "object",
      "additionalProperties": false,
      "description": "钱包充值订单状态快照。只有 status=confirmed 表示到账且已入账；expired 可因迟到的有效转账后续变为 confirmed，cancelled 是不可变终态且后续转账不会匹配或自动入账。客户应按 Webhook 事件 ID 去重，并以 GET /deposits/{gatewayRef} 为最终事实来源。不要再用 wallet.transaction.created 对同一笔充值重复入账。",
      "required": [
        "depositId",
        "gatewayRef",
        "currency",
        "network",
        "status",
        "expiredAt"
      ],
      "properties": {
        "depositId": {
          "type": "integer",
          "format": "int64"
        },
        "gatewayRef": {
          "type": "string",
          "format": "uuid"
        },
        "currency": {
          "type": "string"
        },
        "network": {
          "type": "string"
        },
        "requestedAmount": {
          "$ref": "#/components/schemas/Decimal"
        },
        "expectedAmount": {
          "$ref": "#/components/schemas/Decimal"
        },
        "actualAmount": {
          "$ref": "#/components/schemas/Decimal"
        },
        "creditedAmount": {
          "$ref": "#/components/schemas/Decimal"
        },
        "fee": {
          "$ref": "#/components/schemas/Decimal"
        },
        "status": {
          "type": "string",
          "enum": [
            "pending",
            "expired",
            "confirmed",
            "failed",
            "cancelled"
          ],
          "description": "只有 confirmed 表示已到账并完成钱包入账。expired 仍可因迟到转账变为 confirmed；cancelled 是不可变终态。"
        },
        "transactionHash": {
          "type": "string"
        },
        "confirmedAt": {
          "type": "string",
          "format": "date-time"
        },
        "cancelledAt": {
          "type": "string",
          "format": "date-time",
          "description": "取消成功时间；仅 cancelled 状态快照提供。"
        },
        "expiredAt": {
          "type": "string",
          "format": "date-time"
        }
      }
    },
    "OpenAILifecycleWebhookObject": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "eventId"
      ],
      "properties": {
        "revision": {
          "type": "integer",
          "minimum": 0,
          "description": "直充订单公开快照版本；CDK 事件不保证携带。"
        },
        "order": {
          "$ref": "#/components/schemas/GptOrder",
          "description": "直充通知携带提交时的同一公开快照。含账单敏感链接，仅可发送到本账号配置的 Webhook。"
        },
        "eventId": {
          "type": "string",
          "format": "uuid",
          "description": "平台生成的稳定本地公开事件 ID。"
        },
        "orderId": {
          "type": "string",
          "format": "uuid"
        },
        "cdkId": {
          "type": "string",
          "format": "uuid",
          "description": "稳定的本地公开 CDK ID。"
        },
        "status": {
          "type": "string"
        },
        "stage": {
          "type": "string"
        },
        "fromStatus": {
          "type": "string"
        },
        "toStatus": {
          "type": "string"
        },
        "category": {
          "type": "string"
        },
        "step": {
          "type": "string"
        },
        "occurredAt": {
          "type": "string",
          "format": "date-time"
        }
      }
    },
    "WebhookTestObject": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "test"
      ],
      "properties": {
        "test": {
          "type": "boolean",
          "const": true,
          "description": "测试事件固定为 true；不表示业务变更。"
        }
      }
    },
    "XDirectPlanKey": {
      "type": "string",
      "enum": [
        "premium_3m",
        "premium_6m",
        "premium_12m",
        "premium_plus_3m",
        "premium_plus_6m",
        "premium_plus_12m"
      ],
      "description": "Premium / Premium+，分别支持 3、6、12 个月。"
    },
    "XDirectServiceFee": {
      "type": "string",
      "pattern": "^\\d+(\\.\\d{1,2})?$",
      "maxLength": 20,
      "description": "USD 钱包服务费，范围 0–10000，最多两位小数。响应固定两位；独立于 X 官方卡片扣款。",
      "examples": [
        "1.00"
      ]
    },
    "XDirectPlan": {
      "type": "object",
      "required": [
        "key",
        "label",
        "tier",
        "months",
        "enabled",
        "serviceFee",
        "pricingVersion"
      ],
      "properties": {
        "key": {
          "$ref": "#/components/schemas/XDirectPlanKey"
        },
        "label": {
          "type": "string"
        },
        "tier": {
          "type": "string",
          "enum": [
            "premium",
            "premium_plus"
          ]
        },
        "months": {
          "type": "integer",
          "enum": [
            3,
            6,
            12
          ]
        },
        "enabled": {
          "type": "boolean",
          "description": "此套餐是否配置了有效付款额度；仍须同时满足 paymentsEnabled 及账户/卡片权限。"
        },
        "serviceFee": {
          "$ref": "#/components/schemas/XDirectServiceFee"
        },
        "pricingVersion": {
          "type": "integer",
          "format": "int64",
          "minimum": 1,
          "description": "服务费配置版本。prepare 保存报价时的版本；后续配置改变会使旧报价无法确认。"
        }
      }
    },
    "XDirectPrepareInput": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "recipient",
        "plan",
        "cardId",
        "clientRequestId"
      ],
      "properties": {
        "recipient": {
          "type": "string",
          "description": "X 用户名，不是显示名或主页 URL。服务端去除首尾空白及开头 @ 后须为 1–15 位 ASCII 字母、数字或下划线。",
          "examples": [
            "example_user"
          ]
        },
        "plan": {
          "$ref": "#/components/schemas/XDirectPlanKey"
        },
        "cardId": {
          "type": "integer",
          "format": "int64",
          "minimum": 1,
          "description": "当前账户已有且可用的本站卡片 ID；不传 PAN/CVC。"
        },
        "clientRequestId": {
          "type": "string",
          "format": "uuid",
          "description": "客户端为本次报价生成并持久保存的 UUID。网络重试与 Idempotency-Key 一同原样复用；参数改变或明确结束后重新报价须生成新值。"
        }
      }
    },
    "XDirectConfirmInput": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "expectedAmountMinor",
        "currency"
      ],
      "properties": {
        "expectedAmountMinor": {
          "type": "integer",
          "format": "int64",
          "minimum": 1,
          "description": "原样回传 prepared 订单的 amountMinor；这是 X 官方扣卡金额，非美元参考值。"
        },
        "currency": {
          "type": "string",
          "pattern": "^[a-z]{3}$",
          "description": "原样回传报价的 currency，包括大小写。"
        },
        "expectedServiceFee": {
          "$ref": "#/components/schemas/XDirectServiceFee",
          "description": "应始终原样回传订单 serviceFee。当前兼容行为：缺省视为 0，仅零服务费报价可省略；不匹配返回 409。"
        }
      }
    },
    "XDirectOrder": {
      "type": "object",
      "required": [
        "id",
        "recipient",
        "plan",
        "cardId",
        "status",
        "serviceFee",
        "serviceFeeStatus",
        "paymentAttempted",
        "createdAt"
      ],
      "properties": {
        "id": {
          "type": "string",
          "format": "uuid"
        },
        "recipient": {
          "type": "string"
        },
        "plan": {
          "$ref": "#/components/schemas/XDirectPlanKey"
        },
        "cardId": {
          "type": "integer",
          "format": "int64"
        },
        "status": {
          "type": "string",
          "enum": [
            "preparing",
            "prepared",
            "processing",
            "completed",
            "paid_pending_delivery",
            "review_required",
            "requires_action",
            "ineligible",
            "failed_precharge",
            "cancelled"
          ],
          "description": "HTTP 200 仅表示返回订单。completed 才表示流程完成；paid_pending_delivery 已有付款成功证据但待交付。不确定状态须查原订单，禁止另建订单重付。"
        },
        "serviceFee": {
          "$ref": "#/components/schemas/XDirectServiceFee"
        },
        "serviceFeeStatus": {
          "type": "string",
          "enum": [
            "unpaid",
            "charged",
            "refunded",
            "waived"
          ],
          "description": "钱包服务费状态：未扣、已扣、已退、零费用。不是 X 官方卡片付款状态。"
        },
        "pricingVersion": {
          "type": "integer",
          "format": "int64",
          "minimum": 1,
          "description": "订单保存的服务费配置版本。"
        },
        "paymentAttempted": {
          "type": "boolean",
          "description": "本站已创建并派发资金操作；true 不代表付款成功，也不等同于 paymentSubmitted。"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "amountMinor": {
          "type": "integer",
          "format": "int64",
          "minimum": 1,
          "description": "X 官方报价，整数最小货币单位。仅在取得有效报价后出现；按币种小数位换算。"
        },
        "currency": {
          "type": "string",
          "pattern": "^[a-z]{3}$"
        },
        "estimatedUsd": {
          "type": [
            "string",
            "null"
          ],
          "description": "官方报价的美元参考换算，最多两位小数；可能缺省或为 null。不含钱包服务费，不是发卡方最终结算金额。"
        },
        "fxRateDate": {
          "type": [
            "string",
            "null"
          ],
          "description": "参考汇率日期（YYYY-MM-DD）；可能缺省。"
        },
        "cardLast4": {
          "type": "string",
          "pattern": "^[0-9]{4}$"
        },
        "invoiceUrls": {
          "type": "array",
          "items": {
            "type": "string",
            "format": "uri"
          },
          "description": "从原支付会话取得的官方账单/收据链接，可能为空或尚未出现。包含访问凭据，应作为敏感信息保存；不是本站拼造的发票，也不证明权益已经交付。"
        },
        "paymentSubmitted": {
          "type": "boolean",
          "description": "协议层是否提交付款；缺省不可解释为 false。确认后的不确定结果可能为 true。"
        },
        "paymentStatus": {
          "type": [
            "string",
            "null"
          ],
          "description": "支付会话状态；paid 是付款成功证据。"
        },
        "paymentIntentStatus": {
          "type": [
            "string",
            "null"
          ],
          "description": "支付对象状态；succeeded 是付款成功证据。"
        },
        "paymentEvidenceSource": {
          "type": "string",
          "description": "付款证据来源，例如 checkout_poll。"
        },
        "webhookDelivered": {
          "type": [
            "boolean",
            "null"
          ],
          "description": "上游交付确认信息，不是本站对接方 Webhook 推送状态。"
        },
        "eligibleBefore": {
          "type": "boolean"
        },
        "eligibleAfter": {
          "type": "boolean"
        },
        "recipientId": {
          "type": "string"
        },
        "product": {
          "type": "string",
          "description": "套餐展示名称。"
        },
        "errorCode": {
          "type": "string",
          "description": "订单级协议错误码，通常小写；与 HTTP 错误对象的 errorCode 不同。可扩展，未知码按订单状态处理。"
        },
        "message": {
          "type": "string",
          "description": "供展示的提示，不应通过匹配文本判断是否扣款。"
        }
      },
      "description": "报价、支付及恢复共用快照。未取得的协议字段可能缺省；允许新增响应字段。读取权限同时受账户及创建 API key 限制。"
    },
    "XDirectPlansResponse": {
      "type": "object",
      "required": [
        "code",
        "data"
      ],
      "properties": {
        "code": {
          "type": "integer",
          "const": 200,
          "description": "X 直充业务响应码；与部分旧接口的 code=0 不同，不代表付款成功。"
        },
        "data": {
          "type": "object",
          "required": [
            "plans",
            "paymentsEnabled"
          ],
          "properties": {
            "plans": {
              "type": "array",
              "items": {
                "$ref": "#/components/schemas/XDirectPlan"
              },
              "minItems": 6,
              "maxItems": 6
            },
            "paymentsEnabled": {
              "type": "boolean",
              "description": "X 协议付款开关；false 时不可确认付款。"
            },
            "serviceFee": {
              "type": "string",
              "deprecated": true,
              "description": "兼容旧版本的占位字段，不可用于报价。使用 plans[].serviceFee 或订单 serviceFee。"
            }
          }
        }
      }
    },
    "XDirectOrderResponse": {
      "type": "object",
      "required": [
        "code",
        "data"
      ],
      "properties": {
        "code": {
          "type": "integer",
          "const": 200,
          "description": "X 直充业务响应码；与部分旧接口的 code=0 不同，不代表付款成功。"
        },
        "data": {
          "$ref": "#/components/schemas/XDirectOrder"
        }
      }
    },
    "XDirectOrdersResponse": {
      "type": "object",
      "required": [
        "code",
        "data"
      ],
      "properties": {
        "code": {
          "type": "integer",
          "const": 200,
          "description": "X 直充业务响应码；与部分旧接口的 code=0 不同，不代表付款成功。"
        },
        "data": {
          "type": "array",
          "maxItems": 50,
          "items": {
            "$ref": "#/components/schemas/XDirectOrder"
          }
        }
      }
    },
    "XCdkGenerateInput": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "plan",
        "quantity",
        "maxWalletDebitUsd",
        "maxOfficialAmountMinor",
        "currency",
        "fundingAmountUsd"
      ],
      "properties": {
        "plan": {
          "$ref": "#/components/schemas/XDirectPlanKey"
        },
        "quantity": {
          "type": "integer",
          "minimum": 1,
          "maximum": 50
        },
        "maxWalletDebitUsd": {
          "type": "string",
          "pattern": "^\\d+(\\.\\d{1,4})?$",
          "description": "每张 CDK 本次授权的钱包支出上限，涵盖固定卡片注资、开卡/充值费用与 X 服务费；不是批次总额度。 最多四位小数，最大 10000 USD；maxWalletDebitUsd 须大于零。",
          "maxLength": 24
        },
        "maxOfficialAmountMinor": {
          "type": "integer",
          "format": "int64",
          "minimum": 1,
          "description": "允许的 X 官方金额上限，按 currency 最小货币单位。",
          "maximum": 1000000000
        },
        "currency": {
          "type": "string",
          "pattern": "^[A-Za-z]{3}$",
          "description": "三位币种代码，大小写均接受并转为小写；须匹配实际 X 官方报价（例如 BDT）。"
        },
        "fundingAmountUsd": {
          "type": "string",
          "pattern": "^\\d+(\\.\\d{1,4})?$",
          "description": "固定一次卡片注资额；已有卡可为零，自动开卡时作初充。兑换不自动追加 FX 缓冲或加额。 最多四位小数，最大 10000 USD；maxWalletDebitUsd 须大于零。",
          "maxLength": 24
        },
        "cardId": {
          "type": "integer",
          "format": "int64",
          "minimum": 1,
          "description": "发行者自有卡片，与 autoCard 二选一。"
        },
        "autoCard": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "productCode",
            "firstName",
            "lastName"
          ],
          "properties": {
            "productCode": {
              "type": "string",
              "minLength": 1,
              "maxLength": 64
            },
            "firstName": {
              "type": "string",
              "minLength": 1,
              "maxLength": 64
            },
            "lastName": {
              "type": "string",
              "minLength": 1,
              "maxLength": 64
            }
          }
        }
      },
      "oneOf": [
        {
          "required": [
            "cardId"
          ],
          "not": {
            "required": [
              "autoCard"
            ]
          }
        },
        {
          "required": [
            "autoCard"
          ],
          "not": {
            "required": [
              "cardId"
            ]
          }
        }
      ]
    },
    "XCdkStatus": {
      "type": "string",
      "enum": [
        "unused",
        "preparing",
        "prepared",
        "funding",
        "funded",
        "paying",
        "review_required",
        "completed",
        "failed_precharge",
        "ineligible",
        "revoked",
        "paid_pending_delivery",
        "requires_action"
      ],
      "description": "funded 表示卡片资金已就绪但 X 付款尚未派发；查询不自动付款，用户明确继续时以原绑定 redeem。结果未知不重新绑定或重复资金操作。"
    },
    "XCdkIssuerItem": {
      "type": "object",
      "required": [
        "id",
        "plan",
        "status",
        "maxWalletDebitUsd",
        "maxOfficialAmountMinor",
        "currency",
        "fundingAmountUsd",
        "createdAt",
        "codePrefix",
        "recipient",
        "serviceFee",
        "pricingVersion",
        "totalWalletDebitUsd",
        "cardId",
        "fundingDispatched",
        "paymentDispatched",
        "fundingFeeUsd",
        "openFeeUsd"
      ],
      "properties": {
        "id": {
          "type": "string",
          "format": "uuid"
        },
        "plan": {
          "$ref": "#/components/schemas/XDirectPlanKey"
        },
        "status": {
          "$ref": "#/components/schemas/XCdkStatus"
        },
        "code": {
          "type": "string",
          "description": "生成响应中的完整兑换码。常规列表不应依赖此字段，需用 export 获取。"
        },
        "maxWalletDebitUsd": {
          "type": "string",
          "pattern": "^\\d+(\\.\\d{1,4})?$",
          "description": "USD 十进制字符串，最多四位小数。"
        },
        "maxOfficialAmountMinor": {
          "type": "integer",
          "format": "int64"
        },
        "currency": {
          "type": "string"
        },
        "fundingAmountUsd": {
          "type": "string",
          "pattern": "^\\d+(\\.\\d{1,4})?$",
          "description": "USD 十进制字符串，最多四位小数。"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "codePrefix": {
          "type": "string"
        },
        "recipient": {
          "type": [
            "string",
            "null"
          ]
        },
        "serviceFee": {
          "$ref": "#/components/schemas/XDirectServiceFee"
        },
        "pricingVersion": {
          "type": "integer",
          "format": "int64"
        },
        "totalWalletDebitUsd": {
          "type": "string",
          "pattern": "^\\d+(\\.\\d{1,4})?$",
          "description": "发行时计算的本张CDK计划钱包支出，包含固定注资和全部费用；不代表已实际扣款。"
        },
        "cardId": {
          "type": [
            "integer",
            "null"
          ],
          "format": "int64",
          "description": "发行者支付卡 ID；自动开卡未完成时为空。"
        },
        "fundingDispatched": {
          "type": "boolean",
          "description": "已派发卡片资金准备，不代表成功。"
        },
        "paymentDispatched": {
          "type": "boolean",
          "description": "已派发 X 付款，不代表成功。"
        },
        "fundingFeeUsd": {
          "type": "string",
          "pattern": "^\\d+(\\.\\d{1,4})?$",
          "description": "发行时保存的 USD 费用，最多四位小数。"
        },
        "openFeeUsd": {
          "type": "string",
          "pattern": "^\\d+(\\.\\d{1,4})?$",
          "description": "发行时保存的 USD 费用，最多四位小数。"
        }
      }
    },
    "XCdkPreviewInput": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "code",
        "deviceToken"
      ],
      "properties": {
        "code": {
          "type": "string",
          "description": "完整 X CDK；是消费发行者授权的凭据，不可记录到公开日志或放在 URL。"
        },
        "deviceToken": {
          "type": "string",
          "minLength": 32,
          "maxLength": 128,
          "pattern": "^[A-Za-z0-9_-]+$",
          "description": "兑换设备标识，32–128位ASCII字母数字/下划线/连字符。推荐密码学随机32字节编码为64位十六进制并持久保存；必须逐字复用。"
        }
      }
    },
    "XCdkPreflightInput": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "code",
        "deviceToken",
        "recipient",
        "clientRequestId"
      ],
      "properties": {
        "code": {
          "type": "string",
          "description": "完整 X CDK；是消费发行者授权的凭据，不可记录到公开日志或放在 URL。"
        },
        "deviceToken": {
          "type": "string",
          "minLength": 32,
          "maxLength": 128,
          "pattern": "^[A-Za-z0-9_-]+$",
          "description": "兑换设备标识，32–128位ASCII字母数字/下划线/连字符。推荐密码学随机32字节编码为64位十六进制并持久保存；必须逐字复用。"
        },
        "recipient": {
          "type": "string",
          "description": "X 用户名。"
        },
        "clientRequestId": {
          "type": "string",
          "format": "uuid"
        }
      }
    },
    "XCdkRedeemInput": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "code",
        "deviceToken",
        "clientRequestId",
        "expectedAmountMinor",
        "currency"
      ],
      "properties": {
        "code": {
          "type": "string",
          "description": "完整 X CDK；是消费发行者授权的凭据，不可记录到公开日志或放在 URL。"
        },
        "deviceToken": {
          "type": "string",
          "minLength": 32,
          "maxLength": 128,
          "pattern": "^[A-Za-z0-9_-]+$",
          "description": "兑换设备标识，32–128位ASCII字母数字/下划线/连字符。推荐密码学随机32字节编码为64位十六进制并持久保存；必须逐字复用。"
        },
        "clientRequestId": {
          "type": "string",
          "format": "uuid"
        },
        "expectedAmountMinor": {
          "type": "integer",
          "format": "int64",
          "minimum": 1,
          "description": "原样回传预检官方 amountMinor。"
        },
        "currency": {
          "type": "string",
          "pattern": "^[a-z]{3}$",
          "description": "原样回传预检币种。"
        }
      }
    },
    "XCdkResultInput": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "code",
        "deviceToken",
        "clientRequestId"
      ],
      "properties": {
        "code": {
          "type": "string",
          "description": "完整 X CDK；是消费发行者授权的凭据，不可记录到公开日志或放在 URL。"
        },
        "deviceToken": {
          "type": "string",
          "minLength": 32,
          "maxLength": 128,
          "pattern": "^[A-Za-z0-9_-]+$",
          "description": "兑换设备标识，32–128位ASCII字母数字/下划线/连字符。推荐密码学随机32字节编码为64位十六进制并持久保存；必须逐字复用。"
        },
        "clientRequestId": {
          "type": "string",
          "format": "uuid"
        }
      }
    },
    "XCdkPublicData": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "plan": {
          "$ref": "#/components/schemas/XDirectPlanKey"
        },
        "status": {
          "$ref": "#/components/schemas/XCdkStatus"
        },
        "recipient": {
          "type": [
            "string",
            "null"
          ]
        },
        "amountMinor": {
          "type": [
            "integer",
            "null"
          ],
          "format": "int64"
        },
        "currency": {
          "type": [
            "string",
            "null"
          ]
        },
        "message": {
          "type": [
            "string",
            "null"
          ]
        },
        "errorCode": {
          "type": [
            "string",
            "null"
          ]
        },
        "invoiceUrls": {
          "type": [
            "array",
            "null"
          ],
          "items": {
            "type": "string",
            "format": "uri"
          },
          "description": "仅在确认已付款且完整 code/deviceToken/clientRequestId 匹配后提供的官方账单链接；不返回发行者身份、卡片或钱包数据。"
        },
        "canRetryPreflight": {
          "type": "boolean",
          "description": "仅严格为true时，允许原设备为已知无任何资金尝试的失败生成新clientRequestId重新预检；false或缺省不能重新绑定。"
        }
      },
      "required": [
        "plan",
        "status"
      ]
    },
    "XCdkIssuerResponse": {
      "type": "object",
      "required": [
        "code",
        "data"
      ],
      "properties": {
        "code": {
          "type": "integer",
          "const": 200
        },
        "data": {
          "$ref": "#/components/schemas/XCdkIssuerItem"
        }
      }
    },
    "XCdkListResponse": {
      "type": "object",
      "required": [
        "code",
        "data"
      ],
      "properties": {
        "code": {
          "type": "integer",
          "const": 200
        },
        "data": {
          "type": "object",
          "properties": {
            "list": {
              "type": "array",
              "maxItems": 100,
              "items": {
                "$ref": "#/components/schemas/XCdkIssuerItem"
              }
            }
          },
          "required": [
            "list"
          ]
        }
      }
    },
    "XCdkGenerateResponse": {
      "type": "object",
      "required": [
        "code",
        "data"
      ],
      "properties": {
        "code": {
          "type": "integer",
          "const": 200
        },
        "data": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "list",
            "replayed"
          ],
          "properties": {
            "list": {
              "type": "array",
              "minItems": 1,
              "maxItems": 50,
              "items": {
                "$ref": "#/components/schemas/XCdkIssuerItem"
              }
            },
            "replayed": {
              "type": "boolean"
            }
          }
        }
      }
    },
    "XCdkExportResponse": {
      "type": "object",
      "required": [
        "code",
        "data"
      ],
      "properties": {
        "code": {
          "type": "integer",
          "const": 200
        },
        "data": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "id",
            "code"
          ],
          "properties": {
            "id": {
              "type": "string",
              "format": "uuid"
            },
            "code": {
              "type": "string"
            }
          }
        }
      }
    },
    "XCdkPublicResponse": {
      "type": "object",
      "required": [
        "code",
        "data"
      ],
      "properties": {
        "code": {
          "type": "integer",
          "const": 200
        },
        "data": {
          "$ref": "#/components/schemas/XCdkPublicData"
        }
      }
    },
    "TgDirectOrdersResponse": {
      "type": "object",
      "required": [
        "code",
        "data"
      ],
      "properties": {
        "code": {
          "type": "integer",
          "const": 200,
          "description": "TG 直充业务响应码；与部分旧接口的 code=0 不同，不代表付款成功。"
        },
        "data": {
          "type": "array",
          "maxItems": 50,
          "items": {
            "$ref": "#/components/schemas/TgDirectOrder"
          }
        }
      }
    },
    "TgCdkPublicResponse": {
      "type": "object",
      "required": [
        "code",
        "data"
      ],
      "properties": {
        "code": {
          "type": "integer",
          "const": 200
        },
        "data": {
          "$ref": "#/components/schemas/TgCdkPublicData"
        }
      }
    },
    "TgCdkPublicData": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "plan": {
          "$ref": "#/components/schemas/TgDirectPlanKey"
        },
        "status": {
          "$ref": "#/components/schemas/TgCdkStatus"
        },
        "recipient": {
          "type": [
            "string",
            "null"
          ]
        },
        "amountMinor": {
          "type": [
            "integer",
            "null"
          ],
          "format": "int64"
        },
        "currency": {
          "type": [
            "string",
            "null"
          ]
        },
        "message": {
          "type": [
            "string",
            "null"
          ]
        },
        "errorCode": {
          "type": [
            "string",
            "null"
          ]
        },
        "canRetryPreflight": {
          "type": "boolean",
          "description": "仅严格为true时，允许原设备为已知无任何资金尝试的失败生成新clientRequestId重新预检；false或缺省不能重新绑定。"
        },
        "deliveryStatus": {
          "type": [
            "string",
            "null"
          ],
          "enum": [
            "pending",
            "delivered"
          ],
          "description": "delivered 必须有当前赠送唯一匹配的 Telegram 服务消息。"
        },
        "giftMessageId": {
          "type": [
            "integer",
            "null"
          ],
          "description": "已核验的赠送服务消息 ID。"
        },
        "giftDays": {
          "type": [
            "integer",
            "null"
          ],
          "description": "赠送消息报告的实际天数，按日历核对套餐月数。"
        }
      },
      "required": [
        "plan",
        "status"
      ]
    },
    "TgCdkPreviewInput": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "code",
        "deviceToken"
      ],
      "properties": {
        "code": {
          "type": "string",
          "description": "完整 TG CDK；是消费发行者授权的凭据，不可记录到公开日志或放在 URL。"
        },
        "deviceToken": {
          "type": "string",
          "minLength": 32,
          "maxLength": 128,
          "pattern": "^[A-Za-z0-9_-]+$",
          "description": "兑换设备标识，32–128位ASCII字母数字/下划线/连字符。推荐密码学随机32字节编码为64位十六进制并持久保存；必须逐字复用。"
        }
      }
    },
    "TgCdkIssuerItem": {
      "type": "object",
      "required": [
        "id",
        "plan",
        "status",
        "maxWalletDebitUsd",
        "maxOfficialAmountMinor",
        "currency",
        "fundingAmountUsd",
        "createdAt",
        "codePrefix",
        "recipient",
        "serviceFee",
        "pricingVersion",
        "totalWalletDebitUsd",
        "cardId",
        "fundingDispatched",
        "paymentDispatched",
        "fundingFeeUsd",
        "openFeeUsd"
      ],
      "properties": {
        "id": {
          "type": "string",
          "format": "uuid"
        },
        "plan": {
          "$ref": "#/components/schemas/TgDirectPlanKey"
        },
        "status": {
          "$ref": "#/components/schemas/TgCdkStatus"
        },
        "code": {
          "type": "string",
          "description": "生成响应中的完整兑换码。常规列表不应依赖此字段，需用 export 获取。"
        },
        "maxWalletDebitUsd": {
          "type": "string",
          "pattern": "^\\d+(\\.\\d{1,4})?$",
          "description": "USD 十进制字符串，最多四位小数。"
        },
        "maxOfficialAmountMinor": {
          "type": "integer",
          "format": "int64"
        },
        "currency": {
          "type": "string"
        },
        "fundingAmountUsd": {
          "type": "string",
          "pattern": "^\\d+(\\.\\d{1,4})?$",
          "description": "USD 十进制字符串，最多四位小数。"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "codePrefix": {
          "type": "string"
        },
        "recipient": {
          "type": [
            "string",
            "null"
          ]
        },
        "serviceFee": {
          "$ref": "#/components/schemas/TgDirectServiceFee"
        },
        "pricingVersion": {
          "type": "integer",
          "format": "int64"
        },
        "totalWalletDebitUsd": {
          "type": "string",
          "pattern": "^\\d+(\\.\\d{1,4})?$",
          "description": "发行时计算的本张CDK计划钱包支出，包含固定注资和全部费用；不代表已实际扣款。"
        },
        "cardId": {
          "type": [
            "integer",
            "null"
          ],
          "format": "int64",
          "description": "发行者支付卡 ID；自动开卡未完成时为空。"
        },
        "fundingDispatched": {
          "type": "boolean",
          "description": "已派发卡片资金准备，不代表成功。"
        },
        "paymentDispatched": {
          "type": "boolean",
          "description": "已派发 TG 付款，不代表成功。"
        },
        "fundingFeeUsd": {
          "type": "string",
          "pattern": "^\\d+(\\.\\d{1,4})?$",
          "description": "发行时保存的 USD 费用，最多四位小数。"
        },
        "openFeeUsd": {
          "type": "string",
          "pattern": "^\\d+(\\.\\d{1,4})?$",
          "description": "发行时保存的 USD 费用，最多四位小数。"
        }
      }
    },
    "TgCdkIssuerResponse": {
      "type": "object",
      "required": [
        "code",
        "data"
      ],
      "properties": {
        "code": {
          "type": "integer",
          "const": 200
        },
        "data": {
          "$ref": "#/components/schemas/TgCdkIssuerItem"
        }
      }
    },
    "TgDirectPlanKey": {
      "type": "string",
      "enum": [
        "premium_3m",
        "premium_6m",
        "premium_12m"
      ],
      "description": "Telegram Premium 赠送时长。"
    },
    "TgCdkExportResponse": {
      "type": "object",
      "required": [
        "code",
        "data"
      ],
      "properties": {
        "code": {
          "type": "integer",
          "const": 200
        },
        "data": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "id",
            "code"
          ],
          "properties": {
            "id": {
              "type": "string",
              "format": "uuid"
            },
            "code": {
              "type": "string"
            }
          }
        }
      }
    },
    "TgDirectConfirmInput": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "expectedAmountMinor",
        "currency",
        "expectedServiceFee"
      ],
      "properties": {
        "expectedAmountMinor": {
          "type": "integer",
          "format": "int64",
          "minimum": 1,
          "description": "原样回传 prepared 订单的 amountMinor；这是 TG 官方扣卡金额，非美元参考值。"
        },
        "currency": {
          "type": "string",
          "pattern": "^[a-z]{3}$",
          "description": "原样回传报价的 currency，包括大小写。"
        },
        "expectedServiceFee": {
          "$ref": "#/components/schemas/TgDirectServiceFee",
          "description": "必填，原样回传 prepared 报价的 serviceFee 十进制字符串；不匹配返回 409。"
        }
      }
    },
    "TgCdkListResponse": {
      "type": "object",
      "required": [
        "code",
        "data"
      ],
      "properties": {
        "code": {
          "type": "integer",
          "const": 200
        },
        "data": {
          "type": "object",
          "properties": {
            "list": {
              "type": "array",
              "maxItems": 100,
              "items": {
                "$ref": "#/components/schemas/TgCdkIssuerItem"
              }
            }
          },
          "required": [
            "list"
          ]
        }
      }
    },
    "TgDirectPlan": {
      "type": "object",
      "required": [
        "key",
        "label",
        "tier",
        "months",
        "enabled",
        "serviceFee",
        "pricingVersion"
      ],
      "properties": {
        "key": {
          "$ref": "#/components/schemas/TgDirectPlanKey"
        },
        "label": {
          "type": "string"
        },
        "tier": {
          "type": "string",
          "enum": [
            "premium"
          ]
        },
        "months": {
          "type": "integer",
          "enum": [
            3,
            6,
            12
          ]
        },
        "enabled": {
          "type": "boolean",
          "description": "此套餐是否配置了有效付款额度；仍须同时满足 paymentsEnabled 及账户/卡片权限。"
        },
        "serviceFee": {
          "$ref": "#/components/schemas/TgDirectServiceFee"
        },
        "pricingVersion": {
          "type": "integer",
          "format": "int64",
          "minimum": 1,
          "description": "服务费配置版本。prepare 保存报价时的版本；后续配置改变会使旧报价无法确认。"
        }
      }
    },
    "TgCdkResultInput": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "code",
        "deviceToken",
        "clientRequestId"
      ],
      "properties": {
        "code": {
          "type": "string",
          "description": "完整 TG CDK；是消费发行者授权的凭据，不可记录到公开日志或放在 URL。"
        },
        "deviceToken": {
          "type": "string",
          "minLength": 32,
          "maxLength": 128,
          "pattern": "^[A-Za-z0-9_-]+$",
          "description": "兑换设备标识，32–128位ASCII字母数字/下划线/连字符。推荐密码学随机32字节编码为64位十六进制并持久保存；必须逐字复用。"
        },
        "clientRequestId": {
          "type": "string",
          "format": "uuid"
        }
      }
    },
    "TgDirectPlansResponse": {
      "type": "object",
      "required": [
        "code",
        "data"
      ],
      "properties": {
        "code": {
          "type": "integer",
          "const": 200,
          "description": "TG 直充业务响应码；与部分旧接口的 code=0 不同，不代表付款成功。"
        },
        "data": {
          "type": "object",
          "required": [
            "plans",
            "paymentsEnabled"
          ],
          "properties": {
            "plans": {
              "type": "array",
              "items": {
                "$ref": "#/components/schemas/TgDirectPlan"
              },
              "minItems": 6,
              "maxItems": 6
            },
            "paymentsEnabled": {
              "type": "boolean",
              "description": "TG 协议付款开关；false 时不可确认付款。"
            },
            "serviceFee": {
              "type": "string",
              "deprecated": true,
              "description": "兼容旧版本的占位字段，不可用于报价。使用 plans[].serviceFee 或订单 serviceFee。"
            }
          }
        }
      }
    },
    "TgDirectOrderResponse": {
      "type": "object",
      "required": [
        "code",
        "data"
      ],
      "properties": {
        "code": {
          "type": "integer",
          "const": 200,
          "description": "TG 直充业务响应码；与部分旧接口的 code=0 不同，不代表付款成功。"
        },
        "data": {
          "$ref": "#/components/schemas/TgDirectOrder"
        }
      }
    },
    "TgCdkRedeemInput": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "code",
        "deviceToken",
        "clientRequestId",
        "expectedAmountMinor",
        "currency"
      ],
      "properties": {
        "code": {
          "type": "string",
          "description": "完整 TG CDK；是消费发行者授权的凭据，不可记录到公开日志或放在 URL。"
        },
        "deviceToken": {
          "type": "string",
          "minLength": 32,
          "maxLength": 128,
          "pattern": "^[A-Za-z0-9_-]+$",
          "description": "兑换设备标识，32–128位ASCII字母数字/下划线/连字符。推荐密码学随机32字节编码为64位十六进制并持久保存；必须逐字复用。"
        },
        "clientRequestId": {
          "type": "string",
          "format": "uuid"
        },
        "expectedAmountMinor": {
          "type": "integer",
          "format": "int64",
          "minimum": 1,
          "description": "原样回传预检官方 amountMinor。"
        },
        "currency": {
          "type": "string",
          "pattern": "^[a-z]{3}$",
          "description": "原样回传预检币种。"
        }
      }
    },
    "TgDirectPrepareInput": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "recipient",
        "plan",
        "cardId",
        "clientRequestId"
      ],
      "properties": {
        "recipient": {
          "type": "string",
          "description": "Telegram 用户名，可带开头 @，去除 @ 后为 1–32 位 ASCII 字母、数字或下划线；不接受显示名和链接。",
          "examples": [
            "example_user"
          ],
          "maxLength": 33
        },
        "plan": {
          "$ref": "#/components/schemas/TgDirectPlanKey"
        },
        "cardId": {
          "type": "integer",
          "format": "int64",
          "minimum": 1,
          "description": "当前账户已有且可用的本站卡片 ID；不传 PAN/CVC。"
        },
        "clientRequestId": {
          "type": "string",
          "format": "uuid",
          "description": "客户端为本次报价生成并持久保存的 UUID。网络重试与 Idempotency-Key 一同原样复用；参数改变或明确结束后重新报价须生成新值。"
        }
      }
    },
    "TgDirectServiceFee": {
      "type": "string",
      "pattern": "^\\d+(\\.\\d{1,2})?$",
      "maxLength": 20,
      "description": "USD 钱包服务费，范围 0–10000，最多两位小数。响应固定两位；独立于 TG 官方卡片扣款。",
      "examples": [
        "1.00"
      ]
    },
    "TgCdkGenerateResponse": {
      "type": "object",
      "required": [
        "code",
        "data"
      ],
      "properties": {
        "code": {
          "type": "integer",
          "const": 200
        },
        "data": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "list",
            "replayed"
          ],
          "properties": {
            "list": {
              "type": "array",
              "minItems": 1,
              "maxItems": 50,
              "items": {
                "$ref": "#/components/schemas/TgCdkIssuerItem"
              }
            },
            "replayed": {
              "type": "boolean"
            }
          }
        }
      }
    },
    "TgCdkStatus": {
      "type": "string",
      "enum": [
        "unused",
        "preparing",
        "prepared",
        "funding",
        "funded",
        "paying",
        "review_required",
        "completed",
        "failed_precharge",
        "ineligible",
        "revoked",
        "paid_pending_delivery",
        "requires_action"
      ],
      "description": "funded 表示卡片资金已就绪但 TG 付款尚未派发；查询不自动付款，用户明确继续时以原绑定 redeem。结果未知不重新绑定或重复资金操作。"
    },
    "TgCdkGenerateInput": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "plan",
        "quantity",
        "maxWalletDebitUsd",
        "maxOfficialAmountMinor",
        "currency",
        "fundingAmountUsd"
      ],
      "properties": {
        "plan": {
          "$ref": "#/components/schemas/TgDirectPlanKey"
        },
        "quantity": {
          "type": "integer",
          "minimum": 1,
          "maximum": 50
        },
        "maxWalletDebitUsd": {
          "type": "string",
          "pattern": "^\\d+(\\.\\d{1,4})?$",
          "description": "每张 CDK 本次授权的钱包支出上限，涵盖固定卡片注资、开卡/充值费用与 TG 服务费；不是批次总额度。 最多四位小数，最大 10000 USD；maxWalletDebitUsd 须大于零。",
          "maxLength": 24
        },
        "maxOfficialAmountMinor": {
          "type": "integer",
          "format": "int64",
          "minimum": 1,
          "description": "允许的 TG 官方金额上限，按 currency 最小货币单位。",
          "maximum": 1000000000
        },
        "currency": {
          "type": "string",
          "pattern": "^[A-Za-z]{3}$",
          "description": "三位币种代码，大小写均接受并转为小写；须匹配实际 TG 官方报价（例如 USD）。"
        },
        "fundingAmountUsd": {
          "type": "string",
          "pattern": "^\\d+(\\.\\d{1,4})?$",
          "description": "固定一次卡片注资额；已有卡可为零，自动开卡时作初充。兑换不自动追加 FTG 缓冲或加额。 最多四位小数，最大 10000 USD；maxWalletDebitUsd 须大于零。",
          "maxLength": 24
        },
        "cardId": {
          "type": "integer",
          "format": "int64",
          "minimum": 1,
          "description": "发行者自有卡片，与 autoCard 二选一。"
        },
        "autoCard": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "productCode",
            "firstName",
            "lastName"
          ],
          "properties": {
            "productCode": {
              "type": "string",
              "minLength": 1,
              "maxLength": 64
            },
            "firstName": {
              "type": "string",
              "minLength": 1,
              "maxLength": 64
            },
            "lastName": {
              "type": "string",
              "minLength": 1,
              "maxLength": 64
            }
          }
        }
      },
      "oneOf": [
        {
          "required": [
            "cardId"
          ],
          "not": {
            "required": [
              "autoCard"
            ]
          }
        },
        {
          "required": [
            "autoCard"
          ],
          "not": {
            "required": [
              "cardId"
            ]
          }
        }
      ]
    },
    "TgCdkPreflightInput": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "code",
        "deviceToken",
        "recipient",
        "clientRequestId"
      ],
      "properties": {
        "code": {
          "type": "string",
          "description": "完整 TG CDK；是消费发行者授权的凭据，不可记录到公开日志或放在 URL。"
        },
        "deviceToken": {
          "type": "string",
          "minLength": 32,
          "maxLength": 128,
          "pattern": "^[A-Za-z0-9_-]+$",
          "description": "兑换设备标识，32–128位ASCII字母数字/下划线/连字符。推荐密码学随机32字节编码为64位十六进制并持久保存；必须逐字复用。"
        },
        "recipient": {
          "type": "string",
          "description": "Telegram 用户名，可带开头 @，去除 @ 后为 1–32 位 ASCII 字母、数字或下划线；不接受显示名和链接。",
          "maxLength": 33
        },
        "clientRequestId": {
          "type": "string",
          "format": "uuid"
        }
      }
    },
    "TgDirectOrder": {
      "type": "object",
      "required": [
        "id",
        "recipient",
        "plan",
        "cardId",
        "status",
        "serviceFee",
        "serviceFeeStatus",
        "paymentAttempted",
        "createdAt"
      ],
      "properties": {
        "id": {
          "type": "string",
          "format": "uuid"
        },
        "recipient": {
          "type": "string"
        },
        "plan": {
          "$ref": "#/components/schemas/TgDirectPlanKey"
        },
        "cardId": {
          "type": "integer",
          "format": "int64"
        },
        "status": {
          "type": "string",
          "enum": [
            "preparing",
            "prepared",
            "processing",
            "completed",
            "paid_pending_delivery",
            "review_required",
            "requires_action",
            "ineligible",
            "failed_precharge",
            "cancelled"
          ],
          "description": "HTTP 200 仅表示返回订单。completed 才表示流程完成；paid_pending_delivery 已有付款成功证据但待交付。不确定状态须查原订单，禁止另建订单重付。"
        },
        "serviceFee": {
          "$ref": "#/components/schemas/TgDirectServiceFee"
        },
        "serviceFeeStatus": {
          "type": "string",
          "enum": [
            "unpaid",
            "charged",
            "refunded",
            "waived"
          ],
          "description": "钱包服务费状态：未扣、已扣、已退、零费用。不是 TG 官方卡片付款状态。"
        },
        "pricingVersion": {
          "type": "integer",
          "format": "int64",
          "minimum": 1,
          "description": "订单保存的服务费配置版本。"
        },
        "paymentAttempted": {
          "type": "boolean",
          "description": "本站已创建并派发资金操作；true 不代表付款成功，也不等同于 paymentSubmitted。"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "amountMinor": {
          "type": "integer",
          "format": "int64",
          "minimum": 1,
          "description": "TG 官方报价，整数最小货币单位。仅在取得有效报价后出现；按币种小数位换算。"
        },
        "currency": {
          "type": "string",
          "pattern": "^[a-z]{3}$"
        },
        "estimatedUsd": {
          "type": [
            "string",
            "null"
          ],
          "description": "官方报价的美元参考换算，最多两位小数；可能缺省或为 null。不含钱包服务费，不是发卡方最终结算金额。"
        },
        "fxRateDate": {
          "type": [
            "string",
            "null"
          ],
          "description": "参考汇率日期（YYYY-MM-DD）；可能缺省。"
        },
        "cardLast4": {
          "type": "string",
          "pattern": "^[0-9]{4}$"
        },
        "paymentSubmitted": {
          "type": "boolean",
          "description": "协议层是否提交付款；缺省不可解释为 false。确认后的不确定结果可能为 true。"
        },
        "paymentStatus": {
          "type": [
            "string",
            "null"
          ],
          "description": "支付会话状态；paid 是付款成功证据。"
        },
        "recipientId": {
          "type": "integer",
          "format": "int64",
          "description": "解析并绑定的 Telegram 用户 ID。"
        },
        "errorCode": {
          "type": "string",
          "description": "订单级协议错误码，通常小写；与 HTTP 错误对象的 errorCode 不同。可扩展，未知码按订单状态处理。"
        },
        "message": {
          "type": "string",
          "description": "供展示的提示，不应通过匹配文本判断是否扣款。"
        },
        "providerStatus": {
          "type": "string",
          "description": "支付服务商查询结果；cancelled 不能单独证明未扣款。"
        },
        "deliveryStatus": {
          "type": "string",
          "enum": [
            "pending",
            "delivered"
          ],
          "description": "delivered 必须有当前赠送唯一匹配的 Telegram 服务消息。"
        },
        "giftMessageId": {
          "type": "integer",
          "description": "已核验的赠送服务消息 ID。"
        },
        "giftDays": {
          "type": "integer",
          "description": "赠送消息报告的实际天数，按日历核对套餐月数。"
        },
        "months": {
          "type": "integer",
          "enum": [
            3,
            6,
            12
          ]
        }
      },
      "description": "报价、支付及恢复共用快照。未取得的协议字段可能缺省；允许新增响应字段。读取权限同时受账户及创建 API key 限制。"
    },
    "GptAutoInput": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "credential": {
          "$ref": "#/components/schemas/GptCredential"
        },
        "plan": {
          "type": "string",
          "enum": [
            "go",
            "plus",
            "pro_5x",
            "pro_20x"
          ]
        },
        "paymentCountry": {
          "type": "string",
          "minLength": 2,
          "maxLength": 2
        },
        "paymentCurrency": {
          "type": "string",
          "minLength": 3,
          "maxLength": 3
        },
        "expectedAmountUsd": {
          "$ref": "#/components/schemas/NonNegativeDecimal"
        },
        "expectedCustomerServiceFee": {
          "$ref": "#/components/schemas/NonNegativeDecimal"
        },
        "pricingVersion": {
          "type": "integer",
          "minimum": 1
        },
        "maxTotalDebitUsd": {
          "$ref": "#/components/schemas/NonNegativeDecimal"
        },
        "forceNewCard": {
          "type": "boolean",
          "default": false
        },
        "productCode": {
          "type": "string",
          "minLength": 1,
          "maxLength": 32
        }
      },
      "required": [
        "credential",
        "plan",
        "paymentCountry",
        "paymentCurrency",
        "expectedAmountUsd",
        "expectedCustomerServiceFee",
        "pricingVersion",
        "maxTotalDebitUsd"
      ]
    },
    "GptAutoAttempt": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "attempt": {
          "type": "integer",
          "minimum": 1,
          "maximum": 2
        },
        "newCard": {
          "type": "boolean"
        },
        "cardId": {
          "anyOf": [
            {
              "type": "integer"
            },
            {
              "type": "null"
            }
          ]
        },
        "cardLastFour": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "orderId": {
          "anyOf": [
            {
              "type": "string",
              "format": "uuid"
            },
            {
              "type": "null"
            }
          ]
        },
        "status": {
          "type": "string",
          "enum": [
            "funding",
            "payment",
            "pending",
            "completed",
            "failed"
          ]
        },
        "failureCode": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "reservedDebitUsd": {
          "$ref": "#/components/schemas/NonNegativeDecimal"
        }
      },
      "required": [
        "attempt",
        "newCard",
        "cardId",
        "cardLastFour",
        "orderId",
        "status",
        "failureCode",
        "reservedDebitUsd"
      ]
    },
    "GptAutoTask": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "id": {
          "type": "string",
          "format": "uuid"
        },
        "plan": {
          "type": "string"
        },
        "forceNewCard": {
          "type": "boolean"
        },
        "status": {
          "type": "string",
          "enum": [
            "queued",
            "running",
            "pending",
            "requires_action",
            "completed",
            "failed"
          ]
        },
        "failureCode": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "maxTotalDebitUsd": {
          "$ref": "#/components/schemas/NonNegativeDecimal"
        },
        "reservedDebitUsd": {
          "$ref": "#/components/schemas/NonNegativeDecimal"
        },
        "attemptCount": {
          "type": "integer",
          "minimum": 0,
          "maximum": 2
        },
        "attempts": {
          "type": "array",
          "items": {
            "$ref": "#/components/schemas/GptAutoAttempt"
          },
          "maxItems": 2
        },
        "createdAt": {
          "type": "string"
        },
        "updatedAt": {
          "type": "string"
        }
      },
      "required": [
        "id",
        "plan",
        "forceNewCard",
        "status",
        "failureCode",
        "maxTotalDebitUsd",
        "reservedDebitUsd",
        "attemptCount",
        "attempts",
        "createdAt",
        "updatedAt"
      ]
    },
    "GptAutoResponse": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "code": {
          "$ref": "#/components/schemas/SuccessCode"
        },
        "data": {
          "$ref": "#/components/schemas/GptAutoTask"
        }
      },
      "required": [
        "code",
        "data"
      ]
    },
    "CardClosureInput": {
      "oneOf": [
        {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "all": {
              "const": true
            }
          },
          "required": [
            "all"
          ]
        },
        {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "all": {
              "const": false,
              "default": false
            },
            "cardIds": {
              "type": "array",
              "minItems": 1,
              "maxItems": 1000,
              "items": {
                "type": "integer",
                "minimum": 1
              }
            }
          },
          "required": [
            "cardIds"
          ]
        }
      ]
    },
    "CardClosureItem": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "cardId": {
          "type": "integer"
        },
        "status": {
          "type": "string",
          "enum": [
            "queued",
            "processing",
            "review_required",
            "succeeded",
            "skipped",
            "failed"
          ]
        },
        "operationId": {
          "anyOf": [
            {
              "type": "string",
              "format": "uuid"
            },
            {
              "type": "null"
            }
          ]
        },
        "reasonCode": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "required": [
        "cardId",
        "status",
        "operationId",
        "reasonCode"
      ]
    },
    "CardClosureBatch": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "id": {
          "type": "string",
          "format": "uuid"
        },
        "status": {
          "type": "string",
          "enum": [
            "processing",
            "completed",
            "completed_with_errors"
          ]
        },
        "total": {
          "type": "integer",
          "minimum": 0
        },
        "pending": {
          "type": "integer",
          "minimum": 0
        },
        "succeeded": {
          "type": "integer",
          "minimum": 0
        },
        "failed": {
          "type": "integer",
          "minimum": 0
        },
        "skipped": {
          "type": "integer",
          "minimum": 0
        },
        "reviewRequired": {
          "type": "integer",
          "minimum": 0
        },
        "offset": {
          "type": "integer",
          "minimum": 0
        },
        "limit": {
          "type": "integer",
          "minimum": 0
        },
        "hasMore": {
          "type": "boolean"
        },
        "list": {
          "type": "array",
          "items": {
            "$ref": "#/components/schemas/CardClosureItem"
          }
        }
      },
      "required": [
        "id",
        "status",
        "total",
        "pending",
        "succeeded",
        "failed",
        "skipped",
        "reviewRequired",
        "offset",
        "limit",
        "hasMore",
        "list"
      ]
    },
    "CardClosureResponse": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "code": {
          "$ref": "#/components/schemas/SuccessCode"
        },
        "data": {
          "$ref": "#/components/schemas/CardClosureBatch"
        }
      },
      "required": [
        "code",
        "data"
      ]
    },
    "CheckoutRegion": {
      "type": "object",
      "required": [
        "country",
        "currency"
      ],
      "properties": {
        "country": {
          "type": "string",
          "pattern": "^[A-Z]{2}$"
        },
        "currency": {
          "type": "string",
          "pattern": "^[A-Z]{3}$"
        }
      }
    },
    "GptPasswordCredential": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "mode",
        "email",
        "password",
        "totpSecret"
      ],
      "properties": {
        "mode": {
          "type": "string",
          "const": "password"
        },
        "email": {
          "type": "string",
          "minLength": 3,
          "maxLength": 320,
          "writeOnly": true
        },
        "password": {
          "type": "string",
          "minLength": 1,
          "maxLength": 1024,
          "writeOnly": true
        },
        "totpSecret": {
          "type": "string",
          "minLength": 16,
          "maxLength": 134,
          "writeOnly": true
        }
      }
    }
  }
}
```

### Webhook 完整合约

```json
{
  "avanfinityEvent": {
    "post": {
      "operationId": "receiveAvanfinityWebhook",
      "summary": "接收 Avanfinity 事件",
      "description": "验签必须使用未解析的原始请求体：以独立 Webhook Secret 为 HMAC key，对 X-Avanfinity-Webhook-Timestamp + '.' + rawBody 执行 HMAC-SHA256，并与 X-Avanfinity-Signature 的 v1 摘要做常量时间比较。事件按 API key 的对应只读 scope 投递，不会绕过最小权限。接收方应在 5 秒内返回任意 2xx；非 2xx 或网络失败最多重试 5 次。钱包充值使用 deposit.updated；只有 status=confirmed 表示到账且已入账，expired 可因迟到的有效转账变为 confirmed，cancelled 是不可变终态且后续转账不会匹配或自动入账。Webhook 可能重复或乱序，应按 X-Avanfinity-Webhook-Id 去重并以 GET /deposits/{gatewayRef} 为最终事实来源；不要同时根据 deposit.updated 和 wallet.transaction.created 对同一笔充值重复入账。",
      "security": [],
      "parameters": [
        {
          "$ref": "#/components/parameters/WebhookId"
        },
        {
          "$ref": "#/components/parameters/WebhookTimestamp"
        },
        {
          "$ref": "#/components/parameters/WebhookSignature"
        }
      ],
      "requestBody": {
        "required": true,
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/WebhookEvent"
            },
            "examples": {
              "test": {
                "summary": "控制台测试事件",
                "value": {
                  "id": "evt_a18f6d10_7c1a4b2c_9d3ea4f5_b6c7d8e9",
                  "type": "webhook.test",
                  "apiVersion": "2026-08-01",
                  "createdAt": "2026-08-01T10:00:00Z",
                  "data": {
                    "object": {
                      "test": true
                    }
                  }
                }
              },
              "depositConfirmed": {
                "summary": "钱包充值已到账",
                "value": {
                  "id": "evt_b28f7e21_8d2b5c3d_ae4fb506_c7d8e9f0",
                  "type": "deposit.updated",
                  "apiVersion": "2026-08-01",
                  "createdAt": "2026-08-01T10:03:00Z",
                  "data": {
                    "object": {
                      "depositId": 123,
                      "gatewayRef": "00000000-0000-4000-8000-000000000001",
                      "currency": "USDT",
                      "network": "TRON",
                      "requestedAmount": "10.00",
                      "expectedAmount": "10.034550",
                      "actualAmount": "10.034550",
                      "creditedAmount": "10.034550",
                      "fee": "0.000000",
                      "status": "confirmed",
                      "transactionHash": "2f4d8c6a",
                      "confirmedAt": "2026-08-01T10:03:00Z",
                      "expiredAt": "2026-08-01T10:15:00Z"
                    }
                  }
                }
              }
            }
          }
        }
      },
      "responses": {
        "200": {
          "description": "已持久化或已幂等接收"
        }
      }
    }
  }
}
```
