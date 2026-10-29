export type ProfitFilters = { start?: string; end?: string; provider?: number; kind?: string; status?: string };
export type ProfitSummary = {
  grossProfit?: string; pendingBusinessCount?: number; unassignedCount?: number; fundingRate?: string; fundingMethod?: string;
  revenue: string; cost: string; fundingFee: string; reward: string; subsidy: string; netProfit: string;
  pendingReceipts: string; confirmedCount: number; pendingCount: number; excludedCount: number;
  isFinal: boolean; warnings: string[]; ruleVersion: string; currency: string; timezone: string;
};
export type ProfitItem = {
  key: string; businessDate: string; occurredAt: string; providerId: number | null; userId: number | null;
  operationId: string | null; kind: string; status: string; reason: string; revenue: string | null; cost: string | null;
  fundingFee: string; reward: string; subsidy: string; profit: string | null; sourceAmount: string;
  fingerprint: string; reviewable: boolean; evidence: Record<string, unknown>;
};
export type ProfitReport = { id: string; generatedAt: string; summary: ProfitSummary; filters: ProfitFilters; total: number };
export type ProfitConnection = { id: number; code: string; name: string; environment: string; upstreamUserId: number | null;
  state: string; lastSyncAt: string | null; lastAttemptAt: string | null; historyComplete: boolean; lastError: string | null };
export const createProfitReport = (token: string, filters: ProfitFilters) => request<{ code: number; data: ProfitReport }>("/admin/profit/reports", {
  method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(filters),
});
export const getProfitReport = (token: string, id: string, page: number) => request<{ code: number; data: ProfitReport & { list: ProfitItem[]; page: number; pageSize: number } }>(`/admin/profit/reports/${id}?page=${page}`, { headers: { authorization: `Bearer ${token}` } });
export const exportProfitReport = (token: string, id: string) => request<Blob>(`/admin/profit/reports/${id}/export`, { headers: { authorization: `Bearer ${token}` } }, false, false, "blob");
export const getProfitConnections = (token: string) => request<{ code: number; data: ProfitConnection[] }>("/admin/profit/connections", { headers: { authorization: `Bearer ${token}` } });
export const connectProfitAccount = (token: string, input: { providerId: number; upstreamUserId: number; token: string }) => request("/admin/profit/connections", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(input) });
export const syncProfitAccount = (token: string, provider: number) => request(`/admin/profit/connections/${provider}/sync`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: "{}" });
export const disconnectProfitAccount = (token: string, provider: number) => request(`/admin/profit/connections/${provider}/disconnect`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: "{}" });
export const reviewProfitEvidence = (token: string, input: { sourceKey: string; fingerprint: string; classification: string; operationId?: string; note: string }) => request("/admin/profit/reviews", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(input) });

export type Session = {
  token: string;
  userId: number;
  email: string | null;
  displayName: string;
  mfaEnrollmentRequired?: boolean;
  mfaLevel?: "password" | "enrollment" | "mfa" | "telegram";
};
export type MfaStatus = {
  state: "not_enrolled" | "pending" | "enabled";
  required: boolean;
  enabledAt?: string | null;
  recoveryCodesRemaining?: number;
};
export type PaymentRate = {
  attempts: number;
  successes: number;
  declines: number;
  successRateBps: number | null;
  declineRateBps: number | null;
};
export type PaymentRisk = PaymentRate & {
  enabled: boolean;
  windowDays: number;
  minAttempts: number;
  lockThresholdBps: number;
  releaseThresholdBps: number;
  reserveBps: number;
  reserveActive: boolean;
  evaluatedAt: string | null;
};
export type Dashboard = {
  userId: number;
  email: string | null;
  displayName: string;
  role: string;
  walletBalance: string;
  lockedBalance?: string;
  spendableBalance?: string;
  paymentRisk?: PaymentRisk;
  cardBalance: string;
  cardCount: number;
  inviteCode: string;
};
export type Wallet = {
  balance: string;
  lockedBalance?: string;
  spendableBalance?: string;
  paymentRisk?: PaymentRisk;
  promoBalance: string;
  cumulativeDeposit: string;
  cumulativeSpend: string;
};
export type LedgerFilters = { type?: string; direction?: string; startAt?: string; endAt?: string; q?: string; feeKind?: string };

function ledgerQuery(filters: LedgerFilters, page: number, pageSize: number) {
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  for (const [key, value] of Object.entries({type: filters.type, direction: filters.direction, start_at: filters.startAt, end_at: filters.endAt, q: filters.q, fee_kind: filters.feeKind})) {
    if (value) params.set(key, value);
  }
  return params.toString();
}

export type WalletTransaction = {
  feeKind?: string | null;
  feeKinds?: string[];
  id: number;
  type: string;
  amount: string;
  balanceBefore: string;
  balanceAfter: string;
  remark: string | null;
  createdAt: string;
};
export type TelegramPaymentIntent = {
  id: string;
  kind: "wallet_deposit" | "card_recharge" | "gpt_direct";
  state: string;
  cardId: number | null;
  card: string | null;
  network: string | null;
  amount: string | null;
  fee: string | null;
  totalAmount: string | null;
  plan: string | null;
  expiresAt: string;
};
export type Product = {
  productCode: string;
  issuer: string;
  network: string;
  issuingArea: string;
  cardType: string;
  openFee: string;
  openQuoteVersion: string;
  rechargeRate: string;
  refundRate: string;
  declineFee: string;
  authorizationReversalRate: string;
  authorizationFee: string;
  smallTransactionFee: string;
  crossBorderFee: string;
  lowAuthorizationThreshold: string | null;
  lowAuthorizationFee: string | null;
  lowAuthorizationStackMode: string | null;
  refundKeepMinimum: string;
  binNotes: Record<string, string>;
  minAmount: string;
  maxAmount: string;
  displayBin: string | null;
  displayBins?: string[];
  description: string | null;
  category: string | null;
  restrictedMerchants?: string[];
  googleChatgptBlocked?: boolean;
};
export type AdminProduct = Omit<Product,
  "openQuoteVersion" | "displayBin" | "displayBins" | "refundRate" | "declineFee" | "authorizationReversalRate" |
  "authorizationFee" | "smallTransactionFee" | "crossBorderFee" | "lowAuthorizationThreshold" |
  "lowAuthorizationFee" | "lowAuthorizationStackMode" | "refundKeepMinimum" | "binNotes"
> & {
  active: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  providerCode: string | null;
  upstreamProductCode: string | null;
  costOpenFee: string | null;
  costRechargeRate: string | null;
  costRtfRate: string | null;
  upstreamAvailable: boolean | null;
  upstreamEnabled: boolean | null;
  upstreamCanOpen: boolean | null;
  upstreamSort: number | null;
  upstreamMetadata: Record<string, unknown> | null;
  costVersion: number | null;
  costSyncedAt: string | null;
  restrictedMerchants: string[] | null;
  googleChatgptBlocked: boolean | null;
  upstreamDescription: string | null;
  upstreamCategory: string | null;
  descriptionOverride: string | null;
  categoryOverride: string | null;
};
export type ProductInput = Omit<Product, "productCode" | "openQuoteVersion" | "refundRate" | "declineFee" | "authorizationReversalRate" | "authorizationFee" | "smallTransactionFee" | "crossBorderFee" | "lowAuthorizationThreshold" | "lowAuthorizationFee" | "lowAuthorizationStackMode" | "refundKeepMinimum" | "binNotes" | "displayBin" | "displayBins" | "description" | "category" | "restrictedMerchants" | "googleChatgptBlocked"> & {
  active?: boolean;
};
export type Card = {
  upstreamStatus?: string | null;
  closureReason?: string | null;
  accountingStatus?: string;
  id: number;
  cardNumberMasked: string;
  productCode: string;
  network: string;
  issuingArea: string;
  status: string;
  balance: string;
  refundKeepMinimum: string;
  firstName: string;
  lastName: string;
  note?: string;
  pendingOperationId: string | null;
  pendingOperationType: string | null;
  pendingOperationError?: string | null;
  createdAt: string;
};
export type GptDirectCredential =
  | { mode: "session"; session: string }
  | { mode: "mailbox"; email: string; password: string }
  | { mode: "password"; email: string; password: string; totpSecret: string };
export type GptDirectPlan = {
  key: string;
  label: string;
  currency: string;
  enabled: boolean;
  serviceFeeUsdMinor: number;
  customerServiceFee?: string;
  expectedAmountMinor?: number;
  minAmountMinor?: number;
  maxAmountMinor?: number;
};
export type GptDirectPlans = {
  version: number;
  plans: GptDirectPlan[] | Record<string, Omit<GptDirectPlan, "key"> & { key?: string }>;
  checkoutCountries?: Array<{ country: string; currency: string }>;
  cdkRegionSelectionEnabled?: boolean;
  externalCardServiceFee?: string;
  batchConcurrencyByCountry?: Record<string, number> | null;
};
export type GptDirectQuote = {
  country: string;
  currency: string;
  plan: string;
  amountMinor: number;
  amountMajor?: number;
  minorUnitExponent: number;
  fetchedAt?: number;
};
export type GptCatalogPrice = {
  country: string; currency: string; plan: string; amountMajor: string;
  tax: "inclusive" | "exclusive" | "unknown";
  pspAmountMajor: string | null; pspTax: "inclusive" | "exclusive" | "unknown";
  minorUnitExponent: number; fetchedAt: number;
  pricingScope: "regional" | "usd_reference";
  amountUsd: string | null; fxDate: string | null;
};
export type GptCatalogCountry = {
  country: string; rows: GptCatalogPrice[]; stale: boolean; lastError: string | null;
  observedAt: string | null; lastAttemptAt: string;
};
export const getGptPriceCatalog = (token: string) =>
  request<{ code: number; data: { countries: GptCatalogCountry[] } }>("/gpt-direct/price-catalog", {
    headers: { authorization: `Bearer ${token}` },
  });

