import { test, expect, type Locator, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import type { AdminUserDetail, DepositSettings } from "../src/api";
import { formatDecimal, formatRateAsPercent, shiftDecimal } from "../src/decimal";
import { normalizeInviteCode, referralCodeFromUrl } from "../src/referralAttribution";
import { adminCustomerReturnPath, parseAdminCustomerReturnPath } from "../src/adminCustomerReturnPath";
import { GPT_SESSION_FILE_MAX_BYTES, gptBatchConcurrency, parseGptMailboxBatch, parseGptSessionBatch, runGptBatch } from "../src/gptBatch";
import { extractGptSession } from "../src/gptSession";
import { fundingAmount, fundingCovered, fundingTotal } from "../src/gptCardFunding";

const tronAssetId = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const bscAssetId = "0x55d398326f99059fF775485246999027B3197955";
const solAssetId = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

test("decimal display trims padding without rounding or changing identifiers", () => {
  for (const [input, expected] of [
    ["0.0000", "0"], ["100.0000", "100"], ["0.2000", "0.2"],
    ["12.340500", "12.3405"], ["0.00003700", "0.000037"],
    ["-10.0100", "-10.01"], ["-0.0000", "0"],
    ["12345678901234567890.1234500", "12345678901234567890.12345"],
    ["001234", "001234"], ["12/29", "12/29"], ["", ""], ["—", "—"],
  ]) expect(formatDecimal(input)).toBe(expected);
  expect(formatDecimal(null)).toBe("—");
  expect(formatDecimal(0)).toBe("0");
  expect(formatRateAsPercent("0.00003700")).toBe("0.0037%");
});

function decimalUnits(value: string, scale: number) {
  const sign = value.startsWith("-") ? -1n : 1n;
  const [whole, fraction = ""] = value.replace(/^[+-]/, "").split(".");
  return sign * (BigInt(whole) * 10n ** BigInt(scale) + BigInt((fraction + "0".repeat(scale)).slice(0, scale)));
}

function fixed4(value: bigint) {
  return `${value / 10_000n}.${(value % 10_000n).toString().padStart(4, "0")}`;
}

function ceilRate4(amountUnits: bigint, rate: string) {
  const rateUnits = decimalUnits(rate, 6);
  return (amountUnits * rateUnits + 999_999n) / 1_000_000n;
}

function setE2eAdminTelegramBinding(bound: boolean) {
  expect(process.env.E2E_DATABASE_URL).toBeTruthy();
  const sql = bound
    ? `INSERT INTO telegram_bindings
       (user_id,chat_id,username,bind_code,expires_at,verified_at,telegram_user_id,login_enabled)
       SELECT id,'990000001','e2e_admin','EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE',
              now()+interval '10 minutes',now(),990000001,true
       FROM users WHERE email='admin@danewcard.local'
       ON CONFLICT(user_id) DO UPDATE SET chat_id=EXCLUDED.chat_id,
         username=EXCLUDED.username,bind_code=EXCLUDED.bind_code,
         expires_at=EXCLUDED.expires_at,verified_at=EXCLUDED.verified_at,
         telegram_user_id=EXCLUDED.telegram_user_id,login_enabled=true`
    : `DELETE FROM telegram_bindings WHERE user_id=(
         SELECT id FROM users WHERE email='admin@danewcard.local')`;
  execFileSync("psql", [process.env.E2E_DATABASE_URL!, "-v", "ON_ERROR_STOP=1", "-c", sql],
    { stdio: "ignore" });
}

async function moneySnapshot(page: Page, type: string) {
  const [walletResponse, ledgerResponse] = await Promise.all([
    page.request.get("/api/wallet"),
    page.request.get("/api/wallet/transactions?page_size=100"),
  ]);
  expect(walletResponse.status()).toBe(200);
  expect(ledgerResponse.status()).toBe(200);
  const wallet = await walletResponse.json();
  const ledger = await ledgerResponse.json();
  return {
    balance: decimalUnits(wallet.data.balance, 4),
    entries: (ledger.data.list as Array<{ id: number; type: string; amount: string }>).filter((entry) => entry.type === type),
  };
}

async function mockAuthenticatedShell(page: Page, role = "admin") {
  await page.addInitScript(() => {
    localStorage.setItem("session", JSON.stringify({ token: "", email: "admin@danewcard.local" }));
  });
  await page.route("**/api/features", (route) => route.fulfill({ json: { code: 0, data: {
    version: 1, registration: true, walletTransfer: true, cardOpening: true, cardRecharge: true, cardManagement: true, cardDelete: true,
    gptDirect: true, gptCdk: true, deposits: true, rewards: true, agent: true, market: true,
    developerApi: true, telegram: true,
  } } }));
  await page.route("**/api/dashboard", (route) => route.fulfill({ json: {
    email: "admin@danewcard.local", role, walletBalance: "0.0000", cardBalance: "0.0000",
    cardCount: 0, inviteCode: "DANEW",
  } }));
  await page.route("**/api/announcements/unread", (route) => route.fulfill({ json: {
    code: 0, data: [], unreadCount: 0,
  } }));
}

async function mockRecentAuthLogin(page: Page) {
  await page.route("**/api/auth/captcha", (route) => route.fulfill({ json: { code: 0, data: { required: false, id: null, image: null, expiresIn: 0 } } }));
  await page.route("**/api/auth/login", (route) => route.fulfill({ json: {
    token: "", email: "admin@danewcard.local", role: "admin", mfaLevel: "password", mfaEnrollmentRequired: false,
  } }));
}

test("money display preserves small balances and editable decimal input", async ({ page }) => {
  await mockAuthenticatedShell(page);
  await page.route("**/api/wallet", route => route.fulfill({ json: { code: 0, data: {
    balance: "123.450000", lockedBalance: "0.00003700", spendableBalance: "123.44996300",
    promoBalance: "0.0000", cumulativeDeposit: "123.45", cumulativeSpend: "0",
  } } }));
  await page.route("**/api/wallet/transactions", route => route.fulfill({ json: { code: 0, data: { total: 0, list: [] } } }));
  await page.goto("/finance");
  const balances=page.getByTestId("wallet-balance-summary");
  await expect(balances).toContainText("$123.45");
  await expect(balances).toContainText("$0.000037");
  await expect(balances).toContainText("$123.449963");
  await expect(balances).not.toContainText("123.450000");
  await mockAdminWorkspace(page);
  await page.goto("/admin");
  await page.getByTestId("admin-nav-tiers").click();
  const rate=page.getByTestId("pricing-tier-none").getByLabel("本站保底充值费率", {exact:true});
  await expect(rate).toHaveValue("0");
  await rate.fill("0.0100");
  await expect(rate).toHaveValue("0.0100");
});


type E2eProduct = {
  productCode: string;
  network: string;
  openFee: string;
  rechargeRate: string;
  openQuoteVersion: string;
  minAmount: string;
  maxAmount: string;
};

async function firstAvailableProduct(page: Page) {
  let products: E2eProduct[] = [];
  await expect.poll(async () => {
    const response = await page.request.get("/api/products");
    if (response.status() !== 200) return 0;
    products = (await response.json()).data;
    return products.length;
  }, { timeout: 15_000 }).toBeGreaterThan(0);
  return products[0];
}

async function syncFundingRate(page: Page) {
  const response = await page.request.post("/api/admin/upstreams/spacex/test", {
    headers: { "idempotency-key": `referral-rate-${Date.now()}-${Math.random()}` },
  });
  expect(response.status()).toBe(200);
}

async function mockAdminWorkspace(page: Page, options: {
  onCdkPricing?: (body: Record<string, unknown>, idempotencyKey: string) => void;
  onCdkIssue?: (body: Record<string, unknown>, idempotencyKey: string) => void;
  onQuoteRefresh?: (body: Record<string, unknown>) => void;
  onQuoteRefreshDelete?: () => void;
  quoteRefreshRecentAuth?: boolean;
  onTierProfile?: (body: Record<string, unknown>, idempotencyKey: string) => void;
  cardPending?: boolean;
  cardStatus?: "ACTIVE" | "FROZEN";
  onCardDelete?: (idempotencyKey: string) => void;
  onCardUnfreeze?: (idempotencyKey: string) => void;
  pendingFirstCardUnfreeze?: boolean;
  onAdminDepositsRequest?: (url: string) => void;
  onCustomerCardTransactions?: () => void;
  onCustomerFinancialRequest?: (url: string) => void;
  onCustomerSpendingRequest?: (url: string) => void;
  onCustomerAuditRequest?: (url: string) => void;
  onTelegramCommand?: (body: Record<string, unknown>, idempotencyKey: string) => void;
  onAdminAnnouncementCommand?: (body: Record<string, unknown>, idempotencyKey: string) => void;
  failFirstAdminAnnouncement?: boolean;
  onAdminLotteryCommand?: (body: Record<string, unknown>, idempotencyKey: string) => void;
  onAdminLotteryParticipantsRequest?: (url: string) => void;
  onReferralPolicyPreview?: (body: Record<string, unknown>) => void;
  onReferralPolicyApply?: (body: Record<string, unknown>, idempotencyKey: string) => void;
  failFirstReferralPolicyApply?: boolean;
  lotteryCompletesOnPoll?: boolean;
  customerRisk?: AdminUserDetail["risk"];
  customerStatus?: string;
  customerRiskHold?: boolean;
  telegramOnlyAdminRecords?: boolean;
  onCustomerRiskAction?: (body: Record<string, unknown>, idempotencyKey: string) => void;
  onCustomerListRequest?: (url: string) => void;
  onCustomerProfileAction?: (body: Record<string, unknown>, idempotencyKey: string) => void;
  onCustomerPasswordReset?: (body: Record<string, unknown>) => void;
  onCustomerSensitive?: () => void;
  customerProfileRecentAuth?: boolean;
  customerSensitiveRecentAuth?: boolean;
  gptMoneyOperation?: boolean;
} = {}) {
  const now = new Date().toISOString();
  const lotteryEndsAt = new Date(Date.now() + 86_400_000).toISOString();
  const customerRisk = options.customerRisk ?? { holdReasons: [], owedCharges: { count: 0, total: "0.0000", byKind: [] } };
  let adminCardStatus = options.cardStatus ?? "ACTIVE";
  let adminCardUnfreezeAttempts = 0;
  const telegramOnlyAdminRecords = options.telegramOnlyAdminRecords ?? false;
  let lotteryGetCount = 0;
  let customerProfileAttempts = 0;
  let customerSensitiveAttempts = 0;
  let quoteRefreshAttempts = 0;
  let quoteRefreshConfigured = false;
  let quoteRefreshEnabled = false;
  let quoteRefreshInterval = 60;
  let memberVerificationGetCount = 0;
  let memberPassQueued = false;
  let memberPassGetCount = 0;
  await page.route("**/api/admin/users/7/detail", (route) => route.fulfill({ json: { code: 0, data: {
    profile: { id: 7, email: telegramOnlyAdminRecords ? null : "customer@example.com", role: "user", status: options.customerStatus ?? "active", inviteCode: "INVITE7", riskHold: options.customerRiskHold ?? false,
      cumulativeRecharge: "80.2500", walletBalance: "31.5000", lockedBalance: "6.3000", spendableBalance: "25.2000", promoBalance: "2.7500", createdAt: now, updatedAt: now,
      emailVerifiedAt: now, emailLoginAvailable: !telegramOnlyAdminRecords, inviter: { id: 6, email: "inviter@example.com" }, telegram: { bound: true, username: "customer_tg", verifiedAt: now }, membership: { code: "none", nameZh: "普通会员", nameEn: "Standard", descriptionZh: "", descriptionEn: "", thresholdAmount: "0.0000" } },
    directReferrals: { total: 1, limit: 100, list: [{ id: 8, email: telegramOnlyAdminRecords ? null : "friend@example.com", status: "active", memberTier: "super", createdAt: now,
      earned: "1.2500", openCardEarned: "0.2500", rechargeEarned: "1.0000" }] },
    earnings: { total: 2, limit: 100, list: [
      { id: 11, type: "open_card_bonus", amount: "0.2500", balanceBefore: "0.0000", balanceAfter: "0.2500", remark: "Direct referral card reward", createdAt: now, refUserId: 8, refUserEmail: "friend@example.com" },
      { id: 12, type: "card_recharge_rebate", amount: "1.0000", balanceBefore: "0.2500", balanceAfter: "1.2500", remark: "Direct referral recharge reward", createdAt: now, refUserId: 8, refUserEmail: "friend@example.com" },
    ] },
    cards: { total: 1, limit: 100, list: [{ id: 71, cardNumberMasked: "•••• •••• •••• 0910", productCode: "P5378OX", network: "MASTERCARD", issuingArea: "US", issuer: "AI virtual card",
      status: "ACTIVE", balance: "21.0000", firstName: "Ada", lastName: "Lovelace", createdAt: now, updatedAt: now, cardNumber: "5450200000900910", cvv: "665" }] },
    deposits: { total: 1, limit: 100, list: [{ gatewayRef: "00000000-0000-0000-0000-000000000091", currency: "USDT", network: "SOL", status: "confirmed", requestedAmount: "10.0000", orderAmount: "10.0345", actualAmount: "10.0345",
      creditedAmount: "10.0345", transactionHashMasked: "5xZk…pQ91", createdAt: now, confirmedAt: now }] },
    operations: { total: 2, limit: 100, list: [
      { id: "00000000-0000-0000-0000-000000000071", type: "OPEN_CARD", status: "SUCCEEDED", cardId: null, openedCardIds: [71], amount: "10.0000", fee: "0.5000", customerCharge: "10.5000", totalAmount: "10.5000", createdAt: now, completedAt: now, upstreamCost: "9999.0000" },
      { id: "00000000-0000-0000-0000-000000000072", type: "RECHARGE", status: "SUCCEEDED", cardId: 71, openedCardIds: [], amount: "20.0000", fee: "0.2000", customerCharge: "20.2000", totalAmount: "20.2000", createdAt: now, completedAt: now, upstreamCost: "9999.0000" },
    ] },
    risk: { ...customerRisk, paymentPerformance: customerRisk.paymentPerformance ?? {
      enabled: true, windowDays: 30, minAttempts: 100, lockThresholdBps: 3000, releaseThresholdBps: 2000,
      reserveBps: 2000, attempts: 120, successes: 84, declines: 36, successRateBps: 7000,
      declineRateBps: 3000, reserveActive: true, evaluatedAt: now,
    } },
  } } }));
  await page.route("**/api/admin/users/7/cards/71/transactions*", (route) => {
    options.onCustomerCardTransactions?.();
    const event = {
      id: 701, type: "Settlement", status: "COMPLETE", authAmount: "19.9900", settleAmount: "19.9900",
      authCurrency: "USD", settleCurrency: "USD", merchantAmount: "19.9900", merchantCurrency: "USD",
      description: "ChatGPT subscription", billStatus: null, failedReason: null, source: "webhook", channel: null,
      authTime: now, sourceCreatedAt: null,
    };
    return route.fulfill({ json: { code: 0, data: {
      total: 1, page: 1, pageSize: 100, source: "db",
      list: [{ ...event, merchantName: "OPENAI", createdAt: now }],
      grouped: { total: 1, page: 1, pageSize: 100, list: [{
        providerId: 1, cardId: 71, cardNumberMasked: "•••• •••• •••• 0910", cardStatus: "ACTIVE",
        authId: "auth-admin-71", status: "SETTLED", merchantName: "OPENAI", description: "ChatGPT subscription",
        merchantLocation: null, merchantRegion: null, merchantCountry: null, failedReason: null, billStatus: null,
        source: "webhook", channel: null, authorizedAmount: "19.9900", settledAmount: "19.9900",
        refundedAmount: "0.0000", authCurrency: "USD", settleCurrency: "USD", merchantAmount: "19.9900",
        merchantCurrency: "USD", occurredAt: now, events: [event],
      }] },
      financialSummary: {
        availableBalance: "21.0000", openingPrincipal: "1.0000", rechargePrincipal: "20.0000",
        totalPrincipalIn: "21.0000", walletDebited: "21.5000", walletRefunded: "0.0000",
        totalCardOut: "19.9900", platformFees: "0.5000", settledSpend: "19.9900",
        merchantRefunds: "0.0000", heldAmount: "0.0000", transactionCount: 1,
        declineCount: 0, declineRateBps: 0,
      },
      openAiPerformance: null,
      card: {
        id: 71, providerId: 1, upstreamCardId: "upstream-card-71", vmCardId: "vm-card-71",
        cardNumberMasked: "•••• •••• •••• 0910", productCode: "P5378OX", network: "MASTERCARD",
        issuingArea: "US", issuer: "AI virtual card", status: "ACTIVE", balance: "21.0000",
        firstName: "Ada", lastName: "Lovelace", note: "", expiry: "12/29", createdAt: now,
        updatedAt: now, upstreamCreatedAt: now, upstreamSyncedAt: now, upstreamPayloadUpdatedAt: now,
        pendingOperationId: null, feePolicy: {}, billingAddress: {
          addressLineOne: "1 Admin Test Way", addressLineTwo: "", city: "Austin", state: "TX", country: "US", postCode: "78701",
        }, upstreamPayload: {},
      },
    } } });
  });
  await page.route("**/api/admin/users/7/cards/71/sensitive", (route) => {
    customerSensitiveAttempts += 1;
    options.onCustomerSensitive?.();
    if (options.customerSensitiveRecentAuth && customerSensitiveAttempts === 1) {
      return route.fulfill({ status: 403, json: { error: "请重新认证后继续敏感操作", errorCode: "RECENT_AUTH_REQUIRED" } });
    }
    return route.fulfill({ headers: { "cache-control": "no-store, private" }, json: { code: 0, data: {
      cardNumber: "4111111111110910", cvv: "910", expire: "12/29", cardAddress: {
        addressLineOne: "1 Admin Test Way", addressLineTwo: "", city: "Austin", state: "TX", country: "US", postCode: "78701",
      },
    } } });
  });
  await page.route("**/api/admin/users/7/profile", (route) => {
    customerProfileAttempts += 1;
    options.onCustomerProfileAction?.(
      route.request().postDataJSON() as Record<string, unknown>,
      route.request().headers()["idempotency-key"] ?? "",
    );
    if (options.customerProfileRecentAuth && customerProfileAttempts === 1) {
      return route.fulfill({ status: 403, json: { error: "请重新认证后继续敏感操作", errorCode: "RECENT_AUTH_REQUIRED" } });
    }
    return route.fulfill({ json: { code: 0, data: {}, replayed: false } });
  });
  await page.route("**/api/admin/users/7/password/reset", (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    options.onCustomerPasswordReset?.(body);
    return route.fulfill({ json: { code: 0, msg: "客户密码已重置，所有登录会话已失效" } });
  });
  await page.route("**/api/admin/users/6/detail", (route) => route.fulfill({ json: { code: 0, data: {
    profile: { id: 6, email: "inviter@example.com", role: "user", status: "active", inviteCode: "INVITE6", riskHold: false,
      cumulativeRecharge: "0.0000", walletBalance: "0.0000", promoBalance: "0.0000", createdAt: now, updatedAt: now,
      emailVerifiedAt: now, emailLoginAvailable: true, inviter: null, telegram: { bound: true, username: "inviter_tg", verifiedAt: now }, membership: { code: "none", nameZh: "普通会员", nameEn: "Standard", descriptionZh: "", descriptionEn: "", thresholdAmount: "0.0000" } },
    directReferrals: { total: 0, limit: 100, list: [] }, earnings: { total: 0, limit: 100, list: [] },
    cards: { total: 0, limit: 100, list: [] }, deposits: { total: 0, limit: 100, list: [] }, operations: { total: 0, limit: 100, list: [] },
    risk: { holdReasons: [], owedCharges: { count: 0, total: "0.0000", byKind: [] } },
  } } }));
  await page.route("**/api/admin/users?*", (route) => {
    options.onCustomerListRequest?.(route.request().url());
    return route.fulfill({ json: { code: 0, data: { total: 1, page: 1, pageSize: 20, list: [{
      id: 7, email: telegramOnlyAdminRecords ? null : "customer@example.com", role: "customer", status: "active", memberTier: "none", walletBalance: "31.5000",
      promoBalance: "2.7500", cumulativeRecharge: "80.2500", inviteCode: "INVITE7", cardCount: 1, activeCardCount: 1, referralCount: 1, riskHold: options.customerRiskHold ?? false, createdAt: now,
      telegram: { bound: true, username: "customer_tg", verifiedAt: now },
    }] } } });
  });
  await page.route("**/api/admin?**", (route) => route.fulfill({ json: { code: 0, data: { total: 1, list: [{
    id: 7, email: telegramOnlyAdminRecords ? null : "customer@example.com", role: "user", status: "active", memberTier: "none", walletBalance: "31.5000",
    promoBalance: "2.7500", cumulativeRecharge: "80.2500", inviteCode: "INVITE7", cardCount: 1, createdAt: now,
    telegram: { bound: true, username: "customer_tg", verifiedAt: now },
  }] } } }));
  await page.route("**/api/admin", (route) => {
    if (route.request().method() === "PATCH") {
      options.onCustomerRiskAction?.(
        route.request().postDataJSON() as Record<string, unknown>,
        route.request().headers()["idempotency-key"] ?? "",
      );
      return route.fulfill({ json: { code: 0, msg: "updated" } });
    }
    return route.fulfill({ json: { code: 0, data: {
      userCount: 1, activeCardCount: 0, platformWalletTotal: "0.0000",
      depositCurrency: "USDT", customerCumulativeDepositTotal: "20.127937",
      confirmedDepositTotal: "20.127937", confirmedDepositCount: 2,
      pendingDepositTotal: "7.000321", pendingDepositCount: 1,
    } } });
  });
  await page.route("**/api/admin/telegram", (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      options.onTelegramCommand?.(
        body,
        route.request().headers()["idempotency-key"] ?? "",
      );
      if (body.action === "member_verification_pass") {
        memberPassQueued = true;
        return route.fulfill({ json: { code: 0, data: { status: "queued" }, replayed: false } });
      }
      return route.fulfill({ json: { code: 0, data: {}, replayed: false } });
    }
    memberVerificationGetCount += 1;
    if (memberPassQueued) memberPassGetCount += 1;
    const memberPassed = memberPassQueued && memberPassGetCount > 1;
    const memberAnswered = memberPassQueued || memberVerificationGetCount > 1;
    return route.fulfill({ json: { code: 0, data: {
      configured: true, featureEnabled: true, botName: "avafinity_bot",
      internalCredential: "telegram-secret-must-not-render",
      stats: { usersTotal: 128, active24h: 9, active7d: 31, active30d: 72, boundUsers: 54, successfulLogins30d: 21, managedGroups: 1, pendingJoinRequests: 2, failedJoinRequests: 0, pendingMemberVerifications: 1, failedMemberVerifications: 0 },
      health: { status: "healthy", lastCompletedUpdateAt: now, lastHealthCheckAt: now, pendingUpdates: null, botCanReceiveUpdates: true },
      groups: [{ chatId: "-1001234567890", title: "Avanfinity Community", status: "active", enabled: true, lotteryEnabled: true,
        joinVerificationEnabled: false, memberVerificationEnabled: false, verificationTtlSeconds: 600, botIsAdmin: true, canInviteUsers: true,
        checkinReportMode: "off", checkinReportTime: "20:00", checkinReportIntervalMinutes: 0,
        checkinReportNextAt: null, checkinReportLastSentAt: null,
        canDeleteMessages: true, canRestrictMembers: true, pendingJoinRequests: 2, failedJoinRequests: 0, pendingMemberVerifications: 1, failedMemberVerifications: 0, updatedAt: now }],
      memberVerifications: [
        { id: "11111111-1111-4111-8111-111111111111", groupTitle: "Avanfinity Community", displayName: "New member",
          status: memberPassed ? "passed" : memberPassQueued ? "releasing" : "pending", attempts: 1,
          answered: memberAnswered, answeredAt: memberAnswered ? now : null,
          approvalPending: memberPassQueued && !memberPassed, retryCount: memberPassQueued && !memberPassed ? 1 : 0,
          lastErrorCode: memberPassQueued && !memberPassed ? "release_failed" : null,
          releaseOutcome: memberPassQueued ? "passed" : null, manualPassed: memberPassQueued,
          expiresAt: now, createdAt: now, updatedAt: now, completedAt: memberPassed ? now : null },
        { id: "22222222-2222-4222-8222-222222222222", groupTitle: "Avanfinity Community", displayName: "Historical member",
          status: "released", attempts: 0, answered: true, answeredAt: null, approvalPending: false, retryCount: 0,
          lastErrorCode: null, releaseOutcome: "released", manualPassed: false,
          expiresAt: now, createdAt: now, updatedAt: now, completedAt: now },
      ],
      lotteryActivities: [
        { id: 41, title: "August community draw", status: "open", participantCount: 18, winnerCount: 0, participationMode: "free", costPoints: 0, requiredDirectReferrals: 0 },
        { id: 42, title: "July community draw", status: "closed", participantCount: 21, winnerCount: 2, participationMode: "direct_referrals", costPoints: 0, requiredDirectReferrals: 3 },
      ],
      publications: [
        { id: 51, activityId: 42, chatId: "-1001234567890", messageId: "901", status: "published", publishedAt: now, resultsPublishedAt: null },
        { id: 52, activityId: 41, chatId: "-1001234567890", messageId: null, status: "failed", publishedAt: null, resultsPublishedAt: null },
      ],
      checkinPublications: [
        { id: 61, chatId: "-1001234567890", messageId: 902, status: "published", renderedBusinessDate: "2026-08-13", lastErrorCode: null, publishedAt: now, updatedAt: now },
      ],
    } } });
  });
  await page.route("**/api/admin/announcements*", (route) => {
    if (route.request().method() === "POST") {
      options.onAdminAnnouncementCommand?.(
        route.request().postDataJSON() as Record<string, unknown>,
        route.request().headers()["idempotency-key"] ?? "",
      );
      if (options.failFirstAdminAnnouncement) {
        options.failFirstAdminAnnouncement = false;
        return route.fulfill({ status: 503, json: { error: "temporary" } });
      }
      return route.fulfill({ json: { code: 0, data: { id: 81 }, replayed: false } });
    }
    return route.fulfill({ json: { code: 0, data: { total: 1, page: 1, pageSize: 20, list: [{
      id: 81, title: "Telegram notice", content: "A group copy is queued.", isPinned: false, isActive: true, readCount: 0, createdAt: now,
      telegramDelivery: { chatId: "-1001234567890", groupTitle: "Avanfinity Community", status: "pending", sentAt: null, lastErrorCode: null },
    }] } } });
  });
  await page.route("**/api/admin/telegram/bindings?*", (route) => {
    const url = new URL(route.request().url());
    const pageNumber = Number(url.searchParams.get("page") ?? "1");
    const list = pageNumber === 1
      ? [{ userId: 7, email: "customer@example.com", memberTier: "none", status: "active", telegramUsername: "customer_tg", verifiedAt: now }]
      : [{ userId: 6, email: "inviter@example.com", memberTier: "super", status: "active", telegramUsername: "inviter_tg", verifiedAt: now }];
    return route.fulfill({ json: { code: 0, data: { total: 21, page: pageNumber, pageSize: 20, list } } });
  });
  await page.route("**/api/admin/lottery", (route) => {
    if (route.request().method() === "POST") {
      options.onAdminLotteryCommand?.(
        route.request().postDataJSON() as Record<string, unknown>,
        route.request().headers()["idempotency-key"] ?? "",
      );
      return route.fulfill({ json: { code: 0, data: {}, replayed: false } });
    }
    lotteryGetCount += 1;
    const retryCompleted = options.lotteryCompletesOnPoll && lotteryGetCount > 1;
    return route.fulfill({ json: { code: 0, data: {
      marketingBudget: "500.0000",
      checkinSettings: { enabled: true, basePoints: 5, streakBonusPerDay: 2, streakBonusCapDays: 7, version: 3 },
      activities: [
        { id: 41, title: "August community draw", description: "Free community campaign", status: "open", participationMode: "free", costPoints: 0, requiredDirectReferrals: 0, maxTicketsPerUser: 1, prizes: [{ label: "$5", qty: 1, type: "balance", value: "5.00" }], participantCount: 18, winnerCount: 0, createdAt: now, endsAt: lotteryEndsAt, drawStartedAt: null, drawCompletedAt: null, drawAttempts: 0, drawNextRetryAt: null, drawLastErrorCode: null, drawState: "scheduled" },
        { id: 42, title: "Referral campaign", description: "Invite friends", status: "closed", participationMode: "direct_referrals", costPoints: 0, requiredDirectReferrals: 3, maxTicketsPerUser: 1, prizes: [{ label: "$10", qty: 1, type: "balance", value: "10.00" }], participantCount: 21, winnerCount: 2, createdAt: now, endsAt: lotteryEndsAt, drawStartedAt: now, drawCompletedAt: now, drawAttempts: 1, drawNextRetryAt: null, drawLastErrorCode: null, drawState: "completed" },
        { id: 43, title: "Retrying draw", description: "Automatic retry", status: retryCompleted ? "closed" : "drawing", participationMode: "points", costPoints: 10, requiredDirectReferrals: 0, maxTicketsPerUser: 1, prizes: [{ label: "$15", qty: 1, type: "balance", value: "15.00" }], participantCount: 9, winnerCount: retryCompleted ? 1 : 0, createdAt: now, endsAt: now, drawStartedAt: now, drawCompletedAt: retryCompleted ? now : null, drawAttempts: 2, drawNextRetryAt: retryCompleted ? null : lotteryEndsAt, drawLastErrorCode: retryCompleted ? null : "marketing_budget_insufficient", drawState: retryCompleted ? "completed" : "retrying" },
      ],
    } } });
  });
  await page.route("**/api/admin/lottery/*/participants?*", (route) => {
    options.onAdminLotteryParticipantsRequest?.(route.request().url());
    const pageNumber = Number(new URL(route.request().url()).searchParams.get("page") ?? "1");
    const list = pageNumber === 1
      ? [{ userId: 7, email: telegramOnlyAdminRecords ? null : "customer@example.com", tickets: 1, joinedAt: now, tier: "普通会员", telegramBound: true, eligibleDirectReferrals: 2, eligibleForDraw: false }]
      : [{ userId: 6, email: "inviter@example.com", tickets: 2, joinedAt: now, tier: "SVIP", telegramBound: true, eligibleDirectReferrals: 3, eligibleForDraw: true }];
    const activityId = Number(route.request().url().match(/lottery\/(\d+)\/participants/)?.[1] ?? "0");
    return route.fulfill({ json: { code: 0, data: { activityId, total: 21, page: pageNumber, pageSize: 20, list } } });
  });
  await page.route("**/api/admin/marketing/deferred", (route) => route.fulfill({ json: { code: 0, data: telegramOnlyAdminRecords
    ? [{ id: 91, userId: 7, email: null, amount: "1.0000", type: "referral", createdAt: now }]
    : [] } }));
  await page.route("**/api/admin/upstreams", (route) => route.fulfill({ json: { code: 0, data: [{
    code: "future", name: "Future Provider", environment: "production", enabled: false, priority: 10,
    runtimeActive: false, configured: false, writeEnabled: false, credentialSource: "environment",
    credentialMask: "", credentialVersion: 0, upstreamTier: null, upstreamRechargeRate: null,
    lastHealthAt: null, lastProductSyncAt: null, lastBalanceSyncAt: null, lastError: null, version: 0,
    balance: null, spendableBalance: null, reserveAmount: null, currency: null,
  }, {
    code: "spacex", name: "SpaceX Card", environment: "sandbox", enabled: true, priority: 100,
    runtimeActive: true, configured: true, writeEnabled: false,
    credentialSource: "environment", credentialMask: "sha256:abcd1234ef56", credentialVersion: 1,
    upstreamTier: "eternal", upstreamRechargeRate: "0.004000", lastHealthAt: now,
    lastProductSyncAt: now, lastBalanceSyncAt: now,
    lastError: null, version: 1, balance: "120.0000", spendableBalance: "100.0000",
    reserveAmount: "20.0000", currency: "USD",
  }] } }));
  await page.route("**/api/admin/upstreams/spacex", (route) => route.fulfill({ json: { code: 0, data: {
    code: "spacex", enabled: true, priority: 100, version: 2,
  }, replayed: false } }));
  await page.route("**/api/admin/upstreams/spacex/balance", (route) => route.fulfill({ json: { code: 0, data: {
    balance: "120.0000", spendableBalance: "100.0000", reserveAmount: "20.0000",
    reserveEnabled: true, currency: "USD", fetchedAt: "2026-08-01T08:02:00Z",
  } } }));
  await page.route("**/api/admin/upstreams/spacex/balance-logs?**", (route) => route.fulfill({ json: { code: 0, data: [{
    id: 1, type: "open_card", amount: "-10.4000", before: "120.4000", after: "110.0000",
    remark: "Opening P5378OX · card •••• 9090", occurredAt: now, matchStatus: "MATCHED",
    operationId: "00000000-0000-0000-0000-000000000001",
  }], pagination: { total: 1, page: 1, pageSize: 50 } } }));
  await page.route("**/api/admin/upstreams/spacex/test", (route) => route.fulfill({ json: { code: 0, data: {
    connected: true, balance: "120.0000", spendableBalance: "100.0000", reserveAmount: "20.0000", currency: "USD", tier: "eternal",
  } } }));
  await page.route("**/api/admin/products", (route) => route.fulfill({ json: { code: 0, data: [{
    productCode: "P5378OX", issuer: "SpaceX", network: "VISA", issuingArea: "US", cardType: "Virtual",
    openFee: "0.4000", rechargeRate: "0.005000", refundRate: "0.125000", minAmount: "10.0000", maxAmount: "10000.0000",
    description: "Upstream virtual card", category: "AI subscriptions / Advertising",
    active: true, version: 1, createdAt: "2026-08-01T08:00:00Z", updatedAt: "2026-08-01T08:01:00Z",
    providerCode: "spacex", upstreamProductCode: "P5378OX", costOpenFee: "0.4000",
    costRechargeRate: "0.005000", costRtfRate: "0.100000", upstreamAvailable: true,
    upstreamEnabled: true, upstreamCanOpen: true, upstreamSort: 300,
    upstreamMetadata: { network: "VISA", card_group: "P5378OX", bin_heads: ["537872"], usage_policy: { can_open: true } },
    costVersion: 2, costSyncedAt: now, restrictedMerchants: ["CRYPTO_EXCHANGE"], googleChatgptBlocked: true,
    upstreamDescription: "Upstream virtual card", upstreamCategory: "AI subscriptions / Advertising", descriptionOverride: null, categoryOverride: null,
  }] } }));
  let referralPolicy = {
    calculationMode: "confirmed_profit_share" as const, profitShareRate: "0.500000", displayMode: "equivalent" as const, version: 1,
    tiers: [{ code: "none", nameZh: "普通会员", nameEn: "Standard", openingBaseReward: { min: "0.6000", max: "0.6000" }, rechargeRewardRate: { min: "0.010000", max: "0.010000" } }],
  };
  await page.route("**/api/admin/pricing", (route) => route.fulfill({ json: { code: 0, data: { tiers: [{
    code: "none", nameZh: "普通会员", nameEn: "Standard", descriptionZh: "可靠的日常支付起点", descriptionEn: "A reliable starting point for daily payments", thresholdAmount: "0.0000", openMultiplier: "1.2500",
    minimumOpenFee: "0.0000", rechargeMultiplier: "1.250000", minimumRechargeRate: "0.000000",
    referralOpenReward: "0.2000", referralRechargeRate: "0.002000", declineFee: "0.0000", refundMultiplier: "1.250000",
    gptDirectMultiplier: "1.250000", gptDirectMinimumFee: "1.0000", version: 1,
  }], overrides: [], referralPolicy } } }));
  await page.route("**/api/admin/referral-policy/preview", (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    options.onReferralPolicyPreview?.(body);
    return route.fulfill({ json: { code: 0, data: { ...referralPolicy, profitShareRate: body.profitShareRate, displayMode: body.displayMode,
      tiers: [{ code: "none", nameZh: "普通会员", nameEn: "Standard", openingBaseReward: { min: "0.7200", max: "0.7200" }, rechargeRewardRate: { min: "0.012000", max: "0.012000" } }],
    } } });
  });
  let referralPolicyApplyCount = 0;
  let committedReferralPolicyKey = "";
  await page.route("**/api/admin/referral-policy", (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    const key = route.request().headers()["idempotency-key"] ?? "";
    referralPolicyApplyCount += 1;
    options.onReferralPolicyApply?.(body, key);
    const replayed = committedReferralPolicyKey === key;
    if (!replayed) referralPolicy = { ...referralPolicy, profitShareRate: String(body.profitShareRate), displayMode: body.displayMode as "equivalent", version: referralPolicy.version + 1 };
    if (options.failFirstReferralPolicyApply && referralPolicyApplyCount === 1) {
      committedReferralPolicyKey = key;
      return route.fulfill({ status: 503, json: { error: "策略保存结果暂时未知，请重试" } });
    }
    return route.fulfill({ json: { code: 0, data: referralPolicy, replayed } });
  });
  await page.route("**/api/admin/membership-tiers/*", (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    options.onTierProfile?.(body, route.request().headers()["idempotency-key"] ?? "");
    return route.fulfill({ json: { code: 0, data: { tier: { code: "none" }, promotedUsers: 0 }, replayed: false } });
  });
  await page.route("**/api/admin/cards?**", (route) => route.fulfill({ json: { code: 0, data: {
    total: 1, page: 1, pageSize: 100, list: [{ id: 1, email: telegramOnlyAdminRecords ? null : "masked@example.com", cardNumberMasked: "4242 **** **** 9090",
      productCode: "P5378OX", provider: "spacex", status: adminCardStatus, balance: "15.0000",
      upstreamCardId: "upstream-card-12345678", pendingOperationId: options.cardPending === false ? null : "00000000-0000-0000-0000-000000000002", createdAt: now }],
  } } }));
  await page.route("**/api/admin/cards/1/delete", (route) => {
    options.onCardDelete?.(route.request().headers()["idempotency-key"] ?? "");
    return route.fulfill({ json: { code: 0, data: { operationId: "00000000-0000-0000-0000-000000000099", status: "SUCCEEDED" } } });
  });
  await page.route("**/api/admin/cards/1/unfreeze", (route) => {
    adminCardUnfreezeAttempts += 1;
    options.onCardUnfreeze?.(route.request().headers()["idempotency-key"] ?? "");
    if (options.pendingFirstCardUnfreeze && adminCardUnfreezeAttempts === 1) {
      return route.fulfill({ status: 202, json: { pending: true, operationId: "00000000-0000-0000-0000-000000000098", status: "PENDING" } });
    }
    adminCardStatus = "ACTIVE";
    return route.fulfill({ json: { code: 0, data: { operationId: "00000000-0000-0000-0000-000000000098", status: "ACTIVE" } } });
  });
  const manuallyConfirmedDeposits = new Set<string>();
  await page.route("**/api/admin/deposits/*/confirm", (route) => {
    const gatewayRef = route.request().url().match(/\/deposits\/([^/]+)\/confirm$/)?.[1] ?? "";
    manuallyConfirmedDeposits.add(gatewayRef);
    return route.fulfill({ json: { code: 0, data: {
      gatewayRef, status: "confirmed", creditedAmount: "12.0182", walletBalance: "112.0182", replayed: false,
    } } });
  });
  await page.route("**/api/admin/deposits?**", (route) => {
    options.onAdminDepositsRequest?.(route.request().url());
    const url = new URL(route.request().url());
    const pageNumber = Number(url.searchParams.get("page") ?? "1");
    const orders = [{
      gatewayRef: "00000000-0000-0000-0000-000000000101", userId: 7, email: telegramOnlyAdminRecords ? null : "pending@example.com", currency: "USDT", network: "SOL",
      requestedAmount: "10.0000", expectedAmount: "10.0345", actualAmount: null, creditedAmount: null, status: "pending",
      createdAt: "2026-08-11T09:50:00Z", expiredAt: "2026-08-11T10:10:00Z", reservedUntil: "2026-08-11T11:10:00Z", confirmedAt: null,
      address: "SENSITIVE-WALLET-ADDRESS", transactionHash: "SENSITIVE-FULL-TRANSACTION-HASH",
    }, {
      gatewayRef: "00000000-0000-0000-0000-000000000102", userId: 8, email: "late@example.com", currency: "USDT", network: "BSC",
      requestedAmount: "12.0000", expectedAmount: "12.0182",
      actualAmount: manuallyConfirmedDeposits.has("00000000-0000-0000-0000-000000000102") ? "12.0182" : null,
      creditedAmount: manuallyConfirmedDeposits.has("00000000-0000-0000-0000-000000000102") ? "12.0182" : null,
      status: manuallyConfirmedDeposits.has("00000000-0000-0000-0000-000000000102") ? "confirmed" : "expired",
      createdAt: "2026-08-11T09:30:00Z", expiredAt: "2026-08-11T09:45:00Z", reservedUntil: "2026-08-11T10:30:00Z",
      confirmedAt: manuallyConfirmedDeposits.has("00000000-0000-0000-0000-000000000102") ? "2026-08-11T10:01:00Z" : null,
    }, {
      gatewayRef: "00000000-0000-0000-0000-000000000103", userId: 9, email: "confirmed@example.com", currency: "USDT", network: "TRON",
      requestedAmount: "20.0000", expectedAmount: "20.1279", actualAmount: "20.1279", creditedAmount: "20.1279", status: "confirmed",
      createdAt: "2026-08-11T09:00:00Z", expiredAt: "2026-08-11T09:15:00Z", reservedUntil: "2026-08-11T10:15:00Z", confirmedAt: "2026-08-11T09:06:00Z",
    }, {
      gatewayRef: "00000000-0000-0000-0000-000000000104", userId: 10, email: "cancelled@example.com", currency: "USDT", network: "TRON",
      requestedAmount: "15.0000", expectedAmount: "15.0104", actualAmount: null, creditedAmount: null, status: "cancelled",
      createdAt: "2026-08-11T09:40:00Z", expiredAt: "2026-08-11T09:55:00Z", reservedUntil: "2026-08-11T11:00:00Z", confirmedAt: null,
    }];
    const q = url.searchParams.get("q")?.toLowerCase() ?? "";
    const network = url.searchParams.get("network") ?? "";
    const status = url.searchParams.get("status") ?? "";
    const user = url.searchParams.get("user") ?? "";
    const filtered = orders.filter((order) => (!q || (order.email ?? "").toLowerCase().includes(q) || order.gatewayRef.includes(q))
      && (!network || order.network === network) && (!status || order.status === status) && (!user || String(order.userId) === user));
    const list = pageNumber === 1 ? filtered : filtered.slice(-1);
    return route.fulfill({ json: { code: 0, data: {
      total: q || network || status ? filtered.length : 51, page: pageNumber, pageSize: 50,
      serverTime: "2026-08-11T10:00:00Z", list,
    } } });
  });
  await page.route("**/api/admin/money-operations?**", (route) => {
    const operation = options.gptMoneyOperation ? {
      id: "00000000-0000-0000-0000-000000000081", email: "gpt@example.com", provider: "spacex",
      type: "GPT_DIRECT", status: "COMPENSATED", amount: "2.0000", upstreamCost: "1.0000",
      customerCharge: "2.0000", customerFee: "2.0000", expectedProfit: "1.0000", actualProfit: "0.0000",
      dispatchState: "FAILED", targetCard: { id: 8, cardNumberMasked: "•••• •••• •••• 4242", productCode: "P5378OX" },
      upstreamBusinessId: "gpt-upstream-9821", lastError: "支付被拒绝", lastVerifiedAt: now,
      pricingSnapshot: { plan: "plus" }, createdAt: now,
      gptDirect: {
        orderId: "10000000-0000-0000-0000-000000000081", plan: "plus", source: "api",
        status: "declined", stage: "charging", accountEmailMasked: "b***@example.com",
        cardNumberMasked: "•••• 4242", serviceFeeStatus: "released", latestCode: "card_declined",
        latestMessage: "发卡行拒绝本次扣款，服务费已释放。", failureCode: "card_declined",
        failureReason: "发卡行拒绝本次扣款，服务费已释放。", updatedAt: now, completedAt: now,
        recentEvents: [{ eventId: "20000000-0000-0000-0000-000000000081", type: "gpt_direct.failed",
          status: "declined", stage: "charging", category: "payment", step: "confirm",
          code: "card_declined", message: "发卡行拒绝本次扣款，服务费已释放。", occurredAt: now }],
      },
    } : {
      id: "00000000-0000-0000-0000-000000000001", email: telegramOnlyAdminRecords ? null : "masked@example.com", provider: "spacex",
      type: "OPEN_CARD", status: "SUCCEEDED", amount: "10.0000", upstreamCost: "0.4000",
      customerCharge: "0.5000", customerFee: "0.5000", expectedProfit: "0.1000", actualProfit: "0.1000",
      dispatchState: "CONFIRMED", targetCard: { id: 1, cardNumberMasked: "4242 **** **** 9090", productCode: "P5378OX" },
      upstreamBusinessId: "upstream-business-123", lastError: null, lastVerifiedAt: now,
      pricingSnapshot: { tier: "none", saleOpenFee: "0.5000" }, createdAt: now, gptDirect: null,
    };
    return route.fulfill({ json: { code: 0, data: { total: 1, page: 1, pageSize: 50, list: [operation] } } });
  });
  await page.route("**/api/admin/financial-events?**", (route) => {
    const customer = new URL(route.request().url()).searchParams.get("user") === "7";
    if (customer) options.onCustomerFinancialRequest?.(route.request().url());
    return route.fulfill({ json: { code: 0, data: {
      total: 1, page: 1, pageSize: customer ? 25 : 50, list: customer ? [{ id: "adjust-7", source: "wallet", email: "customer@example.com",
        type: "admin_adjust", status: "COMPLETE", amount: "5.2500", balanceBefore: "26.2500", balanceAfter: "31.5000",
        referenceId: "admin-adjust-customer-7", detail: { remark: "Manual customer credit" }, createdAt: now }] : [{ id: "1", source: "wallet", email: telegramOnlyAdminRecords ? null : "masked@example.com",
        type: "open_card", status: "COMPLETE", amount: "-10.5000", balanceBefore: "100.0000", balanceAfter: "89.5000",
        referenceId: "00000000-0000-0000-0000-000000000001", detail: { remark: "Open card" }, createdAt: now }],
    } } });
  });
  await page.route("**/api/admin/users/7/card-spending?**", (route) => {
    options.onCustomerSpendingRequest?.(route.request().url());
    return route.fulfill({ json: { code: 0, data: { total: 1, page: 1, pageSize: 25, list: [{
      providerId: 1, cardId: 71, cardNumberMasked: "•••• •••• •••• 0910", cardStatus: "ACTIVE", authId: "auth-customer-7",
      status: "SETTLED", merchantName: "OPENAI", description: "ChatGPT subscription", merchantLocation: "San Francisco",
      merchantRegion: "CA", merchantCountry: "US", failedReason: null, billStatus: "paid", source: "webhook", channel: "visa",
      authorizedAmount: "19.9900", settledAmount: "19.9900", refundedAmount: "0", authCurrency: "USD", settleCurrency: "USD",
      merchantAmount: "19.9900", merchantCurrency: "USD", occurredAt: now, events: [{ id: 701, type: "Authorization", status: "COMPLETE",
        authAmount: "19.9900", settleAmount: "0", authCurrency: "USD", settleCurrency: "USD", merchantAmount: "19.9900",
        merchantCurrency: "USD", description: "ChatGPT subscription", billStatus: "paid", failedReason: null, source: "webhook",
        channel: "visa", authTime: now, sourceCreatedAt: now }],
    }] } } });
  });
  await page.route("**/api/admin/reconciliation", (route) => route.fulfill({ json: { code: 0, data: telegramOnlyAdminRecords ? [{
    id: 81, operationId: "00000000-0000-0000-0000-000000000001", email: null, type: "OPEN_CARD", operationStatus: "SUCCEEDED",
    dispatchState: "CONFIRMED", provider: "spacex", upstreamBusinessId: "upstream-business-123", amount: "10.0000",
    fee: "0.5000", totalAmount: "10.5000", reason: "Telegram-only reconciliation", lastError: null, status: "OPEN", createdAt: now,
  }] : [] } }));
  await page.route("**/api/admin/audit-logs?**", (route) => {
    const customer = new URL(route.request().url()).searchParams.get("user") === "7";
    if (customer) options.onCustomerAuditRequest?.(route.request().url());
    return route.fulfill({ json: { code: 0, data: {
      total: 1, page: 1, pageSize: customer ? 25 : 50, list: customer ? [{ id: 7, actorUserId: 1, targetUserId: 7,
        adminEmail: "admin@danewcard.local", actorEmail: "admin@danewcard.local", actorType: "admin", action: "adjust_wallet", outcome: "success",
        sourceIp: "127.0.0.1", userAgent: "Playwright", requestId: "00000000-0000-0000-0000-000000000007",
        targetType: "user", targetId: "7", detail: { amount: "5.2500" }, createdAt: now }] : [{ id: 1, adminEmail: telegramOnlyAdminRecords ? null : "admin@danewcard.local",
        actorEmail: telegramOnlyAdminRecords ? null : "admin@danewcard.local", actorType: "admin", action: "sync_products", outcome: "success",
        sourceIp: "127.0.0.1", userAgent: "Playwright", requestId: "00000000-0000-0000-0000-000000000001",
        targetType: "upstream", targetId: "spacex", detail: { count: 1 }, createdAt: now }],
    } } });
  });
  await page.route("**/api/admin/gpt-cdks**", (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const updatedAt = "2026-08-05T08:00:00Z";
    if (path.endsWith("/quote-refresh")) {
      if (request.method() === "PUT") {
        quoteRefreshAttempts += 1;
        const body = request.postDataJSON() as Record<string, unknown>;
        options.onQuoteRefresh?.(body);
        if (options.quoteRefreshRecentAuth && quoteRefreshAttempts === 1) {
          return route.fulfill({ status: 403, json: { error: "请重新认证后继续敏感操作", errorCode: "RECENT_AUTH_REQUIRED" } });
        }
        quoteRefreshConfigured = true;
        quoteRefreshEnabled = Boolean(body.enabled);
        quoteRefreshInterval = Number(body.intervalMinutes);
      } else if (request.method() === "DELETE") {
        options.onQuoteRefreshDelete?.();
        quoteRefreshConfigured = false;
        quoteRefreshEnabled = false;
        quoteRefreshInterval = 60;
      }
      return route.fulfill({ headers: { "cache-control": "no-store, private" }, json: { code: 0, data: {
        configured: quoteRefreshConfigured, enabled: quoteRefreshEnabled, intervalMinutes: quoteRefreshInterval,
        status: quoteRefreshConfigured ? "pending" : "not_configured", lastErrorCode: null,
        lastRefreshAt: null, lastSuccessAt: null, nextRefreshAt: quoteRefreshConfigured ? updatedAt : null,
        notificationReady: true,
      } } });
    }
    if (path.endsWith("/pricing") && request.method() === "PATCH") {
      const body = request.postDataJSON() as Record<string, unknown>;
      options.onCdkPricing?.(body, request.headers()["idempotency-key"] ?? "");
      return route.fulfill({ json: { code: 0, data: { ...body, updatedAt } } });
    }
    if (path.endsWith("/issue") && request.method() === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>;
      options.onCdkIssue?.(body, request.headers()["idempotency-key"] ?? "");
      return route.fulfill({ json: { code: 0, data: { batchId: "batch-1", status: "CONFIRMED", requested: 1, issued: [{
        id: 9, code: "SXC-ADMIN-ISSUED-0001", codePrefix: "SXC-ADMI", plan: String(body.plan), feeAmountMinor: 100,
        ownerFundingCapMinor: 2500, inventoryStatus: "AVAILABLE", salePrice: "30.0000",
      }] } } });
    }
    return route.fulfill({ json: { code: 0, data: {
      pricing: [{
        plan: "plus", configuredEnabled: true, enabled: true, salePrice: "29.0000", fixedPrice: "29.0000",
        pricingMode: "FIXED", markupValue: "0.0000", version: 1, pricingStatus: "READY",
        quoteBaseUsd: "19.9900", quoteCountry: "US", quoteCurrency: "USD", quoteObservedAt: updatedAt,
        fxRateDate: "2026-08-05", costFloor: "26.0000", updatedAt,
      }, {
        plan: "pro_5x", configuredEnabled: true, enabled: false, salePrice: null, fixedPrice: "159.0000",
        pricingMode: "QUOTE_PERCENT", markupValue: "5.0000", version: 2, pricingStatus: "WAITING_QUOTE",
        quoteBaseUsd: null, quoteCountry: null, quoteCurrency: null, quoteObservedAt: null,
        fxRateDate: null, costFloor: "151.0000", updatedAt,
      }],
      inventory: [{ id: 8, upstreamCdkId: 80, codePrefix: "SXC-OLD1", plan: "plus", status: "issued",
        inventoryStatus: "AVAILABLE", feeAmountMinor: 100, ownerFundingCapMinor: 2500,
        worstCost: "26.0000", salePrice: "29.0000", ownerUserId: null, issueBatchId: "batch-0", updatedAt }],
      batches: [{ id: "batch-0", plan: "plus", requestedCount: 1, issuedCount: 1, status: "CONFIRMED", createdAt: updatedAt }],
    } } });
  });
  await page.route("**/api/admin/gpt-proxies**", (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "POST" && path.endsWith("/gpt-proxies")) {
      const body = request.postDataJSON() as { url?: string; label?: string };
      return route.fulfill({ json: { code: 0, data: {
        intervalSeconds: 60, total: 1, healthy: 0, routable: 1, proxies: [{
          id: "abc123def456", label: body.label ?? "", scheme: "socks5h", host: "exit.example", port: 1080,
          masked: "socks5h://***@exit.example:1080", enabled: true, healthy: false, routable: true, state: "unknown",
          failureCount: 0, cooldownUntil: "", lastCheckedAt: "", lastError: "", latencyMs: 0, exitIp: "", country: "US", city: "",
        }],
      } } });
    }
    return route.fulfill({ json: { code: 0, data: {
      intervalSeconds: 60, total: 1, healthy: 1, routable: 1, proxies: [{
        id: "abc123def456", label: "us-exit", scheme: "socks5h", host: "exit.example", port: 1080,
        masked: "socks5h://***@exit.example:1080", enabled: true, healthy: true, routable: true, state: "healthy",
        failureCount: 0, cooldownUntil: "", lastCheckedAt: now, lastError: "", latencyMs: 180, exitIp: "203.0.113.10", country: "US", city: "Ashburn",
      }],
    } } });
  });
}

async function openGptDirectTool(page: Page, name: "直充订单" | "CDK 生命周期" | "生成待售 CDK" | "Direct-pay orders" | "CDK lifecycle" | "Generate CDKs to sell") {
  await page.getByRole("tab", { name, exact: true }).click();
}

async function mockGptDirect(page: Page, options: {
  checkoutCountries?: Array<{ country: string; currency: string }>;
  batchConcurrencyByCountry?: Record<string, number>;
  currentPlan?: string;
  availablePlans?: string[];
  activeCard?: boolean;
  quoteError?: string;
  quoteErrors?: Record<string, string>;
  createStatus?: string;
  createOperationStatus?: string;
  detailStatuses?: string[];
  detailStatusesByOrder?: string[][];
  detailOperationStatuses?: string[];
  orderCardIds?: number[];
  orderAutoOpenedCards?: boolean[];
  cdk?: boolean;
  forceNewCardEnabled?: boolean;
  includeCreditPlans?: boolean;
  observedQuote?: boolean;
  cardSuccess?: boolean;
  historyInvoiceUrls?: Array<string | null>;
  historyEmails?: string[];
  historyProgress?: Array<{ stage: string; progress: Array<{ stage: string; publicMessage: string; occurredAt: string }> }>;
  cdkInvoiceUrl?: string | null;
  onPreflight?: (body: Record<string, unknown>) => void;
  preflightResponse?: (body: Record<string, unknown>, call: number) => Record<string, unknown>;
  onCreate?: (body: Record<string, unknown>) => void;
  onOrderSearch?: (search: string) => void;
  preflightFailureCalls?: number[];
  onGenerate?: (body: Record<string, unknown>, idempotencyKey: string) => void;
  generateFailures?: number;
} = {}) {
  const createdAt = "2026-08-04T08:00:00Z";
  const detailCalls = new Map<string, number>();
  let preflightCalls = 0;
  let createCalls = 0;
  let generateCalls = 0;
  let createdPlan = "plus";
  let lastHistoryProgress = options.historyProgress?.[0];
  let cancelled = false;
  let purchasedCdks: Array<{ id: string; code: string }> = [];
  const order = (status: string, operationStatus?: string, overrides: { id?: string; plan?: string; stage?: string; progress?: Array<{ stage: string; publicMessage: string; occurredAt: string }>; email?: string; invoiceUrl?: string | null; cardId?: number; autoOpenedCard?: boolean } = {}) => ({
    id: "local-order-1", plan: "plus", status, stage: status === "completed" ? "complete" : "payment_processing",
    maskedEmail: "u***@example.com", cardId: 91, cardNumberMasked: "545020 **** 4242", serviceFee: "1.0000",
    serviceFeeStatus: status === "completed" ? "settled" : ["declined", "failed_precharge", "cancelled"].includes(status) ? "released" : "held", quotedAmountMinor: 98214, currency: "PHP",
    operationStatus: operationStatus ?? (status === "completed" ? "SUCCEEDED" : ["declined", "failed_precharge", "cancelled"].includes(status) ? "COMPENSATED" : "SUBMITTED"),
    clientRequestId: "client-order-1", createdAt, updatedAt: createdAt,
    ...overrides,
  });
  const historyOrders = options.historyEmails
    ? options.historyEmails.map((email, index) => order("completed", undefined, { id: `history-order-${index + 1}`, plan: index === 0 ? "go" : "plus", email }))
    : (options.historyInvoiceUrls ?? []).map((invoiceUrl, index) => order("completed", undefined, { id: `history-order-${index + 1}`, plan: index === 0 ? "go" : "plus", invoiceUrl }));
  let historyCalls = 0;
  await page.route("**/api/cards", (route) => route.fulfill({ json: { code: 0, data: {
    total: 1, list: [{ id: 91, vmCardId: "up-91", cardNumberMasked: "545020 **** 4242", productCode: "G5554LC",
      network: "Mastercard", issuingArea: "US", status: options.activeCard === false ? "FROZEN" : "ACTIVE", balance: "40.0000",
      firstName: "Ada", lastName: "Lovelace", createdAt }],
  } } }));
  await page.route("**/api/cards/91", route => route.fulfill({ json: { code: 0, data: {
    id: 91, status: "ACTIVE", availableAmount: "40.0000", minAmount: "1.0000", maxAmount: "50000.0000",
    pendingOperationId: null, upstreamSyncedAt: new Date().toISOString(),
  } } }));
  await page.route("**/api/products", (route) => route.fulfill({ json: { code: 0, data: [{
    productCode: "P5378OX", issuer: "E2E Bank", network: "MASTERCARD", issuingArea: "US", cardType: "Virtual",
    openFee: "1.0000", rechargeRate: "0.010000", openQuoteVersion: "a".repeat(64),
    minAmount: "1.0000", maxAmount: "50000.0000", description: null, category: null,
    restrictedMerchants: [], googleChatgptBlocked: false, displayBin: "537872", displayBins: ["537872"],
  }] } }));
  await page.route("**/api/openai-prices", (route) => route.fulfill({ json: { code: 0, data: { references: [], binStats: [] } } }));
  await page.route("**/api/gpt-direct/**", (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/observed-quotes")) return route.fulfill({ json: { code: 0, data: { list: options.observedQuote === false ? [] : [{
      plan: "plus", country: "US", currency: "USD", amountMajor: "20", amountUsd: "20.00000000",
      observedAt: "2026-08-04T07:55:00.000Z", fxDate: "2026-08-04",
    }] } } });
    if (path.endsWith("/card-successes")) return route.fulfill({ json: { code: 0, data: { list: options.cardSuccess === false ? [] : [{
      cardId: 91,
      overall: { attempts: 5, successes: 4, declines: 1, successRateBps: 8000, declineRateBps: 2000 },
      plans: [
        { plan: "go", attempts: 0, successes: 0, declines: 0, successRateBps: null, declineRateBps: null, latestSuccess: null },
        { plan: "plus", attempts: 5, successes: 4, declines: 1, successRateBps: 8000, declineRateBps: 2000, latestSuccess: { type: "openai_direct", plan: "plus", priceMajor: "20", currency: "USD", completedAt: "2026-08-04T07:58:00.000Z" } },
      ],
    }] } } });
    if (path.endsWith("/plans")) return route.fulfill({ json: { code: 0, data: { version: 2, batchConcurrencyByCountry: options.batchConcurrencyByCountry, externalCardServiceFee: "1.0000", checkoutCountries: options.checkoutCountries ?? [
      { country: "PH", currency: "PHP" }, { country: "US", currency: "USD" },
    ], plans: [
      { key: "plus", label: "ChatGPT Plus", currency: "USD", enabled: true, serviceFeeUsdMinor: 100, customerServiceFee: "1.2500" },
      { key: "pro_5x", label: "ChatGPT Pro 5x", currency: "USD", enabled: true, serviceFeeUsdMinor: 500, customerServiceFee: "6.2500" },
      { key: "pro_20x", label: "ChatGPT Pro 20x", currency: "USD", enabled: true, serviceFeeUsdMinor: 500, customerServiceFee: "6.2500" },
      { key: "go", label: "ChatGPT Go", currency: "USD", enabled: true, serviceFeeUsdMinor: 50, customerServiceFee: "0.6250" },
      ...(options.includeCreditPlans ? [{ key: "credits_250", label: "Credits 250", currency: "PHP", enabled: true, serviceFeeUsdMinor: 0, customerServiceFee: "0.0000" }] : []),
    ] } } });
    if (path.endsWith("/preflight")) {
      const body = request.postDataJSON() as Record<string, unknown>;
      options.onPreflight?.(body);
      preflightCalls += 1;
      if (options.preflightFailureCalls?.includes(preflightCalls)) {
        return route.fulfill({ status: 400, json: { error: "Mailbox login failed", errorCode: "MAILBOX_LOGIN_FAILED" } });
      }
      if (options.preflightResponse) return route.fulfill({ json: { code: 0, data: options.preflightResponse(body, preflightCalls) } });
      const credential = body.credential as { email?: string } | undefined;
      return route.fulfill({ json: { code: 0, data: {
      email: credential?.email ?? "user@example.com", currentPlan: options.currentPlan ?? "free", credentialMode: credential?.email ? "mailbox" : "session", preflightToken: `one-time-preflight-${preflightCalls}`,
      preflightExpiresAt: "2099-08-04T08:10:00Z", paymentCountry: "PH", paymentCurrency: "PHP",
      quotes: Object.fromEntries(Object.entries({
        plus: { country: "PH", currency: "PHP", plan: "plus", amountMinor: 98214, amountMajor: 982.14, minorUnitExponent: 2 },
        pro_5x: { country: "PH", currency: "PHP", plan: "pro_5x", amountMinor: 491070, amountMajor: 4910.70, minorUnitExponent: 2 },
        pro_20x: { country: "PH", currency: "PHP", plan: "pro", amountMinor: 824693, amountMajor: 8246.93, minorUnitExponent: 2 },
        go: { country: "PH", currency: "PHP", plan: "go", amountMinor: 49000, amountMajor: 490, minorUnitExponent: 2 },
        ...(options.includeCreditPlans ? { credits_250: { country: "PH", currency: "PHP", plan: "credits_250", amountMinor: 56500, amountMajor: 565, minorUnitExponent: 2 } } : {}),
      }).filter(([key]) => !options.availablePlans || options.availablePlans.includes(key))),
      quoteEstimatesUsd: { plus: "15.99906060", pro_5x: "79.99530300", go: "7.98300000", ...(options.includeCreditPlans ? { credits_250: "9.50000000" } : {}) },
      quoteError: options.quoteError ?? "",
      quoteErrors: options.quoteErrors ?? {},
      } } });
    }
    if (path.endsWith("/cdk-offers")) return route.fulfill({ json: { code: 0, data: { offers: [] } } });
    if (path.endsWith("/cdks/generate")) {
      const body = request.postDataJSON() as Record<string, unknown>;
      options.onGenerate?.(body, request.headers()["idempotency-key"] ?? "");
      generateCalls += 1;
      if (generateCalls <= (options.generateFailures ?? 0)) {
        return route.fulfill({ status: 503, json: { error: "Temporary CDK generation failure" } });
      }
      const quantity = Number(body.quantity ?? 1);
      purchasedCdks = Array.from({ length: quantity }, (_, index) => ({
        id: `00000000-0000-0000-0000-${String(17 + index).padStart(12, "0")}`,
        code: `AVF-${String(17 + index).padStart(32, "0")}`,
      }));
      return route.fulfill({ json: { code: 0, data: {
        saleId: "00000000-0000-0000-0000-000000000071", cdkId: purchasedCdks[0].id, code: purchasedCdks[0].code, codePrefix: "AVF-00000000", plan: body.plan ?? "plus",
        salePrice: "0.0001", quantity, totalSalePrice: "0", generated: true, forceNewCard: body.forceNewCard === true, items: purchasedCdks.map((item, index) => ({ saleId: `00000000-0000-0000-0000-${String(71 + index).padStart(12, "0")}`, cdkId: item.id, code: item.code, codePrefix: "AVF-00000000" })), balance: "950.2000", replayed: false,
      } } });
    }
    if (path.endsWith("/cdks/purchase")) {
      return route.fulfill({ status: 410, json: { error: "已改为自助生成 CDK，不再出售库存码" } });
    }
    if (path.endsWith("/sensitive")) {
      const id = path.split("/").at(-2) ?? "";
      const code = purchasedCdks.find((item) => item.id === id)?.code ?? "AVF-00000000000000000000000000000017";
      return route.fulfill({ json: { code: 0, data: { id, code } } });
    }
    if (path.endsWith("/cdks")) {
      const initial = options.cdk && !purchasedCdks.length ? [{ id: "00000000-0000-0000-0000-000000000017", code: "AVF-00000000000000000000000000000017" }] : [];
      const records = purchasedCdks.length ? purchasedCdks : initial;
      return route.fulfill({ json: { code: 0, data: { forceNewCardEnabled: options.forceNewCardEnabled ?? true, total: records.length, list: records.map((item) => ({
        id: item.id, codePrefix: "AVF-********", plan: "plus", status: purchasedCdks.length ? "unused" : "consumed", inventoryStatus: purchasedCdks.length ? "SOLD" : "CONSUMED", updatedAt: createdAt,
        forceNewCard: true,
        redemptionStatus: options.cdkInvoiceUrl ? "completed" : null,
        invoiceUrl: options.cdkInvoiceUrl ?? null,
        maskedEmail: options.cdkInvoiceUrl ? "u***@example.com" : null,
      })) } } });
    }
    if (path.endsWith("/orders") && request.method() === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>;
      options.onCreate?.(body);
      createCalls += 1;
      createdPlan = typeof body.plan === "string" ? body.plan : "plus";
      const orderIndex = createCalls - 1;
      return route.fulfill({ status: 202, json: { code: 0, data: order(options.createStatus ?? "queued", options.createOperationStatus, {
        id: `local-order-${createCalls}`,
        plan: createdPlan,
        cardId: options.orderCardIds?.[orderIndex] ?? 91,
        autoOpenedCard: options.orderAutoOpenedCards?.[orderIndex] ?? false,
      }) } });
    }
    if (path.endsWith("/orders") && request.method() === "GET") {
      if (options.historyProgress?.length) {
        const progress = options.historyProgress[Math.min(historyCalls, options.historyProgress.length - 1)];
        lastHistoryProgress = progress;
        historyCalls += 1;
        const liveOrder = order("running", "SUBMITTED", { id: "history-live", plan: "pro_20x", ...progress });
        return route.fulfill({ json: { code: 0, data: { total: 1, list: [liveOrder] } } });
      }
      const search = new URL(request.url()).searchParams.get("q") ?? "";
      options.onOrderSearch?.(search);
      const list = search ? historyOrders.filter((item) => item.email?.toLowerCase().includes(search.toLowerCase())) : historyOrders;
      return route.fulfill({ json: { code: 0, data: { total: list.length, list } } });
    }
    if (path.endsWith("/orders/history-live") && lastHistoryProgress) {
      const liveOrder = order("running", "SUBMITTED", { id: "history-live", plan: "pro_20x", ...lastHistoryProgress });
      return route.fulfill({ json: { code: 0, data: { order: liveOrder, events: lastHistoryProgress.progress.map((step, index) => ({
        eventId: `history-progress-${index}`, type: "gpt_direct.progress", status: "running", ...step,
      })) } } });
    }
    if (path.endsWith("/cancel")) {
      cancelled = true;
      return route.fulfill({ status: 202, json: { code: 0, data: order("cancelled") } });
    }
    const historyOrder = historyOrders.find((item) => path.endsWith(`/orders/${item.id}`));
    if (historyOrder) return route.fulfill({ json: { code: 0, data: { order: historyOrder, events: [] } } });
    const localOrder = path.match(/\/orders\/(local-order-\d+)$/)?.[1];
    if (localOrder) {
      if (cancelled) return route.fulfill({ json: { code: 0, data: { order: order("cancelled"), events: [] } } });
      const orderIndex = Number(localOrder.split("-").at(-1)) - 1;
      const statuses = options.detailStatusesByOrder?.[orderIndex] ?? options.detailStatuses ?? ["running", "completed"];
      const calls = detailCalls.get(localOrder) ?? 0;
      detailCalls.set(localOrder, calls + 1);
      const index = Math.min(calls, statuses.length - 1);
      const status = statuses[index];
      const operationStatus = options.detailOperationStatuses?.[Math.min(index, options.detailOperationStatuses.length - 1)];
      return route.fulfill({ json: { code: 0, data: { order: order(status, operationStatus, {
        id: localOrder,
        plan: createdPlan,
        cardId: options.orderCardIds?.[orderIndex] ?? 91,
        autoOpenedCard: options.orderAutoOpenedCards?.[orderIndex] ?? false,
      }), events: [{
        eventId: `event-${localOrder}-${calls + 1}`, type: "gpt_direct.progress", status, stage: status === "completed" ? "complete" : status,
        publicMessage: status === "completed" ? (createdPlan.startsWith("credits_") ? "Credits confirmed" : "Subscription confirmed") : "Processing payment", createdAt,
      }] } } });
    }
    return route.fulfill({ status: 404, json: { error: "Unexpected GPT mock request" } });
  });
}

test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.project.name === "frontend-mock") return;
  const source = createHmac("sha256", "playwright-test-source").update(testInfo.testId).digest();
  await page.setExtraHTTPHeaders({ "x-real-ip": `10.${source[0]}.${source[1]}.${source[2]}` });
  await page.goto("/login");
  await page.getByPlaceholder("your@email.com").fill("admin@danewcard.local");
  await page.getByPlaceholder("8+").fill("Admin123!Secure");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByText("欢迎回来")).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("session"))).not.toBeNull();
});

test("login distinguishes a suspended account from a wrong password", async ({ page }) => {
  await page.route("**/api/features", (route) => route.fulfill({ json: { code: 0, data: {
    version: 1, registration: true, walletTransfer: true, cardOpening: true, cardRecharge: true, cardManagement: true, cardDelete: true,
    gptDirect: true, gptCdk: true, deposits: true, rewards: true, agent: true, market: true,
    developerApi: true, telegram: true,
  } } }));
  await page.route("**/api/auth/captcha", (route) => route.fulfill({ json: { code: 0, data: {
    required: false, id: null, image: null, expiresIn: 0,
  } } }));
  await page.route("**/api/auth/login", (route) => route.fulfill({
    status: 403,
    json: { error: "账号已停用，请联系管理员启用后再登录", errorCode: "ACCOUNT_SUSPENDED" },
  }));
  await page.goto("/login");
  await page.getByPlaceholder("your@email.com").fill("user@example.com");
  await page.getByPlaceholder("8+").fill("CorrectHorseBattery1");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("账号已停用，请联系管理员启用后再登录");
});

test("login page offers one Telegram entry point", async ({ page }) => {
  await page.route("**/api/features", (route) => route.fulfill({ json: { code: 0, data: {
    version: 1, registration: true, walletTransfer: true, cardOpening: true, cardRecharge: true, cardManagement: true, cardDelete: true,
    gptDirect: true, gptCdk: true, deposits: true, rewards: true, agent: true, market: true,
    developerApi: true, telegram: true,
  } } }));
  await page.route("**/api/auth/captcha", (route) => route.fulfill({ json: { code: 0, data: {
    required: false, id: null, image: null, expiresIn: 0,
  } } }));
  await page.goto("/login");
  await expect(page.getByRole("link", { name: "使用 Telegram 登录", exact: true }))
    .toHaveAttribute("href", "/api/auth/telegram?next=%2Fdashboard", { timeout: 20_000 });
  await expect(page.getByRole("link", { name: "在 Telegram App 中打开", exact: true })).toHaveCount(0);
});

test("forgot password keeps account lookup private and consumes a one-time reset link", async ({ page }) => {
  const forgotBodies: Record<string, unknown>[] = [];
  const resetBodies: Record<string, unknown>[] = [];
  await page.route("**/api/features", (route) => route.fulfill({ json: { code: 0, data: {
    version: 1, registration: true, walletTransfer: true, cardOpening: true, cardRecharge: true, cardManagement: true, cardDelete: true,
    gptDirect: true, gptCdk: true, deposits: true, rewards: true, agent: true, market: true,
    developerApi: true, telegram: true,
  } } }));
  await page.route("**/api/auth/captcha", (route) => route.fulfill({ json: { code: 0, data: {
    required: true, id: "11111111-1111-4111-8111-111111111111",
    image: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='174' height='48'%3E%3Ctext x='20' y='30'%3E23456%3C/text%3E%3C/svg%3E",
    expiresIn: 300,
  } } }));
  await page.route("**/api/auth/password/forgot", (route) => {
    forgotBodies.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.fulfill({ headers: { "cache-control": "no-store", "retry-after": "60" }, json: {
      code: 0, msg: "如果该账户可用，重置邮件已发送", data: { cooldownSeconds: 60 },
    } });
  });
  await page.route("**/api/auth/password/reset", (route) => {
    resetBodies.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.fulfill({ headers: { "cache-control": "no-store" }, json: {
      code: 0, msg: "密码已重置，请使用新密码重新登录",
    } });
  });

  await page.goto("/login");
  await page.getByRole("link", { name: "忘记密码？", exact: true }).click();
  await expect(page).toHaveURL(/\/forgot-password$/);
  await expect(page.getByRole("heading", { name: "找回账户", exact: true })).toBeVisible();
  await page.getByLabel("邮箱", { exact: true }).fill("customer@example.com");
  await page.getByLabel("图形验证码", { exact: true }).fill("23456");
  await page.getByRole("button", { name: "发送重置邮件", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("如果该账户可用，重置邮件已发送");
  expect(forgotBodies).toEqual([{
    email: "customer@example.com",
    captchaId: "11111111-1111-4111-8111-111111111111",
    captchaCode: "23456",
  }]);

  const resetToken = "a".repeat(64);
  await page.goto(`/reset-password#token=${resetToken}`);
  await expect(page).toHaveURL(/\/reset-password$/);
  expect(page.url()).not.toContain(resetToken);
  await page.getByLabel("新密码", { exact: true }).fill("ReplacementPassword123");
  await page.getByLabel("确认密码", { exact: true }).fill("DifferentPassword456");
  await page.getByRole("button", { name: "确认重置密码", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("两次输入的密码不一致。");
  expect(resetBodies).toHaveLength(0);
  await page.getByLabel("确认密码", { exact: true }).fill("ReplacementPassword123");
  await page.getByRole("button", { name: "确认重置密码", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("密码已重置，请使用新密码重新登录");
  expect(resetBodies).toEqual([{ token: resetToken, newPassword: "ReplacementPassword123" }]);
  const stored = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  expect(stored).not.toContain(resetToken);
});

test("login uses an HttpOnly cookie and logout revokes it", async ({ page, context }) => {
  await expect(page.locator("#main-content").getByText("admin@danewcard.local")).toBeVisible();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("session")!));
  expect(stored.token).toBe("");
  expect(await page.evaluate(() => document.cookie)).not.toContain("danew_session");
  const sessionCookie = (await context.cookies()).find((cookie) => cookie.name === "danew_session");
  expect(sessionCookie).toMatchObject({ httpOnly: true, sameSite: "Strict", path: "/api" });
  const refreshCookie = (await context.cookies()).find((cookie) => cookie.name === "danew_refresh");
  expect(refreshCookie).toMatchObject({ httpOnly: true, sameSite: "Strict", path: "/api/auth/refresh" });
  await page.getByRole("button", { name: "退出", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/, { timeout: 15_000 });
  expect((await context.cookies()).find((cookie) => cookie.name === "danew_session")).toBeUndefined();
  expect((await context.cookies()).find((cookie) => cookie.name === "danew_refresh")).toBeUndefined();
  await context.addCookies([sessionCookie!, refreshCookie!]);
  const revoked = await context.request.get(new URL("/api/dashboard", page.url()).toString());
  expect(revoked.status()).toBe(401);
  expect((await revoked.json()).errorCode).toBe("AUTH_REQUIRED");
  await context.clearCookies();
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
});

test("a missing access cookie is restored by the real refresh endpoint", async ({ page, context }) => {
  const refreshBefore = (await context.cookies()).find((cookie) => cookie.name === "danew_refresh");
  expect(refreshBefore).toBeDefined();
  await context.clearCookies({ name: "danew_session" });
  expect((await context.cookies()).find((cookie) => cookie.name === "danew_session")).toBeUndefined();

  await page.reload();

  await expect(page.getByText("欢迎回来", { exact: true })).toBeVisible();
  expect((await context.cookies()).find((cookie) => cookie.name === "danew_session")).toMatchObject({
    httpOnly: true,
    sameSite: "Strict",
    path: "/api",
  });
  expect((await context.cookies()).find((cookie) => cookie.name === "danew_refresh")?.value).toBe(refreshBefore!.value);
});

test("logout refreshes an expired access cookie before revocation", async ({ page, context }) => {
  let refreshCalls = 0;
  let logoutCalls = 0;
  await page.route("**/api/auth/refresh", async (route) => {
    refreshCalls += 1;
    await route.fulfill({ status: 204 });
  });
  await page.route("**/api/auth/logout", async (route) => {
    logoutCalls += 1;
    if (logoutCalls === 1) return route.fulfill({ status: 401, json: { error: "Access expired", errorCode: "AUTH_REQUIRED" } });
    const response = await route.fetch();
    await route.fulfill({ response });
  });

  await page.getByRole("button", { name: "退出", exact: true }).click();

  await expect(page).toHaveURL(/\/login$/, { timeout: 15_000 });
  expect(refreshCalls).toBe(1);
  expect(logoutCalls).toBe(2);
  expect((await context.cookies()).find((cookie) => cookie.name === "danew_session")).toBeUndefined();
});

test("expired session immediately returns to login", async ({ page, context }) => {
  await context.clearCookies();
  await page.getByRole("link", { name: "财务", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/, { timeout: 15_000 });
  await expect.poll(() => page.evaluate(() => localStorage.getItem("session"))).toBeNull();
  await expect(page.getByTestId("app-sidebar")).toHaveCount(0);
});

test("concurrent 401 responses share one refresh and retry each request once", async ({ page }) => {
  let refreshCalls = 0;
  let dashboardCalls = 0;
  let announcementCalls = 0;
  await page.route("**/api/auth/refresh", async (route) => {
    refreshCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 100));
    await route.fulfill({ status: 204 });
  });
  await page.route("**/api/dashboard", async (route) => {
    dashboardCalls += 1;
    if (dashboardCalls === 1) return route.fulfill({ status: 401, json: { error: "Access expired", errorCode: "AUTH_REQUIRED" } });
    const response = await route.fetch();
    await route.fulfill({ response });
  });
  await page.route("**/api/announcements/unread", async (route) => {
    announcementCalls += 1;
    if (announcementCalls === 1) return route.fulfill({ status: 401, json: { error: "Access expired", errorCode: "AUTH_REQUIRED" } });
    const response = await route.fetch();
    await route.fulfill({ response });
  });

  await page.reload();

  await expect(page.getByText("欢迎回来", { exact: true })).toBeVisible();
  await expect.poll(() => refreshCalls).toBe(1);
  expect(dashboardCalls).toBe(2);
  expect(announcementCalls).toBe(2);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("session"))).not.toBeNull();
});

test("failed refresh clears the session and returns to login", async ({ page }) => {
  let refreshCalls = 0;
  await page.route("**/api/auth/refresh", async (route) => {
    refreshCalls += 1;
    await route.fulfill({ status: 401, json: { error: "Refresh expired", errorCode: "AUTH_REQUIRED" } });
  });
  await page.route("**/api/dashboard", (route) => route.fulfill({
    status: 401, json: { error: "Access expired", errorCode: "AUTH_REQUIRED" },
  }));

  await page.reload();

  await expect(page).toHaveURL(/\/login$/, { timeout: 15_000 });
  expect(refreshCalls).toBe(1);
  await expect.poll(async () => {
    const state = await page.context().storageState();
    return state.origins.some((origin) => origin.localStorage.some((item) => item.name === "session"));
  }).toBe(false);
});

test("temporary refresh failure keeps the session without replaying the request", async ({ page }) => {
  let refreshCalls = 0;
  let dashboardCalls = 0;
  await page.route("**/api/auth/refresh", async (route) => {
    refreshCalls += 1;
    await route.fulfill({ status: 503, json: { error: "Refresh temporarily unavailable" } });
  });
  await page.route("**/api/dashboard", async (route) => {
    dashboardCalls += 1;
    await route.fulfill({ status: 401, json: { error: "Access expired", errorCode: "AUTH_REQUIRED" } });
  });

  await page.reload();

  await expect(page.getByRole("alert")).toContainText("Refresh temporarily unavailable");
  await expect(page).toHaveURL(/\/dashboard$/);
  expect(refreshCalls).toBe(1);
  expect(dashboardCalls).toBe(1);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("session"))).not.toBeNull();
});

test("ordinary protected 401 is not refreshed, replayed, or treated as logout", async ({ page }) => {
  let refreshCalls = 0;
  let dashboardCalls = 0;
  await page.route("**/api/auth/refresh", async (route) => {
    refreshCalls += 1;
    await route.fulfill({ status: 204 });
  });
  await page.route("**/api/dashboard", async (route) => {
    dashboardCalls += 1;
    await route.fulfill({ status: 401, json: { error: "Invalid one-time code", errorCode: "MFA_INVALID" } });
  });

  await page.reload();

  await expect(page.getByRole("alert")).toContainText("Invalid one-time code");
  await expect(page).toHaveURL(/\/dashboard$/);
  expect(refreshCalls).toBe(0);
  expect(dashboardCalls).toBe(1);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("session"))).not.toBeNull();
});

test("failed logout keeps the active session and shows a retryable error", async ({ page }) => {
  let logoutCalls = 0;
  await page.route("**/api/auth/logout", async (route) => {
    logoutCalls += 1;
    await route.fulfill({ status: 503, json: { error: "Logout temporarily unavailable" } });
  });

  await page.getByRole("button", { name: "退出", exact: true }).click();

  await expect(page.getByRole("alert")).toContainText("Logout temporarily unavailable");
  await expect(page).toHaveURL(/\/dashboard$/);
  expect(logoutCalls).toBe(1);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("session"))).not.toBeNull();
});

test("recent-auth 403 keeps the session and never issues a transfer challenge", async ({ page }) => {
  let refreshCalls = 0;
  let transferCalls = 0;
  await page.route("**/api/auth/refresh", async (route) => {
    refreshCalls += 1;
    await route.fulfill({ status: 204 });
  });
  await page.route("**/api/wallet/transfer/challenge", async (route) => {
    transferCalls += 1;
    await route.fulfill({
      status: 403,
      json: { error: "请重新认证后继续敏感操作", errorCode: "RECENT_AUTH_REQUIRED" },
    });
  });
  await page.getByRole("link", { name: "财务", exact: true }).click();
  await expect(page.getByRole("heading", { name: "财务明细", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "余额转账", exact: true }).click();
  await page.getByLabel("收款人邀请码", { exact: true }).fill("RECEIVE1");
  await page.getByLabel("转账金额（USD）", { exact: true }).fill("1.00");
  await page.getByRole("button", { name: "发送验证码", exact: true }).click();

  await expect(page.getByRole("alert")).toHaveText("请重新认证后继续敏感操作");
  await expect(page).toHaveURL(/\/finance$/);
  expect(transferCalls).toBe(1);
  expect(refreshCalls).toBe(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("session"))).not.toBeNull();
});

test("card sensitive recent-auth error explains reauthentication and returns to the card", async ({ page }) => {
  let sensitiveCalls = 0;
  let refreshCalls = 0;
  await page.route("**/api/auth/refresh", async (route) => {
    refreshCalls += 1;
    await route.fulfill({ status: 204 });
  });
  await page.route("**/api/cards/71", (route) => route.fulfill({ json: { code: 0, data: {
    id: 71, cardNumberMasked: "545020 **** 0910", status: "ACTIVE", network: "MASTERCARD",
    issuingArea: "HK", issuer: "four", availableAmount: "21.0000", firstName: "Ada", lastName: "Lovelace",
    note: "", productCode: "PP5450RC", minAmount: "21.0000", maxAmount: "50000.0000",
    rechargeRate: "0.000000", expiry: "01/29", createdAt: "2026-08-09T08:00:00Z",
  } } }));
  await page.route("**/api/cards/transactions?**", (route) => route.fulfill({ json: { code: 0, data: { total: 0, list: [] } } }));
  await page.route("**/api/cards/71/sensitive", (route) => {
    sensitiveCalls += 1;
    return sensitiveCalls === 1
      ? route.fulfill({ status: 403, json: { error: "请重新认证后继续敏感操作", errorCode: "RECENT_AUTH_REQUIRED" } })
      : route.fulfill({ json: { code: 0, data: { cardNumber: "5450200000900910", cvv: "665", expire: "01/29" } } });
  });

  await page.goto("/cards/71");
  await page.getByRole("button", { name: "显示完整信息", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("风险操作需要重新登录。验证后即可查看完整卡片信息。");
  await expect(page.getByRole("button", { name: "重新登录验证", exact: true })).toBeVisible();
  expect(refreshCalls).toBe(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("session"))).not.toBeNull();

  await page.getByRole("button", { name: "重新登录验证", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByPlaceholder("your@email.com").fill("admin@danewcard.local");
  await page.getByPlaceholder("8+").fill("Admin123!Secure");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/cards\/71$/);
  await page.getByRole("button", { name: "显示完整信息", exact: true }).click();
  await expect(page.getByTestId("card-number")).toHaveText("5450200000900910");
  expect(sensitiveCalls).toBe(2);
});

test("dashboard 503 keeps the session and recovers through an accessible retry", async ({ page }) => {
  let dashboardCalls = 0;
  await page.route("**/api/dashboard", async (route) => {
    dashboardCalls += 1;
    if (dashboardCalls === 1) return route.fulfill({ status: 503, json: { error: "Dashboard temporarily unavailable" } });
    const response = await route.fetch();
    await route.fulfill({ response });
  });

  await page.reload();

  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Dashboard temporarily unavailable");
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("session"))).not.toBeNull();
  await alert.getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.getByText("欢迎回来", { exact: true })).toBeVisible();
  expect(dashboardCalls).toBe(2);
});

test("switching accounts never renders the previous dashboard cache", async ({ page, request }) => {
  const balance = page.locator(".balance-hero > div:first-child > strong");
  const previousBalance = await balance.textContent();
  const email = `cache-isolation-${Date.now()}@example.com`;
  expect((await request.post("/api/auth/register", {
    data: { email, password: "StrongRegister123!" },
  })).status()).toBe(200);
  await page.getByRole("button", { name: "退出", exact: true }).click();
  await page.route("**/api/dashboard", async (route) => {
    const response = await route.fetch();
    await new Promise((resolve) => setTimeout(resolve, 750));
    await route.fulfill({ response });
  });
  await page.getByPlaceholder("your@email.com").fill(email);
  await page.getByPlaceholder("8+").fill("StrongRegister123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText(previousBalance!, { exact: true })).toHaveCount(0);
  await expect(balance).toHaveText("$0");
});

test("switching accounts in another tab clears the previous account cache", async ({ page, context, request }) => {
  const email = `cross-tab-cache-${Date.now()}@example.com`;
  expect((await request.post("/api/auth/register", {
    data: { email, password: "StrongRegister123!" },
  })).status()).toBe(200);
  const otherTab = await context.newPage();
  await otherTab.goto("/login");
  await otherTab.getByPlaceholder("your@email.com").fill(email);
  await otherTab.getByPlaceholder("8+").fill("StrongRegister123!");
  await otherTab.getByRole("button", { name: "登录", exact: true }).click();
  await expect(otherTab).toHaveURL(/\/dashboard$/);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("session")!).email)).toBe(email);

  await expect(page.getByText("admin@danewcard.local", { exact: true })).toHaveCount(0);
  await expect(page.locator("#main-content").getByText(email, { exact: true })).toBeVisible();
});

test("switch language and persist English", async ({ page }) => {
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page.getByText("Welcome back", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Welcome back", { exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

test("sidebar stays mounted and content stays aligned during client-side navigation", async ({ page }) => {
  const sidebar = page.getByTestId("app-sidebar");
  const documentProbe = await page.evaluate(() => {
    document.documentElement.dataset.e2eDocument = crypto.randomUUID();
    return document.documentElement.dataset.e2eDocument;
  });
  const sidebarProbe = await sidebar.evaluate((element) => {
    element.dataset.e2eInstance = crypto.randomUUID();
    return element.dataset.e2eInstance;
  });
  await sidebar.getByRole("link", { name: "财务", exact: true }).click();
  await expect(page).toHaveURL(/\/finance$/);
  await expect(page.getByRole("heading", { name: "财务明细", exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-e2e-document", documentProbe);
  await expect(page.getByTestId("app-sidebar")).toHaveAttribute("data-e2e-instance", sidebarProbe);
  await expect(page.getByTestId("app-sidebar").getByRole("link", { name: "财务", exact: true })).toHaveAttribute("aria-current", "page");
  const contentLeft = await page.locator("#main-content > main").evaluate((element) => element.getBoundingClientRect().left);
  for (const destination of ["开卡中心", "管理", "设置"] as const) {
    const link = sidebar.getByRole("link", { name: destination, exact: true });
    await link.click();
    await expect(link).toHaveAttribute("aria-current", "page");
    await expect(page.locator("#main-content h1")).toBeVisible();
    await expect.poll(() => page.locator("#main-content > main").evaluate((element) => element.getBoundingClientRect().left)).toBe(contentLeft);
  }
  await expect(page.locator("html")).toHaveCSS("scrollbar-gutter", "stable");
  await expect(page.locator("#main-content > main")).toHaveCSS("animation-fill-mode", "both");
});

test("mobile sidebar expands, closes after navigation, and responds to Escape", async ({ page }) => {
  await mockAuthenticatedShell(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");

  const sidebar = page.getByTestId("app-sidebar");
  const toggle = sidebar.locator(".mobile-sidebar-toggle");
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(sidebar.getByText("财务", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("hidden");
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");
  expect((await sidebar.boundingBox())!.width).toBeGreaterThan(240);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  await sidebar.getByRole("link", { name: "财务", exact: true }).click();
  await expect(page).toHaveURL(/\/finance$/);
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("");

  await toggle.click();
  await page.keyboard.press("Escape");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toBeFocused();

  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(toggle).toBeHidden();
});

test("authenticated pages keep their layout visible while data loads", async ({ page }) => {
  await mockAuthenticatedShell(page);
  await page.unroute("**/api/dashboard");
  let releaseDashboard!: () => void;
  const dashboardGate = new Promise<void>((resolve) => { releaseDashboard = resolve; });
  await page.route("**/api/dashboard", async (route) => {
    await dashboardGate;
    await route.fulfill({ json: {
      email: "admin@danewcard.local", role: "admin", walletBalance: "0.0000", cardBalance: "0.0000",
      cardCount: 0, inviteCode: "DANEW",
    } });
  });

  await page.goto("/dashboard");
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
  await expect(page.locator("main.dashboard[aria-busy='true']")).toBeVisible();
  await expect(page.locator(".loading-skeleton").first()).toBeVisible();
  await expect(page.locator("main.center")).toHaveCount(0);

  releaseDashboard();
  await expect(page.locator("main.dashboard[aria-busy='true']")).toHaveCount(0);
  await expect(page.getByText("$0", { exact: true }).first()).toBeVisible();
});

test("card refund refreshes changed balance automatically in finance and dashboard", async ({ page }) => {
  await page.clock.install();
  await mockAuthenticatedShell(page, "user");
  let balance = "100";
  await page.route("**/api/dashboard", route => route.fulfill({ json: {
    userId: 9, email: "refund@example.test", role: "user", walletBalance: balance,
    lockedBalance: "0", spendableBalance: balance, cardBalance: "0", cardCount: 0, inviteCode: "REFUND9",
  } }));
  await page.route("**/api/wallet", route => route.fulfill({ json: { code: 0, data: {
    balance, spendableBalance: balance, lockedBalance: "0", promoBalance: "0", cumulativeDeposit: "100", cumulativeSpend: "0",
  } } }));
  await page.route("**/api/wallet/transactions", route => route.fulfill({ json: { code: 0, data: {
    total: balance === "100" ? 0 : 1, list: balance === "100" ? [] : [{
      id: 1, type: "card_refund", amount: "1", balanceBefore: "100", balanceAfter: "101",
      remark: "上游卡片退款自动同步", createdAt: "2026-09-06T16:41:20Z",
    }],
  } } }));
  await page.goto("/finance");
  await expect(page.getByTestId("wallet-balance-summary")).toContainText("$100");
  balance = "101";
  await page.clock.fastForward(10_000);
  await expect(page.getByTestId("wallet-balance-summary")).toContainText("$101");
  await expect(page.getByText("上游卡片退款自动同步", { exact: true })).toBeVisible();
  await page.goto("/dashboard");
  await expect(page.locator("main.dashboard").getByText("$101", { exact: true }).first()).toBeVisible();
  balance = "102";
  await page.clock.fastForward(30_000);
  await expect(page.locator("main.dashboard").getByText("$102", { exact: true }).first()).toBeVisible();
});

test("mobile sidebar expands wallet risk summaries without horizontal overflow", async ({ page }) => {
  await mockAuthenticatedShell(page, "user");
  await page.setViewportSize({ width: 390, height: 844 });
  const paymentRisk = {
    enabled: true, windowDays: 30, minAttempts: 100, lockThresholdBps: 3000,
    releaseThresholdBps: 2000, reserveBps: 2000, attempts: 120, successes: 84,
    declines: 36, successRateBps: 7000, declineRateBps: 3000, reserveActive: true,
    evaluatedAt: "2026-08-17T08:00:00Z",
  };
  await page.route("**/api/dashboard", (route) => route.fulfill({ json: {
    userId: 9, email: "risk@example.com", displayName: "Risk User", role: "user",
    walletBalance: "100.0000", lockedBalance: "20.0000", spendableBalance: "80.0000",
    paymentRisk, cardBalance: "0.0000", cardCount: 0, inviteCode: "RISK9",
  } }));
  await page.route("**/api/wallet", (route) => route.fulfill({ json: { code: 0, data: {
    balance: "100.0000", lockedBalance: "20.0000", spendableBalance: "80.0000", paymentRisk,
    promoBalance: "0.0000", cumulativeDeposit: "100.0000", cumulativeSpend: "0.0000",
  } } }));
  await page.route("**/api/wallet/transactions", (route) => route.fulfill({ json: { code: 0, data: { total: 0, list: [] } } }));

  await page.goto("/dashboard");
  await expect(page.getByText("$100", { exact: true })).toBeVisible();
  await expect(page.getByText("$20", { exact: true })).toBeVisible();
  await expect(page.getByText("$80", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("30%", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  paymentRisk.reserveActive = false;
  await page.goto("/finance");
  await expect(page.getByTestId("wallet-balance-summary")).toContainText("风控锁定余额");
  await expect(page.getByTestId("payment-risk-summary")).toContainText("自动拒付率比例锁定未触发");
  await expect(page.getByTestId("payment-risk-summary")).not.toContainText("未触发风控锁定");
  await expect(page.getByTestId("payment-risk-summary")).toContainText("支付成功率70%");
  await expect(page.getByTestId("payment-risk-summary")).toContainText("支付拒付率30%");
  await expect(page.getByTestId("payment-risk-summary")).toContainText("拒付率必须低于 20% 才释放锁定；等于 20% 时仍保持锁定。");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page.getByTestId("payment-risk-summary")).toContainText("The decline rate must be below 20% to release the reserve; at exactly 20%, the reserve remains active.");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("all admin pages share the light theme and fit the mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const sidebar = page.getByTestId("app-sidebar");
  const sidebarProbe = await sidebar.evaluate((element) => {
    element.dataset.e2eTheme = crypto.randomUUID();
    return element.dataset.e2eTheme;
  });
  const destinations = [
    ["概览", "/dashboard"],
    ["开卡中心", "/cards"],
    ["财务", "/finance"],
    ["充值", "/deposit"],
    ["奖励", "/rewards"],
    ["代理", "/referral"],
    ["API", "/developer"],
    ["支付参考", "/openai-prices"],
    ["管理", "/admin"],
    ["设置", "/settings"],
  ] as const;

  for (const [label, path] of destinations) {
    const link = sidebar.getByRole("link", { name: label, exact: true });
    await link.click();
    await expect(page).toHaveURL(new RegExp(`${path.replace("/", "\\/")}$`));
    await expect(link).toHaveAttribute("aria-current", "page");
    await expect(page.locator("#main-content h1")).toHaveCount(1);
    await expect(page.locator("#main-content h1")).toBeVisible();
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe("light");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      await page.evaluate(() => document.documentElement.clientWidth),
    );
    await expect(sidebar).toHaveAttribute("data-e2e-theme", sidebarProbe);
  }
});

test("membership center shows the current tier, upgrade progress, and every benefit", async ({ page }) => {
  await mockAuthenticatedShell(page);
  const tier = (input: Partial<Record<string, string>>) => ({
    code: "none", nameZh: "普通会员", nameEn: "Standard", descriptionZh: "日常支付基础权益", descriptionEn: "Everyday payment benefits",
    thresholdAmount: "0.0000", minimumOpenFee: "1.0000", minimumRechargeRate: "0.010000",
    referralOpenReward: "0.2000", referralRechargeRate: "0.002000", declineFee: "0.0000", gptDirectMinimumFee: "1.0000",
    ...input,
  });
  const standard = tier({});
  const growth = tier({ code: "growth", nameZh: "进阶会员", nameEn: "Growth", descriptionZh: "为高频支付提供更优价格", descriptionEn: "Better pricing for frequent payments", thresholdAmount: "3000.0000" });
  const privateTier = tier({ code: "private", nameZh: "尊享会员", nameEn: "Private", descriptionZh: "面向长期客户的专属权益", descriptionEn: "Exclusive benefits for long-term clients", thresholdAmount: "5000.0000" });
  await page.route("**/api/membership", (route) => route.fulfill({ json: { code: 0, data: {
    currentTier: growth, cumulativeRecharge: "4000.0000", nextTier: privateTier, tiers: [standard, growth, privateTier],
  } } }));

  await page.goto("/dashboard");
  const membershipResponse = page.waitForResponse("**/api/membership");
  await page.getByTestId("app-sidebar").getByRole("link", { name: "会员中心", exact: true }).click();
  const membershipPayload = await (await membershipResponse).json();
  expect(JSON.stringify(membershipPayload)).not.toMatch(/(?:open|recharge|refund|gptDirect)Multiplier/);
  expect(JSON.stringify(membershipPayload)).not.toContain('"version"');
  await expect(page).toHaveURL(/\/membership$/);
  await expect(page.getByRole("heading", { name: "会员中心", exact: true })).toBeVisible();
  await expect(page.getByText("进阶会员", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("再累计充值 $1000 即可升级", { exact: true })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "会员升级进度" })).toHaveAttribute("value", "50");
  await expect(page.getByTestId("membership-tier-none")).toContainText("已解锁");
  await expect(page.getByTestId("membership-tier-growth")).toContainText("当前");
  await expect(page.getByTestId("membership-tier-private")).toContainText("待解锁");
  await expect(page.getByTestId("membership-tier-growth")).toContainText("会员专属开卡价，最低 $1");
  await expect(page.getByTestId("membership-tier-growth")).toContainText("会员专属充值费率，最低 1%");
  await expect(page.getByTestId("membership-tier-growth")).toContainText("卡消费退款享受会员专属手续费率");
  await expect(page.getByTestId("membership-tier-growth")).toContainText("拒付费每笔 $0");
  await expect(page.getByTestId("membership-tier-growth")).toContainText("会员专属 OpenAI 服务费，最低 $1");
  await expect(page.locator(".membership-page")).not.toContainText("倍率");
  await expect(page.locator(".membership-page")).not.toContainText("×");

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => document.documentElement.clientWidth),
  );
});

test("admin saves tier presentation even when product pricing preview is unavailable", async ({ page }) => {
  await mockAuthenticatedShell(page);
  let profileBody: Record<string, unknown> | null = null;
  let previewBody: Record<string, unknown> | null = null;
  let profileKey = "";
  await mockAdminWorkspace(page, {
    onTierProfile: (body, key) => { profileBody = body; profileKey = key; },
  });
  await page.route("**/api/admin/pricing/preview", (route) => {
    previewBody = route.request().postDataJSON() as Record<string, unknown>;
    return route.fulfill({ status: 409, json: { error: "产品同步暂不可用" } });
  });
  await page.goto("/admin");
  await page.getByTestId("admin-nav-tiers").click();
  const editor = page.getByTestId("pricing-tier-none");

  await expect(editor.getByLabel("开卡费率", { exact: true })).toHaveValue("1.25");
  await expect(editor).not.toContainText("开卡倍率");
  await expect(editor.getByLabel("直属开卡返利（USD）", { exact: true })).toHaveCount(0);
  await expect(editor.getByLabel("直属卡充值返利率", { exact: true })).toHaveCount(0);
  await expect(editor.getByLabel("拒付费（每笔，USD）", { exact: true })).toHaveValue("0");
  await expect(editor.getByLabel("消费退款手续费倍率", { exact: true })).toHaveValue("1.25");
  await editor.getByRole("button", { name: "预览全部产品", exact: true }).click();
  await expect.poll(() => previewBody).toEqual({ tierCode: "none", version: 1, openMultiplier: "1.25", minimumOpenFee: "0",
    rechargeMultiplier: "1.25", minimumRechargeRate: "0", declineFee: "0", refundMultiplier: "1.25",
    gptDirectMultiplier: "1.25", gptDirectMinimumFee: "1" });
  await expect(editor.getByRole("alert").filter({ hasText: "产品同步暂不可用" })).toBeVisible();
  await editor.getByLabel("中文名称", { exact: true }).fill("无限会员");
  await editor.getByLabel("英文名称", { exact: true }).fill("Infinite");
  await editor.locator(".tier-profile-form textarea").nth(0).fill("长期客户专属价格与服务");
  await editor.locator(".tier-profile-form textarea").nth(1).fill("Exclusive pricing and service for long-term clients");
  await editor.getByLabel("累计充值门槛（USD）", { exact: true }).fill("0");
  await editor.getByRole("button", { name: "保存等级资料", exact: true }).click();

  await expect.poll(() => profileBody).toEqual({
    version: 1,
    nameZh: "无限会员",
    nameEn: "Infinite",
    descriptionZh: "长期客户专属价格与服务",
    descriptionEn: "Exclusive pricing and service for long-term clients",
    thresholdAmount: "0",
  });
  expect(profileKey).toMatch(/^[0-9a-f-]{36}$/);
});

test("admin pricing preview shows the final purchase-refund rate and margin", async ({ page }) => {
  await mockAuthenticatedShell(page);
  await mockAdminWorkspace(page);
  await page.route("**/api/admin/pricing/preview", (route) => route.fulfill({ json: { code: 0, data: {
    tierCode: "none",
    version: 1,
    products: [{
      productCode: "P5378OX",
      costOpenFee: "0.4000",
      saleOpenFee: "0.5000",
      openProfit: "0.1000",
      costRechargeRate: "0.005000",
      saleRechargeRate: "0.006250",
      rechargeMargin: "0.001250",
      costRtfRate: "0.100000",
      saleRefundRate: "0.125000",
      refundMargin: "0.025000",
    }],
    declineFee: "0.0000",
    gptDirectPricing: { multiplier: "1.250000", minimumFee: "1.0000" },
  } } }));

  await page.goto("/admin");
  await page.getByTestId("admin-nav-tiers").click();
  await page.getByTestId("pricing-tier-none").getByRole("button", { name: "预览全部产品", exact: true }).click();
  const preview = page.locator(".pricing-preview");
  await expect(preview).toBeVisible({ timeout: 10_000 });
  await expect(preview.getByRole("columnheader", { name: "消费退款最终手续费率", exact: true })).toBeVisible();
  await expect(preview.getByRole("columnheader", { name: "消费退款毛利率", exact: true })).toBeVisible();
  await expect(preview.getByTestId("referral-reward-preview")).toHaveCount(0);
  await expect(preview.getByTestId("decline-fee-preview")).toHaveText("拒付费：每笔 $0。");
  await expect(preview.getByRole("row").filter({ hasText: "P5378OX" })).toContainText("12.5%");
  await expect(preview.getByRole("row").filter({ hasText: "P5378OX" })).toContainText("+2.5%");
});

test("admin previews and saves the confirmed-profit referral policy", async ({ page }) => {
  expect(shiftDecimal("0.500000", 2)).toBe("50");
  expect(shiftDecimal("33.3333", -2, 6)).toBe("0.333333");
  expect(formatRateAsPercent("0.000001")).toBe("0.0001%");
  await mockAuthenticatedShell(page);
  let previewBody: Record<string, unknown> | null = null;
  const applyAttempts: Array<{ body: Record<string, unknown>; key: string }> = [];
  await mockAdminWorkspace(page, {
    onReferralPolicyPreview: (body) => { previewBody = body; },
    onReferralPolicyApply: (body, key) => { applyAttempts.push({ body, key }); },
    failFirstReferralPolicyApply: true,
  });

  await page.goto("/admin");
  await page.getByTestId("admin-nav-tiers").click();
  const policy = page.getByTestId("admin-referral-policy");
  await expect(policy.getByLabel("已确认正毛利返利比例（%）", { exact: true })).toHaveValue("50");
  await expect(policy.getByLabel("用户端展示样式", { exact: true })).toHaveValue("equivalent");
  await expect(policy).toContainText("唯一结算规则");
  await expect(policy).toContainText("比例在订单创建时锁定");
  await expect(page.getByTestId("pricing-tier-none")).not.toContainText("直属开卡返利");

  await policy.getByLabel("已确认正毛利返利比例（%）", { exact: true }).fill("60");
  await policy.getByRole("button", { name: "预览返利策略", exact: true }).click();
  await expect.poll(() => previewBody).toEqual({ profitShareRate: "0.600000", displayMode: "equivalent", version: 1 });
  await expect(policy.getByTestId("admin-referral-policy-preview")).toContainText("$0.72");
  await expect(policy.getByTestId("admin-referral-policy-preview")).toContainText("1.2%");
  await policy.getByRole("button", { name: "保存返利策略", exact: true }).click();
  await expect.poll(() => applyAttempts.length).toBe(1);
  await expect(policy.getByRole("alert")).toContainText("暂时未知");
  await policy.getByRole("button", { name: "保存返利策略", exact: true }).click();
  await expect.poll(() => applyAttempts.length).toBe(2);
  expect(applyAttempts[0].body).toEqual({ profitShareRate: "0.600000", displayMode: "equivalent", version: 1 });
  expect(applyAttempts[1].body).toEqual(applyAttempts[0].body);
  expect(applyAttempts[0].key).toMatch(/^[0-9a-f-]{36}$/);
  expect(applyAttempts[1].key).toBe(applyAttempts[0].key);
  await expect(policy).toContainText("策略版本 2");
  await policy.getByLabel("已确认正毛利返利比例（%）", { exact: true }).fill("70");
  await policy.getByRole("button", { name: "预览返利策略", exact: true }).click();
  await expect.poll(() => previewBody).toEqual({ profitShareRate: "0.700000", displayMode: "equivalent", version: 2 });
  await policy.getByRole("button", { name: "保存返利策略", exact: true }).click();
  await expect.poll(() => applyAttempts.length).toBe(3);
  expect(applyAttempts[2].key).not.toBe(applyAttempts[1].key);
  await expect(policy).toContainText("策略版本 3");

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page.getByTestId("admin-referral-policy")).toContainText("confirmed positive profit");
});

test("mobile finance keeps the transfer action available", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/finance");
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
  await expect(page.getByTestId("app-sidebar").getByRole("link", { name: "财务", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("button", { name: "余额转账", exact: true })).toBeVisible();
  await expect(page.getByText(/\d+ 条记录/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("agent loads subaccounts, saves rates, and reports rejected updates", async ({ page }) => {
  const submissions: Record<string, unknown>[] = [];
  let subUser = {
    id: 77, email: "customer@agent.example", walletBalance: "50.0000",
    subRechargeRate: "0.020000", agentRechargeRate: "0.010000", spreadRate: "0.010000",
  };
  await page.route("**/api/dashboard", (route) => route.fulfill({ json: {
    email: "agent@example.com", role: "agent", walletBalance: "100.0000",
    cardBalance: "0.0000", cardCount: 0, inviteCode: "AGENT77",
  } }));
  await page.route("**/api/agent", (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: {
      code: 0, data: { pricingEffective: true, statusReasonCode: "ACTIVE", subUsers: [subUser] },
    } });
    const body = route.request().postDataJSON() as Record<string, unknown>;
    submissions.push(body);
    if (submissions.length === 2) return route.fulfill({
      status: 422, json: { error: "代理费率必须满足成本不高于客户费率" },
    });
    subUser = {
      ...subUser,
      subRechargeRate: String(body.subRechargeRate),
      agentRechargeRate: String(body.agentRechargeRate),
      spreadRate: "0.015000",
    };
    return route.fulfill({ json: { code: 0, msg: "updated" } });
  });

  await page.reload();
  await page.getByRole("link", { name: "代理账户", exact: true }).click();
  await expect(page.getByRole("heading", { name: "代理账户", exact: true })).toBeVisible();
  const row = page.locator(".transaction-row").filter({ hasText: subUser.email });
  await expect(row).toBeVisible();
  await row.getByLabel("成本", { exact: true }).fill("0.015000");
  await row.getByLabel("客户", { exact: true }).fill("0.030000");
  await row.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => submissions).toHaveLength(1);
  expect(submissions[0]).toEqual({ subUserId: 77, subRechargeRate: "0.030000", agentRechargeRate: "0.015000" });
  await expect(row).toContainText("spread 0.015");

  await row.getByLabel("成本", { exact: true }).fill("0.040000");
  await row.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => submissions).toHaveLength(2);
  await expect(page.getByRole("alert")).toHaveText("代理费率必须满足成本不高于客户费率");
});

test("GPT existing card funding arithmetic preserves precision and card limits", () => {
  expect(fundingAmount("19", "15.99906060", "10", "500")).toBe("0.0000");
  expect(fundingAmount("3", "180", "1", "500")).toBe("180.0000");
  expect(fundingAmount("180", "180", "1", "500")).toBe("3.0000");
  expect(fundingAmount("183", "180", "1", "500")).toBe("0.0000");
  expect(fundingAmount("5", "15.99906060", "1", "500")).toBe("14.0000");
  expect(fundingAmount("15", "15.99906060", "10", "500")).toBe("10.0000");
  expect(fundingAmount("5.0001", "15.99906060", "1", "500")).toBe("14.0000");
  expect(fundingAmount("5.00000000", "15.99906060", "1.000000", "500.000000")).toBe("14.0000");
  expect(fundingTotal("14", "0.0001")).toBe("14.0001");
  expect(fundingCovered("14.0000", "14.0001")).toBe(false);
  for (const bad of ["", "NaN", "-1", "1e2", "0", "0.000000001"]) {
    expect(() => fundingAmount("5", bad, "1", "500")).toThrow();
  }
  expect(() => fundingAmount("0", "100", "1", "50")).toThrow();
});

async function mockExistingFunding(page: Page, options: { balance?: string; wallet?: string; stale?: boolean; syncFails?: boolean; proUpgrade?: boolean } = {}) {
  await mockAuthenticatedShell(page, "customer");
  const creates: Record<string, unknown>[] = [];
  const actions: Array<{ key: string; body: Record<string, unknown> }> = [];
  const state = { balance: options.balance ?? "5.0000", fee: "0.1400", syncs: 0 };
  await mockGptDirect(page, { detailStatuses: ["completed"], onCreate: body => creates.push(body),
    preflightResponse: options.proUpgrade ? (_body, call) => ({
      email:"masked@example.test", currentPlan:"plus", credentialMode:"session",
      preflightToken:`funding-pro-${call}`,preflightExpiresAt:"2099-01-01T00:00:00Z",
      paymentCountry:"US",paymentCurrency:"USD",quoteError:"",
      quoteEstimatesUsd:{pro_20x:"180"}, quotes:{pro_20x:{
        country:"US",currency:"USD",plan:"pro",amountMinor:18000,amountMajor:180,minorUnitExponent:2,
      }},
    }) : undefined,
  });
  await page.route("**/api/cards/91", route => route.fulfill({ json: { code: 0, data: {
    id: 91, status: "ACTIVE", availableAmount: state.balance, minAmount: "1.0000", maxAmount: "500.0000",
    pendingOperationId: null, upstreamSyncedAt: options.stale && !state.syncs ? "2020-01-01T00:00:00Z" : new Date().toISOString(),
  } } }));
  await page.route("**/api/cards/91/sync", route => {
    state.syncs += 1;
    return options.syncFails ? route.fulfill({ status: 503, json: { error: "sync unavailable" } })
      : route.fulfill({ json: { code: 0, data: { cardId: 91, balance: state.balance, status: "ACTIVE", balanceSnapshotApplied: true } } });
  });
  await page.route("**/api/wallet", route => route.fulfill({ json: { code: 0, data: { balance: "1000", spendableBalance: options.wallet ?? "100" } } }));
  await page.route("**/api/cards/91/recharge-quote", route => {
    const amount = route.request().postDataJSON().amount;
    return route.fulfill({ json: { code: 0, data: { amount, fee: state.fee, totalDebit: fundingTotal(amount, state.fee), effectiveRechargeRate: "0.01" } } });
  });
  await page.route("**/api/cards/91/actions", route => {
    const body = route.request().postDataJSON();
    actions.push({ key: route.request().headers()["idempotency-key"], body });
    state.balance = fundingTotal(state.balance, body.amount);
    return route.fulfill({ json: { code: 0, data: { status: "ACTIVE", cardBalance: state.balance, walletBalance: "90", fee: body.expectedFee } } });
  });
  async function preflight() {
    await page.getByLabel("Session 凭据", { exact: true }).fill('{"sessionToken":"funding-test-secret"}');
    await page.getByRole("button", { name: "验证凭据与获取报价", exact: true }).click();
    await expect(page.getByRole("button", { name: "提交开通", exact: true })).toBeEnabled();
  }
  await page.goto("/gpt-direct");
  await expect(page.locator(".gpt-direct-form")).toBeVisible();
  if (await page.getByRole("dialog").isVisible()) {
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  await preflight();
  return { state, actions, creates, preflight };
}

test("GPT existing card with three dollars cannot submit a 180 dollar Pro upgrade", async ({ page }) => {
  const { state, actions, creates } = await mockExistingFunding(page, { balance:"3", wallet:"500", proUpgrade:true });
  await page.getByRole("button", { name:"提交开通", exact:true }).click();
  await expect(page.getByTestId("gpt-funding-review")).toContainText("$180");
  expect(creates).toHaveLength(0);
  expect(actions).toHaveLength(0);
  await page.getByRole("button", { name:"确认补款并继续直充", exact:true }).click();
  await expect.poll(() => creates.length).toBe(1);
  expect(actions).toHaveLength(1);
  expect(actions[0].body.amount).toBe("180.0000");
  expect(state.balance).toBe("183.0000");
  expect(creates[0].plan).toBe("pro_20x");
});

test("GPT existing card quote also funds auto-card from the live quote instead of the checkout ceiling", async ({ page }) => {
  await mockAuthenticatedShell(page, "customer");
  await mockGptDirect(page, { preflightResponse: (_body, call) => ({
    email:"masked@example.test", currentPlan:"free", credentialMode:"session",
    preflightToken:`display-quote-${call}`,preflightExpiresAt:"2099-01-01T00:00:00Z",
    paymentCountry:"PH",paymentCurrency:"PHP",quoteError:"",
    displayQuoteEstimatesUsd:{pro_20x:"142.53584720"},
    quoteEstimatesUsd:{pro_20x:"142.53584720"}, quotes:{pro_20x:{
      country:"PH",currency:"PHP",plan:"pro",amountMinor:891964,amountMajor:8919.64,minorUnitExponent:2,
    }},
  }) });
  await page.goto("/gpt-direct");
  await page.locator('input[name="cardMode"][value="auto"]').check({ force: true });
  await page.locator('.gpt-plan-options input[value="pro_20x"]').check();
  await page.getByLabel("Session 凭据", { exact:true }).fill("test-session");
  await page.getByRole("button", { name:"验证凭据与获取报价", exact:true }).click();
  await expect(page.locator(".gpt-preflight-result")).toContainText("约 $142.5358472 USD");
  await expect(page.locator(".gpt-auto-card-review")).toContainText("$145.54");
  await expect(page.locator(".gpt-auto-card-review")).not.toContainText("$162.65");
});

test("GPT existing card confirms the gap and funds once before Direct", async ({ page }, testInfo) => {
  const { state, actions, creates } = await mockExistingFunding(page, { stale: true });
  await page.getByRole("button", { name: "提交开通", exact: true }).click();
  const review = page.getByTestId("gpt-funding-review");
  await expect(review).toContainText("$15.39");
  await expect(review).toContainText("$14");
  expect(actions).toHaveLength(0);
  expect(creates).toHaveLength(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByTestId("gpt-existing-checkout").screenshot({ path: testInfo.outputPath("existing-card-funding-mobile.png") });
  await page.getByRole("button", { name: "确认补款并继续直充", exact: true }).click();
  await expect.poll(() => creates.length).toBe(1);
  expect(actions).toHaveLength(1);
  expect(actions[0].body).toEqual({ action: "recharge", amount: "14.0000", expectedFee: "0.1400" });
  expect(actions[0].key).toMatch(/^[0-9a-f-]{36}$/);
  expect(state.syncs).toBe(1);
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain("funding-test-secret");
});

test("GPT existing card preserves sufficient balance and blocks a low wallet", async ({ page }) => {
  const sufficient = await mockExistingFunding(page, { balance: "19" });
  await page.getByRole("button", { name: "提交开通", exact: true }).click();
  await expect.poll(() => sufficient.creates.length).toBe(1);
  expect(sufficient.actions).toHaveLength(0);
  expect(sufficient.state.syncs).toBe(0);
  const low = await mockExistingFunding(page, { wallet: "15.3899" });
  await page.getByRole("button", { name: "提交开通", exact: true }).click();
  await expect(page.getByRole("button", { name: "确认补款并继续直充", exact: true })).toBeDisabled();
  await expect(page.getByRole("link", { name: "去充值钱包", exact: true })).toBeVisible();
  expect(low.creates).toHaveLength(0);
  expect(low.actions).toHaveLength(0);
});

test("GPT existing card rechecks changed fees before charging", async ({ page }) => {
  const { state, actions, creates } = await mockExistingFunding(page);
  await page.getByRole("button", { name: "提交开通", exact: true }).click();
  await expect(page.getByTestId("gpt-funding-review")).toBeVisible();
  state.fee = "0.2800";
  await page.getByRole("button", { name: "确认补款并继续直充", exact: true }).click();
  await expect(page.getByTestId("gpt-existing-checkout")).toContainText("请核对最新金额后再次确认");
  expect(actions).toHaveLength(0);
  expect(creates).toHaveLength(0);
  await page.getByRole("button", { name: "确认补款并继续直充", exact: true }).click();
  await expect.poll(() => creates.length).toBe(1);
  expect(actions[0].body.expectedFee).toBe("0.2800");
});

test("GPT existing card never pays while balance synchronization fails", async ({ page }) => {
  const { actions, creates } = await mockExistingFunding(page, { stale: true, syncFails: true });
  await page.getByRole("button", { name: "提交开通", exact: true }).click();
  await expect(page.getByTestId("gpt-existing-checkout")).toContainText("sync unavailable");
  expect(actions).toHaveLength(0);
  expect(creates).toHaveLength(0);
});

test("GPT existing card persists uncertain funding and reuses its key after reload", async ({ page }) => {
  const { state, creates, preflight } = await mockExistingFunding(page);
  const keys: string[] = [];
  await page.route("**/api/cards/91/actions", route => {
    keys.push(route.request().headers()["idempotency-key"]);
    state.balance = "19.0000";
    if (keys.length === 1) return route.abort("failed");
    return route.fulfill({ json: { code: 0, data: { status: "ACTIVE", cardBalance: state.balance, walletBalance: "90", fee: "0.14" } } });
  });
  await page.getByRole("button", { name: "提交开通", exact: true }).click();
  await page.getByRole("button", { name: "确认补款并继续直充", exact: true }).click();
  await expect(page.getByRole("button", { name: "核对充值结果并继续", exact: true })).toBeEnabled();
  expect(creates).toHaveLength(0);
  await page.reload();
  await preflight();
  await page.getByRole("button", { name: "提交开通", exact: true }).click();
  await expect.poll(() => creates.length).toBe(1);
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
});

test("GPT existing card polls pending funding without sending a second recharge", async ({ page }) => {
  const { state, creates } = await mockExistingFunding(page);
  let recharges = 0;
  let checks = 0;
  await page.route("**/api/cards/91/actions", route => {
    recharges += 1;
    return route.fulfill({ status: 202, json: { operationId: "funding-operation", error: "pending" } });
  });
  await page.route("**/api/operations/funding-operation", route => {
    checks += 1;
    if (checks > 1) state.balance = "19";
    return route.fulfill({ json: { code: 0, data: { operationId: "funding-operation", type: "RECHARGE", status: checks > 1 ? "SUCCEEDED" : "PENDING", terminal: checks > 1 } } });
  });
  await page.getByRole("button", { name: "提交开通", exact: true }).click();
  await page.getByRole("button", { name: "确认补款并继续直充", exact: true }).click();
  await expect.poll(() => checks).toBe(1);
  expect(creates).toHaveLength(0);
  await expect.poll(() => creates.length).toBe(1);
  expect(recharges).toBe(1);
});

test("GPT existing card stops after a confirmed failed recharge", async ({ page }) => {
  const { creates } = await mockExistingFunding(page);
  let recharges = 0;
  await page.route("**/api/cards/91/actions", route => {
    recharges += 1;
    return route.fulfill({ status: 202, json: { operationId: "failed-funding", error: "pending" } });
  });
  await page.route("**/api/operations/failed-funding", route => route.fulfill({ json: { code: 0, data: {
    operationId: "failed-funding", type: "RECHARGE", status: "FAILED", terminal: true,
  } } }));
  await page.getByRole("button", { name: "提交开通", exact: true }).click();
  await page.getByRole("button", { name: "确认补款并继续直充", exact: true }).click();
  await expect(page.getByTestId("gpt-existing-checkout")).toContainText("原卡片充值已确认失败");
  expect(recharges).toBe(1);
  expect(creates).toHaveLength(0);
  expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith("gpt-card-funding:")))).toHaveLength(0);
  await page.getByRole("button", { name: "提交开通", exact: true }).click();
  await expect(page.getByRole("button", { name: "确认补款并继续直充", exact: true })).toBeEnabled();
  expect(recharges).toBe(1);
});

test("GPT existing card retains successful funding when the Direct quote expires", async ({ page }) => {
  const { state, creates, preflight } = await mockExistingFunding(page);
  let recharges = 0;
  await page.route("**/api/cards/91/actions", async route => {
    recharges += 1;
    state.balance = "19";
    await page.clock.setFixedTime(new Date("2100-01-01T00:00:00Z"));
    return route.fulfill({ json: { code: 0, data: { status: "ACTIVE", cardBalance: state.balance } } });
  });
  await page.getByRole("button", { name: "提交开通", exact: true }).click();
  await page.getByRole("button", { name: "确认补款并继续直充", exact: true }).click();
  await expect(page.getByTestId("gpt-existing-checkout")).toContainText("直充报价已过期");
  expect(creates).toHaveLength(0);
  expect(await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith("gpt-card-funding:")).map(([, value]) => JSON.parse(value).succeeded))).toEqual([true]);
  await page.clock.setFixedTime(new Date());
  await page.reload();
  await preflight();
  await page.getByRole("button", { name: "提交开通", exact: true }).click();
  await expect.poll(() => creates.length).toBe(1);
  expect(recharges).toBe(1);
});

test("GPT existing card retries an uncertain Direct order without topping up again", async ({ page }) => {
  const { state, actions, creates } = await mockExistingFunding(page);
  const orderKeys: string[] = [];
  await page.route("**/api/gpt-direct/orders", route => {
    if (route.request().method() !== "POST") return route.fallback();
    orderKeys.push(route.request().headers()["idempotency-key"]);
    if (orderKeys.length === 1) {
      state.balance = "0";
      return route.fulfill({ status: 503, json: { error: "order response uncertain" } });
    }
    return route.fallback();
  });
  await page.getByRole("button", { name: "提交开通", exact: true }).click();
  await page.getByRole("button", { name: "确认补款并继续直充", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("order response uncertain");
  await page.getByRole("button", { name: "提交开通", exact: true }).click();
  await expect.poll(() => creates.length).toBe(1);
  expect(actions).toHaveLength(1);
  expect(orderKeys).toHaveLength(2);
  expect(orderKeys[1]).toBe(orderKeys[0]);
});

test("session continuity refreshes during payment without losing the preflight or duplicating payment", async ({ page }) => {
  await mockAuthenticatedShell(page,"customer");
  let accepted=0;
  let refreshes=0;
  const attempts: Array<{body:string|null;key:string|undefined;authorization:string|undefined}>=[];
  await mockGptDirect(page,{onCreate:()=>{accepted+=1;}});
  await page.route("**/api/auth/refresh",async route=>{
    refreshes+=1;
    await route.fulfill({status:204});
  });
  await page.route("**/api/gpt-direct/orders",async route=>{
    if(route.request().method()!=="POST") return route.fallback();
    const headers=route.request().headers();
    attempts.push({body:route.request().postData(),key:headers["idempotency-key"],authorization:headers.authorization});
    if(attempts.length===1) return route.fulfill({status:401,json:{error:"Access expired",errorCode:"AUTH_REQUIRED"}});
    return route.fallback();
  });
  await page.goto("/gpt-direct");
  await page.evaluate(()=>{
    const current=JSON.parse(localStorage.getItem("session")!);
    const value=JSON.stringify({...current,token:"legacy-expired-access"});
    localStorage.setItem("session",value);
    window.dispatchEvent(new StorageEvent("storage",{key:"session",newValue:value,storageArea:localStorage}));
  });
  await page.getByLabel("Session 凭据",{exact:true}).fill("preflight-must-survive-refresh");
  await page.getByRole("button",{name:"验证凭据与获取报价",exact:true}).click();
  await expect(page.locator(".gpt-preflight-result")).toBeVisible();
  await page.getByRole("button",{name:"提交开通",exact:true}).click();
  await expect.poll(()=>accepted).toBe(1);
  expect(refreshes).toBe(1);
  expect(attempts).toHaveLength(2);
  expect(attempts[1].key).toBe(attempts[0].key);
  expect(attempts[1].body).toBe(attempts[0].body);
  expect(attempts[1].body).toContain("preflight-must-survive-refresh");
  expect(attempts[0].authorization).toBe("Bearer legacy-expired-access");
  expect(attempts[1].authorization).toBeUndefined();
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem("session")!).token)).toBe("");
  await expect(page).toHaveURL(/\/gpt-direct$/);
});

for (const refreshStatus of [401,503]) {
  test(`session continuity heartbeat handles refresh ${refreshStatus} before another payment`,async({page})=>{
    await page.clock.install();
    let expired=false;
    let refreshes=0;
    await page.addInitScript(()=>{
      if(location.pathname!=="/login") localStorage.setItem("session",JSON.stringify({token:"legacy-expired-access",email:"session@example.test"}));
    });
    await page.route("**/api/features",route=>route.fulfill({json:{code:0,data:{registration:true,gptDirect:true}}}));
    await page.route("**/api/announcements/unread",route=>route.fulfill({json:{code:0,data:[],unreadCount:0}}));
    await page.route("**/api/support/tickets",route=>route.fulfill({json:{code:0,data:[]}}));
    await page.route("**/api/auth/captcha",route=>route.fulfill({json:{code:0,data:{required:false}}}));
    await page.route("**/api/dashboard",route=>expired
      ?route.fulfill({status:401,json:{error:"Access expired",errorCode:"AUTH_REQUIRED"}})
      :route.fulfill({json:{userId:1,email:"session@example.test",role:"customer",walletBalance:"0",cardBalance:"0",cardCount:0,inviteCode:"SESSION"}}));
    await page.route("**/api/auth/refresh",route=>{
      refreshes+=1;
      return route.fulfill({status:refreshStatus,json:{error:"Refresh unavailable",errorCode:refreshStatus===401?"AUTH_REQUIRED":"TEMPORARY"}});
    });
    await page.goto("/dashboard");
    await expect(page.getByTestId("app-sidebar")).toBeVisible();
    expired=true;
    await page.clock.fastForward(31_000);
    await expect.poll(()=>refreshes).toBe(1);
    if(refreshStatus===401) {
      await expect(page).toHaveURL(/\/login$/);
      expect(await page.evaluate(()=>localStorage.getItem("session"))).toBeNull();
    } else {
      await expect(page).toHaveURL(/\/dashboard$/);
      await expect(page.getByTestId("app-sidebar")).toBeVisible();
      expect(await page.evaluate(()=>localStorage.getItem("session"))).not.toBeNull();
    }
  });
}

test("GPT direct preflight treats 202 as queued, clears credentials, and polls to completion", async ({ page }, testInfo) => {
  let submitted: Record<string, unknown> | undefined;
  if (testInfo.project.name === "frontend-mock") {
    await mockAuthenticatedShell(page, "customer");
  }
  await mockGptDirect(page, { onCreate: (body) => { submitted = body; } });
  await page.goto("/gpt-direct");
  await expect(page.getByRole("heading", { name: "GPT 订阅与额度直充", exact: true })).toBeVisible();
  await page.getByLabel("Session 凭据", { exact: true }).fill("super-secret-session-token");
  await page.getByRole("button", { name: "验证凭据与获取报价", exact: true }).click();
  await expect(page.locator(".gpt-preflight-result").getByText("user@example.com", { exact: true })).toBeVisible();
  await expect(page.locator(".gpt-preflight-result").getByText(/982\.14/)).toBeVisible();
  await expect(page.getByText(/约 \$15\.9990606 USD/)).toBeVisible();
  await page.getByRole("button", { name: "提交开通", exact: true }).click();
  await expect.poll(() => submitted).toBeDefined();
  const progress = page.getByRole("dialog");
  await expect(progress).toContainText("local-order-1");
  await expect(page.getByLabel("Session 凭据", { exact: true })).toHaveValue("");
  expect(JSON.stringify(submitted)).toContain("super-secret-session-token");
  expect(submitted?.expectedCustomerServiceFee).toBe("1.2500");
  expect(await page.evaluate(() => localStorage.getItem("session"))).not.toContain("super-secret-session-token");
  expect(page.url()).not.toContain("super-secret-session-token");
  await expect(progress).toContainText("GPT 订阅已确认开通。", { timeout: 7_000 });
});

test("GPT direct credits_250 uses credits copy and skips renewal cancel", async ({ page }, testInfo) => {
  let submitted: Record<string, unknown> | undefined;
  if (testInfo.project.name === "frontend-mock") {
    await mockAuthenticatedShell(page, "customer");
  }
  await mockGptDirect(page, {
    includeCreditPlans: true,
    currentPlan: "plus",
    availablePlans: ["pro_5x", "pro_20x", "credits_250"],
    detailStatuses: ["completed"],
    onCreate: (body) => { submitted = body; },
  });
  await page.goto("/gpt-direct");
  await page.getByLabel("Session 凭据", { exact: true }).fill("credits-session-token");
  await page.getByRole("button", { name: "验证凭据与获取报价", exact: true }).click();
  await expect(page.getByTestId("gpt-credits-plans")).toBeVisible();
  await page.getByTestId("gpt-credits-plans").locator('input[value="credits_250"]').check();
  await expect(page.getByTestId("gpt-credits-quote")).toContainText("额度实时报价");
  await expect(page.getByTestId("gpt-credits-quote")).toContainText(/565/);
  await expect(page.getByText("订阅实时报价", { exact: true })).toHaveCount(0);
  await expect(page.getByText("只有最终状态为“已完成”才代表额度已到账。")).toBeVisible();
  await page.getByRole("button", { name: "提交额度直充", exact: true }).click();
  await expect.poll(() => submitted).toBeDefined();
  expect(submitted?.plan).toBe("credits_250");
  const progress = page.getByRole("dialog");
  await expect(progress).toContainText("GPT 额度已确认到账。", { timeout: 7_000 });
  await expect(progress).not.toContainText("取消续费");
  await expect(progress).not.toContainText("自动续费");
});

test("GPT direct custom credits quantity submits credits_800", async ({ page }, testInfo) => {
  let submitted: Record<string, unknown> | undefined;
  if (testInfo.project.name.startsWith("frontend-mock")) {
    await mockAuthenticatedShell(page, "customer");
  }
  await mockGptDirect(page, {
    includeCreditPlans: true,
    currentPlan: "plus",
    availablePlans: ["pro_5x", "pro_20x", "credits_250"],
    detailStatuses: ["completed"],
    onCreate: (body) => { submitted = body; },
  });
  await page.route("**/api/support/tickets**", route => route.fulfill({ json: { code: 0, data: [] } }));
  await page.goto("/gpt-direct");
  await page.getByLabel("Session 凭据", { exact: true }).fill("credits-session-token");
  await page.getByRole("button", { name: "验证凭据与获取报价", exact: true }).click();
  await expect(page.getByTestId("gpt-credits-plans")).toBeVisible();
  const quantity = page.getByTestId("gpt-credits-custom-quantity");
  const creditPlans = page.getByTestId("gpt-credits-plans");
  await creditPlans.locator('input[value="credits_250"]').check();
  await creditPlans.locator(".gpt-credits-custom > span").first().click();
  await page.screenshot({ path: testInfo.outputPath("custom-initial.png"), fullPage: true });
  const style = await quantity.evaluate(input => ({ opacity: getComputedStyle(input).opacity, height: input.getBoundingClientRect().height }));
  expect.soft(style.opacity).toBe("1");
  expect.soft(style.height).toBeGreaterThanOrEqual(32);
  await expect.soft(quantity).toHaveValue("");
  await quantity.click();
  await quantity.press("ControlOrMeta+A");
  await quantity.press("Backspace");
  await expect(quantity).toHaveValue("");
  await expect(page.getByTestId("gpt-credits-custom-quote")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^(提交额度直充|提交开通)$/ })).toBeDisabled();
  await creditPlans.locator('input[value="credits_250"]').check();
  await quantity.click();
  await expect(quantity).toHaveValue("");
  await expect(page.getByRole("button", { name: /^(提交额度直充|提交开通)$/ })).toBeDisabled();
  await quantity.pressSequentially("249");
  await expect(page.getByTestId("gpt-credits-custom-quote")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^(提交额度直充|提交开通)$/ })).toBeDisabled();
  await quantity.press("ControlOrMeta+A");
  await quantity.pressSequentially("800");
  await expect(quantity).toHaveValue("800");
  await quantity.press("Backspace");
  await quantity.press("Backspace");
  await quantity.press("Backspace");
  await expect(quantity).toHaveValue("");
  await quantity.blur();
  await quantity.click();
  await expect(quantity).toHaveValue("");
  await page.locator('input[value="pro_5x"]').check();
  await expect(page.locator('input[value="pro_5x"]')).toBeChecked();
  await expect(creditPlans.locator('input[value="credits_custom"]')).not.toBeChecked();
  await quantity.click();
  await expect(quantity).toHaveValue("");
  await quantity.pressSequentially("800");
  await expect(page.getByTestId("gpt-credits-custom-quote")).toContainText(/1,?808/);
  await expect.poll(() => page.getByTestId("gpt-credits-custom-quantity").evaluate((input) => {
    const style = getComputedStyle(input);
    return { color: style.color, background: style.backgroundColor };
  })).toEqual({ color: "rgb(25, 25, 25)", background: "rgb(255, 255, 255)" });
  await expect(page.getByTestId("gpt-credits-quote")).toContainText(/1,?808/);
  await page.screenshot({ path: testInfo.outputPath("custom-edited.png"), fullPage: true });
  await page.getByRole("button", { name: "提交额度直充", exact: true }).click();
  await expect.poll(() => submitted).toBeDefined();
  expect(submitted?.plan).toBe("credits_800");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});


test("GPT direct history keeps polling and uses both Pro 20x phases", async ({ page }) => {
  await mockAuthenticatedShell(page, "customer");
  const steps = [
    ["queued", "订单已进入安全队列"],
    ["prechecking", "正在刷新 ChatGPT 会话并检查账号"],
    ["creating_checkout", "正在获取币种并创建结账"],
    ["checkout", "正在计算税费并核对报价"],
    ["tokenizing", "正在生成支付令牌"],
    ["submitting", "正在向 Stripe 提交扣款"],
    ["charging", "Stripe 已受理扣款，正在确认结果"],
    ["verifying", "正在核对 Plus 套餐开通和账单"],
    ["upgrading", "Plus 已开通，正在开始 Pro 升级"],
    ["tokenizing", "正在生成 Pro 支付令牌"],
  ].map(([stage, publicMessage], index) => ({ stage, publicMessage, occurredAt: `2026-08-04T08:00:${String(index).padStart(2, "0")}Z` }));
  await mockGptDirect(page, { historyProgress: [
    { stage: "verifying", progress: steps.slice(0, 8) },
    { stage: "tokenizing", progress: steps },
  ] });
  await page.goto("/gpt-direct");
  const row = page.locator(".gpt-order-history-row").filter({ hasText: "Pro 20x" });
  await expect(row.locator(".gpt-row-progress-line strong")).toHaveText("53%");
  await expect(row.locator(".gpt-row-progress-line strong")).toHaveText("67%", { timeout: 7_000 });
  await expect(row).toContainText("正在生成 Pro 支付令牌");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await row.getByRole("button", { name: "查看订单 history-live" }).click();
  const timeline = page.getByRole("dialog").locator(".gpt-order-event-list");
  await expect(timeline.locator("li")).toHaveCount(10);
  await expect(timeline.locator("li").filter({ hasText: "令牌" })).toHaveCount(2);
  await expect(timeline.locator("li.is-current")).toContainText("正在生成 Pro 支付令牌");
});

test("GPT direct history keeps polling and searches current customer's records by email", async ({ page }) => {
  const searches: string[] = [];
  await mockAuthenticatedShell(page, "customer");
  await mockGptDirect(page, {
    historyEmails: ["alice@example.com", "bob+pro@example.com"],
    onOrderSearch: (search) => searches.push(search),
  });
  await page.goto("/gpt-direct");
  const orders = page.locator(".gpt-orders-panel").first();
  await expect(orders).toContainText("alice@example.com");
  await expect(orders).toContainText("bob+pro@example.com");
  await orders.getByLabel("按邮箱查询直充记录").fill("  bob+pro  ");
  await orders.getByRole("button", { name: "搜索", exact: true }).click();
  await expect.poll(() => searches.at(-1)).toBe("bob+pro");
  await expect(orders).toContainText("bob+pro@example.com");
  await expect(orders).not.toContainText("alice@example.com");
  await orders.getByRole("button", { name: "重置筛选", exact: true }).click();
  await expect(orders).toContainText("alice@example.com");
});

test("GPT direct shows the external-card service fee when that payment method is selected", async ({ page }) => {
  await mockAuthenticatedShell(page, "customer");
  await mockGptDirect(page);
  await page.goto("/gpt-direct");
  const plusPlan = page.locator('.gpt-plan-options label:has(input[value="plus"])');
  await expect(plusPlan).toContainText("$1.25 USD");
  await page.locator(".gpt-card-modes label").filter({ hasText: "使用站外卡" }).click();
  await expect(plusPlan).toContainText("$1 USD");
  await expect(plusPlan).not.toContainText("$1.25 USD");
});

for (const [currentPlan, availablePlans] of Object.entries({
  free: ["plus", "pro_5x", "pro_20x", "go"],
  go: ["plus", "pro_5x", "pro_20x"],
  plus: ["pro_5x", "pro_20x"],
  prolite: ["pro_20x"],
  pro: [],
})) {
  test(`GPT direct upgrade matrix only shows higher plans: ${currentPlan}`, async ({ page }) => {
    await mockAuthenticatedShell(page, "customer");
    await mockGptDirect(page, { currentPlan, availablePlans });
    await page.goto("/gpt-direct");
    await page.getByLabel("Session 凭据", { exact: true }).fill("test-session");
    await page.getByRole("button", { name: "验证凭据与获取报价", exact: true }).click();
    await expect(page.locator(".gpt-preflight-result")).toBeVisible();
    await expect(page.locator('.gpt-plan-options input[name="plan"]')).toHaveCount(availablePlans.length);
    expect(await page.locator('.gpt-plan-options input[name="plan"]').evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value))).toEqual(availablePlans);
    await expect(page.locator(".gpt-observed-quote")).toHaveCount(0);
    if (!availablePlans.length) {
      await expect(page.getByText("已存在最高级套餐，暂无可升级套餐，不再展示价格。", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "提交开通", exact: true })).toBeDisabled();
    } else {
      await expect(page.locator('.gpt-plan-options input:checked')).toHaveValue(availablePlans[0]);
      if (currentPlan !== "free") await expect(page.getByText("升级应付金额", { exact: true })).toBeVisible();
      if (availablePlans.includes("pro_20x")) {
        await page.locator('.gpt-plan-options input[value="pro_20x"]').check();
        await expect(page.locator(".gpt-preflight-result")).toContainText("8,246.93");
      }
    }
  });
}

test("GPT direct isolates a failed upgrade quote without silently changing the requested plan", async ({ page }) => {
  await mockAuthenticatedShell(page, "customer");
  const reason = "Pro 20x：账号升级报价返回 PHP，与所选地区的 USD 不一致。";
  await mockGptDirect(page, { currentPlan: "plus", availablePlans: ["pro_5x"], quoteErrors: { pro_20x: reason } });
  await page.goto("/gpt-direct");
  await page.locator('.gpt-plan-options input[value="pro_20x"]').check();
  await page.getByLabel("Session 凭据", { exact: true }).fill("test-session");
  await page.getByRole("button", { name: "验证凭据与获取报价", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: reason })).toBeVisible();
  await expect(page.locator('.gpt-plan-options input[name="plan"]')).toHaveCount(1);
  await expect(page.locator('.gpt-plan-options input:checked')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "提交开通", exact: true })).toBeDisabled();
  await page.locator('.gpt-plan-options input[value="pro_5x"]').check();
  await expect(page.locator('.gpt-plan-options input:checked')).toHaveValue("pro_5x");
  await expect(page.locator(".gpt-preflight-result")).toContainText("4,910.7");
});

test("GPT direct shows per-plan reasons when all upgrade quotes fail, not a highest-plan message", async ({ page }) => {
  await mockAuthenticatedShell(page, "customer");
  await mockGptDirect(page, { currentPlan: "plus", availablePlans: [], quoteErrors: {
    pro_5x: "Pro 5x：账号升级报价返回 PHP，与所选地区的 USD 不一致。",
    pro_20x: "Pro 20x：账号升级报价返回 PHP，与所选地区的 USD 不一致。",
  } });
  await page.goto("/gpt-direct");
  await page.getByLabel("Session 凭据", { exact: true }).fill("test-session");
  await page.getByRole("button", { name: "验证凭据与获取报价", exact: true }).click();
  await expect(page.getByText("升级报价暂不可用，请查看各套餐原因后重新预检。", { exact: true })).toBeVisible();
  await expect(page.getByText("已存在最高级套餐，暂无可升级套餐，不再展示价格。", { exact: true })).toHaveCount(0);
  await expect(page.locator(".gpt-quote-error")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "提交开通", exact: true })).toBeDisabled();
});

for (const [origin, target, currency, regionName, outcome] of [
  ["US", "PH", "PHP", "菲律宾", "accept"],
  ["PH", "US", "USD", "美国", "accept"],
  ["US", "PH", "PHP", "菲律宾", "decline"],
  ["US", "PH", "PHP", "菲律宾", "failed"],
  ["US", "JP", "JPY", "日本", "unavailable"],
]) {
  test(`GPT direct region consent ${origin} to ${target}: ${outcome}`, async ({ page }) => {
    const requests: Record<string, unknown>[] = [];
    let created = 0;
    await mockAuthenticatedShell(page, "customer");
    await mockGptDirect(page, {
      onPreflight: (body) => requests.push(body), onCreate: () => { created += 1; },
      preflightFailureCalls: outcome === "failed" ? [2] : [],
      preflightResponse: (body, call) => ({
        email: "masked@example.test", currentPlan: "plus", credentialMode: "session",
        preflightToken: `region-preflight-${call}`, preflightExpiresAt: "2099-01-01T00:00:00Z",
        paymentCountry: body.paymentCountry, paymentCurrency: body.paymentCurrency,
        quotes: call === 1 ? {} : { pro_20x: {
          country: target, currency, plan: "pro", amountMinor: 858958, amountMajor: 8589.58, minorUnitExponent: 2,
        } }, quoteError: "", quoteEstimatesUsd: { pro_20x: "150" },
        quoteErrors: call === 1 ? { pro_20x: `Pro 20x：升级报价返回 ${currency}，与所选地区不一致。` } : {},
        upgradeCurrencies: call === 1 ? { pro_20x: currency } : {},
      }),
    });
    await page.goto("/gpt-direct");
    if (origin === "US") {
      await page.getByRole("combobox", { name: "付款地区", exact: true }).click();
      await page.getByRole("option", { name: "美国 (USD)", exact: true }).click();
    }
    await page.locator('.gpt-plan-options input[value="pro_20x"]').check();
    await page.getByLabel("Session 凭据", { exact: true }).fill("test-session");
    await page.getByRole("textbox", { name: /^自定义代理（可选）/ }).fill("socks5://proxy.example.test:1080");
    await page.getByRole("button", { name: "验证凭据与获取报价", exact: true }).click();
    const consent = page.locator(".gpt-region-consent");
    await expect(consent).toContainText("套餐仍有效");
    expect(requests).toHaveLength(1);
    await expect(page.getByRole("button", { name: "提交开通", exact: true })).toBeDisabled();
    if (outcome === "decline") {
      await consent.getByRole("button", { name: "暂不切换，保持所选地区", exact: true }).click();
      await expect(consent).toHaveCount(0);
      await expect(page.getByRole("combobox", { name: "付款地区", exact: true })).toContainText("美国");
      expect(requests).toHaveLength(1);
    } else if (outcome === "unavailable") {
      await expect(consent).toContainText("暂未开放匹配此账单币种的地区");
      await expect(consent.getByRole("button", { name: /同意切换/ })).toHaveCount(0);
      expect(requests).toHaveLength(1);
    } else {
      await consent.getByRole("button", { name: `同意切换至${regionName}并重新预检`, exact: true }).click();
      await expect.poll(() => requests.length).toBe(2);
      expect(requests[1].paymentCountry).toBe(target);
      expect(requests[1].paymentCurrency).toBe(currency);
      expect(requests[1].customProxyUrl).toBeUndefined();
      if (outcome === "failed") {
        await expect(page.getByRole("alert").filter({ hasText: "Mailbox login failed" })).toBeVisible();
        await expect(page.locator(".gpt-preflight-result")).toHaveCount(0);
        await expect(page.getByRole("button", { name: "提交开通", exact: true })).toBeDisabled();
      } else {
        await expect(page.locator(".gpt-preflight-result")).toContainText(`${target} · ${currency}`);
        await expect(page.locator(".gpt-preflight-result")).toContainText("8,589.58");
        await expect(page.locator('.gpt-plan-options input:checked')).toHaveValue("pro_20x");
        await expect(consent).toHaveCount(0);
        await page.locator(".gpt-card-modes label").filter({ hasText: "使用站外卡" }).click();
        await page.getByLabel("卡号", { exact: true }).fill("4242424242424242");
        await page.getByLabel("有效期", { exact: true }).fill("12/29");
        await page.getByLabel("CVV", { exact: true }).fill("123");
        await expect(page.getByRole("button", { name: "提交开通", exact: true })).toBeEnabled();
      }
    }
    expect(created).toBe(0);
  });
}

test("GPT direct shows a recent quote and the card's latest success before credentials", async ({ page }) => {
  await mockAuthenticatedShell(page, "customer");
  await mockGptDirect(page);
  await page.goto("/gpt-direct");
  await expect(page.getByLabel("Session 凭据", { exact: true })).toHaveValue("");
  const observed = page.locator(".gpt-observed-quote");
  await expect(observed).toContainText("最近一次已观测报价");
  await expect(observed).toContainText("US$20");
  await expect(observed).toContainText("美国");
  await expect(observed).toContainText("仅供参考");
  await expect(page.getByRole("button", { name: "提交开通", exact: true })).toBeDisabled();
  await expect(page.getByRole("combobox", { name: "支付卡片" })).toContainText("拒付率 20%");
  await expect(page.locator(".gpt-card-performance")).toContainText("Plus");
  await expect(page.locator(".gpt-card-performance")).toContainText("US$20");
});

test("GPT direct auto-card uses verified BIN performance and raises funding to the product minimum", async ({ page }) => {
  let submitted: Record<string, unknown> | undefined;
  await mockAuthenticatedShell(page, "customer");
  await mockGptDirect(page, { activeCard: false, onCreate: (body) => { submitted = body; } });
  const product = {
    issuer: "E2E Bank", network: "MASTERCARD", issuingArea: "US", cardType: "Virtual",
    openFee: "1.0000", openQuoteVersion: "a".repeat(64), rechargeRate: "0.010000",
    minAmount: "20.0000", maxAmount: "50000.0000", description: null, category: null,
    restrictedMerchants: [], googleChatgptBlocked: true,
  };
  await page.route("**/api/products", (route) => route.fulfill({ json: { code: 0, data: [
    { ...product, productCode: "P5556XV", displayBin: "555659", displayBins: ["555659"] },
    { ...product, productCode: "P5378OX", displayBin: "537872", displayBins: ["537872"] },
  ] } }));
  const rate = (successes: number, declines: number) => ({
    attempts: successes + declines, successes, declines,
    successRateBps: Math.round(successes * 10_000 / (successes + declines)),
    declineRateBps: Math.round(declines * 10_000 / (successes + declines)),
  });
  await page.route("**/api/openai-prices", (route) => route.fulfill({ json: { code: 0, data: {
    references: [],
    binStats: [
      { bin6: "555659", overall: rate(1, 1), plans: [{ plan: "plus", ...rate(1, 1), latestSuccess: null }] },
      { bin6: "537872", overall: rate(5, 0), plans: [{ plan: "plus", ...rate(5, 0), latestSuccess: null }] },
    ],
  } } }));

  await page.goto("/gpt-direct");
  await page.getByLabel("Session 凭据", { exact: true }).fill("super-secret-session-token");
  await page.getByRole("button", { name: "验证凭据与获取报价", exact: true }).click();
  await expect(page.locator(".gpt-auto-card-review")).toContainText("$20");
  await page.getByRole("button", { name: "提交开通", exact: true }).click();
  await expect.poll(() => submitted).toBeTruthy();
  expect(submitted?.autoCard).toMatchObject({ productCode: "P5378OX", initAmount: "20.0000" });
});

test("GPT direct recent quote has an explicit empty state without enabling checkout", async ({ page }) => {
  await mockAuthenticatedShell(page, "customer");
  await mockGptDirect(page, { observedQuote: false, cardSuccess: false });
  await page.goto("/gpt-direct");
  await expect(page.locator(".gpt-observed-quote")).toContainText("该套餐暂无有效近期报价");
  await expect(page.getByRole("button", { name: "提交开通", exact: true })).toBeDisabled();
  await expect(page.getByRole("combobox", { name: "支付卡片" })).toContainText("暂无样本");
});

test("GPT direct renders Go and only trusted Stripe invoices", async ({ page }) => {
  const invoiceUrl = "https://invoice.stripe.com/i/acct_test/inv_valid";
  await mockAuthenticatedShell(page, "customer");
  await mockGptDirect(page, {
    historyInvoiceUrls: [
      invoiceUrl,
      "https://invoice.stripe.com.evil.example/phish",
      null,
      "https://user@invoice.stripe.com/i/credentialed",
      "https://invoice.stripe.com/i/fragment#secret",
    ],
  });
  await page.goto("/gpt-direct");
  await expect(page.locator('input[name="plan"][value="go"]')).toBeVisible();

  const history = page.locator(".gpt-orders-panel").first();
  const historyInvoice = history.getByRole("link", { name: "查看 Stripe 账单", exact: true });
  await expect(historyInvoice).toHaveCount(1);
  await expect(historyInvoice).toHaveAttribute("href", invoiceUrl);
  await expect(historyInvoice).toHaveAttribute("target", "_blank");
  await expect(historyInvoice).toHaveAttribute("rel", "noopener noreferrer");

  await history.getByRole("link", { name: "查看订单 history-order-1", exact: true }).click();
  await expect(page).toHaveURL(/\/gpt-direct\/orders\/history-order-1$/);
  const detailInvoice = page.locator(".gpt-live-order").getByRole("link", { name: "查看 Stripe 账单", exact: true });
  await expect(detailInvoice).toHaveAttribute("href", invoiceUrl);
  await expect(detailInvoice).toHaveAttribute("target", "_blank");
  await expect(detailInvoice).toHaveAttribute("rel", "noopener noreferrer");

  await page.goto("/gpt-direct");
  await history.getByRole("link", { name: "查看订单 history-order-2", exact: true }).click();
  await expect(page.locator(".gpt-live-order").getByRole("link", { name: "查看 Stripe 账单", exact: true })).toHaveCount(0);
  await page.goto("/gpt-direct");
  await history.getByRole("link", { name: "查看订单 history-order-3", exact: true }).click();
  await expect(page.locator(".gpt-live-order").getByRole("link", { name: "查看 Stripe 账单", exact: true })).toHaveCount(0);

  await page.goto("/gpt-direct");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(history.getByRole("link", { name: "View Stripe invoice", exact: true })).toHaveCount(1);
});

test("Telegram card recharge confirmation strips its fragment and submits only on the website", async ({ page }) => {
  const intentToken = "a".repeat(64);
  let resolvedState = "awaiting_web";
  let confirmed: Record<string, unknown> | undefined;
  await page.route("**/api/features", (route) => route.fulfill({ json: { code: 0, data: {
    version: 1, registration: true, walletTransfer: true, cardOpening: true, cardRecharge: true, cardManagement: true, cardDelete: true,
    gptDirect: true, gptCdk: true, deposits: true, rewards: true, agent: true, market: true,
    developerApi: true, telegram: true,
  } } }));
  await page.route("**/api/auth/captcha", (route) => route.fulfill({ json: { code: 0, data: {
    required: false, id: null, image: null, expiresIn: 0,
  } } }));
  await page.route("**/api/auth/login", (route) => route.fulfill({ json: {
    token: "", email: "customer@example.com", mfaLevel: "password",
  } }));
  await page.route("**/api/telegram/payment-intents/**", (route) => {
    const request = route.request();
    if (request.url().endsWith("/resolve")) return route.fulfill({ json: { code: 0, data: {
      id: "00000000-0000-0000-0000-000000000107", kind: "card_recharge", state: resolvedState,
      cardId: 91, card: "•••• •••• •••• 4242", network: "MASTERCARD", amount: "100.0000",
      fee: "2.0000", totalAmount: "102.0000", plan: null, expiresAt: "2099-08-13T10:00:00Z",
    } } });
    confirmed = request.postDataJSON() as Record<string, unknown>;
    return route.fulfill({ json: { code: 0, data: { state: "processing", replayed: false } } });
  });
  await page.context().clearCookies();
  await page.goto("/login");
  await page.evaluate(() => localStorage.removeItem("session"));
  await page.goto(`/telegram-payment#token=${intentToken}`);
  await expect(page).toHaveURL(/\/login$/);
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("recentAuthReturnPath"))).toBe("/telegram-payment");
  await page.getByPlaceholder("your@email.com").fill("customer@example.com");
  await page.getByPlaceholder("8+").fill("StrongPassword123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "确认卡片充值", exact: true })).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("recentAuthReturnPath"))).toBeNull();
  expect(page.url()).not.toContain(intentToken);
  expect(await page.evaluate(() => localStorage.getItem("session"))).not.toContain(intentToken);
  await expect(page.getByText("MASTERCARD · •••• •••• •••• 4242", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "确认并充值", exact: true }).click();
  await expect(page.getByRole("heading", { name: "充值处理中", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "充值成功", exact: true })).toHaveCount(0);
  expect(confirmed).toEqual({ token: intentToken });
  expect(await page.evaluate(() => sessionStorage.getItem("telegramPaymentToken"))).toBe(intentToken);

  for (const [state, heading] of [["processing", "充值处理中"], ["failed", "充值未完成"], ["cancelled", "充值已取消"], ["succeeded", "充值成功"]]) {
    resolvedState = state;
    await page.evaluate(({ intentToken }) => sessionStorage.setItem("telegramPaymentToken", intentToken), { intentToken });
    await page.reload();
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  }
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("telegramPaymentToken"))).toBeNull();
});

test("Telegram OpenAI handoff uses the intent as the stable client request id", async ({ page }) => {
  const intentId = "00000000-0000-0000-0000-000000000108";
  const intentToken = "b".repeat(64);
  let submitted: Record<string, unknown> | undefined;
  let requireRecentAuth = true;
  await mockAuthenticatedShell(page, "customer");
  await mockGptDirect(page, { onCreate: (body) => { submitted = body; } });
  await page.route("**/api/cards", (route) => route.fulfill({ json: { code: 0, data: { total: 2, list: [
    { id: 91, vmCardId: "up-91", cardNumberMasked: "545020 **** 4242", productCode: "G5554LC", network: "Mastercard", issuingArea: "US", status: "ACTIVE", balance: "40.0000", firstName: "Ada", lastName: "Lovelace", createdAt: "2026-08-04T08:00:00Z" },
    { id: 92, vmCardId: "up-92", cardNumberMasked: "411111 **** 5252", productCode: "V5252", network: "VISA", issuingArea: "US", status: "ACTIVE", balance: "60.0000", firstName: "Grace", lastName: "Hopper", createdAt: "2026-08-04T08:00:00Z" },
  ] } } }));
  await page.route("**/api/telegram/payment-intents/resolve", (route) => route.fulfill({ json: { code: 0, data: {
    id: intentId, kind: "gpt_direct", state: "awaiting_web", cardId: 92, card: "•••• •••• •••• 5252",
    network: "VISA", amount: null, fee: null, totalAmount: null, plan: "go", expiresAt: "2099-08-13T10:00:00Z",
  } } }));
  await page.route("**/api/gpt-direct/orders", (route) => {
    if (route.request().method() !== "POST" || !requireRecentAuth) return route.fallback();
    requireRecentAuth = false;
    return route.fulfill({ status: 403, json: { error: "请使用密码/MFA 登录后确认", errorCode: "PASSWORD_SESSION_REQUIRED" } });
  });
  await page.route("**/api/auth/captcha", (route) => route.fulfill({ json: { code: 0, data: {
    required: false, id: null, image: null, expiresIn: 0,
  } } }));
  await page.route("**/api/auth/login", (route) => route.fulfill({ json: {
    token: "", email: "customer@example.com", mfaLevel: "password",
  } }));
  await page.goto(`/telegram-payment#token=${intentToken}`);
  await expect(page.getByRole("heading", { name: "GPT 订阅与额度直充", exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "退出 Bot 直充流程", exact: true })).toBeVisible();
  await expect(page.locator('input[name="plan"][value="go"]')).toBeChecked();
  await expect(page.locator('input[name="plan"][value="go"]')).toBeDisabled();
  await expect(page.getByRole("combobox", { name: "支付卡片" })).toContainText("5252");
  await expect(page.getByRole("combobox", { name: "支付卡片" })).toBeDisabled();
  await page.getByRole("button", { name: "退出 Bot 直充流程", exact: true }).click();
  await expect(page.getByRole("button", { name: "退出 Bot 直充流程", exact: true })).toHaveCount(0);
  await expect(page.locator('input[name="plan"][value="plus"]')).toBeChecked();
  await expect(page.getByRole("combobox", { name: "支付卡片" })).toContainText("4242");
  await expect(page.getByRole("combobox", { name: "支付卡片" })).toBeEnabled();
  expect(await page.evaluate(() => sessionStorage.getItem("telegramGptIntent"))).toBeNull();

  await page.goto(`/telegram-payment#token=${intentToken}`);
  await expect(page.getByRole("heading", { name: "GPT 订阅与额度直充", exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByLabel("Session 凭据", { exact: true }).fill("telegram-handoff-session");
  await page.getByRole("button", { name: "验证凭据与获取报价", exact: true }).click();
  await page.getByRole("button", { name: "提交开通", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("recentAuthReturnPath"))).toBe("/gpt-direct");
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem("telegramGptIntent") ?? "null")?.id)).toBe(intentId);
  await page.getByPlaceholder("your@email.com").fill("customer@example.com");
  await page.getByPlaceholder("8+").fill("StrongPassword123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "GPT 订阅与额度直充", exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByLabel("Session 凭据", { exact: true })).toHaveValue("");
  await expect(page.locator('input[name="plan"][value="go"]')).toBeChecked();
  await expect(page.getByRole("combobox", { name: "支付卡片" })).toContainText("5252");
  await page.getByLabel("Session 凭据", { exact: true }).fill("telegram-handoff-session-after-login");
  await page.getByRole("button", { name: "验证凭据与获取报价", exact: true }).click();
  await page.getByRole("button", { name: "提交开通", exact: true }).click();
  await expect.poll(() => submitted?.clientRequestId).toBe(`telegram:${intentId}`);
  expect(submitted).toMatchObject({ cardId: 92, plan: "go" });
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("telegramGptIntent"))).toBeNull();
});

test("GPT direct explains Session retrieval and sends the selected payment region", async ({ page }, testInfo) => {
  let preflightBody: Record<string, unknown> | undefined;
  if (testInfo.project.name === "frontend-mock") await mockAuthenticatedShell(page, "customer");
  await mockGptDirect(page, { onPreflight: (body) => { preflightBody = body; } });
  await page.goto("/gpt-direct");
  await expect(page.getByRole("link", { name: /chatgpt\.com\/api\/auth\/session/ })).toHaveAttribute("href", "https://chatgpt.com/api/auth/session");
  await page.getByLabel("Session 凭据", { exact: true }).fill('{"error":"RefreshAccessTokenError"}');
  await expect(page.getByRole("alert")).toContainText("退出 ChatGPT 账号并重新登录");
  await expect(page.getByRole("button", { name: "验证凭据与获取报价", exact: true })).toBeDisabled();
  await page.getByLabel("Session 凭据", { exact: true }).fill("eyJ-access-token-in-wrong-field");
  await expect(page.getByRole("alert")).toContainText("上游已停用");
  await page.getByRole("radio", { name: "Mail.com 自动登录" }).check();
  await expect(page.getByText(/支持 Mail.com 旗下各邮箱后缀/)).toBeVisible();
  await page.getByRole("radio", { name: "完整 Session" }).check();
  await page.getByLabel("Session 凭据", { exact: true }).fill('{"sessionToken":"complete-session"}');
  await page.getByRole("combobox", { name: "付款地区" }).click();
  await page.getByRole("option", { name: "美国 (USD)" }).click();
  await page.getByRole("button", { name: "验证凭据与获取报价", exact: true }).click();
  expect(preflightBody).toMatchObject({ paymentCountry: "US", paymentCurrency: "USD" });
});

test("GPT batch parser uses the first field as email and the final field as password", async () => {
  expect(parseGptMailboxBatch([
    "first.user@mail.com----ignored-middle----last-field-one",
    "second.user\\@mail.com----last-field-two",
  ].join("\n"))).toEqual({ accounts: [
    { email: "first.user@mail.com", password: "last-field-one" },
    { email: "second.user@mail.com", password: "last-field-two" },
  ] });
  expect(parseGptMailboxBatch("same@mail.com----one\nsame@mail.com----two").error)
    .toEqual({ code: "duplicate", line: 2 });
  expect(parseGptMailboxBatch(Array.from({ length: 51 }, (_, index) => `user${index}@mail.com----value`).join("\n")).error)
    .toEqual({ code: "too_many" });
  expect(parseGptMailboxBatch("user@@example.com----value").error)
    .toEqual({ code: "email", line: 1 });
});

test("GPT batch Session parser extracts exports and rejects unsafe records", () => {
  const first = { accessToken: "test-at-1", sessionToken: 'test-cookie-1{\\"}', user: { email: "first@example.com", mfa: true }, account: { id: "account-1" } };
  const second = { accessToken: "test-at-2", sessionToken: "test-cookie-2", user: { email: "second@example.com" }, account: { id: "account-2" } };
  const exported = `first@example.com----pass{word----2fa-secret----rt.test${JSON.stringify(first)}`;
  expect(parseGptSessionBatch(`${exported}\r\n\n${JSON.stringify(second)}`).accounts).toEqual([
    { email: "first@example.com", session: JSON.stringify(first) },
    { email: "second@example.com", session: JSON.stringify(second) },
  ]);
  expect(extractGptSession(exported)).toEqual(first);
  expect(parseGptSessionBatch(JSON.stringify(first, null, 2)).accounts).toHaveLength(1);
  expect(parseGptSessionBatch(`${JSON.stringify(first)}\n${exported}`).error).toEqual({ code: "duplicate", line: 2 });
  expect(parseGptSessionBatch(`${JSON.stringify(first)}\n${JSON.stringify({ ...second, account: first.account })}`).error).toEqual({ code: "duplicate", line: 2 });
  expect(parseGptSessionBatch(`bad----record\n${exported}`).error).toEqual({ code: "session", line: 1 });
  expect(parseGptSessionBatch(`rt.test${JSON.stringify(first)}${JSON.stringify(second)}`).error?.code).toBe("session");
  expect(parseGptSessionBatch('rt.test{"accessToken":"at"}').error?.code).toBe("session");
  expect(parseGptSessionBatch(JSON.stringify({ ...first, error: "RefreshAccessTokenError" })).error?.code).toBe("expired");
  expect(parseGptSessionBatch(Array(501).fill(JSON.stringify(first)).join("\n")).error?.code).toBe("too_many");
  expect(parseGptSessionBatch("rt.test" + "{".repeat(32768)).error?.code).toBe("session");
});

test("GPT batch Session file parser supports JSON arrays and 500 records", () => {
  const records = Array.from({ length: 500 }, (_, index) => ({ accessToken: `at-${index}`, sessionToken: `cookie-${index}` }));
  expect(parseGptSessionBatch(JSON.stringify(records, null, 2)).accounts).toHaveLength(500);
  expect(parseGptSessionBatch(records.map((record) => `account----password----2fa----rt.test${JSON.stringify(record)}`).join("\r\n")).accounts).toHaveLength(500);
  expect(parseGptSessionBatch(JSON.stringify([`rt.test${JSON.stringify(records[0])}`, records[1]])).accounts).toHaveLength(2);
  expect(parseGptSessionBatch(" ".repeat(GPT_SESSION_FILE_MAX_BYTES + 1)).error?.code).toBe("too_many");
  expect(parseGptSessionBatch("[null]").error).toEqual({ code: "session", line: 1 });
});

test("GPT batch concurrency uses the selected region and safe legacy defaults", () => {
  expect(gptBatchConcurrency({ PH: 3, US: 1 }, "PH")).toBe(3);
  expect(gptBatchConcurrency({ PH: 3, US: 1 }, "US")).toBe(1);
  expect(gptBatchConcurrency({ PH: 3 }, "JP")).toBe(0);
  expect(gptBatchConcurrency({}, "PH")).toBe(0);
  expect(gptBatchConcurrency(undefined, "PH")).toBe(1);
  expect(gptBatchConcurrency({ PH: 3 }, "PH", true)).toBe(1);
  expect(gptBatchConcurrency({ PH: -1 }, "PH")).toBe(0);
});

for (const limit of [1, 3]) {
  test(`GPT batch scheduler holds ${limit} slots until each account finishes`, async () => {
    const pending = new Map<number, (safe: boolean) => void>();
    const started: number[] = [];
    const batch = runGptBatch([0, 1, 2, 3, 4], async () => limit, async (item) => {
      started.push(item);
      return new Promise<boolean>((resolve) => pending.set(item, resolve));
    });
    await expect.poll(() => started.length).toBe(limit);
    for (let done = 0; done < 5; done += 1) {
      expect(started.length).toBe(Math.min(5, done + limit));
      pending.get(done)!(true);
      await expect.poll(() => started.length).toBe(Math.min(5, done + limit + 1));
    }
    expect(await batch).toBe(5);
  });
}

test("GPT batch scheduler stops new work on zero capacity or uncertain outcomes", async () => {
  const started: number[] = [];
  expect(await runGptBatch([0], async () => 0, async (item) => { started.push(item); return true; })).toBe(0);
  expect(started).toEqual([]);
  const pending = new Map<number, (safe: boolean) => void>();
  const batch = runGptBatch([0, 1, 2, 3], async () => 3, async (item) => {
    started.push(item);
    return new Promise<boolean>((resolve) => pending.set(item, resolve));
  });
  await expect.poll(() => started.length).toBe(3);
  pending.get(0)!(false);
  pending.get(1)!(true);
  pending.get(2)!(true);
  expect(await batch).toBe(3);
  expect(started).toEqual([0, 1, 2]);
  expect(await runGptBatch([0, 1], async () => 1, async () => { throw new Error("unknown result"); })).toBe(1);
});

test("GPT batch scheduler respects reduced proxy capacity without cancelling active orders", async () => {
  let limit = 3;
  const pending = new Map<number, (safe: boolean) => void>();
  const started: number[] = [];
  const batch = runGptBatch([0, 1, 2, 3], async () => limit, async (item) => {
    started.push(item);
    return new Promise<boolean>((resolve) => pending.set(item, resolve));
  });
  await expect.poll(() => started.length).toBe(3);
  limit = 1;
  pending.get(0)!(true);
  pending.get(1)!(true);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(started).toEqual([0, 1, 2]);
  pending.get(2)!(true);
  await expect.poll(() => started.length).toBe(4);
  pending.get(3)!(true);
  expect(await batch).toBe(4);
});

for (const extension of ["txt", "json"]) {
  test(`GPT batch imports a ${extension} file without copying secrets into the text box`, async ({ page }, testInfo) => {
    const preflights: Record<string, unknown>[] = [];
    const creates: Record<string, unknown>[] = [];
    if (testInfo.project.name === "frontend-mock") await mockAuthenticatedShell(page, "customer");
    await mockGptDirect(page, { detailStatuses: ["completed"], onPreflight: (body) => preflights.push(body), onCreate: (body) => creates.push(body) });
    const records = [1, 2].map((index) => ({ accessToken: `at-file-${index}`, sessionToken: `cookie-file-${index}` }));
    const content = extension === "json" ? JSON.stringify(records, null, 2) : records.map((record) => `account----private-password----private-2fa----rt.test${JSON.stringify(record)}`).join("\n");
    await page.goto("/gpt-direct");
    await page.getByRole("radio", { name: "Session 批量直充", exact: true }).check();
    await page.getByLabel("导入 Session 文件", { exact: true }).setInputFiles({ name: `sessions.${extension}`, mimeType: "text/plain", buffer: Buffer.from(content) });
    await expect(page.getByText("已识别 2 个账号", { exact: true })).toBeVisible();
    await expect(page.getByLabel("批量 Session", { exact: true })).toHaveValue("");
    await page.getByRole("button", { name: "开始批量直充", exact: true }).click();
    await page.getByRole("button", { name: "确认支付选中账号", exact: true }).click();
    await expect(page.locator(".gpt-batch-results li.is-completed")).toHaveCount(2);
    expect(preflights.map((body) => body.credential)).toEqual(records.map((record) => ({ mode: "session", session: JSON.stringify(record) })));
    expect(creates).toHaveLength(2);
    const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
    for (const secret of ["at-file-", "cookie-file-", "private-password", "private-2fa"]) expect(storage).not.toContain(secret);
    expect(JSON.stringify({ preflights, creates })).not.toContain("private-password");
  });
}

for (const smartCard of [false, true]) {
  test(`GPT batch uses three proxy slots and ${smartCard ? "submits independent smart-card orders" : "serializes the same payment card"}`, async ({ page }, testInfo) => {
    const preflights: Record<string, unknown>[] = [];
    const creates: Record<string, unknown>[] = [];
    let releaseOrders!: () => void;
    const gate = new Promise<void>((resolve) => { releaseOrders = resolve; });
    if (testInfo.project.name === "frontend-mock") await mockAuthenticatedShell(page, "customer");
    await mockGptDirect(page, { batchConcurrencyByCountry: { PH: 3 }, detailStatuses: ["completed"], onPreflight: (body) => preflights.push(body), onCreate: (body) => creates.push(body) });
    await page.route("**/api/gpt-direct/orders/local-order-*", async (route) => { await gate; await route.fallback(); });
    await page.goto("/gpt-direct");
    await page.getByRole("radio", { name: "Session 批量直充", exact: true }).check();
    if (smartCard) await page.getByText("智能卡池轮换", { exact: true }).click();
    await page.getByLabel("批量 Session", { exact: true }).fill([1, 2, 3, 4].map((index) => JSON.stringify({ accessToken: `at-${index}`, sessionToken: `cookie-${index}` })).join("\n"));
    await page.getByRole("button", { name: "开始批量直充", exact: true }).click();
    await page.getByRole("button", { name: "确认支付选中账号", exact: true }).click();
    try {
      await expect.poll(() => preflights.length).toBe(4);
      await expect.poll(() => creates.length).toBe(smartCard ? 3 : 1);
      await expect(page.locator(".gpt-batch-results li.is-queued")).toHaveCount(1);
      expect(preflights).toHaveLength(4);
    } finally { releaseOrders(); }
    await expect(page.locator(".gpt-batch-results li.is-completed")).toHaveCount(4);
    expect(creates).toHaveLength(4);
  });
}

test("GPT batch does not start another account when a submitted order cannot be confirmed", async ({ page }, testInfo) => {
  const creates: Record<string, unknown>[] = [];
  if (testInfo.project.name === "frontend-mock") await mockAuthenticatedShell(page, "customer");
  await mockGptDirect(page, { batchConcurrencyByCountry: { PH: 1 }, onCreate: (body) => creates.push(body) });
  await page.route("**/api/gpt-direct/orders/local-order-*", (route) => route.fulfill({ status: 503, json: { error: "Order status unavailable" } }));
  await page.goto("/gpt-direct");
  await page.getByRole("radio", { name: "Session 批量直充", exact: true }).check();
  await page.getByLabel("批量 Session", { exact: true }).fill([1, 2].map((index) => JSON.stringify({ accessToken: `at-${index}`, sessionToken: `cookie-${index}` })).join("\n"));
  await page.getByRole("button", { name: "开始批量直充", exact: true }).click();
  await page.getByRole("button", { name: "确认支付选中账号", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("已停止启动剩余账号");
  expect(creates).toHaveLength(1);
  await expect(page.locator(".gpt-batch-results li.is-processing")).toHaveCount(1);
  await expect(page.locator(".gpt-batch-results li.is-not_submitted")).toHaveCount(1);
});

test("GPT batch zero available proxies disables starting the batch", async ({ page }, testInfo) => {
  if (testInfo.project.name === "frontend-mock") await mockAuthenticatedShell(page, "customer");
  await mockGptDirect(page, { batchConcurrencyByCountry: {} });
  await page.goto("/gpt-direct");
  await page.getByRole("radio", { name: "Session 批量直充", exact: true }).check();
  await page.getByLabel("批量 Session", { exact: true }).fill(JSON.stringify({ accessToken: "at", sessionToken: "cookie" }));
  await expect(page.getByText("当前批次并发上限：0", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "开始批量直充", exact: true })).toBeDisabled();
});

test("GPT batch file import rejects oversized and invalid files before any request", async ({ page }, testInfo) => {
  const preflights: Record<string, unknown>[] = [];
  if (testInfo.project.name === "frontend-mock") await mockAuthenticatedShell(page, "customer");
  await mockGptDirect(page, { onPreflight: (body) => preflights.push(body) });
  await page.goto("/gpt-direct");
  await page.getByRole("radio", { name: "Session 批量直充", exact: true }).check();
  const file = page.getByLabel("导入 Session 文件", { exact: true });
  await file.setInputFiles({ name: "too-large.txt", mimeType: "text/plain", buffer: Buffer.alloc(GPT_SESSION_FILE_MAX_BYTES + 1, "x") });
  await expect(page.getByRole("alert")).toContainText("文件超过约 16 MB");
  await file.setInputFiles({ name: "invalid.txt", mimeType: "text/plain", buffer: Buffer.from("missing-session") });
  await expect(page.getByRole("alert")).toContainText("第 1 行没有可提取的完整 Session");
  await expect(page.getByRole("button", { name: "开始批量直充", exact: true })).toBeDisabled();
  expect(preflights).toEqual([]);
});

for (const failedFirst of [false, true]) {
  test(`GPT batch Session exports submit only Session credentials${failedFirst ? " and continue after a failed preflight" : ""}`, async ({ page }, testInfo) => {
    const preflights: Record<string, unknown>[] = [];
    const creates: Record<string, unknown>[] = [];
    if (testInfo.project.name === "frontend-mock") await mockAuthenticatedShell(page, "customer");
    await mockGptDirect(page, {
      detailStatuses: ["completed"], preflightFailureCalls: failedFirst ? [1] : [],
      onPreflight: (body) => preflights.push(body), onCreate: (body) => creates.push(body),
    });
    const sessions = [1, 2].map((i) => ({ accessToken: `test-at-${i}`, sessionToken: `test-cookie-${i}`, user: { email: `test${i}@example.com`, mfa: true } }));
    await page.goto("/gpt-direct");
    await page.getByRole("radio", { name: "Session 批量直充", exact: true }).check();
    const input = page.getByLabel("批量 Session", { exact: true });
    await input.fill(sessions.map((value) => `account----export-password----2fa-secret----rt.test${JSON.stringify(value)}`).join("\n"));
    await expect(page.getByText("已识别 2 个账号", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "开始批量直充", exact: true }).click();
    if (failedFirst) await expect(page.getByRole("checkbox", { name: "选择账号 1", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "确认支付选中账号", exact: true }).click();
    await expect(page.locator(".gpt-batch-results li.is-completed")).toHaveCount(failedFirst ? 1 : 2, { timeout: 15_000 });
    await expect(page.locator(".gpt-batch-results li.is-failed")).toHaveCount(0);
    expect(preflights.map((body) => body.credential)).toEqual(sessions.map((value) => ({ mode: "session", session: JSON.stringify(value) })));
    expect(creates.map((body) => body.credential)).toEqual(preflights.slice(failedFirst ? 1 : 0).map((body) => body.credential));
    expect(creates.map((body) => body.preflightToken)).toEqual(failedFirst ? ["one-time-preflight-2"] : ["one-time-preflight-1", "one-time-preflight-2"]);
    await expect(input).toHaveValue("");
    const requestBodies = JSON.stringify({ preflights, creates });
    for (const secret of ["export-password", "2fa-secret", "rt.test"]) expect(requestBodies).not.toContain(secret);
    const stored = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
    for (const secret of ["test-at-", "test-cookie-", "export-password", "2fa-secret"]) {
      expect(stored).not.toContain(secret);
      await expect(page.locator(".gpt-batch-results")).not.toContainText(secret);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
}

test("GPT batch single Session export is normalized before preflight", async ({ page }, testInfo) => {
  let captured: Record<string, unknown> = {};
  if (testInfo.project.name === "frontend-mock") await mockAuthenticatedShell(page, "customer");
  await mockGptDirect(page, { onPreflight: (body) => { captured = body; } });
  const value = { accessToken: "test-at", sessionToken: "test-cookie", user: { email: "test@example.com" } };
  await page.goto("/gpt-direct");
  await page.getByLabel("Session 凭据", { exact: true }).fill(`test@example.com----password----2fa----rt.test${JSON.stringify(value)}`);
  await page.getByRole("button", { name: "验证凭据与获取报价", exact: true }).click();
  await expect(page.locator(".gpt-preflight-result")).toBeVisible();
  expect(captured.credential).toEqual({ mode: "session", session: JSON.stringify(value) });
});

test("GPT batch invalid Session line stops before any preflight or order", async ({ page }, testInfo) => {
  const preflights: unknown[] = [];
  const creates: unknown[] = [];
  if (testInfo.project.name === "frontend-mock") await mockAuthenticatedShell(page, "customer");
  await mockGptDirect(page, { onPreflight: (body) => preflights.push(body), onCreate: (body) => creates.push(body) });
  await page.goto("/gpt-direct");
  await page.getByRole("radio", { name: "Session 批量直充", exact: true }).check();
  await page.getByLabel("批量 Session", { exact: true }).fill('bad----password\nrt.test{"accessToken":"test-at","sessionToken":"test-cookie"}');
  await page.getByRole("button", { name: "开始批量直充", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("第 1 行没有可提取的完整 Session");
  expect(preflights).toHaveLength(0);
  expect(creates).toHaveLength(0);
});

test("GPT batch direct pay processes every mailbox account without persisting passwords", async ({ page }, testInfo) => {
  const preflights: Record<string, unknown>[] = [];
  const creates: Record<string, unknown>[] = [];
  if (testInfo.project.name === "frontend-mock") await mockAuthenticatedShell(page, "customer");
  await mockGptDirect(page, {
    detailStatuses: ["completed"],
    onPreflight: (body) => preflights.push(body),
    onCreate: (body) => creates.push(body),
  });
  await page.goto("/gpt-direct");
  await expect(page.getByRole("radio", { name: /Access Token/ })).toHaveCount(0);
  await page.getByRole("radio", { name: "批量直充", exact: true }).check();
  const input = page.getByLabel("批量账号资料", { exact: true });
  await input.fill([
    "first.user@mail.com----ignored-middle----last-field-one",
    "second.user@mail.com----last-field-two",
  ].join("\n"));
  await expect(page.getByText("已识别 2 个账号", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "开始批量直充", exact: true }).click();
  await page.getByRole("button", { name: "确认支付选中账号", exact: true }).click();
  await expect(page.locator(".gpt-batch-results li.is-completed")).toHaveCount(2, { timeout: 15_000 });
  expect(preflights.map((body) => body.credential)).toEqual([
    { mode: "mailbox", email: "first.user@mail.com", password: "last-field-one" },
    { mode: "mailbox", email: "second.user@mail.com", password: "last-field-two" },
  ]);
  expect(creates.map((body) => body.credential)).toEqual(preflights.map((body) => body.credential));
  expect(creates.map((body) => body.preflightToken)).toEqual(["one-time-preflight-1", "one-time-preflight-2"]);
  await expect(input).toHaveValue("");
  await expect(page.locator(".gpt-batch-results")).not.toContainText("last-field-one");
  const browserStorage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  expect(browserStorage).not.toContain("last-field-one");
  expect(browserStorage).not.toContain("last-field-two");
  expect(page.url()).not.toContain("last-field-one");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("GPT batch direct pay continues after one mailbox fails", async ({ page }, testInfo) => {
  const creates: Record<string, unknown>[] = [];
  if (testInfo.project.name === "frontend-mock") await mockAuthenticatedShell(page, "customer");
  await mockGptDirect(page, {
    detailStatuses: ["completed"],
    preflightFailureCalls: [1],
    onCreate: (body) => creates.push(body),
  });
  await page.goto("/gpt-direct");
  await page.getByRole("radio", { name: "批量直充", exact: true }).check();
  await page.getByLabel("批量账号资料", { exact: true }).fill([
    "failed.user@mail.com----failed-field",
    "working.user@mail.com----working-field",
  ].join("\n"));
  await page.getByRole("button", { name: "开始批量直充", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "选择账号 1", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "确认支付选中账号", exact: true }).click();
  await expect(page.locator(".gpt-batch-results li.is-failed")).toHaveCount(0);
  await expect(page.locator(".gpt-batch-results li.is-completed")).toHaveCount(1, { timeout: 15_000 });
  expect(creates).toHaveLength(1);
  expect(creates[0].credential).toEqual({ mode: "mailbox", email: "working.user@mail.com", password: "working-field" });
});

test("GPT batch smart card rotates after a compensated decline and reuses the successful card", async ({ page }, testInfo) => {
  const preflights: Record<string, unknown>[] = [];
  const creates: Record<string, unknown>[] = [];
  if (testInfo.project.name === "frontend-mock") await mockAuthenticatedShell(page, "customer");
  await mockGptDirect(page, {
    detailStatusesByOrder: [["declined"], ["completed"], ["completed"]],
    orderCardIds: [91, 92, 92],
    orderAutoOpenedCards: [false, false, false],
    onPreflight: (body) => preflights.push(body),
    onCreate: (body) => creates.push(body),
  });
  await page.goto("/gpt-direct");
  await page.getByRole("radio", { name: "批量直充", exact: true }).check();
  await expect(page.getByRole("radio", { name: /智能卡池轮换/ })).toBeChecked();
  await page.getByLabel("批量账号资料", { exact: true }).fill([
    "first.user@mail.com----first-field",
    "second.user@mail.com----second-field",
  ].join("\n"));
  await page.getByRole("button", { name: "开始批量直充", exact: true }).click();
  await page.getByRole("button", { name: "确认支付选中账号", exact: true }).click();
  await expect(page.locator(".gpt-batch-results li.is-completed")).toHaveCount(2, { timeout: 15_000 });
  expect(preflights.map((body) => (body.credential as { email: string }).email)).toEqual([
    "first.user@mail.com", "second.user@mail.com", "first.user@mail.com",
  ]);
  expect(creates).toHaveLength(3);
  expect(creates.map((body) => ({
    cardId: body.cardId,
    reuseExisting: (body.autoCard as { reuseExisting?: boolean }).reuseExisting,
    excludedCardIds: (body.autoCard as { excludedCardIds?: number[] }).excludedCardIds ?? [],
  }))).toEqual([
    { cardId: 0, reuseExisting: true, excludedCardIds: [] },
    { cardId: 0, reuseExisting: true, excludedCardIds: [91] },
    { cardId: 0, reuseExisting: true, excludedCardIds: [91] },
  ]);
});

test("GPT direct keeps polling until a failed order fee is compensated", async ({ page }) => {
  await mockGptDirect(page, {
    detailStatuses: ["declined", "declined", "declined", "declined", "declined"],
    detailOperationStatuses: ["RECONCILE_REQUIRED", "RECONCILE_REQUIRED", "RECONCILE_REQUIRED", "RECONCILE_REQUIRED", "COMPENSATED"],
  });
  await page.goto("/gpt-direct");
  await page.getByLabel("Session 凭据", { exact: true }).fill("session-for-reconciliation-test");
  await page.getByRole("button", { name: "验证凭据与获取报价", exact: true }).click();
  await page.getByRole("button", { name: "提交开通", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("OpenAI 已结束处理，费用状态正在安全核对。", { timeout: 4_000 });
  await expect(page.getByRole("status")).toContainText("订单已结束", { timeout: 12_000 });
});

for (const scenario of [
  { action: "submit_session", status: "requires_action", operation: "SUBMITTED", code: "session_refresh_required", message: "请补交原账号的新 Session，不要重新下单。" },
  { action: "refresh_session_and_reorder", status: "failed_precharge", operation: "COMPENSATED", code: "GPT_SESSION_REAUTH_REQUIRED", message: "请重新登录并获取完整 Session，再预检下单。" },
  { action: "resolve_account", status: "failed_precharge", operation: "COMPENSATED", code: "upgrade_risk_rejected", message: "上游风控限制，请先检查账号。" },
  { action: "change_card_and_reorder", status: "failed_precharge", operation: "COMPENSATED", code: "upgrade_card_declined", message: "银行卡被拒绝，请核对卡资料或更换卡。" },
  { action: "wait", status: "failed_precharge", operation: "SUBMITTED", code: "session_refresh_required", message: "等待资金处理。" },
]) {
  test(`GPT direct history recovery action ${scenario.action} stays within payment boundaries`, async ({ page }) => {
    await mockAuthenticatedShell(page, "customer");
    await page.route("**/api/gpt-direct/orders/recovery-test", (route) => route.fulfill({ json: { code: 0, data: {
      order: { id: "recovery-test", plan: "pro_20x", status: scenario.status, operationStatus: scenario.operation, stage: "verifying", nextAction: scenario.action, recoveryMessage: scenario.message, publicCode: scenario.code, customerServiceFee: "0.2000", createdAt: "2026-09-06T00:00:00Z", clientRequestId: "recovery-test" },
      events: [{ eventId: "test-event", publicCode: scenario.code, publicMessage: scenario.message, occurredAt: "2026-09-06T00:00:00Z" }],
    } } }));
    await page.goto("/gpt-direct/orders/recovery-test");
    await expect(page.getByRole("button", { name: "提交 Session 并继续核对", exact: true })).toHaveCount(scenario.action === "submit_session" ? 1 : 0);
    await expect(page.getByRole("link", { name: "重新预检并下单", exact: true })).toHaveCount(scenario.action === "refresh_session_and_reorder" ? 1 : 0);
    await expect(page.getByRole("link", { name: /更换银行卡/ })).toHaveCount(scenario.action === "change_card_and_reorder" ? 1 : 0);
    if (scenario.action !== "wait") await expect(page.getByRole("region", { name: "下一步" })).toContainText(scenario.message);
    await expect(page.locator(".gpt-renewal-action")).toHaveCount(0);
  });
}

test("GPT direct hosted checkout action opens only the official Stripe page", async ({ page }) => {
  await mockAuthenticatedShell(page, "customer");
  const checkoutUrl = "https://checkout.stripe.com/c/pay/cs_live_test?key=value";
  await page.route("**/api/gpt-direct/orders/hosted-test", (route) => route.fulfill({ json: { code: 0, data: {
    order: {
      id: "hosted-test", plan: "plus", status: "requires_action", operationStatus: "SUBMITTED",
      stage: "verifying", nextAction: "open_hosted_checkout", publicCode: "hosted_checkout_required",
      recoveryMessage: "请在 Stripe 官方结账页完成持卡人验证。", checkoutUrl,
      customerServiceFee: "0.2000", createdAt: "2026-10-25T00:00:00Z", clientRequestId: "hosted-test",
    },
    events: [{ eventId: "hosted-event", publicCode: "hosted_checkout_required", publicMessage: "等待持卡人验证", occurredAt: "2026-10-25T00:00:00Z" }],
  } } }));
  await page.goto("/gpt-direct/orders/hosted-test");
  const action = page.getByRole("link", { name: "前往官方结账页", exact: true });
  await expect(action).toHaveAttribute("href", checkoutUrl);
  await expect(action).toHaveAttribute("target", "_blank");
});

test("GPT direct hosted checkout action accepts the official ChatGPT checkout route", async ({ page }) => {
  await mockAuthenticatedShell(page, "customer");
  const checkoutUrl = "https://chatgpt.com/checkout/openai_llc/cs_live_test";
  await page.route("**/api/gpt-direct/orders/hosted-chatgpt-test", (route) => route.fulfill({ json: { code: 0, data: {
    order: {
      id: "hosted-chatgpt-test", plan: "plus", status: "requires_action", operationStatus: "SUBMITTED",
      stage: "verifying", nextAction: "open_hosted_checkout", publicCode: "hosted_checkout_required",
      recoveryMessage: "请在官方结账页完成持卡人验证。", checkoutUrl,
      customerServiceFee: "0.2000", createdAt: "2026-10-25T00:00:00Z", clientRequestId: "hosted-chatgpt-test",
    },
    events: [],
  } } }));
  await page.goto("/gpt-direct/orders/hosted-chatgpt-test");
  await expect(page.getByRole("link", { name: "前往官方结账页", exact: true })).toHaveAttribute("href", checkoutUrl);
});

for (const progressSource of ["order", "events"] as const) {
  test(`GPT direct history recovery separates completed top-up from renewal using ${progressSource}`, async ({ page }, testInfo) => {
    await mockAuthenticatedShell(page, "customer");
    const order = { id: "renewal-recovery", plan: "plus", status: "requires_action", operationStatus: "SUBMITTED", stage: "verifying", nextAction: "submit_session", publicCode: "session_refresh_required", recoveryMessage: "请提交新 Session 完成核对", clientRequestId: "renewal-recovery", createdAt: "2026-09-07T05:48:00Z", willRenew: null,
      progress: progressSource === "order" ? [{ stage: "canceling" }, { stage: "verifying" }] : [] };
    const events = [
      ...(progressSource === "events" ? [{ eventId: "canceling", stage: "canceling", publicMessage: "正在取消自动续费", createdAt: order.createdAt }] : []),
      ...[1, 2].map((id) => ({ eventId: `session-${id}`, stage: "verifying", status: "requires_action", publicCode: "session_refresh_required", publicMessage: "支付后会话无法刷新；已停止自动重试，请提供新 Session 完成核对", createdAt: "2026-09-07T05:49:17Z" })),
    ];
    const writes: string[] = [];
    await page.route("**/api/gpt-direct/orders**", async (route) => {
      if (route.request().method() === "POST") {
        writes.push(new URL(route.request().url()).pathname);
        expect(route.request().postDataJSON()).toEqual({ credential: { mode: "session", session: "fresh-session-for-original-account" } });
        order.status = "running";
        return route.fulfill({ status: 202, json: { code: 0, data: order } });
      }
      return route.fulfill({ json: { code: 0, data: { order, events } } });
    });
    await page.goto("/gpt-direct/orders/renewal-recovery");
    const guidance = page.getByRole("region", { name: "下一步" });
    await expect(guidance).toContainText("直充服务已完成 · 自动续费待处理");
    await expect(guidance).toContainText("可能仍会续费");
    await expect(guidance).toContainText("无需重新下单或付款");
    await expect(page.getByText("支付后会话无法刷新；已停止自动重试，请提供新 Session 完成核对", { exact: true })).toHaveCount(0);
    await expect(page.locator(".gpt-order-event-list li").filter({ hasText: "直充服务已完成。自动续费取消结果未确认" })).toHaveCount(2);
    const submit = page.getByRole("button", { name: "提交新 Session 并取消续费", exact: true });
    await expect(submit).toBeDisabled();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.screenshot({ path: testInfo.outputPath("renewal-recovery.png"), fullPage: true, animations: "disabled" });
    await page.getByLabel("Session 凭据", { exact: true }).fill("fresh-session-for-original-account");
    await submit.click();
    await expect.poll(() => writes).toEqual(["/api/gpt-direct/orders/renewal-recovery/session"]);
    await expect(guidance).not.toContainText("直充服务已完成 · 自动续费待处理");
  });
}

test("GPT direct renders an immediate compensated rejection as a terminal order", async ({ page }, testInfo) => {
  if (testInfo.project.name === "frontend-mock") await mockAuthenticatedShell(page, "customer");
  await mockGptDirect(page, {
    createStatus: "failed_precharge",
    createOperationStatus: "COMPENSATED",
    detailStatuses: ["failed_precharge"],
    detailOperationStatuses: ["COMPENSATED"],
  });
  await page.goto("/gpt-direct");
  await page.getByLabel("Session 凭据", { exact: true }).fill("session-for-known-rejection-test");
  await page.getByRole("button", { name: "验证凭据与获取报价", exact: true }).click();
  await page.getByRole("button", { name: "提交开通", exact: true }).click();
  const progress = page.getByRole("dialog");
  await expect(progress).toContainText("local-order-1");
  await expect(progress).toContainText("订单已结束：扣款前失败");
  await expect(progress).toContainText("扣款前失败");
  await expect(progress.getByRole("button", { name: "取消", exact: true })).toHaveCount(0);
  await expect(page.getByText("OpenAI 服务请求失败，请稍后重试", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Session 凭据", { exact: true })).toHaveValue("");
});

test("GPT direct accepts a newly opened card handoff without auto-submitting", async ({ page }, testInfo) => {
  if (testInfo.project.name === "frontend-mock") await mockAuthenticatedShell(page, "customer");
  await mockGptDirect(page);
  await page.goto("/gpt-direct?cardId=91");
  await expect(page.getByRole("combobox", { name: "支付卡片" })).toContainText("4242");
  await expect(page.getByRole("button", { name: "提交开通", exact: true })).toBeDisabled();
  await expect(page).toHaveURL(/cardId=91/);
});

test("GPT direct treats an accepted cancellation as pending instead of an error", async ({ page }) => {
  await mockGptDirect(page, {
    detailStatuses: ["queued"],
    detailOperationStatuses: ["SUBMITTED"],
  });
  await page.goto("/gpt-direct");
  await page.getByLabel("Session 凭据", { exact: true }).fill("session-for-cancel-test");
  await page.getByRole("button", { name: "验证凭据与获取报价", exact: true }).click();
  await page.getByRole("button", { name: "提交开通", exact: true }).click();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("订单已结束", { timeout: 7_000 });
  await expect(page.getByText("取消订单失败", { exact: true })).toHaveCount(0);
});

test("GPT direct blocks checkout when the live quote fails", async ({ page }) => {
  await mockGptDirect(page, { quoteError: "Live quote is temporarily unavailable" });
  await page.goto("/gpt-direct");
  await page.getByLabel("Session 凭据", { exact: true }).fill("session-for-quote-test");
  await page.getByRole("button", { name: "验证凭据与获取报价", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Live quote is temporarily unavailable");
  await expect(page.getByRole("button", { name: "提交开通", exact: true })).toBeDisabled();
});

test("GPT direct explains the active-card requirement and fits mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockGptDirect(page, { activeCard: false });
  await page.goto("/gpt-direct");
  await expect(page.getByText("没有可用的虚拟卡", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "先去开卡", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "提交开通", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("GPT direct shows customer-owned CDK lifecycle records", async ({ page }) => {
  await mockGptDirect(page, { cdk: true });
  await page.goto("/gpt-direct");
  await openGptDirectTool(page, "CDK 生命周期");
  await expect(page.getByRole("heading", { name: "CDK 生命周期", exact: true })).toBeVisible();
  await expect(page.getByText("AVF-********", { exact: true })).toBeVisible();
  await expect(page.getByText("consumed", { exact: true })).toBeVisible();
  await expect(page.locator(".gpt-order-history-row").filter({ hasText: "AVF-********" })).toContainText("一卡一付");
});

test("customers can generate a one-CDK-one-card batch", async ({ page }) => {
  let generateBody: Record<string, unknown> | undefined;
  let generateKey = "";
  await mockAuthenticatedShell(page, "customer");
  await mockGptDirect(page, { onGenerate: (body, key) => { generateBody = body; generateKey = key; } });
  await page.goto("/gpt-direct");
  await openGptDirectTool(page, "生成待售 CDK");
  const generator = page.getByTestId("gpt-cdk-generate");
  const forceNewCard = generator.getByRole("checkbox", { name: /一卡一付（仅新开卡）/ });
  await expect(forceNewCard).not.toBeChecked();
  await forceNewCard.check();
  await generator.getByRole("combobox", { name: "CDK 结账地区" }).selectOption("US");
  const plus = generator.locator("article").filter({ hasText: "Plus" });
  await plus.getByLabel("数量", { exact: true }).fill("2");
  await plus.getByRole("button", { name: "生成 2 个", exact: true }).click();
  await expect.poll(() => generateBody).toEqual({ plan: "plus", quantity: 2, forceNewCard: true, paymentCountry: "US" });
  expect(generateKey).toMatch(/^[0-9a-f-]{36}$/);
  await expect(generator.getByRole("status")).toContainText("2 个 CDK 已生成并加密保存");
  await expect(generator.getByRole("status")).toContainText("一卡一付");
});

test("one-CDK-one-card stays hidden until every backend replica is upgraded", async ({ page }) => {
  await mockAuthenticatedShell(page, "customer");
  await mockGptDirect(page, { forceNewCardEnabled: false });
  await page.goto("/gpt-direct");
  await openGptDirectTool(page, "生成待售 CDK");
  await expect(page.getByTestId("gpt-cdk-generate").getByRole("checkbox", { name: /一卡一付（仅新开卡）/ })).toHaveCount(0);
});

test("CDK generation retries one intent but changes its key when card mode changes", async ({ page }) => {
  const calls: Array<{ body: Record<string, unknown>; key: string }> = [];
  await mockAuthenticatedShell(page, "customer");
  await mockGptDirect(page, {
    generateFailures: 2,
    onGenerate: (body, key) => calls.push({ body, key }),
  });
  await page.goto("/gpt-direct");
  await openGptDirectTool(page, "生成待售 CDK");
  const generator = page.getByTestId("gpt-cdk-generate");
  const plusButton = generator.getByTestId("gpt-cdk-generate-plus");
  await plusButton.click();
  await expect(generator.getByRole("alert")).toContainText("Temporary CDK generation failure");
  await plusButton.click();
  await expect.poll(() => calls.length).toBe(2);
  expect(calls[1].key).toBe(calls[0].key);
  expect(calls[0].body.forceNewCard).toBe(false);

  await generator.getByRole("checkbox", { name: /一卡一付（仅新开卡）/ }).check();
  await plusButton.click();
  await expect(generator.getByRole("status")).toContainText("一卡一付");
  expect(calls[2].key).not.toBe(calls[0].key);
  expect(calls[2].body.forceNewCard).toBe(true);
  await generator.getByRole("combobox", { name: "CDK 结账地区" }).selectOption("US");
  await plusButton.click();
  await expect.poll(() => calls.length).toBe(4);
  expect(calls[3].key).not.toBe(calls[2].key);
  expect(calls[3].body.paymentCountry).toBe("US");
});

test("logged-in customers can generate CDKs and see checkout countries from the API", async ({ page }) => {
  await mockAuthenticatedShell(page, "customer");
  await mockGptDirect(page);
  await page.goto("/gpt-direct");
  await openGptDirectTool(page, "生成待售 CDK");
  await expect(page.getByTestId("gpt-cdk-generate")).toBeVisible();
  await expect(page.getByText("买家兑换时必须粘贴完整 ChatGPT Session（含 sessionToken）。")).toBeVisible();
  await expect(page.getByText("普通模式只使用并轮换你名下已有的 ACTIVE 卡；没有可用卡时兑换失败，不会自动开卡。")).toBeVisible();
  await page.getByTestId("gpt-cdk-generate-plus").click();
  await expect(page.locator(".gpt-cdk-purchase-result")).toBeVisible();
  await expect(page.locator(".gpt-cdk-purchase-result code")).toHaveCount(1);
  await page.getByRole("combobox").first().click();
  await expect(page.getByRole("option", { name: /PH/ })).toBeVisible();
});

test("admin can configure GPT protocol settings without echoing proxy URLs", async ({ page }) => {
  let saved: Record<string, unknown> | undefined;
  let addedProxy: Record<string, unknown> | undefined;
  const gptProtocol = {
    commitPayments: false,
    plusAccountCap: 5,
    proAccountCap: 3,
    version: 1,
    countries: [
      { country: "PH", currency: "PHP", enabled: true, sortOrder: 1 },
      { country: "US", currency: "USD", enabled: true, sortOrder: 2 },
    ],
    proxies: [] as Array<Record<string, unknown>>,
  };
  await mockAuthenticatedShell(page, "admin");
  await mockAdminWorkspace(page);
  await page.route("**/api/admin/system-settings", (route) => route.fulfill({ json: { code: 0, data: {
    smtp: { host: "smtp.example.com", port: 465, security: "tls", username: "mailer", fromEmail: "no-reply@example.com", fromName: "AVANFINITY", enabled: false, passwordConfigured: true, ready: false, version: 1 },
    deposits: [{ enabled: false, network: "TRON", currency: "USDT", standard: "TRC20", tokenContract: tronAssetId, tokenDecimals: 6, addresses: ["TA4Wt1DUCqz6YegbnsmqsWC5uUfbdBqPxm"], apiKeyConfigured: false, ready: false, lastSuccessAt: null, lastErrorAt: null, lastError: null, lastTestStatus: "never", lastTestAt: null, lastErrorCode: null, version: 1 }],
    features: { version: 1, registration: true, walletTransfer: true, cardOpening: true, cardRecharge: true, cardManagement: true, cardDelete: true, gptDirect: true, gptCdk: true, deposits: true, rewards: true, agent: true, market: true, developerApi: true, telegram: true },
    paymentRisk: { version: 1, enabled: true, windowDays: 30, minAttempts: 100, lockThresholdBps: 3000, releaseThresholdBps: 2000, reserveBps: 2000, updatedAt: "2026-08-09T08:00:00Z" },
    walletPolicy: { marginReserve: "20", version: 1 },
    gptProtocol,
  } } }));
  await page.route("**/api/admin/system-settings/gpt-protocol/proxies", (route) => {
    addedProxy = route.request().postDataJSON() as Record<string, unknown>;
    gptProtocol.proxies = [{ id: 11, label: "ph-exit", expectedCountry: "US", enabled: true, consecutiveFailures: 0, lastError: null, lastUsedAt: null, urlConfigured: true }];
    gptProtocol.version += 1;
    return route.fulfill({ json: { code: 0, data: gptProtocol } });
  });
  await page.route("**/api/admin/system-settings/gpt-protocol", (route) => {
    saved = route.request().postDataJSON() as Record<string, unknown>;
    gptProtocol.commitPayments = Boolean((saved as { commitPayments?: boolean }).commitPayments);
    gptProtocol.version += 1;
    return route.fulfill({ json: { code: 0, data: gptProtocol } });
  });
  await page.goto("/admin");
  await page.getByTestId("admin-nav-system").click();
  const panel = page.getByTestId("gpt-protocol-settings");
  await expect(panel).toBeVisible();
  await expect(panel.getByText("还没有可用代理。池为空时会回退到部署环境里的 UPSTREAM_PROXY_URL。")).toBeVisible();
  await panel.getByLabel("名称").fill("ph-exit");
  await panel.getByLabel("代理 URL").fill("socks5://user:secret-proxy@127.0.0.1:1080");
  await panel.getByRole("button", { name: "添加代理", exact: true }).click();
  await expect.poll(() => addedProxy).toMatchObject({ label: "ph-exit", proxyUrl: "socks5://user:secret-proxy@127.0.0.1:1080" });
  await expect(panel.getByText("secret-proxy")).toHaveCount(0);
  await expect(panel.locator("input[type='password']")).toHaveValue("");
  await panel.getByRole("checkbox", { name: /允许真实扣款/ }).check();
  await panel.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => saved).toMatchObject({ commitPayments: true, version: 2 });
  expect(JSON.stringify(saved)).not.toContain("secret-proxy");
});

test("admin saves the GPT captcha key without echoing it", async ({ page }) => {
  let saved: Record<string, unknown> | undefined;
  const gptProtocol = {
    commitPayments: false,
    externalCardServiceFee: "1",
    plusAccountCap: 5,
    proAccountCap: 3,
    version: 4,
    csVisionBaseUrl: "https://api.keytunnels.com/v1",
    csVisionModel: "gpt-6.1-sol",
    csVisionApiKeyConfigured: false,
    countries: [{ country: "PH", currency: "PHP", enabled: true, sortOrder: 1 }],
  };
  await mockAuthenticatedShell(page, "admin");
  await mockAdminWorkspace(page);
  await page.route("**/api/admin/system-settings", (route) => route.fulfill({ json: { code: 0, data: {
    smtp: { host: "smtp.example.com", port: 465, security: "tls", username: "mailer", fromEmail: "no-reply@example.com", fromName: "AVANFINITY", enabled: false, passwordConfigured: true, ready: false, version: 1 },
    deposits: [{ enabled: false, network: "TRON", currency: "USDT", standard: "TRC20", tokenContract: tronAssetId, tokenDecimals: 6, addresses: ["TA4Wt1DUCqz6YegbnsmqsWC5uUfbdBqPxm"], apiKeyConfigured: false, ready: false, lastSuccessAt: null, lastErrorAt: null, lastError: null, lastTestStatus: "never", lastTestAt: null, lastErrorCode: null, version: 1 }],
    features: { version: 1, registration: true, walletTransfer: true, cardOpening: true, cardRecharge: true, cardManagement: true, cardDelete: true, gptDirect: true, gptCdk: true, deposits: true, rewards: true, agent: true, market: true, developerApi: true, telegram: true },
    paymentRisk: { version: 1, enabled: true, windowDays: 30, minAttempts: 100, lockThresholdBps: 3000, releaseThresholdBps: 2000, reserveBps: 2000, updatedAt: "2026-08-09T08:00:00Z" },
    walletPolicy: { marginReserve: "20", version: 1 },
    gptProtocol,
  } } }));
  await page.route("**/api/admin/system-settings/gpt-protocol", (route) => {
    saved = route.request().postDataJSON() as Record<string, unknown>;
    gptProtocol.csVisionApiKeyConfigured = true;
    gptProtocol.version += 1;
    return route.fulfill({ json: { code: 0, data: { ...gptProtocol } } });
  });
  await page.goto("/admin");
  await page.getByTestId("admin-nav-system").click();
  const panel = page.getByTestId("gpt-protocol-settings");
  await panel.getByLabel("GPT API Key").fill("sk-test-captcha-key-value");
  await panel.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => saved).toMatchObject({
    csVisionApiKey: "sk-test-captcha-key-value",
    csVisionBaseUrl: "https://api.keytunnels.com/v1",
    csVisionModel: "gpt-6.1-sol",
    version: 4,
  });
  await expect(panel.getByTestId("gpt-cs-vision-api-key")).toHaveValue("");
  await expect(panel.getByText("sk-test-captcha-key-value")).toHaveCount(0);
});

test("logged-in customers can generate CDKs in a batch and reveal them again from history", async ({ page }) => {
  let generateBody: Record<string, unknown> | undefined;
  let generateKey = "";
  let sensitiveCalls = 0;
  const exportMethods: string[] = [];
  const codes = ["AVF-00000000000000000000000000000017", "AVF-00000000000000000000000000000018"];
  await mockAuthenticatedShell(page, "customer");
  await mockGptDirect(page, { onGenerate: (body, key) => { generateBody = body; generateKey = key; } });
  await page.route("**/api/auth/captcha", (route) => route.fulfill({ json: { code: 0, data: {
    required: false, id: null, image: null, expiresIn: 0,
  } } }));
  await page.route("**/api/auth/login", (route) => route.fulfill({ json: {
    token: "recent-auth-token", email: "admin@danewcard.local", mfaLevel: "password",
  } }));
  await page.route("**/api/gpt-direct/cdks/*/sensitive", (route) => {
    sensitiveCalls += 1;
    return route.fulfill({ json: { code: 0, data: {
      id: "00000000-0000-0000-0000-000000000017", code: codes[0],
    } } });
  });
  await page.route("**/api/gpt-direct/cdks/export", (route) => {
    exportMethods.push(route.request().method());
    if (exportMethods.length === 1) {
      return route.fulfill({ status: 403, json: { error: "请重新认证后继续敏感操作", errorCode: "RECENT_AUTH_REQUIRED" } });
    }
    return route.fulfill({
      status: 200,
      headers: { "content-type": "application/zip" },
      body: codes.join("\n"),
    });
  });
  await page.goto("/gpt-direct");
  await openGptDirectTool(page, "生成待售 CDK");
  await expect(page.getByRole("heading", { name: "生成待售 CDK", exact: true }))
    .toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "购买自动开通 CDK", exact: true })).toHaveCount(0);
  const offer = page.getByTestId("gpt-cdk-generate").locator("article").filter({ hasText: "Plus" });
  await offer.getByRole("spinbutton", { name: "数量" }).fill("2");
  await offer.getByRole("button", { name: "生成 2 个", exact: true }).click();
  for (const code of codes) await expect(page.getByText(code, { exact: true })).toBeVisible();
  expect(generateBody).toEqual({ plan: "plus", quantity: 2, forceNewCard: false });
  expect(generateKey).toMatch(/^[0-9a-f-]{36}$/);
  const stored = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  for (const code of codes) expect(stored).not.toContain(code);
  expect(page.url()).not.toContain(codes[0]);
  await page.reload();
  for (const code of codes) await expect(page.getByText(code, { exact: true })).toHaveCount(0);
  await openGptDirectTool(page, "CDK 生命周期");
  await page.getByRole("button", { name: "导出未兑换 CDK", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("recentAuthReturnPath"))).toBe("/gpt-direct");
  await page.getByPlaceholder("your@email.com").fill("admin@danewcard.local");
  await page.getByPlaceholder("8+").fill("Admin123!Secure");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/gpt-direct$/);
  await openGptDirectTool(page, "CDK 生命周期");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "导出未兑换 CDK", exact: true }).click(),
  ]);
  expect(exportMethods).toEqual(["POST", "POST"]);
  expect(download.suggestedFilename()).toBe("avanfinity-cdks.zip");
  await page.getByRole("button", { name: "查看兑换码", exact: true }).first().click();
  await expect(page.getByText(codes[0], { exact: true })).toBeVisible();
  expect(sensitiveCalls).toBe(1);
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("recentAuthReturnPath"))).toBeNull();
  const storedAfterExport = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  for (const code of codes) expect(storedAfterExport).not.toContain(code);
});

test("GPT direct keeps the sensitive draft in tab memory across card navigation only", async ({ page }) => {
  const secret = "route-only-complete-session-json";
  await mockGptDirect(page, { activeCard: false });
  await page.goto("/gpt-direct");
  await page.getByLabel("Session 凭据", { exact: true }).fill(secret);
  await page.getByRole("combobox", { name: "付款地区" }).click();
  await page.getByRole("option", { name: "美国 (USD)" }).click();
  await page.getByRole("button", { name: "验证凭据与获取报价", exact: true }).click();
  await expect(page.getByText("u***@example.com", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "先去开卡", exact: true }).click();
  await expect(page).toHaveURL(/\/cards$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/gpt-direct$/);
  await expect(page.getByLabel("Session 凭据", { exact: true })).toHaveValue(secret);
  await expect(page.getByRole("combobox", { name: "付款地区" })).toContainText("USD");
  const stored = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  expect(stored).not.toContain(secret);
  expect(page.url()).not.toContain(secret);
  await page.reload();
  await expect(page.getByLabel("Session 凭据", { exact: true })).toHaveValue("");
});

test("logout and account switching erase the previous GPT Session draft", async ({ page, request }) => {
  const secret = "account-a-session-must-not-leak";
  const email = `gpt-draft-isolation-${Date.now()}@example.com`;
  await mockGptDirect(page);
  await page.goto("/gpt-direct");
  await page.getByLabel("Session 凭据", { exact: true }).fill(secret);
  expect((await request.post("/api/auth/register", { data: { email, password: "StrongRegister123!" } })).status()).toBe(200);
  await page.getByRole("button", { name: "退出", exact: true }).click();
  await page.getByPlaceholder("your@email.com").fill(email);
  await page.getByPlaceholder("8+").fill("StrongRegister123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/gpt-direct");
  await expect(page.getByLabel("Session 凭据", { exact: true })).toHaveValue("");
  const stored = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  expect(stored).not.toContain(secret);
  expect(page.url()).not.toContain(secret);
});

test("payment card last four follows anonymous CDK polling without storing credentials", async ({ page }, testInfo) => {
  const cdk = "SXC-TEST-TEST-TEST-TEST";
  const secret = "anonymous-complete-session-json";
  const deviceHeaders: string[] = [];
  const upstreamBodies: Record<string, unknown>[] = [];
  let resultCalls = 0;
  if (testInfo.project.name !== "frontend-mock") {
    await page.getByRole("button", { name: "退出", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
  }
  await page.route("**/api/public/cdk/**", async (route) => {
    const request = route.request();
    deviceHeaders.push(request.headers()["x-redemption-device"] ?? "");
    const path = new URL(request.url()).pathname;
    if (request.postData()) upstreamBodies.push(request.postDataJSON() as Record<string, unknown>);
    const headers = { "cache-control": "no-store" };
    if (path.endsWith("/preview")) return route.fulfill({ headers, json: { code: 0, data: { plan: "go", redemption_token: "redemption-token-one" } } });
    if (path.endsWith("/preflight")) return route.fulfill({ headers, json: { code: 0, data: { preflight_token: "preflight-token-one" } } });
    if (path.endsWith("/redeem")) return route.fulfill({ status: 202, headers, json: { code: 0, data: { status: "queued" } } });
    if (path.endsWith("/result")) return route.fulfill({ headers, json: { code: 0, data: { status: resultCalls++ ? "completed" : "running", stage: resultCalls > 1 ? "complete" : "payment_processing", cardLastFour: "0910" } } });
    return route.abort();
  });
  let localApiCalls = 0;
  let externalCdkCalls = 0;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin === new URL(page.url()).origin && url.pathname.startsWith("/api/public/cdk/")) localApiCalls += 1;
    if (url.hostname.endsWith("spacexcard.com") || url.hostname.endsWith("zovocard.com")) externalCdkCalls += 1;
  });
  await page.goto("/cdk/redeem");
  await expect(page).toHaveURL(/\/cdk\/redeem$/);
  await expect(page.getByTestId("app-sidebar")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "匿名兑换 GPT 套餐", exact: true })).toBeVisible();
  await expect(page.getByText("凭据加密保护", { exact: true })).toBeVisible();
  await expect(page.getByText(/SpaceX/i)).toHaveCount(0);
  await page.getByLabel("CDK 兑换码", { exact: true }).fill(cdk);
  await page.getByRole("button", { name: "验证 CDK", exact: true }).click();
  await expect(page.getByRole("heading", { name: "验证 GPT 账户", exact: true })).toBeVisible();
  await expect(page.getByText("当前 CDK 套餐：Go", { exact: true })).toBeVisible();
  await expect(page.getByLabel("GPT 账户邮箱", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("ChatGPT 登录密码", { exact: true })).toHaveCount(0);
  await page.getByLabel("Session 凭据", { exact: true }).fill(secret);
  await page.getByRole("button", { name: "安全验证账户", exact: true }).click();
  await expect(page.getByText("账户验证通过", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "确认兑换并开通", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("套餐已开通", { timeout: 8_000 });
  await expect(page.getByTestId("gpt-payment-card-last-four")).toHaveText("支付卡后四位：•••• 0910");
  expect(localApiCalls).toBeGreaterThanOrEqual(4);
  expect(externalCdkCalls).toBe(0);
  expect(new Set(deviceHeaders).size).toBe(1);
  expect(deviceHeaders[0]).toMatch(/^[0-9a-f-]{36}$/);
  expect(JSON.stringify(upstreamBodies)).toContain(cdk);
  expect(JSON.stringify(upstreamBodies)).toContain(secret);
  const stored = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  expect(stored).not.toContain(cdk);
  expect(stored).not.toContain(secret);
  expect(page.url()).not.toContain(cdk);
  expect(page.url()).not.toContain(secret);
});

test("logged-in CDK history shows a trusted Stripe invoice", async ({ page }) => {
  const invoiceUrl = "https://invoice.stripe.com/i/acct_test/inv_cdk_history";
  await mockAuthenticatedShell(page, "customer");
  await mockGptDirect(page, { cdk: true, cdkInvoiceUrl: invoiceUrl });
  await page.goto("/gpt-direct");
  await openGptDirectTool(page, "CDK 生命周期");
  const history = page.locator(".gpt-direct-tool-panel");
  const invoice = history.getByRole("link", { name: "查看 Stripe 账单", exact: true });
  await expect(invoice).toHaveCount(1);
  await expect(invoice).toHaveAttribute("href", invoiceUrl);
  await expect(invoice).toHaveAttribute("target", "_blank");
  await expect(history.getByText("u***@example.com")).toBeVisible();
});

test("feedback duration keeps Session errors readable and pauses on hover", async ({ page }) => {
  await mockAuthenticatedShell(page, "customer");
  await mockGptDirect(page);
  await page.route("**/api/gpt-direct/preflight", route => route.fulfill({ status: 400,
    json: { error: "Session 已失效，请重新登录并获取完整 Session。", errorCode: "GPT_SESSION_INVALID" } }));
  await page.goto("/gpt-direct");
  await page.getByLabel("Session 凭据", { exact: true }).fill("test-expired-session-json");
  await page.getByRole("button", { name: "验证凭据与获取报价", exact: true }).click();
  const notice = page.locator("p.error[role=alert]");
  await expect(notice).toContainText("Session 已失效");
  await expect(notice).toHaveCSS("animation-duration", "20s");
  await notice.evaluate(element => { element.getAnimations()[0].currentTime = 6000; });
  await expect(notice).toHaveCSS("opacity", "1");
  await notice.hover();
  await expect(notice).toHaveCSS("animation-play-state", "paused");
  await page.mouse.move(0, 400);
  await expect(notice).toHaveCSS("animation-play-state", "running");
  await notice.evaluate(element => { element.getAnimations()[0].currentTime = 19000; });
  await expect(notice).toHaveCSS("opacity", "1");
  await notice.evaluate(element => { element.getAnimations()[0].finish(); });
  await expect(notice).toBeHidden();
});

test("payment card last four is shown in direct and CDK history and drawers", async ({ page }) => {
  await mockAuthenticatedShell(page, "customer");
  await mockGptDirect(page, { historyInvoiceUrls: [null] });
  await page.route("**/api/gpt-direct/cdks*", route => route.fulfill({ json: { code: 0, data: {
    total: 1, list: [{ id: "last-four-cdk", codePrefix: "AVF-********", plan: "plus", status: "consumed",
      redemptionStatus: "completed", cardLastFour: "0910", updatedAt: "2026-09-07T00:00:00Z" }],
  } } }));
  await page.goto("/gpt-direct");
  await expect(page.locator(".gpt-order-history-row").getByText("支付卡后四位：•••• 4242", { exact: true })).toBeVisible();
  await page.locator(".gpt-order-heading-trigger").first().click();
  await expect(page.getByRole("dialog").getByTestId("gpt-payment-card-last-four")).toHaveText("支付卡后四位：•••• 4242");
  await page.keyboard.press("Escape");
  await openGptDirectTool(page, "CDK 生命周期");
  await expect(page.locator(".gpt-direct-tool-panel").getByText("支付卡后四位：•••• 0910", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "CDK 生命周期 AVF-********", exact: true }).click();
  await expect(page.getByRole("dialog").getByTestId("gpt-payment-card-last-four")).toHaveText("支付卡后四位：•••• 0910");
});

test("payment card last four receipt preserves zeros and rejects invalid values", async ({ page }) => {
  let lastFour: string | null = "0001";
  await page.route("**/api/auth/me", route => route.fulfill({ status: 401, json: { error: "unauthorized" } }));
  await page.route("**/api/public/cdk/receipt", route => route.fulfill({ json: { code: 0, data: {
    status: "completed", stage: "complete", plan: "plus", cardLastFour: lastFour,
  } } }));
  for (const value of ["0001", null, "12345", "12a4"]) {
    lastFour = value;
    await page.goto("/cdk/redeem");
    await page.getByLabel("已兑换的 CDK 码", { exact: true }).fill("SXC-LAST-FOUR-0001");
    await page.getByRole("button", { name: "查询账单", exact: true }).click();
    await expect(page.getByTestId("gpt-payment-card-last-four")).toHaveText(`支付卡后四位：${value === "0001" ? "•••• 0001" : "未记录"}`);
  }
});

test("anonymous CDK bill lookup shows a trusted Stripe invoice", async ({ page }, testInfo) => {
  const invoiceUrl = "https://invoice.stripe.com/i/acct_test/inv_cdk_lookup";
  if (testInfo.project.name !== "frontend-mock") {
    await page.getByRole("button", { name: "退出", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
  }
  await page.route("**/api/public/cdk/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const headers = { "cache-control": "no-store" };
    if (path.endsWith("/receipt")) {
      return route.fulfill({ headers, json: { code: 0, data: {
        status: "completed", stage: "complete", plan: "plus",
        invoiceUrl, maskedEmail: "u***@example.com",
      } } });
    }
    return route.abort();
  });
  await page.goto("/cdk/redeem");
  await expect(page.getByRole("heading", { name: "查询 CDK 账单", exact: true })).toBeVisible();
  await page.getByLabel("已兑换的 CDK 码", { exact: true }).fill("SXC-RECEIPT-TEST-0001");
  await page.getByRole("button", { name: "查询账单", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("套餐已开通");
  await expect(page.getByText("开通账户 u***@example.com")).toBeVisible();
  const invoice = page.getByRole("link", { name: "查看 Stripe 账单", exact: true });
  await expect(invoice).toHaveAttribute("href", invoiceUrl);
  await expect(invoice).toHaveAttribute("target", "_blank");
  await expect(invoice).toHaveAttribute("rel", "noopener noreferrer");
});

test("uncertain CDK redemption posts once and only polls the original result", async ({ page, context }) => {
  await page.getByRole("button", { name: "退出", exact: true }).click();
  await expect.poll(async () => (await context.cookies()).some((cookie) => cookie.name === "danew_session")).toBe(false);
  let redeemPosts = 0;
  let resultCalls = 0;
  let redeemBody: Record<string, unknown> | undefined;
  const statuses = ["pending", "review", "completed"];
  await page.route("**/api/public/cdk/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const headers = { "access-control-allow-origin": "*" };
    if (path.endsWith("/preview")) return route.fulfill({ headers, json: { code: 0, data: { plan: "plus", redemption_token: "uncertain-redemption-token" } } });
    if (path.endsWith("/preflight")) return route.fulfill({ headers, json: { code: 0, data: { preflight_token: "uncertain-preflight-token" } } });
    if (path.endsWith("/redeem")) {
      redeemPosts += 1;
      redeemBody = request.postDataJSON() as Record<string, unknown>;
      return route.abort("connectionfailed");
    }
    if (path.endsWith("/result")) {
      const status = statuses[Math.min(resultCalls, statuses.length - 1)];
      resultCalls += 1;
      return route.fulfill({ headers, json: { code: 0, data: { status, stage: status } } });
    }
    return route.abort();
  });
  await page.goto("/cdk/redeem");
  await page.getByLabel("CDK 兑换码", { exact: true }).fill("SXC-UNCERTAIN-TEST-0001");
  await page.getByRole("button", { name: "验证 CDK", exact: true }).click();
  await page.getByLabel("Session 凭据", { exact: true }).fill("uncertain-session-json");
  await page.getByRole("button", { name: "安全验证账户", exact: true }).click();
  await page.getByRole("button", { name: "确认兑换并开通", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("套餐已开通", { timeout: 12_000 });
  expect(redeemPosts).toBe(1);
  expect(resultCalls).toBeGreaterThanOrEqual(3);
  expect(redeemBody).not.toHaveProperty("cardId");
  expect(redeemBody).not.toHaveProperty("card_id");
  const settledCalls = resultCalls;
  await page.waitForTimeout(3_500);
  expect(redeemPosts).toBe(1);
  expect(resultCalls).toBe(settledCalls);
});

test("logged-in users keep the app shell on the CDK page", async ({ page }) => {
  await page.goto("/gpt-direct");
  await page.getByTestId("app-sidebar").getByRole("link", { name: "CDK 兑换", exact: true }).click();
  await expect(page).toHaveURL(/\/cdk\/redeem$/);
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
  await expect(page.locator("#main-content .cdk-page")).toBeVisible();
  await expect(page.locator(".cdk-nav")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "兑换 GPT 套餐", exact: true })).toBeVisible();
});

test("a stale login never blocks the public CDK page", async ({ page, context }) => {
  await context.clearCookies();
  await page.goto("/cdk/redeem");
  await expect(page.getByTestId("app-sidebar")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "匿名兑换 GPT 套餐", exact: true })).toBeVisible();
});

test("referral link preserves the first attribution for three-character normalization, paths, and queries", () => {
  expect(normalizeInviteCode(" 666 ")).toBe("666");
  expect(normalizeInviteCode("777")).toBe("777");
  expect(normalizeInviteCode("77")).toBeNull();
  expect(referralCodeFromUrl(new URL("https://example.test/invite/666"))).toBe("666");
  expect(referralCodeFromUrl(new URL("https://example.test/register/invite/777"))).toBe("777");
  expect(referralCodeFromUrl(new URL("https://example.test/register?ref=666"))).toBe("666");
  expect(referralCodeFromUrl(new URL("https://example.test/register?inviteCode=777"))).toBe("777");
});

test("referral link preserves the first attribution across page restarts", async ({ page, context }) => {
  const first = "FIRSTREF01";
  const hijack = "HIJACK001";
  const attributionRequests: string[] = [];
  const registrations: Record<string, unknown>[] = [];
  let attributedCode = "";
  let referralDisplayMode: "equivalent" | "profit_share" = "equivalent";
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await context.route("**/api/features", (route) => route.fulfill({ json: { code: 0, data: {
    version: 1, registration: true, walletTransfer: true, cardOpening: true, cardRecharge: true, cardManagement: true, cardDelete: true,
    gptDirect: true, gptCdk: true, deposits: true, rewards: true, agent: false, market: true,
    developerApi: true, telegram: true,
  } } }));
  await context.route("**/api/auth/captcha", (route) => route.fulfill({ json: { code: 0, data: { required: false } } }));
  await context.route("**/api/dashboard", (route) => route.fulfill({ json: {
    userId: 7, email: "inviter@example.com", displayName: "inviter@example.com", role: "user", walletBalance: "0.0000", cardBalance: "0.0000",
    cardCount: 0, inviteCode: first,
  } }));
  await context.route("**/api/announcements/unread", (route) => route.fulfill({ json: { code: 0, data: [], unreadCount: 0 } }));
  await context.route("**/api/referral", (route) => route.fulfill({ json: { code: 0, data: {
    inviteCode: first, inviteUrl: `/register?ref=${first}`, inviteLinks: {
      path: `/invite/${first}`, query: `/register?ref=${first}`, bot: `https://t.me/avanfinity_bot?start=ref_${first}`,
    }, promoBalance: "1.2500", referralCount: 2,
    openCardBonus: "0.2500", depositRebate: "0.0000", cardRechargeRebate: "1.0000", cumulativeEarnings: "1.2500",
    directReferrals: { total: 2, limit: 100, list: [{
      id: 8, maskedEmail: "f***@example.com", memberTier: "none", tierNameZh: "普通会员", tierNameEn: "Standard",
      earned: "0.2500", openCardEarned: "0.2500", rechargeEarned: "0.0000", createdAt: "2026-08-05T08:00:00Z",
    }, {
      id: 9, maskedEmail: "s***@example.com", memberTier: "super", tierNameZh: "超级 SVIP", tierNameEn: "Super SVIP",
      earned: "1.0000", openCardEarned: "0.0000", rechargeEarned: "1.0000", createdAt: "2026-08-06T08:00:00Z",
    }] },
    txList: [{ id: 12, type: "card_recharge_rebate", amount: "1.0000", balanceBefore: "0.2500", balanceAfter: "1.2500",
      remark: "直属用户卡片充值返利", refUserId: 9, refUserEmail: "s***@example.com", createdAt: "2026-08-06T09:00:00Z" }],
    policy: {
      rewardsEnabled: true, directOnly: true, calculationMode: "confirmed_profit_share", profitShareRate: "0.500000", displayMode: referralDisplayMode, tierRewards: [
        { code: "none", nameZh: "普通会员", nameEn: "Standard", openingBaseReward: { min: "0.6000", max: "0.6000" }, rechargeRewardRate: { min: "0.010000", max: "0.010000" }, referralCount: 1 },
        { code: "super", nameZh: "超级 SVIP", nameEn: "Super SVIP", openingBaseReward: { min: "0.4000", max: "0.7000" }, rechargeRewardRate: null, referralCount: 1 },
      ],
    },
  } } }));
  await context.route("**/api/auth/referral-attribution", (route) => {
    const requested = String((route.request().postDataJSON() as { inviteCode: string }).inviteCode).toUpperCase();
    attributionRequests.push(requested);
    attributedCode ||= requested;
    return route.fulfill({ json: { code: 0, data: { inviteCode: attributedCode } } });
  });
  await context.route("**/api/auth/register", (route) => {
    registrations.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.fulfill({ json: { code: 0, data: { emailVerificationRequired: false } } });
  });

  await page.goto("/login");
  await page.evaluate(() => localStorage.setItem("session", JSON.stringify({ token: "", email: "inviter@example.com" })));
  await page.goto("/referral");
  const expectedLink = new URL(`/invite/${first}`, page.url()).toString();
  await expect(page.getByTestId("referral-link-path").locator(".referral-link-value")).toHaveText(expectedLink, { timeout: 10_000 });
  await page.getByRole("button", { name: "网页参数链接", exact: true }).click();
  await expect(page.getByRole("group", { name: "我的邀请链接", exact: true })).toHaveAttribute("data-selected", "query");
  await expect(page.getByTestId("referral-link-query")).toContainText(`/register?ref=${first}`);
  await page.getByRole("button", { name: "Telegram Bot 链接", exact: true }).click();
  await expect(page.getByRole("group", { name: "我的邀请链接", exact: true })).toHaveAttribute("data-selected", "bot");
  await expect(page.getByTestId("referral-link-bot")).toContainText(`start=ref_${first}`);
  await expect(page.locator(".invite-link-list .referral-hero")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "代理推广", exact: true })).toBeVisible();
  await expect(page.locator(".referral-page > header")).toContainText("好友完成有效开卡或卡充值后");
  await expect(page.getByTestId("referral-overview")).toContainText("2");
  await expect(page.getByTestId("referral-overview")).toContainText("$1.25");
  await expect(page.getByTestId("referral-tier-count-none")).toContainText("普通会员");
  await expect(page.getByTestId("referral-tier-count-none")).toContainText("1 人");
  await expect(page.getByTestId("referral-tier-count-super")).toContainText("超级 SVIP");
  await expect(page.getByTestId("referral-direct-8")).toContainText("f***@example.com");
  await expect(page.getByTestId("referral-direct-8")).toContainText("$0.25");
  await expect(page.getByTestId("referral-direct-9")).toContainText("$1");
  await expect(page.getByTestId("referral-transactions")).toContainText("s***@example.com");
  await expect(page.getByTestId("referral-overview")).toContainText("返利余额");
  await expect(page.getByRole("button", { name: "全部转入平台余额", exact: true })).toBeVisible();
  await expect(page.locator(".referral-balance-note")).toContainText("不支持直接提现到外部地址");
  await expect(page.getByTestId("referral-policy-summary")).toContainText("50%");
  await expect(page.getByTestId("referral-tier-none")).toContainText("预计每张开卡基础返利 $0.6");
  await expect(page.getByTestId("referral-tier-none")).toContainText("预计卡充值返利率 1%");
  await expect(page.getByTestId("referral-tier-super")).toContainText("$0.4–$0.7");
  await expect(page.getByTestId("referral-tier-super")).toContainText("按正毛利的 50% 结算");
  await expect(page.locator(".referral-policy-panel")).toContainText("仅直属一层");
  await expect(page.locator(".referral-policy-panel")).toContainText("返利比例在订单创建时锁定");
  await expect(page.locator(".referral-policy-panel")).toContainText("实际按订单完成时的真实结果结算");
  await expect(page.locator(".referral-page")).not.toContainText(/暂停|上游|成本|倍率|稳赚|平台不赚钱|全部利润/);
  const sectionOrder = await Promise.all(["referral-overview", "referral-link", "referral-tier-overview", "referral-directs", "referral-policy", "referral-transactions"]
    .map(async (testId) => (await page.getByTestId(testId).boundingBox())!.y));
  expect(sectionOrder).toEqual([...sectionOrder].sort((a, b) => a - b));
  for (const [sectionId, cardId] of [["referral-tier-overview", "referral-tier-count-none"], ["referral-policy", "referral-tier-none"]] as const) {
    const [titleBox, cardBox] = await Promise.all([
      page.getByTestId(sectionId).locator(":scope > .section-title").boundingBox(),
      page.getByTestId(cardId).boundingBox(),
    ]);
    expect(titleBox).not.toBeNull();
    expect(cardBox).not.toBeNull();
    expect(cardBox!.y - (titleBox!.y + titleBox!.height)).toBeGreaterThanOrEqual(16);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => document.documentElement.clientWidth),
  );
  for (const [sectionId, cardId] of [["referral-tier-overview", "referral-tier-count-none"], ["referral-policy", "referral-tier-none"]] as const) {
    const [titleBox, cardBox] = await Promise.all([
      page.getByTestId(sectionId).locator(":scope > .section-title").boundingBox(),
      page.getByTestId(cardId).boundingBox(),
    ]);
    expect(titleBox).not.toBeNull();
    expect(cardBox).not.toBeNull();
    expect(cardBox!.y - (titleBox!.y + titleBox!.height)).toBeGreaterThanOrEqual(16);
  }
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page.getByTestId("referral-policy-summary")).toContainText("confirmed positive profit");
  await expect(page.getByTestId("referral-policy")).toContainText("locked when the order is created");
  await expect(page.locator(".referral-balance-note")).toContainText("external addresses");
  await page.getByRole("button", { name: "中文", exact: true }).click();
  referralDisplayMode = "profit_share";
  await page.reload();
  await expect(page.getByTestId("referral-policy-summary")).toContainText("50%");
  await expect(page.getByTestId("referral-tier-none")).toHaveCount(0);
  await expect(page.getByTestId("referral-policy")).not.toContainText("暂无可用产品估算");
  await page.getByRole("button", { name: "复制网页短链", exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(expectedLink);

  await page.evaluate(() => localStorage.removeItem("session"));
  await page.goto(expectedLink);
  await expect.poll(() => attributionRequests.includes(first)).toBe(true);
  await expect(page.locator('input[name="inviteCode"]')).toHaveCount(0);
  await expect(page.getByTestId("invite-attribution-locked")).toBeVisible();

  await page.goto(`/register?ref=${hijack}`);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("referralInviteCode"))).toBe(first);
  await expect(page.locator('input[name="inviteCode"]')).toHaveCount(0);

  await page.close();
  const reopened = await context.newPage();
  await reopened.goto("/register");
  await expect(reopened.locator('input[name="inviteCode"]')).toHaveCount(0);
  await reopened.getByPlaceholder("your@email.com").fill("referred@example.com");
  await reopened.getByPlaceholder("12+ characters").fill("StrongRegister123!");
  await reopened.getByRole("button", { name: "创建账户", exact: true }).click();
  await expect.poll(() => registrations.length).toBe(1);
  expect(registrations[0]).toMatchObject({ inviteCode: first });
});

test("referral attribution routes stay locked through temporary capture failures", async ({ page }) => {
  const registrations: Record<string, unknown>[] = [];
  await page.route("**/api/features", (route) => route.fulfill({ json: { code: 0, data: {
    version: 1, registration: true, walletTransfer: true, cardOpening: true, cardRecharge: true, cardManagement: true, cardDelete: true,
    gptDirect: true, gptCdk: true, deposits: true, rewards: true, agent: false, market: true, developerApi: true, telegram: true,
  } } }));
  await page.route("**/api/auth/referral-attribution", (route) => route.fulfill({ status: 503, json: { error: "try again" } }));
  await page.route("**/api/auth/register", (route) => {
    registrations.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.fulfill({ json: { code: 0, data: { emailVerificationRequired: false } } });
  });

  for (const path of [
    "/invite/PATHCODE1", "/r/SHORT001", "/register/invite/NESTED01",
    "/register?ref=QUERY001", "/register?invite=QUERY002", "/register?inviteCode=QUERY003",
  ]) {
    await page.goto("/register");
    await page.evaluate(() => localStorage.removeItem("referralInviteCode"));
    await page.goto(path);
    await expect(page.getByTestId("invite-attribution-locked")).toBeVisible();
    await expect(page.locator('input[name="inviteCode"]')).toHaveCount(0);
  }

  await page.getByPlaceholder("your@email.com").fill("query@example.com");
  await page.getByPlaceholder("12+ characters").fill("StrongRegister123!");
  await page.getByRole("button", { name: "创建账户", exact: true }).click();
  await expect.poll(() => registrations.length).toBe(1);
  expect(registrations[0]).toMatchObject({ inviteCode: "QUERY003" });

  await page.goto("/register");
  await page.evaluate(() => localStorage.removeItem("referralInviteCode"));
  await page.reload();
  await expect(page.locator('input[name="inviteCode"]')).toBeEditable();

  await page.unroute("**/api/auth/referral-attribution");
  await page.route("**/api/auth/referral-attribution", (route) => route.fulfill({ status: 400, json: { error: "inactive" } }));
  await page.evaluate(() => localStorage.setItem("referralInviteCode", "LOCKED01"));
  await page.goto("/register?ref=REPLACEMENT01");
  await expect(page.getByTestId("invite-attribution-locked")).toBeVisible();
  await expect(page.locator('input[name="inviteCode"]')).toHaveCount(0);
});

test("Telegram-created account can correct pending email login setup", async ({ page }) => {
  let submitted: Record<string, unknown> | null = null;
  await page.addInitScript(() => localStorage.setItem("session", JSON.stringify({ token: "", userId: 42, email: null, displayName: "@alice", mfaLevel: "telegram" })));
  await page.route("**/api/features", (route) => route.fulfill({ json: { code: 0, data: {
    version: 1, registration: true, walletTransfer: true, cardOpening: true, cardRecharge: true, cardManagement: true, cardDelete: true,
    gptDirect: true, gptCdk: true, deposits: true, rewards: true, agent: false, market: true, developerApi: true, telegram: true,
  } } }));
  await page.route("**/api/dashboard", (route) => route.fulfill({ json: {
    userId: 42, email: null, displayName: "@alice", role: "user", walletBalance: "0.0000", cardBalance: "0.0000", cardCount: 0, inviteCode: "ALICE42",
  } }));
  await page.route("**/api/announcements/unread", (route) => route.fulfill({ json: { code: 0, data: [], unreadCount: 0 } }));
  await page.route("**/api/settings", (route) => route.fulfill({ json: { code: 0, data: {
    userId: 42, email: null, displayName: "@alice", role: "user", status: "active", memberTier: "none", inviteCode: "ALICE42",
    avatarUrl: null, cumulativeRecharge: "0.0000", createdAt: "2026-08-14T00:00:00Z", nextTier: null,
    emailLoginEnabled: false, emailVerified: false, emailVerificationPending: true, pendingEmail: "wrong@example.com", canUnbind: false,
  } } }));
  await page.route("**/api/telegram", (route) => route.fulfill({ json: { code: 0, data: {
    botConfigured: true, botName: "avanfinity_bot", isBound: true, chatId: "42", username: "alice", pendingUnbind: null,
  } } }));
  await page.route("**/api/settings/email-login", (route) => {
    submitted = route.request().postDataJSON() as Record<string, unknown>;
    return route.fulfill({ json: { code: 0, msg: "ok", data: { email: "right@example.com", emailVerificationRequired: true, cooldownSeconds: 60 } } });
  });

  await page.goto("/settings");
  await expect(page.getByTestId("email-login-setup")).toContainText("邮箱登录信息已保存");
  await expect(page.locator('input[name="email"]')).toHaveValue("wrong@example.com");
  await page.locator('input[name="email"]').fill("right@example.com");
  await page.locator('input[name="password"]').fill("StrongPassword123!");
  await page.locator('input[name="confirmPassword"]').fill("StrongPassword123!");
  await page.getByRole("button", { name: "更新并重新发送验证", exact: true }).click();
  await expect.poll(() => submitted).toMatchObject({ email: "right@example.com" });
  await expect(page).toHaveURL(/\/verify-email$/);
});

test("Lucide icons stay square across GPT, CDK, and admin pages", async ({ page }) => {
  await mockGptDirect(page);
  for (const path of ["/gpt-direct", "/cdk/redeem", "/admin"]) {
    await page.goto(path);
    if (path === "/gpt-direct") {
      const [icon, title] = await Promise.all([
        page.locator(".gpt-preflight-placeholder svg").boundingBox(),
        page.locator(".gpt-preflight-placeholder strong").boundingBox(),
      ]);
      expect(title!.x).toBeGreaterThan(icon!.x + icon!.width);
      expect(Math.abs(title!.y + title!.height / 2 - icon!.y - icon!.height / 2)).toBeLessThanOrEqual(1);
    }
    const mismatches = await page.locator("svg.lucide:visible").evaluateAll((elements) => elements
      .map((element) => ({ className: element.getAttribute("class"), width: element.clientWidth, height: element.clientHeight }))
      .filter(({ width, height }) => Math.abs(width - height) > 0.5));
    expect(mismatches, `${path} has stretched icons`).toEqual([]);
  }
});

test("referral page stays centered and stat icons stay square", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/referral");
  const [content, referral] = await Promise.all([
    page.locator("#main-content").boundingBox(),
    page.locator(".finance-page").boundingBox(),
  ]);
  expect(Math.abs(referral!.x - content!.x - (content!.width - referral!.width) / 2)).toBeLessThanOrEqual(1);
  expect((await page.locator(".finance-page > header").boundingBox())!.x - referral!.x).toBeGreaterThanOrEqual(44);
  const icons = page.locator(".referral-stats article > svg");
  await expect(icons).toHaveCount(3);
  const sizes = await icons.evaluateAll((icons) =>
    icons.map((icon) => ({ width: icon.clientWidth, height: icon.clientHeight })),
  );
  expect(sizes).toEqual(Array(3).fill({ width: 32, height: 32 }));
});

test("cards fill wide screens without cramped columns", async ({ page }) => {
  await mockAuthenticatedShell(page, "user");
  await page.setViewportSize({ width: 1920, height: 1080 });
  const product = {
    productCode: "LAYOUT_SHORT", issuer: "E2E Bank", network: "VISA", issuingArea: "US", cardType: "Virtual",
    openFee: "1.0000", openQuoteVersion: "a".repeat(64), rechargeRate: "0.010000", refundRate: "0.020000",
    minAmount: "10.0000", maxAmount: "1000.0000", category: "AI", displayBin: "545020", displayBins: ["545020"],
    restrictedMerchants: [], googleChatgptBlocked: false,
  };
  await page.route("**/api/products", (route) => route.fulfill({ json: { code: 0, data: [
      { ...product, description: "Short product description." },
      { ...product, productCode: `${product.productCode}_LAYOUT`, description: "Long product description. ".repeat(24) },
    ] } }));
  await page.route("**/api/cards", (route) => route.fulfill({ json: { code: 0, data: { total: 0, list: [] } } }));
  await page.goto("/cards");
  const cards = page.locator(".product-card");
  await expect(cards.nth(1)).toBeVisible();
  const [pageBox, firstCard, secondCard] = await Promise.all([
    page.locator(".cards-page").boundingBox(),
    cards.first().boundingBox(),
    cards.nth(1).boundingBox(),
  ]);
  expect(1920 - (pageBox!.x + pageBox!.width)).toBeLessThanOrEqual(16);
  expect(Math.abs(firstCard!.y - secondCard!.y)).toBeLessThanOrEqual(1);
  expect(secondCard!.x - firstCard!.x - firstCard!.width).toBeGreaterThanOrEqual(20);
  const purposeLines = (card: Locator) => card.locator(".product-purpose-more summary").evaluate((el) => el.clientHeight / parseFloat(getComputedStyle(el).lineHeight));
  expect(await purposeLines(cards.first())).toBeGreaterThanOrEqual(1.9);
  expect(await purposeLines(cards.first())).toBeLessThanOrEqual(2.15);
  const longPurpose = cards.nth(1).locator(".product-purpose-more");
  await expect(longPurpose.getByText("更多", { exact: true })).toBeVisible();
  expect(await purposeLines(cards.nth(1))).toBeGreaterThanOrEqual(1.9);
  expect(await purposeLines(cards.nth(1))).toBeLessThanOrEqual(2.15);
  await longPurpose.locator("summary").click();
  await expect(longPurpose.getByText("收起", { exact: true })).toBeVisible();
  await expect(longPurpose).toContainText("Long product description. Long product description.");
  expect(await longPurpose.locator("summary").evaluate((el) => el.clientHeight / parseFloat(getComputedStyle(el).lineHeight))).toBeGreaterThan(2.5);
});

test("single card product keeps a normal width and still fits mobile", async ({ page }) => {
  await mockAuthenticatedShell(page, "user");
  await page.route("**/api/products", (route) => route.fulfill({ json: { code: 0, data: [{
    productCode: "ONLY_CARD", issuer: "E2E Bank", network: "VISA", issuingArea: "US", cardType: "Virtual",
    openFee: "1.0000", openQuoteVersion: "a".repeat(64), rechargeRate: "0.010000", refundRate: "0.020000",
    minAmount: "10.0000", maxAmount: "1000.0000", description: "AI subscriptions", category: "AI",
    displayBin: "545020", restrictedMerchants: [], googleChatgptBlocked: false,
  }] } }));
  await page.route("**/api/cards", (route) => route.fulfill({ json: { code: 0, data: { total: 0, list: [] } } }));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/cards");

  const card = page.getByTestId("product-ONLY_CARD");
  const desktopBox = await card.boundingBox();
  expect(desktopBox!.width).toBeLessThanOrEqual(621);
  expect(desktopBox!.width).toBeGreaterThan(440);

  await page.setViewportSize({ width: 390, height: 844 });
  const [mobileCard, mobilePage] = await Promise.all([card.boundingBox(), page.locator(".cards-page").boundingBox()]);
  expect(mobileCard!.width).toBeLessThanOrEqual(mobilePage!.width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => document.documentElement.clientWidth),
  );
});

test("opened cards use a separate page", async ({ page }) => {
  await mockAuthenticatedShell(page, "user");
  await page.route("**/api/products", (route) => route.fulfill({ json: { code: 0, data: [{
    productCode: "SEPARATE_PAGE", issuer: "E2E Bank", network: "VISA", issuingArea: "US", cardType: "Virtual",
    openFee: "1.0000", rechargeRate: "0.010000", refundRate: "0.020000", minAmount: "10.0000", maxAmount: "1000.0000",
    description: "Separate opened-card page", category: "AI", displayBin: "545020", restrictedMerchants: [], googleChatgptBlocked: true,
  }] } }));
  await page.route("**/api/cards", (route) => route.fulfill({ json: { code: 0, data: { total: 1, list: [{
    id: 91, cardNumberMasked: "•••• •••• •••• 0091", productCode: "SEPARATE_PAGE", network: "VISA", issuingArea: "US",
    status: "ACTIVE", balance: "20.0000", firstName: "Opened", lastName: "Card", createdAt: "2026-08-27T00:00:00Z",
  }] } } }));

  await page.goto("/cards");
  await expect(page.getByTestId("product-SEPARATE_PAGE")).toBeVisible();
  await expect(page.locator(".owned-cards")).toHaveCount(0);
  await page.locator(".cards-page > header").getByRole("link", { name: "已开卡片", exact: true }).click();

  await expect(page).toHaveURL(/\/cards\/owned$/);
  await expect(page.getByRole("heading", { name: "已开卡片", exact: true, level: 1 })).toBeVisible();
  await expect(page.locator(".product-grid")).toHaveCount(0);
  await expect(page.locator(".bank-card").filter({ hasText: "Opened Card" })).toBeVisible();
  await expect(page.getByTestId("app-sidebar").getByRole("link", { name: "已开卡片", exact: true })).toHaveAttribute("aria-current", "page");
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect((await page.locator(".owned-cards").boundingBox())!.y).toBeLessThan(260);

  await page.locator(".cards-page > header").getByRole("link", { name: "开卡中心", exact: true }).click();
  await expect(page).toHaveURL(/\/cards$/);
  await expect(page.getByTestId("product-SEPARATE_PAGE")).toBeVisible();
  await page.goto("/cards/open/SEPARATE_PAGE");
  await expect(page.getByText("本卡不支持 Google 相关支付。若向 Google 商户发起交易，发卡方将直接终止服务并注销该卡，请勿尝试使用。", { exact: true })).toBeVisible();
});

test("owned cards show notes on the list", async ({ page }) => {
  await mockAuthenticatedShell(page, "user");
  await page.route("**/api/products", (route) => route.fulfill({ json: { code: 0, data: [] } }));
  await page.route("**/api/cards", (route) => route.fulfill({ json: { code: 0, data: { total: 2, list: [
    {
      id: 91, cardNumberMasked: "•••• •••• •••• 0091", productCode: "NOTE_CARD", network: "VISA", issuingArea: "US",
      status: "ACTIVE", balance: "20.0000", refundKeepMinimum: "0.1000", firstName: "Noted", lastName: "Card",
      note: "ChatGPT Plus 续费", pendingOperationId: null, pendingOperationType: null, createdAt: "2026-09-11T00:00:00Z",
    },
    {
      id: 92, cardNumberMasked: "•••• •••• •••• 0092", productCode: "BLANK_NOTE", network: "VISA", issuingArea: "US",
      status: "ACTIVE", balance: "15.0000", refundKeepMinimum: "0.1000", firstName: "Blank", lastName: "Note",
      note: "   ", pendingOperationId: null, pendingOperationType: null, createdAt: "2026-09-11T00:00:00Z",
    },
  ] } } }));
  await page.route("**/api/gpt-direct/card-successes", (route) => route.fulfill({ json: { code: 0, data: { list: [] } } }));

  await page.goto("/cards/owned");
  const noted = page.locator(".bank-card").filter({ hasText: "Noted Card" });
  const blank = page.locator(".bank-card").filter({ hasText: "Blank Note" });
  await expect(noted.getByTestId("owned-card-note")).toHaveText("ChatGPT Plus 续费");
  await expect(noted.getByTestId("owned-card-note")).toHaveAttribute("title", "ChatGPT Plus 续费");
  await expect(blank.getByTestId("owned-card-note")).toHaveCount(0);
  await expect(blank).not.toContainText("ChatGPT Plus 续费");
});

test("owned cards paginate beyond the first page", async ({ page }) => {
  await mockAuthenticatedShell(page, "user");
  await page.route("**/api/products", (route) => route.fulfill({ json: { code: 0, data: [] } }));
  await page.route("**/api/gpt-direct/card-successes", (route) => route.fulfill({ json: { code: 0, data: { list: [] } } }));
  await page.route(/\/api\/cards(\?|$)/, (route) => {
    const url = new URL(route.request().url());
    const pageNumber = Number(url.searchParams.get("page") || "1");
    const pageSize = Number(url.searchParams.get("page_size") || "20");
    const card = (id: number, firstName: string, lastName: string) => ({
      id, cardNumberMasked: `•••• •••• •••• ${String(id).padStart(4, "0")}`, productCode: "PAGE_CARD",
      network: "VISA", issuingArea: "US", status: "ACTIVE", balance: "20.0000",
      firstName, lastName, createdAt: "2026-09-14T00:00:00Z",
    });
    return route.fulfill({ json: { code: 0, data: {
      total: 21, page: pageNumber, pageSize, list: pageNumber === 1 ? [card(1, "First", "Page")] : [card(21, "Second", "Page")],
    } } });
  });

  await page.goto("/cards/owned");
  await expect(page.locator(".bank-card").filter({ hasText: "First Page" })).toBeVisible();
  await expect(page.locator(".bank-card").filter({ hasText: "Second Page" })).toHaveCount(0);
  await expect(page.getByText("共 21 张")).toBeVisible();
  const pagination = page.getByTestId("owned-cards-pagination");
  await expect(pagination).toBeVisible();
  await expect(pagination.getByText("第 1 / 2 页")).toBeVisible();
  await expect(pagination.getByRole("button", { name: "上一页" })).toBeDisabled();
  await pagination.getByRole("button", { name: "下一页" }).click();
  await expect(page.locator(".bank-card").filter({ hasText: "Second Page" })).toBeVisible();
  await expect(page.locator(".bank-card").filter({ hasText: "First Page" })).toHaveCount(0);
  await expect(pagination.getByText("第 2 / 2 页")).toBeVisible();
  await pagination.getByRole("button", { name: "上一页" }).click();
  await expect(page.locator(".bank-card").filter({ hasText: "First Page" })).toBeVisible();
});

test("card catalog shows every explicit BIN without inferring from product codes", async ({ page }) => {
  await mockAuthenticatedShell(page, "user");
  const createdAt = "2026-08-10T08:00:00Z";
  const product = {
    issuer: "E2E Bank", network: "VISA", issuingArea: "US", cardType: "Virtual",
    openFee: "1.0000", openQuoteVersion: "a".repeat(64), rechargeRate: "0.010000",
    minAmount: "10.0000", maxAmount: "100.0000", description: null, category: null,
    restrictedMerchants: [], googleChatgptBlocked: false,
  };
  await page.route("**/api/products", (route) => route.fulfill({ json: { code: 0, data: [
    { ...product, productCode: "EXPLICIT_BIN", displayBin: "537872", displayBins: ["537872"] },
    { ...product, productCode: "MULTI_BIN", displayBin: null, displayBins: ["525962", "555671", "544015"] },
    { ...product, productCode: "5378720001", network: "MASTERCARD", displayBin: null, displayBins: [] },
  ] } }));
  const cards = [
    { id: 81, cardNumberMasked: "•••• •••• •••• 0081", productCode: "EXPLICIT_BIN", network: "VISA", issuingArea: "US", status: "ACTIVE", balance: "10.0000", firstName: "Visa", lastName: "Card", createdAt },
    { id: 82, cardNumberMasked: "•••• •••• •••• 0082", productCode: "5378720001", network: "MASTERCARD", issuingArea: "US", status: "ACTIVE", balance: "10.0000", firstName: "Mastercard", lastName: "Card", createdAt },
  ];
  await page.route("**/api/cards", (route) => route.fulfill({ json: { code: 0, data: { total: 2, list: cards } } }));
  const plusSuccess = { type: "openai_direct", plan: "plus", priceMajor: "982.14", currency: "PHP", estimatedUsd: "15.99906060", completedAt: createdAt };
  const proSuccess = { type: "openai_direct", plan: "pro_5x", priceMajor: "150.00", currency: "USD", estimatedUsd: null, completedAt: "2026-08-10T09:00:00Z" };
  const plans = [
    { plan: "go", attempts: 0, successes: 0, declines: 0, successRateBps: null, declineRateBps: null, latestSuccess: null },
    { plan: "plus", attempts: 2, successes: 1, declines: 1, successRateBps: 5000, declineRateBps: 5000, latestSuccess: plusSuccess },
    { plan: "pro_5x", attempts: 4, successes: 3, declines: 1, successRateBps: 7500, declineRateBps: 2500, latestSuccess: proSuccess },
    { plan: "pro_20x", attempts: 1, successes: 0, declines: 1, successRateBps: 0, declineRateBps: 10000, latestSuccess: null },
  ];
  const overall = { attempts: 7, successes: 4, declines: 3, successRateBps: 5714, declineRateBps: 4286 };
  await page.route("**/api/gpt-direct/card-successes", (route) => route.fulfill({ json: { code: 0, data: { list: [{ cardId: 82, overall, plans }] } } }));
  await page.route("**/api/openai-prices", (route) => route.fulfill({ json: { code: 0, data: {
    references: [{ bin6: "537872", ...plusSuccess }],
    binStats: [{ bin6: "537872", overall, plans }],
  } } }));
  await page.route(/\/api\/cards\/(?:81|82)$/, (route) => {
    const card = cards.find(({ id }) => route.request().url().endsWith(`/${id}`))!;
    return route.fulfill({ json: { code: 0, data: {
      ...card, issuer: "E2E Bank", availableAmount: card.balance, note: "", expiry: "12/29",
      minAmount: "10.0000", maxAmount: "100.0000", rechargeRate: "0.010000", refundRate: "0.020000",
    } } });
  });
  await page.route(/\/api\/cards\/(?:81|82)\/ledger$/, (route) => route.fulfill({ json: {
    code: 0, data: { transactions: [], activities: [] },
  } }));
  await page.route("**/api/cards/transactions?**", (route) => route.fulfill({ json: { code: 0, data: {
    total: 0, list: [], activityTotal: 0, activities: [],
  } } }));

  await page.goto("/cards");
  await expect(page.getByTestId("product-EXPLICIT_BIN")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("product-EXPLICIT_BIN").locator('.card-network-logo[alt="Visa"]'))
    .toHaveAttribute("src", "/card-brands/visa-brand-mark-white-2025.svg");
  await expect(page.getByTestId("product-5378720001").locator('.card-network-logo[alt="Mastercard"]'))
    .toHaveAttribute("src", "/card-brands/mastercard-symbol.png");
  await expect(page.getByTestId("product-EXPLICIT_BIN").getByTestId("product-openai-success")).toContainText("Plus");
  await expect(page.getByTestId("product-EXPLICIT_BIN").getByTestId("product-openai-success")).toContainText("PHP 982.14");
  await expect(page.getByTestId("product-EXPLICIT_BIN").getByTestId("product-openai-success")).toContainText("拒付率 50% · 1/2");
  await expect(page.getByTestId("product-5378720001").getByTestId("product-openai-success")).toHaveCount(0);
  await expect(page.locator(".owned-cards")).toHaveCount(0);
  await page.locator(".cards-page > header").getByRole("link", { name: "已开卡片", exact: true }).click();
  await expect(page).toHaveURL(/\/cards\/owned$/);
  await expect(page.locator(".product-grid")).toHaveCount(0);
  await expect(page.locator(".bank-card").filter({ hasText: "Visa Card" }).locator('.card-network-logo[alt="Visa"]')).toBeVisible();
  const mastercard = page.locator(".bank-card").filter({ hasText: "Mastercard Card" });
  await expect(mastercard.locator('.card-network-logo[alt="Mastercard"]')).toBeVisible();
  await expect(mastercard).toContainText("成功率 57.14% · 拒付率 42.86% · 7 笔");
  await expect(mastercard).not.toContainText("Pro 5x");
  await expect(mastercard.locator("[data-plan]")).toHaveCount(0);
  await expect(page.locator(".bank-card").filter({ hasText: "Visa Card" })).not.toContainText("支付总体表现");
  await expect(page.locator(".bank-card").filter({ hasText: "Visa Card" })).not.toContainText("成功率");
  await page.locator(".cards-page > header").getByRole("link", { name: "开卡中心", exact: true }).click();
  await expect(page).toHaveURL(/\/cards$/);
  await expect(page.getByTestId("product-EXPLICIT_BIN").locator(".product-card-art b"))
    .toHaveText("537872 •••• •••• ••••", { timeout: 10_000 });
  await expect(page.getByTestId("product-5378720001").locator(".product-card-art b"))
    .toHaveText("卡头待卡服务返回");
  await expect(page.getByTestId("product-MULTI_BIN").locator(".product-card-art b"))
    .toHaveText("525962 / 555671 / 544015");

  await page.getByTestId("product-EXPLICIT_BIN").getByRole("link", { name: "了解并开卡", exact: true }).click();
  const openVisa = page.locator('.open-card-art .card-network-logo[alt="Visa"]');
  await expect(openVisa).toHaveAttribute("src", "/card-brands/visa-brand-mark-white-2025.svg");
  expect(await openVisa.evaluate((logo) => [logo.clientWidth, logo.clientHeight])).toEqual([52, 30]);
  await expect(page.locator(".open-card-art > div:last-child span").first())
    .toHaveText("537872 •••• •••• ••••");
  await expect(page.getByTestId("product-openai-success")).toContainText("Plus");
  await expect(page.getByTestId("product-openai-success")).toContainText("Pro 5x");
  await page.goto("/cards/open/5378720001");
  const openMastercard = page.locator('.open-card-art .card-network-logo[alt="Mastercard"]');
  await expect(openMastercard).toHaveAttribute("src", "/card-brands/mastercard-symbol.png");
  expect(await openMastercard.evaluate((logo) => [logo.clientWidth, logo.clientHeight])).toEqual([52, 30]);
  await expect(page.locator(".open-card-art > div:last-child span").first())
    .toHaveText("卡头待卡服务返回");
  await page.goto("/cards/open/MULTI_BIN");
  await expect(page.locator(".open-card-art > div:last-child span").first())
    .toHaveText("525962 / 555671 / 544015");

  await page.goto("/cards/81");
  await expect(page.locator('.card-detail-visual .card-network-logo[alt="Visa"]'))
    .toHaveAttribute("src", "/card-brands/visa-brand-mark-white-2025.svg");
  await page.goto("/cards/82");
  const detailMastercard = page.locator('.card-detail-visual .card-network-logo[alt="Mastercard"]');
  await expect(detailMastercard).toHaveAttribute("src", "/card-brands/mastercard-symbol.png");
  expect(await detailMastercard.evaluate((logo) => [logo.clientWidth, logo.clientHeight])).toEqual([52, 30]);
  await expect(page.getByTestId("card-payment-performance")).toContainText("Pro 5x");
  await expect(page.getByTestId("card-payment-performance")).toContainText("Plus");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("card category filters show only matching products", async ({ page }) => {
  await page.route("**/api/products", async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    const product = payload.data[0];
    payload.data = [
      { ...product, productCode: "E2E_AI_GOOGLE", category: "AI / Google" },
      { ...product, productCode: "E2E_ADVERTISING", category: "Advertising" },
    ];
    await route.fulfill({ response, json: payload });
  });
  await page.goto("/cards");
  const productCards = page.locator(".product-card");
  await expect(productCards.nth(1)).toBeVisible();
  const productCount = await productCards.count();
  await page.getByRole("button", { name: "AI", exact: true }).click();
  await expect(page.getByTestId("product-E2E_AI_GOOGLE")).toBeVisible();
  await expect(page.getByTestId("product-E2E_ADVERTISING")).toHaveCount(0);
  await page.getByRole("button", { name: "Google", exact: true }).click();
  await expect(page.getByTestId("product-E2E_AI_GOOGLE")).toBeVisible();
  await page.getByRole("button", { name: "全部", exact: true }).click();
  await expect(productCards).toHaveCount(productCount);
});

test("transfer identifies invite-code recipients and requires a second-factor code", async ({ page }) => {
  await page.goto("/finance");
  await page.route("**/api/wallet/transfer/challenge", (route) => route.fulfill({ json: { code: 0, data: {
    challengeId: "11111111-1111-4111-8111-111111111111", deliveryChannel: "telegram", destination: "已绑定的 Telegram",
    expiresIn: 600, idempotencyKey: "22222222-2222-4222-8222-222222222222",
  } } }));
  await page.getByRole("button", { name: "余额转账", exact: true }).click();
  await expect(page.getByText("这里填写收款人的邀请码，不是邮箱或用户编号。")).toBeVisible();
  await page.getByPlaceholder("填写对方的邀请码").fill("ABC-12");
  await page.getByPlaceholder("10.00").fill("10.00");
  await page.getByRole("button", { name: "发送验证码", exact: true }).click();
  await expect(page.getByText("验证码已发送到 已绑定的 Telegram。")).toBeVisible();
  await expect(page.getByLabel("6 位转账验证码")).toBeVisible();
  await expect(page.getByRole("button", { name: "确认转账", exact: true })).toBeVisible();
});

test("open card charges once and lists the card", async ({ page }) => {
  const availableProduct = await firstAvailableProduct(page);
  const expectedNetwork = availableProduct.network.toUpperCase();
  const initialAmount = decimalUnits(availableProduct.minAmount, 4);
  const initialRechargeFee = ceilRate4(initialAmount, availableProduct.rechargeRate);
  const openCost = initialAmount + decimalUnits(availableProduct.openFee, 4) + initialRechargeFee;
  const beforeOpen = await moneySnapshot(page, "open_card");
  await page.goto("/cards");
  const product = page.getByTestId(`product-${availableProduct.productCode}`);
  if (expectedNetwork === "VISA" || expectedNetwork === "MASTERCARD") {
    const brandName = expectedNetwork === "VISA" ? "Visa" : "Mastercard";
    await expect(product.locator(`.product-card-art .card-network-logo[alt="${brandName}"]`)).toBeVisible();
  } else {
    await expect(product.locator(".product-card-art .card-network-mark")).toHaveText(expectedNetwork);
  }
  await product.getByRole("link", { name: "了解并开卡", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/cards/open/${availableProduct.productCode}$`));
  if (expectedNetwork === "VISA" || expectedNetwork === "MASTERCARD") {
    const brandName = expectedNetwork === "VISA" ? "Visa" : "Mastercard";
    await expect(page.locator(`.open-card-art .card-network-logo[alt="${brandName}"]`)).toBeVisible();
  } else {
    await expect(page.locator(".open-card-art .card-network-mark")).toHaveText(expectedNetwork);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expect(page.getByTestId("open-card-form")).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 800 });
  const nextHint = page.locator(".open-card-next");
  const [hintIcon, hintText] = await Promise.all([
    nextHint.locator("svg").boundingBox(),
    nextHint.locator("span").boundingBox(),
  ]);
  expect(hintIcon).not.toBeNull();
  expect(hintText).not.toBeNull();
  expect(Math.abs(hintIcon!.y - hintText!.y)).toBeLessThanOrEqual(1);
  expect(hintIcon!.height).toBe(14);
  await page.getByPlaceholder("Ada").fill("Ada");
  await page.getByPlaceholder("Lovelace").fill("Lovelace");
  const amount = page.getByLabel("初始金额", { exact: true });
  await expect(amount).toHaveAttribute("min", availableProduct.minAmount);
  await expect(amount).toHaveAttribute("max", availableProduct.maxAmount);
  await expect(page.getByTestId("open-summary-fee")).toHaveText(`$${availableProduct.openFee}`);
  await expect(page.getByTestId("open-summary-amount")).toHaveText(`$${availableProduct.minAmount}`);
  await expect(page.getByTestId("open-summary-recharge-fee")).toHaveText(`$${fixed4(initialRechargeFee)}`);
  await expect(page.getByTestId("open-summary-total")).toHaveText(`$${fixed4(openCost)}`);
  await amount.fill("");
  await expect(page.getByTestId("open-summary-amount")).toHaveText("$—");
  await expect(page.getByTestId("open-summary-total")).toHaveText("$—");
  await amount.fill(availableProduct.minAmount);
  const openResponsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST" && new URL(response.url()).pathname === "/api/cards/open");
  await page.getByRole("button", { name: "确认开卡", exact: true }).click();
  const openResponse = await openResponsePromise;
  expect(openResponse.status()).toBe(200);
  const openPayload = await openResponse.json();
  const openRequest = openResponse.request();
  const openKey = openRequest.headers()["idempotency-key"];
  const openBody = openRequest.postDataJSON();
  expect(openBody).toMatchObject({
    expectedOpenFee: availableProduct.openFee,
    expectedInitialRechargeFee: fixed4(initialRechargeFee),
    openQuoteVersion: availableProduct.openQuoteVersion,
  });
  await expect(page).toHaveURL(/\/cards\/\d+$/);
  if (expectedNetwork === "VISA" || expectedNetwork === "MASTERCARD") {
    const brandName = expectedNetwork === "VISA" ? "Visa" : "Mastercard";
    await expect(page.locator(`.card-detail-visual .card-network-logo[alt="${brandName}"]`)).toBeVisible();
  } else {
    await expect(page.locator(".card-detail-visual .card-network-mark")).toHaveText(expectedNetwork);
  }
  await expect(page.locator(".card-holder-summary")).toContainText("Ada Lovelace");
  const afterOpen = await moneySnapshot(page, "open_card");
  expect(beforeOpen.balance - afterOpen.balance).toBe(openCost);
  const newOpenEntries = afterOpen.entries.filter((entry) => !beforeOpen.entries.some(({ id }) => id === entry.id));
  expect(newOpenEntries).toHaveLength(1);
  expect(decimalUnits(newOpenEntries[0].amount, 4)).toBe(-openCost);
  const replay = await page.request.post("/api/cards/open", {
    headers: { "idempotency-key": openKey },
    data: openBody,
  });
  expect(replay.status()).toBe(200);
  const replayPayload = await replay.json();
  expect(replayPayload.data).toMatchObject({ operationId: openPayload.data.operationId, replayed: true });
  const afterReplay = await moneySnapshot(page, "open_card");
  expect(afterReplay.balance).toBe(afterOpen.balance);
  expect(afterReplay.entries).toHaveLength(afterOpen.entries.length);
  const persistedOperation = await page.request.get(`/api/admin/money-operations?type=OPEN_CARD&q=${openPayload.data.operationId}`);
  expect(persistedOperation.status()).toBe(200);
  expect((await persistedOperation.json()).data).toMatchObject({ total: 1, list: [{ id: openPayload.data.operationId }] });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expect(page.locator(".card-holder-summary")).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 800 });
  const [cardVisual, securityPanel] = await Promise.all([
    page.locator(".card-detail-visual").boundingBox(),
    page.locator(".card-security-panel").boundingBox(),
  ]);
  expect(securityPanel!.x - cardVisual!.x - cardVisual!.width).toBeGreaterThanOrEqual(15);
  await page.reload();
  await expect(page.locator(".card-holder-summary")).toContainText("Ada Lovelace");
  const localDetailResponse = await page.request.get(`/api${new URL(page.url()).pathname}`);
  expect(localDetailResponse.status()).toBe(200);
  const localDetail = await localDetailResponse.json();
  expect(localDetail.data.expiry).toBe("12/29");
  expect(localDetail.data).toMatchObject({ minAmount: availableProduct.minAmount, maxAmount: availableProduct.maxAmount });
  expect(localDetail.data).not.toHaveProperty("cvv");
  expect(localDetail.data).not.toHaveProperty("cardNumber");
  const invalidRecharge = await page.request.post(`/api/cards/${localDetail.data.id}/actions`, {
    headers: { "idempotency-key": `invalid-range-${Date.now()}` },
    data: { action: "recharge", amount: (Number(availableProduct.minAmount) / 2).toFixed(4), expectedFee: "0.0000" },
  });
  expect(invalidRecharge.status()).toBe(400);
  expect((await invalidRecharge.json()).error).toBe("充值金额超出产品允许范围");
  const operations = page.locator(".card-operations-panel");
  await expect(operations).toContainText(`$${availableProduct.minAmount}–$${availableProduct.maxAmount}`);
  await operations.getByRole("button", { name: "充值", exact: true }).click();
  const rechargeDialog = page.getByRole("dialog", { name: "为卡片充值", exact: true });
  const rechargeAmount = rechargeDialog.getByRole("spinbutton");
  await expect(rechargeAmount).toHaveAttribute("min", availableProduct.minAmount);
  await expect(rechargeAmount).toHaveAttribute("max", availableProduct.maxAmount);
  await rechargeAmount.fill((Number(availableProduct.minAmount) / 2).toFixed(4));
  expect(await rechargeAmount.evaluate((element: HTMLInputElement) => element.checkValidity())).toBe(false);
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await operations.getByRole("button", { name: "冻结", exact: true }).click();
  await expect(operations.getByRole("button", { name: "解冻", exact: true })).toBeVisible();
  await operations.getByRole("button", { name: "解冻", exact: true }).click();
  await expect(operations.getByRole("button", { name: "冻结", exact: true })).toBeVisible();
  await expect(operations.getByRole("button", { name: "销卡", exact: true })).toHaveCount(0);
  const sensitivePath = `/api${new URL(page.url()).pathname}/sensitive`;
  const sensitiveResponse = await page.request.get(`${new URL(page.url()).origin}${sensitivePath}`);
  expect(sensitiveResponse.headers()["cache-control"]).toContain("no-store");
  expect((await page.request.get("/api/cards/999999/sensitive")).status()).toBe(404);
  let sensitiveGets = 0;
  page.on("request", (request) => {
    if (request.method() === "GET" && new URL(request.url()).pathname === sensitivePath) sensitiveGets += 1;
  });
  await expect(page.getByTestId("card-number")).not.toHaveText(/^\d{16}$/);
  await page.getByRole("button", { name: "显示完整信息", exact: true }).click();
  await expect(page.getByTestId("card-number")).toHaveText(/^\d{16}$/);
  await expect.poll(() => sensitiveGets).toBe(1);
  const backgroundPage = await page.context().newPage();
  await backgroundPage.goto("about:blank");
  await page.bringToFront();
  await page.context().setOffline(true);
  await page.context().setOffline(false);
  await page.waitForTimeout(500);
  expect(sensitiveGets).toBe(1);
  await backgroundPage.close();
  await page.getByRole("button", { name: "隐藏完整信息", exact: true }).click();
  await expect(page.getByTestId("card-number")).not.toHaveText(/^\d{16}$/);

  await page.getByTestId("app-sidebar").getByRole("link", { name: "已开卡片", exact: true }).click();
  const card = page.locator(".bank-card").filter({ hasText: "Ada Lovelace" });
  await expect(card).toBeVisible();
  if (expectedNetwork === "VISA" || expectedNetwork === "MASTERCARD") {
    const brandName = expectedNetwork === "VISA" ? "Visa" : "Mastercard";
    await expect(card.locator(`.card-network-logo[alt="${brandName}"]`)).toBeVisible();
  } else {
    await expect(card.locator(".card-network-mark")).toHaveText(expectedNetwork);
  }
  await expect(card.getByText(`$${fixed4(initialAmount)}`, { exact: true })).toBeVisible();
  await card.getByRole("button", { name: "充值", exact: true }).click();
  await page.getByRole("dialog").getByRole("spinbutton").fill("10");
  await page.getByRole("button", { name: "确认操作", exact: true }).click();
  await expect(card.getByText(`$${fixed4(initialAmount + 100_000n)}`, { exact: true })).toBeVisible();
  await card.getByRole("button", { name: "退款", exact: true }).click();
  await page.getByRole("dialog").getByRole("spinbutton").fill("10");
  await page.getByRole("button", { name: "确认操作", exact: true }).click();
  await expect(card.getByText(`$${fixed4(initialAmount)}`, { exact: true })).toBeVisible();
  await card.getByRole("button", { name: "冻结", exact: true }).click();
  await expect(card.getByRole("button", { name: "解冻", exact: true })).toBeVisible();
});

test("real GPT direct flow persists one order and applies its configured service fee once", async ({ page }) => {
  const cardsResponse = await page.request.get("/api/cards");
  expect(cardsResponse.status()).toBe(200);
  let activeCard = (await cardsResponse.json()).data.list.find((card: { status: string }) => card.status === "ACTIVE");
  if (!activeCard) {
    const product = await firstAvailableProduct(page);
    const initialRechargeFee = ceilRate4(decimalUnits(product.minAmount, 4), product.rechargeRate);
    const opened = await page.request.post("/api/cards/open", {
      headers: { "idempotency-key": `gpt-e2e-card-${Date.now()}` },
      data: {
        productCode: product.productCode,
        firstName: "Grace",
        lastName: "Hopper",
        initAmount: product.minAmount,
        expectedOpenFee: product.openFee,
        expectedInitialRechargeFee: fixed4(initialRechargeFee),
        openQuoteVersion: product.openQuoteVersion,
        count: 1,
      },
    });
    expect(opened.status()).toBe(200);
    const refreshed = await page.request.get("/api/cards");
    activeCard = (await refreshed.json()).data.list.find((card: { status: string }) => card.status === "ACTIVE");
  }
  expect(activeCard).toBeTruthy();

  const plansResponse = await page.request.get("/api/gpt-direct/plans");
  expect(plansResponse.status()).toBe(200);
  const plus = (await plansResponse.json()).data.plans.find((plan: { key: string }) => plan.key === "plus");
  expect(plus).toBeTruthy();
  const serviceFee = decimalUnits(plus.customerServiceFee, 4);

  await page.goto("/gpt-direct");
  await expect(page.getByRole("heading", { name: "GPT 订阅与额度直充", exact: true })).toBeVisible();
  await page.getByLabel("Session 凭据", { exact: true }).fill('{"sessionToken":"playwright-complete-session"}');
  await page.getByRole("button", { name: "验证凭据与获取报价", exact: true }).click();
  await expect(page.getByText("m***@example.com", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "提交开通", exact: true })).toBeEnabled();

  const beforeOrder = await moneySnapshot(page, "gpt_direct_fee");
  const orderResponsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST" && new URL(response.url()).pathname === "/api/gpt-direct/orders");
  await page.getByRole("button", { name: "提交开通", exact: true }).click();
  const orderResponse = await orderResponsePromise;
  expect(orderResponse.status()).toBe(202);
  const orderPayload = await orderResponse.json();
  const orderRequest = orderResponse.request();
  const orderKey = orderRequest.headers()["idempotency-key"];
  const orderBody = orderRequest.postDataJSON();
  await expect(page.getByRole("status")).toContainText("订单已受理，正在安全处理。");

  const afterOrder = await moneySnapshot(page, "gpt_direct_fee");
  expect(beforeOrder.balance - afterOrder.balance).toBe(serviceFee);
  const newFees = afterOrder.entries.filter((entry) => !beforeOrder.entries.some(({ id }) => id === entry.id));
  expect(newFees).toHaveLength(serviceFee === 0n ? 0 : 1);
  if (serviceFee !== 0n) expect(decimalUnits(newFees[0].amount, 4)).toBe(-serviceFee);

  const replay = await page.request.post("/api/gpt-direct/orders", {
    headers: { "idempotency-key": orderKey },
    data: orderBody,
  });
  expect(replay.status()).toBe(202);
  expect((await replay.json()).data.id).toBe(orderPayload.data.id);
  const afterReplay = await moneySnapshot(page, "gpt_direct_fee");
  expect(afterReplay.balance).toBe(afterOrder.balance);
  expect(afterReplay.entries).toHaveLength(afterOrder.entries.length);

  const persistedOperation = await page.request.get(`/api/admin/money-operations?type=GPT_DIRECT&q=${orderPayload.data.id}`);
  expect(persistedOperation.status()).toBe(200);
  expect((await persistedOperation.json()).data).toMatchObject({ total: 1, list: [{ id: orderPayload.data.id }] });
  await page.reload();
  const persistedOrders = await page.request.get("/api/gpt-direct/orders?page_size=100");
  expect(persistedOrders.status()).toBe(200);
  expect((await persistedOrders.json()).data.list.some((order: { id: string }) => order.id === orderPayload.data.id)).toBe(true);
});

test("real logged-in CDK batch generate keeps codes recoverable without debiting the wallet", async ({ page }) => {
  await page.goto("/gpt-direct");
  await openGptDirectTool(page, "生成待售 CDK");
  await expect(page.getByRole("heading", { name: "生成待售 CDK", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "购买自动开通 CDK", exact: true })).toHaveCount(0);
  const offer = page.getByTestId("gpt-cdk-generate").locator("article").filter({ hasText: "Plus" });
  await offer.getByRole("spinbutton", { name: "数量" }).fill("2");
  const beforeGenerate = await moneySnapshot(page, "gpt_cdk_purchase");
  const generateResponsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST" && new URL(response.url()).pathname === "/api/gpt-direct/cdks/generate");
  await offer.getByRole("button", { name: "生成 2 个", exact: true }).click();
  const generateResponse = await generateResponsePromise;
  expect(generateResponse.status()).toBe(200);
  const generatePayload = await generateResponse.json();
  const generateRequest = generateResponse.request();
  const generateKey = generateRequest.headers()["idempotency-key"];
  const generateBody = generateRequest.postDataJSON();
  expect(generateBody).toMatchObject({ plan: "plus", quantity: 2 });
  expect(generatePayload.data).toMatchObject({ quantity: 2, totalSalePrice: "0", generated: true });
  expect(generatePayload.data.items).toHaveLength(2);
  await expect(page.locator(".gpt-cdk-purchase-result")).toBeVisible();
  await expect(page.locator(".gpt-cdk-purchase-result code")).toHaveCount(2);

  const afterGenerate = await moneySnapshot(page, "gpt_cdk_purchase");
  expect(afterGenerate.balance).toBe(beforeGenerate.balance);
  expect(afterGenerate.entries).toHaveLength(beforeGenerate.entries.length);

  const replay = await page.request.post("/api/gpt-direct/cdks/generate", {
    headers: { "idempotency-key": generateKey },
    data: generateBody,
  });
  expect(replay.status()).toBe(200);
  const replayPayload = await replay.json();
  expect(replayPayload.data).toMatchObject({ saleId: generatePayload.data.saleId, replayed: true });
  expect(typeof replayPayload.data.code === "string" && replayPayload.data.code.length > 0,
    "CDK recovery window did not return plaintext").toBe(true);
  const afterReplay = await moneySnapshot(page, "gpt_cdk_purchase");
  expect(afterReplay.balance).toBe(afterGenerate.balance);
  expect(afterReplay.entries).toHaveLength(afterGenerate.entries.length);

  const saleId = String(generatePayload.data.saleId);
  expect(saleId).toMatch(/^[0-9a-f-]{36}$/);
  expect(process.env.E2E_DATABASE_URL).toBeTruthy();
  execFileSync("psql", [process.env.E2E_DATABASE_URL!, "-v", "ON_ERROR_STOP=1", "-c",
    `UPDATE gpt_cdk_sales SET created_at=now()-interval '3 minutes' WHERE operation_id=(SELECT operation_id FROM gpt_cdk_sales WHERE id='${saleId}'::uuid)`],
  { stdio: "ignore" });
  const expiredReplay = await page.request.post("/api/gpt-direct/cdks/generate", {
    headers: { "idempotency-key": generateKey },
    data: generateBody,
  });
  expect(expiredReplay.status()).toBe(200);
  const expiredPayload = await expiredReplay.json();
  expect(expiredPayload.data).toMatchObject({ saleId, replayed: true });
  expect(typeof expiredPayload.data.code === "string" && expiredPayload.data.code.length > 0,
    "expired CDK recovery returned plaintext").toBe(false);
  const afterExpiredReplay = await moneySnapshot(page, "gpt_cdk_purchase");
  expect(afterExpiredReplay.balance).toBe(afterGenerate.balance);
  expect(afterExpiredReplay.entries).toHaveLength(afterGenerate.entries.length);

  const sensitive = await page.request.post(`/api/gpt-direct/cdks/${generatePayload.data.cdkId}/sensitive`);
  expect(sensitive.status()).toBe(200);
  expect((await sensitive.json()).data.code).toBe(generatePayload.data.code);

  const owned = await page.request.get("/api/gpt-direct/cdks");
  expect(owned.status()).toBe(200);
  const ownedCdks = (await owned.json()).data.list.filter((item: { id: string }) =>
    generatePayload.data.items.some((generated: { cdkId: string }) => generated.cdkId === item.id));
  expect(ownedCdks).toHaveLength(2);
  expect(ownedCdks.every((item: { codePrefix: string; inventoryStatus: string }) => item.codePrefix === "AVF-********" && item.inventoryStatus === "SOLD")).toBe(true);
  await page.reload();
  await expect(page.locator(".gpt-cdk-purchase-result")).toHaveCount(0);
});

test("pending card writes keep forms open and reuse the intent idempotency key", async ({ page }) => {
  const openKeys: string[] = [];
  const actionKeys: string[] = [];
  await page.route("**/api/products", (route) => route.fulfill({ json: { code: 0, data: [{
    productCode: "E2E_PENDING", issuer: "E2E Bank", network: "VISA", issuingArea: "US",
    cardType: "Virtual", openFee: "1.0000", openQuoteVersion: "a".repeat(64), rechargeRate: "0.010000",
    minAmount: "10.0000", maxAmount: "100.0000",
  }] } }));
  await page.route("**/api/cards", (route) => route.fulfill({ json: { code: 0, data: {
    total: 1, list: [{ id: 99001, vmCardId: "pending-card", cardNumberMasked: "•••• •••• •••• 4242",
      productCode: "E2E_PENDING", network: "VISA", issuingArea: "US", status: "ACTIVE",
      balance: "10.0000", firstName: "Pending", lastName: "Test", createdAt: new Date().toISOString() }],
  } } }));
  await page.route("**/api/cards/open", (route) => {
    openKeys.push(route.request().headers()["idempotency-key"]);
    return route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ error: "pending" }) });
  });
  await page.route("**/api/cards/99001/actions", (route) => {
    actionKeys.push(route.request().headers()["idempotency-key"]);
    return route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ error: "pending" }) });
  });
  await page.route("**/api/cards/99001/recharge-quote", (route) => {
    const amount = String(route.request().postDataJSON().amount);
    return route.fulfill({ json: { code: 0, data: { amount: `${amount}.0000`, fee: "0.0000", totalDebit: `${amount}.0000`, effectiveRechargeRate: "0.000000" } } });
  });

  await page.goto("/cards");
  await page.getByTestId("product-E2E_PENDING").getByRole("link", { name: "了解并开卡", exact: true }).click();
  const openForm = page.getByTestId("open-card-form");
  await openForm.getByPlaceholder("Ada").fill("Ada");
  await openForm.getByPlaceholder("Lovelace").fill("Lovelace");
  const openAmount = openForm.getByLabel("初始金额", { exact: true });
  await openAmount.fill("9");
  expect(await openAmount.evaluate((element: HTMLInputElement) => element.validity.rangeUnderflow)).toBe(true);
  await openForm.getByRole("button", { name: "确认开卡", exact: true }).click();
  expect(openKeys).toHaveLength(0);
  await openAmount.fill("10");
  const confirmOpen = openForm.getByRole("button", { name: "确认开卡", exact: true });
  await confirmOpen.click();
  await expect(openForm.getByRole("alert")).toHaveText("操作结果待核验，请勿关闭页面或使用新请求重复提交。");
  await confirmOpen.click();
  await expect.poll(() => openKeys.length).toBe(2);
  expect(openKeys[1]).toBe(openKeys[0]);
  await openAmount.fill("11");
  await confirmOpen.click();
  await expect.poll(() => openKeys.length).toBe(3);
  expect(openKeys[2]).not.toBe(openKeys[0]);

  await page.getByRole("link", { name: "返回卡片列表", exact: true }).click();
  const card = page.locator(".bank-card").filter({ hasText: "Pending Test" });
  await card.getByRole("button", { name: "充值", exact: true }).click();
  const actionDialog = page.getByRole("dialog");
  const actionAmount = actionDialog.getByPlaceholder("10.00");
  await actionAmount.fill("10");
  const confirmAction = actionDialog.getByRole("button", { name: "确认操作", exact: true });
  await confirmAction.click();
  await expect(actionDialog.getByRole("alert")).toHaveText("操作结果待核验，请勿关闭页面或使用新请求重复提交。");
  await confirmAction.click();
  await expect.poll(() => actionKeys.length).toBe(2);
  expect(actionKeys[1]).toBe(actionKeys[0]);
  await actionAmount.fill("11");
  await confirmAction.click();
  await expect.poll(() => actionKeys.length).toBe(3);
  expect(actionKeys[2]).not.toBe(actionKeys[0]);
});

test("pending card closure polls the owned operation without resubmitting", async ({ page }) => {
  await mockAuthenticatedShell(page, "user");
  const operationId = "00000000-0000-0000-0000-000000009902";
  let actionCalls = 0;
  let operationCalls = 0;
  let closed = false;
  const card = {
    id: 99002, cardNumberMasked: "•••• •••• •••• 9902", productCode: "E2E_DELETE",
    network: "VISA", issuingArea: "US", status: "ACTIVE", balance: "10.0000",
    firstName: "Pending", lastName: "Closure", pendingOperationId: null,
    pendingOperationType: null, createdAt: new Date().toISOString(),
  };
  await page.route("**/api/products", (route) => route.fulfill({ json: { code: 0, data: [] } }));
  await page.route("**/api/cards", (route) => route.fulfill({ json: { code: 0, data: { total: 1, list: [{
    ...card, status: closed ? "DELETED" : "ACTIVE", balance: closed ? "0.0000" : "10.0000",
  }] } } }));
  await page.route("**/api/cards/transactions?**", (route) => route.fulfill({ json: { code: 0, data: { total: 0, list: [] } } }));
  await page.route("**/api/cards/99002/sensitive", (route) => route.fulfill({ json: { code: 0, data: {
    cardNumber: "4111111111119902", cvv: "902", expire: "12/29", cardAddress: null,
  } } }));
  await page.route("**/api/cards/99002", (route) => route.fulfill({ json: { code: 0, data: {
    ...card, status: closed ? "DELETED" : "ACTIVE", issuer: "E2E Bank",
    availableAmount: closed ? "0.0000" : "10.0000", note: "", minAmount: "10.0000",
    maxAmount: "100.0000", rechargeRate: "0.010000", refundRate: "0.125000", expiry: "12/29",
  } } }));
  await page.route("**/api/cards/99002/actions", (route) => {
    actionCalls += 1;
    return route.fulfill({ status: 202, json: {
      error: "pending", operationId, status: "PENDING",
    } });
  });
  await page.route(`**/api/operations/${operationId}`, (route) => {
    operationCalls += 1;
    const succeeded = operationCalls >= 3;
    if (succeeded) closed = true;
    return route.fulfill({ json: { code: 0, data: {
      operationId, type: "DELETE", status: succeeded ? "SUCCEEDED" : operationCalls === 2 ? "RECONCILE_REQUIRED" : "PENDING",
      terminal: succeeded, dispatchState: succeeded ? "CONFIRMED" : "UNKNOWN",
      result: succeeded ? { status: "DELETED" } : null,
      error: operationCalls === 2 ? "waiting for refund evidence" : null,
      updatedAt: new Date().toISOString(),
    } } });
  });

  await page.goto("/cards/99002");
  const operations = page.locator(".card-operations-panel");
  await page.getByRole("button", { name: "显示完整信息", exact: true }).click();
  await expect(page.getByTestId("card-number")).toHaveText("4111111111119902");
  await operations.getByRole("button", { name: "销卡", exact: true }).click();
  await page.getByRole("button", { name: "确认销卡", exact: true }).click();
  await expect(page.getByTestId("card-number")).toHaveText(card.cardNumberMasked);
  await expect(operations.getByRole("status").filter({ hasText: "操作结果待核验" })).toBeVisible();
  await expect(page).toHaveURL(/\/cards\/owned$/, { timeout: 15_000 });
  expect(actionCalls).toBe(1);
  expect(operationCalls).toBeGreaterThanOrEqual(3);
  const archivedCard = page.locator(".bank-card");
  await expect(archivedCard.getByText("已销卡", { exact: true })).toBeVisible();
  await expect(archivedCard.getByRole("button", { name: "充值", exact: true })).toHaveCount(0);
  await expect(archivedCard.getByRole("button", { name: "退款", exact: true })).toHaveCount(0);
  await expect(archivedCard.getByRole("button", { name: "冻结", exact: true })).toHaveCount(0);
  await archivedCard.getByRole("link", { name: "详情", exact: true }).click();
  await expect(page.getByText("该卡已注销，仅保留本地脱敏信息和历史流水，不能再进行任何操作。", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "显示完整信息", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "刷新余额与消费", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "保存", exact: true })).toHaveCount(0);
  await expect(page.locator(".card-operations-panel").getByRole("button")).toHaveCount(0);
});

test("frozen card detail offers unfreeze but not closure", async ({ page }) => {
  await mockAuthenticatedShell(page, "user");
  await page.route("**/api/cards/99003/ledger", (route) => route.fulfill({json:{code:0,data:{transactions:[],activities:[]}}}));
  await page.route("**/api/cards/transactions?**", (route) => route.fulfill({ json: { code: 0, data: { total: 0, list: [], activities: [], activityTotal: 0 } } }));
  await page.route("**/api/cards/99003", (route) => route.fulfill({ json: { code: 0, data: {
    id: 99003, cardNumberMasked: "•••• •••• •••• 9903", status: "FROZEN", network: "VISA",
    issuingArea: "US", issuer: "E2E Bank", availableAmount: "20.0000", firstName: "Frozen", lastName: "Card",
    note: "", productCode: "E2E_FROZEN", minAmount: "10.0000", maxAmount: "100.0000",
    rechargeRate: "0.010000", refundRate: "0.125000", refundKeepMinimum: "1.0000", expiry: "12/29",
    createdAt: new Date().toISOString(), pendingOperationId: null, pendingOperationType: null,
  } } }));
  await page.goto("/cards/99003");
  const operations = page.locator(".card-operations-panel");
  await expect(operations.getByRole("button", { name: "解冻", exact: true })).toBeVisible();
  await expect(operations.getByRole("button", { name: "销卡", exact: true })).toHaveCount(0);
});

test("open card refreshes a changed quote and requires a second confirmation", async ({ page }) => {
  const bodies: Array<Record<string, unknown>> = [];
  const keys: string[] = [];
  let changed = false;
  await page.addInitScript(() => localStorage.setItem("session", JSON.stringify({ token: "", email: "quote@example.com" })));
  await page.route("**/api/dashboard", (route) => route.fulfill({ json: {
    email: "quote@example.com", role: "user", walletBalance: "100.0000", cardBalance: "0.0000",
    cardCount: 0, inviteCode: "QUOTE",
  } }));
  await page.route("**/api/announcements/unread", (route) => route.fulfill({ json: { code: 0, data: [], unreadCount: 0 } }));
  await page.route("**/api/features", (route) => route.fulfill({ json: { code: 0, data: {
    version: 1, registration: true, walletTransfer: true, cardOpening: true, cardRecharge: true, cardManagement: true, cardDelete: true,
    gptDirect: true, gptCdk: true, deposits: true, rewards: true, agent: false, market: true,
    developerApi: true, telegram: true,
  } } }));
  await page.route("**/api/products", (route) => route.fulfill({ json: { code: 0, data: [{
    productCode: "E2E_OPEN_QUOTE", issuer: "Quote Bank", network: "VISA", issuingArea: "US",
    cardType: "Virtual", openFee: changed ? "2.0000" : "1.0000",
    openQuoteVersion: (changed ? "b" : "a").repeat(64), rechargeRate: "0.010000", refundRate: "0.125000",
    minAmount: "10.0000", maxAmount: "100.0000", description: null, category: null,
  }] } }));
  await page.route("**/api/cards/open", (route) => {
    bodies.push(route.request().postDataJSON() as Record<string, unknown>);
    keys.push(route.request().headers()["idempotency-key"]);
    if (bodies.length === 1) {
      changed = true;
      return route.fulfill({ status: 409, json: { error: "price changed", errorCode: "PRICE_CHANGED" } });
    }
    return route.fulfill({ status: 202, json: { error: "pending" } });
  });

  await page.goto("/cards/open/E2E_OPEN_QUOTE");
  const form = page.getByTestId("open-card-form");
  await form.getByTestId("random-cardholder-name").click();
  const generatedFirstName = await form.getByPlaceholder("Ada").inputValue();
  const generatedLastName = await form.getByPlaceholder("Lovelace").inputValue();
  expect([
    "Avery Morgan", "Jordan Ellis", "Taylor Brooks", "Cameron Reed",
    "Riley Parker", "Morgan Hayes", "Casey Bennett", "Alex Carter",
  ]).toContain(`${generatedFirstName} ${generatedLastName}`);
  const amount = form.getByLabel("初始金额", { exact: true });
  await expect(page.getByTestId("open-summary-fee")).toHaveText("$1");
  await expect(page.getByTestId("open-summary-amount")).toHaveText("$10");
  await expect(page.getByTestId("open-summary-recharge-fee")).toHaveText("$0.1");
  await expect(form.locator(".open-card-summary")).not.toContainText("退款手续费率");
  await expect(form.locator(".open-card-summary")).not.toContainText("商户消费发生退款并确认后收取");
  await expect(page.getByTestId("open-refund-rate")).toHaveText("12.5%");
  await expect(form.locator(".product-fee-details")).toContainText("仅在商户消费发生退款并确认后收取；未发生退款不收取，卡余额退回不适用。");
  await expect(page.getByTestId("open-summary-total")).toHaveText("$11.1");
  await amount.fill("");
  await expect(page.getByTestId("open-summary-total")).toHaveText("$—");
  await amount.fill("10.0000");

  const confirm = form.getByRole("button", { name: "确认开卡", exact: true });
  await confirm.click();
  await expect(form.getByRole("alert")).toHaveText("开卡价格或范围已变化，已更新为最新报价，请确认后重新提交。");
  await expect(page.getByTestId("open-summary-fee")).toHaveText("$2");
  await expect(page.getByTestId("open-summary-total")).toHaveText("$12.1");
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toMatchObject({ firstName: generatedFirstName, lastName: generatedLastName, expectedOpenFee: "1.0000", expectedInitialRechargeFee: "0.1000", openQuoteVersion: "a".repeat(64) });

  await confirm.click();
  await expect.poll(() => bodies.length).toBe(2);
  expect(bodies[1]).toMatchObject({ firstName: generatedFirstName, lastName: generatedLastName, expectedOpenFee: "2.0000", expectedInitialRechargeFee: "0.1000", openQuoteVersion: "b".repeat(64) });
  expect(keys[1]).not.toBe(keys[0]);
});

test("card fee policy and refund minimum follow upstream snapshots", async ({ page }) => {
  await mockAuthenticatedShell(page, "user");
  const product = {
    productCode: "FEE_POLICY", issuer: "Policy Bank", network: "MASTERCARD", issuingArea: "HK",
    cardType: "save", openFee: "0.4000", openQuoteVersion: "f".repeat(64), rechargeRate: "0.000000", refundRate: "0.100000",
    declineFee: "0.5000", authorizationReversalRate: "0.010000", authorizationFee: "0.0000",
    smallTransactionFee: "0.3000", crossBorderFee: "0.0200", lowAuthorizationThreshold: "14.0000",
    lowAuthorizationFee: "0.1500", lowAuthorizationStackMode: "replace_platform_small_tx",
    refundKeepMinimum: "0.1000", binNotes: { "545020": "禁用 Claude", "558325": "" },
    minAmount: "10.0000", maxAmount: "100.0000", displayBin: "545020",
    description: "AI subscriptions", category: "AI", restrictedMerchants: ["CLAUDE"], googleChatgptBlocked: true,
  };
  const card = {
    id: 72001, cardNumberMasked: "•••• •••• •••• 2001", productCode: product.productCode,
    network: product.network, issuingArea: product.issuingArea, status: "ACTIVE", balance: "10.0000",
    refundKeepMinimum: "0.1000", firstName: "Fee", lastName: "Policy", pendingOperationId: null,
    pendingOperationType: null, createdAt: "2026-08-13T08:00:00Z",
  };
  await page.route("**/api/products", (route) => route.fulfill({ json: { code: 0, data: [product] } }));
  await page.route("**/api/cards", (route) => route.fulfill({ json: { code: 0, data: { total: 1, list: [card] } } }));
  await page.route(`**/api/cards/${card.id}`, (route) => route.fulfill({ json: { code: 0, data: {
    ...card, issuer: product.issuer, availableAmount: card.balance, note: "", minAmount: product.minAmount,
    maxAmount: product.maxAmount, rechargeRate: product.rechargeRate, refundRate: product.refundRate,
    declineFee: "0.7000", authorizationReversalRate: product.authorizationReversalRate,
    authorizationFee: product.authorizationFee, smallTransactionFee: product.smallTransactionFee,
    crossBorderFee: product.crossBorderFee, lowAuthorizationThreshold: product.lowAuthorizationThreshold,
    lowAuthorizationFee: product.lowAuthorizationFee, lowAuthorizationStackMode: product.lowAuthorizationStackMode,
    expiry: "12/29",
  } } }));
  await page.route("**/api/cards/transactions?**", (route) => route.fulfill({ json: { code: 0, data: {
    total: 0, list: [], activityTotal: 0, activities: [],
  } } }));

  await page.goto("/cards");
  const productFees = page.getByTestId("product-fees-FEE_POLICY");
  await expect(productFees).toContainText("完整费率标准", { timeout: 15_000 });
  await expect(productFees.getByRole("heading", { name: "完整费率标准", level: 3 })).toBeVisible();
  const productRefundFee = productFees.locator(".core-fee-list > div").filter({ hasText: "消费退款手续费率 (RTF)" });
  await expect(productRefundFee).toContainText("10%");
  await expect(productRefundFee).toBeVisible();
  const productAdditionalFees = productFees.locator("details");
  const productAdditionalSummary = productAdditionalFees.locator("summary");
  const productDeclineFee = productAdditionalFees.locator("dl > div").filter({ hasText: "拒付手续费 (DTF)" });
  await expect(productAdditionalSummary).toHaveText("可能产生的附加费用");
  await expect(productAdditionalFees).not.toHaveAttribute("open", "");
  await expect(productDeclineFee).not.toBeVisible();
  await productAdditionalSummary.focus();
  await page.keyboard.press("Enter");
  await expect(productAdditionalFees).toHaveAttribute("open", "");
  for (const [label, value] of [
    ["交易授权手续费 (Auth)", "$0.0000"], ["拒付手续费 (DTF)", "$0.5000"],
    ["授权撤销手续费 (ARF)", "1.00%"], ["小额交易手续费 (MTF)", "$0.3000"],
    ["跨境交易手续费 (FTF)", "$0.0200"],
  ]) {
    await expect(productAdditionalFees.locator("dl > div").filter({ hasText: label })).toContainText(value);
  }
  await expect(productFees).toContainText("单笔 USD 授权低于 $14 时收取 $0.15/笔；最终拒付不收此项费用。");
  await expect(productFees).toContainText("该费用替代小额交易手续费，不重复收取。");
  await expect(productFees).toContainText("卡余额退款后需至少保留 $0.1。");
  await expect(productFees).toContainText("545020: 禁用 Claude");
  await expect(productFees).not.toContainText("558325");

  await page.goto("/cards/owned");
  await page.locator(".bank-card").getByRole("button", { name: "退款", exact: true }).click();
  let refundDialog = page.getByRole("dialog", { name: "退款", exact: true });
  await expect(refundDialog.getByRole("spinbutton")).toHaveAttribute("max", "9.9000");
  await expect(refundDialog).toContainText("最多可退 $9.9；卡内必须保留 $0.1。");
  await page.keyboard.press("Escape");

  await page.goto(`/cards/${card.id}`);
  const operations = page.locator(".card-operations-panel");
  await expect(operations.getByText("$9.9", { exact: true })).toBeVisible();
  const cardFees = operations.getByTestId("product-fees-FEE_POLICY");
  const cardAdditionalFees = cardFees.locator("details");
  const cardDeclineFee = cardAdditionalFees.locator("dl > div").filter({ hasText: "拒付手续费 (DTF)" });
  await expect(cardDeclineFee).not.toBeVisible();
  await cardAdditionalFees.locator("summary").press("Space");
  await expect(cardDeclineFee).toContainText("$0.7");
  await expect(cardDeclineFee).toBeVisible();
  await expect(cardFees).toContainText("单笔 USD 授权低于 $14 时收取 $0.15/笔");
  await expect(cardFees).not.toContainText("545020: 禁用 Claude");
  await operations.getByRole("button", { name: "退款", exact: true }).click();
  refundDialog = page.getByRole("dialog", { name: "从卡片退款", exact: true });
  await expect(refundDialog.getByRole("spinbutton")).toHaveAttribute("max", "9.9000");
  await expect(refundDialog).toContainText("最多可退 $9.9；卡内必须保留 $0.1。");
  await page.keyboard.press("Escape");

  await page.goto("/cards/open/FEE_POLICY");
  await expect(page.getByText("受限商户: CLAUDE", { exact: true })).toBeVisible();
  await expect(page.getByText("Google / ChatGPT 禁止交易", { exact: true })).toHaveCount(0);
  const openFees = page.getByTestId("product-fees-FEE_POLICY");
  const openAdditionalFees = openFees.locator("details");
  const openDeclineFee = openAdditionalFees.locator("dl > div").filter({ hasText: "拒付手续费 (DTF)" });
  await expect(openDeclineFee).not.toBeVisible();
  await openAdditionalFees.locator("summary").click();
  await expect(openDeclineFee).toBeVisible();
  await expect(openFees).toContainText("545020: 禁用 Claude");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(openFees).toContainText("Complete fee schedule");
  await expect(openAdditionalFees.locator("summary")).toHaveText("Additional fees that may apply");
  await expect(openFees).toContainText("Product-specific low authorization fee");
  await expect(openFees).toContainText("At least $0.1 must remain after a card-balance refund.");
  await expect(openFees).toContainText("Card-range restrictions");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/cards");
  const mobileAdditionalFees = page.getByTestId("product-fees-FEE_POLICY").locator("details");
  const mobileAdditionalSummary = mobileAdditionalFees.locator("summary");
  expect(await mobileAdditionalSummary.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  await mobileAdditionalSummary.click();
  await expect(mobileAdditionalFees.locator("dl > div").filter({ hasText: "Decline fee (DTF)" })).toBeVisible();
  expect(await mobileAdditionalFees.locator("dl").evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length)).toBe(2);
});

test("pending refund updates consumption and balance without another refund request", async ({ page }) => {
  await mockAuthenticatedShell(page, "user");
  const operationId = "00000000-0000-0000-0000-000000008260";
  let synced = false;
  let writes = 0;
  const reason = "退款尚未完成。查到 OPENAI 消费预授权占用 $15.74。余额及消费流水已同步：上游可用余额 $129.89，最多可退 $129.79。原申请 $145.53 超过最新可退金额，不能按消费前的旧余额退款。";
  const card = { id: 8260, cardNumberMasked: "•••• •••• •••• 8260", productCode: "PENDING_REFUND",
    network: "VISA", issuingArea: "US", status: "ACTIVE", firstName: "Refund", lastName: "Test",
    refundKeepMinimum: "0.1000", pendingOperationId: operationId, pendingOperationType: "REFUND",
    createdAt: "2026-09-05T08:00:00Z" };
  await page.route("**/api/products", (route) => route.fulfill({json:{code:0,data:[]}}));
  await page.route("**/api/support/tickets", (route) => route.fulfill({json:{code:0,data:[]}}));
  await page.route("**/api/gpt-direct/card-successes", (route) => route.fulfill({json:{code:0,data:{list:[]}}}));
  await page.route("**/api/cards", (route) => route.fulfill({json:{code:0,data:{total:1,list:[{
    ...card,balance:synced ? "129.8900" : "145.6300",pendingOperationError:synced ? reason : null
  }]}}}));
  await page.route("**/api/cards/8260", (route) => route.fulfill({json:{code:0,data:{...card,
    availableAmount:synced ? "129.8900" : "145.6300",issuer:"Test",note:"",minAmount:"10",maxAmount:"1000",
    rechargeRate:"0",refundRate:"0",autoDeleteDeclines:4,expiry:"12/29"
  }}}));
  await page.route("**/api/cards/8260/ledger", (route) => route.fulfill({json:{code:0,data:{activities:[],transactions:synced ? [{
    providerId:1,cardId:8260,cardNumberMasked:card.cardNumberMasked,cardStatus:"ACTIVE",authId:"auth-8260",
    status:"PENDING",merchantName:"OPENAI",authorizedAmount:"15.7400",settledAmount:"0.0000",refundedAmount:"0",
    authCurrency:"USD",settleCurrency:"USD",occurredAt:"2026-09-05T09:29:07Z",events:[]
  }] : []}}}));
  await page.route(`**/api/operations/${operationId}`, (route) => route.fulfill({json:{code:0,data:{
    operationId,type:"REFUND",status:"RECONCILE_REQUIRED",terminal:false,dispatchState:"UNKNOWN",result:null,
    error:synced ? reason : "卡服务结果未知，等待对账",updatedAt:synced ? "2026-09-05T10:00:00Z" : "2026-09-05T09:34:51Z"
  }}}));
  await page.route("**/api/cards/8260/sync", route => route.fulfill({ json: { code: 0, data: { cardId: 8260, reusedSnapshot: true } } }));
  await page.route("**/api/cards/8260/actions", (route) => { writes++; return route.abort(); });
  await page.goto("/cards/8260");
  await expect(page.locator(".card-status-badge").getByText("退款暂未完成",{exact:true})).toBeVisible();
  synced = true;
  await expect(page.locator(".card-pending-operation")).toContainText("不能按消费前的旧余额退款",{timeout:12000});
  await expect(page.locator(".card-ledger-transaction").filter({hasText:"OPENAI"})).toContainText("15.74 USD");
  await expect(page.locator(".card-operations-panel")).toContainText("当前可退$129.79");
  await page.goto("/cards/owned");
  await expect(page.getByText(card.cardNumberMasked,{exact:true})).toBeVisible();
  await expect(page.locator(".bank-card")).toContainText("最多可退 $129.79");
  await expect(page.locator(".bank-card")).toContainText("$129.89");
  expect(writes).toBe(0);
});

for (const rejectionCode of ["REFUND_BALANCE_CHANGED", "REFUND_BALANCE_REJECTED"]) for (const entryPoint of ["list", "detail"] as const) test(`card refund refreshes changed balance and requires confirmation from ${entryPoint} (${rejectionCode})`, async ({ page }) => {
  await mockAuthenticatedShell(page, "user");
  const english = entryPoint === "detail";
  if (english) await page.addInitScript(() => localStorage.setItem("language", "en"));
  let synced = false;
  let ledgerReads = 0;
  const requests: Array<{ amount: string; key: string | undefined }> = [];
  const card = {
    id: 78260, cardNumberMasked: "•••• •••• •••• 8260", productCode: "REFUND_SYNC",
    network: "VISA", issuingArea: "US", status: "ACTIVE", balance: "145.6300",
    refundKeepMinimum: "0.1000", firstName: "Refund", lastName: "Test",
    pendingOperationId: null, pendingOperationType: null, createdAt: "2026-09-05T08:00:00Z",
  };
  const unavailable = english
    ? "The latest available balance could not be synced. This refund was not submitted; try again shortly."
    : "暂时无法同步最新可用余额，本次退款尚未提交，请稍后重试。";
  const balanceChanged = english
    ? "The card balance changed. Enter an amount within the latest refundable balance and confirm again."
    : "卡片余额已更新，请按最新可退金额重新输入并确认。";
  await page.route("**/api/gpt-direct/card-successes", (route) => route.fulfill({ json: { code: 0, data: { list: [] } } }));
  await page.route("**/api/support/tickets", (route) => route.fulfill({ json: { code: 0, data: [] } }));
  await page.route("**/api/products", (route) => route.fulfill({ json: { code: 0, data: [] } }));
  await page.route("**/api/cards", (route) => route.fulfill({ json: { code: 0, data: {
    total: 1, list: [{ ...card, balance: synced ? "129.8900" : card.balance }],
  } } }));
  await page.route(`**/api/cards/${card.id}`, (route) => route.fulfill({ json: { code: 0, data: {
    ...card, issuer: "Test Bank", availableAmount: synced ? "129.8900" : card.balance, note: "",
    minAmount: "10.0000", maxAmount: "1000.0000", rechargeRate: "0.010000", refundRate: "0.100000",
    autoDeleteDeclines: 4, expiry: "12/29",
  } } }));
  await page.route(`**/api/cards/${card.id}/ledger`, (route) => {
    ledgerReads += 1;
    const transaction = (authId: string, status: string, authorizedAmount: string, settledAmount: string, refundedAmount: string) => ({
      providerId: authId, cardId: card.id, cardNumberMasked: card.cardNumberMasked, cardStatus: "ACTIVE",
      authId, status, merchantName: authId, authorizedAmount, settledAmount, refundedAmount,
      authCurrency: "USD", settleCurrency: "USD", occurredAt: "2026-09-05T09:29:07Z", events: [],
    });
    return route.fulfill({ json: { code: 0, data: { activities: [], transactions: synced ? [
      transaction("pending-openai", "PENDING", "15.7400", "0.0000", "0.0000"),
      transaction("settled-openai", "SETTLED", "20.0000", "20.0000", "0.0000"),
      transaction("merchant-credit-full", "REFUNDED", "30.0000", "30.0000", "30.0000"),
      transaction("merchant-credit-part", "PARTIALLY_REFUNDED", "40.0000", "40.0000", "10.0000"),
      transaction("reversed-openai", "REVERSED", "9.0000", "0.0000", "0.0000"),
      transaction("declined-openai", "DECLINED", "8.0000", "0.0000", "0.0000"),
    ] : [] } } });
  });
  await page.route(`**/api/cards/${card.id}/actions`, (route) => {
    requests.push({ amount: route.request().postDataJSON().amount, key: route.request().headers()["idempotency-key"] });
    if (requests.length === 1) return route.fulfill({ status: 503, json: { errorCode: "REFUND_BALANCE_UNAVAILABLE", error: "服务端原始错误不应显示" } });
    if (requests.length === 2) {
      synced = true;
      return route.fulfill({ status: 409, json: { errorCode: rejectionCode, error: "服务端原始错误不应显示" } });
    }
    return route.fulfill({ json: { code: 0, data: { status: "SUCCEEDED", cardBalance: "0.1000", walletBalance: "129.7900", fee: "0.0000" } } });
  });

  await page.goto(entryPoint === "list" ? "/cards/owned" : `/cards/${card.id}`);
  await expect(page.getByText(card.cardNumberMasked, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: english ? "Refund" : "退款", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: english ? "Refund from card" : "退款", exact: true });
  const amount = dialog.getByRole("spinbutton");
  const confirm = dialog.getByRole("button", { name: english ? "Confirm" : "确认操作", exact: true });
  await expect(dialog).toContainText(english ? "The latest available balance is synced before submitting a refund" : "提交退款前会同步最新可用余额");
  await expect(amount).toHaveAttribute("max", "145.5300");
  await amount.fill("100.0000");
  await confirm.click();
  await expect(dialog.getByRole("alert")).toHaveText(unavailable);
  await expect(amount).toHaveValue("100.0000");
  await confirm.click();
  await expect(dialog.getByRole("alert")).toHaveText(balanceChanged);
  await expect(amount).toHaveValue("");
  await expect(amount).toHaveAttribute("max", "129.7900");
  await expect(dialog).toContainText(`${english ? "Current balance" : "当前余额"} $129.89`);
  expect(requests).toHaveLength(2);
  expect(requests[0].key).toBeTruthy();
  expect(requests[1].key).toBe(requests[0].key);
  if (entryPoint === "detail") {
    expect(ledgerReads).toBeGreaterThan(1);
    const ledgerAmount = (authId: string) => page.locator(".card-ledger-transaction").filter({ hasText: authId }).locator(".transaction-row > span");
    await expect(ledgerAmount("pending-openai")).toHaveText("Authorization hold 15.74 USD");
    await expect(ledgerAmount("settled-openai")).toHaveText("-20 USD");
    await expect(ledgerAmount("settled-openai")).toHaveClass("negative");
    await expect(ledgerAmount("merchant-credit-full")).toHaveText("Merchant refund +30 USD");
    await expect(ledgerAmount("merchant-credit-full")).toHaveClass("positive");
    await expect(ledgerAmount("merchant-credit-part")).toHaveText("Merchant refund +10 USD");
    await expect(ledgerAmount("reversed-openai")).toHaveText("Reversed (not charged)");
    await expect(ledgerAmount("declined-openai")).toHaveText("Declined (not charged)");
    await expect(page.locator(".card-ledger-transaction").filter({ hasText: "-0.0000 USD" })).toHaveCount(0);
  }
  await amount.fill("145.5300");
  expect(await amount.evaluate((element: HTMLInputElement) => element.checkValidity())).toBe(false);
  await amount.fill("100.0000");
  await confirm.click();
  await expect(dialog).not.toBeVisible();
  expect(requests.map((request) => request.amount)).toEqual(["100.0000", "100.0000", "100.0000"]);
  expect(requests[2].key).not.toBe(requests[1].key);
});

test("card recharge requires a current server quote in list and detail flows", async ({ page }) => {
  const cardId = 70001;
  const actionBodies: Array<Record<string, unknown>> = [];
  const actionKeys: string[] = [];
  const quoteAmounts: string[] = [];
  let priceUnavailable = true;
  let detailFee = "1.0000";
  let rejectChangedPrice = true;
  let releaseZeroQuote = () => {};
  const zeroQuoteGate = new Promise<void>((resolve) => { releaseZeroQuote = resolve; });
  const card = {
    id: cardId, cardNumberMasked: "•••• •••• •••• 7001", productCode: "QUOTE_CARD",
    network: "VISA", issuingArea: "US", status: "ACTIVE", balance: "40.0000",
    firstName: "Quote", lastName: "Test", createdAt: "2026-08-10T08:00:00Z",
  };
  await page.addInitScript(() => localStorage.setItem("session", JSON.stringify({ token: "", email: "quote@example.com" })));
  await page.route("**/api/dashboard", (route) => route.fulfill({ json: {
    email: "quote@example.com", role: "user", walletBalance: "100.0000", spendableBalance: "80.0000",
    cardBalance: "40.0000", cardCount: 1, inviteCode: "QUOTE",
  } }));
  await page.route("**/api/announcements/unread", (route) => route.fulfill({ json: { code: 0, data: [], unreadCount: 0 } }));
  await page.route("**/api/features", (route) => route.fulfill({ json: { code: 0, data: {
    version: 1, registration: true, walletTransfer: true, cardOpening: true, cardRecharge: true, cardManagement: true, cardDelete: true,
    gptDirect: true, gptCdk: true, deposits: true, rewards: true, agent: false, market: true,
    developerApi: true, telegram: true,
  } } }));
  await page.route("**/api/products", (route) => route.fulfill({ json: { code: 0, data: [{
    productCode: "QUOTE_CARD", issuer: "Quote Bank", network: "VISA", issuingArea: "US",
    cardType: "Virtual", openFee: "1.0000", rechargeRate: "0.010000", refundRate: "0.125000",
    minAmount: "10.0000", maxAmount: "100.0000", description: null, category: null,
  }] } }));
  await page.route("**/api/cards", (route) => route.fulfill({ json: { code: 0, data: { total: 1, list: [card] } } }));
  await page.route(`**/api/cards/${cardId}`, (route) => route.fulfill({ json: { code: 0, data: {
    ...card, issuer: "Quote Bank", availableAmount: "40.0000", note: "", minAmount: "10.0000",
    maxAmount: "100.0000", rechargeRate: "0.010000", refundRate: "0.125000", expiry: "12/29", autoDeleteDeclines: 4,
  } } }));
  await page.route(`**/api/cards/${cardId}/ledger`, (route) => route.fulfill({ json: {
    code: 0, data: { transactions: [], activities: [] },
  } }));
  await page.route("**/api/cards/transactions?**", (route) => route.fulfill({ json: { code: 0, data: { total: 0, list: [] } } }));
  await page.route(`**/api/cards/${cardId}/recharge-quote`, async (route) => {
    const amount = String(route.request().postDataJSON().amount);
    quoteAmounts.push(amount);
    if (amount === "12" && priceUnavailable) return route.fulfill({ status: 503, json: {
      error: "pricing unavailable", errorCode: "RECHARGE_PRICING_UNAVAILABLE",
    } });
    if (amount === "11") return route.fulfill({ status: 503, json: { error: "quote unavailable" } });
    if (amount === "10") {
      await zeroQuoteGate;
      return route.fulfill({ json: { code: 0, data: {
        amount: "10.0000", fee: "0.0000", totalDebit: "10.0000", effectiveRechargeRate: "0.000000",
      } } });
    }
    return route.fulfill({ json: { code: 0, data: {
      amount: "20.0000", fee: detailFee, totalDebit: detailFee === "1.0000" ? "21.0000" : "22.0000",
      effectiveRechargeRate: detailFee === "1.0000" ? "0.050000" : "0.100000",
    } } });
  });
  await page.route(`**/api/cards/${cardId}/actions`, (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    actionBodies.push(body);
    actionKeys.push(route.request().headers()["idempotency-key"]);
    if (body.amount === "20" && rejectChangedPrice) {
      rejectChangedPrice = false;
      detailFee = "2.0000";
      return route.fulfill({ status: 409, json: { error: "price changed", errorCode: "PRICE_CHANGED" } });
    }
    return route.fulfill({ json: { code: 0, data: {
      status: "ACTIVE", cardBalance: "50.0000", walletBalance: "100.0000", fee: body.expectedFee,
    } } });
  });

  await page.goto("/cards");
  const productCard = page.getByTestId("product-QUOTE_CARD");
  await expect(productCard).toContainText("消费退款手续费率", { timeout: 10_000 });
  await expect(productCard).toContainText("12.5%");
  // Existing cards still recharge when their product disappears from new-card sales.
  await page.route("**/api/products", route => route.fulfill({ json: { code: 0, data: [] } }));
  await page.goto("/cards/owned");
  const ownedCard = page.locator(".bank-card").filter({ hasText: "Quote Test" });
  await ownedCard.getByRole("button", { name: "充值", exact: true }).click();
  let dialog = page.getByRole("dialog");
  let amountInput = dialog.getByRole("spinbutton");
  let confirm = dialog.getByRole("button", { name: "确认操作", exact: true });
  await expect(confirm).toBeDisabled();
  await expect(dialog.getByTestId("recharge-quote-spendable")).toHaveText("可用余额$80");
  await amountInput.fill("5");
  const invalidQuote = dialog.getByText("请输入充值范围内的有效金额。", { exact: true });
  await expect(invalidQuote).toBeVisible();
  expect(await invalidQuote.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(12);
  await expect(confirm).toBeDisabled();
  expect(quoteAmounts).toHaveLength(0);
  await amountInput.fill("11");
  await expect(dialog.getByRole("alert")).toHaveText("充值费用获取失败，请稍后重试。");
  await expect(confirm).toBeDisabled();
  await amountInput.fill("12");
  await expect(dialog.getByRole("alert")).toContainText("上游暂未提供该卡产品的有效充值费率");
  await expect(dialog.getByRole("alert")).toContainText("本次未扣款");
  await expect(confirm).toBeDisabled();
  expect(actionBodies).toHaveLength(0);
  priceUnavailable = false;
  await dialog.getByRole("button", { name: "重试", exact: true }).click();
  await expect(confirm).toBeEnabled();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await amountInput.fill("10");
  await expect(dialog.getByRole("status")).toHaveText("正在获取本次充值费用…");
  await expect(confirm).toBeDisabled();
  releaseZeroQuote();
  await expect(dialog.getByTestId("recharge-quote-fee")).toHaveText("$0");
  await expect(dialog.getByText("充值手续费（0%）", { exact: true })).toBeVisible();
  await expect(dialog.getByTestId("recharge-quote-total")).toHaveText("$10");
  await expect(dialog.getByTestId("recharge-quote-spendable")).toHaveText("可用余额$80");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const mobileQuoteStyles = await dialog.getByTestId("card-recharge-quote").evaluate((element) => {
    const list = element.querySelector("dl")!;
    const label = element.querySelector("dt")!;
    const total = element.querySelector("dl > div:last-child dd")!;
    return {
      columns: getComputedStyle(list).gridTemplateColumns.trim().split(/\s+/).length,
      labelSize: Number.parseFloat(getComputedStyle(label).fontSize),
      totalSize: Number.parseFloat(getComputedStyle(total).fontSize),
    };
  });
  expect(mobileQuoteStyles).toMatchObject({ columns: 1, labelSize: 11, totalSize: 15 });
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(dialog).toBeHidden();
  expect(actionBodies[0]).toMatchObject({ action: "recharge", amount: "10", expectedFee: "0.0000" });

  await page.goto(`/cards/${cardId}`);
  await expect(page.getByTestId("card-refund-rate")).toHaveText("12.5%");
  await expect(page.locator(".card-operation-body .refund-rate-field"))
    .toContainText("仅在商户消费发生退款并确认后收取；未发生退款不收取，卡余额退回不适用。");
  await expect(page.locator(".card-operation-warning"))
    .toContainText("单卡累计 4 次拒付后将自动销卡");
  const detailRecharge = page.locator(".card-operations-panel").getByRole("button", { name: "充值", exact: true });
  await expect(detailRecharge).toBeVisible();
  await expect(detailRecharge).toBeEnabled();
  await detailRecharge.click();
  dialog = page.getByRole("dialog", { name: "为卡片充值", exact: true });
  amountInput = dialog.getByRole("spinbutton");
  confirm = dialog.getByRole("button", { name: "确认操作", exact: true });
  await expect(confirm).toBeDisabled();
  await amountInput.fill("20");
  await expect(dialog.getByTestId("recharge-quote-fee")).toHaveText("$1");
  await expect(dialog.getByTestId("recharge-quote-total")).toHaveText("$21");
  await expect(dialog.getByTestId("recharge-quote-spendable")).toHaveText("可用余额$80");
  await confirm.click();
  await expect(dialog.getByText("费用已变化，已更新为最新报价，请确认后重新提交。", { exact: true })).toBeVisible();
  await expect(dialog.getByTestId("recharge-quote-fee")).toHaveText("$2");
  await expect(dialog.getByTestId("recharge-quote-total")).toHaveText("$22");
  expect(actionBodies).toHaveLength(2);
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(dialog).toBeHidden();
  expect(actionBodies[1]).toMatchObject({ action: "recharge", amount: "20", expectedFee: "1.0000" });
  expect(actionBodies[2]).toMatchObject({ action: "recharge", amount: "20", expectedFee: "2.0000" });
  expect(actionKeys[2]).not.toBe(actionKeys[1]);
  expect(quoteAmounts.filter((amount) => amount === "20")).toHaveLength(2);
});

test("card recharge accepted 202 polls silently until success", async ({ page }) => {
  const cardId = 70021;
  const operationId = "00000000-0000-0000-0000-000000070021";
  let operationCalls = 0;
  let actionCalls = 0;
  const card = {
    id: cardId, cardNumberMasked: "•••• •••• •••• 7021", productCode: "POLL_CARD",
    network: "VISA", issuingArea: "US", status: "ACTIVE", balance: "40.0000",
    firstName: "Poll", lastName: "Recharge", createdAt: "2026-08-10T08:00:00Z",
    pendingOperationId: null, pendingOperationType: null,
  };
  await page.addInitScript(() => localStorage.setItem("session", JSON.stringify({ token: "", email: "poll@example.com" })));
  await page.route("**/api/dashboard", (route) => route.fulfill({ json: {
    email: "poll@example.com", role: "user", walletBalance: "100.0000", spendableBalance: "80.0000",
    cardBalance: "40.0000", cardCount: 1, inviteCode: "POLL",
  } }));
  await page.route("**/api/announcements/unread", (route) => route.fulfill({ json: { code: 0, data: [], unreadCount: 0 } }));
  await page.route("**/api/features", (route) => route.fulfill({ json: { code: 0, data: {
    version: 1, registration: true, walletTransfer: true, cardOpening: true, cardRecharge: true, cardManagement: true, cardDelete: true,
    gptDirect: true, gptCdk: true, deposits: true, rewards: true, agent: false, market: true,
    developerApi: true, telegram: true,
  } } }));
  await page.route("**/api/products", (route) => route.fulfill({ json: { code: 0, data: [] } }));
  await page.route("**/api/cards", (route) => route.fulfill({ json: { code: 0, data: { total: 1, list: [card] } } }));
  await page.route(`**/api/cards/${cardId}`, (route) => route.fulfill({ json: { code: 0, data: {
    ...card, issuer: "Poll Bank", availableAmount: "40.0000", note: "", minAmount: "10.0000",
    maxAmount: "100.0000", rechargeRate: "0.000000", refundRate: "0.125000", expiry: "12/29", autoDeleteDeclines: 4,
  } } }));
  await page.route(`**/api/cards/${cardId}/ledger`, (route) => route.fulfill({ json: {
    code: 0, data: { transactions: [], activities: [] },
  } }));
  await page.route("**/api/cards/transactions?**", (route) => route.fulfill({ json: { code: 0, data: { total: 0, list: [] } } }));
  await page.route(`**/api/cards/${cardId}/recharge-quote`, (route) => {
    const amount = String(route.request().postDataJSON().amount);
    return route.fulfill({ json: { code: 0, data: {
      amount: `${amount}.0000`, fee: "0.0000", totalDebit: `${amount}.0000`, effectiveRechargeRate: "0.000000",
    } } });
  });
  await page.route(`**/api/cards/${cardId}/actions`, (route) => {
    actionCalls += 1;
    return route.fulfill({ status: 202, json: { error: "pending", operationId, status: "PENDING" } });
  });
  await page.route(`**/api/operations/${operationId}`, (route) => {
    operationCalls += 1;
    const succeeded = operationCalls >= 2;
    return route.fulfill({ json: { code: 0, data: {
      operationId, type: "RECHARGE", status: succeeded ? "SUCCEEDED" : "PENDING",
      terminal: succeeded, dispatchState: succeeded ? "CONFIRMED" : "DISPATCHED",
      result: succeeded ? { status: "SUCCEEDED", cardBalance: "50.0000", walletBalance: "90.0000", fee: "0.0000" } : null,
      error: null, updatedAt: new Date().toISOString(),
    } } });
  });

  await page.goto("/cards/owned");
  await page.locator(".bank-card").filter({ hasText: "Poll Recharge" }).getByRole("button", { name: "充值", exact: true }).click();
  const listDialog = page.getByRole("dialog");
  await listDialog.getByRole("spinbutton").fill("10");
  await listDialog.getByRole("button", { name: "确认操作", exact: true }).click();
  await expect(listDialog.getByRole("button", { name: "处理中…", exact: true })).toBeVisible();
  await expect(listDialog.getByRole("alert")).toHaveCount(0);
  await expect(listDialog).toBeHidden({ timeout: 10_000 });
  await expect(page.getByText("操作结果待核验", { exact: false })).toHaveCount(0);
  expect(actionCalls).toBe(1);
  expect(operationCalls).toBeGreaterThanOrEqual(2);

  operationCalls = 0;
  await page.goto(`/cards/${cardId}`);
  await page.locator(".card-operations-panel").getByRole("button", { name: "充值", exact: true }).click();
  const detailDialog = page.getByRole("dialog", { name: "为卡片充值", exact: true });
  await detailDialog.getByRole("spinbutton").fill("10");
  await detailDialog.getByRole("button", { name: "确认操作", exact: true }).click();
  await expect(detailDialog.getByRole("button", { name: "处理中…", exact: true })).toBeVisible();
  await expect(detailDialog.getByRole("alert")).toHaveCount(0);
  await expect(detailDialog).toBeHidden({ timeout: 10_000 });
  await expect(page.getByText("操作结果待核验", { exact: false })).toHaveCount(0);
  expect(actionCalls).toBe(2);
  expect(operationCalls).toBeGreaterThanOrEqual(2);
});

test("card recharge shows pending verification only when reconcile is required", async ({ page }) => {
  const cardId = 70022;
  const operationId = "00000000-0000-0000-0000-000000070022";
  const card = {
    id: cardId, cardNumberMasked: "•••• •••• •••• 7022", productCode: "SYNC_WAIT",
    network: "VISA", issuingArea: "US", status: "ACTIVE", balance: "40.0000",
    firstName: "Sync", lastName: "Wait", createdAt: "2026-08-10T08:00:00Z",
  };
  await page.addInitScript(() => localStorage.setItem("session", JSON.stringify({ token: "", email: "syncwait@example.com" })));
  await page.route("**/api/dashboard", (route) => route.fulfill({ json: {
    email: "syncwait@example.com", role: "user", walletBalance: "100.0000", spendableBalance: "80.0000",
    cardBalance: "40.0000", cardCount: 1, inviteCode: "SYNC",
  } }));
  await page.route("**/api/announcements/unread", (route) => route.fulfill({ json: { code: 0, data: [], unreadCount: 0 } }));
  await page.route("**/api/features", (route) => route.fulfill({ json: { code: 0, data: {
    version: 1, registration: true, walletTransfer: true, cardOpening: true, cardRecharge: true, cardManagement: true, cardDelete: true,
    gptDirect: true, gptCdk: true, deposits: true, rewards: true, agent: false, market: true,
    developerApi: true, telegram: true,
  } } }));
  await page.route("**/api/products", (route) => route.fulfill({ json: { code: 0, data: [] } }));
  await page.route("**/api/cards", (route) => route.fulfill({ json: { code: 0, data: { total: 1, list: [card] } } }));
  await page.route(`**/api/cards/${cardId}`, (route) => route.fulfill({ json: { code: 0, data: {
    ...card, issuer: "Sync Bank", availableAmount: "40.0000", note: "", minAmount: "10.0000",
    maxAmount: "100.0000", rechargeRate: "0.000000", refundRate: "0.125000", expiry: "12/29", autoDeleteDeclines: 4,
  } } }));
  await page.route(`**/api/cards/${cardId}/recharge-quote`, (route) => {
    const amount = String(route.request().postDataJSON().amount);
    return route.fulfill({ json: { code: 0, data: {
      amount: `${amount}.0000`, fee: "0.0000", totalDebit: `${amount}.0000`, effectiveRechargeRate: "0.000000",
    } } });
  });
  await page.route(`**/api/cards/${cardId}/actions`, (route) => route.fulfill({
    status: 202, json: { error: "pending", operationId, status: "PENDING" },
  }));
  await page.route(`**/api/operations/${operationId}`, (route) => route.fulfill({ json: { code: 0, data: {
    operationId, type: "RECHARGE", status: "RECONCILE_REQUIRED", terminal: false, dispatchState: "UNKNOWN",
    result: null, error: null, updatedAt: new Date().toISOString(),
  } } }));

  await page.goto("/cards/owned");
  await page.locator(".bank-card").filter({ hasText: "Sync Wait" }).getByRole("button", { name: "充值", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("spinbutton").fill("10");
  await dialog.getByRole("button", { name: "确认操作", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText("操作结果待核验，请勿关闭页面或使用新请求重复提交。");
  await expect(dialog).toBeVisible();
});

test("card detail refreshes local balance and activity without discarding cached data", async ({ page }) => {
  await page.clock.install();
  let upstreamClosed = false;
  const cardId = 71001;
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  let synced = false;
  let syncPosts = 0;
  let sensitiveGets = 0;
  let releaseSync = () => {};
  const syncGate = new Promise<void>((resolve) => { releaseSync = resolve; });
  const createdAt = "2026-08-10T08:00:00Z";
  const card = {
    id: cardId, cardNumberMasked: "•••• •••• •••• 7101", productCode: "SYNC_CARD",
    network: "VISA", issuingArea: "US", status: "ACTIVE", balance: "21.0000",
    firstName: "Sync", lastName: "Test", createdAt,
  };
  const transaction = {
    id: 91, authId: "sync-auth-1", cardId, type: "Settlement", status: "COMPLETE",
    authAmount: "9.9900", settleAmount: "9.9900", authCurrency: "USD", settleCurrency: "USD",
    merchantName: "OPENAI", description: null, authTime: createdAt, createdAt,
    merchantLocation: null, merchantRegion: null, merchantCountry: null, failedReason: null,
    billStatus: null, merchantAmount: "9.9900", merchantCurrency: "USD",
    sourceCreatedAt: null, source: "reconciled", channel: null,
  };
  const openingActivity = {
    operationId: "00000000-0000-0000-0000-000000071001", type: "OPEN_CARD", cardId,
    amount: "21.0000", fee: "2.2000", totalAmount: "23.2000", openFee: "2.0000",
    rechargeFee: "0.2000", status: "SUCCEEDED", occurredAt: createdAt,
  };
  const rechargeActivity = {
    operationId: "00000000-0000-0000-0000-000000071002", type: "RECHARGE", cardId,
    amount: "10.0000", fee: "0.1000", totalAmount: "10.1000", openFee: null,
    rechargeFee: "0.1000", status: "SUCCEEDED", occurredAt: "2026-08-10T09:00:00Z",
  };
  const refundActivity = {
    operationId: "00000000-0000-0000-0000-000000071003", type: "REFUND", cardId,
    amount: "2.2000", fee: "0.0000", totalAmount: "2.2000", openFee: null,
    rechargeFee: null, status: "SUCCEEDED", occurredAt: "2026-08-10T10:00:00Z",
  };

  await page.addInitScript(() => localStorage.setItem("session", JSON.stringify({ token: "", email: "sync@example.com" })));
  await page.route("**/api/dashboard", (route) => route.fulfill({ json: {
    email: "sync@example.com", role: "user", walletBalance: "100.0000", cardBalance: synced ? "18.8000" : "21.0000",
    cardCount: 1, inviteCode: "SYNC",
  } }));
  await page.route("**/api/announcements/unread", (route) => route.fulfill({ json: { code: 0, data: [], unreadCount: 0 } }));
  await page.route("**/api/features", (route) => route.fulfill({ json: { code: 0, data: {
    version: 1, registration: true, walletTransfer: true, cardOpening: true, cardRecharge: true, cardManagement: true, cardDelete: true,
    gptDirect: true, gptCdk: true, deposits: true, rewards: true, agent: false, market: true,
    developerApi: true, telegram: true,
  } } }));
  await page.route(`**/api/cards/${cardId}/sensitive`, (route) => {
    sensitiveGets += 1;
    return route.fulfill({ json: { code: 0, data: {
      cardNumber: "4242424242427101", cvv: "123", expire: "12/29", cardAddress: {
        addressLineOne: "1 Market Street", addressLineTwo: "Suite 7101", city: "San Francisco",
        state: "CA", country: "US", postCode: "94105",
      },
    } } });
  });
  await page.route(`**/api/cards/${cardId}/sync`, async (route) => {
    syncPosts += 1;
    if (syncPosts === 2) {
      return route.fulfill({ json: { code: 0, data: {
        cardId, balance: "18.8000", status: "ACTIVE", reusedSnapshot: true,
        balanceSnapshotApplied: false, cooldownSeconds: 45,
      } } });
    }
    if (syncPosts > 2) {
      return route.fulfill({ status: 429, json: { error: "raw provider cooldown should never be shown" } });
    }
    await syncGate;
    synced = true;
    return route.fulfill({ json: { code: 0, data: {
      cardId, balance: "18.8000", status: "ACTIVE", balanceSnapshotApplied: true,
      transactionsSeen: 1, transactionsInserted: 1, transactionsTruncated: false,
      rechargesSeen: 1, cooldownSeconds: 60,
    } } });
  });
  await page.route(`**/api/cards/${cardId}`, (route) => route.fulfill({ json: { code: 0, data: {
    ...card, status: upstreamClosed ? "DELETED" : "ACTIVE", accountingStatus: "ACTIVE", upstreamStatus: upstreamClosed ? "DELETED" : "ACTIVE", issuer: "Sync Bank", availableAmount: upstreamClosed ? "0" : synced ? "18.8000" : "21.0000", note: "",
    minAmount: "10.0000", maxAmount: "100.0000", rechargeRate: "0.010000", refundRate: "0.125000",
    autoDeleteDeclines: 4, expiry: "12/29",
  } } }));
  await page.route(`**/api/cards/${cardId}/ledger`, (route) => route.fulfill({ json: { code: 0, data: {
    transactions: synced ? [{
      providerId: 1, cardId, cardNumberMasked: card.cardNumberMasked, cardStatus: card.status,
      authId: transaction.authId, status: "SETTLED", merchantName: transaction.merchantName,
      description: transaction.description, merchantLocation: transaction.merchantLocation,
      merchantRegion: transaction.merchantRegion, merchantCountry: transaction.merchantCountry,
      failedReason: transaction.failedReason, billStatus: transaction.billStatus, source: transaction.source,
      channel: transaction.channel, authorizedAmount: transaction.authAmount, settledAmount: transaction.settleAmount,
      refundedAmount: "0.0000", authCurrency: transaction.authCurrency, settleCurrency: transaction.settleCurrency,
      merchantAmount: transaction.merchantAmount, merchantCurrency: transaction.merchantCurrency,
      occurredAt: transaction.authTime, events: [{
        id: transaction.id, type: transaction.type, status: transaction.status,
        authAmount: transaction.authAmount, settleAmount: transaction.settleAmount,
        authCurrency: transaction.authCurrency, settleCurrency: transaction.settleCurrency,
        merchantAmount: transaction.merchantAmount, merchantCurrency: transaction.merchantCurrency,
        description: transaction.description, billStatus: transaction.billStatus, failedReason: transaction.failedReason,
        source: transaction.source, channel: transaction.channel, authTime: transaction.authTime,
        sourceCreatedAt: transaction.sourceCreatedAt,
      }],
    }] : [],
    activities: (synced ? [refundActivity, rechargeActivity, openingActivity] : [openingActivity]).map((item) => ({
      id: item.operationId, kind: "CARD_ACTIVITY", type: item.type, status: item.status,
      amount: item.amount, fee: item.fee, totalAmount: item.totalAmount,
      balanceImpact: item.type === "REFUND" ? "WALLET" : "CARD_AND_WALLET", occurredAt: item.occurredAt,
    })),
    upstreamRecharges: synced ? [{ id: 991, amount: "20.0000", fee: "0.0000", status: "success", occurredAt: "2026-09-05T09:00:00Z", syncedAt: "2026-09-05T09:01:00Z" }] : [],
    upstreamRechargeTotal: synced ? 1 : 0,
  } } }));
  await page.route("**/api/cards/transactions?**", (route) => route.fulfill({ json: { code: 0, data: {
    total: synced ? 1 : 0, list: synced ? [transaction] : [],
    activityTotal: synced ? 3 : 1, activities: synced ? [refundActivity, rechargeActivity, openingActivity] : [openingActivity],
  } } }));

  await page.goto(`/cards/${cardId}`);
  await expect(page.getByTestId("card-number")).toContainText("7101", { timeout: 15_000 });
  await expect(page.locator('.card-detail-visual .card-network-logo[alt="Visa"]'))
    .toHaveAttribute("src", "/card-brands/visa-brand-mark-white-2025.svg");
  await expect(page.getByTestId("card-refund-rate")).toHaveText("12.5%");
  await expect(page.locator(".card-operation-body .refund-rate-field"))
    .toContainText("仅在商户消费发生退款并确认后收取；未发生退款不收取，卡余额退回不适用。");
  await expect(page.getByText("$21", { exact: true })).toBeVisible();
  await expect(page.getByText("OPENAI", { exact: true })).toHaveCount(0);
  const fundsActivity = page.getByTestId("card-funds-activities");
  await expect(fundsActivity).toContainText("OPEN_CARD");
  await expect(fundsActivity).toContainText("手续费 $2.2 · 钱包金额 $23.2");
  await expect(page.getByTestId("card-billing-address")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("1 Market Street");
  await page.getByRole("button", { name: "显示完整信息", exact: true }).click();
  await expect(page.getByTestId("card-number")).toHaveText("4242424242427101");
  const billingAddress = page.getByTestId("card-billing-address");
  await expect(billingAddress).toContainText("1 Market Street");
  await expect(billingAddress).toContainText("San Francisco");
  await billingAddress.getByRole("button", { name: "复制地址第一行", exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("1 Market Street");
  await billingAddress.getByRole("button", { name: "复制完整账单地址", exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("1 Market Street, Suite 7101, San Francisco, CA, 94105, US");
  expect(sensitiveGets).toBe(1);

  const refresh = page.locator(".card-detail-actions button").first();
  await expect(refresh).toHaveAccessibleName("刷新中…");
  await expect.poll(() => syncPosts).toBe(1);
  await expect(refresh).toBeDisabled();
  await expect(refresh.locator("svg")).toHaveClass(/is-spinning/);
  releaseSync();
  await expect(page.getByText("余额与消费记录已更新，上游退款正在自动核对入账。", { exact: true })).toBeVisible();
  const successNotice = page.locator("p.card-sync-status[role=status]");
  await expect(successNotice).toHaveCSS("animation-duration", "12s");
  await successNotice.evaluate(element => { element.getAnimations()[0].currentTime = 11000; });
  await expect(successNotice).toHaveCSS("opacity", "1");
  await expect(page.getByText("$18.8", { exact: true })).toBeVisible();
  await expect(page.getByText("OPENAI", { exact: true })).toBeVisible();
  await expect(fundsActivity).toContainText("RECHARGE");
  await expect(page.getByTestId("card-upstream-recharges")).toContainText("卡充值 · #991");
  await expect(page.getByTestId("card-upstream-recharges")).toContainText("success");
  await expect(page.getByTestId("card-upstream-recharges")).toContainText("不重复计入钱包扣款");
  await expect(fundsActivity).not.toContainText("#991");
  await expect(fundsActivity).toContainText("手续费 $0.1 · 钱包金额 $10.1");
  const refundRow = fundsActivity.locator(".transaction-row").filter({ hasText: "REFUND" });
  await expect(refundRow).toContainText("影响：钱包余额");
  await expect(refundRow.locator(":scope > span")).toHaveText("+$2.2");
  await expect(refundRow.locator(":scope > span")).toHaveClass("positive");
  await expect(page.getByTestId("card-number")).toHaveText("4242424242427101");
  expect(sensitiveGets).toBe(1);

  await page.getByRole("button", { name: "刷新余额与消费", exact: true }).click();
  await expect(page.getByText("已显示最近同步的数据，已请求核对上游退款，无需重复刷新。", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "刷新余额与消费", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("该卡刷新暂受频率限制，已保留现有数据，请稍后主动刷新。");
  await expect(page.getByText("$18.8", { exact: true })).toBeVisible();
  await expect(page.getByText("OPENAI", { exact: true })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("raw provider cooldown");
  await expect(page.getByRole("alert")).not.toContainText("上游");

  await page.getByRole("button", { name: "隐藏完整信息", exact: true }).click();
  await expect(page.getByTestId("card-billing-address")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("1 Market Street");
  await expect(page.getByTestId("card-number")).not.toHaveText("4242424242427101");
  await page.getByRole("button", { name: "显示完整信息", exact: true }).click();
  await expect(page.getByTestId("card-billing-address")).toContainText("1 Market Street");
  await expect.poll(() => sensitiveGets).toBe(2);
  const requestsBeforePolling = syncPosts;
  synced = false;
  await page.clock.fastForward(10_000);
  await expect(page.getByText("$21", { exact: true })).toBeVisible();
  synced = true;
  await page.clock.fastForward(10_000);
  await expect(page.getByText("$18.8", { exact: true })).toBeVisible();
  await expect(page.getByTestId("card-upstream-recharges")).toContainText("success");
  expect(syncPosts).toBe(requestsBeforePolling);
  upstreamClosed = true;
  await page.clock.fastForward(10_000);
  await expect(page.getByText("已删除", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("卡片已被上游删除，不可再充值、支付或恢复使用。", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "充值", exact: true })).toHaveCount(0);
  await expect(page.getByText("$0", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "刷新余额与消费", exact: true })).toBeEnabled();
});

test("create an exact deposit order, restore it after refresh, and poll until confirmed", async ({ page, request, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/deposit");
  await page.getByTestId("deposit-amount-input").fill("100");
  await page.getByRole("button", { name: "创建充值订单", exact: true }).click();
  const expectedAmount = (await page.getByTestId("deposit-expected-amount").textContent())!.split(" ")[0];
  expect(expectedAmount).toMatch(/^100\.\d{6}$/);
  await expect(page.getByText("手续费扣除后必须精确到账", { exact: true })).toBeVisible();
  await expect(page.getByText("扣除钱包、交易所或链上转账手续费后的实际到账金额", { exact: false })).toBeVisible();
  expect(await page.getByTestId("deposit-expected-amount").evaluate((node) => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(40);
  await expect(page.getByTestId("deposit-address")).not.toBeEmpty();
  const receivingAddress = await page.getByTestId("deposit-address").textContent();
  await expect(page.getByTestId("deposit-address-qr")).toHaveAttribute("data-value", receivingAddress!);
  await expect(page.getByTestId("deposit-address-qr").locator("svg")).toBeVisible();
  await page.getByRole("button", { name: "复制应付金额", exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(expectedAmount);
  await page.getByRole("button", { name: "复制收款地址", exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(receivingAddress);
  const gatewayRef = await page.getByTestId("gateway-ref").textContent();

  await page.reload();
  await expect(page.getByTestId("gateway-ref")).toHaveText(gatewayRef!);
  await expect(page.getByTestId("deposit-expected-amount")).toContainText(expectedAmount);

  const body = JSON.stringify({
    gatewayRef,
    txHash: `0xe2e-${Date.now()}`,
    amount: expectedAmount,
    currency: "USDT",
    network: "TRON",
    confirmationStatus: "finalized",
    transactionSucceeded: true,
  });
  const signature = createHmac("sha256", "playwright-deposit-secret-at-least-32").update(body).digest("hex");
  const response = await request.post("/api/webhooks/deposit", {
    headers: { "content-type": "application/json", "x-signature": signature },
    data: body,
  });
  expect(response.status()).toBe(200);
  const creditedAmount = (await response.json()).data.creditedAmount;
  await expect(page.getByTestId("deposit-current-order")).toHaveAttribute("data-status", "confirmed", { timeout: 12_000 });
  await expect(page.getByText(`+$${creditedAmount}`, { exact: true })).toBeVisible({ timeout: 12_000 });
});

test("deposit form rejects amounts outside the supported exact range", async ({ page }) => {
  await page.goto("/deposit");
  const amount = page.getByTestId("deposit-amount-input");
  const create = page.getByRole("button", { name: "创建充值订单", exact: true });
  await expect(create).toBeDisabled();
  await amount.fill("9.99");
  await expect(create).toBeDisabled();
  await expect(page.getByRole("alert")).toContainText("10–1,000,000");
  await amount.fill("10.001");
  await expect(create).toBeDisabled();
  await amount.fill("10.00");
  await expect(create).toBeEnabled();
  await amount.fill("1000001");
  await expect(create).toBeDisabled();
  await amount.fill("1000000");
  await expect(create).toBeEnabled();
});

test("deposit network selection creates on BSC and SOL without mixing pending orders", async ({ page, context }, testInfo) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.route("**/api/support/tickets**", route => route.fulfill({ json: { code: 0, data: [] } }));
  if (testInfo.project.name === "frontend-mock") await mockAuthenticatedShell(page, "user");
  const now = Date.now();
  const tronContract = tronAssetId;
  const bscContract = bscAssetId;
  const solMint = solAssetId;
  const tronOrder = {
    gatewayRef: "00000000-0000-0000-0000-000000000071", currency: "USDT", network: "TRON",
    address: "TYXxWRHs1W6skR5HQLB3oVSm4JcWZMrJJj", requestedAmount: "75.00", expectedAmount: "75.000071", creditedEstimate: "75.000071",
    actualAmount: null, creditedAmount: null, txHash: null, status: "pending",
    createdAt: new Date(now).toISOString(), expiredAt: new Date(now + 15 * 60_000).toISOString(), confirmedAt: null,
  };
  const bscOrder = {
    gatewayRef: "00000000-0000-0000-0000-000000000072", currency: "USDT", network: "BSC",
    address: "0x2222222222222222222222222222222222222222", requestedAmount: "100.00", expectedAmount: "100.000072", creditedEstimate: "100.000072",
    actualAmount: null, creditedAmount: null, txHash: null, status: "pending",
    createdAt: new Date(now).toISOString(), expiredAt: new Date(now + 15 * 60_000).toISOString(), confirmedAt: null,
  };
  const solOrder = {
    gatewayRef: "00000000-0000-0000-0000-000000000073", currency: "USDT", network: "SOL",
    address: "GxDC9e7SP9mzhDo4re5HbpLa2RW7gB9DtmThx4i4pXSq", requestedAmount: "100.00", expectedAmount: "100.000073", creditedEstimate: "100.000073",
    actualAmount: null, creditedAmount: null, txHash: null, status: "pending",
    createdAt: new Date(now).toISOString(), expiredAt: new Date(now + 15 * 60_000).toISOString(), confirmedAt: null,
  };
  const networks = [{ network: "TRON", currency: "USDT", standard: "TRC20", tokenContract: tronContract, tokenDecimals: 6, enabled: true, ready: true },
    { network: "BSC", currency: "USDT", standard: "BEP20", tokenContract: bscContract, tokenDecimals: 18, enabled: true, ready: true },
    { network: "SOL", currency: "USDT", standard: "SPL", tokenContract: solMint, tokenDecimals: 6, enabled: true, ready: true }];
  let depositRecords = [tronOrder];
  const createBodies: Record<string, unknown>[] = [];
  await page.route("**/api/deposit/records", (route) => route.fulfill({ json: { code: 0, serverTime: new Date().toISOString(), networks, data: depositRecords } }));
  await page.route("**/api/deposit/create", (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    createBodies.push(body);
    const order = body.network === "SOL" ? solOrder : bscOrder;
    depositRecords = [order, ...depositRecords.filter((item) => item.network !== order.network)];
    return route.fulfill({ json: { code: 0, data: { ...order, reused: false } } });
  });

  await page.goto("/deposit");
  await expect(page.getByTestId("deposit-current-order")).toContainText("TRON · TRC20", { timeout: 20_000 });
  const fee = page.locator("#deposit-transfer-fee");
  const calculatorToggle = page.locator(".deposit-fee-calculator > summary");
  await expect(fee).toBeHidden();
  await expect(page.getByTestId("deposit-transfer-total")).toBeHidden();
  await expect(calculatorToggle).toBeVisible();
  const networkSelect = page.getByTestId("deposit-network-select");
  await networkSelect.click();
  await page.getByRole("option", { name: "BNB Smart Chain · BEP20", exact: true }).click();
  await expect(page.getByTestId("deposit-current-order")).toHaveCount(0);
  await page.getByTestId("deposit-amount-input").fill("100");
  const create = page.getByRole("button", { name: "创建充值订单", exact: true });
  await expect(fee).toBeHidden();
  await expect(page.getByTestId("deposit-transfer-total")).toBeHidden();
  await expect(create).toBeEnabled();
  await create.click();
  await expect.poll(() => createBodies).toHaveLength(1);
  expect(createBodies[0]).toEqual({ currency: "USDT", network: "BSC", amount: "100" });
  await expect(page.getByTestId("deposit-current-order")).toContainText("BNB Smart Chain · BEP20");
  await expect(page.getByTestId("deposit-address")).toHaveText(bscOrder.address);
  await expect(fee).toBeHidden();
  await page.getByRole("button", { name: "复制应付金额", exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("100.000072");
  await page.screenshot({ path: testInfo.outputPath("deposit-default-desktop.png"), fullPage: true, animations: "disabled" });
  await calculatorToggle.click();
  await expect(fee).toBeVisible();
  await expect(page.getByTestId("deposit-fee-notice")).toContainText("本平台不收取充值手续费");
  await expect(page.getByTestId("deposit-fee-notice")).toContainText("币安、欧易等转出平台收取");
  await expect(fee).toHaveValue("0.01");
  const total = page.getByTestId("deposit-transfer-total");
  const copyTotal = page.getByRole("button", { name: "复制转账总金额", exact: true });
  await expect(total).toHaveText("100.010072 USDT");
  await page.screenshot({ path: testInfo.outputPath("deposit-desktop.png"), fullPage: true, animations: "disabled" });
  await copyTotal.click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("100.010072");
  await fee.fill("0.123456");
  await expect(total).toHaveText("100.123528 USDT");
  await page.getByTestId("deposit-amount-input").fill("200");
  await expect(total).toHaveText("100.123528 USDT");
  await page.getByTestId("deposit-amount-input").fill("100");
  for (const invalid of ["-1", "abc", "0.0000001", "1e2"]) {
    await fee.fill(invalid);
    await expect(copyTotal).toBeDisabled();
    await expect(total).toHaveText("— USDT");
  }
  await calculatorToggle.click();
  await expect(fee).toBeHidden();
  await expect(total).toBeHidden();
  await page.getByRole("button", { name: "复制应付金额", exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("100.000072");
  await calculatorToggle.click();
  await fee.fill("");
  await expect(total).toHaveText("100.000072 USDT");
  await fee.fill("0.01");
  await page.reload();
  await expect(fee).toBeHidden();
  await expect(total).toBeHidden();
  await networkSelect.click();
  await page.getByRole("option", { name: "BNB Smart Chain · BEP20", exact: true }).click();
  await expect(fee).toBeHidden();
  await calculatorToggle.click();
  await expect(total).toHaveText("100.010072 USDT");
  await expect(fee).toHaveValue("0.01");
  await expect(page.getByTestId("deposit-address-qr")).toHaveAttribute("data-value", `ethereum:${bscContract}@56/transfer?address=${bscOrder.address}&uint256=100000072000000000000`);
  await expect(page.getByText(bscContract, { exact: true })).toBeVisible();
  await expect(page.getByText(tronContract, { exact: true })).toHaveCount(0);

  await networkSelect.click();
  await page.getByRole("option", { name: "TRON · TRC20", exact: true }).click();
  await expect(page.getByTestId("gateway-ref")).toHaveText(tronOrder.gatewayRef);
  await expect(fee).toHaveValue("0");
  await expect(total).toHaveText("75.000071 USDT");

  await networkSelect.click();
  await page.getByRole("option", { name: "Solana · SPL", exact: true }).click();
  await expect(page.getByTestId("deposit-current-order")).toHaveCount(0);
  await page.getByTestId("deposit-amount-input").fill("100");
  await expect(create).toBeEnabled();
  await create.click();
  await expect.poll(() => createBodies).toHaveLength(2);
  expect(createBodies[1]).toEqual({ currency: "USDT", network: "SOL", amount: "100" });
  await expect(page.getByTestId("deposit-current-order")).toContainText("Solana · SPL");
  await expect(page.getByText("Solana 收款钱包地址", { exact: true })).toBeVisible();
  await expect(page.getByTestId("deposit-address")).toHaveText(solOrder.address);
  await expect(page.getByTestId("deposit-address-qr")).toHaveAttribute("data-value", solOrder.address);
  await expect(page.getByText(/若付款币种显示 SOL，请勿支付/)).toBeVisible();
  await expect(fee).toHaveValue("0");
  await expect(total).toHaveText("100.000073 USDT");
  await expect(page.getByText(solMint, { exact: true })).toBeVisible();
  await expect(page.getByRole("note").filter({ hasText: "USDT Token Mint:" })).toBeVisible();
});

test("expired deposit history does not appear as the current order", async ({ page }) => {
  await page.route("**/api/support/tickets**", route => route.fulfill({ json: { code: 0, data: [] } }));
  await mockAuthenticatedShell(page, "user");
  const now = Date.now();
  await page.route("**/api/deposit/records", (route) => route.fulfill({ json: {
    code: 0,
    serverTime: new Date(now).toISOString(),
    networks: [{ network: "TRON", currency: "USDT", standard: "TRC20", tokenContract: tronAssetId, enabled: true, ready: true }],
    data: [{
      gatewayRef: "00000000-0000-0000-0000-000000000096",
      currency: "USDT", network: "TRON", address: "mock_expired_deposit",
      requestedAmount: "100.00", expectedAmount: "100.000096", creditedEstimate: "100.000096",
      actualAmount: null, creditedAmount: null, txHash: null, status: "expired", cancellable: false,
      createdAt: new Date(now - 90 * 24 * 60 * 60_000).toISOString(),
      expiredAt: new Date(now - 90 * 24 * 60 * 60_000 + 15 * 60_000).toISOString(), confirmedAt: null,
    }],
  } }));

  await page.goto("/deposit");
  await expect(page.getByTestId("deposit-current-order")).toHaveCount(0);
  await expect(page.locator(".transaction-panel")).toContainText("100.000096 USDT");
  await expect(page.locator(".transaction-panel")).toContainText("已过期");
});

test("pending deposit instructions fit a mobile viewport", async ({ page }, testInfo) => {
  await page.route("**/api/support/tickets**", route => route.fulfill({ json: { code: 0, data: [] } }));
  await mockAuthenticatedShell(page, "user");
  const now = Date.now();
  await page.route("**/api/deposit/records", (route) => route.fulfill({ json: { code: 0, serverTime: new Date(now).toISOString(), networks: [{
    network: "TRON", currency: "USDT", standard: "TRC20", tokenContract: tronAssetId, enabled: true, ready: true,
  }, {
    network: "BSC", currency: "USDT", standard: "BEP20", tokenContract: bscAssetId, enabled: false, ready: false,
  }], data: [{
    gatewayRef: "00000000-0000-0000-0000-000000000099",
    currency: "USDT", network: "TRON", address: "TYXxWRHs1W6skR5HQLB3oVSm4JcWZMrJJj",
    requestedAmount: "100.00", expectedAmount: "100.000099", creditedEstimate: "100.000099",
    actualAmount: null, creditedAmount: null, txHash: null, status: "pending",
    cancellable: false,
    createdAt: new Date(now).toISOString(), expiredAt: new Date(now + 15 * 60_000).toISOString(), confirmedAt: null,
  }, {
    gatewayRef: "00000000-0000-0000-0000-000000000098",
    currency: "USDT", network: "TRON", address: "mock_tron_legacy",
    requestedAmount: null, expectedAmount: null, creditedEstimate: null,
    actualAmount: null, creditedAmount: null, txHash: null, status: "expired",
    createdAt: new Date(now - 60 * 60_000).toISOString(), expiredAt: new Date(now - 45 * 60_000).toISOString(), confirmedAt: null,
  }] } }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/deposit");
  await expect(page.getByTestId("deposit-current-order")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("手续费扣除后必须精确到账", { exact: true })).toBeVisible();
  await expect(page.getByText("扣除钱包、交易所或链上转账手续费后的实际到账金额", { exact: false })).toBeVisible();
  expect(await page.getByTestId("deposit-expected-amount").evaluate((node) => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(30);
  await expect(page.getByTestId("deposit-address-qr")).toHaveAttribute("data-value", "TYXxWRHs1W6skR5HQLB3oVSm4JcWZMrJJj");
  await expect(page.getByTestId("deposit-address-qr").locator("svg")).toBeVisible();
  await expect(page.getByTestId("cancel-deposit-order")).toHaveCount(0);
  await expect(page.getByText("—", { exact: true })).toBeVisible();
  await page.getByTestId("deposit-network-select").click();
  await expect(page.getByRole("option", { name: "BNB Smart Chain · BEP20 · 维护中", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  const prominentNetwork = page.getByTestId("deposit-receiving-network");
  await expect(prominentNetwork).toContainText("TRON · TRC20", { timeout: 20_000 });
  expect(await prominentNetwork.evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(24);
  const networkBox = (await prominentNetwork.boundingBox())!;
  const addressBox = (await page.getByTestId("deposit-address").boundingBox())!;
  expect(networkBox.y + networkBox.height).toBeLessThanOrEqual(addressBox.y);
  await expect(page.locator("#deposit-transfer-fee")).toBeHidden();
  await expect(page.getByTestId("deposit-transfer-total")).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath("deposit-default-mobile.png"), fullPage: true, animations: "disabled" });
  await page.locator(".deposit-fee-calculator > summary").click();
  await expect(page.getByTestId("deposit-fee-notice")).toBeVisible();
  await page.getByLabel("转出平台手续费（USDT）", { exact: true }).fill("1.5");
  await expect(page.getByTestId("deposit-transfer-total")).toHaveText("101.500099 USDT");
  await page.screenshot({ path: testInfo.outputPath("deposit-mobile.png"), fullPage: true, animations: "disabled" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("an unpaid deposit can be cancelled and replaced", async ({ page }) => {
  await page.route("**/api/support/tickets**", route => route.fulfill({ json: { code: 0, data: [] } }));
  await mockAuthenticatedShell(page, "user");
  const now = Date.now();
  const gatewayRef = "00000000-0000-0000-0000-000000000097";
  let order = {
    gatewayRef,
    currency: "USDT",
    network: "TRON",
    address: "TYXxWRHs1W6skR5HQLB3oVSm4JcWZMrJJj",
    requestedAmount: "100.00",
    expectedAmount: "100.000097",
    creditedEstimate: "100.000097",
    actualAmount: null,
    creditedAmount: null,
    txHash: null,
    status: "pending",
    createdAt: new Date(now).toISOString(),
    expiredAt: new Date(now + 15 * 60_000).toISOString(),
    confirmedAt: null,
    cancellable: true,
  };
  const networks = [{
    network: "TRON", currency: "USDT", standard: "TRC20", tokenContract: tronAssetId, enabled: true, ready: true,
  }];
  await page.route("**/api/deposit/records", (route) => route.fulfill({
    json: { code: 0, serverTime: new Date().toISOString(), networks, data: [order] },
  }));
  let cancelRequests = 0;
  await page.route(`**/api/deposit/${gatewayRef}/cancel`, (route) => {
    cancelRequests += 1;
    expect(route.request().method()).toBe("POST");
    expect(route.request().postData()).toBeNull();
    order = { ...order, status: "cancelled", cancellable: false };
    return route.fulfill({ json: { code: 0, data: { gatewayRef, status: "cancelled", cancelledAt: new Date().toISOString(), replayed: false } } });
  });
  page.on("dialog", async (dialog) => {
    expect(dialog.message()).toContain("取消后该订单将永久停止核对，不会再自动到账");
    await dialog.accept();
  });

  await page.goto("/deposit");
  const cancel = page.getByTestId("cancel-deposit-order");
  await expect(cancel).toBeVisible({ timeout: 20_000 });
  await cancel.click();
  await expect.poll(() => cancelRequests).toBe(1);
  await expect(page.getByTestId("deposit-current-order")).toHaveCount(0);
  await expect(page.locator(".transaction-panel")).toContainText("已取消");
  await expect(page.getByTestId("deposit-expected-amount")).toHaveCount(0);
  await expect(page.getByTestId("deposit-address")).toHaveCount(0);
  await expect(page.getByTestId("deposit-address-qr")).toHaveCount(0);
  await expect(page.getByText(order.address, { exact: true })).toHaveCount(0);
  await expect(cancel).toHaveCount(0);
  await expect(page.getByTestId("deposit-transfer-total")).toBeHidden();
  await page.locator(".deposit-fee-calculator > summary").click();
  await expect(page.getByRole("button", { name: "复制转账总金额", exact: true })).toBeDisabled();
  await page.getByLabel("转出平台手续费（USDT）", { exact: true }).fill("invalid");
  await page.locator(".deposit-fee-calculator > summary").click();
  await page.getByTestId("deposit-amount-input").fill("101.00");
  await expect(page.getByRole("button", { name: "创建充值订单", exact: true })).toBeEnabled();
});

test("redeem points and join lottery", async ({ page }) => {
  setE2eAdminTelegramBinding(true);
  await page.goto("/rewards");
  await expect(page.getByText("1000", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "120 积分兑换 $1", exact: true }).click();
  await expect(page.getByText("880", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "参与一次", exact: true }).click();
  await expect(page.getByText("870", { exact: true })).toBeVisible();
  await expect(page.getByText("1/10", { exact: false })).toBeVisible();
});

test("rewards page supports check-in and free, points, and referral campaigns", async ({ page }) => {
  await mockAuthenticatedShell(page, "user");
  await page.setViewportSize({ width: 390, height: 844 });
  let checkedToday = false;
  let eligibleDirectReferrals = 0;
  let referralParticipated = false;
  const joins: Record<string, unknown>[] = [];
  const referralReads: Array<{ participated: boolean; eligibleForDraw: boolean; myTickets: number; eligibleDirectReferrals: number }> = [];
  const endsAt = new Date(Date.now() + 86_400_000).toISOString();
  await page.route("**/api/points", (route) => route.fulfill({ json: { code: 0, data: {
    balance: checkedToday ? 129 : 120, telegramBound: true, history: [],
    calendar: { month: "2026-08", checkedDates: ["2026-08-01", "2026-08-10", ...(checkedToday ? ["2026-08-12"] : [])] },
    checkin: { enabled: true, eligible: true, eligibilityReason: "eligible", checkedToday, businessDate: "2026-08-12", currentStreak: checkedToday ? 3 : 2, todayAward: 9, nextAward: 11, basePoints: 5, streakBonusPerDay: 2, streakBonusCapDays: 7 },
  } } }));
  await page.route("**/api/points/check-in", (route) => {
    checkedToday = true;
    return route.fulfill({ json: { code: 0, data: { businessDate: "2026-08-12", streakDays: 3, basePoints: 5, streakBonus: 4, awardedPoints: 9, pointBalance: 129, replayed: false } } });
  });
  await page.route("**/api/lottery", (route) => {
    if (route.request().method() === "POST") {
      const input = route.request().postDataJSON() as Record<string, unknown>;
      joins.push(input);
      if (input.activityId === 3) {
        referralParticipated = true;
        return route.fulfill({ json: { code: 0, data: {
          tickets: 1,
          pointCost: 0,
          pointBalance: 129,
          replayed: false,
          eligibleForDraw: eligibleDirectReferrals >= 2,
          current: eligibleDirectReferrals,
          required: 2,
        } } });
      }
      return route.fulfill({ json: { code: 0, data: { tickets: 1, pointCost: 0, pointBalance: 129, replayed: false, eligibleForDraw: true, current: 0, required: 0 } } });
    }
    const referralActivity = { id: 3, title: "Invite friends", description: "Grow the community", status: "open", participationMode: "direct_referrals", requiredDirectReferrals: 2, eligibleDirectReferrals, eligible: eligibleDirectReferrals >= 2, eligibilityReason: eligibleDirectReferrals >= 2 ? "eligible" : "direct_referrals_required", participated: referralParticipated, eligibleForDraw: referralParticipated && eligibleDirectReferrals >= 2, costPoints: 0, maxTicketsPerUser: 1, prize: "$20 balance", participantCount: referralParticipated ? 5 : 4, myTickets: referralParticipated ? 1 : 0, endsAt: null };
    referralReads.push({ participated: referralActivity.participated, eligibleForDraw: referralActivity.eligibleForDraw, myTickets: referralActivity.myTickets, eligibleDirectReferrals: referralActivity.eligibleDirectReferrals });
    return route.fulfill({ json: { code: 0, data: [
      { id: 1, title: "Community draw", description: "Everyone gets one free chance", status: "open", participationMode: "free", requiredDirectReferrals: 0, eligibleDirectReferrals: 0, eligible: true, eligibilityReason: "eligible", participated: false, eligibleForDraw: false, costPoints: 0, maxTicketsPerUser: 1, prize: "$5 balance", participantCount: 18, myTickets: 0, endsAt },
      { id: 2, title: "Points draw", description: "Use points for another chance", status: "open", participationMode: "points", requiredDirectReferrals: 0, eligibleDirectReferrals: 0, eligible: true, eligibilityReason: "eligible", participated: true, eligibleForDraw: true, costPoints: 10, maxTicketsPerUser: 3, prize: "100 points", participantCount: 12, myTickets: 1, endsAt },
      referralActivity,
      { id: 4, title: "Expired draw", description: "Waiting for worker", status: "open", participationMode: "free", requiredDirectReferrals: 0, eligibleDirectReferrals: 0, eligible: true, eligibilityReason: "eligible", participated: false, eligibleForDraw: false, costPoints: 0, maxTicketsPerUser: 1, prize: "$5 balance", participantCount: 5, myTickets: 0, endsAt: "2020-01-01T00:00:00.000Z" },
    ] } });
  });
  await page.goto("/rewards");
  await expect(page.getByTestId("checkin-card")).toContainText("已连续 2 天", { timeout: 15_000 });
  await expect(page.getByTestId("checkin-calendar")).toContainText("2026年8月");
  await expect(page.getByTestId("checkin-calendar")).toContainText("本月已签到 2 天");
  await expect(page.getByTestId("checkin-date-2026-08-10")).toHaveClass(/is-checked/);
  await expect(page.getByTestId("checkin-date-2026-08-12")).toHaveAttribute("aria-current", "date");
  await expect(page.getByTestId("checkin-date-2026-08-12")).not.toHaveClass(/is-checked/);
  await expect(page.getByTestId("checkin-date-2026-08-13")).toHaveClass(/is-future/);
  await expect(page.getByTestId("checkin-date-2026-08-13")).toHaveAttribute("aria-label", /尚未到达/);
  await expect(page.getByTestId("checkin-calendar").getByRole("columnheader")).toHaveCount(7);
  await expect(page.getByTestId("reward-activity-1")).toContainText("免费参与，不扣积分");
  await expect(page.getByTestId("reward-activity-1").locator("time")).toHaveAttribute("datetime", endsAt);
  await expect(page.getByTestId("reward-activity-2")).toContainText("每次 10 积分");
  await expect(page.getByTestId("reward-activity-3")).toContainText("有效直属邀请 0/2");
  await expect(page.getByTestId("reward-activity-3")).toContainText("未参与 · 当前进度 0/2");
  expect(referralReads.at(-1)).toEqual({ participated: false, eligibleForDraw: false, myTickets: 0, eligibleDirectReferrals: 0 });
  await expect(page.getByTestId("reward-activity-3")).toContainText("还需邀请 2 位有效直属用户");
  await expect(page.getByTestId("reward-activity-3")).toContainText("未设置结束时间，仅支持手动结束");
  await expect(page.getByTestId("reward-activity-4").getByRole("button", { name: "已停止参与", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "立即签到", exact: true }).click();
  await expect(page.locator(".notice")).toContainText("签到成功，获得 9 积分");
  await expect(page.getByRole("button", { name: "今日已签到", exact: true })).toBeDisabled();
  await expect(page.getByTestId("checkin-date-2026-08-12")).toHaveClass(/is-checked/);
  await expect(page.getByTestId("checkin-calendar")).toContainText("本月已签到 3 天");
  await page.getByTestId("reward-activity-1").getByRole("button", { name: "参与一次", exact: true }).click();
  expect(joins).toEqual([{ activityId: 1, tickets: 1 }]);
  const referralActivity = page.getByTestId("reward-activity-3");
  await expect(referralActivity.getByRole("button", { name: "参与一次", exact: true })).toBeEnabled();
  await referralActivity.getByRole("button", { name: "参与一次", exact: true }).click();
  await expect(page.locator(".notice")).toContainText("参与成功：当前邀请进度 0/2");
  await expect(page.locator(".notice")).toContainText("成功邀请 2 人后即可获得抽奖资格");
  await expect(page.locator(".notice")).not.toHaveClass(/error/);
  await expect(referralActivity).toContainText("已参与 · 待达标 0/2");
  await expect(referralActivity.getByRole("button", { name: "已参与", exact: true })).toBeDisabled();
  expect(referralReads.at(-1)).toEqual({ participated: true, eligibleForDraw: false, myTickets: 1, eligibleDirectReferrals: 0 });
  expect(joins).toEqual([{ activityId: 1, tickets: 1 }, { activityId: 3, tickets: 1 }]);
  eligibleDirectReferrals = 2;
  await page.reload();
  await expect(page.getByTestId("reward-activity-3")).toContainText("已参与 · 具备开奖资格 2/2");
  await expect(page.getByTestId("reward-activity-3").getByRole("button", { name: "已参与", exact: true })).toBeDisabled();
  expect(referralReads.at(-1)).toEqual({ participated: true, eligibleForDraw: true, myTickets: 1, eligibleDirectReferrals: 2 });
  expect(joins).toEqual([{ activityId: 1, tickets: 1 }, { activityId: 3, tickets: 1 }]);
  await page.getByRole("button", { name: "拉新抽奖", exact: true }).click();
  await expect(page.getByTestId("reward-activity-1")).toHaveCount(0);
  await expect(page.getByTestId("reward-activity-3")).toBeVisible();
  await page.setViewportSize({ width: 320, height: 720 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("rewards page supports check-in calendar leap day at 320px", async ({ page }) => {
  await mockAuthenticatedShell(page, "user");
  await page.setViewportSize({ width: 320, height: 720 });
  await page.route("**/api/points", (route) => route.fulfill({ json: { code: 0, data: {
    balance: 120, telegramBound: true, history: [], calendar: { month: "2028-02", checkedDates: ["2028-02-29"] },
    checkin: { enabled: true, eligible: true, eligibilityReason: "eligible", checkedToday: true, businessDate: "2028-02-29", currentStreak: 1, todayAward: 5, nextAward: 7, basePoints: 5, streakBonusPerDay: 2, streakBonusCapDays: 7 },
  } } }));
  await page.route("**/api/lottery", (route) => route.fulfill({ json: { code: 0, data: [] } }));
  await page.goto("/rewards");
  await expect(page.getByTestId("checkin-date-2028-02-29")).toContainText("✓", { timeout: 15_000 });
  await expect(page.getByTestId("checkin-date-2028-02-29")).toHaveAttribute("aria-current", "date");
  await expect(page.getByTestId("checkin-date-2028-02-30")).toHaveCount(0);
  const gaps = await page.evaluate(() => {
    const box = (date: string) => document.querySelector<HTMLElement>(`[data-testid="checkin-date-${date}"]`)!.getBoundingClientRect();
    const day21 = box("2028-02-21");
    const day28 = box("2028-02-28");
    const day29 = box("2028-02-29");
    return { horizontal: day29.left - day28.right, vertical: day28.top - day21.bottom };
  });
  expect(gaps.horizontal).toBeGreaterThanOrEqual(5);
  expect(gaps.vertical).toBeGreaterThanOrEqual(7);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("admin configures check-in and creates each campaign mode", async ({ page }) => {
  const commands: Array<{ body: Record<string, unknown>; key: string }> = [];
  await mockAuthenticatedShell(page);
  await mockAdminWorkspace(page, { onAdminLotteryCommand: (body, key) => commands.push({ body, key }), lotteryCompletesOnPoll: true });
  await page.goto("/admin");
  await page.getByTestId("admin-nav-rewards").click();
  const panel = page.getByTestId("admin-panel-rewards");
  await expect(panel).toContainText("签到设置");
  await expect(panel).toContainText("自动开奖重试中");
  await expect(panel.locator(".admin-list-row").filter({ hasText: "Retrying draw" })).toContainText("已完成", { timeout: 5_000 });
  await panel.getByRole("spinbutton", { name: "每日基础积分", exact: true }).fill("8");
  await panel.getByRole("spinbutton", { name: "连续签到每日加分", exact: true }).fill("3");
  await panel.getByRole("spinbutton", { name: "连续奖励封顶天数", exact: true }).fill("14");
  await panel.getByRole("button", { name: "保存签到设置", exact: true }).click();
  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0].body).toEqual({ action: "set_checkin", enabled: true, basePoints: 8, streakBonusPerDay: 3, streakBonusCapDays: 14, version: 3 });
  const createForm = panel.locator(".admin-activity-form");
  await createForm.getByLabel("活动标题", { exact: true }).fill("邀请好友赢大奖");
  await createForm.getByLabel("活动说明", { exact: true }).fill("邀请三位有效用户即可参与");
  const future = new Date(Date.now() + 172_800_000);
  const localEndsAt = new Date(future.getTime() - future.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  await createForm.getByLabel("结束时间", { exact: false }).fill(localEndsAt);
  await createForm.getByRole("combobox", { name: "参与方式", exact: true }).click();
  await page.getByRole("option", { name: "拉新抽奖", exact: true }).click();
  await createForm.getByLabel("有效直属邀请人数", { exact: true }).fill("3");
  await createForm.getByLabel("每人最多参与次数", { exact: true }).fill("2");
  await createForm.getByLabel("奖品名称", { exact: true }).fill("$20 balance");
  await createForm.getByLabel("奖品数量", { exact: true }).fill("1");
  await createForm.getByLabel("奖品面值", { exact: true }).fill("20.00");
  await expect(createForm).toContainText("余额类奖品中奖后会自动发放到账户余额");
  await createForm.getByRole("button", { name: "创建活动", exact: true }).click();
  await expect.poll(() => commands.length).toBe(2);
  expect(commands[1].body).toMatchObject({ action: "create", endsAt: new Date(localEndsAt).toISOString(), participationMode: "direct_referrals", requiredDirectReferrals: 3, costPoints: 0, maxTicketsPerUser: 2 });
  await expect(panel).toContainText("已完成");
  await panel.getByRole("button", { name: "提前结束并开奖", exact: true }).click();
  await expect.poll(() => commands.length).toBe(3);
  expect(commands[2].body).toEqual({ action: "draw", id: 41 });
  for (const command of commands) expect(command.key).toMatch(/^[0-9a-f-]{36}$/);
});

test("admin opens lottery participants in the existing customer detail", async ({ page }) => {
  const requests: string[] = [];
  await mockAuthenticatedShell(page);
  await mockAdminWorkspace(page, { onAdminLotteryParticipantsRequest: (url) => requests.push(url) });
  await page.goto("/admin");
  await page.getByTestId("admin-nav-rewards").click();
  const panel = page.getByTestId("admin-panel-rewards");
  await panel.getByRole("button", { name: "查看参与人（21）", exact: true }).click();
  const participants = panel.getByTestId("lottery-participants-42");
  await expect(participants).toContainText("customer@example.com");
  await expect(participants).toContainText("已参与 · 待达标 2/3");
  await participants.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(participants).toContainText("inviter@example.com");
  await expect(participants).toContainText("已参与 · 具备开奖资格 3/3");
  expect(requests.some((url) => new URL(url).searchParams.get("page") === "2")).toBe(true);
  await participants.getByRole("button", { name: "查看 inviter@example.com 的详情", exact: true }).click();
  await expect(page.getByTestId("admin-nav-customers")).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("INVITE6", { exact: true })).toBeVisible();
});

test("lottery delivery and point redemption use a deadlock-safe lock order", async ({ page }) => {
  setE2eAdminTelegramBinding(true);
  const endsAt = new Date(Date.now() + 86_400_000).toISOString();
  const activities = await Promise.all(Array.from({ length: 5 }, async (_, index) => {
    const created = await page.request.post("/api/admin/lottery", {
      headers: { "idempotency-key": `lock-order-create-${Date.now()}-${index}` },
      data: {
        action: "create", title: `Lock order ${index}`, endsAt, costPoints: 1, maxTicketsPerUser: 1,
        prizes: [{ label: "One point", qty: 1, type: "points", value: "1" }],
      },
    });
    expect(created.status()).toBe(200);
    const id = (await created.json()).data.id;
    expect((await page.request.post("/api/lottery", {
      headers: { "idempotency-key": `lock-order-join-${Date.now()}-${index}` },
      data: { activityId: id, tickets: 1 },
    })).status()).toBe(200);
    return id;
  }));
  const responses = await Promise.all(activities.flatMap((id, index) => [
    page.request.post("/api/admin/lottery", {
      headers: { "idempotency-key": `lock-order-draw-${Date.now()}-${index}` },
      data: { action: "draw", id },
    }),
    page.request.post("/api/points/redeem", {
      headers: { "idempotency-key": `lock-order-redeem-${Date.now()}-${index}` },
      data: { itemId: 2 },
    }),
  ]));
  const failures = await Promise.all(responses.filter((response) => response.status() !== 200)
    .map(async (response) => ({ status: response.status(), body: await response.text() })));
  expect(failures).toEqual([]);
  await expect.poll(async () => {
    const response = await page.request.get("/api/admin/lottery");
    const data = (await response.json()).data.activities as Array<{ id: number; status: string }>;
    return activities.every((id) => data.find((activity) => activity.id === id)?.status === "closed");
  }, { timeout: 30_000 }).toBe(true);
  const unread = await page.request.get("/api/announcements/unread");
  expect(unread.status()).toBe(200);
  for (const announcement of (await unread.json()).data as Array<{ id: number }>) {
    expect((await page.request.post(`/api/announcements/${announcement.id}/read`)).status()).toBe(200);
  }
});

test("create a developer key and only reveal its secrets once", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/developer");
  await page.getByRole("button", { name: "创建密钥", exact: true }).click();
  await expect(page.getByTestId("new-api-secret")).toContainText("sk_");
  await expect(page.getByTestId("new-webhook-secret")).toContainText("whsec_");
  const appSecret = await page.getByTestId("new-api-secret").textContent();
  const webhookSecret = await page.getByTestId("new-webhook-secret").textContent();
  await page.getByRole("button", { name: "复制 App Secret", exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(appSecret);
  await page.getByRole("button", { name: "复制 Webhook Secret", exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(webhookSecret);
  await expect(page.getByText("sk_****", { exact: false })).toBeVisible();
  const row = page.locator(".transaction-row").filter({ hasText: "sk_****" });
  await expect(row.getByLabel("读取卡产品", { exact: true })).toBeChecked();
  await expect(row.locator('input[name="scopes"]')).toHaveCount(15);
  await expect(row.getByLabel("读取账户余额", { exact: true })).not.toBeChecked();
  await expect(row.getByLabel("创建卡片", { exact: true })).not.toBeChecked();
  await expect(row.getByLabel("卡片充值", { exact: true })).not.toBeChecked();
  await expect(row.getByLabel("每分钟请求上限", { exact: true })).toHaveValue("120");
  await expect(row.getByLabel("每日请求上限", { exact: true })).toHaveValue("10000");
  await row.getByLabel("密钥名称").fill("Settlement API");
  await row.getByLabel("创建卡片", { exact: true }).check();
  await row.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("必须配置 IP 或 CIDR 白名单");
  await row.getByLabel("IP 白名单", { exact: true }).fill("127.0.0.1/32");
  await row.getByLabel("每分钟请求上限", { exact: true }).fill("60");
  await row.getByLabel("每日请求上限", { exact: true }).fill("5000");
  await row.getByRole("button", { name: "保存", exact: true }).click();
  await expect(row.getByLabel("密钥名称")).toHaveValue("Settlement API");
  await expect(row.getByLabel("创建卡片", { exact: true })).toBeChecked();
  await expect(row.getByLabel("IP 白名单", { exact: true })).toHaveValue("127.0.0.1/32");
  await expect(row.getByLabel("每分钟请求上限", { exact: true })).toHaveValue("60");
  await expect(row.getByLabel("每日请求上限", { exact: true })).toHaveValue("5000");
  await row.getByRole("button", { name: "删除", exact: true }).click();
  await expect(page.getByText("暂无 API 密钥", { exact: true })).toBeVisible();
});

test("creating a developer key after the recent-auth window expires sends the customer back through login", async ({ page }) => {
  await mockAuthenticatedShell(page, "customer");
  await page.route("**/api/developer/keys", (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({
        status: 403,
        json: { error: "请重新认证后继续敏感操作", errorCode: "RECENT_AUTH_REQUIRED" },
      });
    }
    return route.fulfill({ json: { code: 0, data: [] } });
  });
  await page.route("**/api/auth/captcha", (route) => route.fulfill({ json: { code: 0, data: {
    required: false, id: null, image: null, expiresIn: 0,
  } } }));
  await page.route("**/api/auth/login", (route) => route.fulfill({ json: {
    token: "recent-auth-token", email: "admin@danewcard.local", role: "customer", mfaLevel: "password",
  } }));
  await page.goto("/developer");
  await expect(page.getByRole("button", { name: "创建密钥", exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "创建密钥", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("recentAuthReturnPath"))).toBe("/developer");
  await page.getByPlaceholder("your@email.com").fill("admin@danewcard.local");
  await page.getByPlaceholder("8+").fill("Admin123!Secure");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/developer$/);
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("recentAuthReturnPath"))).toBeNull();
});

test("developer guide documents authentication, money retries, polling, and security", async ({ page }) => {
  await page.goto("/developer");
  const guide = page.locator(".developer-guide");
  await expect(guide.getByRole("heading", { name: "开发者接入指南", exact: true })).toBeVisible();
  await expect(guide).toContainText("X-App-Id");
  await expect(guide).toContainText("$BASE_URL/cards/open");
  await expect(guide).toContainText("GET /operations/{id}");
  await expect(guide).toContainText("POST /deposits");
  await expect(guide).toContainText("Idempotency-Key");
  await expect(guide).toContainText("202");
  await expect(guide).toContainText("HMAC-SHA256");
  await expect(guide).toContainText("独立 Webhook Secret");
  await expect(guide).toContainText("不要使用 App Secret");
  await expect(guide).not.toContainText("SHA-256(APP SECRET)");
  await expect(guide).toContainText("X-Avanfinity-Webhook-Id");
  await expect(guide).toContainText("2/4/8/16 秒");
  await expect(guide).not.toContainText("当前版本没有下游 Webhook");
  await guide.getByText("curl", { exact: true }).click();
  await expect(guide.locator("pre").first()).toContainText("X-App-Secret");
  await expect(guide.locator("pre").first()).toContainText('Idempotency-Key: $OPEN_IDEMPOTENCY_KEY');
  await expect(page.getByRole("link", { name: "完整 API 文档 / OpenAPI" }).first()).toHaveAttribute("href", "#api-reference");
});

test("OpenAPI browser discovers every operation with searchable human-readable details", async ({ page }) => {
  await page.goto("/developer");
  const reference = page.getByTestId("openapi-browser");
  await expect(reference.getByRole("heading", { name: "完整 API 参考", exact: true })).toBeVisible();
  await expect(reference.locator("[data-operation-id]" )).toHaveCount(36);
  await expect(reference.getByText("显示 36 / 36 个接口", { exact: true })).toBeVisible();

  const openCard = reference.locator('[data-operation-id="openCard"]');
  await openCard.locator(":scope > summary").click();
  await expect(openCard).toHaveAttribute("open", "");
  await expect(openCard).toContainText("cards:open");
  await expect(openCard).toContainText("Idempotency-Key");
  await expect(openCard).toContainText('"productCode"');
  await expect(openCard).toContainText('"Ada"');
  for (const status of ["200", "202", "409"]) await expect(openCard.locator(".openapi-response-contract > summary > code", { hasText: status })).toBeVisible();
  const successResponse = openCard.locator(".openapi-response-contract.is-success").first();
  await expect(successResponse).toContainText('"operationId"');
  await expect(successResponse).toContainText('"00000000-0000-4000-8000-000000000001"');

  const cardDetail = reference.locator('[data-operation-id="getCard"]');
  await cardDetail.locator(":scope > summary").click();
  await expect(cardDetail.locator("tbody tr").filter({ hasText: "id" })).toContainText("path");
  const cardsList = reference.locator('[data-operation-id="listCards"]');
  await cardsList.locator(":scope > summary").click();
  await expect(cardsList.locator("tbody tr").filter({ hasText: "page" }).first()).toContainText("query");

  const createDeposit = reference.locator('[data-operation-id="createWalletDeposit"]');
  await createDeposit.locator(":scope > summary").click();
  await expect(createDeposit).toContainText("deposits:create");
  await expect(createDeposit).toContainText("Idempotency-Key");
  await expect(createDeposit).toContainText('"expectedAmount"');

  await expect(reference.getByText("X-Avanfinity-Webhook-Id", { exact: true })).toBeVisible();
  await expect(reference.getByText("X-Avanfinity-Webhook-Timestamp", { exact: true })).toBeVisible();
  await expect(reference.getByText("X-Avanfinity-Signature", { exact: true })).toBeVisible();
  await expect(reference.locator(".openapi-webhook-event")).toHaveCount(23);
  const cardWebhook = reference.locator('[data-webhook-event="card.open.updated"]');
  await cardWebhook.locator(":scope > summary").click();
  await expect(cardWebhook).toContainText('"operationId"');
  await expect(cardWebhook).toContainText('"data"');
  await expect(reference).toContainText("2/4/8/16 秒");
  await expect(reference.getByRole("link", { name: "下载原始 OpenAPI", exact: true })).toHaveAttribute("href", "/api/v1/openapi.json");

  await reference.getByLabel("搜索接口", { exact: true }).fill("openCard");
  await expect(reference.locator("[data-operation-id]")).toHaveCount(1);
  await expect(reference.locator('[data-operation-id="openCard"]')).toBeVisible();
  await reference.getByLabel("搜索接口", { exact: true }).fill("");
  await reference.getByRole("combobox", { name: "接口分类", exact: true }).selectOption("OpenAI CDK");
  await expect(reference.locator("[data-operation-id]")).toHaveCount(9);
  await expect(reference.locator('[data-operation-id="redeemPublicCdk"]')).toBeVisible();
  await reference.getByRole("combobox", { name: "接口分类", exact: true }).selectOption("");

  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(reference.getByRole("heading", { name: "Complete API reference", exact: true })).toBeVisible();
  await expect(reference.getByLabel("Search operations", { exact: true })).toBeVisible();
  await expect(reference.getByText("Showing 36 of 36 operations", { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("developer manages all scopes, Webhook URL, delivery tests, and DEAD retries", async ({ page }) => {
  const key = {
    id: 71, appId: "app_webhook_test", appSecretMasked: "sk_****ABCD", name: "Webhook API", status: "active",
    ipWhitelist: "", webhookUrl: "", webhookSecretReady: true, scopes: ["products:read"], minuteLimit: 120, dailyLimit: 10000,
    createdAt: "2026-08-07T08:00:00Z",
  };
  const deliveries = [{
    id: "evt_dead_1", apiKeyId: 71, eventType: "card.recharge.failed", status: "DEAD", attempts: 5,
    lastHttpStatus: 500, lastError: "receiver returned HTTP 500", createdAt: "2026-08-07T08:01:00Z",
    updatedAt: "2026-08-07T08:01:10Z", deliveredAt: null,
  }, {
    id: "evt_delivered_2", apiKeyId: 71, eventType: "money.operation.succeeded", status: "DELIVERED", attempts: 1,
    lastHttpStatus: 204, lastError: null, createdAt: "2026-08-07T08:02:00Z",
    updatedAt: "2026-08-07T08:02:01Z", deliveredAt: "2026-08-07T08:02:01Z",
  }];
  let savedBody: Record<string, unknown> | null = null;
  let testBody: Record<string, unknown> | null = null;
  let retryBody: Record<string, unknown> | null = null;

  await page.route("**/api/developer/keys", async (route) => {
    if (route.request().method() === "PATCH") {
      savedBody = route.request().postDataJSON() as Record<string, unknown>;
      if (savedBody.rotateWebhookSecret === true) {
        return route.fulfill({ json: { code: 0, msg: "ok", data: { webhookSecret: `whsec_${"2".repeat(64)}` } } });
      }
      Object.assign(key, savedBody);
      return route.fulfill({ json: { code: 0, msg: "ok" } });
    }
    return route.fulfill({ json: { code: 0, data: [key] } });
  });
  await page.route("**/api/developer/webhooks/deliveries?**", (route) => route.fulfill({ json: { code: 0, data: {
    total: deliveries.length, page: 1, pageSize: 20, list: deliveries,
  } } }));
  await page.route("**/api/developer/webhooks/test", (route) => {
    testBody = route.request().postDataJSON() as Record<string, unknown>;
    return route.fulfill({ json: { code: 0, data: { deliveryId: "evt_test_3" } } });
  });
  await page.route("**/api/developer/webhooks/retry", (route) => {
    retryBody = route.request().postDataJSON() as Record<string, unknown>;
    deliveries[0].status = "PENDING";
    deliveries[0].attempts = 0;
    deliveries[0].lastHttpStatus = null;
    deliveries[0].lastError = null;
    return route.fulfill({ json: { code: 0, data: { deliveryId: "evt_dead_1" } } });
  });

  await page.goto("/developer");
  const row = page.locator(".developer-key-form");
  const scopeLabels = [
    "读取卡产品", "读取账户余额", "读取卡片与交易", "读取卡片安全信息", "管理卡片状态", "创建卡片",
    "卡片充值", "读取 OpenAI 套餐与订单", "提交 OpenAI 直充", "读取 CDK 与报价", "生成 CDK", "读取资金操作",
    "创建钱包充值订单",
  ];
  for (const label of scopeLabels) await expect(row.getByLabel(label, { exact: true })).toBeVisible();

  await row.getByLabel("读取 OpenAI 套餐与订单", { exact: true }).check();
  await row.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => (savedBody?.scopes as string[] | undefined)?.includes("gpt:read")).toBe(true);
  await expect(page.getByRole("alert")).toHaveCount(0);

  await row.getByLabel("提交 OpenAI 直充", { exact: true }).check();
  await row.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("必须配置 IP 或 CIDR 白名单");
  await row.getByLabel("IP 白名单", { exact: true }).fill("203.0.113.10/32");
  await row.getByLabel("Webhook URL", { exact: true }).fill("https://hooks.example.com:443/avanfinity");
  await row.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => savedBody?.webhookUrl).toBe("https://hooks.example.com:443/avanfinity");
  await expect.poll(() => savedBody?.ipWhitelist).toBe("203.0.113.10/32");

  page.once("dialog", (dialog) => dialog.accept());
  await row.getByRole("button", { name: "轮换 Webhook Secret", exact: true }).click();
  await expect.poll(() => savedBody?.rotateWebhookSecret).toBe(true);
  await expect(page.getByTestId("new-webhook-secret")).toHaveText(`whsec_${"2".repeat(64)}`);
  await expect(page.getByTestId("new-api-secret")).toHaveCount(0);

  const webhookPanel = page.locator(".developer-webhooks");
  await expect(webhookPanel.getByText("card.recharge.failed", { exact: true })).toBeVisible();
  await expect(webhookPanel.getByText("已停止重试", { exact: true })).toBeVisible();
  await expect(webhookPanel.getByText("receiver returned HTTP 500", { exact: true })).toBeVisible();
  await expect(webhookPanel.getByText("204", { exact: true })).toBeVisible();
  await webhookPanel.getByRole("button", { name: "发送测试事件", exact: true }).click();
  await expect.poll(() => testBody).toEqual({ apiKeyId: 71 });
  await webhookPanel.getByRole("button", { name: "重试投递 evt_dead_1", exact: true }).click();
  await expect.poll(() => retryBody).toEqual({ deliveryId: "evt_dead_1" });
  await expect(webhookPanel.getByText("等待投递", { exact: true })).toBeVisible();

  key.webhookSecretReady = false;
  await page.reload();
  await expect(page.getByText("此存量密钥的 Webhook 投递已安全暂停，请先轮换 Webhook Secret。", { exact: true })).toBeVisible();
  await expect(page.locator(".developer-webhooks").getByRole("button", { name: "发送测试事件", exact: true })).toBeDisabled();
});

test("developer Webhook test event reaches a real receiver with a valid signature", async ({ page }) => {
  const received: Array<{ headers: Record<string, string | string[] | undefined>; body: Buffer }> = [];
  const receiver = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      received.push({ headers: request.headers, body: Buffer.concat(chunks) });
      response.writeHead(204).end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    receiver.once("error", reject);
    receiver.listen(0, "127.0.0.1", () => { receiver.off("error", reject); resolve(); });
  });
  let keyId: number | undefined;
  try {
    const address = receiver.address();
    if (!address || typeof address === "string") throw new Error("Webhook receiver did not bind a TCP port");
    const created = await page.request.post("/api/developer/keys", { data: { name: "Real Webhook E2E" } });
    expect(created.status()).toBe(200);
    const webhookSecret = (await created.json()).data.webhookSecret as string;
    const keysResponse = await page.request.get("/api/developer/keys");
    expect(keysResponse.status()).toBe(200);
    const key = ((await keysResponse.json()).data as Array<{
      id: number; name: string; status: string; scopes: string[]; minuteLimit: number; dailyLimit: number;
    }>).find((item) => item.name === "Real Webhook E2E");
    expect(key).toBeTruthy();
    keyId = key!.id;
    const webhookUrl = `http://127.0.0.1:${address.port}/events`;
    const updated = await page.request.patch("/api/developer/keys", { data: {
      id: keyId, name: key!.name, status: key!.status, ipWhitelist: "", webhookUrl,
      scopes: key!.scopes, minuteLimit: key!.minuteLimit, dailyLimit: key!.dailyLimit,
    } });
    expect(updated.status()).toBe(200);
    const queued = await page.request.post("/api/developer/webhooks/test", { data: { apiKeyId: keyId } });
    expect(queued.status()).toBe(200);
    const deliveryId = (await queued.json()).data.deliveryId as string;
    await expect.poll(async () => {
      const response = await page.request.get(`/api/developer/webhooks/deliveries?apiKeyId=${keyId}&page=1&pageSize=20`);
      expect(response.status()).toBe(200);
      const list = (await response.json()).data.list as Array<{ id: string; status: string }>;
      return list.find((delivery) => delivery.id === deliveryId)?.status;
    }, { timeout: 10_000 }).toBe("DELIVERED");
    await expect.poll(() => received.length).toBe(1);

    const webhook = received[0];
    const eventId = String(webhook.headers["x-avanfinity-webhook-id"]);
    const timestamp = String(webhook.headers["x-avanfinity-webhook-timestamp"]);
    const signature = String(webhook.headers["x-avanfinity-signature"]);
    const expected = `v1=${createHmac("sha256", webhookSecret).update(timestamp).update(".").update(webhook.body).digest("hex")}`;
    expect(signature).toBe(expected);
    const payload = JSON.parse(webhook.body.toString("utf8")) as { id: string; type: string };
    expect(payload).toMatchObject({ id: eventId, type: "webhook.test" });
    expect(webhook.body.toString("utf8")).not.toContain(webhookSecret);
  } finally {
    if (keyId !== undefined) await page.request.delete(`/api/developer/keys?id=${keyId}`);
    await new Promise<void>((resolve) => receiver.close(() => resolve()));
  }
});

test("market page shows only anonymous confirmed OpenAI payment references", async ({ page }) => {
  await mockAuthenticatedShell(page, "customer");
  await page.route("**/api/openai-prices", (route) => route.fulfill({ json: { code: 0, data: {
    references: [
      { bin6: "424242", type: "openai_direct", plan: "plus", priceMajor: "982.14", currency: "PHP", estimatedUsd: "15.99906060", completedAt: "2026-08-01T00:20:53Z" },
      { bin6: null, type: "openai_direct", plan: "pro_5x", priceMajor: "150", currency: "USD", completedAt: "2026-07-31T00:20:53Z" },
    ],
    binStats: [{
      bin6: "424242",
      overall: { attempts: 4, successes: 3, declines: 1, successRateBps: 7500, declineRateBps: 2500 },
      plans: [
        { plan: "plus", attempts: 2, successes: 1, declines: 1, successRateBps: 5000, declineRateBps: 5000, latestSuccess: { type: "openai_direct", plan: "plus", priceMajor: "982.14", currency: "PHP", estimatedUsd: "15.99906060", completedAt: "2026-08-01T00:20:53Z" } },
        { plan: "pro_5x", attempts: 2, successes: 2, declines: 0, successRateBps: 10000, declineRateBps: 0, latestSuccess: { type: "openai_direct", plan: "pro_5x", priceMajor: "150", currency: "USD", completedAt: "2026-07-31T00:20:53Z" } },
      ],
    }],
  } } }));
  await page.goto("/openai-prices");
  await expect(page.getByRole("heading", { name: "OpenAI 支付参考", exact: true })).toBeVisible();
  await expect(page.locator(".market-context-panel")).toContainText("2");
  await expect(page.locator(".market-grid").getByRole("heading", { name: "卡头 424242", exact: true })).toBeVisible();
  await expect(page.locator(".market-grid").getByRole("heading", { name: "卡头 历史未采集", exact: true })).toBeVisible();
  await expect(page.locator(".market-grid")).toContainText("PHP 982.14");
  await expect(page.getByText(/约 \$16\.00 USD/)).toBeVisible();
  await expect(page.getByText("成功类型：Plus", { exact: true })).toBeVisible();
  await expect(page.locator(".market-context-panel")).toContainText("2026");
  await expect(page.locator(".market-grid")).not.toContainText("4242 ••••");
  await expect(page.getByTestId("market-payment-performance")).toContainText("成功率 75% · 拒付率 25% · 4 笔");
  await expect(page.getByTestId("market-payment-performance")).toContainText("拒付率 0% · 0/2");
  await expect(page.getByTestId("market-payment-performance")).not.toContainText("customer@example.com");
  await expect(page.locator(".market-disclaimer")).toContainText("不是实时行情或成功保证");
});

test("admin dashboard lists users and writes an audited adjustment", async ({ page, request }) => {
  const email = `admin-target-${Date.now()}@example.com`;
  expect((await request.post("/api/auth/register", {
    data: { email, password: "StrongRegister123!" },
  })).status()).toBe(200);
  await page.goto("/admin");
  await expect(page.getByText("管理控制台", { exact: true })).toBeVisible();
  await page.getByTestId("admin-nav-customers").click();
  const recipient = page.locator(".transaction-row").filter({ hasText: email });
  await expect(recipient).toBeVisible();
  await recipient.getByRole("button", { name: "查看详情", exact: true }).click();
  const detail = page.getByTestId("admin-customer-detail");
  const funds = page.getByTestId("admin-customer-funds");
  const balance = funds.locator("dt", { hasText: /^总余额$/ }).locator("..").locator("dd");
  const before = Number((await balance.textContent())?.replace("$", ""));
  await funds.getByLabel("调整金额", { exact: true }).fill("1");
  await funds.getByLabel("调账备注", { exact: true }).fill("E2E verified customer adjustment");
  await funds.getByRole("button", { name: "确认调账", exact: true }).click();
  await expect.poll(async () => Number((await balance.textContent())?.replace("$", ""))).toBe(before + 1);
  const editor = page.getByTestId("admin-customer-management").locator(".admin-customer-editor");
  await editor.getByRole("button", { name: "停用", exact: true }).click();
  await expect(detail.locator(".admin-customer-detail-profile .status-pill")).toHaveText("已停用");
  await expect(detail.locator(".admin-customer-detail-profile .status-pill")).toHaveAttribute("data-status", "suspended");
});

test("announcements persist per user until they are acknowledged", async ({ page, browser }) => {
  const stamp = Date.now();
  const email = `announcement-${stamp}@example.com`;
  const password = "StrongRegister123!";
  const title = `公告验收 ${stamp}`;
  const content = "第一行\n<img src=x onerror=\"globalThis.__announcementXss=1\">\n<script>globalThis.__announcementXss=1</script>";
  const baseURL = new URL(page.url()).origin;
  const customerContext = await browser.newContext({ baseURL });
  const customer = await customerContext.newPage();
  const onlineContext = await browser.newContext({ baseURL });
  const online = await onlineContext.newPage();
  await online.clock.install();
  let announcementId: number | undefined;
  let boundaryId: number | undefined;

  try {
    expect((await customerContext.request.post("/api/auth/register", {
      data: { email, password },
    })).status()).toBe(200);
    expect((await customerContext.request.get("/api/announcements/unread")).status()).toBe(401);
    expect((await customerContext.request.get("/api/announcements")).status()).toBe(401);
    expect((await customerContext.request.get("/api/admin/announcements")).status()).toBe(401);
    const onlineEmail = `announcement-online-${stamp}@example.com`;
    expect((await onlineContext.request.post("/api/auth/register", {
      data: { email: onlineEmail, password },
    })).status()).toBe(200);
    await online.goto("/login");
    await online.getByPlaceholder("your@email.com").fill(onlineEmail);
    await online.getByPlaceholder("8+").fill(password);
    await online.getByRole("button", { name: "登录", exact: true }).click();
    await expect(online).toHaveURL(/\/dashboard$/);
    await expect(online.getByRole("dialog")).toHaveCount(0);

    await page.goto("/admin");
    await page.getByTestId("admin-nav-announcements").click();
    await page.getByLabel("公告标题", { exact: true }).fill(title);
    await page.getByLabel("公告内容", { exact: true }).fill(content);
    const published = page.waitForResponse((response) => response.url().endsWith("/api/admin/announcements")
      && response.request().method() === "POST");
    await page.getByRole("button", { name: "发送公告", exact: true }).click();
    const publishedResponse = await published;
    const publishedBody = await publishedResponse.json();
    expect(publishedResponse.status(), JSON.stringify(publishedBody)).toBe(200);
    announcementId = publishedBody.data.id;
    await expect(page.getByRole("dialog")).toContainText(title);
    await page.getByRole("button", { name: "我知道了", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await online.clock.fastForward(30_001);
    await expect(online.getByRole("dialog")).toContainText(title);
    await online.getByRole("button", { name: "我知道了", exact: true }).click();
    await expect(online.getByRole("dialog")).toHaveCount(0);

    await customer.goto("/login");
    await customer.getByPlaceholder("your@email.com").fill(email);
    await customer.getByPlaceholder("8+").fill(password);
    await customer.getByRole("button", { name: "登录", exact: true }).click();
    const dialog = customer.getByRole("dialog");
    await expect(dialog).toContainText(title);
    await expect(customer.locator(".sidebar-badge")).toHaveText("1");
    await expect(dialog).toContainText(content);
    await expect(dialog.locator("img, script")).toHaveCount(0);
    expect(await customer.evaluate(() => (globalThis as typeof globalThis & { __announcementXss?: number }).__announcementXss)).toBeUndefined();

    await dialog.getByRole("button", { name: "下次登录提醒", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await customer.getByRole("button", { name: "退出", exact: true }).click();
    await customer.getByPlaceholder("your@email.com").fill(email);
    await customer.getByPlaceholder("8+").fill(password);
    await customer.getByRole("button", { name: "登录", exact: true }).click();
    await expect(customer.getByRole("dialog")).toContainText(title);
    await customer.getByRole("button", { name: "我知道了", exact: true }).click();
    await expect(customer.getByRole("dialog")).toHaveCount(0);
    await expect(customer.locator(".sidebar-badge")).toHaveCount(0);

    const repeatedReads = await Promise.all(Array.from({ length: 12 }, () =>
      customerContext.request.post(`/api/announcements/${announcementId}/read`)));
    expect(repeatedReads.every((response) => response.status() === 200)).toBe(true);
    const unread = await customerContext.request.get("/api/announcements/unread");
    expect(unread.status()).toBe(200);
    expect((await unread.json()).data.map((item: { id: number }) => item.id)).not.toContain(announcementId);
    await customer.goto("/announcements");
    const customerAnnouncement = customer.locator(".announcement-history-row").filter({ hasText: title });
    await expect(customerAnnouncement).toBeVisible();
    await expect(customerAnnouncement).toContainText("已读");
    expect((await customerContext.request.post("/api/admin/announcements", {
      data: { action: "create", title: "forbidden", content: "forbidden" },
    })).status()).toBe(403);
    expect((await customerContext.request.get("/api/admin/announcements")).status()).toBe(403);

    const adminAnnouncement = page.locator(".announcement-admin-row").filter({ hasText: title });
    await expect(adminAnnouncement).toBeVisible();
    page.once("dialog", (dialog) => dialog.accept());
    await adminAnnouncement.getByRole("button", { name: "撤回", exact: true }).click();
    await expect(adminAnnouncement).toContainText("已撤回");
    await customer.reload();
    await expect(customer.locator(".announcement-history-row").filter({ hasText: title })).toHaveCount(0);
    expect((await customerContext.request.post(`/api/announcements/${announcementId}/read`)).status()).toBe(404);

    const boundary = await page.request.post("/api/admin/announcements", {
      headers: { "idempotency-key": `announcement-boundary-${stamp}` },
      data: { action: "create", title: "中".repeat(120), content: "ok", isActive: false },
    });
    const boundaryBody = await boundary.json();
    expect(boundary.status(), JSON.stringify(boundaryBody)).toBe(200);
    boundaryId = boundaryBody.data.id;
    expect((await page.request.post("/api/admin/announcements", {
      headers: { "idempotency-key": `announcement-overflow-${stamp}` },
      data: { action: "create", title: "中".repeat(121), content: "ok", isActive: false },
    })).status()).toBe(400);
    expect((await page.request.post("/api/admin/announcements", {
      data: { action: "update", id: boundaryId, title: "边界公告已更新" },
    })).status()).toBe(200);
    expect((await page.request.post("/api/admin/announcements", {
      data: { action: "delete", id: boundaryId },
    })).status()).toBe(200);
    boundaryId = undefined;
    const audit = await page.request.get("/api/admin/audit-logs?pageSize=100&targetType=announcement");
    expect(audit.status()).toBe(200);
    const auditActions = (await audit.json()).data.list.map((item: { action: string }) => item.action);
    expect(auditActions).toEqual(expect.arrayContaining([
      "publish_announcement", "create_announcement", "update_announcement", "withdraw_announcement", "delete_announcement",
    ]));
  } finally {
    for (const id of [announcementId, boundaryId]) {
      if (id) await page.request.post("/api/admin/announcements", { data: { action: "delete", id } });
    }
    await customerContext.close();
    await onlineContext.close();
  }
});

test("admin workspace switches upstream, cost, and card panels without a reload", async ({ page }) => {
  const depositRequests: string[] = [];
  await mockAuthenticatedShell(page);
  await mockAdminWorkspace(page, { onAdminDepositsRequest: (url) => depositRequests.push(url) });
  await page.goto("/admin");
  const documentProbe = await page.evaluate(() => {
    document.documentElement.dataset.adminDocument = crypto.randomUUID();
    return document.documentElement.dataset.adminDocument;
  });
  const nav = page.getByTestId("admin-local-nav");
  const navProbe = await nav.evaluate((element) => {
    element.dataset.instance = crypto.randomUUID();
    return element.dataset.instance;
  });
  await expect(page.getByTestId("admin-overview-upstream")).toContainText("SpaceX Card");
  await expect(page.getByTestId("admin-overview-upstream")).not.toContainText("Future Provider");
  const overviewMetrics = page.locator(".admin-metric-grid");
  await expect(overviewMetrics).toContainText("客户累计入账");
  await expect(overviewMetrics).toContainText("USDT 20.127937");
  await expect(overviewMetrics).toContainText("2 笔已确认到账");
  await expect(overviewMetrics).toContainText("链上确认实收");
  await expect(overviewMetrics).toContainText("待确认充值");
  await expect(overviewMetrics).toContainText("USDT 7.000321");

  await page.getByTestId("admin-nav-upstreams").click();
  await expect(page.getByTestId("admin-panel-upstreams")).toBeVisible();
  const spacex = page.getByTestId("upstream-spacex");
  await expect(spacex).toContainText("SpaceX Card");
  await expect(spacex).toContainText("sha256:abcd1234ef56");
  await expect(spacex).toContainText("v1");
  await expect(spacex.getByRole("button", { name: "同步产品", exact: true })).toBeVisible();
  await spacex.getByRole("button", { name: "保存卡台设置", exact: true }).click();
  await expect(page.getByText("上游卡台设置已保存", { exact: true })).toBeVisible();
  await spacex.getByRole("button", { name: "测试连接", exact: true }).click();
  await expect(page.getByText("连接验证成功", { exact: true })).toBeVisible();
  const inactive = page.getByTestId("upstream-future");
  await expect(inactive).toContainText("非当前运行时");
  await expect(inactive).toContainText("切换部署配置");
  await expect(inactive.getByRole("button", { name: "测试连接", exact: true })).toBeDisabled();
  await expect(inactive.getByRole("button", { name: "同步产品", exact: true })).toBeDisabled();

  await page.getByTestId("admin-nav-costs").click();
  await expect(page.getByTestId("admin-panel-costs")).toBeVisible();
  await expect(page.getByTestId("admin-panel-costs")).toContainText("卡充值直接成本率（不含资金费）");
  await expect(page.getByTestId("admin-panel-costs")).toContainText("上游账户补充资金费计入净成本与返利预估");
  const product = page.getByTestId("admin-product-P5378OX");
  await expect(product).toContainText("$0.4");
  await expect(product).toContainText("0.5%");
  await expect(product).toContainText("10%");
  await expect(product).toContainText("Google / ChatGPT 禁止交易");
  await expect(product).toContainText("受限商户: CRYPTO_EXCHANGE");
  await expect(product.getByRole("button", { name: "配置等级覆盖", exact: true })).toBeVisible();

  await page.getByTestId("admin-nav-tiers").click();
  const standardTier = page.getByTestId("pricing-tier-none");
  await expect(standardTier.getByLabel("上游充值费率倍率", { exact: true })).toBeVisible();
  await expect(standardTier.getByLabel("本站保底充值费率", { exact: true })).toBeVisible();
  await expect(standardTier).toContainText("充值定价下限会同时计入卡产品直接充值成本和上游账户补充资金费");

  await page.getByTestId("admin-nav-cards").click();
  const cardsTable = page.getByTestId("admin-cards-table");
  await expect(cardsTable).toContainText("4242 **** **** 9090");
  await expect(cardsTable).toContainText("spacex");
  await expect(cardsTable).toContainText("等待到账");
  await expect(cardsTable).not.toContainText("4242000000009090");
  await page.getByTestId("admin-nav-funds").click();
  const depositOrders = page.getByTestId("admin-deposit-orders");
  const depositTable = page.getByTestId("admin-deposit-table");
  await expect(depositTable).toContainText("pending@example.com");
  await expect(depositTable).toContainText("申请金额: 10");
  await expect(depositTable).toContainText("应付金额: 10.0345");
  await expect(depositTable).toContainText(/剩余 00:09:\d{2}/);
  await expect(depositTable).toContainText(/迟到账核对剩余 00:29:\d{2}/);
  const cancelledDeposit = depositTable.getByRole("row").filter({ hasText: "cancelled@example.com" });
  await expect(cancelledDeposit).toContainText("已取消");
  await expect(cancelledDeposit).not.toContainText("迟到账核对");
  await expect(cancelledDeposit).not.toContainText("核对至");
  await expect(depositTable).toContainText("实收金额: 20.1279");
  await expect(depositTable).toContainText("入账金额: 20.1279");
  await expect(depositOrders).not.toContainText("SENSITIVE-WALLET-ADDRESS");
  await expect(depositOrders).not.toContainText("SENSITIVE-FULL-TRANSACTION-HASH");
  const initialDepositRequests = depositRequests.length;
  await expect.poll(() => depositRequests.length, { timeout: 7_000 }).toBeGreaterThan(initialDepositRequests);

  const depositPage2 = page.waitForRequest((request) => request.url().includes("/api/admin/deposits?") && request.url().includes("page=2"));
  await depositOrders.getByRole("button", { name: "下一页", exact: true }).click();
  await depositPage2;
  await expect(depositOrders.locator(".admin-pagination")).toContainText("2");
  const depositFilter = page.getByTestId("admin-deposit-filter");
  await depositFilter.locator('input[name="q"]').fill("pending@example.com");
  await depositFilter.locator('select[name="network"]').selectOption("SOL");
  await depositFilter.locator('select[name="status"]').selectOption("pending");
  const filteredDeposits = page.waitForRequest((request) => request.url().includes("/api/admin/deposits?")
    && request.url().includes("q=pending%40example.com") && request.url().includes("network=SOL")
    && request.url().includes("status=pending") && request.url().includes("page=1"));
  await depositFilter.getByRole("button", { name: "筛选", exact: true }).click();
  await filteredDeposits;
  await expect(depositTable).toContainText("pending@example.com");
  await expect(depositTable).not.toContainText("late@example.com");

  const moneyTable = page.getByTestId("admin-money-table");
  await expect(moneyTable.getByText("SUCCEEDED", { exact: true })).toHaveClass(/is-active/);
  await expect(moneyTable).toContainText("CONFIRMED");
  await expect(moneyTable).toContainText("upstream-business-123");
  await expect(moneyTable).toContainText("4242 **** **** 9090");
  await moneyTable.getByText("查看快照", { exact: true }).click();
  await expect(moneyTable).toContainText('"tier":"none"');
  const financialTable = page.getByTestId("admin-financial-events-table");
  await expect(financialTable).toContainText("wallet");
  await expect(financialTable).toContainText("100 → 89.5");
  const balanceLogTable = page.getByTestId("admin-balance-log-table");
  await expect(balanceLogTable).toContainText("Opening P5378OX · card •••• 9090");
  await expect(balanceLogTable).toContainText("00000000");
  const filterForm = page.locator(".admin-panel-heading form.admin-filter-bar");
  await filterForm.locator('select[name="status"]').selectOption("SUCCEEDED");
  await filterForm.locator('select[name="type"]').selectOption("OPEN_CARD");
  const filteredRequest = page.waitForRequest((request) => request.url().includes("/api/admin/money-operations?")
    && request.url().includes("status=SUCCEEDED") && request.url().includes("type=OPEN_CARD"));
  await filterForm.getByRole("button", { name: "筛选", exact: true }).click();
  await filteredRequest;
  await page.getByTestId("admin-nav-audit").click();
  await expect(page.getByTestId("admin-audit-table")).toContainText("sync_products");
  await expect(page.getByTestId("admin-audit-table")).toContainText("spacex");
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.locator("html")).toHaveAttribute("data-admin-document", documentProbe);
  await expect(nav).toHaveAttribute("data-instance", navProbe);
});

test("admin manually confirms a deposit once and hides terminal actions", async ({ page }) => {
  await mockAuthenticatedShell(page);
  await mockAdminWorkspace(page);
  await page.goto("/admin");
  await page.getByTestId("admin-nav-funds").click();
  const table = page.getByTestId("admin-deposit-table");
  const cancelled = table.getByRole("row").filter({ hasText: "cancelled@example.com" });
  await expect(cancelled.getByRole("button", { name: "手动到账", exact: true })).toHaveCount(0);
  const late = table.getByRole("row").filter({ hasText: "late@example.com" });
  page.once("dialog", (dialog) => dialog.accept());
  await late.getByRole("button", { name: "手动到账", exact: true }).click();
  await expect(page.getByText("手动到账成功，已入账 12.0182 USDT。", { exact: true })).toBeVisible();
  await expect(late).toContainText("已到账");
  await expect(late).toContainText("入账金额: 12.0182");
  await expect(late.getByRole("button", { name: "手动到账", exact: true })).toHaveCount(0);
});

test("admin funds explains GPT Direct progress and failure evidence", async ({ page }) => {
  await mockAuthenticatedShell(page);
  await mockAdminWorkspace(page, { gptMoneyOperation: true });
  await page.goto("/admin");
  await page.getByTestId("admin-nav-funds").click();

  const diagnostics = page.getByTestId("admin-gpt-operation-00000000-0000-0000-0000-000000000081");
  await expect(diagnostics).toContainText("已拒绝 · 确认扣款");
  await expect(diagnostics).toContainText("发卡行拒绝本次扣款，服务费已释放。");
  await expect(diagnostics).toContainText("10000000-0000-0000-0000-000000000081");
  await expect(diagnostics).toContainText("错误码: card_declined");
  await diagnostics.getByText("最近生命周期事件（1）", { exact: true }).click();
  await expect(diagnostics).toContainText("card_declined");
  await expect(diagnostics).toContainText("服务费状态");
  await expect(diagnostics).toContainText("released");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("admin manages Telegram health, groups, and lottery publishing without exposing credentials", async ({ page }) => {
  const commands: Array<{ body: Record<string, unknown>; key: string }> = [];
  const announcements: Array<{ body: Record<string, unknown>; key: string }> = [];
  let announcementAttempts = 0;
  const credentialCanary = "telegram-secret-must-not-render";
  await mockAuthenticatedShell(page);
  await mockAdminWorkspace(page, {
    onTelegramCommand: (body, key) => commands.push({ body, key }),
    onAdminAnnouncementCommand: (body, key) => {
      announcements.push({ body, key });
      announcementAttempts += 1;
    },
    failFirstAdminAnnouncement: true,
  });

  await page.goto("/admin");
  await page.getByTestId("admin-nav-telegram").click();
  const panel = page.getByTestId("admin-panel-telegram");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("互动用户");
  await expect(panel).toContainText("128");
  await expect(panel).toContainText("30 日活跃");
  await expect(panel).toContainText("72");
  await expect(panel).toContainText("已绑定用户");
  await expect(panel).toContainText("54");
  await expect(panel).toContainText("Avanfinity Community");
  await expect(panel).toContainText("机器人是管理员");
  await expect(panel).toContainText("/setup");
  const verificationPanel = panel.getByTestId("admin-telegram-member-verifications");
  const activeVerification = verificationPanel.locator("article").filter({ hasText: "New member" });
  const historicalVerification = verificationPanel.locator("article").filter({ hasText: "Historical member" });
  await expect(activeVerification).toContainText("尚未点击");
  await expect(historicalVerification).toContainText("已点击（历史时间未记录）");
  await expect(historicalVerification).toContainText("已解除验证");
  await expect(historicalVerification.getByRole("button", { name: "人工通过", exact: true })).toHaveCount(0);
  await expect(activeVerification).toContainText("已点击：", { timeout: 5_000 });
  const bindingPanel = panel.getByTestId("admin-telegram-bindings");
  await expect(bindingPanel).toContainText("@customer_tg");
  await bindingPanel.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(bindingPanel).toContainText("@inviter_tg");
  await expect(panel).not.toContainText(credentialCanary);

  await panel.getByRole("button", { name: "检查机器人健康", exact: true }).click();
  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0].body).toEqual({ action: "health" });

  await panel.getByRole("checkbox", { name: /启用入群申请验证/ }).check();
  await panel.getByRole("checkbox", { name: /启用入群后答题验证/ }).check();
  await panel.getByRole("spinbutton", { name: /验证有效期（秒）/ }).fill("540");
  await panel.getByRole("combobox", { name: "群签到通报", exact: true }).click();
  await page.getByRole("option", { name: "定时汇总", exact: true }).click();
  await panel.locator('input[name="checkinReportTime"]').fill("08:30");
  await panel.locator('input[name="checkinReportIntervalMinutes"]').fill("30");
  await panel.getByRole("button", { name: "保存群设置", exact: true }).click();
  await expect.poll(() => commands.length).toBe(2);
  expect(commands[1].body).toEqual({
    action: "group_update", chatId: "-1001234567890", enabled: true,
    lotteryEnabled: true, joinVerificationEnabled: true, memberVerificationEnabled: true, verificationTtlSeconds: 540,
    checkinReportMode: "scheduled", checkinReportTime: "08:30", checkinReportIntervalMinutes: 30,
  });

  await panel.getByRole("button", { name: "发布到群", exact: true }).nth(0).click();
  await expect.poll(() => commands.length).toBe(3);
  expect(commands[2].body).toEqual({ action: "publish_checkin", chatId: "-1001234567890" });
  await panel.getByRole("button", { name: "发布到群", exact: true }).nth(1).click();
  await expect.poll(() => commands.length).toBe(4);
  expect(commands[3].body).toEqual({ action: "publish_lottery", chatId: "-1001234567890", activityId: 41 });
  await panel.getByRole("button", { name: "发布结果", exact: true }).click();
  await expect.poll(() => commands.length).toBe(5);
  expect(commands[4].body).toEqual({ action: "publish_results", publicationId: 51 });
  await panel.getByRole("button", { name: "人工通过", exact: true }).click();
  await expect.poll(() => commands.length).toBe(6);
  expect(commands[5].body).toEqual({ action: "member_verification_pass", challengeId: "11111111-1111-4111-8111-111111111111" });
  const verificationFeedback = verificationPanel.getByTestId("admin-telegram-member-feedback");
  await expect(verificationFeedback).toContainText("已进入处理队列");
  await expect(activeVerification).toContainText("正在恢复权限");
  await expect(activeVerification).toContainText("已重试 1 次");
  await expect(activeVerification).toContainText("恢复权限失败");
  await expect(activeVerification.getByRole("button", { name: "人工通过", exact: true })).toHaveCount(0);
  await expect(activeVerification).toContainText("已通过", { timeout: 5_000 });
  await expect(verificationFeedback).toContainText("人工通过已完成");
  await expect(panel).not.toContainText("Invalid Date");

  await page.getByTestId("admin-nav-announcements").click();
  await page.getByLabel("公告标题", { exact: true }).fill("Telegram notice");
  await page.getByLabel("公告内容", { exact: true }).fill("A group copy is queued.");
  await page.getByLabel(/同步发送到 Telegram 群/).check();
  await page.getByRole("button", { name: "发送公告", exact: true }).click();
  await expect.poll(() => announcements.length).toBe(1);
  expect(announcements[0].body).toEqual({ action: "create", title: "Telegram notice", content: "A group copy is queued.", isActive: true, telegramChatId: "-1001234567890" });
  expect(announcements[0].key).toMatch(/^[0-9a-f-]{36}$/);
  await page.getByRole("button", { name: "发送公告", exact: true }).click();
  await expect.poll(() => announcements.length).toBe(2);
  expect(announcementAttempts).toBe(2);
  expect(announcements[1].key).toBe(announcements[0].key);
  await expect(page.getByTestId("admin-panel-announcements")).toContainText("Telegram：Avanfinity Community · pending");
  await page.getByTestId("admin-nav-telegram").click();

  for (const command of commands) {
    expect(command.key).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(command.body)).not.toMatch(/bot.?token|webhook.?secret|login.?secret|credential/i);
  }
  expect(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))).not.toContain(credentialCanary);
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(panel.getByRole("heading", { name: "Telegram bot", exact: true })).toBeVisible();
  await bindingPanel.getByRole("button", { name: "Next", exact: true }).click();
  await bindingPanel.getByRole("button", { name: "View details for inviter@example.com", exact: true }).click();
  await expect(page.getByTestId("admin-nav-customers")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("admin-customer-detail")).toContainText("@inviter_tg");
});

test("admin card closure requires explicit confirmation and sends an idempotency key", async ({ page }) => {
  let idempotencyKey = "";
  await mockAuthenticatedShell(page);
  await mockAdminWorkspace(page, {
    cardPending: false,
    onCardDelete: (key) => { idempotencyKey = key; },
  });
  await page.goto("/admin");
  await page.getByTestId("admin-nav-cards").click();
  await page.getByTestId("admin-card-delete-1").click();
  const confirmation = page.getByTestId("admin-card-delete-confirmation");
  await expect(confirmation).toContainText("4242 **** **** 9090");
  await expect(confirmation).toContainText("$15");
  await confirmation.getByRole("button", { name: "确认销卡", exact: true }).click();
  await expect(page.getByText("销卡请求已受理；最终退款以资金操作和对账结果为准。", { exact: true })).toBeVisible();
  expect(idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
});

test("admin unfreezes a frozen card before enabling closure and reuses the retry key", async ({ page }) => {
  const keys: string[] = [];
  await mockAuthenticatedShell(page);
  await mockAdminWorkspace(page, {
    cardPending: false,
    cardStatus: "FROZEN",
    pendingFirstCardUnfreeze: true,
    onCardUnfreeze: (key) => keys.push(key),
  });
  await page.goto("/admin");
  await page.getByTestId("admin-nav-cards").click();
  const unfreeze = page.getByTestId("admin-card-unfreeze-1");
  const remove = page.getByTestId("admin-card-delete-1");
  await expect(unfreeze).toBeEnabled();
  await expect(remove).toBeDisabled();
  await unfreeze.click();
  await expect(page.getByText("解冻请求已受理，等待上游确认。", { exact: true })).toBeVisible();
  await expect(remove).toBeDisabled();
  await unfreeze.click();
  await expect(page.getByText("卡片已解冻，现在可以销卡。", { exact: true })).toBeVisible();
  await expect(unfreeze).toHaveCount(0);
  await expect(remove).toBeEnabled();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
  expect(keys[1]).toBe(keys[0]);
});

test("admin system settings keep SMTP secrets ephemeral and feature switches preserve history", async ({ page }) => {
  await mockAuthenticatedShell(page);
  await mockRecentAuthLogin(page);
  const now = "2026-08-09T08:00:00Z";
  let smtp = {
    host: "smtp.example.com", port: 465, security: "tls", username: "mailer",
    fromEmail: "no-reply@example.com", fromName: "AVANFINITY", enabled: true,
    passwordConfigured: true, ready: true, lastTestStatus: "success" as "never" | "success" | "failure", lastTestAt: now as string | null,
    lastErrorCode: null as string | null, version: 4,
  };
  let features = {
    version: 3, registration: true, walletTransfer: true, cardOpening: true,
    cardRecharge: true, cardManagement: true, cardDelete: true,
    gptDirect: true, gptCdk: true, deposits: false, rewards: true,
    agent: true, market: true, developerApi: true, telegram: true,
  };
  let paymentRisk = {
    version: 6, enabled: true, windowDays: 30, minAttempts: 100,
    lockThresholdBps: 3000, releaseThresholdBps: 2000, reserveBps: 2000, updatedAt: now,
  };
  let declineThreshold = {
    version: 2, minAttempts: 100, autoDeleteDeclines: 4,
    reversalFeeRate: "1", updatedAt: now,
  };
  let deposits: DepositSettings[] = [{
    enabled: true, network: "TRON", currency: "USDT", standard: "TRC20",
    tokenContract: tronAssetId,
    tokenDecimals: 6,
    addresses: ["TA4Wt1DUCqz6YegbnsmqsWC5uUfbdBqPxm", "TA9pkx4DFxrEw8JZzUtyDrh2uAat1LDuJL"],
    apiKeyConfigured: false, ready: false, lastSuccessAt: null,
    lastErrorAt: null, lastError: null, lastTestStatus: "never", lastTestAt: null, lastErrorCode: null, version: 7,
  }, {
    enabled: true, network: "BSC", currency: "USDT", standard: "BEP20",
    tokenContract: bscAssetId,
    tokenDecimals: 18,
    addresses: ["0x1111111111111111111111111111111111111111"],
    apiKeyConfigured: false, ready: true, lastSuccessAt: now,
    lastErrorAt: null, lastError: null, lastTestStatus: "success", lastTestAt: now, lastErrorCode: null, version: 3,
  }, {
    enabled: true, network: "SOL", currency: "USDT", standard: "SPL",
    tokenContract: solAssetId,
    tokenDecimals: 6,
    addresses: ["GxDC9e7SP9mzhDo4re5HbpLa2RW7gB9DtmThx4i4pXSq"],
    apiKeyConfigured: false, ready: false, lastSuccessAt: null,
    lastErrorAt: null, lastError: null, lastTestStatus: "never", lastTestAt: null, lastErrorCode: null, version: 2,
  }];
  let savedSmtp: Record<string, unknown> | undefined;
  let testedSmtp: Record<string, unknown> | undefined;
  const savedDepositRequests: Record<string, unknown>[] = [];
  const testedDepositRequests: Record<string, unknown>[] = [];
  let savedFeatures: Record<string, unknown> | undefined;
  let savedPaymentRisk: Record<string, unknown> | undefined;
  let savedDeclineThreshold: Record<string, unknown> | undefined;
  let paymentRiskSaveAttempts = 0;
  let marketRequests = 0;

  await page.route("**/api/features", (route) => route.fulfill({ json: { code: 0, data: features } }));
  await page.route("**/api/admin/system-settings", (route) => route.fulfill({ json: { code: 0, data: { smtp, deposits, features, paymentRisk, declineThreshold } } }));
  await page.route("**/api/admin/system-settings/payment-risk", (route) => {
    savedPaymentRisk = route.request().postDataJSON() as Record<string, unknown>;
    paymentRiskSaveAttempts += 1;
    if (paymentRiskSaveAttempts === 1) {
      return route.fulfill({ status: 403, json: { error: "请重新认证后继续敏感操作", errorCode: "RECENT_AUTH_REQUIRED" } });
    }
    paymentRisk = { ...paymentRisk, ...savedPaymentRisk, version: paymentRisk.version + 1, updatedAt: now };
    return route.fulfill({ json: { code: 0, data: paymentRisk } });
  });
  await page.route("**/api/admin/system-settings/decline-threshold", (route) => {
    savedDeclineThreshold = route.request().postDataJSON() as Record<string, unknown>;
    declineThreshold = { ...declineThreshold, ...savedDeclineThreshold, version: declineThreshold.version + 1, updatedAt: now };
    return route.fulfill({ json: { code: 0, data: declineThreshold } });
  });
  await page.route("**/api/admin/system-settings/smtp", (route) => {
    savedSmtp = route.request().postDataJSON() as Record<string, unknown>;
    smtp = {
      ...smtp,
      ...savedSmtp,
      passwordConfigured: true,
      ready: false,
      lastTestStatus: "never",
      lastTestAt: null,
      lastErrorCode: null,
      version: smtp.version + 1,
    };
    features = { ...features, registration: false, version: features.version + 1 };
    delete (smtp as Record<string, unknown>).password;
    return route.fulfill({ json: { code: 0, data: smtp } });
  });
  await page.route("**/api/admin/system-settings/smtp/test", (route) => {
    testedSmtp = route.request().postDataJSON() as Record<string, unknown>;
    smtp = { ...smtp, ready: true, lastTestStatus: "success", lastTestAt: now, lastErrorCode: null };
    return route.fulfill({ json: { code: 0, msg: "sent" } });
  });
  await page.route("**/api/admin/system-settings/deposits", (route) => {
    const savedDeposits = route.request().postDataJSON() as Record<string, unknown>;
    savedDepositRequests.push(savedDeposits);
    const network = savedDeposits.network as DepositSettings["network"];
    const current = deposits.find((item) => item.network === network)!;
    const hasApiKey = Object.prototype.hasOwnProperty.call(savedDeposits, "apiKey");
    const updated: DepositSettings = {
      ...current,
      enabled: Boolean(savedDeposits.enabled),
      addresses: savedDeposits.addresses as string[],
      apiKeyConfigured: network !== "SOL" && hasApiKey ? Boolean(savedDeposits.apiKey) : current.apiKeyConfigured,
      ready: false,
      lastSuccessAt: null,
      lastErrorAt: null,
      lastError: null,
      lastTestStatus: "never",
      lastTestAt: null,
      lastErrorCode: null,
      version: current.version + 1,
    };
    deposits = deposits.map((item) => item.network === network ? updated : item);
    return route.fulfill({ json: { code: 0, data: updated } });
  });
  await page.route("**/api/admin/system-settings/deposits/test", (route) => {
    const testedDeposits = route.request().postDataJSON() as Record<string, unknown>;
    testedDepositRequests.push(testedDeposits);
    const network = testedDeposits.network as DepositSettings["network"];
    const current = deposits.find((item) => item.network === network)!;
    const updated: DepositSettings = { ...current, ready: true, lastSuccessAt: now, lastErrorAt: null, lastError: null, lastTestStatus: "success", lastTestAt: now, lastErrorCode: null };
    deposits = deposits.map((item) => item.network === network ? updated : item);
    return route.fulfill({ json: { code: 0, msg: "ready", data: updated } });
  });
  await page.route("**/api/admin/system-settings/features", (route) => {
    savedFeatures = route.request().postDataJSON() as Record<string, unknown>;
    features = { ...features, ...savedFeatures, version: features.version + 1 };
    return route.fulfill({ json: { code: 0, data: features } });
  });

  await page.reload();
  await page.goto("/admin");
  await page.getByTestId("admin-nav-system").click();
  const system = page.getByTestId("admin-panel-system");
  const password = system.getByTestId("smtp-password");
  await expect(password).toHaveValue("");
  await expect(password).toHaveAttribute("autocomplete", "new-password");
  await system.getByLabel("SMTP 主机", { exact: true }).fill("smtp2.example.com");
  await password.fill("smtp-canary-secret");
  await expect(system.getByRole("button", { name: "发送测试邮件", exact: true })).toBeDisabled();
  await system.locator(".admin-system-section").first().getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => savedSmtp).toMatchObject({
    host: "smtp2.example.com", port: 465, security: "tls", password: "smtp-canary-secret", version: 4,
  });
  await expect(password).toHaveValue("");
  expect(await page.evaluate(() => `${localStorage.getItem("session")}${sessionStorage.length}`)).not.toContain("smtp-canary-secret");

  await system.getByRole("button", { name: "发送测试邮件", exact: true }).click();
  await expect.poll(() => testedSmtp).toEqual({ version: 5 });
  await expect(password).toHaveValue("");
  expect(testedSmtp).not.toHaveProperty("recipient");
  await expect(system.locator(".admin-system-section").first().getByText("已就绪", { exact: true })).toBeVisible();
  await expect(system.getByText("SMTP 服务器已接受测试邮件，请检查收件箱与垃圾邮件。", { exact: true })).toBeVisible();

  const paymentRiskSection = system.getByTestId("payment-risk-settings");
  const minAttempts = paymentRiskSection.getByLabel("最少终态样本数", { exact: true });
  const lockThreshold = paymentRiskSection.getByRole("spinbutton", { name: /^触发拒付率/ });
  const releaseThreshold = paymentRiskSection.getByRole("spinbutton", { name: /^释放拒付率/ });
  const reserveRatio = paymentRiskSection.getByRole("spinbutton", { name: /^余额锁定比例/ });
  const saveRisk = paymentRiskSection.getByRole("button", { name: "保存", exact: true });
  await expect(paymentRiskSection.getByLabel("统计窗口（天）", { exact: true })).toHaveValue("30");
  await expect(minAttempts).toHaveValue("100");
  await expect(minAttempts).toHaveAttribute("max", "10000");
  await expect(lockThreshold).toHaveValue("30");
  await expect(lockThreshold).toHaveAttribute("min", "0.01");
  await expect(releaseThreshold).toHaveValue("20");
  await expect(releaseThreshold).toHaveAttribute("min", "0");
  await expect(reserveRatio).toHaveAttribute("min", "0.01");
  await lockThreshold.fill("0");
  await expect(saveRisk).toBeDisabled();
  await lockThreshold.fill("30");
  await releaseThreshold.fill("30");
  await expect(saveRisk).toBeDisabled();
  await releaseThreshold.fill("20");
  await minAttempts.fill("10001");
  await expect(saveRisk).toBeDisabled();
  await minAttempts.fill("100");
  await expect(saveRisk).toBeEnabled();
  await expect(paymentRiskSection).toContainText("低于 20% 时释放，等于 20% 时仍锁定");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(paymentRiskSection).toContainText("release below 20%, and remain reserved at exactly 20%");
  await page.getByRole("button", { name: "中文", exact: true }).click();
  await reserveRatio.fill("25");
  await saveRisk.click();
  await expect(paymentRiskSection.getByRole("alert")).toContainText("请重新认证后继续敏感操作");
  await paymentRiskSection.getByRole("button", { name: "重新登录验证", exact: true }).click();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("recentAuthReturnPath"))).toBe("/admin?panel=system");
  await expect(page).toHaveURL(/\/login$/);
  await page.getByPlaceholder("your@email.com").fill("admin@danewcard.local");
  await page.getByPlaceholder("8+").fill("Admin123!Secure");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\?panel=system$/);
  const reauthenticatedPaymentRisk = page.getByTestId("admin-panel-system").getByTestId("payment-risk-settings");
  await reauthenticatedPaymentRisk.getByRole("spinbutton", { name: /^余额锁定比例/ }).fill("25");
  await reauthenticatedPaymentRisk.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => savedPaymentRisk).toEqual({
    version: 6, enabled: true, windowDays: 30, minAttempts: 100,
    lockThresholdBps: 3000, releaseThresholdBps: 2000, reserveBps: 2500,
  });
  await expect(reauthenticatedPaymentRisk).toContainText("支付风控策略已保存");
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("recentAuthReturnPath"))).toBeNull();

  const declineSection = page.getByTestId("admin-panel-system").getByTestId("decline-threshold-settings");
  const autoDeleteDeclines = declineSection.getByRole("spinbutton", { name: /^单卡自动销卡拒付数/ });
  const saveDecline = declineSection.getByRole("button", { name: "保存", exact: true });
  await expect(autoDeleteDeclines).toHaveValue("4");
  await expect(autoDeleteDeclines).toHaveAttribute("max", "4");
  await expect(declineSection).toContainText("单卡累计 4 次拒付后自动销卡并退回余额");
  await autoDeleteDeclines.fill("5");
  await expect(saveDecline).toBeDisabled();
  await autoDeleteDeclines.fill("3");
  await saveDecline.click();
  await expect.poll(() => savedDeclineThreshold).toEqual({
    version: 2, minAttempts: 100, autoDeleteDeclines: 3, reversalFeeRate: "1",
  });

  const depositSection = system.locator('section[aria-labelledby="deposit-settings-title"]');
  const depositKey = depositSection.getByTestId("deposit-api-key");
  const depositTest = depositSection.getByRole("button", { name: "测试链路监听", exact: true });
  const depositSave = depositSection.getByRole("button", { name: "保存", exact: true });
  const depositNetwork = depositSection.getByTestId("admin-deposit-network-select");
  const depositFeature = system.getByRole("checkbox", { name: /链上充值订单/ });
  const tronAddresses = ["TA4Wt1DUCqz6YegbnsmqsWC5uUfbdBqPxm", "TA9pkx4DFxrEw8JZzUtyDrh2uAat1LDuJL"];
  const bscDraftAddress = "0x2222222222222222222222222222222222222222";
  const solDraftAddress = "3e8yU2KSaw9KFjPdmt9JFRGcWv44PYxhtXiygp9n11Cb";
  const chooseNetwork = async (name: "TRON · TRC20" | "BNB Smart Chain · BEP20" | "Solana · SPL") => {
    await depositNetwork.click();
    await page.getByRole("option", { name, exact: true }).click();
  };
  await expect(depositFeature).toBeEnabled();
  await expect(depositNetwork).toContainText("TRON · TRC20");
  await expect(depositSection.getByTestId("deposit-address-pool")).toHaveValue(tronAddresses.join("\n"));
  await expect(depositSection).toContainText("绝不要填写钱包私钥、助记词或 Keystore");
  await expect(depositSection).toContainText("公共限额模式只能安全监控一个实际收款地址");
  await expect(depositSection.getByRole("checkbox", { name: /移除已保存的 TronGrid Key/ })).toHaveCount(0);
  await expect(depositSection).toContainText("使用公共限额");
  await expect(depositTest).toBeEnabled();
  await expect(depositKey).toHaveAttribute("autocomplete", "new-password");
  await depositKey.fill("trongrid-canary-secret");
  await expect(depositTest).toBeDisabled();
  await depositSave.click();
  await expect.poll(() => savedDepositRequests).toHaveLength(1);
  expect(savedDepositRequests[0]).toMatchObject({
    network: "TRON",
    enabled: true,
    addresses: tronAddresses,
    apiKey: "trongrid-canary-secret",
    version: 7,
  });
  await expect(depositKey).toHaveValue("");
  expect(await page.evaluate(() => `${localStorage.getItem("session")}${sessionStorage.length}`)).not.toContain("trongrid-canary-secret");
  await depositSave.click();
  await expect.poll(() => savedDepositRequests).toHaveLength(2);
  expect(savedDepositRequests[1]).toMatchObject({ network: "TRON", enabled: true, version: 8 });
  expect(savedDepositRequests[1]).not.toHaveProperty("apiKey");
  await depositTest.click();
  await expect.poll(() => testedDepositRequests).toHaveLength(1);
  expect(testedDepositRequests[0]).toEqual({ network: "TRON", version: 9 });
  await expect(depositSection.getByText("已就绪", { exact: true })).toBeVisible();
  await expect(depositFeature).toBeEnabled();

  await chooseNetwork("BNB Smart Chain · BEP20");
  await expect(depositKey).toBeVisible();
  await expect(depositSection).toContainText("公共 BSC RPC 会限流或缺少历史状态");
  await expect(depositSection).toContainText(bscAssetId);
  await expect(depositSection.getByTestId("deposit-address-pool")).toHaveValue("0x1111111111111111111111111111111111111111");
  await depositSection.getByTestId("deposit-address-pool").fill(bscDraftAddress);
  await chooseNetwork("TRON · TRC20");
  await expect(depositSection.getByTestId("deposit-address-pool")).toHaveValue(tronAddresses.join("\n"));
  await chooseNetwork("BNB Smart Chain · BEP20");
  await expect(depositSection.getByTestId("deposit-address-pool")).toHaveValue(bscDraftAddress);
  await depositKey.fill("nodereal-canary-key");
  await depositSave.click();
  await expect.poll(() => savedDepositRequests).toHaveLength(3);
  expect(savedDepositRequests[2]).toMatchObject({ network: "BSC", enabled: true, addresses: [bscDraftAddress], apiKey: "nodereal-canary-key", version: 3 });
  await expect(depositKey).toHaveValue("");
  expect(await page.evaluate(() => `${localStorage.getItem("session")}${sessionStorage.length}`)).not.toContain("nodereal-canary-key");
  await depositTest.click();
  await expect.poll(() => testedDepositRequests).toHaveLength(2);
  expect(testedDepositRequests[1]).toEqual({ network: "BSC", version: 4 });

  await chooseNetwork("Solana · SPL");
  await expect(depositKey).toHaveCount(0);
  await expect(depositSection).toContainText("Solana 收款钱包地址池");
  await expect(depositSection).toContainText("自动派生并监听其 SPL-USDT 关联代币账户");
  await expect(depositSection).toContainText("USDT Token Mint");
  await expect(depositSection.getByTestId("deposit-address-pool")).toHaveValue("GxDC9e7SP9mzhDo4re5HbpLa2RW7gB9DtmThx4i4pXSq");
  await depositSection.getByTestId("deposit-address-pool").fill(solDraftAddress);
  await chooseNetwork("BNB Smart Chain · BEP20");
  await expect(depositSection.getByTestId("deposit-address-pool")).toHaveValue(bscDraftAddress);
  await chooseNetwork("Solana · SPL");
  await expect(depositSection.getByTestId("deposit-address-pool")).toHaveValue(solDraftAddress);
  await depositSave.click();
  await expect.poll(() => savedDepositRequests).toHaveLength(4);
  expect(savedDepositRequests[3]).toMatchObject({ network: "SOL", enabled: true, addresses: [solDraftAddress], version: 2 });
  expect(savedDepositRequests[3]).not.toHaveProperty("apiKey");
  await depositTest.click();
  await expect.poll(() => testedDepositRequests).toHaveLength(3);
  expect(testedDepositRequests[2]).toEqual({ network: "SOL", version: 3 });

  await chooseNetwork("TRON · TRC20");
  const removeDepositKey = depositSection.getByRole("checkbox", { name: /移除已保存的 TronGrid Key/ });
  await removeDepositKey.check();
  await expect(depositKey).toBeDisabled();
  await expect(depositTest).toBeDisabled();
  await expect(depositSection).toContainText("公共限额模式只能安全监控一个实际收款地址");
  await depositSection.getByTestId("deposit-address-pool").fill(tronAddresses[0]);
  await depositSave.click();
  await expect.poll(() => savedDepositRequests).toHaveLength(5);
  expect(savedDepositRequests[4]).toMatchObject({ network: "TRON", apiKey: "", addresses: [tronAddresses[0]], version: 9 });
  await expect(depositSection.getByRole("checkbox", { name: /移除已保存的 TronGrid Key/ })).toHaveCount(0);

  for (const name of ["钱包转账", "虚拟卡开卡", "卡片充值", "卡片管理", "卡片销毁", "行情刷新"]) {
    await system.getByRole("checkbox", { name: new RegExp(name) }).uncheck();
  }
  await system.getByRole("button", { name: "保存功能开关", exact: true }).click();
  await expect.poll(() => savedFeatures).toMatchObject({
    version: 4, registration: false, walletTransfer: false, cardOpening: false, cardRecharge: false,
    cardManagement: false, cardDelete: false, market: false,
  });

  await page.route("**/api/products", (route) => route.fulfill({ json: { code: 0, data: [{
    productCode: "FEATURE_CARD", issuer: "E2E Bank", network: "VISA", issuingArea: "US",
    cardType: "Virtual", openFee: "1.0000", rechargeRate: "0.010000", minAmount: "10.0000",
    maxAmount: "100.0000", description: "Existing catalog item", category: "AI",
  }] } }));
  await page.route("**/api/cards", (route) => route.fulfill({ json: { code: 0, data: {
    total: 1, list: [{ id: 99002, cardNumberMasked: "•••• •••• •••• 4242", productCode: "FEATURE_CARD",
      network: "VISA", issuingArea: "US", status: "ACTIVE", balance: "10.0000",
      firstName: "Existing", lastName: "Customer", createdAt: now }],
  } } }));
  await page.route("**/api/wallet", (route) => route.fulfill({ json: { code: 0, data: {
    balance: "100.0000", promoBalance: "0.0000", cumulativeDeposit: "100.0000", cumulativeSpend: "0.0000",
  } } }));
  await page.route("**/api/wallet/transactions", (route) => route.fulfill({ json: { code: 0, data: {
    total: 1, list: [{ id: 1, type: "deposit", amount: "100.0000", balanceBefore: "0.0000",
      balanceAfter: "100.0000", remark: "Existing ledger entry", createdAt: now }],
  } } }));
  await page.route("**/api/openai-prices", (route) => {
    marketRequests += 1;
    return route.fulfill({ json: { code: 0, data: { references: [] } } });
  });

  await page.goto("/cards");
  await expect(page.getByTestId("product-FEATURE_CARD")).toBeVisible();
  await expect(page.getByRole("link", { name: "了解并开卡", exact: true })).toHaveCount(0);
  await page.goto("/cards/owned");
  const existingCard = page.locator(".bank-card").filter({ hasText: "Existing Customer" });
  await expect(existingCard.getByRole("link", { name: "详情", exact: true })).toBeVisible();
  await expect(existingCard.getByRole("button", { name: "退款", exact: true })).toHaveCount(0);
  await expect(existingCard.getByRole("button", { name: "冻结", exact: true })).toHaveCount(0);
  await expect(existingCard.getByRole("button", { name: "充值", exact: true })).toHaveCount(0);
  await page.goto("/cards/open/FEATURE_CARD");
  await expect(page.getByRole("heading", { name: "开卡功能暂未开放", exact: true })).toBeVisible();

  await page.goto("/finance");
  await expect(page.getByRole("button", { name: "余额转账", exact: true })).toHaveCount(0);
  await expect(page.getByText("Existing ledger entry", { exact: true })).toBeVisible();
  await page.goto("/openai-prices");
  await expect(page.getByText("该功能当前暂停，已有记录和恢复操作仍可使用。", { exact: true })).toBeVisible();
  expect(marketRequests).toBe(0);
});

test("admin CDK orders shows funding, last four and failure timeline", async ({ page }) => {
  await mockAuthenticatedShell(page);
  await mockAdminWorkspace(page);
  const id = "11111111-1111-4111-8111-111111111111";
  const order = { id, cdkId: 156, userId: 553, email: "cdk-customer@example.test", plan: "pro_20x",
    status: "failed_precharge", stage: "tokenizing", cardLastFour: "0910", maskedEmail: "c***@example.test",
    operationStatus: "COMPENSATED", createdAt: "2026-09-08T03:59:00Z", invoiceUrls: [],
    fundingQuote: { amountUsd: "142.44665080", bufferUsd: "3", requiredUsd: "145.45", usdPerUnit: "0.01597" } };
  const queries: string[] = [];
  await page.route("**/api/admin/gpt-cdk-orders?**", route => {
    queries.push(route.request().url());
    return route.fulfill({ json: { code: 0, data: { list: [order], total: 1, page: 1, pageSize: 50 } } });
  });
  await page.route(`**/api/admin/gpt-cdk-orders/${id}`, route => route.fulfill({ json: { code: 0, data: {
    order, events: [{ eventId: "1", type: "gpt_direct.failed", status: "failed_precharge", stage: "tokenizing",
      publicCode: "checkout_confirm_failed", publicMessage: "结账受阻，已停止自动换卡", createdAt: order.createdAt }],
    funding: [{ id: "funding-1", cardId: 126, amountUsd: "145.35", balanceBeforeUsd: "0.10", balanceAfterUsd: "145.45", status: "SUCCEEDED", createdAt: order.createdAt }],
  } } }));
  await page.goto("/admin?panel=gptOrders");
  await page.getByRole("button", { name: "CDK 直充", exact: true }).click();
  const panel = page.getByTestId("admin-cdk-orders");
  await expect(panel.getByText("cdk-customer@example.test", { exact: true })).toBeVisible();
  await expect(panel.getByText("•••• 0910", { exact: true })).toBeVisible();
  await panel.getByRole("textbox").fill("0910");
  await panel.getByRole("button", { name: "筛选", exact: true }).click();
  await expect.poll(() => queries.some(q => new URL(q).searchParams.get("q") === "0910")).toBeTruthy();
  await panel.getByRole("button", { name: "详情", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("结账受阻，已停止自动换卡", { exact: true })).toHaveCount(1);
  await expect(dialog.getByText("结账受阻，已停止自动换卡", { exact: true }).first()).toBeVisible();
  await expect(dialog.getByText("$145.45", { exact: true })).toBeVisible();
  await expect(dialog.getByText("卡片 #126 · $145.35 · SUCCEEDED", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test("admin CDK receipts use the direct order drawer with both Stripe invoices", async ({ page }, testInfo) => {
  await mockAuthenticatedShell(page);
  await mockAdminWorkspace(page);
  const id = "1256e85c-1e09-41d2-a0e5-9332244991d4";
  const invoices = ["https://invoice.stripe.com/i/test/plus", "https://invoice.stripe.com/i/test/pro"];
  const order = { id, cdkId: 154, userId: 553, email: "owner@example.test", customerEmail: "owner@example.test",
    maskedEmail: "g***@example.test", originalPlan: "free", observedPlan: "pro_20x",
    plan: "pro_20x", status: "completed", stage: "complete", operationStatus: "SUCCEEDED",
    cardLastFour: "4231", cardNumberMasked: "•••• •••• •••• 4231", cardId: 170, linkedCardId: 170,
    cardProductCode: "160P5556XV", cardStatus: "ACTIVE", quotedAmountMinor: 891966, currency: "PHP",
    createdAt: "2026-09-08T03:00:00Z", invoiceUrls: [invoices[0]], invoiceUrl: invoices[1] };
  await page.route("**/api/admin/gpt-cdk-orders?**", route => route.fulfill({ json: { code: 0, data: { list: [order], total: 1, page: 1, pageSize: 50 } } }));
  await page.route(`**/api/admin/gpt-cdk-orders/${id}`, route => route.fulfill({ json: { code: 0, data: {
    order: { ...order, email: undefined }, funding: [],
    events: [{ eventId: "event-complete", type: "gpt_direct.completed", publicMessage: "套餐已开通",
      status: "completed", stage: "complete", safePayload: { observed_plan: "pro_20x" }, createdAt: order.createdAt }],
  } } }));
  await page.goto("/admin?panel=gptOrders&source=cdk");
  await page.getByTestId("admin-cdk-orders").getByRole("button", { name: "详情", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator(".transaction-detail-grid")).toHaveCount(1);
  await expect(dialog.locator(".admin-gpt-order-timeline")).toBeVisible();
  await expect(dialog.locator(".gpt-order-progress")).toHaveCount(0);
  await expect(dialog.getByText("g***@example.test", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("link", { name: /账单 1/ })).toHaveAttribute("href", invoices[0]);
  await expect(dialog.getByRole("link", { name: /账单 2/ })).toHaveAttribute("href", invoices[1]);
  await page.screenshot({ path: testInfo.outputPath("cdk-admin-desktop.png"), animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog.getByRole("link", { name: /账单 2/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await dialog.getByRole("link", { name: /账单 2/ }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("cdk-admin-mobile.png"), animations: "disabled" });
});

test("admin CDK preview and preflight states are translated", async ({ page }) => {
  await mockAuthenticatedShell(page);
  await mockAdminWorkspace(page);
  const states = ["previewed", "preflighting", "preflighted"];
  await page.route("**/api/admin/gpt-cdk-orders?**", route => route.fulfill({ json: { code: 0, data: {
    list: states.map((status, index) => ({ id: `cdk-${index}`, cdkId: index, userId: 1, email: "owner@example.test",
      plan: "plus", status, stage: status, createdAt: "2026-09-08T03:00:00Z" })), total: 3, page: 1, pageSize: 50,
  } } }));
  await page.goto("/admin?panel=gptOrders&source=cdk");
  const rows = page.getByTestId("admin-cdk-orders").locator("tbody");
  for (const label of ["CDK 已校验", "账号预检中", "账号预检通过"]) await expect(rows.getByText(label, { exact: true }).first()).toBeVisible();
  await expect(rows).not.toContainText(/previewed|preflighting|preflighted/);
});

test("admin prices customer-generated CDKs without upstream issuance", async ({ page }, testInfo) => {
  let pricingBody: Record<string, unknown> | undefined;
  let pricingKey = "";
  if (testInfo.project.name === "frontend-mock") await mockAuthenticatedShell(page);
  await mockAdminWorkspace(page, {
    onCdkPricing: (body, key) => { pricingBody = body; pricingKey = key; },
  });
  await page.goto("/admin");
  await page.getByTestId("admin-nav-cdks").click();
  await expect(page.getByTestId("admin-panel-cdks")).toBeVisible();
  await expect(page.getByText("售价可以标 0。当前生成 CDK 不按售价扣款", { exact: false })).toBeVisible();
  const pricingForm = page.locator(".admin-cdk-pricing-list form").filter({ hasText: "Plus" });
  const pricingMode = pricingForm.getByRole("combobox", { name: "定价方式", exact: true });
  await expect(pricingMode).toContainText("固定售价");
  await pricingMode.click();
  await page.getByRole("option", { name: "最低报价 + 百分比", exact: true }).click();
  await expect(pricingForm.getByLabel("加价比例（%）", { exact: true })).toBeVisible();
  await pricingMode.click();
  await page.getByRole("option", { name: "最低报价 + 固定美元", exact: true }).click();
  await pricingForm.getByLabel("固定加价（USD）", { exact: true }).fill("5.00");
  await pricingForm.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => pricingBody).toEqual({ plan: "plus", enabled: true, salePrice: "29.0000", pricingMode: "QUOTE_FIXED", markupValue: "5.00" });
  expect(pricingKey).toMatch(/^[0-9a-f-]{36}$/);
  const waitingForm = page.locator(".admin-cdk-pricing-list form").filter({ hasText: "Pro 5x" });
  await expect(waitingForm.getByText("等待新报价", { exact: true })).toBeVisible();
  await expect(waitingForm.getByText("暂无有效报价", { exact: true })).toBeVisible();
  await expect(waitingForm.getByRole("checkbox", { name: "启用售卖", exact: true })).toBeChecked();
  await expect(page.getByText("客户自行生成 CDK。这里只标出售价", { exact: false })).toBeVisible();
  await expect(page.locator(".admin-cdk-issue-form")).toHaveCount(0);
});

test("admin configures automatic CDK quote refresh without echoing the Session", async ({ page }) => {
  const writes: Record<string, unknown>[] = [];
  let deletes = 0;
  const secret = "playwright-quote-refresh-session-never-store";
  await mockAuthenticatedShell(page);
  await mockRecentAuthLogin(page);
  await mockAdminWorkspace(page, {
    quoteRefreshRecentAuth: true,
    onQuoteRefresh: (body) => writes.push(body),
    onQuoteRefreshDelete: () => { deletes += 1; },
  });
  await page.goto("/admin");
  await page.getByTestId("admin-nav-cdks").click();
  let section = page.getByTestId("admin-gpt-quote-refresh");
  await expect(section).toContainText("6 小时汇率新鲜度");
  await section.getByLabel("Session", { exact: true }).fill(secret);
  await section.getByLabel("刷新间隔（分钟）", { exact: true }).fill("30");
  await section.getByRole("checkbox", { name: "启用自动刷新", exact: true }).check();
  await section.getByRole("button", { name: "保存", exact: true }).click();
  await expect(section.getByRole("alert")).toContainText("请重新认证后继续敏感操作");
  await section.getByRole("button", { name: "重新登录验证", exact: true }).click();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("recentAuthReturnPath"))).toBe("/admin?panel=cdks");
  await page.getByPlaceholder("your@email.com").fill("admin@danewcard.local");
  await page.getByPlaceholder("8+").fill("Admin123!Secure");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\?panel=cdks$/);

  section = page.getByTestId("admin-gpt-quote-refresh");
  const session = section.getByLabel("Session", { exact: true });
  await expect(session).toHaveValue("");
  await session.fill(secret);
  await section.getByLabel("刷新间隔（分钟）", { exact: true }).fill("30");
  await section.getByRole("checkbox", { name: "启用自动刷新", exact: true }).check();
  await section.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => writes).toHaveLength(2);
  expect(writes[1]).toEqual({ session: secret, enabled: true, intervalMinutes: 30 });
  await expect(section.getByText("等待刷新", { exact: true })).toBeVisible();
  await expect(section.getByLabel("替换 Session（留空则保留）", { exact: true })).toHaveValue("");
  expect(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))).not.toContain(secret);

  page.once("dialog", (dialog) => void dialog.accept());
  await section.getByRole("button", { name: "删除", exact: true }).click();
  await expect.poll(() => deletes).toBe(1);
  await expect(page.getByTestId("admin-gpt-quote-refresh").getByText("未配置", { exact: true })).toBeVisible();
});

test("admin workspace remains usable on a mobile viewport", async ({ page }) => {
  await mockAuthenticatedShell(page);
  await mockAdminWorkspace(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin");
  await expect(page.getByTestId("admin-local-nav")).toBeVisible();
  const panels = [
    ["overview", ".admin-provider-summary"],
    ["upstreams", '[data-testid="upstream-spacex"]'],
    ["costs", '[data-testid="admin-product-list"]'],
    ["tiers", ".pricing-tier-grid form"],
    ["cards", '[data-testid="admin-cards-table"]'],
    ["cdks", ".admin-cdk-pricing-list"],
    ["proxies", '[data-testid="admin-proxy-add"]'],
    ["funds", '[data-testid="admin-money-table"]'],
    ["customers", ".admin-customer-row"],
    ["announcements", ".admin-announcement-form"],
    ["audit", '[data-testid="admin-audit-table"]'],
    ["rewards", ".admin-reward-forms"],
    ["telegram", ".admin-telegram-overview"],
  ] as const;
  for (const [panel, readySelector] of panels) {
    await page.getByTestId(`admin-nav-${panel}`).click();
    await expect(page.getByTestId(`admin-panel-${panel}`)).toBeVisible();
    await expect(page.locator(readySelector).first()).toBeVisible();
    if (panel === "overview") await expect(page.locator(".admin-metric-grid")).toBeVisible();
    if (panel === "proxies") {
      const table = page.getByTestId("admin-proxies-table");
      const actionCell = table.locator("tbody td").last();
      await expect(actionCell).toHaveCSS("position", "sticky");
      expect(await actionCell.evaluate((cell) => cell.getBoundingClientRect().right)).toBeLessThanOrEqual(
        await table.locator("xpath=..").evaluate((wrap) => wrap.getBoundingClientRect().right),
      );
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      await page.evaluate(() => document.documentElement.clientWidth),
    );
  }
});

test("admin opens a customer detail view from direct order audit and its payment card", async ({ page }) => {
  await mockAuthenticatedShell(page);
  await mockAdminWorkspace(page);
  const order = { id: "audit-order", userId: 7, customerEmail: "customer@example.com", email: "customer@example.com", accountEmail: "chatgpt@example.com", plan: "pro_20x", originalPlan: "free", observedPlan: "plus", status: "requires_action", operationStatus: "SUBMITTED", stage: "verifying", cardId: 71, linkedCardId: 71, cardNumberMasked: "•••• •••• •••• 0910", cardProductCode: "PTEST", cardStatus: "ACTIVE", paymentCardSource: "platform", customerServiceFee: "0.2000", createdAt: "2026-09-06T00:00:00Z" };
  await page.route("**/api/admin/gpt-direct/orders?*", route => route.fulfill({ json: { code: 0, data: { total: 1, page: 1, pageSize: 50, list: [order] } } }));
  await page.route("**/api/admin/gpt-direct/orders/audit-order", route => route.fulfill({ json: { code: 0, data: { order, events: [] } } }));
  await page.goto("/admin?panel=gptOrders");
  const table = page.getByTestId("admin-gpt-direct-table");
  await expect(table).toContainText("Free → Pro 20x");
  await expect(table).toContainText("最近确认的套餐: Plus");
  await table.getByRole("button", { name: "详情", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("chatgpt@example.com");
  await expect(dialog).toContainText("充值前套餐（预检记录）");
  await dialog.getByRole("button", { name: /0910.*#71/ }).click();
  await expect(page).toHaveURL(/customerId=7.*view=cards.*cardId=71.*from=gptOrders/);
  await page.reload();
  await expect(page.getByTestId("admin-customer-detail")).toBeVisible();
  await page.goto("/admin?panel=gptOrders");
  await table.getByRole("button", { name: "详情", exact: true }).click();
  await dialog.getByRole("button", { name: /customer@example.com/ }).click();
  await expect(page).toHaveURL(/customerId=7.*from=gptOrders/);
});

test("admin opens a customer detail view with completed top-up renewal guidance", async ({ page }, testInfo) => {
  await mockAuthenticatedShell(page);
  await mockAdminWorkspace(page);
  const order = { id: "renewal-audit", userId: 7, customerEmail: "customer@example.com", plan: "plus", status: "requires_action", operationStatus: "SUBMITTED", stage: "verifying", publicCode: "session_refresh_required", nextAction: "submit_session", progress: [{ stage: "canceling" }, { stage: "verifying" }], customerServiceFee: "0", createdAt: "2026-09-07T05:48:00Z" };
  const events = [1, 2].map(id => ({ eventId: `session-${id}`, stage: "verifying", status: "requires_action", publicCode: "session_refresh_required", publicMessage: "支付后会话无法刷新；已停止自动重试，请提供新 Session 完成核对", createdAt: "2026-09-07T05:49:17Z" }));
  await page.route("**/api/admin/gpt-direct/orders?*", route => route.fulfill({ json: { code: 0, data: { total: 1, page: 1, pageSize: 50, list: [order] } } }));
  await page.route("**/api/admin/gpt-direct/orders/renewal-audit", route => route.fulfill({ json: { code: 0, data: { order, events } } }));
  await page.goto("/admin?panel=gptOrders");
  await page.getByTestId("admin-gpt-direct-table").getByRole("button", { name: "详情", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator(".admin-alert")).toContainText("直充服务已完成 · 自动续费待处理");
  await expect(dialog.locator(".admin-alert")).toContainText("到该订单详情提交新的完整 Session");
  await expect(dialog).toContainText("自动续费状态待确认");
  await expect(dialog.locator(".admin-gpt-order-timeline article").filter({ hasText: "直充服务已完成。自动续费取消结果未确认" })).toHaveCount(2);
  await expect(dialog).not.toContainText("支付后会话无法刷新；已停止自动重试");
  await page.screenshot({ path: testInfo.outputPath("admin-renewal-recovery.png"), animations: "disabled" });
});

test("admin opens a customer detail view and returns without breaking management", async ({ page }) => {
  await mockAuthenticatedShell(page);
  let cardTransactionRequests = 0;
  let sensitiveRequests = 0;
  await mockAdminWorkspace(page, {
    onCustomerCardTransactions: () => { cardTransactionRequests += 1; },
    onCustomerSensitive: () => { sensitiveRequests += 1; },
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin");
  await page.getByTestId("admin-nav-customers").click();

  const customer = page.locator(".admin-customer-row").filter({ hasText: "customer@example.com" });
  await expect(customer).toBeVisible();
  await expect(customer).toContainText("@customer_tg");
  await customer.getByRole("button", { name: "查看详情", exact: true }).click();

  const detail = page.getByTestId("admin-customer-detail");
  await expect(detail).toContainText("customer@example.com");
  await expect(detail).toContainText("@customer_tg");
  await expect(detail).toContainText("风控锁定余额$6.3");
  await expect(detail).toContainText("可用余额$25.2");
  await expect(page.getByTestId("admin-customer-risk")).toContainText("支付成功率70%");
  await expect(page.getByTestId("admin-customer-risk")).toContainText("支付拒付率30%");
  await page.setViewportSize({ width: 1280, height: 720 });
  const customerEditor = page.getByTestId("admin-customer-management").locator(".admin-customer-editor");
  expect(await customerEditor.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await customerEditor.evaluate((element) => getComputedStyle(element).paddingTop)).toBe("0px");
  expect(await customerEditor.locator("form").first().evaluate((element) => getComputedStyle(element).borderTopWidth)).toBe("0px");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId("admin-customer-inviter")).toHaveText("inviter@example.com");
  await expect(page.getByTestId("admin-customer-referrals")).toContainText("friend@example.com");
  await expect(page.getByTestId("admin-customer-referrals")).toContainText("$1.25");
  expect(await customerEditor.evaluate((element) => getComputedStyle(element).paddingLeft)).toBe("0px");
  expect(await customerEditor.evaluate((element) => getComputedStyle(element).paddingBottom)).toBe("0px");
  await expect(page.getByTestId("admin-customer-referral-rewards")).toContainText("+$1");
  await expect(page.getByTestId("admin-customer-cards")).toContainText("•••• •••• •••• 0910");
  await expect(page.getByTestId("admin-customer-cards")).toContainText("AI virtual card");
  const customerCard = page.getByTestId("admin-customer-card-71");
  await expect(customerCard).toHaveAttribute("aria-expanded", "false");
  expect(cardTransactionRequests).toBe(0);
  await customerCard.click();
  await expect.poll(() => cardTransactionRequests).toBe(1);
  await expect(customerCard).toHaveAttribute("aria-expanded", "true");
  const cardTransactions = page.getByTestId("admin-customer-card-transactions-71");
  await expect(cardTransactions).toContainText("OPENAI");
  await expect(cardTransactions).toContainText("Settlement · COMPLETE");
  await expect(cardTransactions).toContainText("19.99 USD");
  await expect(cardTransactions).not.toContainText("5450200000900910");
  await page.getByTestId("admin-customer-card-sensitive-71").click();
  await expect.poll(() => sensitiveRequests).toBe(1);
  const sensitive = page.getByTestId("admin-customer-card-sensitive-data-71");
  await expect(sensitive).toContainText("4111111111110910");
  await expect(sensitive).toContainText("910");
  await expect(sensitive).toContainText("1 Admin Test Way");
  expect(await page.evaluate(() => `${localStorage.getItem("session")} ${sessionStorage.getItem("recentAuthReturnPath")}`)).not.toContain("4111111111110910");
  await page.getByTestId("admin-customer-card-sensitive-71").click();
  await expect(sensitive).toHaveCount(0);
  await expect(page.getByTestId("admin-customer-deposits")).toContainText("$10.0345");
  await expect(page.getByTestId("admin-customer-deposits")).toContainText("5xZk…pQ91");
  await expect(page.getByTestId("admin-customer-operations")).toContainText("RECHARGE · SUCCEEDED");
  await expect(detail).not.toContainText("5450200000900910");
  await expect(detail).not.toContainText("665");
  await expect(detail).not.toContainText("9999");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => document.documentElement.clientWidth),
  );
  await customerCard.click();
  await expect(customerCard).toHaveAttribute("aria-expanded", "false");
  await expect(cardTransactions).toHaveCount(0);

  await page.getByTestId("admin-customer-inviter").click();
  await expect(page.locator(".admin-customer-detail-profile strong")).toHaveText("inviter@example.com");
  await expect(page.getByTestId("admin-customer-inviter")).toHaveCount(0);

  await page.getByRole("button", { name: "返回客户列表", exact: true }).click();
  await expect(customer).toBeVisible();
  await expect(page.getByTestId("admin-customer-filters")).toBeVisible();
});

test("customer opens a support ticket and replies in the same thread", async ({ page }) => {
  await mockAuthenticatedShell(page, "user");
  const now = new Date().toISOString();
  let tickets = [{
    id: 31, userId: 7, email: "customer@example.com", subject: "已有工单", status: "open",
    handledBy: null, messageCount: 1, lastMessage: "需要帮助", lastMessageAt: now,
    createdAt: now, updatedAt: now, category: "other", cardId: null, cardNumberMasked: null, cardProductCode: null, unreadCount: 1,
  }];
  let messages = [{ id: 41, senderUserId: 7, senderRole: "customer", body: "需要帮助", createdAt: now }];
  await page.route("**/api/support/tickets", async (route) => {
    if (route.request().method() === "POST") {
      const input = route.request().postDataJSON() as { subject: string; message: string; category: string; cardId: number | null };
      expect(input).toMatchObject({ category: "card_payment", cardId: 91 });
      tickets = [{ ...tickets[0], id: 32, subject: input.subject, lastMessage: input.message, category: input.category, cardId: input.cardId, cardNumberMasked: "545020 **** 4242", unreadCount: 0 }];
      messages = [{ ...messages[0], id: 42, body: input.message }];
      return route.fulfill({ json: { code: 0, data: { ticket: tickets[0], messages } } });
    }
    return route.fulfill({ json: { code: 0, data: tickets } });
  });
  await page.route("**/api/support/tickets/*", (route) => route.fulfill({
    json: { code: 0, data: { ticket: tickets[0], messages } },
  }));
  await page.route("**/api/support/tickets/*/messages", async (route) => {
    const input = route.request().postDataJSON() as { message: string };
    messages = [...messages, { id: 43, senderUserId: 7, senderRole: "customer", body: input.message, createdAt: now }];
    return route.fulfill({ json: { code: 0, data: { ticket: tickets[0], messages } } });
  });
  await page.route("**/api/cards", (route) => route.fulfill({ json: { code: 0, data: { total: 1, list: [{ id: 91, cardNumberMasked: "545020 **** 4242", productCode: "G5554LC", network: "Mastercard", issuingArea: "US", status: "ACTIVE", balance: "20.0000", refundKeepMinimum: "0", firstName: "Ada", lastName: "Lovelace", pendingOperationId: null, pendingOperationType: null, createdAt: now }] } } }));

  await page.goto("/support");
  await expect(page.getByRole("heading", { name: "工单中心", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "已有工单", exact: true })).toBeVisible();
  await expect(page.getByText("需要帮助", { exact: true })).toBeVisible();
  expect(await page.locator(".support-thread-header").evaluate((element) => {
    const style = getComputedStyle(element);
    return [style.paddingLeft, style.paddingRight];
  })).toEqual(["30px", "30px"]);
  await page.getByLabel("工单标题").fill("新的支付问题");
  await page.getByLabel("反馈类型").click();
  await page.getByRole("option", { name: "卡片支付" }).click();
  await page.getByLabel("关联卡片（可选）").click();
  await page.getByRole("option", { name: "545020 **** 4242 · G5554LC" }).click();
  await page.getByLabel("问题描述").fill("请检查这笔订单");
  await page.getByRole("button", { name: "提交工单", exact: true }).click();
  await expect(page.getByRole("heading", { name: "新的支付问题", exact: true })).toBeVisible();
  await page.getByLabel("继续回复").fill("补充订单号 123");
  await page.getByRole("button", { name: "发送回复", exact: true }).click();
  await expect(page.getByText("补充订单号 123", { exact: true })).toBeVisible();
});

test("admin filters, replies to, and resolves support tickets", async ({ page }) => {
  await mockAuthenticatedShell(page);
  await mockAdminWorkspace(page);
  const now = new Date().toISOString();
  let status = "open";
  let messages = [{ id: 51, senderUserId: 7, senderRole: "customer", body: "支付未到账", createdAt: now }];
  const ticket = () => ({
    id: 61, userId: 7, email: "customer@example.com", subject: "支付问题", status,
    handledBy: null, messageCount: messages.length, lastMessage: messages.at(-1)?.body ?? null,
    lastMessageAt: now, createdAt: now, updatedAt: now, category: "card_payment", cardId: 91,
    cardNumberMasked: "545020 **** 4242", cardProductCode: "G5554LC", unreadCount: 1,
  });
  await page.route("**/api/admin/support/tickets?*", (route) => route.fulfill({ json: { code: 0, data: [ticket()] } }));
  await page.route("**/api/admin/support/tickets/61", async (route) => {
    if (route.request().method() === "PATCH") status = (route.request().postDataJSON() as { status: string }).status;
    return route.fulfill({ json: { code: 0, data: { ticket: ticket(), messages } } });
  });
  await page.route("**/api/admin/support/tickets/61/messages", async (route) => {
    const input = route.request().postDataJSON() as { message: string };
    status = "in_progress";
    messages = [...messages, { id: 52, senderUserId: 1, senderRole: "admin", body: input.message, createdAt: now }];
    return route.fulfill({ json: { code: 0, data: { ticket: ticket(), messages } } });
  });

  await page.goto("/admin");
  await page.getByTestId("admin-nav-support").click();
  await expect(page.getByTestId("admin-panel-support")).toContainText("支付问题");
  await page.getByLabel("回复客户").fill("已开始核查");
  await page.getByRole("button", { name: "发送回复", exact: true }).click();
  await expect(page.getByText("已开始核查", { exact: true })).toBeVisible();
  await page.getByLabel("工单状态").click();
  await page.getByRole("option", { name: "已解决", exact: true }).click();
  await expect(page.getByLabel("工单状态")).toContainText("已解决");
});

test("admin opens a customer detail view with scoped and filterable records", async ({ page }) => {
  await mockAuthenticatedShell(page);
  const financialRequests: string[] = [];
  const depositRequests: string[] = [];
  const spendingRequests: string[] = [];
  const auditRequests: string[] = [];
  await mockAdminWorkspace(page, {
    onCustomerFinancialRequest: (url) => financialRequests.push(url),
    onAdminDepositsRequest: (url) => depositRequests.push(url),
    onCustomerSpendingRequest: (url) => spendingRequests.push(url),
    onCustomerAuditRequest: (url) => auditRequests.push(url),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin");
  await page.getByTestId("admin-nav-customers").click();
  await page.locator(".admin-customer-row").filter({ hasText: "customer@example.com" }).getByRole("button", { name: "查看详情", exact: true }).click();

  const records = page.getByTestId("admin-customer-records");
  const financial = page.getByTestId("admin-customer-financial-table");
  await expect(financial).toContainText("admin_adjust");
  await expect(financial).toContainText("26.25 → 31.5");
  await expect(financial).toContainText("Manual customer credit");
  expect(new URL(financialRequests.at(-1)!).searchParams.get("user")).toBe("7");

  await records.getByRole("button", { name: "充值记录", exact: true }).click();
  const deposits = page.getByTestId("admin-customer-deposit-table");
  await expect(deposits).toContainText("00000000-0000-0000-0000-000000000101");
  await deposits.getByText("查看具体日志", { exact: true }).click();
  await expect(deposits).toContainText("充值订单已创建");
  expect(new URL(depositRequests.at(-1)!).searchParams.get("user")).toBe("7");
  await records.locator('select[name="network"]').selectOption("SOL");
  await records.getByRole("button", { name: "筛选", exact: true }).click();
  await expect.poll(() => new URL(depositRequests.at(-1)!).searchParams.get("network")).toBe("SOL");

  await records.getByRole("button", { name: "卡消费流水", exact: true }).click();
  const spending = page.getByTestId("admin-customer-spending-table");
  await expect(spending).toContainText("auth-customer-7");
  await expect(spending).toContainText("完整生命周期 · 1");
  expect(new URL(spendingRequests.at(-1)!).pathname).toBe("/api/admin/users/7/card-spending");
  await records.locator('select[name="status"]').selectOption("SETTLED");
  await records.getByRole("button", { name: "筛选", exact: true }).click();
  await expect.poll(() => new URL(spendingRequests.at(-1)!).searchParams.get("status")).toBe("SETTLED");

  await records.getByRole("button", { name: "客户日志", exact: true }).click();
  await expect(page.getByTestId("admin-customer-audit-table")).toContainText("adjust_wallet");
  expect(new URL(auditRequests.at(-1)!).searchParams.get("user")).toBe("7");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => document.documentElement.clientWidth),
  );
});

test("admin opens a dedicated customer card workspace without scrolling through the profile", async ({ page }) => {
  await mockAuthenticatedShell(page);
  await mockAdminWorkspace(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/admin");
  await page.getByTestId("admin-nav-customers").click();
  const customer = page.locator(".admin-customer-row").filter({ hasText: "customer@example.com" });
  await customer.getByRole("button", { name: "查看卡片", exact: true }).click();

  await expect(page).toHaveURL(/customerId=7.*view=cards/);
  await expect(page.getByTestId("admin-customer-card-page")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("admin-customer-cards")).toBeVisible();
  await expect(page.locator(".admin-customer-card-inline-actions").getByRole("button", { name: "显示完整信息", exact: true })).toBeVisible();
  await expect(page.locator(".admin-customer-card-inline-actions").getByRole("button", { name: "销卡", exact: true })).toBeVisible();
  await expect(page.locator(".admin-customer-card-transactions > .admin-card-actions")).toHaveCount(0);
  await expect(page.getByTestId("admin-customer-management")).toBeHidden();
  await expect(page.getByRole("button", { name: "卡消费流水", exact: true })).toHaveAttribute("aria-current", "page");
  const cardTop = await page.getByTestId("admin-customer-cards").evaluate((element) => element.getBoundingClientRect().top);
  expect(cardTop).toBeLessThan(500);

  await page.getByRole("button", { name: "客户概览", exact: false }).click();
  await expect(page).not.toHaveURL(/view=cards/);
  await expect(page.getByTestId("admin-customer-management")).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId("admin-customer-card-page").click();
  await expect(page.getByTestId("admin-customer-cards")).toBeVisible();
  await expect.poll(() => page.getByTestId("admin-customer-cards").evaluate((element) => getComputedStyle(element).animationName)).toBe("admin-customer-cards-in");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => document.documentElement.clientWidth),
  );
});

test("admin opens a customer detail view after filtering and manages profile commands", async ({ page }) => {
  await mockAuthenticatedShell(page);
  const listUrls: string[] = [];
  const commands: Array<{ body: Record<string, unknown>; key: string }> = [];
  await mockAdminWorkspace(page, {
    onCustomerListRequest: (url) => listUrls.push(url),
    onCustomerProfileAction: (body, key) => commands.push({ body, key }),
  });
  await page.goto("/admin");
  await page.getByTestId("admin-nav-customers").click();

  const filters = page.getByTestId("admin-customer-filters");
  await filters.locator("summary").click();
  await filters.locator('[name="q"]').fill("#7");
  await filters.locator('[name="rechargeMin"]').fill("10");
  await filters.locator('[name="referralsMin"]').fill("2");
  await filters.locator('[name="createdFrom"]').fill("2026-08-01");
  await filters.locator('[name="sort"]').selectOption("cumulativeRecharge");
  await filters.getByRole("button", { name: "应用筛选", exact: true }).click();
  await expect.poll(() => listUrls.at(-1) ?? "").toContain("q=%237");
  const filteredUrl = new URL(listUrls.at(-1)!);
  expect(Object.fromEntries(filteredUrl.searchParams)).toMatchObject({
    page: "1", page_size: "20", q: "#7", rechargeMin: "10", referralsMin: "2",
    createdFrom: "2026-08-01", sort: "cumulativeRecharge", direction: "desc",
  });

  await page.getByRole("button", { name: "查看详情", exact: true }).click();
  const inviter = page.getByTestId("admin-customer-inviter-form");
  await inviter.locator('[name="inviterId"]').fill("9");
  await inviter.locator('[name="reason"]').fill("Customer requested inviter reassignment");
  await inviter.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => commands.length).toBe(1);

  const inviteCode = page.getByTestId("admin-customer-invite-code-form");
  await inviteCode.locator('[name="inviteCode"]').fill("666");
  await inviteCode.locator('[name="reason"]').fill("Customer requested memorable code 666");
  await inviteCode.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => commands.length).toBe(2);

  const telegram = page.getByTestId("admin-customer-telegram-unbind-form");
  await telegram.locator('[name="reason"]').fill("Customer requested Telegram account unlink");
  page.once("dialog", (dialog) => dialog.accept());
  await telegram.getByRole("button", { name: "解绑 Telegram", exact: true }).click();
  await expect.poll(() => commands.length).toBe(3);
  expect(commands.map((command) => command.body)).toEqual([
    { action: "setInviter", inviterId: 9, reason: "Customer requested inviter reassignment" },
    { action: "setInviteCode", inviteCode: "666", reason: "Customer requested memorable code 666" },
    { action: "unbindTelegram", reason: "Customer requested Telegram account unlink" },
  ]);
  expect(new Set(commands.map((command) => command.key)).size).toBe(3);
  expect(commands.every((command) => /^[0-9a-f-]{36}$/.test(command.key))).toBe(true);
});

test("admin resets a customer password from management", async ({ page }) => {
  await mockAuthenticatedShell(page);
  const payloads: Record<string, unknown>[] = [];
  await mockAdminWorkspace(page, { onCustomerPasswordReset: (body) => payloads.push(body) });
  await page.goto("/admin");
  await page.getByTestId("admin-nav-customers").click();
  await page.getByRole("button", { name: "查看详情", exact: true }).click();
  const form = page.getByTestId("admin-customer-password-reset-form");
  await form.getByLabel("新密码", { exact: true }).fill("CustomerReset123!");
  await form.getByLabel("确认密码", { exact: true }).fill("DoesNotMatch123!");
  await form.getByRole("button", { name: "重置密码", exact: true }).click();
  await expect(page.getByTestId("admin-customer-management").getByRole("status")).toContainText("两次输入的密码不一致");
  await form.getByLabel("确认密码", { exact: true }).fill("CustomerReset123!");
  page.once("dialog", (dialog) => dialog.accept());
  await form.getByRole("button", { name: "重置密码", exact: true }).click();
  await expect(page.getByTestId("admin-customer-management")).toContainText("客户密码已重置，所有登录会话已失效");
  expect(payloads).toEqual([{ password: "CustomerReset123!", confirmPassword: "CustomerReset123!" }]);
});

test("admin opens a customer detail view again after profile recent-auth", async ({ page }) => {
  expect(adminCustomerReturnPath(7)).toBe("/admin?panel=customers&customerId=7");
  expect(adminCustomerReturnPath(7, 71, "funds")).toBe("/admin?panel=customers&customerId=7&cardId=71&from=funds");
  expect(parseAdminCustomerReturnPath("/admin?panel=customers&customerId=7&cardId=71")).toEqual({ customerId: 7, cardId: 71 });
  expect(parseAdminCustomerReturnPath("/admin?panel=customers&customerId=7&view=cards")).toEqual({ customerId: 7, cardId: null, view: "cards" });
  expect(parseAdminCustomerReturnPath("/admin?customerId=7&panel=customers&from=funds")).toEqual({ customerId: 7, cardId: null, from: "funds" });
  for (const rejected of [
    "/admin?panel=customers&customerId=0", "/admin?panel=customers&customerId=7&cardId=-1",
    "/admin?panel=customers&customerId=7&from=unknown", "/admin?panel=customers&customerId=7&view=profile", "/admin?panel=customers&customerId=999999999999999999999",
  ]) expect(parseAdminCustomerReturnPath(rejected)).toBeNull();

  await mockAuthenticatedShell(page);
  await mockRecentAuthLogin(page);
  await mockAdminWorkspace(page, { customerProfileRecentAuth: true });
  await page.goto("/admin");
  await page.getByTestId("admin-nav-customers").click();
  await page.getByRole("button", { name: "查看详情", exact: true }).click();
  const form = page.getByTestId("admin-customer-invite-code-form");
  await form.locator('[name="inviteCode"]').fill("777");
  await form.locator('[name="reason"]').fill("Customer requested memorable code 777");
  await form.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByTestId("admin-customer-detail").getByRole("alert")).toContainText("请重新认证后继续敏感操作");
  await page.getByTestId("admin-customer-detail").getByRole("button", { name: "重新登录验证", exact: true }).click();
  const returnPath = "/admin?panel=customers&customerId=7&from=customers";
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("recentAuthReturnPath"))).toBe(returnPath);
  await expect(page).toHaveURL(/\/login$/);
  await page.getByPlaceholder("your@email.com").fill("admin@danewcard.local");
  await page.getByPlaceholder("8+").fill("Admin123!Secure");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\?panel=customers&customerId=7&from=customers$/);
  await expect(page.getByTestId("admin-customer-detail")).toContainText("customer@example.com");
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("recentAuthReturnPath"))).toBeNull();
});

test("admin opens a customer detail view with its card after sensitive recent-auth", async ({ page }) => {
  let sensitiveRequests = 0;
  await mockAuthenticatedShell(page);
  await mockRecentAuthLogin(page);
  await mockAdminWorkspace(page, {
    customerSensitiveRecentAuth: true,
    onCustomerSensitive: () => { sensitiveRequests += 1; },
  });
  await page.goto("/admin");
  await page.getByTestId("admin-nav-customers").click();
  await page.getByRole("button", { name: "查看详情", exact: true }).click();
  await page.getByTestId("admin-customer-card-71").click();
  await page.getByTestId("admin-customer-card-sensitive-71").click();
  await expect(page.getByRole("alert")).toContainText("风险操作需要重新登录");
  await page.getByRole("button", { name: "重新登录验证", exact: true }).click();
  const returnPath = "/admin?panel=customers&customerId=7&cardId=71&from=customers";
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("recentAuthReturnPath"))).toBe(returnPath);
  await page.getByPlaceholder("your@email.com").fill("admin@danewcard.local");
  await page.getByPlaceholder("8+").fill("Admin123!Secure");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\?panel=customers&customerId=7&cardId=71&from=customers$/);
  await expect(page.getByTestId("admin-customer-card-71")).toHaveAttribute("aria-expanded", "true");
  await page.getByTestId("admin-customer-card-sensitive-71").click();
  await expect(page.getByTestId("admin-customer-card-sensitive-data-71")).toContainText("4111111111110910");
  expect(sensitiveRequests).toBe(2);
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("recentAuthReturnPath"))).toBeNull();
});

test("admin labels Telegram-only records without exposing internal principals", async ({ page }) => {
  await mockAuthenticatedShell(page);
  await mockAdminWorkspace(page, { telegramOnlyAdminRecords: true });
  await page.goto("/admin");

  await page.getByTestId("admin-nav-customers").click();
  const customer = page.locator(".admin-customer-row").first();
  await expect(customer.locator(".admin-customer-summary strong")).toHaveText("@customer_tg");
  await customer.getByRole("button", { name: "查看详情", exact: true }).click();
  await expect(page.locator(".admin-customer-detail-profile strong")).toHaveText("@customer_tg");
  await expect(page.getByTestId("admin-customer-referrals").locator("strong").first()).toHaveText("#8");
  await expect(page.getByTestId("admin-customer-password-reset-form")).toContainText("仍需通过 Telegram 登录");

  await page.getByTestId("admin-nav-cards").click();
  await expect(page.getByTestId("admin-cards-table").locator("tbody tr").first().locator("td").nth(1)).toHaveText("—");

  await page.getByTestId("admin-nav-funds").click();
  await expect(page.getByTestId("admin-deposit-table").locator("tbody tr").first().locator("td").nth(1).getByRole("button", { name: "#7", exact: true })).toBeVisible();
  await expect(page.getByTestId("admin-money-table").locator("tbody tr").first().locator("td").nth(1)).toContainText("—");
  await expect(page.getByTestId("admin-financial-events-table").locator("tbody tr").first().locator("td").nth(2)).toHaveText("—");
  await expect(page.locator(".transaction-row").filter({ hasText: "Telegram-only reconciliation" }).locator("strong").first()).toContainText("— · OPEN_CARD");

  await page.getByTestId("admin-nav-rewards").click();
  const rewards = page.getByTestId("admin-panel-rewards");
  await expect(rewards.getByText("#7 · $1", { exact: true })).toBeVisible();
  await rewards.getByRole("button", { name: "查看参与人（21）", exact: true }).click();
  await expect(rewards.getByTestId("lottery-participants-42").locator("strong").first()).toHaveText("#7");

  await page.getByTestId("admin-nav-audit").click();
  await expect(page.getByTestId("admin-audit-table").locator("tbody tr").first().locator("td").nth(1)).toContainText("—");
  await expect(page.locator("body")).not.toContainText("tg:");
});

test("admin resolves summarized customer risk with an idempotent fee settlement", async ({ page }) => {
  await mockAuthenticatedShell(page);
  const actions: Array<{ body: Record<string, unknown>; key: string }> = [];
  await mockAdminWorkspace(page, {
    customerStatus: "suspended",
    customerRiskHold: true,
    customerRisk: {
      holdReasons: ["customer_card_fee_unpaid"],
      owedCharges: {
        count: 3,
        total: "0.8000",
        byKind: [
          { kind: "DECLINE_FEE", count: 2, total: "0.6000" },
          { kind: "LOW_AUTH_FEE", count: 1, total: "0.2000" },
        ],
      },
    },
    onCustomerRiskAction: (body, key) => actions.push({ body, key }),
  });
  await page.goto("/admin");
  await page.getByTestId("admin-nav-customers").click();
  await page.getByRole("button", { name: "查看详情", exact: true }).click();

  const risk = page.getByTestId("admin-customer-risk");
  await expect(risk).toContainText("3");
  await expect(risk).toContainText("$0.8");
  await expect(risk).toContainText("customer_card_fee_unpaid");
  await expect(page.getByTestId("admin-customer-risk-kinds")).toContainText("DECLINE_FEE");
  await expect(page.getByTestId("admin-customer-risk-kinds")).toContainText("2 笔");

  await risk.getByLabel("处理备注", { exact: true }).fill("Reviewed authoritative fee ledger");
  await risk.getByRole("button", { name: "结清费用并解除冻结", exact: true }).click();
  await expect.poll(() => actions.length).toBe(2);
  expect(actions.map((item) => item.body)).toEqual([
    { action: "resolve_risk_charges", userId: 7, remark: "Reviewed authoritative fee ledger" },
    { action: "clear_risk_hold", userId: 7, remark: "Reviewed authoritative fee ledger", riskHoldReason: "customer_card_fee_unpaid" },
  ]);
  expect(actions[0].key).toMatch(/^[0-9a-f-]{36}$/);
  expect(actions.slice(1).every((item) => item.key === "")).toBe(true);
  expect(JSON.stringify(actions)).not.toMatch(/auth.?id|card.?id|provider.?id/i);
  await expect(risk.getByText("费用和风险冻结已处理，请单独核验账户状态。", { exact: true })).toBeVisible();
});


test("admin expanded upstream fields keep sibling product card compact", async ({ page }) => {
  await mockAuthenticatedShell(page);
  await mockAdminWorkspace(page);
  const product = {
    productCode: "P5378OX", issuer: "SpaceX", network: "VISA", issuingArea: "US", cardType: "Virtual",
    openFee: "0.4000", rechargeRate: "0.005000", refundRate: "0.125000", minAmount: "10.0000", maxAmount: "10000.0000",
    description: "Upstream virtual card", category: "AI subscriptions", active: true, version: 1,
    createdAt: "2026-08-01T08:00:00Z", updatedAt: "2026-08-01T08:01:00Z",
    providerCode: "spacex", upstreamProductCode: "P5378OX", costOpenFee: "0.4000",
    costRechargeRate: "0.005000", costRtfRate: "0.100000", upstreamAvailable: true,
    upstreamEnabled: true, upstreamCanOpen: true, upstreamSort: 300,
    upstreamMetadata: { network: "VISA", card_group: "P5378OX", usage_policy: { can_open: true } },
    costVersion: 2, costSyncedAt: "2026-08-01T08:01:00Z", restrictedMerchants: [],
    googleChatgptBlocked: false, upstreamDescription: "Upstream virtual card",
    upstreamCategory: "AI subscriptions", descriptionOverride: null, categoryOverride: null,
  };
  await page.route("**/api/admin/products", (route) => route.fulfill({ json: { code: 0, data: [
    product,
    { ...product, productCode: "P5378OY", upstreamProductCode: "P5378OY" },
  ] } }));

  await page.goto("/admin");
  await page.getByTestId("admin-nav-costs").click();
  const expandedCard = page.getByTestId("admin-product-P5378OX");
  const siblingCard = page.getByTestId("admin-product-P5378OY");
  const siblingHeightBefore = (await siblingCard.boundingBox())!.height;

  await expandedCard.getByText("完整上游产品字段", { exact: true }).click();
  await expect(expandedCard.locator(".admin-upstream-metadata pre")).toContainText('"card_group": "P5378OX"');
  const [expandedHeight, siblingHeightAfter] = await Promise.all([
    expandedCard.boundingBox().then((box) => box!.height),
    siblingCard.boundingBox().then((box) => box!.height),
  ]);

  expect(expandedHeight - siblingHeightAfter).toBeGreaterThan(40);
  expect(Math.abs(siblingHeightAfter - siblingHeightBefore)).toBeLessThanOrEqual(1);
});

test("admin saves product presentation and customers see the effective description and category", async ({ page }) => {
  await mockAdminWorkspace(page);
  let product = {
    productCode: "P5378OX", issuer: "SpaceX", network: "VISA", issuingArea: "US", cardType: "Virtual",
    openFee: "0.4000", rechargeRate: "0.005000", minAmount: "10.0000", maxAmount: "10000.0000",
    description: "Upstream virtual card", category: "AI subscriptions / Advertising",
    active: true, version: 1, createdAt: "2026-08-01T08:00:00Z", updatedAt: "2026-08-01T08:01:00Z",
    providerCode: "spacex", upstreamProductCode: "P5378OX", costOpenFee: "0.4000", costRechargeRate: "0.005000",
    costRtfRate: "0.100000", upstreamAvailable: true, costVersion: 2, costSyncedAt: "2026-08-01T08:01:00Z",
    upstreamEnabled: true, upstreamCanOpen: true, upstreamSort: 300,
    upstreamMetadata: { network: "VISA", card_group: "P5378OX", bin_heads: ["537872"], usage_policy: { can_open: true } },
    restrictedMerchants: [], googleChatgptBlocked: false,
    upstreamDescription: "Upstream virtual card", upstreamCategory: "AI subscriptions / Advertising", descriptionOverride: null, categoryOverride: null,
  };
  let presentationRequest: unknown;
  await page.route("**/api/admin/products**", async (route) => {
    if (route.request().method() === "PATCH") {
      presentationRequest = route.request().postDataJSON();
      const input = presentationRequest as { descriptionOverride: string | null; categoryOverride: string | null };
      product = { ...product, description: input.descriptionOverride ?? product.upstreamDescription, category: input.categoryOverride ?? product.upstreamCategory, ...input, version: product.version + 1 };
      await route.fulfill({ json: { code: 0, data: { productCode: product.productCode, version: product.version } } });
      return;
    }
    await route.fulfill({ json: { code: 0, data: [product] } });
  });
  await page.route("**/api/products", (route) => route.fulfill({ json: { code: 0, data: [product] } }));

  await page.goto("/admin");
  await page.getByTestId("admin-nav-costs").click();
  const adminProduct = page.getByTestId("admin-product-P5378OX");
  await expect(adminProduct).toContainText("上游允许开卡");
  await adminProduct.getByText("完整上游产品字段", { exact: true }).click();
  await expect(adminProduct.locator(".admin-upstream-metadata pre")).toContainText('"card_group": "P5378OX"');
  await adminProduct.getByRole("button", { name: "编辑介绍", exact: true }).click();
  const presentationEditor = page.getByRole("region", { name: "卡片介绍与分类", exact: true });
  await expect(presentationEditor.locator("textarea[readonly]")).toHaveValue("Upstream virtual card");
  await presentationEditor.locator('textarea[name="descriptionOverride"]').fill("适合 AI 订阅与广告投放的专属虚拟卡。");
  await presentationEditor.locator('input[name="categoryOverride"]').fill("AI订阅 / 广告");
  await presentationEditor.getByRole("button", { name: "保存介绍与分类", exact: true }).click();
  await expect.poll(() => presentationRequest).toEqual({ version: 1, descriptionOverride: "适合 AI 订阅与广告投放的专属虚拟卡。", categoryOverride: "AI订阅 / 广告" });
  await expect(presentationEditor).toHaveCount(0);
  await expect(adminProduct).toContainText("适合 AI 订阅与广告投放的专属虚拟卡。");

  await page.getByTestId("app-sidebar").getByRole("link", { name: "开卡中心", exact: true }).click();
  const customerProduct = page.getByTestId("product-P5378OX");
  await expect(customerProduct).toContainText("适合 AI 订阅与广告投放的专属虚拟卡。");
  await expect(customerProduct.locator('[aria-label="适用分类"]')).toContainText("AI订阅");
  await customerProduct.getByRole("link", { name: "了解并开卡", exact: true }).click();
  await expect(page.getByText("适合 AI 订阅与广告投放的专属虚拟卡。", { exact: true })).toBeVisible();
  await expect(page.locator('[aria-label="适用分类"]')).toContainText("广告");
});

test("card product admin API enforces role, validation, uniqueness, and optimistic locking", async ({ page, request }) => {
  expect(process.env.E2E_DATABASE_URL).toBeTruthy();
  execFileSync("psql", [process.env.E2E_DATABASE_URL!, "-v", "ON_ERROR_STOP=1", "-c",
    "DELETE FROM auth_rate_counters WHERE scope = 'session_write_user'"],
  { stdio: "ignore" });
  const stamp = Date.now();
  const code = `E2E_API_${stamp}`;
  const product = {
    code,
    issuer: "E2E Issuer",
    network: "MASTERCARD",
    issuingArea: "US",
    cardType: "Virtual",
    openFee: "1.0000",
    rechargeRate: "0.010000",
    minAmount: "5.0000",
    maxAmount: "50.0000",
    active: true,
  };
  const customerEmail = `product-rbac-${stamp}@example.com`;
  expect((await request.post("/api/auth/register", {
    data: { email: customerEmail, password: "StrongRegister123!" },
  })).status()).toBe(200);
  expect((await request.post("/api/auth/login", {
    data: { email: customerEmail, password: "StrongRegister123!" },
  })).status()).toBe(200);
  expect((await request.get("/api/admin/products")).status()).toBe(403);
  expect((await request.post("/api/admin/products", { data: product })).status()).toBe(403);
  expect((await request.patch(`/api/admin/products/${code}`, {
    data: { ...product, code: undefined, version: 0 },
  })).status()).toBe(403);
  expect((await request.patch(`/api/admin/products/${code}/presentation`, {
    data: { version: 0, descriptionOverride: "forbidden", categoryOverride: "AI" },
  })).status()).toBe(403);

  const invalidProducts = [
    { ...product, code: "<script>" },
    { ...product, code: `E2E_RATE_${stamp}`, rechargeRate: "1.000001" },
    { ...product, code: `E2E_RANGE_${stamp}`, minAmount: "50.0000", maxAmount: "5.0000" },
    { ...product, code: `E2E_SCALE_${stamp}`, openFee: "1.00001" },
  ];
  for (const input of invalidProducts) {
    const response = await page.request.post("/api/admin/products", { data: input });
    expect(response.status(), await response.text()).toBe(400);
  }

  const created = await page.request.post("/api/admin/products", { data: product });
  expect(created.status(), await created.text()).toBe(200);
  expect((await created.json()).data).toEqual({ productCode: code, version: 0 });
  const duplicate = await page.request.post("/api/admin/products", {
    data: { ...product, code: ` ${code.toLowerCase()} ` },
  });
  expect(duplicate.status()).toBe(409);

  const update = (issuer: string) => ({
    issuer,
    network: product.network,
    issuingArea: product.issuingArea,
    cardType: product.cardType,
    openFee: product.openFee,
    rechargeRate: product.rechargeRate,
    minAmount: product.minAmount,
    maxAmount: product.maxAmount,
    active: false,
    version: 0,
  });
  const missingActive: Partial<ReturnType<typeof update>> = update("Missing active");
  delete missingActive.active;
  expect((await page.request.patch(`/api/admin/products/${code}`, {
    data: missingActive,
  })).status()).toBe(400);
  const concurrent = await Promise.all([
    page.request.patch(`/api/admin/products/${code}`, { data: update("E2E Issuer A") }),
    page.request.patch(`/api/admin/products/${code}`, { data: update("E2E Issuer B") }),
  ]);
  expect(concurrent.map((response) => response.status()).sort()).toEqual([200, 409]);

  expect((await page.request.patch(`/api/admin/products/${code}/presentation`, {
    data: { version: 1, descriptionOverride: "x".repeat(2001), categoryOverride: "AI" },
  })).status()).toBe(400);
  expect((await page.request.patch(`/api/admin/products/${code}/presentation`, {
    data: { version: 1, descriptionOverride: "Safe", categoryOverride: "AI\nunsafe" },
  })).status()).toBe(400);
  const presentation = await page.request.patch(`/api/admin/products/${code}/presentation`, {
    data: { version: 1, descriptionOverride: "Card for AI subscriptions", categoryOverride: "AI / Subscriptions" },
  });
  const presentationBody = await presentation.json();
  expect(presentation.status(), JSON.stringify(presentationBody)).toBe(200);
  expect(presentationBody.data.version).toBe(2);
  expect((await page.request.patch(`/api/admin/products/${code}/presentation`, {
    data: { version: 1, descriptionOverride: "stale", categoryOverride: "AI" },
  })).status()).toBe(409);
  const restored = await page.request.patch(`/api/admin/products/${code}/presentation`, {
    data: { version: 2, descriptionOverride: null, categoryOverride: null },
  });
  expect(restored.status(), await restored.text()).toBe(200);

  const productsResponse = await page.request.get("/api/admin/products");
  expect(productsResponse.status()).toBe(200);
  const matches = (await productsResponse.json()).data.filter(
    (item: { productCode: string }) => item.productCode === code,
  );
  expect(matches).toHaveLength(1);
  expect(matches[0]).toMatchObject({ active: false, version: 3, descriptionOverride: null, categoryOverride: null, description: null, category: null });
  expect(["E2E Issuer A", "E2E Issuer B"]).toContain(matches[0].issuer);
});

test("admin-created products stay unavailable until bound to a healthy upstream", async ({ page }) => {
  const code = `CARD_UI_${Date.now()}_US`;
  const created = await page.request.post("/api/admin/products", {
    data: {
      code,
      issuer: "E2E Bank",
      network: "MASTERCARD",
      issuingArea: "CA",
      cardType: "Virtual",
      openFee: "1",
      rechargeRate: "0.01",
      minAmount: "5",
      maxAmount: "50",
      active: true,
    },
  });
  expect(created.status(), await created.text()).toBe(200);
  await page.goto("/admin");
  await page.getByTestId("admin-nav-costs").click();

  const adminProduct = page.getByTestId(`admin-product-${code}`);
  await expect(adminProduct).toBeVisible();
  await expect(adminProduct).toContainText("MASTERCARD");
  await expect(adminProduct.getByRole("button", { name: "停用", exact: true })).toBeVisible();

  await page.getByTestId("app-sidebar").getByRole("link", { name: "开卡中心", exact: true }).click();
  await expect(page.getByTestId(`product-${code}`)).toHaveCount(0);
  const rejectedOpen = await page.request.post("/api/cards/open", {
    headers: { "idempotency-key": `unbound-product-${Date.now()}` },
    data: { productCode: code, firstName: "Product", lastName: "E2E", initAmount: "5", count: 1,
      expectedOpenFee: "1.0000", expectedInitialRechargeFee: "0.0500", openQuoteVersion: "a".repeat(64) },
  });
  expect(rejectedOpen.status()).toBe(404);

  await page.getByTestId("app-sidebar").getByRole("link", { name: "管理", exact: true }).click();
  await page.getByTestId("admin-nav-costs").click();
  await adminProduct.getByRole("button", { name: "停用", exact: true }).click();
  await expect(adminProduct.getByRole("button", { name: "启用", exact: true })).toBeVisible();
});

test("admin reconciliation submits the clicked resolution status", async ({ page }) => {
  let submittedStatus = "";
  await page.route("**/api/admin/reconciliation", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { code: 0, data: [{
        id: 999001, operationId: "00000000-0000-0000-0000-000000000001", type: "refund",
        operationStatus: "SUCCEEDED", dispatchState: "CONFIRMED", provider: "spacex",
        upstreamBusinessId: "upstream-evidence-1", amount: "10.0000", fee: "0.0000",
        totalAmount: "10.0000", reason: "E2E reconciliation item", lastError: null,
        email: "admin@danewcard.local", status: "OPEN", createdAt: new Date().toISOString(),
      }] } });
      return;
    }
    submittedStatus = (await route.request().postDataJSON()).status;
    await route.fulfill({ json: { code: 0 } });
  });
  await page.goto("/admin");
  await page.getByTestId("admin-nav-funds").click();
  const item = page.locator(".transaction-row").filter({ hasText: "E2E reconciliation item" });
  await item.getByPlaceholder("至少 10 字的核验说明").fill("E2E verified reconciliation note");
  await item.getByRole("button", { name: "忽略并留痕", exact: true }).click();
  await expect.poll(() => submittedStatus).toBe("IGNORED");
});

test("admin cannot close reconciliation without a reliable money-operation outcome", async ({ page }) => {
  await page.route("**/api/admin/reconciliation", async (route) => {
    await route.fulfill({ json: { code: 0, data: [{
      id: 999002, operationId: "00000000-0000-0000-0000-000000000002", type: "refund",
      operationStatus: "RECONCILE_REQUIRED", dispatchState: "UNKNOWN", provider: "spacex",
      upstreamBusinessId: null, amount: "10.0000", fee: "0.0000", totalAmount: "10.0000",
      reason: "E2E unknown upstream outcome", lastError: "upstream timeout",
      email: "admin@danewcard.local", status: "OPEN", createdAt: new Date().toISOString(),
    }] } });
  });
  await page.goto("/admin");
  await page.getByTestId("admin-nav-funds").click();
  const item = page.locator(".transaction-row").filter({ hasText: "E2E unknown upstream outcome" });
  await expect(item).toContainText("资金操作仍未取得可靠终态，必须保持待对账，不能只修改标签");
  await expect(item.getByPlaceholder("至少 10 字的核验说明")).toHaveCount(0);
  await expect(item.getByRole("button", { name: "忽略并留痕", exact: true })).toHaveCount(0);
});

test("admin reconciliation reports concurrent review conflicts and refreshes", async ({ page }) => {
  let listRequests = 0;
  await page.route("**/api/admin/reconciliation", async (route) => {
    if (route.request().method() === "GET") {
      listRequests += 1;
      await route.fulfill({ json: { code: 0, data: [{
        id: 999003, operationId: "00000000-0000-0000-0000-000000000003", type: "refund",
        operationStatus: "SUCCEEDED", dispatchState: "CONFIRMED", provider: "spacex",
        upstreamBusinessId: "upstream-evidence-3", amount: "10.0000", fee: "0.0000",
        totalAmount: "10.0000", reason: "E2E concurrent reconciliation", lastError: null,
        email: "admin@danewcard.local", status: "OPEN", createdAt: new Date().toISOString(),
      }] } });
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill({ status: 409, json: { code: 409, error: "该对账项已由其他管理员处理" } });
  });
  await page.goto("/admin");
  await page.getByTestId("admin-nav-funds").click();
  const item = page.locator(".transaction-row").filter({ hasText: "E2E concurrent reconciliation" });
  await item.getByPlaceholder("至少 10 字的核验说明").fill("E2E concurrent reconciliation note");
  const submit = item.getByRole("button", { name: "忽略并留痕", exact: true });
  await submit.click();
  await expect(submit).toBeDisabled();
  await expect(page.getByRole("alert")).toContainText("该对账项已由其他管理员处理");
  await expect.poll(() => listRequests).toBeGreaterThanOrEqual(2);
});

test("settings only displays a Telegram bind code after an explicit one-time request", async ({ page }) => {
  await mockAuthenticatedShell(page);
  const code = "A".repeat(32);
  await page.route("**/api/settings", (route) => route.fulfill({ json: { code: 0, data: {
    email: "admin@danewcard.local", role: "admin", status: "active", memberTier: "none",
    inviteCode: "DANEW", avatarUrl: null, cumulativeRecharge: "0.0000",
    createdAt: "2026-08-13T00:00:00Z", nextTier: null,
  } } }));
  await page.route("**/api/telegram", (route) => route.fulfill({ json: { code: 0, data: {
    botConfigured: true, botName: "playwright_local_bot", isBound: false, chatId: null, username: null,
  } } }));
  await page.route("**/api/telegram/bind-code", (route) => route.fulfill({ json: {
    code: 0, data: { bindCode: code },
  } }));
  await page.goto("/settings");
  await expect(page.getByTestId("telegram-bind-code")).toHaveCount(0);
  await page.getByRole("button", { name: "生成绑定码", exact: true }).click();
  await expect(page.getByTestId("telegram-bind-code")).toHaveText(/^\/start [A-F0-9]{32}$/);
  await expect(page.getByTestId("telegram-bind-code")).not.toContainText("playwright-telegram-secret");
  await expect(page.getByText("绑定码仅本次显示，10 分钟内有效；重新生成会立即使当前码失效。", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "重新生成（当前码会立即失效）", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "打开 Telegram Bot", exact: true }))
    .toHaveAttribute("href", `https://t.me/playwright_local_bot?start=${code}`);
  await page.reload();
  await expect(page.getByTestId("telegram-bind-code")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "生成绑定码", exact: true })).toBeVisible();
});

test("Telegram unbinding requires the emailed one-time code before signing out", async ({ page }) => {
  await mockAuthenticatedShell(page);
  const challengeId = "123e4567-e89b-42d3-a456-426614174000";
  let issued = 0;
  let confirmed: Record<string, unknown> | null = null;
  await page.route("**/api/settings", (route) => route.fulfill({ json: { code: 0, data: {
    email: "admin@danewcard.local", role: "admin", status: "active", memberTier: "none",
    inviteCode: "DANEW", avatarUrl: null, cumulativeRecharge: "0.0000",
    createdAt: "2026-08-13T00:00:00Z", nextTier: null,
  } } }));
  await page.route("**/api/telegram", (route) => {
    if (route.request().method() === "DELETE") {
      confirmed = route.request().postDataJSON() as Record<string, unknown>;
      return route.fulfill({ json: { code: 0, msg: "unbound", data: { loginRequired: true, replayed: false } } });
    }
    return route.fulfill({ json: { code: 0, data: {
      botConfigured: true, botName: "playwright_local_bot", isBound: true,
      chatId: "990000001", username: "e2e_admin",
    } } });
  });
  await page.route("**/api/telegram/unbind-code", (route) => {
    issued += 1;
    return route.fulfill({ json: { code: 0, msg: "sent", data: {
      challengeId, maskedEmail: "a***@danewcard.local", expiresInSeconds: 600, cooldownSeconds: 60,
    } } });
  });
  await page.goto("/settings");
  await expect(page.getByRole("button", { name: "发送邮箱验证码后解绑", exact: true })).toBeVisible();
  expect(confirmed).toBeNull();
  await page.getByRole("button", { name: "发送邮箱验证码后解绑", exact: true }).click();
  await expect(page.getByText("验证码已发送至 a***@danewcard.local。为防止 Telegram 账号被盗后被直接解绑，必须在这里完成邮箱验证。", { exact: true })).toBeVisible();
  await expect(page.getByLabel("6 位邮箱验证码", { exact: true })).toHaveAttribute("autocomplete", "one-time-code");
  await expect(page.getByRole("button", { name: /秒后可重发$/ })).toBeDisabled();
  expect(issued).toBe(1);
  await page.getByLabel("6 位邮箱验证码", { exact: true }).fill("004271");
  await page.getByRole("button", { name: "确认解绑并退出登录", exact: true }).click();
  await expect.poll(() => confirmed).toEqual({ challengeId, code: "004271" });
  await expect(page).toHaveURL(/\/login$/);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("session"))).toBeNull();
});

test("Telegram login landing resumes the cookie session and redirects to an allowed page", async ({ page, context }) => {
  await page.goto("/login");
  await context.clearCookies();
  await page.evaluate(() => localStorage.removeItem("session"));
  await context.addCookies([{
    name: "danew_refresh", value: "telegram-refresh-cookie", domain: "127.0.0.1",
    path: "/api/auth/refresh", httpOnly: true, secure: false, sameSite: "Strict",
  }]);
  let dashboardCalls = 0;
  let refreshCalls = 0;
  let retriedWithSessionCookie = false;
  await page.route("**/api/auth/refresh", (route) => {
    refreshCalls += 1;
    expect(route.request().headers()["authorization"]).toBeUndefined();
    expect(route.request().headers()["cookie"]).toContain("danew_refresh=telegram-refresh-cookie");
    return route.fulfill({
      status: 204,
      headers: { "set-cookie": "danew_session=telegram-access-cookie; HttpOnly; SameSite=Strict; Path=/api" },
    });
  });
  await page.route("**/api/dashboard", (route) => {
    dashboardCalls += 1;
    expect(route.request().headers()["authorization"]).toBe("Bearer");
    const cookie = route.request().headers()["cookie"] ?? "";
    expect(cookie).not.toContain("danew_refresh=");
    if (dashboardCalls === 1) {
      expect(cookie).not.toContain("danew_session=");
      return route.fulfill({ status: 401, json: { error: "Access expired", errorCode: "AUTH_REQUIRED" } });
    }
    retriedWithSessionCookie ||= cookie.includes("danew_session=telegram-access-cookie");
    return route.fulfill({ json: {
      email: "telegram@example.com", role: "user", walletBalance: "0.0000", cardBalance: "0.0000",
      cardCount: 0, inviteCode: "TELEGRAM",
    } });
  });
  await page.route("**/api/announcements/unread", (route) => route.fulfill({ json: {
    code: 0, data: [], unreadCount: 0,
  } }));
  await page.goto("/telegram-login?next=%2Fdashboard");
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("session") ?? "null"))).toEqual({
    token: "", email: "telegram@example.com", mfaLevel: "telegram",
  });
  expect(refreshCalls).toBe(1);
  expect(dashboardCalls).toBeGreaterThanOrEqual(2);
  expect(retriedWithSessionCookie).toBe(true);
});

test("Telegram webhook accepts private updates, acknowledges unsafe binding, and cannot mutate funds", async ({ page, request }) => {
  setE2eAdminTelegramBinding(false);
  const secret = "playwright-telegram-secret-at-least-32";
  const webhook = (update: Record<string, unknown>, suppliedSecret = secret) => page.request.post("/api/webhooks/telegram", {
    headers: { "x-telegram-bot-api-secret-token": suppliedSecret },
    data: update,
  });
  const privateUpdate = (updateId: number, chatId: number, text: string, username = "e2e_user") => ({
    update_id: updateId,
    message: {
      message_id: updateId,
      date: 1_786_054_400,
      chat: { id: chatId, type: "private", first_name: "E2E", username },
      from: { id: chatId, is_bot: false, first_name: "E2E", username },
      text,
    },
  });
  const bindingCode = async (suffix: string) => {
    const email = `telegram-${suffix}-${Date.now()}@example.com`;
    expect((await request.post("/api/auth/register", {
      data: { email, password: "StrongRegister123!" },
    })).status()).toBe(200);
    expect((await request.post("/api/auth/login", {
      data: { email, password: "StrongRegister123!" },
    })).status()).toBe(200);
    const status = await request.get("/api/telegram");
    expect(status.status()).toBe(200);
    expect((await status.json()).data).toMatchObject({
      botConfigured: true, botName: "playwright_local_bot", isBound: false, bindCode: null,
    });
    const response = await request.post("/api/telegram/bind-code");
    expect(response.status()).toBe(200);
    const code = (await response.json()).data.bindCode as string;
    expect(code).toMatch(/^[A-F0-9]{32}$/);
    return code;
  };
  const financialSnapshot = async () => {
    const [pointsResponse, walletResponse, ledgerResponse, referralResponse, marketingResponse] = await Promise.all([
      page.request.get("/api/points"),
      page.request.get("/api/wallet"),
      page.request.get("/api/wallet/transactions?page_size=100"),
      page.request.get("/api/referral"),
      page.request.get("/api/admin/lottery"),
    ]);
    for (const response of [pointsResponse, walletResponse, ledgerResponse, referralResponse, marketingResponse]) {
      expect(response.status()).toBe(200);
    }
    const [points, wallet, ledger, referral, marketing] = await Promise.all([
      pointsResponse.json(), walletResponse.json(), ledgerResponse.json(), referralResponse.json(), marketingResponse.json(),
    ]);
    return {
      pointBalance: points.data.balance,
      pointLedger: points.data.history,
      walletBalance: wallet.data.balance,
      walletLedger: ledger.data,
      promoBalance: referral.data.promoBalance,
      cumulativePromoEarnings: referral.data.cumulativeEarnings,
      promoLedger: referral.data.txList,
      marketingBudget: marketing.data.marketingBudget,
    };
  };

  const bindCodeResponse = await page.request.post("/api/telegram/bind-code");
  expect(bindCodeResponse.status()).toBe(200);
  const code = (await bindCodeResponse.json()).data.bindCode as string;
  expect(code).toMatch(/^[A-F0-9]{32}$/);
  const primaryChatId = 92_001_001;
  const bindUpdate = privateUpdate(92_001, primaryChatId, `/start ${code}`, "e2e_primary");
  expect((await webhook(bindUpdate, "invalid-playwright-telegram-secret")).status()).toBe(401);
  const missingUpdateId: Record<string, unknown> = { ...bindUpdate };
  delete missingUpdateId.update_id;
  expect((await webhook(missingUpdateId)).status()).toBe(400);
  expect((await webhook(bindUpdate)).status()).toBe(200);
  const replayedBind = await webhook(bindUpdate);
  expect(replayedBind.status()).toBe(200);
  expect(await replayedBind.json()).toEqual({ ok: true, replayed: true });
  expect((await webhook(privateUpdate(92_002, primaryChatId, `/start ${code}`, "e2e_primary"))).status()).toBe(200);

  const groupCode = await bindingCode("group");
  const groupBind = {
    update_id: 92_003,
    message: {
      message_id: 92_003,
      date: 1_786_054_400,
      chat: { id: -100_092_003, type: "supergroup", title: "E2E group" },
      from: { id: 92_003_001, is_bot: false, first_name: "E2E" },
      text: `/start ${groupCode}`,
    },
  };
  expect((await webhook(groupBind)).status()).toBe(200);
  const unboundAfterGroup = await request.get("/api/telegram");
  expect(unboundAfterGroup.status()).toBe(200);
  expect((await unboundAfterGroup.json()).data.isBound).toBe(false);
  expect((await webhook(privateUpdate(92_004, 92_004_001, `/start ${groupCode}`))).status()).toBe(200);

  const expiredCode = await bindingCode("expired");
  expect(process.env.E2E_DATABASE_URL).toBeTruthy();
  execFileSync("psql", [process.env.E2E_DATABASE_URL!, "-v", "ON_ERROR_STOP=1", "-c",
    `UPDATE telegram_bindings SET expires_at=now()-interval '1 second' WHERE bind_code='${expiredCode}'`],
  { stdio: "ignore" });
  expect((await webhook(privateUpdate(92_005, 92_005_001, `/start ${expiredCode}`))).status()).toBe(200);

  const concurrentCode = await bindingCode("concurrent");
  const concurrent = await Promise.all(Array.from({ length: 8 }, (_, index) => webhook(
    privateUpdate(92_100 + index, 92_100_000 + index, `/start ${concurrentCode}`, `e2e_concurrent_${index}`),
  )));
  expect(concurrent.every((response) => response.status() === 200)).toBe(true);
  const concurrentBinding = await request.get("/api/telegram");
  expect(concurrentBinding.status()).toBe(200);
  expect((await concurrentBinding.json()).data).toMatchObject({ isBound: true });

  const beforeCommands = await financialSnapshot();
  for (const [index, command] of ["/checkin", "/redeem", "/withdraw"].entries()) {
    const response = await webhook(privateUpdate(92_201 + index, primaryChatId, command, "e2e_primary"));
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  }
  expect(await financialSnapshot()).toEqual(beforeCommands);
});

test("register a new account", async ({ page }) => {
  const email = `e2e-${Date.now()}@example.com`;
  await page.goto("/register");
  await page.getByPlaceholder("your@email.com").fill(email);
  await page.getByPlaceholder("12+ characters").fill("StrongRegister123!");
  await page.getByPlaceholder("e.g. INVITE2026").fill("DANEW");
  await page.getByRole("button", { name: "创建账户", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/, { timeout: 15_000 });
  await page.getByPlaceholder("your@email.com").fill(email);
  await page.getByPlaceholder("8+").fill("StrongRegister123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.locator("#main-content").getByText(email, { exact: true })).toBeVisible();
});

test("login throttles at the exact failed-password boundary", async ({ request }) => {
  const headers = { "x-real-ip": "198.51.100.58" };
  const belowLimit = `below-limit-${Date.now()}@example.com`;
  const atLimit = `at-limit-${Date.now()}@example.com`;
  for (const email of [belowLimit, atLimit]) {
    expect((await request.post("/api/auth/register", {
      headers,
      data: { email, password: "StrongRegister123!" },
    })).status()).toBe(200);
  }
  for (let attempt = 0; attempt < 4; attempt += 1) {
    expect((await request.post("/api/auth/login", {
      headers,
      data: { email: belowLimit, password: "WrongPassword123!" },
    })).status()).toBe(401);
  }
  expect((await request.post("/api/auth/login", {
    headers,
    data: { email: belowLimit, password: "StrongRegister123!" },
  })).status()).toBe(200);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    expect((await request.post("/api/auth/login", {
      headers,
      data: { email: atLimit, password: "WrongPassword123!" },
    })).status()).toBe(401);
  }
  expect((await request.post("/api/auth/login", {
    headers,
    data: { email: atLimit, password: "StrongRegister123!" },
  })).status()).toBe(429);
});

test("unknown-cost referral stays deferred and promo withdrawal is atomic and idempotent", async ({ page }) => {
  await syncFundingRate(page);
  const before = (await (await page.request.get("/api/referral")).json()).data;
  expect(before.policy.directOnly).toBe(true);
  expect(before.policy.tierRewards).toEqual(expect.any(Array));
  const email = `referred-${Date.now()}@example.com`;
  expect((await page.request.post("/api/auth/register", {
    data: { email, password: "StrongRegister123!", inviteCode: "DANEW" },
  })).status()).toBe(200);
  expect((await page.request.post("/api/auth/login", {
    data: { email, password: "StrongRegister123!" },
  })).status()).toBe(200);
  const deposit = await page.request.post("/api/deposit/create", {
    data: { currency: "USDT", network: "TRON", amount: "100" },
  });
  const depositData = (await deposit.json()).data;
  const gatewayRef = depositData.gatewayRef;
  const body = JSON.stringify({
    gatewayRef, txHash: `0xref-${Date.now()}`, amount: depositData.expectedAmount,
    currency: "USDT", network: "TRON", confirmationStatus: "finalized", transactionSucceeded: true,
  });
  const signature = createHmac("sha256", "playwright-deposit-secret-at-least-32").update(body).digest("hex");
  const confirmed = await page.request.post("/api/webhooks/deposit", {
    headers: { "content-type": "application/json", "x-signature": signature }, data: body,
  });
  expect(confirmed.status()).toBe(200);
  await confirmed.json();
  const replay = await page.request.post("/api/webhooks/deposit", {
    headers: { "content-type": "application/json", "x-signature": signature }, data: body,
  });
  expect(replay.status()).toBe(200);
  expect((await replay.json()).data.replayed).toBe(true);
  expect((await page.request.post("/api/auth/login", {
    data: { email: "admin@danewcard.local", password: "Admin123!Secure" },
  })).status()).toBe(200);
  const afterEarn = (await (await page.request.get("/api/referral")).json()).data;
  expect(afterEarn.promoBalance).toBe(before.promoBalance);
  expect(afterEarn.depositRebate).toBe(before.depositRebate);
  expect(afterEarn.cumulativeEarnings).toBe(before.cumulativeEarnings);
  await page.goto("/referral");
  const promo = page.locator(".referral-stats article").filter({ hasText: "返利余额" });
  await expect(promo.getByRole("strong")).toHaveText(`$${fixed4(decimalUnits(before.promoBalance, 4))}`);
  const walletBefore = decimalUnits((await (await page.request.get("/api/wallet")).json()).data.balance, 4);
  const key = `referral-e2e-${Date.now()}`;
  const responses = await Promise.all(Array.from({ length: 20 }, () => page.request.post(
    "/api/referral/withdraw", { headers: { "idempotency-key": key } },
  )));
  expect(responses.every((response) => response.status() === 200)).toBe(true);
  const payloads = await Promise.all(responses.map((response) => response.json()));
  expect(payloads.filter((payload) => !payload.data.replayed)).toHaveLength(1);
  const afterWithdraw = (await (await page.request.get("/api/referral")).json()).data;
  expect(afterWithdraw.promoBalance).toBe("0.0000");
  expect(decimalUnits(afterWithdraw.cumulativeEarnings, 4)).toBe(decimalUnits(afterEarn.cumulativeEarnings, 4));
  expect(decimalUnits((await (await page.request.get("/api/wallet")).json()).data.balance, 4) - walletBefore)
    .toBe(decimalUnits(before.promoBalance, 4));
  await page.reload();
  await expect(promo.getByRole("strong")).toHaveText("$0");
});

test("admin lottery draws once and pays from the marketing budget", async ({ page }) => {
  setE2eAdminTelegramBinding(true);
  const walletBefore = decimalUnits((await (await page.request.get("/api/wallet")).json()).data.balance, 6);
  const budgetBefore = decimalUnits((await (await page.request.get("/api/admin/lottery")).json()).data.marketingBudget, 6);
  const created = await page.request.post("/api/admin/lottery", {
    headers: { "idempotency-key": `lottery-create-${Date.now()}` },
    data: {
      action: "create", title: "E2E audited draw", endsAt: new Date(Date.now() + 86_400_000).toISOString(), costPoints: 10, maxTicketsPerUser: 1,
      prizes: [{ label: "$5 wallet credit", qty: 1, type: "balance", value: "5" }],
    },
  });
  expect(created.status()).toBe(200);
  const activityId = (await created.json()).data.id;
  expect((await page.request.post("/api/lottery", {
    headers: { "idempotency-key": `lottery-join-${Date.now()}` },
    data: { activityId, tickets: 1 },
  })).status()).toBe(200);
  const drawKey = `lottery-draw-${Date.now()}`;
  const draw = await page.request.post("/api/admin/lottery", {
    headers: { "idempotency-key": drawKey }, data: { action: "draw", id: activityId },
  });
  expect(draw.status()).toBe(200);
  expect((await draw.json()).data.status).toBe("drawing");
  const replay = await page.request.post("/api/admin/lottery", {
    headers: { "idempotency-key": drawKey }, data: { action: "draw", id: activityId },
  });
  expect((await replay.json()).replayed).toBe(true);
  await expect.poll(async () => {
    const response = await page.request.get("/api/admin/lottery");
    return (await response.json()).data.activities.find((activity: { id: number }) => activity.id === activityId)?.status;
  }, { timeout: 30_000 }).toBe("closed");
  const winners = await page.request.get(`/api/lottery?action=winners&id=${activityId}`);
  expect(winners.status()).toBe(200);
  expect((await winners.json()).data).toHaveLength(1);
  expect(decimalUnits((await (await page.request.get("/api/wallet")).json()).data.balance, 6)).toBe(walletBefore + 5_000_000n);
  const adminLottery = await page.request.get("/api/admin/lottery");
  expect(decimalUnits((await adminLottery.json()).data.marketingBudget, 6)).toBe(budgetBefore - 5_000_000n);
});

test("unknown-cost referral remains deferred with an empty marketing budget", async ({ page, request }) => {
  setE2eAdminTelegramBinding(true);
  const budget = (await (await page.request.get("/api/admin/lottery")).json()).data.marketingBudget;
  if (Number(budget) > 0) {
    const created = await page.request.post("/api/admin/lottery", {
      headers: { "idempotency-key": `drain-create-${Date.now()}` },
      data: {
        action: "create", title: "E2E budget drain", endsAt: new Date(Date.now() + 86_400_000).toISOString(), costPoints: 1, maxTicketsPerUser: 1,
        prizes: [{ label: "Budget drain", qty: 1, type: "balance", value: budget }],
      },
    });
    expect(created.status()).toBe(200);
    const activityId = (await created.json()).data.id;
    expect((await page.request.post("/api/lottery", {
      headers: { "idempotency-key": `drain-join-${Date.now()}` }, data: { activityId, tickets: 1 },
    })).status()).toBe(200);
    expect((await page.request.post("/api/admin/lottery", {
      headers: { "idempotency-key": `drain-draw-${Date.now()}` }, data: { action: "draw", id: activityId },
    })).status()).toBe(200);
    await expect.poll(async () => {
      const response = await page.request.get("/api/admin/lottery");
      return (await response.json()).data.activities.find((activity: { id: number }) => activity.id === activityId)?.status;
    }, { timeout: 30_000 }).toBe("closed");
  }
  expect(Number((await (await page.request.get("/api/admin/lottery")).json()).data.marketingBudget)).toBe(0);
  await syncFundingRate(page);
  const before = (await (await page.request.get("/api/referral")).json()).data;

  const email = `profit-funded-${Date.now()}@example.com`;
  expect((await request.post("/api/auth/register", {
    data: { email, password: "StrongRegister123!", inviteCode: "DANEW" },
  })).status()).toBe(200);
  expect((await request.post("/api/auth/login", {
    data: { email, password: "StrongRegister123!" },
  })).status()).toBe(200);
  const deposit = await request.post("/api/deposit/create", {
    data: { currency: "USDT", network: "TRON", amount: "100" },
  });
  const depositData = (await deposit.json()).data;
  const gatewayRef = depositData.gatewayRef;
  const txHash = `0xdeferred-${Date.now()}`;
  const body = JSON.stringify({
    gatewayRef, txHash, amount: depositData.expectedAmount,
    currency: "USDT", network: "TRON", confirmationStatus: "finalized", transactionSucceeded: true,
  });
  const signature = createHmac("sha256", "playwright-deposit-secret-at-least-32").update(body).digest("hex");
  const confirmed = await request.post("/api/webhooks/deposit", {
    headers: { "content-type": "application/json", "x-signature": signature }, data: body,
  });
  expect(confirmed.status()).toBe(200);
  const credited = (await confirmed.json()).data.creditedAmount;
  const replay = await request.post("/api/webhooks/deposit", {
    headers: { "content-type": "application/json", "x-signature": signature }, data: body,
  });
  expect((await replay.json()).data.replayed).toBe(true);
  expect((await (await request.get("/api/wallet")).json()).data.balance).toBe(credited);
  const pending = await page.request.get("/api/admin/marketing/deferred");
  expect((await pending.json()).data.find((item: { refId: string }) => item.refId === txHash)).toBeUndefined();
  const after = (await (await page.request.get("/api/referral")).json()).data;
  expect(after.promoBalance).toBe(before.promoBalance);
  expect(after.depositRebate).toBe(before.depositRebate);
  expect(after.cumulativeEarnings).toBe(before.cumulativeEarnings);
  expect(Number((await (await page.request.get("/api/admin/lottery")).json()).data.marketingBudget)).toBe(0);
});

test("card GPT occupation explains the blocked actions and links the original order", async ({ page }) => {
  await mockAuthenticatedShell(page, "user");
  const operationId = "00000000-0000-0000-0000-000000009530";
  let occupied = true;
  const card = () => ({ id: 70953, cardNumberMasked: "•••• •••• •••• 9530", productCode: "GPT_TEST",
    network: "VISA", issuingArea: "US", status: "ACTIVE", refundKeepMinimum: "0.1000",
    firstName: "Card", lastName: "Test", createdAt: "2026-09-09T00:00:00Z", balance: "127.8800",
    pendingOperationId: occupied ? operationId : null, pendingOperationType: occupied ? "GPT_DIRECT" : null });
  await page.route("**/api/products", route => route.fulfill({json:{code:0,data:[]}}));
  await page.route("**/api/gpt-direct/card-successes", route => route.fulfill({json:{code:0,data:{list:[]}}}));
  await page.route("**/api/cards", route => route.fulfill({json:{code:0,data:{total:1,list:[card()]}}}));
  await page.route("**/api/cards/70953", route => route.fulfill({json:{code:0,data:{...card(),
    availableAmount:"127.8800",issuer:"Test",note:"",minAmount:"10",maxAmount:"1000",
    rechargeRate:"0",refundRate:"0",autoDeleteDeclines:4,expiry:"12/29"}}}));
  await page.route("**/api/cards/70953/ledger", route => route.fulfill({json:{code:0,data:{activities:[],transactions:[]}}}));
  await page.route(`**/api/operations/${operationId}`, route => route.fulfill({json:{code:0,data:{
    operationId,type:"GPT_DIRECT",status:occupied ? "PENDING" : "FAILED",terminal:!occupied,
    dispatchState:occupied ? "CONFIRMED" : "FAILED",error:null,result:null,updatedAt:"2026-09-09T05:30:00Z"
  }}}));
  await page.goto("/cards/owned");
  await expect(page.getByRole("link", {name:"查看直充订单"})).toHaveAttribute("href", `/gpt-direct/orders/${operationId}`);
  await page.locator('a[href="/cards/70953"]').click();
  const notice = page.locator(".card-pending-operation");
  await expect(notice).toContainText("直充订单占用此卡");
  await expect(notice).not.toContainText("资金操作核验中");
  await expect(notice.getByRole("link", {name:"查看直充订单"})).toHaveAttribute("href", `/gpt-direct/orders/${operationId}`);
  await expect(page.getByRole("button", {name:"充值",exact:true})).toBeDisabled();
  await expect(page.getByRole("button", {name:"退款",exact:true})).toBeDisabled();
  occupied = false;
  await expect(notice).toHaveCount(0, {timeout:15_000});
  await expect(page.getByRole("button", {name:"充值",exact:true})).toBeEnabled();
  await expect(page.getByRole("button", {name:"退款",exact:true})).toBeEnabled();
});

for (const entryPoint of ["list", "detail"] as const) test(`pending card refund completes and refreshes wallet from ${entryPoint}`, async ({ page }) => {
  await mockAuthenticatedShell(page, "user");
  const operationId = "00000000-0000-0000-0000-000000000944";
  let submitted = false;
  let complete = false;
  let writes = 0;
  let walletReads = 0;
  const card = { id: 70944, cardNumberMasked: "•••• •••• •••• 0944", productCode: "REFUND_ASYNC",
    network: "VISA", issuingArea: "US", status: "ACTIVE", refundKeepMinimum: "0.1000",
    firstName: "Refund", lastName: "Test", createdAt: "2026-09-07T00:00:00Z" };
  const current = () => ({ ...card, balance: complete ? "0.8600" : "129.8600",
    pendingOperationId: submitted && !complete ? operationId : null,
    pendingOperationType: submitted && !complete ? "REFUND" : null });
  await page.route("**/api/products", route => route.fulfill({json:{code:0,data:[]}}));
  await page.route("**/api/gpt-direct/card-successes", route => route.fulfill({json:{code:0,data:{list:[]}}}));
  await page.route("**/api/support/tickets", route => route.fulfill({json:{code:0,data:[]}}));
  await page.route("**/api/wallet", route => { walletReads++; return route.fulfill({json:{code:0,data:{balance:complete ? "229" : "100",currency:"USD"}}}); });
  await page.route("**/api/cards", route => route.fulfill({json:{code:0,data:{total:1,list:[current()]}}}));
  await page.route(`**/api/cards/${card.id}`, route => route.fulfill({json:{code:0,data:{...current(),
    availableAmount:current().balance,issuer:"Test",note:"",minAmount:"10",maxAmount:"1000",
    rechargeRate:"0",refundRate:"0",autoDeleteDeclines:4,expiry:"12/29"}}}));
  await page.route(`**/api/cards/${card.id}/ledger`, route => route.fulfill({json:{code:0,data:{activities:[],transactions:[]}}}));
  await page.route(`**/api/cards/${card.id}/actions`, route => {
    writes++; submitted = true;
    return route.fulfill({status:202,json:{operationId,status:"PENDING",error:"pending"}});
  });
  await page.route(`**/api/operations/${operationId}`, route => route.fulfill({json:{code:0,data:{
    operationId,type:"REFUND",status:complete ? "SUCCEEDED" : "PENDING",terminal:complete,
    dispatchState:complete ? "CONFIRMED" : "DISPATCHING",error:null,
    result:complete ? {cardBalance:"0.8600",walletBalance:"229"} : null,
    updatedAt:complete ? "2026-09-07T07:13:25Z" : "2026-09-07T07:13:11Z"
  }}}));
  await page.route("**/api/wallet/transactions", route => route.fulfill({json:{code:0,data:{total:0,list:[]}}}));
  await page.goto("/finance");
  await expect(page.getByTestId("wallet-balance-summary")).toContainText("$100");
  await page.locator('a[href="/cards/owned"]').first().click();
  await expect(page.locator(`a[href="/cards/${card.id}"]`)).toBeVisible();
  if (entryPoint === "detail") await page.locator(`a[href="/cards/${card.id}"]`).first().click();
  await page.getByRole("button", {name:"退款",exact:true}).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("spinbutton").fill("129");
  await dialog.getByRole("button", {name:"确认操作",exact:true}).click();
  await expect(page).toHaveURL(new RegExp(`/cards/${card.id}$`));
  await expect(dialog).not.toBeVisible();
  await expect(page.locator(".card-pending-operation")).toContainText("可离开页面");
  const before = walletReads;
  complete = true;
  await expect(page.getByText("退款已完成，款项已退回账户余额。", {exact:true})).toBeVisible();
  await expect(page.locator(".card-pending-operation")).toHaveCount(0);
  await expect(page.locator(".card-operations-panel")).toContainText("当前可退$0.76");
  await page.locator('a[href="/finance"]').first().click();
  await expect(page.getByTestId("wallet-balance-summary")).toContainText("$229");
  await expect.poll(() => walletReads).toBeGreaterThan(before);
  expect(writes).toBe(1);
});

test("admin real profit keeps exact loss, evidence and export on one snapshot", async ({ page }) => {
  await mockAuthenticatedShell(page);
  await mockAdminWorkspace(page);
  const id = "00000000-0000-0000-0000-000000000991";
  let generations = 0;
  const summary = { revenue: "11", cost: "12", fundingFee: "1.20426", reward: "0", subsidy: "0", netProfit: "-2.20426", pendingReceipts: "20", confirmedCount: 2, pendingCount: 1, excludedCount: 0, isFinal: false, warnings: ["历史充值手续费凭证尚未完整"], ruleVersion: "actual-evidence-v1", currency: "USD", timezone: "Asia/Shanghai" };
  const report = { id, generatedAt: "2026-09-09T00:00:00Z", filters: {}, summary, total: 1 };
  await page.route("**/api/admin/profit/reports", route => { generations++; return route.fulfill({ json: { code: 0, data: report } }); });
  await page.route(`**/api/admin/profit/reports/${id}?page=*`, route => route.fulfill({ json: { code: 0, data: { ...report, page: 1, pageSize: 50, list: [{ key: "upstream:7", businessDate: "2026-09-09", occurredAt: report.generatedAt, providerId: 1, userId: null, operationId: null, kind: "UPSTREAM", status: "pending", reason: "待核实归属", revenue: null, cost: null, fundingFee: "0", reward: "0", subsidy: "0", profit: null, sourceAmount: "-12", fingerprint: "proof-v1", reviewable: true, evidence: { upstreamId: 99, amount: "-12" } }, { key: "wallet:2336", businessDate: "2026-09-10", occurredAt: report.generatedAt, providerId: 3, userId: 407, operationId: null, kind: "CARD_FEE", status: "confirmed", reason: "已实收手续费；成本另列", revenue: "0.3", cost: null, fundingFee: "0", reward: "0", subsidy: "0", profit: null, sourceAmount: "-0.3", fingerprint: "fee-proof", reviewable: false, evidence: { feeCharges: [{ chargeId: 66, kind: "DECLINE_FEE", userEmail: "fee-user@example.test", cardId: 163, cardLast4: "6181", transactionId: 9001, merchantName: "TEST MERCHANT", transactionAmount: "91.95", transactionCurrency: "USD", transactionTime: "2026-09-10T07:42:00Z", costSources: [] }] } }] } } }));
  await page.route("**/api/admin/profit/connections", route => route.fulfill({ json: { code: 0, data: [] } }));
  let exported = "";
  await page.route(`**/api/admin/profit/reports/${id}/export`, route => { exported = route.request().url(); return route.fulfill({ contentType: "text/csv", body: `报表编号,净利润\n${id},-2.20426\n` }); });
  const reviews: unknown[] = [];
  await page.route("**/api/admin/profit/reviews", route => { reviews.push(route.request().postDataJSON()); return route.fulfill({ json: { code: 0, data: { id: 1 } } }); });
  await page.goto("/admin");
  await page.getByTestId("admin-nav-profit").click();
  const panel = page.getByTestId("admin-profit");
  await expect(panel.getByText("业务净收益（充值费按 0.2%）", { exact: true })).toBeVisible();
  await expect(panel.getByText("$-2.20426", { exact: true })).toBeVisible();
  await expect(panel.getByText("最终业务净利润", { exact: true })).toHaveCount(0);
  const feeRow = panel.getByRole("row").filter({ hasText: "wallet:2336" });
  await expect(feeRow).toContainText("交易拒付手续费");
  await expect(feeRow.getByRole("link", { name: "用户 #407", exact: true })).toHaveAttribute("href", "/admin?panel=customers&customerId=407");
  await expect(feeRow.getByRole("link", { name: "卡片 #163 · 尾号 6181" })).toHaveAttribute("href", "/admin?panel=customers&customerId=407&cardId=163");
  await expect(feeRow).toContainText("TEST MERCHANT");
  await expect(feeRow).toContainText("USD 91.95");
  await expect(feeRow).toContainText("已收手续费");
  await expect(feeRow).toContainText("不能据此认定零成本");
  await expect(feeRow.getByRole("cell").nth(7)).toContainText("收入行，不代表单笔净利润");
  await expect(feeRow.getByRole("cell").nth(7)).not.toContainText("$0.3");
  await panel.getByRole("button", { name: "导出当前报表 CSV" }).click();
  await expect.poll(() => exported).toContain(id);
  expect(generations).toBe(1);
  await panel.getByRole("row").filter({ hasText: "upstream:7" }).getByRole("button", { name: "查看凭证" }).click();
  const dialog = page.getByRole("dialog", { name: "真实资金凭证" });
  await expect(dialog).toContainText('"upstreamId": 99');
  await dialog.getByLabel("核对结论").selectOption("non_business");
  await dialog.getByLabel("凭证依据与核对说明").fill("核对原始订单确认属于另一个平台的业务扣款");
  await dialog.getByRole("button", { name: "保存核对记录" }).click();
  await expect.poll(() => reviews.length).toBe(1);
  expect(reviews[0]).toMatchObject({ sourceKey: "upstream:7", fingerprint: "proof-v1", classification: "non_business" });
  await expect.poll(() => generations).toBe(2);
  await expect(dialog).not.toBeVisible();
  await feeRow.getByRole("button", { name: "查看凭证" }).click();
  await expect(dialog).toContainText("交易拒付手续费");
  await expect(dialog.getByRole("link", { name: "卡片 #163 · 尾号 6181" })).toBeVisible();
  await dialog.getByRole("button", { name: "关闭凭证" }).click();
  await expect(dialog).not.toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "../artifacts/profit-admin-mobile.png", fullPage: true });

  await expect(panel.getByRole("form", { name: "连接上游账单" })).toHaveCount(0);
  await expect(panel.getByText(/无需网页登录 Token/)).toBeVisible();
  await expect(panel.getByText(/固定费率口径/)).toBeVisible();
});

test("GPT custom credits switches by clicking visible Plus and Pro cards", async ({ page }, testInfo) => {
  let submitted: Record<string, unknown> | undefined;
  await mockAuthenticatedShell(page, "customer");
  await mockGptDirect(page, { includeCreditPlans: true, currentPlan: "free", availablePlans: ["plus", "pro_5x", "pro_20x", "credits_250"], onCreate: body => { submitted = body; } });
  await page.route("**/api/support/tickets**", route => route.fulfill({ json: { code: 0, data: [] } }));
  await page.goto("/gpt-direct");
  const quantity = page.getByTestId("gpt-credits-custom-quantity");
  const custom = page.locator('input[value="credits_custom"]');
  for (const preflight of [false, true]) {
    if (preflight) {
      await quantity.fill("249");
      await page.locator('.gpt-plan-options label').filter({ has: page.locator('input[value="plus"]') }).locator("strong").click();
      await page.getByLabel("Session 凭据", { exact: true }).fill("credits-session-token");
      await page.getByRole("button", { name: "验证凭据与获取报价", exact: true }).click();
      await expect(page.getByText("订阅实时报价", { exact: true })).toBeVisible();
    }
    for (const draft of ["", "800", "249", "12.5", "10000000", "abc"]) {
      for (const plan of ["plus", "pro_5x", "pro_20x", "credits_250"]) {
        await quantity.fill(draft);
        await expect(custom).toBeChecked();
        if (preflight && draft !== "800") {
          await expect(page.getByRole("button", { name: /^(提交额度直充|提交开通)$/ })).toBeDisabled();
        }
        const card = page.locator('.gpt-plan-options label').filter({ has: page.locator(`input[value="${plan}"]`) });
        await card.locator("strong").click();
        await expect(card).toHaveClass("is-selected");
        await expect(custom).not.toBeChecked();
        if (preflight && plan === "plus") await expect(page.getByText("订阅实时报价", { exact: true })).toBeVisible();
      }
    }
  }
  await quantity.fill("800");
  await expect(quantity).toHaveCSS("font-size", "16px");
  await expect(quantity).toHaveCSS("color", "rgb(25, 25, 25)");
  await quantity.blur();
  await expect(quantity).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await page.screenshot({ path: testInfo.outputPath("switch-contrast.png"), fullPage: true });
  await page.getByTestId("gpt-credits-plans").screenshot({ path: testInfo.outputPath("quantity-detail.png") });
  await page.locator('.gpt-plan-options label').filter({ has: page.locator('input[value="plus"]') }).locator("strong").click();
  await page.getByRole("button", { name: "提交开通", exact: true }).click();
  await expect.poll(() => submitted?.plan).toBe("plus");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

const chileQuotes = {"credits_250": {"country": "CL", "currency": "CLP", "plan": "credits_250", "amountMinor": 9250, "checkoutAmountMinor": 9250, "amountMajor": 9250, "minorUnitExponent": 0, "fetchedAt": 1790004728, "quoteType": "credit_purchase", "creditQuantity": 250}, "credits_1000": {"country": "CL", "currency": "CLP", "plan": "credits_1000", "amountMinor": 37000, "checkoutAmountMinor": 37000, "amountMajor": 37000, "minorUnitExponent": 0, "fetchedAt": 1790004728, "quoteType": "credit_purchase", "creditQuantity": 1000}, "credits_2500": {"country": "CL", "currency": "CLP", "plan": "credits_2500", "amountMinor": 83250, "checkoutAmountMinor": 83250, "amountMajor": 83250, "minorUnitExponent": 0, "fetchedAt": 1790004728, "quoteType": "credit_purchase", "creditQuantity": 2500}, "credits_5000": {"country": "CL", "currency": "CLP", "plan": "credits_5000", "amountMinor": 148000, "checkoutAmountMinor": 148000, "amountMajor": 148000, "minorUnitExponent": 0, "fetchedAt": 1790004728, "quoteType": "credit_purchase", "creditQuantity": 5000}, "go": {"country": "CL", "currency": "CLP", "plan": "go", "amountMinor": 6714, "checkoutAmountMinor": 7990, "amountMajor": 6714.0, "minorUnitExponent": 0, "fetchedAt": 1790004728}, "plus": {"country": "CL", "currency": "CLP", "plan": "plus", "amountMinor": 16798, "checkoutAmountMinor": 19990, "amountMajor": 16798.0, "minorUnitExponent": 0, "fetchedAt": 1790004728}, "pro_5x": {"country": "CL", "currency": "CLP", "plan": "prolite", "amountMinor": 86365, "checkoutAmountMinor": 102990, "amountMajor": 86365.0, "minorUnitExponent": 0, "fetchedAt": 1790004728}, "pro_20x": {"country": "CL", "currency": "CLP", "plan": "pro", "amountMinor": 168059, "checkoutAmountMinor": 199990, "amountMajor": 168059.0, "minorUnitExponent": 0, "fetchedAt": 1790004728}};

test("Chile region sends CL CLP and renders whole-peso quotes", async ({ page }, testInfo) => {
  let preflight: Record<string, unknown> | undefined;
  let order: Record<string, unknown> | undefined;
  await mockAuthenticatedShell(page, "customer");
  await mockGptDirect(page, {
    includeCreditPlans: true,
    checkoutCountries: [{ country: "PH", currency: "PHP" }, { country: "CL", currency: "CLP" }],
    onPreflight: body => { preflight = body; },
    onCreate: body => { order = body; },
    preflightResponse: () => ({
      email: "chile-test@example.test", currentPlan: "free", credentialMode: "session",
      preflightToken: "chile-test-only", preflightExpiresAt: "2099-09-21T16:00:00Z",
      paymentCountry: "CL", paymentCurrency: "CLP", quotes: chileQuotes,
      quoteEstimatesUsd: { plus: "17.46992", credits_250: "9.62" }, quoteError: "", quoteErrors: {},
    }),
  });
  await page.route("**/api/support/tickets**", route => route.fulfill({ json: { code: 0, data: [] } }));
  await page.goto("/gpt-direct");
  await page.getByRole("combobox", { name: "付款地区", exact: true }).click();
  await page.getByRole("option", { name: "智利 (CLP)", exact: true }).click();
  await page.getByLabel("Session 凭据", { exact: true }).fill("synthetic-chile-session");
  await page.getByRole("button", { name: "验证凭据与获取报价", exact: true }).click();
  await expect.poll(() => preflight?.paymentCountry).toBe("CL");
  expect(preflight?.paymentCurrency).toBe("CLP");
  expect(preflight?.customProxyUrl).toBeFalsy();
  const plus = page.locator('.gpt-plan-options label').filter({ has: page.locator('input[value="plus"]') });
  await expect(plus).toContainText(/CLP.*16,?798/);
  await page.getByTestId("gpt-credits-custom-quantity").fill("800");
  await expect(page.getByTestId("gpt-credits-custom-quote")).toContainText(/CLP.*29,?600/);
  await expect(page.getByTestId("gpt-credits-quote")).toContainText(/CLP.*29,?600/);
  await plus.locator("strong").click();
  await expect(page.getByText("订阅实时报价", { exact: true })).toBeVisible();
  await page.screenshot({path:testInfo.outputPath("chile-quote.png"),fullPage:true});
  await page.getByRole("button", { name: "提交开通", exact: true }).click();
  await expect.poll(() => order?.plan).toBe("plus");
  expect(order?.preflightToken).toBe("chile-test-only");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("GPT mailbox parser accepts Mail.com aliases and rejects malformed addresses", () => {
  for (const domain of ["mail.com", "email.com", "usa.com", "post.com", "consultant.com", "engineer.com"]) {
    expect(parseGptMailboxBatch(`  PERSON@${domain.toUpperCase()}----secret  `)).toEqual({ accounts: [{ email: `person@${domain}`, password: "secret" }] });
  }
  for (const email of ["@mail.com", "person@@mail.com", "person@mail", "bad name@mail.com", "bad\0@mail.com", `${"a".repeat(321)}@mail.com`]) {
    expect(parseGptMailboxBatch(`${email}----secret`).error).toEqual({ code: "email", line: 1 });
  }
  expect(parseGptMailboxBatch("Person@email.com----one\nperson@email.com----two").error).toEqual({ code: "duplicate", line: 2 });
});

test("GPT mailbox single login submits a Mail.com alias", async ({ page }, testInfo) => {
  let body: Record<string, unknown> | undefined;
  await mockAuthenticatedShell(page, "customer");
  await page.route("**/api/support/tickets", (route) => route.fulfill({ json: { code: 0, data: [] } }));
  await mockGptDirect(page, { onPreflight: (value) => { body = value; } });
  await page.goto("/gpt-direct");
  await page.getByRole("radio", { name: "Mail.com 自动登录", exact: true }).check();
  await expect(page.getByText(/支持 Mail.com 旗下各邮箱后缀/)).toBeVisible();
  await page.getByLabel("ChatGPT 账户的 Mail.com 邮箱", { exact: true }).fill("person@consultant.com");
  await page.getByLabel("Mail.com 邮箱密码", { exact: true }).fill("test-mailbox-secret");
  await page.getByRole("button", { name: "验证凭据与获取报价", exact: true }).click();
  await expect.poll(() => body?.credential).toEqual({ mode: "mailbox", email: "person@consultant.com", password: "test-mailbox-secret" });
  const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  expect(storage).not.toContain("test-mailbox-secret");
  await page.locator(".gpt-mailbox-fields").screenshot({ path: testInfo.outputPath("mailbox-domains.png") });
});

test("GPT mailbox batch processes different Mail.com aliases without persisting passwords", async ({ page }) => {
  const preflights: Record<string, unknown>[] = [];
  const creates: Record<string, unknown>[] = [];
  await mockAuthenticatedShell(page, "customer");
  await page.route("**/api/support/tickets", (route) => route.fulfill({ json: { code: 0, data: [] } }));
  await mockGptDirect(page, {
    detailStatuses: ["completed"],
    onPreflight: (body) => preflights.push(body),
    onCreate: (body) => creates.push(body),
  });
  await page.goto("/gpt-direct");
  await expect(page.getByRole("radio", { name: /Access Token/ })).toHaveCount(0);
  await page.getByRole("radio", { name: "批量直充", exact: true }).check();
  const input = page.getByLabel("批量账号资料", { exact: true });
  await input.fill([
    "first.user@email.com----ignored-middle----last-field-one",
    "second.user@usa.com----last-field-two",
  ].join("\n"));
  await expect(page.getByText("已识别 2 个账号", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "开始批量直充", exact: true }).click();
  await page.getByRole("button", { name: "确认支付选中账号", exact: true }).click();
  await expect(page.locator(".gpt-batch-results li.is-completed")).toHaveCount(2, { timeout: 15_000 });
  expect(preflights.map((body) => body.credential)).toEqual([
    { mode: "mailbox", email: "first.user@email.com", password: "last-field-one" },
    { mode: "mailbox", email: "second.user@usa.com", password: "last-field-two" },
  ]);
  expect(creates.map((body) => body.credential)).toEqual(preflights.map((body) => body.credential));
  expect(creates.map((body) => body.preflightToken)).toEqual(["one-time-preflight-1", "one-time-preflight-2"]);
  await expect(input).toHaveValue("");
  await expect(page.locator(".gpt-batch-results")).not.toContainText("last-field-one");
  const browserStorage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  expect(browserStorage).not.toContain("last-field-one");
  expect(browserStorage).not.toContain("last-field-two");
  expect(page.url()).not.toContain("last-field-one");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});


test("GPT five-field export preserves fields and never uses RT as a password", () => {
  const raw = "person\\@gmx.com----gpt-password----mail-password----GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ----rt.test";
  expect(parseGptMailboxBatch(raw)).toEqual({ accounts: [{ email: "person@gmx.com", password: "mail-password", chatgptPassword: "gpt-password", totpSecret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ" }] });
  expect(parseGptMailboxBatch("person@mail.com----mail-password")).toEqual({ accounts: [{ email: "person@mail.com", password: "mail-password" }] });
  for (const raw of ["person@gmx.com----rt.test", "person@gmx.com----gpt-password----mail-password----INVALID!----rt.test", "person@gmx.com--------mail-password----GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ----rt.test"]) {
    expect(parseGptMailboxBatch(raw).error).toBeDefined();
  }
});

test("GPT five-field batch sends password and 2FA without leaking mailbox password or RT", async ({ page }) => {
  const preflights: Record<string, unknown>[] = [], orders: Record<string, unknown>[] = [];
  await mockAuthenticatedShell(page, "customer");
  await page.route("**/api/support/tickets", (route) => route.fulfill({ json: { code: 0, data: [] } }));
  await mockGptDirect(page, { detailStatuses: ["completed"], onPreflight: body => preflights.push(body), onCreate: body => orders.push(body) });
  await page.goto("/gpt-direct");
  await page.getByRole("radio", { name: "批量直充", exact: true }).check();
  const input = page.getByLabel("批量账号资料", { exact: true });
  await input.fill("person@gmx.com----gpt-password-test----mail-password-test----GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ----rt.test-export");
  await page.getByRole("button", { name: "开始批量直充", exact: true }).click();
  await page.getByRole("button", { name: "确认支付选中账号", exact: true }).click();
  await expect(page.locator(".gpt-batch-results li.is-completed")).toHaveCount(1);
  const credential = { mode: "password", email: "person@gmx.com", password: "gpt-password-test", totpSecret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ" };
  expect(preflights[0].credential).toEqual(credential);
  expect(orders[0].credential).toEqual(credential);
  expect(JSON.stringify([...preflights, ...orders])).not.toMatch(/mail-password-test|rt\.test-export/);
  await expect(input).toHaveValue("");
  const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  for (const secret of ["gpt-password-test", "mail-password-test", "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", "rt.test-export"]) expect(storage).not.toContain(secret);
});
