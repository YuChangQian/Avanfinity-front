import type { Plugin } from "vite";

const createdAt = "2026-08-10T08:00:00Z";
const plusSuccess = {
  type: "openai_direct",
  plan: "plus",
  priceMajor: "982.14",
  currency: "PHP",
  estimatedUsd: "15.99906060",
  completedAt: createdAt,
};
const proSuccess = {
  type: "openai_direct",
  plan: "pro_5x",
  priceMajor: "150.00",
  currency: "USD",
  estimatedUsd: null,
  completedAt: "2026-08-10T09:00:00Z",
};
const plans = [
  { plan: "go", attempts: 0, successes: 0, declines: 0, successRateBps: null, declineRateBps: null, latestSuccess: null },
  { plan: "plus", attempts: 2, successes: 1, declines: 1, successRateBps: 5000, declineRateBps: 5000, latestSuccess: plusSuccess },
  { plan: "pro_5x", attempts: 4, successes: 3, declines: 1, successRateBps: 7500, declineRateBps: 2500, latestSuccess: proSuccess },
  { plan: "pro_20x", attempts: 1, successes: 0, declines: 1, successRateBps: 0, declineRateBps: 10000, latestSuccess: null },
];
const overall = { attempts: 7, successes: 4, declines: 3, successRateBps: 5714, declineRateBps: 4286 };
const paymentRisk = {
  enabled: true,
  windowDays: 30,
  minAttempts: 100,
  lockThresholdBps: 3000,
  releaseThresholdBps: 2000,
  reserveBps: 2000,
  attempts: 120,
  successes: 84,
  declines: 36,
  successRateBps: 7000,
  declineRateBps: 3000,
  reserveActive: true,
  evaluatedAt: "2026-08-17T08:00:00Z",
};
const productBase = {
  issuer: "E2E Bank",
  network: "VISA",
  issuingArea: "US",
  cardType: "Virtual",
  openFee: "1.0000",
  openQuoteVersion: "a".repeat(64),
  rechargeRate: "0.010000",
  refundRate: "0.020000",
  declineFee: "0.5000",
  authorizationReversalRate: "0.000000",
  authorizationFee: "0.0000",
  smallTransactionFee: "0.3000",
  crossBorderFee: "0.010000",
  lowAuthorizationThreshold: "1.0000",
  lowAuthorizationFee: "0.1500",
  lowAuthorizationStackMode: "stack",
  refundKeepMinimum: "1.0000",
  minAmount: "10.0000",
  maxAmount: "1000.0000",
  description: "AI subscriptions",
  category: "AI",
  restrictedMerchants: [],
  googleChatgptBlocked: false,
};
const products = [
  { ...productBase, productCode: "EXPLICIT_BIN", displayBin: "537872", displayBins: ["537872"] },
  { ...productBase, productCode: "MULTI_BIN", network: "MASTERCARD", displayBin: null, displayBins: ["525962", "555671", "544015"] },
];
const cards = [
  {
    id: 81,
    cardNumberMasked: "•••• •••• •••• 0081",
    productCode: "EXPLICIT_BIN",
    network: "VISA",
    issuingArea: "US",
    status: "ACTIVE",
    balance: "10.0000",
    refundKeepMinimum: "1.0000",
    firstName: "Visa",
    lastName: "Card",
    pendingOperationId: null,
    pendingOperationType: null,
    createdAt,
  },
  {
    id: 82,
    cardNumberMasked: "•••• •••• •••• 0082",
    productCode: "MULTI_BIN",
    network: "MASTERCARD",
    issuingArea: "US",
    status: "ACTIVE",
    balance: "42.5000",
    refundKeepMinimum: "1.0000",
    firstName: "Mastercard",
    lastName: "Card",
    pendingOperationId: null,
    pendingOperationType: null,
    createdAt,
  },
];
const cardDetails: Record<string, object> = Object.fromEntries(cards.map((card) => [String(card.id), {
  ...card,
  issuer: "E2E Bank",
  availableAmount: card.balance,
  note: "",
  expiry: "12/29",
  minAmount: "10.0000",
  maxAmount: "1000.0000",
  rechargeRate: "0.010000",
  refundRate: "0.020000",
  declineFee: "0.5000",
  authorizationReversalRate: "0.000000",
  authorizationFee: "0.0000",
  smallTransactionFee: "0.3000",
  crossBorderFee: "0.010000",
  lowAuthorizationThreshold: "1.0000",
  lowAuthorizationFee: "0.1500",
  lowAuthorizationStackMode: "stack",
}]));
const session = {
  token: "preview",
  userId: 9,
  email: "preview@local",
  displayName: "Preview",
  role: "admin",
  mfaLevel: "password",
  mfaEnrollmentRequired: false,
};
const previewOrderId = "b000a16e-7b99-405a-a5c0-0d756aa454a9";
const previewOrder = {
  id: previewOrderId,
  plan: "pro_20x",
  status: "processing",
  stage: "verifying",
  maskedEmail: "p***@example.com",
  cardId: 81,
  cardNumberMasked: "•••• •••• •••• 0081",
  serviceFee: "3.0000",
  customerServiceFee: "3.0000",
  operationStatus: "PENDING",
  quotedAmountMinor: 793788,
  finalAmountMinor: null,
  currency: "PHP",
  fundingState: "FUNDED",
  fundingHoldStatus: "HELD",
  invoiceUrls: ["https://invoice.stripe.com/i/acct_preview/test_plus", "https://invoice.stripe.com/i/acct_preview/test_pro"],
  willRenew: null,
  needsRenewalCancel: false,
  clientRequestId: "preview-request",
  createdAt: "2026-08-21T11:48:30Z",
  updatedAt: "2026-08-21T11:49:02Z",
};
const previewOrderEvents = [
  ["queued", "订单已进入安全队列", "2026-08-21T11:48:30Z"],
  ["prechecking", "正在刷新 ChatGPT 会话并检查账号", "2026-08-21T11:48:33Z"],
  ["checkout", "正在确认 Plus 前置套餐", "2026-08-21T11:48:39Z"],
  ["charging", "正在向 Stripe 提交 Pro 10x · Pro 200 扣款", "2026-08-21T11:48:41Z"],
  ["verifying", "Stripe 已受理扣款，正在确认套餐与账单", "2026-08-21T11:49:02Z"],
].map(([stage, publicMessage, time], index) => ({
  eventId: `preview-event-${index + 1}`,
  type: "progress",
  status: "processing",
  stage,
  publicMessage,
  occurredAt: time,
  createdAt: time,
}));
const previewTransactions = [
  {
    id: 101, authId: "1064372459", cardId: 81, type: "PURCHASE", status: "SETTLED",
    cardNumberMasked: "•••• 0081", authAmount: "129.07", settleAmount: "129.07", authCurrency: "USD", settleCurrency: "USD",
    merchantName: "OPENAI *CHATGPT SUBSCR", description: "ChatGPT Pro", authTime: "2026-08-21T05:27:05Z", createdAt: "2026-08-21T05:27:05Z",
    merchantLocation: "SAN FRANCISCO", merchantRegion: "CA", merchantCountry: "US", failedReason: null, billStatus: "SETTLED",
    merchantAmount: "129.07", merchantCurrency: "USD", sourceCreatedAt: "2026-08-21T05:27:05Z", source: "webhook", channel: "online",
  },
  {
    id: 102, authId: "1064372498", cardId: 82, type: "PURCHASE", status: "DECLINED",
    cardNumberMasked: "•••• 0082", authAmount: "20.00", settleAmount: "0.00", authCurrency: "USD", settleCurrency: "USD",
    merchantName: "OPENAI *CHATGPT", description: "订阅授权", authTime: "2026-08-21T10:12:00Z", createdAt: "2026-08-21T10:12:00Z",
    merchantLocation: "MANILA", merchantRegion: "NCR", merchantCountry: "PH", failedReason: "余额不足", billStatus: "DECLINED",
    merchantAmount: "20.00", merchantCurrency: "USD", sourceCreatedAt: "2026-08-21T10:12:00Z", source: "webhook", channel: "online",
  },
];
const trendDays = Array.from({ length: 30 }, (_, index) => {
  const day = String(index + 1).padStart(2, "0");
  const registrations = [2, 3, 2, 4, 3, 5, 4, 5, 6, 4, 5, 7, 6, 8, 7, 6, 9, 8, 10, 9, 8, 11, 10, 12, 11, 13, 12, 14, 13, 15];
  const cards = [1, 1, 2, 2, 2, 3, 2, 3, 4, 3, 4, 4, 5, 4, 5, 5, 6, 5, 7, 6, 7, 7, 8, 7, 9, 8, 9, 10, 9, 11];
  const deposits = [86, 104, 98, 136, 128, 174, 162, 210, 226, 204, 252, 281, 264, 318, 342, 326, 389, 371, 438, 462, 431, 506, 534, 512, 589, 621, 604, 682, 714, 768];
  return { date: `2026-08-${day}`, registrationCount: registrations[index], cardCount: cards[index], depositTotal: String(deposits[index]) };
});