export type GptObservedQuote = {
  plan: string;
  country: string;
  currency: string;
  amountMajor: string;
  amountUsd: string;
  observedAt: string;
  fxDate: string;
};
export type LatestOpenAiSuccess = {
  type: "openai_direct";
  plan: string;
  priceMajor: string;
  currency: string;
  estimatedUsd?: string | null;
  completedAt: string;
};
export type OpenAiPlanPerformance = PaymentRate & {
  plan: string;
  latestSuccess: LatestOpenAiSuccess | null;
};
export type GptCardSuccess = {
  cardId: number;
  overall: PaymentRate;
  plans: OpenAiPlanPerformance[];
};
export type OpenAiPaymentReference = LatestOpenAiSuccess & {
  bin6: string | null;
};
export type OpenAiBinStats = {
  bin6: string;
  overall: PaymentRate;
  plans: OpenAiPlanPerformance[];
};
export type GptDirectPreflight = {
  email: string;
  currentPlan: string;
  credentialMode: GptDirectCredential["mode"];
  preflightToken: string;
  preflightExpiresAt: string;
  paymentCountry: string;
  paymentCurrency: string;
  quotes: Record<string, GptDirectQuote>;
  displayQuoteEstimatesUsd?: Record<string, string>;
  quoteEstimatesUsd?: Record<string, string>;
  quoteError: string;
  quoteErrors?: Record<string, string>;
  upgradeCurrencies?: Record<string, string>;
};
export type GptRetryPolicy = {
  enabled: true;
  maxAdditionalAttempts: 1;
  productCode: string;
  maxAdditionalWalletDebitUsd: string;
  openQuoteVersion: string;
  expectedOpenFee: string;
  expectedInitialRechargeFee: string;
};
export type GptFinancialEntry = { amount: string | null; currency: string | null; status: string; attemptOrderId?: string; plan?: string; evidenceReferences?: string[] };
export type GptDirectOrder = {
  revision?: number;
  originalPlan?: string | null;
  observedPlan?: string | null;
  display?: { statusLabel: string; stageLabel?: string; message: string; progressPercent: number };
  failure?: { code: string; source: string; upstreamCode: string | null; stage: string; message: string; causeConfirmed: boolean } | null;
  payment?: { status: string; submitted: boolean | null; targetConfirmed: boolean; authorizationObserved?: boolean; evidenceSource?: string | null; evidenceAt?: string | null };
  processing?: { status: string; active: boolean };
  retry?: { allowed: boolean; automaticNewCardAllowed: boolean; blockedReason: string | null; nextAction: string; attemptNumber: number; maxAttempts: number; phase?: string; stoppedReason?: string | null; cancelRequested?: boolean; maxAdditionalWalletDebitUsd?: string; reservedUsd?: string; consumedUsd?: string; newCard?: { cardId: number; cardLastFour: string | null } | null };
  financials?: Record<"subscriptionPayments" | "serviceFees" | "cardFunding" | "cardOpenFees" | "cardRechargeFees", GptFinancialEntry[]>;
  attempts?: GptDirectOrder[];
  publicCode?: string | null;
  nextAction?: "none" | "wait" | "submit_session" | "refresh_session_and_reorder" | "resolve_account" | "change_card_and_reorder" | "retry_preflight" | "contact_support" | "reconcile_original_payment";
  recoveryMessage?: string;
  id: string;
  plan: string;
  status: string;
  invoiceUrl?: string | null;
  invoiceUrls?: string[];
  willRenew?: boolean | null;
  progress?: Array<{
    stage: string;
    status?: string;
    publicMessage?: string;
    occurredAt?: string;
  }>;
  needsRenewalCancel?: boolean;
  autoCancelRenewal?: boolean;
  stage?: string | null;
  email?: string | null;
  maskedEmail?: string | null;
  cardId?: number;
  autoOpenedCard?: boolean | null;
  cardLastFour?: string | null;
  cardNumberMasked?: string | null;
  paymentCardSource?: "platform" | "external";
  serviceFee?: string;
  customerServiceFee?: string;
  serviceFeeMinor?: number;
  serviceFeeStatus?: string;
  operationStatus: string;
  quotedAmountMinor?: number;
  finalAmountMinor?: number | null;
  pricingVersion?: number;
  currency?: string;
  fundingState?: string | null;
  fundingHoldStatus?: string | null;
  completedAt?: string | null;
  clientRequestId: string;
  createdAt: string;
  updatedAt?: string;
};
export type GptDirectCdk = {
  id: string;
  codePrefix: string;
  plan: string;
  forceNewCard?: boolean;
  status: string;
  inventoryStatus?: string;
  salePrice?: string | null;
  updatedAt: string;
  redemptionStatus?: string | null;
  cardLastFour?: string | null;
  redemptionStage?: string | null;
  redemptionCreatedAt?: string | null;
  redemptionUpdatedAt?: string | null;
  invoiceUrl?: string | null;
  invoiceUrls?: string[];
  maskedEmail?: string | null;
  quotedAmountMinor?: number | null;
  currency?: string | null;
  redeemedAt?: string | null;
  willRenew?: boolean | null;
  events?: GptDirectEvent[];
};
export type GptCdkPurchase = {
  checkoutRegion?: { country: string; currency: string } | null;
  saleId: string;
  cdkId: string;
  code: string | null;
  codePrefix: string;
  plan: string;
  salePrice: string;
  quantity: number;
  totalSalePrice: string;
  items: Array<{
    saleId: string;
    cdkId: string;
    code: string | null;
    codePrefix: string;
  }>;
  balance: string;
  replayed: boolean;
  generated?: boolean;
  forceNewCard?: boolean;
};
export type AdminGptCdkPricing = {
  plan: string;
  configuredEnabled: boolean;
  enabled: boolean;
  salePrice: string | null;
  fixedPrice: string;
  pricingMode: "FIXED" | "QUOTE_FIXED" | "QUOTE_PERCENT";
  markupValue: string;
  version: number;
  pricingStatus: "READY" | "WAITING_QUOTE";
  quoteBaseUsd: string | null;
  quoteCountry: string | null;
  quoteCurrency: string | null;
  quoteObservedAt: string | null;
  fxRateDate: string | null;
  costFloor: string | null;
  updatedAt: string;
};
export type AdminGptCdkInventory = {
  publicId?: string;
  cardLastFour?: string | null;
  id: number;
  upstreamCdkId: number;
  codePrefix: string;
  plan: string;
  status: string;
  inventoryStatus: string;
  forceNewCard: boolean;
  feeAmountMinor: number;
  ownerFundingCapMinor: number | null;
  salePrice: string | null;
  walletCharged: string | null;
  ownerUserId: number | null;
  ownerEmail: string | null;
  customerGenerated: boolean;
  used: boolean;
  redemptionStatus: string | null;
  redemptionStage: string | null;
  quotedAmountMinor: number | null;
  currency: string | null;
  redeemedAccount: string | null;
  redeemedAt: string | null;
  updatedAt: string;
};
export type AdminGptCdkBatch = {
  id: string;
  plan: string;
  requestedCount: number;
  issuedCount: number;
  status: string;
  createdAt: string;
};
export type AdminGptCdks = {
  pricing: AdminGptCdkPricing[];
  inventory: AdminGptCdkInventory[];
  batches: AdminGptCdkBatch[];
};
export type AdminGptProxy = {
  id: string;
  label: string;
  scheme: string;
  host: string;
  port: number;
  masked: string;
  enabled: boolean;
  healthy: boolean;
  routable: boolean;
  state: "healthy" | "degraded" | "unhealthy" | "disabled" | "unknown";
  failureCount: number;
  cooldownUntil: string;
  lastCheckedAt: string;
  lastError: string;
  latencyMs: number;
  exitIp: string;
  country: string;
  city: string;
  expectedCountry?: string;
};
export type AdminGptProxyPool = {
  intervalSeconds: number;
  total: number;
  healthy: number;
  routable: number;
  proxies: AdminGptProxy[];
};
export type AdminGptQuoteRefreshSettings = {
  catalogProgress?: { total?: number; processed?: number; succeeded?: number; failed?: number; complete?: boolean; rateLimited?: boolean };
  configured: boolean;
  enabled: boolean;
  intervalMinutes: number;
  status: "not_configured" | "pending" | "healthy" | "invalid" | "transient";
  lastErrorCode: string | null;
  lastRefreshAt: string | null;
  lastSuccessAt: string | null;
  nextRefreshAt: string | null;
  notificationReady: boolean;
};
export type AdminGptCdkIssued = {
  id: number;
  code?: string;
  codePrefix: string;
  plan: string;
  feeAmountMinor: number;
  ownerFundingCapMinor: number | null;
  inventoryStatus: string;
  salePrice: string | null;
};
export type GptDirectEvent = {
  id?: number;
  eventId: string;
  type: string;
  status?: string | null;
  stage?: string | null;
  message?: string | null;
  category?: string | null;
  step?: string | null;
  publicCode?: string | null;
  publicMessage?: string | null;
  fromStatus?: string | null;
  toStatus?: string | null;
  safePayload?: Record<string, unknown>;
  occurredAt?: string | null;
  createdAt: string;
};
export type AdminGptOrderContext = {
  checkoutBranch?: "cs_live" | "oaics" | null;
  userId?: number;
  customerEmail?: string | null;
  accountEmail?: string | null;
  originalPlan?: string | null;
  observedPlan?: string | null;
  cardId?: number | null;
  linkedCardId?: number | null;
  cardProductCode?: string | null;
  cardStatus?: string | null;
  autoOpenedCard?: boolean | null;
};
export type AdminGptDirectOrder = AdminGptOrderContext & {
  id: string;
  userId: number;
  email: string | null;
  plan: string;
  status: string;
  stage?: string | null;
  accountEmailMasked?: string | null;
  cardNumberMasked?: string | null;
  paymentCardSource?: "platform" | "external";
  customerServiceFee: string;
  serviceFeeStatus?: string | null;
  operationStatus: string;
  dispatchState: string;
  lastError?: string | null;
  createdAt: string;
  completedAt?: string | null;
};
export type CardDetail = {
  upstreamStatus?: string | null;
  closureReason?: string | null;
  accountingStatus?: string;
  id: number; cardNumberMasked: string; status: string;
  network: string; issuingArea: string; issuer: string; availableAmount: string;
  firstName: string; lastName: string; note: string; productCode: string;
  minAmount: string; maxAmount: string; rechargeRate: string; refundRate: string;
  declineFee: string; autoDeleteDeclines: number; authorizationReversalRate: string; authorizationFee: string;
  smallTransactionFee: string; crossBorderFee: string;
  lowAuthorizationThreshold: string | null; lowAuthorizationFee: string | null; lowAuthorizationStackMode: string | null;
  refundKeepMinimum: string; expiry: string; createdAt: string;
  upstreamSyncedAt?: string | null;
  financialSummary?: CardFinancialSummary;
  pendingOperationId: string | null;
  pendingOperationType: string | null;
};
export type CardFinancialSummary = {
  availableBalance: string; openingPrincipal: string; rechargePrincipal: string;
  totalPrincipalIn: string; walletDebited: string; walletRefunded: string;
  totalCardOut: string; platformFees: string; settledSpend: string;
  merchantRefunds: string; heldAmount: string; transactionCount: number;
  declineCount: number; declineRateBps: number | null;
};
export type CardSpendingEvent = {
  id: number; type: string; status: string; authAmount: string; settleAmount: string;
  authCurrency: string; settleCurrency: string; merchantAmount: string | null;
  merchantCurrency: string | null; description: string | null; billStatus: string | null;
  failedReason: string | null; source: string | null; channel: string | null;
  authTime: string; sourceCreatedAt: string | null; upstreamPayload?: Record<string, unknown> | null;
};
export type CardSpending = {
  providerId: number; cardId: number; cardNumberMasked: string; cardStatus: string;
  authId: string; status: "PENDING" | "SETTLED" | "DECLINED" | "REFUNDED" | "PARTIALLY_REFUNDED" | "REVERSED";
  merchantName: string | null; description: string | null; merchantLocation: string | null;
  merchantRegion: string | null; merchantCountry: string | null; failedReason: string | null;
  billStatus: string | null; source: string | null; channel: string | null;
  authorizedAmount: string; settledAmount: string; refundedAmount: string;
  authCurrency: string; settleCurrency: string; merchantAmount: string | null;
  merchantCurrency: string | null; occurredAt: string; events: CardSpendingEvent[];
};
export type CardSpendingPage = { total: number; page: number; pageSize: number; list: CardSpending[] };
export type CardLedgerActivity = {
  id: string; kind: "CARD_ACTIVITY"; type: string; displayType?: string; remark?: string | null;
  status: string; amount: string;
  fee: string; totalAmount: string; balanceImpact: "WALLET" | "CARD_AND_WALLET"; occurredAt: string;
};
export type CardLedger = { activities: CardLedgerActivity[]; transactions: CardSpending[];
  upstreamRecharges?: { id: number; amount: string; fee: string; status: string; occurredAt: string; syncedAt: string }[];
  upstreamRechargeTotal?: number;
};
export type CardOperation = {
  operationId: string;
  type: string;
  status: "PENDING" | "SUCCEEDED" | "FAILED" | "COMPENSATED" | "RECONCILE_REQUIRED";
  terminal: boolean;
  dispatchState: string;
  result: Record<string, unknown> | null;
  error: string | null;
  updatedAt: string;
};
export type CardSyncResult = {
  reusedSnapshot?: boolean;
  cardId: number; balance: string; status: string; balanceSnapshotApplied: boolean;
  transactionsSeen: number; transactionsInserted: number; transactionsTruncated: boolean;
  rechargesSeen: number; cooldownSeconds: number;
};
export type CardRechargeQuote = {
  amount: string;
  fee: string;
  totalDebit: string;
  effectiveRechargeRate: string;
};
export type CardAddress = {
  addressLineOne: string; addressLineTwo: string; city: string;
  state: string; country: string; postCode: string;
};
export type SensitiveCard = {
  cardNumber: string; cvv: string; expire: string; cardAddress: CardAddress | null;
};
export type CardTransaction = {
  id: number; authId: string; cardId: number; type: string; status: string;
  cardNumberMasked?: string;
  authAmount: string; settleAmount: string; authCurrency: string; settleCurrency: string;
  merchantName: string | null; description: string | null; authTime: string; createdAt: string;
  merchantLocation: string | null; merchantRegion: string | null; merchantCountry: string | null;
  failedReason: string | null; billStatus: string | null;
  merchantAmount: string | null; merchantCurrency: string | null;
  sourceCreatedAt: string | null; source: string | null; channel: string | null;
};
export type CardActivity = {
  operationId: string; type: "OPEN_CARD" | "RECHARGE" | "REFUND"; cardId: number;
  amount: string; fee: string; totalAmount: string;
  openFee: string | null; rechargeFee: string | null;
  status: "SUCCEEDED"; occurredAt: string;
};
export type DepositNetwork = "TRON" | "BSC" | "SOL";
export type DepositStandard = "TRC20" | "BEP20" | "SPL";
export type DepositNetworkStatus = {
  network: DepositNetwork;
  currency: "USDT";
  standard: DepositStandard;
  tokenContract: string;
  tokenDecimals: number;
  enabled: boolean;
  ready: boolean;
};
export type DepositOrder = {
  gatewayRef: string;
  currency: "USDT";
  network: DepositNetwork;
  address: string;
  tokenAccount?: string | null;
  requestedAmount: string;
  expectedAmount: string;
  creditedEstimate: string;
  createdAt: string;
  expiredAt: string;
  cancellable: boolean;
};
export type DepositRecord = Omit<DepositOrder, "requestedAmount" | "expectedAmount" | "creditedEstimate"> & {
  requestedAmount: string | null;
  expectedAmount: string | null;
  creditedEstimate: string | null;
  actualAmount: string | null;
  creditedAmount: string | null;
  txHash: string | null;
  status: "pending" | "confirmed" | "expired" | "failed" | "cancelled";
  confirmedAt: string | null;
  cancelledAt: string | null;
};
export type Points = {
  balance: number;
  history: Array<{ id: number; delta: number; balance: number; reason: string; createdAt: string }>;
  telegramBound: boolean;
  calendar?: { month: string; checkedDates?: string[] };
  checkin: {
    enabled: boolean; eligible: boolean; eligibilityReason: "eligible" | "feature_disabled" | "telegram_binding_required" | "account_ineligible";
    checkedToday: boolean; businessDate: string; currentStreak: number; checkedDates: string[];
    todayAward: number; nextAward: number; basePoints: number; streakBonusPerDay: number;
    streakBonusCapDays: number;
  };
};
export type LotteryParticipationMode = "free" | "points" | "direct_referrals";
export type LotteryActivity = {
  id: number; title: string; description: string; status: string; costPoints: number;
  maxTicketsPerUser: number; prize: string; participantCount: number; myTickets: number;
  participationMode: LotteryParticipationMode; requiredDirectReferrals: number;
  eligibleDirectReferrals: number; eligible: boolean; eligibilityReason: string | null;
  participated: boolean; eligibleForDraw: boolean; endsAt: string | null;
};
export type AdminLotteryActivity = {
  id: number; title: string; description: string; status: string;
  participationMode: LotteryParticipationMode; costPoints: number; requiredDirectReferrals: number;
  maxTicketsPerUser: number; prizes: Array<{ label: string; qty: number; type: string; value?: string | null }>;
  participantCount: number; winnerCount: number; createdAt: string; endsAt: string | null;
  drawStartedAt: string | null; drawCompletedAt: string | null; drawAttempts: number;
  drawNextRetryAt: string | null; drawLastErrorCode: string | null;
  drawState: "scheduled" | "queued" | "processing" | "retrying" | "completed";
};
export type AdminLotteryParticipant = {
  userId: number; email: string | null; tickets: number; joinedAt: string;
  tier: string; telegramBound: boolean; eligibleDirectReferrals: number; eligibleForDraw: boolean;
};
export type AdminLotteryParticipants = {
  activityId: number; list: AdminLotteryParticipant[]; page: number; pageSize: number; total: number;
};
export type AdminLottery = {
  marketingBudget: string;
  checkinSettings: {
    enabled: boolean; basePoints: number; streakBonusPerDay: number; streakBonusCapDays: number; version: number;
  };
  activities: AdminLotteryActivity[];
};
export type Referral = {
  inviteCode: string; inviteUrl: string; inviteLinks?: { path: string; query: string; bot: string | null }; promoBalance: string; referralCount: number;
  openCardBonus: string; depositRebate: string; cardRechargeRebate: string; cumulativeEarnings: string;
  txList: Array<{
    id: number; type: string; amount: string; balanceBefore: string; balanceAfter: string;
    remark: string | null; refUserId: number | null; refUserEmail: string | null; createdAt: string;
  }>;
  directReferrals: {
    total: number; limit: number;
    list: Array<{
      id: number; maskedEmail: string | null; displayName?: string; memberTier: string; tierNameZh: string; tierNameEn: string;
      earned: string; openCardEarned: string; rechargeEarned: string; createdAt: string;
    }>;
  };
  policy: {
    rewardsEnabled: boolean; directOnly: boolean; calculationMode: "confirmed_profit_share";
    profitShareRate: string; displayMode: ReferralDisplayMode; tierRewards: ReferralEstimateTier[];
  };
};
export type ReferralDisplayMode = "profit_share" | "equivalent";
export type ReferralEstimateRange = { min: string; max: string };
export type ReferralEstimateTier = {
  code: string; nameZh: string; nameEn: string; referralCount?: number;
  openingBaseReward: ReferralEstimateRange | null;
  rechargeRewardRate: ReferralEstimateRange | null;
};
export type ReferralPolicy = {
  calculationMode: "confirmed_profit_share"; profitShareRate: string;
  displayMode: ReferralDisplayMode; version: number; tiers: ReferralEstimateTier[];
};
export type Settings = {
  userId: number; email: string | null; displayName: string; role: string; status: string; memberTier: string; inviteCode: string;
  emailLoginEnabled: boolean; emailVerified: boolean; emailVerificationPending: boolean; pendingEmail: string | null; canUnbind: boolean;
  avatarUrl: string | null; cumulativeRecharge: string; createdAt: string;
  nextTier: { name: string; need: string } | null;
};
export type Announcement = {
  id: number; title: string; content: string; isPinned: boolean; createdAt: string;
  updatedAt?: string; isRead?: boolean; readAt?: string | null; isActive?: boolean; readCount?: number;
  telegramDelivery: null | {
    chatId: string; groupTitle: string; status: "pending" | "processing" | "sent" | "cancelled" | "failed";
    sentAt: string | null; lastErrorCode: string | null;
  };
  metadata?: { targetPath?: string; cardId?: number; authId?: string; count?: number; merchant?: string; reason?: string; latestAt?: string };
};
export type AnnouncementPage = { total: number; unreadCount?: number; page: number; pageSize: number; list: Announcement[] };
export type SupportTicketStatus = "open" | "in_progress" | "resolved" | "closed";
export type SupportTicketCategory = "card" | "card_payment" | "card_recharge" | "gpt_direct" | "wallet_transfer" | "account" | "other";
export type SupportTicket = {
  id: number; userId: number; email: string | null; subject: string; status: SupportTicketStatus;
  handledBy: number | null; messageCount: number; lastMessage: string | null;
  lastMessageAt: string; createdAt: string; updatedAt: string; category: SupportTicketCategory;
  cardId: number | null; cardNumberMasked: string | null; cardProductCode: string | null; unreadCount: number;
};
export type SupportTicketMessage = {
  id: number; senderUserId: number | null; senderRole: "customer" | "admin";
  body: string; createdAt: string;
};
export type SupportTicketDetail = { ticket: SupportTicket; messages: SupportTicketMessage[] };
export type LoginCaptcha = { required: boolean; id?: string; image?: string; expiresIn?: number };
export type FeatureFlags = {
  version: number;
  registration: boolean;
  walletTransfer: boolean;
  cardOpening: boolean;
  cardRecharge: boolean;
  cardManagement: boolean;
  cardDelete: boolean;
  gptDirect: boolean;
  gptDirectNewCardRetry?: boolean;
  gptCdk: boolean;
  deposits: boolean;
  rewards: boolean;
  agent: boolean;
  market: boolean;
  developerApi: boolean;
  telegram: boolean;
};
export type SmtpSettings = {
  host: string;
  port: number;
  security: "tls" | "starttls";
  username: string;
  fromEmail: string;
  fromName: string;
  enabled: boolean;
  passwordConfigured: boolean;
  ready: boolean;
  lastTestStatus: "never" | "success" | "failure";
  lastTestAt: string | null;
  lastErrorCode: string | null;
  version: number;
};
export type DepositSettings = {
  enabled: boolean;
  network: DepositNetwork;
  currency: "USDT";
  standard: DepositStandard;
  tokenContract: string;
  tokenDecimals: number;
  addresses: string[];
  apiKeyConfigured: boolean;
  ready: boolean;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  lastTestStatus: "never" | "success" | "failure";
  lastTestAt: string | null;
  lastErrorCode: string | null;
  version: number;
};
export type PaymentRiskSettings = {
  version: number;
  enabled: boolean;
  windowDays: number;
  minAttempts: number;
  lockThresholdBps: number;
  releaseThresholdBps: number;
  reserveBps: number;
  updatedAt: string;
};
export type WalletPolicy = {
  marginReserve: string;
  version: number;
};
export type WalletPolicyInput = Pick<WalletPolicy, "marginReserve" | "version">;
export type DeclineThresholdSettings = {
  minAttempts: number;
  autoDeleteDeclines: number;
  reversalFeeRate: string;
  version: number;
  updatedAt: string;
};
export type DeclineThresholdSettingsInput = Pick<DeclineThresholdSettings, "minAttempts" | "autoDeleteDeclines" | "reversalFeeRate" | "version">;
export type AdminSystemSettings = {
  smtp: SmtpSettings;
  deposits: DepositSettings[];
  features: FeatureFlags;
  paymentRisk?: PaymentRiskSettings;
  declineThreshold?: DeclineThresholdSettings;
  walletPolicy?: WalletPolicy;
  gptProtocol?: GptProtocolSettings;
};
export type LegalDocuments = {
  terms: string;
  userAgreement: string;
  version: number;
  updatedAt: string;
};
export type GptProtocolCountry = {
  country: string;
  currency: string;
  enabled: boolean;
  sortOrder: number;
};
export type GptProtocolProxy = {
  id: number;
  label: string;
  expectedCountry: string;
  enabled: boolean;
  consecutiveFailures: number;
  lastError?: string | null;
  lastUsedAt?: string | null;
  urlConfigured: boolean;
};
export type GptProtocolSettings = {
  commitPayments: boolean;
  externalCardServiceFee: string;
  plusAccountCap: number;
  proAccountCap: number;
  version: number;
  countries: GptProtocolCountry[];
  proxies?: GptProtocolProxy[];
  csVisionBaseUrl?: string;
  csVisionModel?: string;
  csVisionApiKeyConfigured?: boolean;
};
export type SmtpSettingsInput = Pick<SmtpSettings, "host" | "port" | "security" | "username" | "fromEmail" | "fromName" | "enabled" | "version"> & { password?: string };
export type DepositSettingsInput = Pick<DepositSettings, "network" | "enabled" | "addresses" | "version"> & { apiKey?: string };
export type DeveloperKeyScope =
  | "products:read"
  | "account:read"
  | "cards:read"
  | "cards:sensitive"
  | "cards:manage"
  | "cards:open"
  | "cards:recharge"
  | "deposits:create"
  | "gpt:read"
  | "gpt:write"
  | "x-direct:read"
  | "x-direct:write"
  | "tg-direct:read"
  | "tg-direct:write"
  | "cdk:read"
  | "cdk:configure"
  | "cdk:issue"
  | "cdk:export"
  | "cdk:revoke"
  | "cdk:purchase"
  | "operations:read";
export type DeveloperKey = {
  id: number; appId: string; appSecretMasked: string; name: string; status: string;
  ipWhitelist: string; webhookUrl: string; webhookSecretReady: boolean; scopes: DeveloperKeyScope[];
  cdkProductIds?: string[];
  minuteLimit: number; dailyLimit: number; createdAt: string;
  gptAutoCancelRenewal?: boolean;
};
export type DeveloperWebhookDelivery = {
  id: string; apiKeyId: number | null; eventType: string; status: string; attempts: number;
  lastHttpStatus: number | null; lastError: string | null; createdAt: string;
  updatedAt: string; deliveredAt: string | null;
};
export type DeveloperWebhookDeliveries = {
  total: number; page: number; pageSize: number; list: DeveloperWebhookDelivery[];
};
export type OpenApiReference = { $ref: string };
export type OpenApiSchema = {
  $ref?: string; type?: string | string[]; format?: string; description?: string;
  enum?: unknown[]; const?: unknown; default?: unknown; example?: unknown; pattern?: string;
  properties?: Record<string, OpenApiSchema | OpenApiReference>;
  items?: OpenApiSchema | OpenApiReference;
  oneOf?: Array<OpenApiSchema | OpenApiReference>;
  anyOf?: Array<OpenApiSchema | OpenApiReference>;
  allOf?: Array<OpenApiSchema | OpenApiReference>;
  [key: string]: unknown;
};
export type OpenApiParameter = {
  name: string; in: string; required?: boolean; description?: string; schema?: OpenApiSchema;
};
export type OpenApiMediaType = {
  schema?: OpenApiSchema | OpenApiReference; example?: unknown;
  examples?: Record<string, { value?: unknown } | OpenApiReference>;
};
export type OpenApiRequestBody = {
  required?: boolean; description?: string; content?: Record<string, OpenApiMediaType>;
};
export type OpenApiHeader = { description?: string; schema?: OpenApiSchema | OpenApiReference };
export type OpenApiResponse = {
  description?: string; content?: Record<string, OpenApiMediaType>;
  headers?: Record<string, OpenApiHeader | OpenApiReference>;
};
export type OpenApiOperation = {
  operationId?: string; tags?: string[]; summary?: string; description?: string;
  servers?: Array<{ url: string }>; security?: Array<Record<string, string[]>>;
  parameters?: Array<OpenApiParameter | OpenApiReference>;
  requestBody?: OpenApiRequestBody | OpenApiReference;
  responses?: Record<string, OpenApiResponse | OpenApiReference>;
  "x-required-scope"?: string; "x-ip-allowlist-required"?: boolean; "x-idempotency-required"?: boolean;
};
export type OpenApiPathItem = Partial<Record<"get" | "post" | "put" | "patch" | "delete", OpenApiOperation>> & {
  parameters?: Array<OpenApiParameter | OpenApiReference>;
};
export type OpenApiDocument = {
  openapi: string; info: { title: string; description?: string; version?: string };
  tags?: Array<{ name: string; description?: string }>;
  paths: Record<string, OpenApiPathItem>;
  webhooks?: Record<string, { post?: OpenApiOperation }>;
  components?: {
    schemas?: Record<string, OpenApiSchema>; parameters?: Record<string, OpenApiParameter>;
    requestBodies?: Record<string, OpenApiRequestBody>; responses?: Record<string, OpenApiResponse>;
    headers?: Record<string, OpenApiHeader>;
  };
};
export type AdminUser = {
  id: number; email: string | null; role: string; status: string; memberTier: string;
  walletBalance: string; promoBalance: string; cumulativeRecharge: string; inviteCode: string;
  cardCount: number; activeCardCount: number; referralCount: number; riskHold: boolean; createdAt: string;
  telegram: { bound: boolean; username: string | null; verifiedAt: string | null };
};
export type AdminUserQuery = {
  page?: number; pageSize?: number; q?: string; status?: string; role?: string; tier?: string;
  telegramBound?: boolean; emailVerified?: boolean; riskHold?: boolean; cardStatus?: string;
  hasActiveCard?: boolean; rechargeMin?: string; rechargeMax?: string;
  walletMin?: string; walletMax?: string; referralsMin?: number; referralsMax?: number;
  cardsMin?: number; cardsMax?: number; createdFrom?: string; createdTo?: string;
  sort?: "createdAt" | "cumulativeRecharge" | "walletBalance" | "referralCount" | "cardCount";
  direction?: "asc" | "desc";
};
export type AdminUserDetail = {
  profile: {
    id: number; email: string | null; role: string; status: string; inviteCode: string; riskHold: boolean;
    cumulativeRecharge: string; walletBalance: string; lockedBalance?: string; spendableBalance?: string; promoBalance: string; createdAt: string; updatedAt: string;
    emailVerifiedAt: string | null; emailLoginAvailable: boolean;
    inviter: { id: number; email: string | null } | null;
    telegram: { bound: boolean; username: string | null; verifiedAt: string | null };
    membership: { code: string; nameZh: string | null; nameEn: string | null; descriptionZh: string | null; descriptionEn: string | null; thresholdAmount: string | null };
  };
  directReferrals: {
    total: number; limit: number;
    list: Array<{ id: number; email: string | null; status: string; memberTier: string; earned: string; openCardEarned: string; rechargeEarned: string; createdAt: string }>;
  };
  earnings: {
    total: number; limit: number;
    list: Array<{ id: number; type: string; amount: string; balanceBefore: string; balanceAfter: string; remark: string | null; refUserId: number | null; refUserEmail: string | null; createdAt: string }>;
  };
  cards: {
    total: number; limit: number;
    list: Array<{ id: number; cardNumberMasked: string; productCode: string; network: string; issuingArea: string; issuer: string; status: string; balance: string; firstName: string; lastName: string; createdAt: string; updatedAt: string }>;
  };
  deposits: {
    total: number; limit: number;
    list: Array<{ gatewayRef: string; currency: string; network: string; requestedAmount: string | null; orderAmount: string | null; actualAmount: string | null; creditedAmount: string | null; transactionHashMasked: string | null; status: string; createdAt: string; confirmedAt: string | null }>;
  };
  operations: {
    total: number; limit: number;
    list: Array<{ id: string; type: string; status: string; amount: string; fee: string; customerCharge: string; totalAmount: string; cardId: number | null; openedCardIds: number[]; createdAt: string; completedAt: string | null }>;
  };
  risk: {
    paymentPerformance?: PaymentRisk;
    holdReasons: string[];
    owedCharges: {
      count: number;
      total: string;
      byKind: Array<{ kind: string; count: number; total: string }>;
    };
  };
};
export type AdminCardTransaction = Pick<CardTransaction,
  "id" | "type" | "status" | "authAmount" | "settleAmount" | "authCurrency" |
  "settleCurrency" | "merchantName" | "description" | "failedReason" | "authTime" | "createdAt"
>;
export type AdminCardDetail = {
  id: number; providerId: number; upstreamCardId: string | null; vmCardId: string | null;
  cardNumberMasked: string; productCode: string; network: string; issuingArea: string;
  issuer: string; status: string; balance: string; firstName: string; lastName: string;
  note: string; expiry: string; createdAt: string; updatedAt: string;
  upstreamCreatedAt: string | null; upstreamSyncedAt: string | null;
  upstreamPayloadUpdatedAt: string | null; pendingOperationId: string | null;
  feePolicy: Record<string, unknown>; billingAddress: CardAddress;
  upstreamPayload: Record<string, unknown> | null;
};
export type ReconciliationItem = {
  id: number; operationId: string; type: string; operationStatus: string; amount: string;
  fee: string; totalAmount: string; reason: string; lastError: string | null;
  email: string | null; status: string; dispatchState: string; provider: string | null;
  upstreamBusinessId: string | null; createdAt: string;
};
export type UpstreamProvider = {
  code: string; name: string; environment: string; enabled: boolean; priority: number;
  runtimeActive: boolean; configured: boolean; writeEnabled: boolean;
  credentialSource: string; credentialMask: string; credentialVersion: number;
  upstreamTier: string | null; upstreamRechargeRate: string | null;
  lastHealthAt: string | null; lastProductSyncAt: string | null; lastBalanceSyncAt: string | null;
  lastProductAttemptAt: string | null; nextProductRetryAt: string | null; productFailureCount: number;
  connectionHealth: "disabled" | "disconnected" | "healthy" | "stale";
  productHealth: "healthy" | "degraded" | "stale";
  balanceHealth: "healthy" | "stale";
  lastError: string | null; lastProductError: string | null; version: number; balance: string | null;
  spendableBalance: string | null; reserveAmount: string | null; currency: string | null;
};
export type AdminOverviewTrend = { date: string; registrationCount: number; cardCount: number; depositTotal: string };
export type TelegramAiSettings = {
  enabled: boolean; groupEnabled: boolean; privateEnabled: boolean;
  model: "deepseek-v4-flash" | "deepseek-v4-pro";
  perUserPerMinute: number; perGroupPerMinute: number; globalPerMinute: number; maxOutputTokens: number;
  apiKeyConfigured: boolean; apiKeyFingerprint: string | null; version: number; updatedAt: string;
};
export type TelegramKnowledgeArticle = {
  id: number; title: string; content: string; tags: string[]; language: "zh" | "en";
  audience: "group" | "private" | "both"; status: "active" | "disabled";
  version: number; createdAt: string; updatedAt: string;
};
export type UpstreamBalance = {
  balance: string; spendableBalance: string; reserveAmount: string; reserveEnabled: boolean;
  currency: string; fetchedAt: string;
};
export type UpstreamBalanceLog = {
  id: number; type: string; amount: string; before: string; after: string; remark: string | null;
  occurredAt: string; matchStatus: string; operationId: string | null;
};
export type MembershipTier = {
  code: string; nameZh: string; nameEn: string; descriptionZh: string; descriptionEn: string;
  thresholdAmount: string; minimumOpenFee: string; minimumRechargeRate: string;
  referralOpenReward: string; referralRechargeRate: string; declineFee: string; gptDirectMinimumFee: string;
};
export type AdminMembershipTier = MembershipTier & {
  openMultiplier: string; rechargeMultiplier: string; refundMultiplier: string;
  gptDirectMultiplier: string; version: number;
  authDeclineRate1?: string; authDeclineAmount1?: string;
  authDeclineRate2?: string; authDeclineAmount2?: string;
  authDeclineRate3?: string; authDeclineAmount3?: string;
  authDeclineFreezeRate?: string; authDeclineFreezeMargin?: string;
};
export type MembershipData = {
  currentTier: MembershipTier; cumulativeRecharge: string;
  nextTier: MembershipTier | null; tiers: MembershipTier[];
};
export type MembershipTierProfileInput = {
  version: number; nameZh: string; nameEn: string; descriptionZh: string;
  descriptionEn: string; thresholdAmount: string;
};
export type PricingInput = {
  tierCode: string; version: number; openMultiplier: string; minimumOpenFee: string;
  rechargeMultiplier: string; minimumRechargeRate: string; refundMultiplier: string;
  declineFee: string; gptDirectMultiplier: string; gptDirectMinimumFee: string;
};
export type PricingPreviewProduct = {
  productCode: string; costOpenFee: string; costRechargeRate: string; costRtfRate: string;
  saleOpenFee: string; saleRechargeRate: string; saleRefundRate: string;
  openProfit: string; rechargeMargin: string; refundMargin: string;
};
export type PricingPreview = {
  tierCode: string; version: number; products: PricingPreviewProduct[];
  declineFee: string; gptDirectPricing: { multiplier: string; minimumFee: string };
  gptDirectPlans?: Array<{ plan: string; cost: string; saleFee: string }>;
  referralOpenReward?: string; referralRechargeRate?: string | null;
};
export type PricingOverride = {
  productCode: string; tierCode: string; saleOpenFee: string | null;
  saleRechargeRate: string | null; version: number;
};
export type PricingData = { tiers: AdminMembershipTier[]; overrides: PricingOverride[]; referralPolicy: ReferralPolicy };
export type AdminCardRecord = {
  id: number; email: string | null; cardNumberMasked: string; productCode: string; status: string;
  provider: string | null; balance: string; upstreamCardId: string | null; pendingOperationId: string | null; createdAt: string;
};
export type AdminMoneyOperation = {
  id: string; userId: number; email: string | null; provider: string | null; type: string; status: string; amount: string;
  upstreamCost: string | null; customerCharge: string | null; customerFee: string | null;
  expectedProfit: string | null; actualProfit: string | null; dispatchState: string;
  targetCard: { id: number; cardNumberMasked: string | null; productCode: string | null } | null;
  upstreamBusinessId: string | null; lastError: string | null; lastVerifiedAt: string | null;
  pricingSnapshot: Record<string, unknown> | null; createdAt: string;
  gptDirect?: {
    orderId: string; plan: string | null; source: string | null; status: string | null; stage: string | null;
    accountEmailMasked: string | null; cardNumberMasked: string | null; serviceFeeStatus: string | null;
    latestCode: string | null; latestMessage: string | null;
    failureCode: string | null; failureReason: string | null;
    recentEvents: Array<{
      eventId: string; type: string; status: string | null; stage: string | null;
      category: string | null; step: string | null; code: string | null;
      message: string | null; occurredAt: string;
    }>;
    updatedAt: string | null; completedAt: string | null;
  } | null;
};
export type AdminDepositOrder = {
  gatewayRef: string; userId: number; email: string | null; currency: string; network: string;
  requestedAmount: string | null; expectedAmount: string | null; actualAmount: string | null;
  creditedAmount: string | null; status: "pending" | "confirmed" | "expired" | "failed" | "cancelled";
  transactionHashMasked: string | null; createdAt: string; expiredAt: string; reservedUntil: string | null; confirmedAt: string | null;
};
export type AdminFinancialEvent = {
  id: string; source: string; email: string | null; type: string; status: string;
  amount: string | null; balanceBefore: string | null; balanceAfter: string | null;
  referenceId: string | null; detail: Record<string, unknown>; createdAt: string;
};
export type AdminAuditLog = {
  id: number; actorUserId: number | null; targetUserId: number | null; adminEmail: string | null; actorEmail: string | null; actorType: string; action: string;
  outcome: string; sourceIp: string | null; userAgent: string | null; requestId: string;
  targetType: string | null; targetId: string | null; detail: Record<string, unknown>; createdAt: string;
};
export type AdminTelegramGroup = {
  chatId: string; title: string; status: string; enabled: boolean; lotteryEnabled: boolean;
  joinVerificationEnabled: boolean; memberVerificationEnabled: boolean;
  verificationTtlSeconds: number; botIsAdmin: boolean;
  checkinReportMode: "off" | "immediate" | "scheduled"; checkinReportTime: string;
  checkinReportIntervalMinutes: number; checkinReportNextAt: string | null;
  checkinReportLastSentAt: string | null;
  canInviteUsers: boolean; canDeleteMessages: boolean; canRestrictMembers: boolean;
  pendingJoinRequests: number; failedJoinRequests: number; updatedAt: string;
  pendingMemberVerifications: number; failedMemberVerifications: number;
};
export type AdminTelegramMemberVerification = {
  id: string; groupTitle: string; displayName: string; status: string; attempts: number;
  answered: boolean; answeredAt: string | null; approvalPending: boolean; retryCount: number;
  lastErrorCode: string | null; releaseOutcome: string | null; manualPassed: boolean;
  expiresAt: string; createdAt: string; updatedAt: string; completedAt: string | null;
};
export type AdminTelegramOverview = {
  configured: boolean; featureEnabled: boolean; botName: string;
  stats: {
    usersTotal: number; active24h: number; active7d: number; active30d: number;
    boundUsers: number; successfulLogins30d: number; managedGroups: number;
    pendingJoinRequests: number; failedJoinRequests: number;
    pendingMemberVerifications: number; failedMemberVerifications: number;
  };
  health: {
    status: string; lastCompletedUpdateAt: string | null; lastHealthCheckAt: string | null;
    pendingUpdates: number | null; botCanReceiveUpdates: boolean | null;
  };
  groups: AdminTelegramGroup[];
  lotteryActivities: Array<{
    id: number; title: string; status: string; participantCount: number; winnerCount: number;
    participationMode: LotteryParticipationMode; costPoints: number; requiredDirectReferrals: number;
  }>;
  publications: Array<{
    id: number; activityId: number; chatId: string; messageId: number | null; status: string;
    publishedAt: string | null; resultsPublishedAt: string | null;
  }>;
  checkinPublications: Array<{
    id: number; chatId: string; messageId: number | null; status: string;
    renderedBusinessDate: string | null; lastErrorCode: string | null;
    publishedAt: string | null; updatedAt: string;
  }>;
  memberVerifications: AdminTelegramMemberVerification[];
};
export type AdminTelegramBinding = {
  userId: number; email: string | null; displayName: string; memberTier: string; status: string;
  telegramUsername: string | null; verifiedAt: string;
};
export type AdminTelegramCommand =
  | { action: "health" }
  | { action: "group_update"; chatId: string; enabled: boolean; lotteryEnabled: boolean; joinVerificationEnabled: boolean; memberVerificationEnabled: boolean; verificationTtlSeconds: number; checkinReportMode: "off" | "immediate" | "scheduled"; checkinReportTime: string; checkinReportIntervalMinutes: number }
  | { action: "publish_lottery"; chatId: string; activityId: number }
  | { action: "publish_checkin"; chatId: string }
  | { action: "publish_results"; publicationId: number }
  | { action: "member_verification_pass"; challengeId: string };