function json(res: { statusCode: number; setHeader: (name: string, value: string) => void; end: (chunk?: string) => void }, body: unknown, status = 200) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

export function stylePreviewPlugin(): Plugin {
  return {
    name: "style-preview-mock",
    transformIndexHtml(html) {
      return html.replace(
        "</head>",
        `<script>try{localStorage.setItem("session",${JSON.stringify(JSON.stringify(session))})}catch(e){}</script></head>`,
      );
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? "";
        const path = url.split("?")[0];
        if (!path.startsWith("/api/")) return next();
        if (path === "/api/features") {
          return json(res, { code: 0, data: {
            version: 1, registration: true, walletTransfer: true, cardOpening: true, cardRecharge: true,
            cardManagement: true, cardDelete: true, gptDirect: true, gptCdk: true, deposits: true,
            rewards: true, agent: true, market: true, developerApi: true, telegram: true,
          } });
        }
        if (path === "/api/auth/captcha") {
          return json(res, { code: 0, data: { required: false, id: null, image: null, expiresIn: 0 } });
        }
        if (path === "/api/auth/login") return json(res, session);
        if (path === "/api/auth/logout") return json(res, { code: 0 });
        if (path === "/api/auth/refresh") return json(res, { code: 0 });
        if (path === "/api/dashboard") {
          return json(res, {
            userId: 9, email: session.email, displayName: session.displayName, role: "admin",
            walletBalance: "100.0000", lockedBalance: "20.0000", spendableBalance: "80.0000",
            paymentRisk, cardBalance: "52.5000", cardCount: 2, inviteCode: "PREVW",
          });
        }
        if (path === "/api/dashboard/charts") return json(res, { code: 0, data: {
          balance: trendDays.map((item, index) => ({ date: item.date, balance: String(62 + index * 1.4 + (index % 5) * 2) })),
          spend: trendDays.map((item, index) => ({ date: item.date, spend: String(4 + (index % 7) * 3.2) })),
        } });
        const announcements = [
          { id: 31, title: "卡片拒付提醒", content: "尾号 0082 的卡片今日发生 1 次拒付，请留意余额与拒付率。", isPinned: true, isRead: false, createdAt: "2026-08-21T10:12:00Z", telegramDelivery: null, metadata: { targetPath: "/card-transactions?cardId=82&authId=1064372498", cardId: 82, authId: "1064372498", count: 1, merchant: "OPENAI *CHATGPT", reason: "余额不足", latestAt: "2026-08-21T10:12:00Z" } },
          { id: 30, title: "系统结算说明更新", content: "卡消费、退款和资金流水现已提供更完整的明细。", isPinned: false, isRead: true, createdAt, telegramDelivery: null },
        ];
        if (path === "/api/announcements/unread") return json(res, { code: 0, data: announcements.filter((item) => !item.isRead), unreadCount: 1 });
        if (path === "/api/announcements") return json(res, { code: 0, data: { total: announcements.length, unreadCount: 1, page: 1, pageSize: 20, list: announcements } });
        if (path === "/api/wallet") {
          return json(res, { code: 0, data: {
            balance: "100.0000", lockedBalance: "20.0000", spendableBalance: "80.0000", paymentRisk,
            promoBalance: "0.0000", cumulativeDeposit: "100.0000", cumulativeSpend: "0.0000",
          } });
        }
        if (path.startsWith("/api/wallet/transactions")) return json(res, { code: 0, data: { total: 0, list: [] } });
        if (path === "/api/products") return json(res, { code: 0, data: products });
        if (path === "/api/cards") return json(res, { code: 0, data: { total: cards.length, list: cards } });
        if (path === "/api/gpt-direct/card-successes") {
          return json(res, { code: 0, data: { list: [
            { cardId: 81, overall, plans },
            { cardId: 82, overall, plans },
          ] } });
        }
        if (path === "/api/openai-prices") {
          return json(res, { code: 0, data: {
            references: [{ bin6: "537872", ...plusSuccess }],
            binStats: [
              { bin6: "537872", overall, plans },
              { bin6: "525962", overall: { attempts: 4, successes: 3, declines: 1, successRateBps: 7500, declineRateBps: 2500 }, plans },
              { bin6: "555671", overall: { attempts: 2, successes: 2, declines: 0, successRateBps: 10000, declineRateBps: 0 }, plans: plans.map((item) => item.plan === "plus" ? { ...item, attempts: 2, successes: 2, declines: 0, successRateBps: 10000, declineRateBps: 0 } : item) },
            ],
          } });
        }
        const cardMatch = /^\/api\/cards\/(\d+)$/.exec(path);
        if (cardMatch) {
          const detail = cardDetails[cardMatch[1]];
          return detail ? json(res, { code: 0, data: detail }) : json(res, { error: "not found" }, 404);
        }
        if (path.startsWith("/api/cards/transactions")) {
          return json(res, { code: 0, data: { total: previewTransactions.length, list: previewTransactions, activityTotal: 0, activities: [] } });
        }
        if (path === "/api/cards/spending") {
          const list = previewTransactions.map((item, index) => ({
            providerId: 1, cardId: item.cardId, cardNumberMasked: item.cardNumberMasked, cardStatus: "ACTIVE", authId: item.authId,
            status: item.status, merchantName: item.merchantName, description: item.description, merchantLocation: item.merchantLocation,
            merchantRegion: item.merchantRegion, merchantCountry: item.merchantCountry, failedReason: item.failedReason,
            billStatus: item.billStatus, source: item.source, channel: item.channel, authorizedAmount: item.authAmount,
            settledAmount: item.settleAmount, refundedAmount: "0.00", authCurrency: item.authCurrency,
            settleCurrency: item.settleCurrency, merchantAmount: item.merchantAmount, merchantCurrency: item.merchantCurrency,
            occurredAt: item.authTime, events: [{ id: index + 1, type: "Authorization", status: item.status === "DECLINED" ? "DECLINED" : "COMPLETE", authAmount: item.authAmount, settleAmount: item.settleAmount, authCurrency: item.authCurrency, settleCurrency: item.settleCurrency, merchantAmount: item.merchantAmount, merchantCurrency: item.merchantCurrency, description: item.description, billStatus: item.billStatus, failedReason: item.failedReason, source: item.source, channel: item.channel, authTime: item.authTime, sourceCreatedAt: item.sourceCreatedAt }],
          }));
          return json(res, { code: 0, data: { total: list.length, page: 1, pageSize: 30, list } });
        }
        if (path === "/api/gpt-direct/plans") {
          return json(res, { code: 0, data: { version: 1, plans: [
            { key: "go", label: "Go", currency: "USD", enabled: true, serviceFeeUsdMinor: 50, customerServiceFee: "0.5000" },
            { key: "plus", label: "Plus", currency: "USD", enabled: true, serviceFeeUsdMinor: 150, customerServiceFee: "1.5000" },
            { key: "pro_5x", label: "Pro 5x · Pro 100", currency: "USD", enabled: true, serviceFeeUsdMinor: 300, customerServiceFee: "3.0000" },
          ] } });
        }
        if (path === "/api/gpt-direct/observed-quotes") {
          return json(res, { code: 0, data: { list: [{
            plan: "plus", country: "PH", currency: "PHP", amountMajor: "982.14", amountUsd: "16.00",
            observedAt: createdAt, fxDate: "2026-08-10",
          }] } });
        }
        if (path === "/api/gpt-direct/orders") return json(res, { code: 0, data: { total: 1, list: [previewOrder] } });
        if (path === `/api/gpt-direct/orders/${previewOrderId}`) return json(res, { code: 0, data: { order: previewOrder, events: previewOrderEvents } });
        if (path.startsWith("/api/gpt-direct/cdks")) return json(res, { code: 0, data: { total: 0, list: [] } });
        if (path === "/api/gpt-direct/cdk-offers") return json(res, { code: 0, data: { offers: [] } });
        if (path === "/api/admin") {
          return json(res, { code: 0, data: {
            userCount: 12, activeCardCount: 8, platformWalletTotal: "1280.0000",
            depositCurrency: "USDT", customerCumulativeDepositTotal: "900.0000",
            confirmedDepositTotal: "860.0000", confirmedDepositCount: 9,
            pendingDepositTotal: "40.0000", pendingDepositCount: 1,
          } });
        }
        if (path === "/api/admin/users") {
          return json(res, { code: 0, data: { total: 1, page: 1, pageSize: 20, list: [{
            id: 7, email: "customer@example.com", role: "customer", status: "active", memberTier: "none",
            walletBalance: "31.5000", promoBalance: "2.7500", cumulativeRecharge: "80.2500", inviteCode: "INVITE7",
            cardCount: 1, activeCardCount: 1, referralCount: 1, riskHold: false, createdAt,
            telegram: { bound: true, username: "customer_tg", verifiedAt: createdAt },
          }] } });
        }
        const adminUserDetail = /^\/api\/admin\/users\/(\d+)\/detail$/.exec(path);
        if (adminUserDetail?.[1] === "6") {
          return json(res, { code: 0, data: {
            profile: {
              id: 6, email: "inviter@example.com", role: "user", status: "active", inviteCode: "INVITE6", riskHold: false,
              cumulativeRecharge: "120.0000", walletBalance: "40.0000", lockedBalance: "0.0000", spendableBalance: "40.0000",
              promoBalance: "0.0000", createdAt, updatedAt: createdAt, emailVerifiedAt: createdAt, emailLoginAvailable: true,
              inviter: null,
              telegram: { bound: true, username: "inviter_tg", verifiedAt: createdAt },
              membership: { code: "none", nameZh: "普通会员", nameEn: "Standard", descriptionZh: "", descriptionEn: "", thresholdAmount: "0.0000" },
            },
            directReferrals: { total: 1, limit: 100, list: [] },
            earnings: { total: 0, limit: 100, list: [] },
            cards: { total: 0, limit: 100, list: [] },
            deposits: { total: 0, limit: 100, list: [] },
            operations: { total: 0, limit: 100, list: [] },
            risk: { paymentPerformance: { ...paymentRisk, attempts: 0, successes: 0, declines: 0, successRateBps: null, declineRateBps: null, reserveActive: false }, holdReasons: [], owedCharges: { count: 0, total: "0.0000", byKind: [] } },
          } });
        }
        if (adminUserDetail?.[1] === "7") {
          return json(res, { code: 0, data: {
            profile: {
              id: 7, email: "customer@example.com", role: "user", status: "active", inviteCode: "INVITE7", riskHold: false,
              cumulativeRecharge: "80.2500", walletBalance: "31.5000", lockedBalance: "6.3000", spendableBalance: "25.2000",
              promoBalance: "2.7500", createdAt, updatedAt: createdAt, emailVerifiedAt: createdAt, emailLoginAvailable: true,
              inviter: { id: 6, email: "inviter@example.com" },
              telegram: { bound: true, username: "customer_tg", verifiedAt: createdAt },
              membership: { code: "none", nameZh: "普通会员", nameEn: "Standard", descriptionZh: "", descriptionEn: "", thresholdAmount: "0.0000" },
            },
            directReferrals: { total: 0, limit: 100, list: [] },
            earnings: { total: 0, limit: 100, list: [] },
            cards: { total: 1, limit: 100, list: [{
              id: 71, cardNumberMasked: "•••• •••• •••• 0910", productCode: "P5378OX", network: "MASTERCARD",
              issuingArea: "US", issuer: "AI virtual card", status: "ACTIVE", balance: "21.0000",
              firstName: "Ada", lastName: "Lovelace", createdAt, updatedAt: createdAt,
            }] },
            deposits: { total: 1, limit: 100, list: [{
              gatewayRef: "dep-preview-1", currency: "USDT", network: "TRON", status: "confirmed",
              requestedAmount: "50.0000", orderAmount: "50.0000", actualAmount: "50.0000", creditedAmount: "50.0000",
              transactionHashMasked: "Txyz…91", createdAt, confirmedAt: createdAt,
            }] },
            operations: { total: 2, limit: 100, list: [
              { id: "op-open", type: "OPEN_CARD", status: "SUCCEEDED", amount: "10.0000", fee: "0.5000", customerCharge: "10.5000", totalAmount: "10.5000", cardId: null, openedCardIds: [71], createdAt, completedAt: createdAt },
              { id: "op-recharge", type: "RECHARGE", status: "SUCCEEDED", amount: "20.0000", fee: "0.2000", customerCharge: "20.2000", totalAmount: "20.2000", cardId: 71, openedCardIds: [], createdAt, completedAt: createdAt },
            ] },
            risk: {
              paymentPerformance: paymentRisk,
              holdReasons: [],
              owedCharges: { count: 0, total: "0.0000", byKind: [] },
            },
          } });
        }
        if (path === "/api/admin/pricing") return json(res, { code: 0, data: { tiers: [], overrides: [], referralPolicy: { profitShareRate: "0.100000", displayMode: "profit_share", version: 1 } } });
        if (path === "/api/admin/overview-trends") return json(res, { code: 0, data: { days: trendDays } });
        if (path === "/api/admin/upstreams") return json(res, { code: 0, data: [{
          code: "miyavip", name: "Miya Card Platform", environment: "production", enabled: true, priority: 10,
          runtimeActive: true, configured: true, writeEnabled: true, credentialSource: "database", credentialMask: "••••92", credentialVersion: 4,
          upstreamTier: "VIP", upstreamRechargeRate: "0.010000", lastHealthAt: "2026-08-21T11:58:00Z", lastProductSyncAt: "2026-08-21T11:42:00Z",
          lastBalanceSyncAt: "2026-08-21T11:57:00Z", lastProductAttemptAt: "2026-08-21T11:52:00Z", nextProductRetryAt: "2026-08-21T11:57:00Z",
          productFailureCount: 2, connectionHealth: "healthy", productHealth: "degraded", balanceHealth: "healthy", lastError: null, lastProductError: "上游产品目录 HTTP 429，正在退避重试",
          version: 4, balance: "1820.50", spendableBalance: "1710.25", reserveAmount: "110.25", currency: "USD",
        }] });
        if (path === "/api/admin/reconciliation") return json(res, { code: 0, data: [] });
        if (path === "/api/admin/money-operations/op-preview") return json(res, { code: 0, data: {
          operation: {
            id: "op-preview", userId: 7, email: "customer@example.com", provider: "miyavip", type: "GPT_DIRECT", status: "PENDING", amount: "129.07",
            upstreamCost: "129.07", customerCharge: "132.07", customerFee: "3.00", expectedProfit: "3.00", actualProfit: null, dispatchState: "CONFIRMED",
            targetCard: { id: 81, cardNumberMasked: "•••• 0081", productCode: "EXPLICIT_BIN" }, upstreamBusinessId: "pi_preview_20260821",
            lastError: null, lastVerifiedAt: "2026-08-21T11:49:02Z", pricingSnapshot: { country: "PH", currency: "PHP", quotedAmountMinor: 793788 }, createdAt: "2026-08-21T11:48:30Z",
            gptDirect: { orderId: previewOrderId, plan: "pro_20x", source: "direct", status: "processing", stage: "verifying", accountEmailMasked: "p***@example.com", cardNumberMasked: "•••• 0081", serviceFeeStatus: "HELD", latestCode: "payment_accepted", latestMessage: "Stripe 已受理，正在核对套餐", failureCode: null, failureReason: null, recentEvents: previewOrderEvents.map((event) => ({ ...event, category: "progress", step: event.stage, code: null, message: event.publicMessage, occurredAt: event.occurredAt })), updatedAt: "2026-08-21T11:49:02Z", completedAt: null },
          }, reconciliation: [], upstreamEvidence: { paymentIntentStatus: "processing", invoiceCount: 2 },
        } });
        if (path === "/api/admin/money-operations") return json(res, { code: 0, data: { total: 1, page: 1, pageSize: 50, list: [{
          id: "op-preview", userId: 7, email: "customer@example.com", provider: "miyavip", type: "GPT_DIRECT", status: "PENDING", amount: "129.07",
          upstreamCost: "129.07", customerCharge: "132.07", customerFee: "3.00", expectedProfit: "3.00", actualProfit: null, dispatchState: "CONFIRMED",
          targetCard: { id: 81, cardNumberMasked: "•••• 0081", productCode: "EXPLICIT_BIN" }, upstreamBusinessId: "pi_preview_20260821", lastError: null,
          lastVerifiedAt: "2026-08-21T11:49:02Z", pricingSnapshot: { country: "PH", currency: "PHP" }, createdAt: "2026-08-21T11:48:30Z",
        }] } });
        if (path === "/api/admin/audit-logs") return json(res, { code: 0, data: { total: 2, page: 1, pageSize: 50, list: [
          { id: 501, actorUserId: null, targetUserId: null, adminEmail: null, actorEmail: null, actorType: "system", action: "auto_sync_products", outcome: "success", sourceIp: null, userAgent: null, requestId: "req-auto-sync", targetType: "upstream", targetId: "miyavip", detail: { products: 12, elapsedMs: 642 }, createdAt: "2026-08-21T11:42:00Z" },
          { id: 502, actorUserId: 9, targetUserId: 7, adminEmail: "preview@local", actorEmail: "preview@local", actorType: "admin", action: "telegram_publish_checkin", outcome: "success", sourceIp: "127.0.0.1", userAgent: "Preview Browser", requestId: "req-checkin", targetType: "user", targetId: "7", detail: { chatId: "-1001234567890", publicationId: 88 }, createdAt: "2026-08-21T11:50:00Z" },
        ] } });
        if (path === "/api/admin/telegram/ai") return json(res, { code: 0, data: { enabled: true, groupEnabled: true, privateEnabled: true, model: "deepseek-v4-flash", perUserPerMinute: 6, perGroupPerMinute: 20, globalPerMinute: 60, maxOutputTokens: 800, apiKeyConfigured: true, apiKeyFingerprint: "…7A91", version: 2, updatedAt: createdAt } });
        if (path === "/api/admin/telegram/knowledge") return json(res, { code: 0, data: { list: [
          { id: 1, title: "Plus → Pro 10x · Pro 200 开通流程", content: "纯 Free 账号先在同一国家开通 Plus，确认会话刷新后再开通 Pro 10x · Pro 200；已有 Plus 时直接进入 Pro 阶段。", tags: ["GPT", "Pro200", "充值"], language: "zh", audience: "both", status: "active", version: 1, createdAt, updatedAt: createdAt },
          { id: 2, title: "CDK 兑换说明", content: "用户可在 CDK 兑换页输入兑换码并完成账号验证。", tags: ["CDK"], language: "zh", audience: "group", status: "active", version: 1, createdAt, updatedAt: createdAt },
        ] } });
        if (path === "/api/admin/telegram/bindings") return json(res, { code: 0, data: { total: 1, page: 1, pageSize: 20, list: [{ userId: 7, email: "customer@example.com", displayName: "Customer", memberTier: "普通会员", status: "active", telegramUsername: "customer_tg", verifiedAt: createdAt }] } });
        if (path === "/api/admin/telegram") return json(res, { code: 0, data: {
          configured: true, featureEnabled: true, botName: "avanfinity_bot",
          stats: { usersTotal: 126, active24h: 38, active7d: 79, active30d: 112, boundUsers: 84, successfulLogins30d: 73, managedGroups: 2, pendingJoinRequests: 1, failedJoinRequests: 0, pendingMemberVerifications: 1, failedMemberVerifications: 0 },
          health: { status: "healthy", lastCompletedUpdateAt: createdAt, lastHealthCheckAt: createdAt, pendingUpdates: 0, botCanReceiveUpdates: true },
          groups: [{ chatId: "-1001234567890", title: "AVANFINITY 用户群", status: "active", enabled: true, lotteryEnabled: true, joinVerificationEnabled: true, memberVerificationEnabled: true, verificationTtlSeconds: 300, botIsAdmin: true, checkinReportMode: "scheduled", checkinReportTime: "20:00", checkinReportIntervalMinutes: 0, checkinReportNextAt: "2026-08-21T12:00:00Z", checkinReportLastSentAt: createdAt, canInviteUsers: true, canDeleteMessages: true, canRestrictMembers: true, pendingJoinRequests: 1, failedJoinRequests: 0, updatedAt: createdAt, pendingMemberVerifications: 1, failedMemberVerifications: 0 }],
          lotteryActivities: [], publications: [],
          checkinPublications: [{ id: 88, chatId: "-1001234567890", messageId: 991, status: "published", renderedBusinessDate: "2026-08-21", lastErrorCode: null, publishedAt: createdAt, updatedAt: createdAt }],
          memberVerifications: [{ id: "verify-preview", groupTitle: "AVANFINITY 用户群", displayName: "新成员", status: "pending", attempts: 0, answered: false, answeredAt: null, approvalPending: false, retryCount: 0, lastErrorCode: null, releaseOutcome: null, manualPassed: false, expiresAt: "2026-08-21T12:05:00Z", createdAt, updatedAt: createdAt, completedAt: null }],
        } });
        if (path === "/api/admin/cards" || path === "/api/admin/financial-events") {
          return json(res, { code: 0, data: { total: 0, page: 1, pageSize: 50, list: [] } });
        }
        if (path === "/api/admin/deposits") {
          return json(res, { code: 0, data: { total: 1, page: 1, pageSize: 50, serverTime: createdAt, list: [{
            gatewayRef: "dep-preview-1", userId: 7, email: "customer@example.com", currency: "USDT", network: "TRON",
            requestedAmount: "50.0000", expectedAmount: "50.1234", actualAmount: "50.1234", creditedAmount: "50.1234",
            status: "confirmed", createdAt, expiredAt: createdAt, reservedUntil: null, confirmedAt: createdAt,
          }] } });
        }
        json(res, { error: "style preview mock has no handler", path }, 404);
      });
    },
  };
}