export type AdminMonitorQuery = {
  page?: number; pageSize?: number; q?: string; provider?: string; status?: string;
  type?: string; source?: string; pending?: boolean; network?: string; plan?: string; user?: number;
};

function adminMonitorPath(path: string, query: AdminMonitorQuery) {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== "") params.set(key === "pageSize" ? "page_size" : key, String(value));
  });
  return `${path}?${params}`;
}

type RefreshResult = { state: "ok" | "unauthorized" } | { state: "temporary"; error: ApiError };
let refreshPromise: Promise<RefreshResult> | null = null;
let sessionRefreshGeneration = 0;

function refreshSession() {
  if (!refreshPromise) {
    refreshPromise = (async (): Promise<RefreshResult> => {
      try {
        const response = await fetch("/api/auth/refresh", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          signal: AbortSignal.timeout(15_000),
        });
        if (response.ok) {
          sessionRefreshGeneration += 1;
          // Refresh authenticates through HttpOnly cookies. Discard legacy bearer
          // tokens so they cannot override the newly refreshed cookie on reload.
          try {
            const stored = JSON.parse(localStorage.getItem("session") ?? "null") as Session | null;
            if (stored?.token) localStorage.setItem("session", JSON.stringify({ ...stored, token: "" }));
          } catch { /* Cookie renewal still succeeds when browser storage is unavailable. */ }
          return { state: "ok" };
        }
        const error = await response.json().catch(() => null) as { error?: string; errorCode?: string } | null;
        if (response.status === 401 || error?.errorCode === "AUTH_REQUIRED") return { state: "unauthorized" };
        const retryAfter = Number(response.headers.get("retry-after"));
        return { state: "temporary", error: new ApiError(
          error?.error ?? `Session refresh failed (${response.status})`,
          response.status,
          error?.errorCode,
          Number.isFinite(retryAfter) && retryAfter > 0 ? Math.ceil(retryAfter) : undefined,
        ) };
      } catch (cause) {
        return { state: "temporary", error: new ApiError(
          cause instanceof Error ? cause.message : "Session refresh temporarily unavailable",
          0,
        ) };
      }
    })().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

function expireSession() {
  if (typeof window === "undefined") return;
  localStorage.removeItem("session");
  if (!["/cdk/redeem", "/x-cdk/redeem", "/tg-cdk/redeem"].includes(window.location.pathname)) window.location.replace("/login");
}

async function request<T>(path: string, init?: RequestInit, acceptAccepted = false, retried = false, responseType: "json" | "blob" = "json"): Promise<T> {
  const isWrite = init?.method !== undefined && init.method.toUpperCase() !== "GET";
  const isProtected = new Headers(init?.headers).has("authorization");
  const requestGeneration = sessionRefreshGeneration;
  const headers = new Headers(init?.headers);
  headers.set("content-type", "application/json");
  if (isProtected && sessionRefreshGeneration > 0) headers.delete("authorization");
  const response = await fetch(`/api${path}`, {
    credentials: "same-origin",
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(isWrite ? 35_000 : 15_000),
    headers,
  });
  let body: unknown = null;
  const successfulBlob = responseType === "blob" && response.ok && response.status !== 202;
  if (!successfulBlob) {
    try {
      body = await response.json();
    } catch (cause) {
      if (response.ok) throw cause;
    }
  }
  const error = response.ok && response.status !== 202 ? null : body as {
    error?: string;
    errorCode?: string;
    operationId?: string;
  } | null;
  if (error?.errorCode === "AUTH_REQUIRED" && isProtected) {
    if (!retried) {
      const refresh = requestGeneration < sessionRefreshGeneration
        ? { state: "ok" as const } : await refreshSession();
      if (refresh.state === "ok") return request<T>(path, init, acceptAccepted, true, responseType);
      if (refresh.state === "temporary") throw refresh.error;
    }
    expireSession();
  }
  if (response.status === 202 && !acceptAccepted) {
    throw new PendingOperationError(error?.error, error?.operationId);
  }
  if (!response.ok) {
    const retryAfter = Number(response.headers.get("retry-after"));
    throw new ApiError(
      error?.error ?? `Request failed (${response.status})`,
      response.status,
      error?.errorCode,
      Number.isFinite(retryAfter) && retryAfter > 0 ? Math.ceil(retryAfter) : undefined,
    );
  }
  return (successfulBlob ? await response.blob() : body) as T;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly errorCode?: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class PendingOperationError extends Error {
  constructor(message = "Operation pending verification", readonly operationId?: string) {
    super(message);
    this.name = "PendingOperationError";
  }
}

export const createLoginCaptcha = () =>
  request<{ code: number; data: LoginCaptcha }>("/auth/captcha", { method: "POST" });

export const getFeatures = () =>
  request<{ code: number; data: FeatureFlags }>("/features");

export const login = (email: string, password: string, mfaCode = "", captchaId?: string, captchaCode = "") =>
  request<Session>("/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email,
      password,
      mfaCode: mfaCode || undefined,
      captchaId: captchaId || undefined,
      captchaCode: captchaCode || undefined,
    }),
  });

export const logout = () => request<{ code: number }>("/auth/logout", {
  method: "POST", headers: { authorization: "Bearer " },
});

export const verifyEmail = (token: string) =>
  request<{ code: number; msg: string }>("/auth/email/verify", {
    method: "POST", body: JSON.stringify({ token }),
  });

export const resendVerificationEmail = (email: string) =>
  request<{ code: number; msg: string; data: { cooldownSeconds: number } }>("/auth/email/resend", {
    method: "POST", body: JSON.stringify({ email }),
  });

export const requestPasswordReset = (email: string, captchaId?: string, captchaCode = "") =>
  request<{ code: number; msg: string; data: { cooldownSeconds: number } }>("/auth/password/forgot", {
    method: "POST",
    body: JSON.stringify({
      email,
      captchaId: captchaId || undefined,
      captchaCode: captchaCode || undefined,
    }),
  });

export const resetPassword = (token: string, newPassword: string) =>
  request<{ code: number; msg: string }>("/auth/password/reset", {
    method: "POST", body: JSON.stringify({ token, newPassword }),
  });

export const getMfaStatus = (token: string) =>
  request<{ code: number; data: MfaStatus }>("/auth/mfa/status", {
    headers: { authorization: `Bearer ${token}` },
  });

export const startMfaEnrollment = (token: string) =>
  request<{ code: number; data: { secret: string; otpauthUri: string } }>("/auth/mfa/enroll", {
    method: "POST", headers: { authorization: `Bearer ${token}` },
  });

export const confirmMfaEnrollment = (token: string, credential: string) =>
  request<{ code: number; data: { recoveryCodes: string[]; loginRequired: boolean } }>("/auth/mfa/confirm", {
    method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ credential }),
  });

export const getUnreadAnnouncements = (token: string) =>
  request<{ code: number; data: Announcement[]; unreadCount: number }>("/announcements/unread", {
    headers: { authorization: `Bearer ${token}` },
  });

export const getAnnouncementHistory = (token: string, page = 1, pageSize = 20) =>
  request<{ code: number; data: AnnouncementPage }>(`/announcements?page=${page}&page_size=${pageSize}`, {
    headers: { authorization: `Bearer ${token}` },
  });

export const markAnnouncementRead = (token: string, id: number) =>
  request<{ code: number; data: { id: number } }>(`/announcements/${id}/read`, {
    method: "POST", headers: { authorization: `Bearer ${token}` },
  });

export const getSupportTickets = (token: string) =>
  request<{ code: number; data: SupportTicket[] }>("/support/tickets", {
    headers: { authorization: `Bearer ${token}` },
  });

export const createSupportTicket = (token: string, subject: string, message: string, category: SupportTicketCategory, cardId: number | null) =>
  request<{ code: number; data: SupportTicketDetail }>("/support/tickets", {
    method: "POST", headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ subject, message, category, cardId }),
  });

export const getSupportTicket = (token: string, id: number) =>
  request<{ code: number; data: SupportTicketDetail }>(`/support/tickets/${id}`, {
    headers: { authorization: `Bearer ${token}` },
  });

export const replySupportTicket = (token: string, id: number, message: string) =>
  request<{ code: number; data: SupportTicketDetail }>(`/support/tickets/${id}/messages`, {
    method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ message }),
  });

export const getDashboard = (token: string) =>
  request<Dashboard>("/dashboard", { headers: { authorization: `Bearer ${token}` } });

export const getDashboardCharts = (token: string) =>
  request<{ code: number; data: { balance: Array<{ date: string; balance: string }>; spend: Array<{ date: string; spend: string }> } }>("/dashboard/charts", { headers: { authorization: `Bearer ${token}` } });

export const resumeTelegramSession = () =>
  request<Dashboard>("/dashboard", { headers: { authorization: "Bearer " } });

export const getWallet = (token: string) =>
  request<{ code: number; data: Wallet }>("/wallet", { headers: { authorization: `Bearer ${token}` } });

export const getWalletTransactions = (token: string, filters: LedgerFilters = {}, page = 1, pageSize = 20) =>
  request<{ code: number; data: { total: number; list: WalletTransaction[]; types?: string[] } }>(Object.keys(filters).length || page !== 1 || pageSize !== 20 ? `/wallet/transactions?${ledgerQuery(filters, page, pageSize)}` : "/wallet/transactions", {
    headers: { authorization: `Bearer ${token}` },
  });

export type TransferChallenge = {
  challengeId: string; deliveryChannel: "telegram" | "email"; destination: string;
  expiresIn: number; idempotencyKey: string;
};

export const requestTransferChallenge = (token: string, recipientCode: string, amount: string) =>
  request<{ code: number; data: TransferChallenge }>("/wallet/transfer/challenge", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ recipientCode, amount }),
  });

export const transfer = (token: string, recipientCode: string, amount: string, challengeId: string, verificationCode: string, idempotencyKey: string) =>
  request<{ code: number; data: { balance: string; fee: string; replayed: boolean } }>("/wallet/transfer", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "idempotency-key": idempotencyKey },
    body: JSON.stringify({ recipientCode, amount, challengeId, verificationCode }),
  });

export const resolveTelegramPayment = (token: string, intentToken: string) =>
  request<{ code: number; data: TelegramPaymentIntent }>("/telegram/payment-intents/resolve", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ token: intentToken }),
  });

export const confirmTelegramCardRecharge = (intentToken: string) =>
  request<{ code: number; data: { state: string; replayed: boolean } }>("/telegram/payment-intents/confirm", {
    method: "POST",
    headers: { authorization: "Bearer " },
    body: JSON.stringify({ token: intentToken }),
  });

export const getProducts = (token: string) =>
  request<{ code: number; data: Product[] }>("/products", { headers: { authorization: `Bearer ${token}` } });

export const getCards = (token: string, page = 1, pageSize = 20, search = "") => {
  const number = search.trim();
  const params = new URLSearchParams();
  if (page !== 1) params.set("page", String(page));
  if (pageSize !== 20) params.set("page_size", String(pageSize));
  if (number) params.set("search", number);
  const query = params.toString();
  return request<{ code: number; data: { total: number; page?: number; pageSize?: number; list: Card[] } }>(
    `/cards${query ? `?${query}` : ""}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
};

export type CardClosureBatch = {
  id: string; status: "processing" | "completed" | "completed_with_errors";
  total: number; pending: number; succeeded: number; failed: number; skipped: number; reviewRequired: number;
  offset: number; limit: number; hasMore: boolean;
  list: { cardId: number; status: string; operationId: string | null; reasonCode: string | null }[];
};
export const createCardClosureBatch = (token: string, key: string) =>
  request<{ code: number; data: CardClosureBatch }>("/cards/closure-batches", {
    method: "POST", headers: { authorization: `Bearer ${token}`, "idempotency-key": key }, body: JSON.stringify({ all: true }),
  }, true);
export const getCardClosureBatch = (token: string, id: string, offset = 0) =>
  request<{ code: number; data: CardClosureBatch }>(`/cards/closure-batches/${encodeURIComponent(id)}?offset=${offset}&limit=100`, {
    headers: { authorization: `Bearer ${token}` },
  });

export const getGptDirectPlans = (token: string) =>
  request<{ code: number; data: GptDirectPlans }>("/gpt-direct/plans", {
    headers: { authorization: `Bearer ${token}` },
  });

export const getGptObservedQuotes = (token: string) =>
  request<{ code: number; data: { list: GptObservedQuote[] } }>("/gpt-direct/observed-quotes", {
    headers: { authorization: `Bearer ${token}` },
  });

export const getGptCardSuccesses = (token: string) =>
  request<{ code: number; data: { list: GptCardSuccess[] } }>("/gpt-direct/card-successes", {
    headers: { authorization: `Bearer ${token}` },
  });

export const preflightGptDirect = (
  token: string,
  credential: GptDirectCredential,
  paymentCountry: string,
  paymentCurrency: string,
  customProxyUrl?: string,
) =>
  request<{ code: number; data: GptDirectPreflight }>("/gpt-direct/preflight", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ credential, paymentCountry, paymentCurrency, customProxyUrl: customProxyUrl || undefined }),
    signal: AbortSignal.timeout(430_000),
  });

export const createGptDirectOrder = (
  token: string,
  input: {
    retryPolicy?: GptRetryPolicy;
    cardId: number;
    autoCard?: {
      productCode: string;
      initAmount: string;
      expectedOpenFee: string;
      expectedInitialRechargeFee: string;
      openQuoteVersion: string;
      quoteCountry: string;
      quoteCurrency: string;
      quotedAmountUsd: string;
      reuseExisting?: boolean;
      oneCardPerAccount?: boolean;
      excludedCardIds?: number[];
    };
    externalCard?: {
      number: string;
      expiry: string;
      cvv: string;
      holder?: string;
    };
    plan: string;
    credential: GptDirectCredential;
    preflightToken: string;
    clientRequestId: string;
    pricingVersion: number;
    expectedCustomerServiceFee: string;
  },
  idempotencyKey: string,
) => request<{ code: number; data: GptDirectOrder }>("/gpt-direct/orders", {
  method: "POST",
  headers: { authorization: input.clientRequestId.startsWith("telegram:") ? "Bearer " : `Bearer ${token}`, "idempotency-key": idempotencyKey },
  body: JSON.stringify(input),
}, true);

export const getGptDirectOrders = (token: string, search = "") =>
  request<{ code: number; data: { total: number; list: GptDirectOrder[] } }>(`/gpt-direct/orders?page=1&page_size=20${search ? `&q=${encodeURIComponent(search)}` : ""}`, {
    headers: { authorization: `Bearer ${token}` },
  });

export const getGptDirectOrder = (token: string, id: string) =>
  request<{ code: number; data: { order: GptDirectOrder; events: GptDirectEvent[] } }>(`/gpt-direct/orders/${encodeURIComponent(id)}`, {
    headers: { authorization: `Bearer ${token}` },
  });

export const cancelGptDirectOrder = (token: string, id: string) =>
  request<{ code: number; data: GptDirectOrder }>(`/gpt-direct/orders/${encodeURIComponent(id)}/cancel`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "idempotency-key": crypto.randomUUID() },
  }, true);

export const cancelGptDirectRenewal = (token: string, id: string, credential: GptDirectCredential) =>
  request<{ code: number; data: GptDirectOrder }>(`/gpt-direct/orders/${encodeURIComponent(id)}/cancel-renewal`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ credential }),
  }, true);

export const replaceGptDirectOrderSession = (token: string, id: string, credential: GptDirectCredential) =>
  request<{ code: number; data: GptDirectOrder }>(`/gpt-direct/orders/${encodeURIComponent(id)}/session`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ credential }),
    signal: AbortSignal.timeout(430_000),
  }, true);

export const getGptDirectCdks = (token: string, page = 1, pageSize = 100) =>
  request<{ code: number; data: { total: number; list: GptDirectCdk[]; forceNewCardEnabled?: boolean } }>(`/gpt-direct/cdks?page=${page}&page_size=${pageSize}`, {
    headers: { authorization: `Bearer ${token}` },
  });

export const exportGptCdks = (token: string) =>
  request<Blob>("/gpt-direct/cdks/export", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  }, false, false, "blob");

export const generateGptCdk = (token: string, plan: string, quantity: number, forceNewCard: boolean, idempotencyKey: string, paymentCountry?: string) =>
  request<{ code: number; data: GptCdkPurchase }>("/gpt-direct/cdks/generate", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "idempotency-key": idempotencyKey },
    body: JSON.stringify({ plan, quantity, forceNewCard, paymentCountry }),
  });

export const getGptCdkOffers = (token: string) =>
  request<{ code: number; data: { offers: Array<{ plan: string; enabled: boolean; salePrice: string | null; pricingStatus: string; stock: number }> } }>("/gpt-direct/cdk-offers", {
    headers: { authorization: `Bearer ${token}` },
  });

export const getGptCdkSensitive = (token: string, id: string) =>
  request<{ code: number; data: { id: string; code: string } }>(`/gpt-direct/cdks/${encodeURIComponent(id)}/sensitive`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });

export const getCardDetail = (token: string, cardId: number) =>
  request<{ code: number; data: CardDetail }>(`/cards/${cardId}`, {
    headers: { authorization: `Bearer ${token}` },
  });

export const syncCard = (token: string, cardId: number) =>
  request<{ code: number; data: CardSyncResult }>(`/cards/${cardId}/sync`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });

export const getSensitiveCard = (token: string, cardId: number) =>
  request<{ code: number; data: SensitiveCard }>(`/cards/${cardId}/sensitive`, {
    headers: { authorization: `Bearer ${token}` },
  });

export const saveCardNote = (token: string, cardId: number, note: string) =>
  request<{ code: number; msg: string }>(`/cards/${cardId}`, {
    method: "PATCH", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ note }),
  });

export const getCardTransactions = (token: string, cardId?: number) =>
  request<{ code: number; data: { total: number; list: CardTransaction[]; activityTotal: number; activities: CardActivity[] } }>(`/cards/transactions?page_size=100${cardId ? `&card_id=${cardId}` : ""}`, {
    headers: { authorization: `Bearer ${token}` },
  });

export const getCardSpending = (
  token: string,
  query: { page?: number; pageSize?: number; cardId?: number; status?: string; q?: string; from?: string; to?: string; cardStatus?: string } = {},
) => {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== "") params.set(key.replace("pageSize", "page_size").replace("cardId", "card_id").replace("cardStatus", "card_status"), String(value));
  });
  return request<{ code: number; data: CardSpendingPage }>(`/cards/spending?${params}`, {
    headers: { authorization: `Bearer ${token}` },
  });
};

export const getCardFinancialSummary = (token: string, cardId: number) =>
  request<{ code: number; data: CardFinancialSummary }>(`/cards/${cardId}/financial-summary`, {
    headers: { authorization: `Bearer ${token}` },
  });

export const getCardLedger = (token: string, cardId: number) =>
  request<{ code: number; data: CardLedger }>(`/cards/${cardId}/ledger`, {
    headers: { authorization: `Bearer ${token}` },
  });

export const openCards = async (
  token: string,
  input: { productCode: string; firstName: string; lastName: string; initAmount: string; count: number; expectedOpenFee: string; expectedInitialRechargeFee: string; openQuoteVersion: string },
  idempotencyKey: string,
) => {
  const started = Date.now();
  try {
    return await request<{ code: number; data: { cardIds: number[] } }>("/cards/open", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "idempotency-key": idempotencyKey },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(90_000),
    });
  } catch (cause) {
    if (!(cause instanceof PendingOperationError) || !cause.operationId) throw cause;
    return waitForOpenedCards(token, cause.operationId, 180_000 - (Date.now() - started));
  }
};

export async function waitForOpenedCards(token: string, operationId: string, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let operation: CardOperation | undefined;
    try {
      const remaining = Math.max(1, Math.min(15_000, deadline - Date.now()));
      operation = (await getCardOperation(token, operationId, AbortSignal.timeout(remaining))).data;
    } catch (cause) {
      if (cause instanceof ApiError && cause.status < 500 && cause.status !== 408 && cause.status !== 429) throw cause;
    }
    if (operation?.status === "SUCCEEDED") {
      const cardIds = operation.result?.cardIds;
      return { code: 0, data: { cardIds: Array.isArray(cardIds) ? cardIds.filter((id): id is number => typeof id === "number") : [] } };
    }
    if (operation?.status === "FAILED" || operation?.status === "COMPENSATED") {
      throw new Error(operation.error || "Card opening failed");
    }
    await new Promise(resolve => window.setTimeout(resolve, Math.max(0, Math.min(2_000, deadline - Date.now()))));
  }
  throw new PendingOperationError("Card opening is still being confirmed", operationId);
}

export const getCardRechargeQuote = (token: string, cardId: number, amount: string, signal?: AbortSignal) =>
  request<{ code: number; data: CardRechargeQuote }>(`/cards/${cardId}/recharge-quote`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ amount }),
    signal,
  });

export const runCardAction = (
  token: string,
  cardId: number,
  action: string,
  idempotencyKey: string,
  amount?: string,
  expectedFee?: string,
) =>
  request<{ code: number; data: { status: string; cardBalance: string; walletBalance: string; fee: string } }>(
    `/cards/${cardId}/actions`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "idempotency-key": idempotencyKey },
      body: JSON.stringify({ action, amount, expectedFee }),
    },
  );

export const getCardOperation = (token: string, operationId: string, signal?: AbortSignal) =>
  request<{ code: number; data: CardOperation }>(`/operations/${encodeURIComponent(operationId)}`, {
    headers: { authorization: `Bearer ${token}` },
    signal,
  });

const CARD_RECHARGE_SETTLE_MS = 20_000;
const CARD_RECHARGE_POLL_MS = 2_000;

export async function waitForCardOperation(
  token: string,
  operationId: string,
  options?: { timeoutMs?: number; intervalMs?: number },
) {
  const timeoutMs = options?.timeoutMs ?? CARD_RECHARGE_SETTLE_MS;
  const intervalMs = options?.intervalMs ?? CARD_RECHARGE_POLL_MS;
  const started = Date.now();
  for (;;) {
    const operation = (await getCardOperation(token, operationId)).data;
    if (operation.terminal || operation.status === "COMPENSATED" || operation.status === "SUCCEEDED" || operation.status === "FAILED" || operation.status === "RECONCILE_REQUIRED") {
      return operation;
    }
    if (Date.now() - started >= timeoutMs) return operation;
    await new Promise((resolve) => window.setTimeout(resolve, intervalMs));
  }
}

export async function runCardRechargeAction(
  token: string,
  cardId: number,
  idempotencyKey: string,
  amount?: string,
  expectedFee?: string,
) {
  try {
    return await runCardAction(token, cardId, "recharge", idempotencyKey, amount, expectedFee);
  } catch (cause) {
    if (!(cause instanceof PendingOperationError) || !cause.operationId) throw cause;
    const operation = await waitForCardOperation(token, cause.operationId);
    if (operation.status === "SUCCEEDED") {
      const result = operation.result ?? {};
      return {
        code: 0,
        data: {
          status: String(result.status ?? "SUCCEEDED"),
          cardBalance: String(result.cardBalance ?? ""),
          walletBalance: String(result.walletBalance ?? ""),
          fee: String(result.fee ?? expectedFee ?? ""),
        },
      };
    }
    if ((operation.status === "FAILED" || operation.status === "COMPENSATED") && operation.terminal) {
      throw new Error(operation.error || "Card action failed", { cause });
    }
    throw cause;
  }
}

export const createDeposit = (token: string, currency: "USDT", network: DepositNetwork, amount: string) =>
  request<{ code: number; data: DepositOrder & { reused: boolean } }>(
    "/deposit/create",
    { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ currency, network, amount }) },
  );

export const getDepositRecords = (token: string) =>
  request<{ code: number; data: DepositRecord[]; networks: DepositNetworkStatus[]; serverTime: string }>("/deposit/records", {
    headers: { authorization: `Bearer ${token}` },
  });

export const cancelDeposit = (token: string, gatewayRef: string) =>
  request<{ code: number; data: { gatewayRef: string; status: "cancelled"; cancelledAt: string; replayed: boolean } }>(
    `/deposit/${encodeURIComponent(gatewayRef)}/cancel`,
    { method: "POST", headers: { authorization: `Bearer ${token}` } },
  );

export const register = (email: string, password: string, inviteCode: string) =>
  request<{ code: number; data: { emailVerificationRequired: boolean } }>("/auth/register", {
    method: "POST", body: JSON.stringify({ email, password, inviteCode: inviteCode || undefined }),
  });

export const captureReferralAttribution = (inviteCode: string) =>
  request<{ code: number; data: { inviteCode: string } }>("/auth/referral-attribution", {
    method: "POST", body: JSON.stringify({ inviteCode }),
  });

export const getPoints = (token: string) =>
  request<{ code: number; data: Points }>("/points", { headers: { authorization: `Bearer ${token}` } });

export const checkInPoints = (token: string) =>
  request<{ code: number; data: {
    businessDate: string; streakDays: number; basePoints: number; streakBonus: number;
    awardedPoints: number; pointBalance: number; replayed: boolean;
  } }>("/points/check-in", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "idempotency-key": crypto.randomUUID() },
    body: "{}",
  });

export const redeemPoints = (token: string, itemId: number) =>
  request<{ code: number; data: { itemName: string; pointBalance: number; walletBalance: string; replayed: boolean } }>(
    "/points/redeem", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ itemId }),
    },
  );

export const getLottery = (token: string) =>
  request<{ code: number; data: LotteryActivity[] }>("/lottery", { headers: { authorization: `Bearer ${token}` } });

export const joinLottery = (token: string, activityId: number, tickets: number) =>
  request<{ code: number; data: { tickets: number; pointCost: number; pointBalance: number; replayed: boolean; eligibleForDraw: boolean; current: number; required: number } }>(
    "/lottery", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ activityId, tickets }),
    },
  );

export const getReferral = (token: string) =>
  request<{ code: number; data: Referral }>("/referral", { headers: { authorization: `Bearer ${token}` } });

export const withdrawPromo = (token: string) =>
  request<{ code: number; data: { amount: string; walletBalance: string; promoBalance: string; replayed: boolean } }>(
    "/referral/withdraw", {
      method: "POST", headers: { authorization: `Bearer ${token}`, "idempotency-key": crypto.randomUUID() },
    },
  );

export const getSettings = (token: string) =>
  request<{ code: number; data: Settings }>("/settings", { headers: { authorization: `Bearer ${token}` } });

export const getMembership = (token: string) =>
  request<{ code: number; data: MembershipData }>("/membership", { headers: { authorization: `Bearer ${token}` } });

export const changePassword = (token: string, oldPassword: string, newPassword: string, confirmPassword: string) =>
  request<{ code: number; msg: string }>("/settings", {
    method: "PATCH",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ action: "change_password", oldPassword, newPassword, confirmPassword }),
  });

export const setupEmailLogin = (token: string, email: string, password: string, confirmPassword: string) =>
  request<{ code: number; msg: string; data: { email: string; emailVerificationRequired: boolean; cooldownSeconds: number } }>("/settings/email-login", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ email, password, confirmPassword }),
  });

export const updateAvatar = (token: string, avatarUrl: string) =>
  request<{ code: number; msg: string }>("/settings", {
    method: "PATCH", headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ action: "update_avatar", avatarUrl }),
  });

export const getTelegram = (token: string) =>
  request<{ code: number; data: { botConfigured: boolean; botName: string; isBound: boolean; chatId: string | null; username: string | null; pendingUnbind: { challengeId: string; maskedEmail: string; expiresInSeconds: number; cooldownSeconds: number; expiresAt: string; cooldownAt: string } | null } }>("/telegram", {
    headers: { authorization: `Bearer ${token}` },
  });

export const issueTelegramBindCode = (token: string) =>
  request<{ code: number; data: { bindCode: string } }>("/telegram/bind-code", {
    method: "POST", headers: { authorization: `Bearer ${token}` },
  });

export const requestTelegramUnbindCode = (token: string) =>
  request<{ code: number; msg: string; data: { challengeId: string; maskedEmail: string; expiresInSeconds: number; cooldownSeconds: number } }>("/telegram/unbind-code", {
    method: "POST", headers: { authorization: `Bearer ${token}` },
  });

export const unbindTelegram = (token: string, challengeId: string, code: string) =>
  request<{ code: number; msg: string; data: { loginRequired: boolean; replayed: boolean } }>("/telegram", {
    method: "DELETE", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ challengeId, code }),
  });

export const getDeveloperKeys = (token: string) =>
  request<{ code: number; data: DeveloperKey[] }>("/developer/keys", { headers: { authorization: `Bearer ${token}` } });

export const createDeveloperKey = (token: string, name: string) =>
  request<{ code: number; data: { appId: string; appSecret: string; webhookSecret: string } }>("/developer/keys", {
    method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ name }),
  });

export const updateDeveloperKey = (token: string, input: { id: number; name?: string; status?: string; ipWhitelist?: string; webhookUrl?: string; scopes?: DeveloperKeyScope[]; cdkProductIds?: string[]; minuteLimit?: number; dailyLimit?: number; rotateWebhookSecret?: boolean; gptAutoCancelRenewal?: boolean }) =>
  request<{ code: number; msg: string; data?: { webhookSecret: string } }>("/developer/keys", {
    method: "PATCH", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(input),
  });

export const deleteDeveloperKey = (token: string, id: number) =>
  request<{ code: number; msg: string }>(`/developer/keys?id=${id}`, {
    method: "DELETE", headers: { authorization: `Bearer ${token}` },
  });

export const getDeveloperWebhookDeliveries = (token: string, apiKeyId: number, page = 1, pageSize = 20) => {
  const query = new URLSearchParams({ apiKeyId: String(apiKeyId), page: String(page), pageSize: String(pageSize) });
  return request<{ code: number; data: DeveloperWebhookDeliveries }>(`/developer/webhooks/deliveries?${query}`, {
    headers: { authorization: `Bearer ${token}` },
  });
};

export const testDeveloperWebhook = (token: string, apiKeyId: number) =>
  request<{ code: number; data: { deliveryId: string } }>("/developer/webhooks/test", {
    method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ apiKeyId }),
  });

export const retryDeveloperWebhook = (token: string, deliveryId: string) =>
  request<{ code: number; data: { deliveryId: string } }>("/developer/webhooks/retry", {
    method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ deliveryId }),
  });

export const getDownstreamOpenApi = () => request<OpenApiDocument>("/v1/openapi.json");

export const getAdminStats = (token: string) =>
  request<{ code: number; data: {
    userCount: number; activeCardCount: number; platformWalletTotal: string;
    depositCurrency: string; customerCumulativeDepositTotal: string;
    confirmedDepositTotal: string; confirmedDepositCount: number;
    pendingDepositTotal: string; pendingDepositCount: number;
  } }>(
    "/admin", { headers: { authorization: `Bearer ${token}` } },
  );

export const getAdminTelegram = (token: string) =>
  request<{ code: number; data: AdminTelegramOverview }>("/admin/telegram", {
    headers: { authorization: `Bearer ${token}` },
  });

export const getAdminTelegramBindings = (token: string, page = 1, pageSize = 20, q = "") =>
  request<{ code: number; data: { total: number; page: number; pageSize: number; list: AdminTelegramBinding[] } }>(
    `/admin/telegram/bindings?page=${page}&pageSize=${pageSize}&q=${encodeURIComponent(q)}`,
    { headers: { authorization: `Bearer ${token}` } },
  );

export const adminTelegramCommand = (token: string, input: AdminTelegramCommand) =>
  request<{ code: number; data: Record<string, unknown> & { status?: "passed" | "queued" }; replayed?: boolean }>("/admin/telegram", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify(input),
  });

export const getAdminTelegramAi = (token: string) =>
  request<{ code: number; data: TelegramAiSettings }>("/admin/telegram/ai", { headers: { authorization: `Bearer ${token}` } });

export const updateAdminTelegramAi = (token: string, input: Omit<TelegramAiSettings, "apiKeyConfigured" | "apiKeyFingerprint" | "version" | "updatedAt"> & { apiKey?: string; clearApiKey?: boolean }) =>
  request<{ code: number; data: TelegramAiSettings }>("/admin/telegram/ai", {
    method: "PATCH", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(input),
  });

export const getAdminTelegramKnowledge = (token: string) =>
  request<{ code: number; data: { list: TelegramKnowledgeArticle[] } }>("/admin/telegram/knowledge", { headers: { authorization: `Bearer ${token}` } });

export const saveAdminTelegramKnowledge = (token: string, input: Omit<TelegramKnowledgeArticle, "id" | "version" | "createdAt" | "updatedAt"> & { id?: number }) =>
  request<{ code: number; data: { id: number } }>("/admin/telegram/knowledge", {
    method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(input),
  });

export const deleteAdminTelegramKnowledge = (token: string, id: number) =>
  request<{ code: number; msg: string }>(`/admin/telegram/knowledge/${id}`, {
    method: "DELETE", headers: { authorization: `Bearer ${token}` },
  });

export const getAdminSystemSettings = (token: string) =>
  request<{ code: number; data: AdminSystemSettings }>("/admin/system-settings", {
    headers: { authorization: `Bearer ${token}` },
  });

export const getLegalDocuments = () =>
  request<{ code: number; data: LegalDocuments }>("/legal-documents");

export const updateAdminLegalDocuments = (token: string, input: Pick<LegalDocuments, "terms" | "userAgreement" | "version">) =>
  request<{ code: number; data: LegalDocuments }>("/admin/legal-documents", {
    method: "PATCH",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });

export const updateAdminSmtpSettings = (token: string, input: SmtpSettingsInput) =>
  request<{ code: number; data: SmtpSettings }>("/admin/system-settings/smtp", {
    method: "PATCH",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });

export const testAdminSmtpSettings = (token: string, version: number) =>
  request<{ code: number; msg: string; data: SmtpSettings }>("/admin/system-settings/smtp/test", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ version }),
  });

export const updateAdminDepositSettings = (token: string, input: DepositSettingsInput) =>
  request<{ code: number; data: DepositSettings }>("/admin/system-settings/deposits", {
    method: "PATCH",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });

export const testAdminDepositSettings = (token: string, network: DepositNetwork, version: number) =>
  request<{ code: number; msg: string; data: DepositSettings }>("/admin/system-settings/deposits/test", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ network, version }),
  });

export const updateAdminFeatures = (token: string, input: FeatureFlags) =>
  request<{ code: number; data: FeatureFlags }>("/admin/system-settings/features", {
    method: "PATCH",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });

export const updateAdminPaymentRisk = (token: string, input: Omit<PaymentRiskSettings, "updatedAt">) =>
  request<{ code: number; data: PaymentRiskSettings }>("/admin/system-settings/payment-risk", {
    method: "PATCH",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });

export const updateAdminWalletPolicy = (token: string, input: WalletPolicyInput) =>
  request<{ code: number; data: WalletPolicy }>("/admin/system-settings/wallet-policy", {
    method: "PATCH",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });

export const updateAdminDeclineThreshold = (token: string, input: DeclineThresholdSettingsInput) =>
  request<{ code: number; data: DeclineThresholdSettings }>("/admin/system-settings/decline-threshold", {
    method: "PATCH",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });

export const updateAdminGptProtocol = (token: string, input: {
  version: number;
  commitPayments?: boolean;
  externalCardServiceFee?: string;
  plusAccountCap?: number;
  proAccountCap?: number;
  countries?: Array<{ country: string; currency?: string; enabled: boolean; sortOrder?: number }>;
  csVisionBaseUrl?: string;
  csVisionModel?: string;
  csVisionApiKey?: string;
}) =>
  request<{ code: number; data: GptProtocolSettings }>("/admin/system-settings/gpt-protocol", {
    method: "PATCH",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });

export const createAdminAnnouncement = (token: string, title: string, content: string, telegramChatId: string | null, idempotencyKey: string) =>
  request<{ code: number; data: { id: number }; replayed: boolean }>("/admin/announcements", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "idempotency-key": idempotencyKey },
    body: JSON.stringify({ action: "create", title, content, isActive: true, telegramChatId }),
  });

export const getAdminAnnouncements = (token: string, page = 1, pageSize = 20) =>
  request<{ code: number; data: AnnouncementPage }>(`/admin/announcements?page=${page}&page_size=${pageSize}`, {
    headers: { authorization: `Bearer ${token}` },
  });

export const getAdminSupportTickets = (token: string, status = "", q = "") => {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (q) params.set("q", q);
  return request<{ code: number; data: SupportTicket[] }>(`/admin/support/tickets?${params}`, {
    headers: { authorization: `Bearer ${token}` },
  });
};

export const getAdminSupportTicket = (token: string, id: number) =>
  request<{ code: number; data: SupportTicketDetail }>(`/admin/support/tickets/${id}`, {
    headers: { authorization: `Bearer ${token}` },
  });

export const replyAdminSupportTicket = (token: string, id: number, message: string) =>
  request<{ code: number; data: SupportTicketDetail }>(`/admin/support/tickets/${id}/messages`, {
    method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ message }),
  });

export const updateAdminSupportTicketStatus = (token: string, id: number, status: SupportTicketStatus) =>
  request<{ code: number; data: SupportTicketDetail }>(`/admin/support/tickets/${id}`, {
    method: "PATCH", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ status }),
  });

export const withdrawAdminAnnouncement = (token: string, id: number) =>
  request<{ code: number; msg: string }>("/admin/announcements", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ action: "update", id, isActive: false }),
  });

export const getAdminProducts = (token: string) =>
  request<{ code: number; data: AdminProduct[] }>("/admin/products", {
    headers: { authorization: `Bearer ${token}` },
  });

export const updateAdminProduct = (token: string, code: string, input: ProductInput & { version: number }) =>
  request<{ code: number; data: { productCode: string; version: number } }>(
    `/admin/products/${encodeURIComponent(code)}`,
    {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify(input),
    },
  );

export const updateAdminProductPresentation = (token: string, code: string, input: { version: number; descriptionOverride: string | null; categoryOverride: string | null }) =>
  request<{ code: number; data: { productCode: string; version: number } }>(
    `/admin/products/${encodeURIComponent(code)}/presentation`,
    {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify(input),
    },
  );

export const getAdminUsers = (token: string, query: AdminUserQuery = {}) =>
  request<{ code: number; data: { total: number; page: number; pageSize: number; list: AdminUser[] } }>(adminMonitorPath("/admin/users", query), {
    headers: { authorization: `Bearer ${token}` },
  });

export const getAdminUserDetail = (token: string, userId: number) =>
  request<{ code: number; data: AdminUserDetail }>(`/admin/users/${userId}/detail`, {
    headers: { authorization: `Bearer ${token}` },
  });

export const getAdminCardTransactions = (token: string, userId: number, cardId: number) =>
  request<{ code: number; data: { total: number; page: number; pageSize: number; source: "db"; list: AdminCardTransaction[]; grouped: CardSpendingPage; financialSummary: CardFinancialSummary; openAiPerformance: GptCardSuccess | null; card: AdminCardDetail } }>(
    `/admin/users/${userId}/cards/${cardId}/transactions?page=1&page_size=100`,
    { headers: { authorization: `Bearer ${token}` } },
  );

export const getAdminCustomerCardSpending = (
  token: string,
  userId: number,
  query: { page?: number; pageSize?: number; status?: string; q?: string; from?: string; to?: string; cardStatus?: string } = {},
) => {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== "") params.set(key.replace("pageSize", "page_size").replace("cardStatus", "card_status"), String(value));
  });
  return request<{ code: number; data: CardSpendingPage }>(`/admin/users/${userId}/card-spending?${params}`, {
    headers: { authorization: `Bearer ${token}` },
  });
};

export const getAdminCustomerCardSensitive = (token: string, userId: number, cardId: number) =>
  request<{ code: number; data: SensitiveCard }>(`/admin/users/${userId}/cards/${cardId}/sensitive`, {
    headers: { authorization: `Bearer ${token}` },
  });

export const updateAdminCustomerProfile = (
  token: string,
  userId: number,
  input: { action: "setInviter" | "setInviteCode" | "unbindTelegram"; reason: string; inviterId?: number | null; inviteCode?: string },
  idempotencyKey: string,
) => request<{ code: number; data: Record<string, unknown>; replayed: boolean }>(`/admin/users/${userId}/profile`, {
  method: "PATCH",
  headers: { authorization: `Bearer ${token}`, "idempotency-key": idempotencyKey },
  body: JSON.stringify(input),
});

export const resetAdminCustomerPassword = (
  token: string,
  userId: number,
  password: string,
  confirmPassword: string,
) => request<{ code: number; msg: string }>(`/admin/users/${userId}/password/reset`, {
  method: "POST",
  headers: { authorization: `Bearer ${token}` },
  body: JSON.stringify({ password, confirmPassword }),
});

export const adjustWallet = (token: string, userId: number, amount: string, remark: string) =>
  request<{ code: number; msg?: string }>("/admin", {
    method: "PATCH",
    headers: { authorization: `Bearer ${token}`, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ action: "adjust_wallet", userId, amount, remark }),
  });

export const updateAdminUser = (token: string, input: { action: string; userId: number; status?: string; tier?: string; remark?: string; riskHoldReason?: string }, idempotencyKey?: string) =>
  request<{ code: number; msg: string }>("/admin", {
    method: "PATCH",
    headers: { authorization: `Bearer ${token}`, ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}) },
    body: JSON.stringify(input),
  });

export const getReconciliation = (token: string) =>
  request<{ code: number; data: ReconciliationItem[] }>("/admin/reconciliation", {
    headers: { authorization: `Bearer ${token}` },
  });

export const resolveReconciliation = (token: string, itemId: number, status: "RESOLVED" | "IGNORED", note: string) =>
  request<{ code: number }>("/admin/reconciliation", {
    method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ itemId, status, note }),
  });

export const resolveDeleteReconciliationByBalanceLog = (token: string, itemId: number, balanceLogId: number, note: string) =>
  request<{ code: number }>("/admin/reconciliation", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ itemId, status: "RESOLVED", note, evidenceType: "BALANCE_LOG_REFUND", evidenceBalanceLogId: balanceLogId }),
  });

export const getAdminLottery = (token: string) =>
  request<{ code: number; data: AdminLottery }>("/admin/lottery", {
    headers: { authorization: `Bearer ${token}` },
  });

export const getAdminLotteryParticipants = (token: string, activityId: number, page = 1, pageSize = 20) =>
  request<{ code: number; data: AdminLotteryParticipants }>(
    `/admin/lottery/${activityId}/participants?page=${page}&pageSize=${pageSize}`,
    { headers: { authorization: `Bearer ${token}` } },
  );

export const adminLotteryCommand = (token: string, input: Record<string, unknown>) =>
  request<{ code: number; data: Record<string, unknown>; replayed: boolean }>("/admin/lottery", {
    method: "POST", headers: { authorization: `Bearer ${token}`, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify(input),
  });

export const getDeferredRewards = (token: string) =>
  request<{ code: number; data: Array<{ id: number; userId: number; email: string | null; amount: string; type: string; createdAt: string }> }>("/admin/marketing/deferred", {
    headers: { authorization: `Bearer ${token}` },
  });

export const payDeferredReward = (token: string, id: number) =>
  request<{ code: number; replayed?: boolean }>("/admin/marketing/deferred", {
    method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ id }),
  });

export const getAdminUpstreams = (token: string) =>
  request<{ code: number; data: UpstreamProvider[] }>("/admin/upstreams", {
    headers: { authorization: `Bearer ${token}` },
  });

export const updateAdminUpstream = (token: string, code: string, input: { enabled: boolean; priority: number; version: number }) =>
  request<{ code: number; data: { code: string; enabled: boolean; priority: number; version: number }; replayed: boolean }>(
    `/admin/upstreams/${encodeURIComponent(code)}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify(input),
    },
  );

export const testAdminUpstream = (token: string, code: string) =>
  request<{ code: number; data: { connected: boolean; balance: string; spendableBalance: string; reserveAmount: string; currency: string; tier: string } }>(
    `/admin/upstreams/${encodeURIComponent(code)}/test`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "idempotency-key": crypto.randomUUID() },
    },
  );

export const syncAdminUpstreamProducts = (token: string, code: string) =>
  request<{ code: number; data: { count: number }; replayed?: boolean }>(
    `/admin/upstreams/${encodeURIComponent(code)}/sync-products`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "idempotency-key": crypto.randomUUID() },
    },
  );

export const syncAdminUpstreamBalanceLogs = (token: string, code: string) =>
  request<{ code: number; data: { count: number } }>(
    `/admin/upstreams/${encodeURIComponent(code)}/sync-balance-logs`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "idempotency-key": crypto.randomUUID() },
    },
  );

export const getAdminUpstreamBalance = (token: string, code: string) =>
  request<{ code: number; data: UpstreamBalance }>(`/admin/upstreams/${encodeURIComponent(code)}/balance`, {
    headers: { authorization: `Bearer ${token}` },
  });

export const getAdminUpstreamBalanceLogs = (token: string, code: string, page = 1, pageSize = 50, filters: LedgerFilters = {}) =>
  request<{ code: number; types?: string[]; data: UpstreamBalanceLog[]; pagination: { total: number; page: number; pageSize: number } }>(
    `/admin/upstreams/${encodeURIComponent(code)}/balance-logs?${ledgerQuery(filters, page, pageSize)}`, {
      headers: { authorization: `Bearer ${token}` },
    },
  );

export const getAdminPricing = (token: string) =>
  request<{ code: number; data: PricingData }>("/admin/pricing", {
    headers: { authorization: `Bearer ${token}` },
  });

export const previewAdminReferralPolicy = (token: string, input: Pick<ReferralPolicy, "profitShareRate" | "displayMode" | "version">) =>
  request<{ code: number; data: ReferralPolicy }>("/admin/referral-policy/preview", {
    method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(input),
  });

export const updateAdminReferralPolicy = (token: string, input: Pick<ReferralPolicy, "profitShareRate" | "displayMode" | "version">, idempotencyKey: string) =>
  request<{ code: number; data: ReferralPolicy; replayed: boolean }>("/admin/referral-policy", {
    method: "PATCH",
    headers: { authorization: `Bearer ${token}`, "idempotency-key": idempotencyKey },
    body: JSON.stringify(input),
  });

export const updateAdminMembershipTier = (token: string, code: string, input: MembershipTierProfileInput) =>
  request<{ code: number; data: { tier: AdminMembershipTier; promotedUsers: number }; replayed: boolean }>(`/admin/membership-tiers/${encodeURIComponent(code)}`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${token}`, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify(input),
  });

export type MembershipDeclinePolicyInput = {
  version: number;
  feeRate1: string; feeAmount1: string;
  feeRate2: string; feeAmount2: string;
  feeRate3: string; feeAmount3: string;
  freezeRate: string; freezeMargin: string;
};

export const updateAdminMembershipDeclinePolicy = (token: string, code: string, input: MembershipDeclinePolicyInput) =>
  request<{ code: number; data: MembershipDeclinePolicyInput & { code: string }; replayed: boolean }>(
    `/admin/membership-tiers/${encodeURIComponent(code)}/decline-policy`,
    {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify(input),
    },
  );

export const previewAdminPricing = (token: string, input: PricingInput) =>
  request<{ code: number; data: PricingPreview }>("/admin/pricing/preview", {
    method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(input),
  });

export const applyAdminPricing = (token: string, input: PricingInput) =>
  request<{ code: number; data: { tierCode: string; version: number }; replayed: boolean }>("/admin/pricing/apply", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify(input),
  });

export const upsertAdminPricingOverride = (token: string, input: PricingOverride) =>
  request<{ code: number; data: { productCode: string; tierCode: string; version: number }; replayed: boolean }>("/admin/pricing/override", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify(input),
  });

export const deleteAdminPricingOverride = (token: string, input: PricingOverride) =>
  request<{ code: number; data: { productCode: string; tierCode: string; deleted: boolean }; replayed: boolean }>("/admin/pricing/override", {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}`, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify(input),
  });

export const getAdminCards = (token: string, query: AdminMonitorQuery = { pageSize: 100 }) =>
  request<{ code: number; data: { total: number; page: number; pageSize: number; list: AdminCardRecord[] } }>(adminMonitorPath("/admin/cards", query), {
    headers: { authorization: `Bearer ${token}` },
  });

export const deleteAdminCard = (token: string, cardId: number, idempotencyKey: string) =>
  request<{ code: number; data?: { operationId?: string; status?: string }; pending?: boolean }>(`/admin/cards/${cardId}/delete`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "idempotency-key": idempotencyKey },
  });

export const unfreezeAdminCard = (token: string, cardId: number, idempotencyKey: string) =>
  request<{ code: number; data?: { operationId?: string; status?: string }; pending?: boolean }>(`/admin/cards/${cardId}/unfreeze`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "idempotency-key": idempotencyKey },
  }, true);

export const observeAdminCardDeleteNoEffect = (token: string, itemId: number) =>
  request<{ code: number; data: { observationId: number; operationId: string; cardId: number; observedAt: string } }>(
    `/admin/reconciliation/${itemId}/delete-no-effect-observations`,
    { method: "POST", headers: { authorization: `Bearer ${token}` } },
  );

export const resolveAdminCardDeleteNoEffect = (token: string, itemId: number) =>
  request<{ code: number; msg: string; data: { operationId: string; cardId: number } }>(
    `/admin/reconciliation/${itemId}/resolve-delete-no-effect`,
    { method: "POST", headers: { authorization: `Bearer ${token}` } },
  );

export const getAdminMoneyOperations = (token: string, query: AdminMonitorQuery = { pageSize: 100 }) =>
  request<{ code: number; data: { total: number; page: number; pageSize: number; list: AdminMoneyOperation[] } }>(adminMonitorPath("/admin/money-operations", query), {
    headers: { authorization: `Bearer ${token}` },
  });

export const getAdminMoneyOperation = (token: string, id: string) =>
  request<{ code: number; data: { operation: AdminMoneyOperation; reconciliation: ReconciliationItem[]; upstreamEvidence: Record<string, unknown> | null } }>(`/admin/money-operations/${encodeURIComponent(id)}`, {
    headers: { authorization: `Bearer ${token}` },
  });

export const getAdminOverviewTrends = (token: string, days = 30) =>
  request<{ code: number; data: { days: AdminOverviewTrend[] } }>(`/admin/overview-trends?days=${days}`, {
    headers: { authorization: `Bearer ${token}` },
  });

export const getAdminDeposits = (token: string, query: AdminMonitorQuery = { pageSize: 50 }) =>
  request<{ code: number; data: { total: number; page: number; pageSize: number; serverTime: string; list: AdminDepositOrder[] } }>(adminMonitorPath("/admin/deposits", query), {
    headers: { authorization: `Bearer ${token}` },
  });

export const confirmAdminDepositManually = (token: string, gatewayRef: string) =>
  request<{ code: number; data: { gatewayRef: string; status: "confirmed"; creditedAmount: string; walletBalance: string; replayed: boolean } }>(`/admin/deposits/${encodeURIComponent(gatewayRef)}/confirm`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });

export const getAdminFinancialEvents = (token: string, query: AdminMonitorQuery = { pageSize: 100 }) =>
  request<{ code: number; data: { total: number; page: number; pageSize: number; list: AdminFinancialEvent[] } }>(adminMonitorPath("/admin/financial-events", query), {
    headers: { authorization: `Bearer ${token}` },
  });

export const getAdminAuditLogs = (token: string, query: { page?: number; pageSize?: number; q?: string; action?: string; targetType?: string; outcome?: string; user?: number } = { pageSize: 50 }) => {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== "") params.set(key, String(value));
  });
  return request<{ code: number; data: { total: number; page: number; pageSize: number; list: AdminAuditLog[] } }>(`/admin/audit-logs?${params}`, {
    headers: { authorization: `Bearer ${token}` },
  });
};

export const getAdminGptDirectOrders = (token: string, query: AdminMonitorQuery = { pageSize: 50 }) =>
  request<{ code: number; data: { total: number; page: number; pageSize: number; list: AdminGptDirectOrder[] } }>(adminMonitorPath("/admin/gpt-direct/orders", query), {
    headers: { authorization: `Bearer ${token}` },
  });

export const getAdminGptDirectOrder = (token: string, id: string) =>
  request<{ code: number; data: { order: GptDirectOrder & AdminGptOrderContext; events: GptDirectEvent[] } }>(`/admin/gpt-direct/orders/${encodeURIComponent(id)}`, {
    headers: { authorization: `Bearer ${token}` },
  });

export const endAdminGptDirectOrder = (token: string, id: string) =>
  request<{ code: number; data: GptDirectOrder }>(`/admin/gpt-direct/orders/${encodeURIComponent(id)}/end`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });

export const getAdminGptCdks = (token: string) =>
  request<{ code: number; data: AdminGptCdks }>("/admin/gpt-cdks", {
    headers: { authorization: `Bearer ${token}` },
  });

export type CdkFundingQuote = {
  amountUsd: string; requiredUsd: string; bufferUsd: string; currency: string;
  amountMinor: number; usdPerUnit: string; fxFetchedAt: string;
};
export type AdminCdkOrder = GptDirectOrder & AdminGptOrderContext & {
  cdkId: number; email: string | null; redemptionId: string;
  fundingQuote?: CdkFundingQuote | null;
};
export const getAdminCdkOrders = (token: string, query: { page: number; q: string; status: string; plan: string }) =>
  request<{ code: number; data: { list: AdminCdkOrder[]; total: number; page: number; pageSize: number } }>(
    `/admin/gpt-cdk-orders?${new URLSearchParams({ ...query, page: String(query.page) })}`, {
      headers: { authorization: `Bearer ${token}` },
    });
export const getAdminCdkOrder = (token: string, id: string) =>
  request<{ code: number; data: { order: AdminCdkOrder; events: GptDirectEvent[]; funding: Array<{
    id: string; cardId: number | null; amountUsd: string; status: string;
    balanceBeforeUsd: string | null; balanceAfterUsd: string | null; createdAt: string;
    quote: CdkFundingQuote | null;
  }> } }>(`/admin/gpt-cdk-orders/${encodeURIComponent(id)}`, { headers: { authorization: `Bearer ${token}` } });

export const getAdminGptProxies = (token: string) =>
  request<{ code: number; data: AdminGptProxyPool }>("/admin/gpt-proxies", {
    headers: { authorization: `Bearer ${token}` },
  });

export const addAdminGptProxy = (token: string, input: { url: string; label?: string; expectedCountry?: string }) =>
  request<{ code: number; data: AdminGptProxyPool }>("/admin/gpt-proxies", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });

export const probeAdminGptProxies = (token: string) =>
  request<{ code: number; data: AdminGptProxyPool }>("/admin/gpt-proxies/probe", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: "{}",
    signal: AbortSignal.timeout(60_000),
  });

export const commandAdminGptProxy = (
  token: string,
  id: string,
  action: "probe" | "enable" | "disable" | "delete",
) =>
  request<{ code: number; data: AdminGptProxyPool }>(`/admin/gpt-proxies/${id}/${action}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: "{}",
    signal: AbortSignal.timeout(action === "probe" ? 60_000 : 35_000),
  });

export const getAdminGptQuoteRefresh = (token: string) =>
  request<{ code: number; data: AdminGptQuoteRefreshSettings }>("/admin/gpt-cdks/quote-refresh", {
    headers: { authorization: `Bearer ${token}` },
  });

export const updateAdminGptQuoteRefresh = (
  token: string,
  input: { session?: string; enabled: boolean; intervalMinutes: number },
) => request<{ code: number; data: AdminGptQuoteRefreshSettings }>("/admin/gpt-cdks/quote-refresh", {
  method: "PUT",
  headers: { authorization: `Bearer ${token}` },
  body: JSON.stringify(input),
});

export const deleteAdminGptQuoteRefresh = (token: string) =>
  request<{ code: number; data: AdminGptQuoteRefreshSettings }>("/admin/gpt-cdks/quote-refresh", {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
  });

export const updateAdminGptCdkPricing = (
  token: string,
  input: {
    plan: string;
    enabled: boolean;
    salePrice: string;
    pricingMode: AdminGptCdkPricing["pricingMode"];
    markupValue: string;
  },
  idempotencyKey: string,
) => request<{ code: number; data: AdminGptCdkPricing }>("/admin/gpt-cdks/pricing", {
  method: "PATCH",
  headers: { authorization: `Bearer ${token}`, "idempotency-key": idempotencyKey },
  body: JSON.stringify(input),
});

export const issueAdminGptCdks = (
  token: string,
  input: { plan: string; count: number; fundingConfirmed: true },
  idempotencyKey: string,
) => request<{
  code: number;
  data: {
    batchId: string;
    status: string;
    requested: number;
    issued: AdminGptCdkIssued[];
  };
}>("/admin/gpt-cdks/issue", {
  method: "POST",
  headers: { authorization: `Bearer ${token}`, "idempotency-key": idempotencyKey },
  body: JSON.stringify(input),
});

export const getAgent = (token: string) =>
  request<{ code: number; data: { pricingEffective: boolean; statusReasonCode: string; subUsers: Array<{ id: number; email: string | null; walletBalance: string; subRechargeRate: string; agentRechargeRate: string; spreadRate: string }> } }>(
    "/agent", { headers: { authorization: `Bearer ${token}` } },
  );

export const updateAgentRate = (token: string, subUserId: number, subRechargeRate: string, agentRechargeRate: string) =>
  request<{ code: number; msg: string }>("/agent", {
    method: "POST", headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ subUserId, subRechargeRate, agentRechargeRate }),
  });

export const getOpenAiPrices = (token: string) =>
  request<{ code: number; data: {
    references: OpenAiPaymentReference[];
    binStats: OpenAiBinStats[];
  } }>(
    "/openai-prices", { headers: { authorization: `Bearer ${token}` } },
  );

export type XDirectPlan = { key: string; label: string; tier: string; months: number; enabled: boolean; serviceFee?: string; pricingVersion?: number };
export type XDirectOrder = {
  id: string; recipient: string; plan: string; cardId: number; status: string;
  amountMinor?: number; currency?: string; message?: string; errorCode?: string;
  cardLast4?: string; invoiceUrls?: string[]; paymentSubmitted?: boolean; serviceFee: string; serviceFeeStatus?: "unpaid" | "charged" | "refunded" | "waived"; pricingVersion?: number;
  paymentAttempted?: boolean; estimatedUsd?: string | null; fxRateDate?: string | null; createdAt?: string;
};
export const getXDirectPlans = (token: string) => request<{ code: number; data: { plans: XDirectPlan[]; paymentsEnabled: boolean; serviceFee: string } }>("/x-direct/plans", { signal: AbortSignal.timeout(430_000), headers: { authorization: `Bearer ${token}` } });
export type DirectOrderFilters = { recipient?: string; status?: string; page?: number };
export type DirectOrderMeta = { total: number; page: number; pageSize: number };
function directOrdersQuery(filters: DirectOrderFilters) {
  const query = new URLSearchParams();
  if (filters.recipient) query.set("recipient", filters.recipient);
  if (filters.status) query.set("status", filters.status);
  if (filters.page && (filters.page !== 1 || filters.recipient || filters.status)) query.set("page", String(filters.page));
  return query.size ? `?${query}` : "";
}
export const getXDirectOrders = (token: string, filters: DirectOrderFilters = {}) => request<{ code: number; data: XDirectOrder[]; meta?: DirectOrderMeta }>(`/x-direct/orders${directOrdersQuery(filters)}`, { signal: AbortSignal.timeout(430_000), headers: { authorization: `Bearer ${token}` } });
export const getXDirectOrder = (token: string, id: string) => request<{ code: number; data: XDirectOrder }>(`/x-direct/orders/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(430_000), headers: { authorization: `Bearer ${token}` } });
export const prepareXDirect = (token: string, body: { recipient: string; plan: string; cardId: number; clientRequestId: string }) => request<{ code: number; data: XDirectOrder }>("/x-direct/orders", { method: "POST", signal: AbortSignal.timeout(430_000), headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
export const confirmXDirect = (token: string, order: XDirectOrder) => request<{ code: number; data: XDirectOrder }>(`/x-direct/orders/${encodeURIComponent(order.id)}/confirm`, { method: "POST", signal: AbortSignal.timeout(430_000), headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ expectedAmountMinor: order.amountMinor, currency: order.currency, expectedServiceFee: order.serviceFee }) });
export const cancelXDirect = (token: string, id: string) => request<{ code: number; data: XDirectOrder }>(`/x-direct/orders/${encodeURIComponent(id)}/cancel`, { method: "POST", signal: AbortSignal.timeout(430_000), headers: { authorization: `Bearer ${token}` }, body: "{}" });

export type XDirectSessionStatus = { configured: boolean; updatedAt: string | null; autoRefresh: false; valid?: boolean };
export const getAdminXDirectSession = (token: string) => request<{ code: number; data: XDirectSessionStatus }>("/admin/x-direct/session", { headers: { authorization: `Bearer ${token}` } });
export const updateAdminXDirectSession = (token: string, body: { cookie: string; action: "check" | "save" }) => request<{ code: number; data: XDirectSessionStatus }>("/admin/x-direct/session", { method: "POST", signal: AbortSignal.timeout(90_000), headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) });

export type AdminXDirectSettings = { plans: Array<{ key: string; label: string; serviceFee: string; version: number }>; currency: "USD" };
export type AdminXDirectOrder = XDirectOrder & { ownerUserId: number; ownerEmail: string; serviceFeeStatus: string; createdAt: string };
export const getAdminXDirectSettings = (token: string, tierCode: string) => request<{ code: number; data: AdminXDirectSettings }>(`/admin/x-direct/settings?tierCode=${encodeURIComponent(tierCode)}`, { headers: { authorization: `Bearer ${token}` } });
export const updateAdminXDirectSettings = (token: string, body: { tierCode: string; plan: string; serviceFee: string; version: number }) => request<{ code: number; data: AdminXDirectSettings }>("/admin/x-direct/settings", { method: "PATCH", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
export const getAdminXDirectOrders = (token: string, filters: { page?: number; recipient?: string; status?: string; userId?: number } = {}) => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== "") query.set(key, String(value));
  return request<{ code: number; data: { list: AdminXDirectOrder[]; total: number; page: number; pageSize: number } }>(`/admin/x-direct/orders?${query}`, { headers: { authorization: `Bearer ${token}` } });
};
export const getAdminXDirectOrder = (token: string, id: string) => request<{ code: number; data: AdminXDirectOrder }>(`/admin/x-direct/orders/${encodeURIComponent(id)}`, { headers: { authorization: `Bearer ${token}` } });
export const endAdminXDirectOrder = (token: string, id: string) => request<{ code: number; data: AdminXDirectOrder }>(`/admin/x-direct/orders/${encodeURIComponent(id)}/end`, { method: "POST", signal: AbortSignal.timeout(430_000), headers: { authorization: `Bearer ${token}` } });

export type XDirectCdk = {
  id: string; plan: string; status: string; codePrefix: string; code?: string; recipient?: string | null;
  serviceFee: string; pricingVersion: number; maxWalletDebitUsd: string; maxOfficialAmountMinor: number;
  currency: string; fundingAmountUsd: string; totalWalletDebitUsd: string; createdAt: string;
  cardId?: number | null; fundingDispatched?: boolean; paymentDispatched?: boolean;
  fundingFeeUsd?: string; openFeeUsd?: string;
};
export type XDirectCdkGenerationInput = {
  plan: string; quantity: number; maxWalletDebitUsd: string; maxOfficialAmountMinor: number;
  currency: string; fundingAmountUsd: string; cardId?: number;
  autoCard?: { productCode: string; firstName: string; lastName: string };
};
export type PublicXCdkResult = {
  plan: string; status: string; recipient?: string; amountMinor?: number; currency?: string;
  message?: string; errorCode?: string; invoiceUrls?: string[]; canRetryPreflight?: boolean;
};
export const getXDirectCdks = (token: string) => request<{ code: number; data: { list: XDirectCdk[] } }>("/x-direct/cdks", { headers: { authorization: `Bearer ${token}` } });
export const generateXDirectCdks = (token: string, input: XDirectCdkGenerationInput, idempotencyKey: string) => request<{ code: number; data: { list: XDirectCdk[]; replayed: boolean } }>("/x-direct/cdks/generate", { method: "POST", signal: AbortSignal.timeout(90_000), headers: { authorization: `Bearer ${token}`, "idempotency-key": idempotencyKey }, body: JSON.stringify(input) });
export const exportXDirectCdk = (token: string, id: string) => request<{ code: number; data: { id: string; code: string } }>(`/x-direct/cdks/${encodeURIComponent(id)}/export`, { headers: { authorization: `Bearer ${token}` } });
export const revokeXDirectCdk = (token: string, id: string) => request<{ code: number; data: XDirectCdk }>(`/x-direct/cdks/${encodeURIComponent(id)}/revoke`, { method: "POST", headers: { authorization: `Bearer ${token}`, "idempotency-key": `x-cdk-revoke-${id}` }, body: "{}" });
export const publicXCdkPreview = (input: { code: string; deviceToken: string }) => request<{ code: number; data: PublicXCdkResult }>("/public/x-cdk/preview", { method: "POST", body: JSON.stringify(input) });
export const publicXCdkPreflight = (input: { code: string; deviceToken: string; recipient: string; clientRequestId: string }) => request<{ code: number; data: PublicXCdkResult }>("/public/x-cdk/preflight", { method: "POST", signal: AbortSignal.timeout(430_000), body: JSON.stringify(input) });
export const publicXCdkRedeem = (input: { code: string; deviceToken: string; clientRequestId: string; expectedAmountMinor: number; currency: string }) => request<{ code: number; data: PublicXCdkResult }>("/public/x-cdk/redeem", { method: "POST", signal: AbortSignal.timeout(430_000), body: JSON.stringify(input) });
export const publicXCdkResult = (input: { code: string; deviceToken: string; clientRequestId: string }) => request<{ code: number; data: PublicXCdkResult }>("/public/x-cdk/result", { method: "POST", signal: AbortSignal.timeout(430_000), body: JSON.stringify(input) });

export type TgDirectPlan = { key: string; label: string; tier: string; months: number; enabled: boolean; serviceFee?: string; pricingVersion?: number };
export type TgDirectOrder = {
  id: string; recipient: string; plan: string; cardId: number; status: string;
  amountMinor?: number; currency?: string; message?: string; errorCode?: string;
  cardLast4?: string; deliveryStatus?: string; giftMessageId?: number; giftDays?: number; paymentSubmitted?: boolean; serviceFee: string; serviceFeeStatus?: "unpaid" | "charged" | "refunded" | "waived"; pricingVersion?: number;
  paymentAttempted?: boolean; estimatedUsd?: string | null; fxRateDate?: string | null; createdAt?: string;
  statusSnapshot?: boolean; stage?: string; updatedAt?: string; executionStartedAt?: string; deadlineAt?: string; executionTimedOut?: boolean;
};
export const getTgDirectPlans = (token: string) => request<{ code: number; data: { plans: TgDirectPlan[]; paymentsEnabled: boolean; serviceFee: string } }>("/tg-direct/plans", { signal: AbortSignal.timeout(430_000), headers: { authorization: `Bearer ${token}` } });
export const getTgDirectOrders = (token: string, filters: DirectOrderFilters = {}) => request<{ code: number; data: TgDirectOrder[]; meta?: DirectOrderMeta }>(`/tg-direct/orders${directOrdersQuery(filters)}`, { signal: AbortSignal.timeout(430_000), headers: { authorization: `Bearer ${token}` } });
export const getTgDirectOrder = (token: string, id: string) => request<{ code: number; data: TgDirectOrder }>(`/tg-direct/orders/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(430_000), headers: { authorization: `Bearer ${token}` } });
export const prepareTgDirect = (token: string, body: { recipient: string; plan: string; cardId: number; clientRequestId: string }) => request<{ code: number; data: TgDirectOrder }>("/tg-direct/orders", { method: "POST", signal: AbortSignal.timeout(430_000), headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
export const confirmTgDirect = (token: string, order: TgDirectOrder) => request<{ code: number; data: TgDirectOrder }>(`/tg-direct/orders/${encodeURIComponent(order.id)}/confirm`, { method: "POST", signal: AbortSignal.timeout(430_000), headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ expectedAmountMinor: order.amountMinor, currency: order.currency, expectedServiceFee: order.serviceFee }) });
export const cancelTgDirect = (token: string, id: string) => request<{ code: number; data: TgDirectOrder }>(`/tg-direct/orders/${encodeURIComponent(id)}/cancel`, { method: "POST", signal: AbortSignal.timeout(430_000), headers: { authorization: `Bearer ${token}` }, body: "{}" });

export type TgDirectSessionStatus = { configured: boolean; updatedAt: string | null; autoRefresh: false; valid?: boolean };
export const getAdminTgDirectSession = (token: string) => request<{ code: number; data: TgDirectSessionStatus }>("/admin/tg-direct/session", { headers: { authorization: `Bearer ${token}` } });
export const updateAdminTgDirectSession = (token: string, body: { session: { userId: number | string; dcId: number; authKey: string; serverSalt?: string }; action: "check" | "save" }) => request<{ code: number; data: TgDirectSessionStatus }>("/admin/tg-direct/session", { method: "POST", signal: AbortSignal.timeout(90_000), headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) });

export type AdminTgDirectSettings = { plans: Array<{ key: string; label: string; serviceFee: string; version: number }>; currency: "USD" };
export type AdminTgDirectOrder = TgDirectOrder & { ownerUserId: number; ownerEmail: string; serviceFeeStatus: string; createdAt: string };
export const getAdminTgDirectSettings = (token: string, tierCode: string) => request<{ code: number; data: AdminTgDirectSettings }>(`/admin/tg-direct/settings?tierCode=${encodeURIComponent(tierCode)}`, { headers: { authorization: `Bearer ${token}` } });
export const updateAdminTgDirectSettings = (token: string, body: { tierCode: string; plan: string; serviceFee: string; version: number }) => request<{ code: number; data: AdminTgDirectSettings }>("/admin/tg-direct/settings", { method: "PATCH", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
export const getAdminTgDirectOrders = (token: string, filters: { page?: number; recipient?: string; status?: string; userId?: number } = {}) => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== "") query.set(key, String(value));
  return request<{ code: number; data: { list: AdminTgDirectOrder[]; total: number; page: number; pageSize: number } }>(`/admin/tg-direct/orders?${query}`, { headers: { authorization: `Bearer ${token}` } });
};
export const getAdminTgDirectOrder = (token: string, id: string) => request<{ code: number; data: AdminTgDirectOrder }>(`/admin/tg-direct/orders/${encodeURIComponent(id)}`, { headers: { authorization: `Bearer ${token}` } });

export type TgDirectCdk = {
  id: string; plan: string; status: string; codePrefix: string; code?: string; recipient?: string | null;
  serviceFee: string; pricingVersion: number; maxWalletDebitUsd: string; maxOfficialAmountMinor: number;
  currency: string; fundingAmountUsd: string; totalWalletDebitUsd: string; createdAt: string;
  cardId?: number | null; fundingDispatched?: boolean; paymentDispatched?: boolean;
  fundingFeeUsd?: string; openFeeUsd?: string;
};
export type TgDirectCdkGenerationInput = {
  plan: string; quantity: number; maxWalletDebitUsd: string; maxOfficialAmountMinor: number;
  currency: string; fundingAmountUsd: string; cardId?: number;
  autoCard?: { productCode: string; firstName: string; lastName: string };
};
export type PublicTgCdkResult = {
  plan: string; status: string; recipient?: string; amountMinor?: number; currency?: string;
  message?: string; errorCode?: string; deliveryStatus?: string; giftMessageId?: number; giftDays?: number; canRetryPreflight?: boolean;
};
export const getTgDirectCdks = (token: string) => request<{ code: number; data: { list: TgDirectCdk[] } }>("/tg-direct/cdks", { headers: { authorization: `Bearer ${token}` } });
export const generateTgDirectCdks = (token: string, input: TgDirectCdkGenerationInput, idempotencyKey: string) => request<{ code: number; data: { list: TgDirectCdk[]; replayed: boolean } }>("/tg-direct/cdks/generate", { method: "POST", signal: AbortSignal.timeout(90_000), headers: { authorization: `Bearer ${token}`, "idempotency-key": idempotencyKey }, body: JSON.stringify(input) });
export const exportTgDirectCdk = (token: string, id: string) => request<{ code: number; data: { id: string; code: string } }>(`/tg-direct/cdks/${encodeURIComponent(id)}/export`, { headers: { authorization: `Bearer ${token}` } });
export const revokeTgDirectCdk = (token: string, id: string) => request<{ code: number; data: TgDirectCdk }>(`/tg-direct/cdks/${encodeURIComponent(id)}/revoke`, { method: "POST", headers: { authorization: `Bearer ${token}`, "idempotency-key": `tg-cdk-revoke-${id}` }, body: "{}" });
export const publicTgCdkPreview = (input: { code: string; deviceToken: string }) => request<{ code: number; data: PublicTgCdkResult }>("/public/tg-cdk/preview", { method: "POST", body: JSON.stringify(input) });
export const publicTgCdkPreflight = (input: { code: string; deviceToken: string; recipient: string; clientRequestId: string }) => request<{ code: number; data: PublicTgCdkResult }>("/public/tg-cdk/preflight", { method: "POST", signal: AbortSignal.timeout(430_000), body: JSON.stringify(input) });
export const publicTgCdkRedeem = (input: { code: string; deviceToken: string; clientRequestId: string; expectedAmountMinor: number; currency: string }) => request<{ code: number; data: PublicTgCdkResult }>("/public/tg-cdk/redeem", { method: "POST", signal: AbortSignal.timeout(430_000), body: JSON.stringify(input) });
export const publicTgCdkResult = (input: { code: string; deviceToken: string; clientRequestId: string }) => request<{ code: number; data: PublicTgCdkResult }>("/public/tg-cdk/result", { method: "POST", signal: AbortSignal.timeout(430_000), body: JSON.stringify(input) });
