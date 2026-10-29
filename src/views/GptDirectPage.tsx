import { formatDecimal } from "../decimal";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useAtom, useAtomValue } from "jotai";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, useSearch } from "@tanstack/react-router";
import { AlertTriangle, Bot, Check, CheckCircle2, Clock3, Copy, CreditCard, Download, Eye, EyeOff, KeyRound, RefreshCw, Search, ShieldCheck, Sparkles, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { StableSwap } from "../components/StableSwap";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ApiError,
  cancelGptDirectOrder,
  cancelGptDirectRenewal,
  createGptDirectOrder,
  exportGptCdks,
  getCards,
  getGptCardSuccesses,
  getGptDirectOrder,
  getGptDirectOrders,
  getGptDirectCdks,
  getGptCdkSensitive,
  getGptDirectPlans,
  getGptObservedQuotes,
  getOpenAiPrices,
  getProducts,
  preflightGptDirect,
  replaceGptDirectOrderSession,
  generateGptCdk,
  type GptCdkPurchase,
  type GptDirectCdk,
  type GptDirectCredential,
  type GptDirectOrder,
  type GptDirectPlan,
  type GptDirectPreflight,
  type GptDirectQuote,
  type OpenAiBinStats,
  type Product,
} from "../api";
import { DataSkeleton, PageShell } from "../components/PageShell";
import { canStopRetry, financiallyFinal, GptOrderProgress, orderHeadline, orderProgressPercent, paymentCardLastFour, stripeInvoiceUrls } from "../components/GptOrderProgress";
import { PaymentPerformance, formatRateBps } from "../components/PaymentPerformance";
import { gptDirectDraftAtom, sessionAtom, sessionIdentity } from "../state";
import { useFeatures } from "../features";
import { GPT_BATCH_MAX_ACCOUNTS, GPT_SESSION_BATCH_MAX_ACCOUNTS, GPT_SESSION_FILE_MAX_BYTES, gptBatchConcurrency, parseGptMailboxBatch, parseGptSessionBatch, runGptBatch } from "../gptBatch";
import { normalizeGptSession } from "../gptSession";
import { GptCreditsPlanFieldset } from "../components/GptCreditsPlanFieldset";
import { GptCreditsCheckoutSummary } from "../components/GptCreditsCheckoutSummary";
import { creditFundingUsd, creditQuoteFromBase, creditQuantityForPlan, isCreditPlan, parseCreditQuantity, splitDirectPlans } from "../gptDirect/plans";

const cancellableStatuses = new Set(["queued", "awaiting_card", "funding_pending"]);
const autoCardBufferUsd = 3;
type BatchResult = {
  maskedEmail: string;
  status: "queued" | "preflighting" | "submitting" | "processing" | "completed" | "failed" | "not_submitted" | "unknown";
  orderId?: string;
  message?: string;
};
type BatchPreviewRow = {
  email: string;
  credential: GptDirectCredential;
  preflight?: GptDirectPreflight;
  error?: string;
  selected: boolean;
};
type SavedProgress = { activeOrderId: string; previewStatus?: "preflight_only"; singleStatus?: "submitting" | "unknown"; batch: Array<Pick<BatchResult, "status" | "orderId">> };
function progressStorageKey(identity: string | number) { return `gpt-direct-progress:${identity}`; }
function readProgress(identity: string | number | null): SavedProgress {
  const empty = { activeOrderId: "", batch: [] };
  if (identity === null) return empty;
  try {
    const saved = JSON.parse(localStorage.getItem(progressStorageKey(identity)) ?? "null");
    const validId = (id: unknown) => typeof id === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(id);
    if (!saved || !Array.isArray(saved.batch) || saved.batch.length > GPT_SESSION_BATCH_MAX_ACCOUNTS) return empty;
    const statuses = new Set(["queued", "preflighting", "submitting", "processing", "completed", "failed", "not_submitted", "unknown"]);
    return { activeOrderId: validId(saved.activeOrderId) ? saved.activeOrderId : "", previewStatus: saved.previewStatus === "preflight_only" ? "preflight_only" : undefined, singleStatus: ["submitting", "unknown"].includes(saved.singleStatus) ? saved.singleStatus : undefined, batch: saved.batch.map((row: { status?: string; orderId?: string }) => {
      const orderId = validId(row?.orderId) ? row.orderId : undefined;
      const status = statuses.has(row?.status ?? "") ? row.status! : "unknown";
      return { orderId, status: orderId ? "processing" : ["queued", "preflighting"].includes(status) ? "not_submitted" : ["submitting", "processing"].includes(status) ? "unknown" : status };
    }) as SavedProgress["batch"] };
  } catch { return empty; }
}

const defaultPaymentRegions = [
  { country: "PH", currency: "PHP" },
  { country: "US", currency: "USD" },
  { country: "JP", currency: "JPY" },
  { country: "IN", currency: "INR" },
  { country: "KR", currency: "KRW" },
  { country: "EG", currency: "EGP" },
] as const;

function quotedAmount(minor?: number | null, currency?: string | null) {
  if (typeof minor !== "number" || !Number.isFinite(minor) || minor < 0) return "";
  if (!currency || currency.length !== 3) return "";
  return `${currency} ${formatDecimal((minor / 100).toFixed(2))}`;
}

function money4Units(value: string) {
  const match = /^(\d+)(?:\.(\d{1,4}))?$/.exec(value);
  if (!match) return null;
  return BigInt(match[1]) * 10_000n + BigInt((match[2] ?? "").padEnd(4, "0"));
}

function formatMoney4(total: bigint) {
  return `${total / 10_000n}.${(total % 10_000n).toString().padStart(4, "0")}`;
}

function addMoney4(...values: string[]) {
  const units = values.map(money4Units);
  if (units.some((value) => value === null)) return "";
  return formatMoney4(units.reduce<bigint>((total, value) => total + value!, 0n));
}

function initialRechargeFee4(amount: string, rechargeRate: string) {
  const amountUnits = money4Units(amount);
  const rateMatch = /^(\d+)(?:\.(\d{1,6}))?$/.exec(rechargeRate);
  if (amountUnits === null || !rateMatch) return "";
  const rateUnits = BigInt(rateMatch[1]) * 1_000_000n + BigInt((rateMatch[2] ?? "").padEnd(6, "0"));
  return formatMoney4((amountUnits * rateUnits + 999_999n) / 1_000_000n);
}

function autoCardAmount(quoteUsd?: string) {
  const match = quoteUsd ? /^(\d+)(?:\.(\d{1,8}))?$/.exec(quoteUsd) : null;
  if (!match) return "";
  const quoteUnits = BigInt(match[1]) * 100_000_000n + BigInt((match[2] ?? "").padEnd(8, "0"));
  if (quoteUnits <= 0n) return "";
  const bufferedUnits = quoteUnits + BigInt(autoCardBufferUsd) * 100_000_000n;
  const cents = (bufferedUnits + 999_999n) / 1_000_000n;
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
}

function productBins(product: Pick<Product, "displayBin" | "displayBins">) {
  return product.displayBins?.length ? product.displayBins : product.displayBin ? [product.displayBin] : [];
}

function selectAutoProduct(products: Product[], requiredAmount: string, plan: string, binStats: OpenAiBinStats[]) {
  const requiredUnits = money4Units(requiredAmount);
  if (requiredUnits === null) return undefined;
  const stats = new Map(binStats.map((item) => [item.bin6, item]));
  return products
    .map((product, index) => {
      const performances = productBins(product).map((bin) => stats.get(bin.slice(0, 6))).filter(Boolean) as OpenAiBinStats[];
      const planRates = performances.flatMap((item) => item.plans.filter((rate) => rate.plan === plan));
      const exact = planRates.sort((left, right) => (right.successRateBps ?? -1) - (left.successRateBps ?? -1) || right.successes - left.successes)[0];
      const overall = performances.map((item) => item.overall).sort((left, right) => (right.successRateBps ?? -1) - (left.successRateBps ?? -1) || right.successes - left.successes)[0];
      return { product, index, exact, overall, verified: performances.some((item) => item.overall.successes > 0) };
    })
    .filter(({ product, verified }) => {
      const maxUnits = money4Units(product.maxAmount);
      return maxUnits !== null && maxUnits >= requiredUnits && (!product.googleChatgptBlocked || verified);
    })
    .sort((left, right) => Number(Boolean(right.exact)) - Number(Boolean(left.exact))
      || (right.exact?.successRateBps ?? right.overall?.successRateBps ?? -1) - (left.exact?.successRateBps ?? left.overall?.successRateBps ?? -1)
      || (right.exact?.successes ?? right.overall?.successes ?? 0) - (left.exact?.successes ?? left.overall?.successes ?? 0)
      || (right.overall?.successRateBps ?? -1) - (left.overall?.successRateBps ?? -1)
      || left.index - right.index)[0]?.product;
}

function amountForProduct(requiredAmount: string, product?: Product) {
  const requiredUnits = money4Units(requiredAmount);
  const minimumUnits = product ? money4Units(product.minAmount) : null;
  if (requiredUnits === null || !product || minimumUnits === null) return "";
  return formatMoney4(requiredUnits > minimumUnits ? requiredUnits : minimumUnits);
}

function cdkRedemptionOrder(cdk?: GptDirectCdk): GptDirectOrder | null {
  if (!cdk?.redemptionStatus) return null;
  const status = cdk.redemptionStatus;
  const invoiceUrls = stripeInvoiceUrls(cdk.invoiceUrls, cdk.invoiceUrl);
  return {
    id: cdk.id,
    plan: cdk.plan,
    status,
    stage: cdk.redemptionStage,
    invoiceUrl: invoiceUrls.at(-1) ?? null,
    invoiceUrls,
    willRenew: cdk.willRenew,
    needsRenewalCancel: status === "completed" && cdk.willRenew !== false && invoiceUrls.length > 0,
    maskedEmail: cdk.maskedEmail,
    cardLastFour: cdk.cardLastFour,
    quotedAmountMinor: cdk.quotedAmountMinor ?? undefined,
    currency: cdk.currency ?? undefined,
    operationStatus: status === "completed" ? "SUCCEEDED" : ["declined", "failed_precharge", "cancelled"].includes(status) ? "COMPENSATED" : "PENDING",
    clientRequestId: `cdk:${cdk.id}`,
    createdAt: cdk.redemptionCreatedAt ?? cdk.updatedAt,
    updatedAt: cdk.redemptionUpdatedAt ?? cdk.updatedAt,
    completedAt: cdk.redeemedAt,
  };
}

function plansList(plans: GptDirectPlan[] | Record<string, Omit<GptDirectPlan, "key"> & { key?: string }> | undefined) {
  if (!plans) return [];
  return Array.isArray(plans) ? plans : Object.entries(plans).map(([key, plan]) => ({ ...plan, key: plan.key ?? key }));
}

function maskEmail(value: string) {
  const at = value.indexOf("@");
  return at > 0 ? `${value[0]}***${value.slice(at)}` : value;
}

function sessionRequiresRelogin(value: string) {
  try {
    return JSON.parse(normalizeGptSession(value))?.error === "RefreshAccessTokenError";
  } catch {
    return false;
  }
}

function telegramHandoff() {
  const raw = sessionStorage.getItem("telegramGptIntent");
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { id?: string; cardId?: number; plan?: string };
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.id ?? "")
      || !Number.isSafeInteger(value.cardId) || value.cardId! < 1
      || !["go", "plus", "pro_5x", "pro_20x", "pro_25x"].includes(value.plan ?? "")) throw new Error();
    return { id: value.id!, cardId: value.cardId!, plan: value.plan! };
  } catch {
    sessionStorage.removeItem("telegramGptIntent");
    return null;
  }
}

export function GptDirectPage() {
  const session = useAtomValue(sessionAtom);
  return <GptDirectContent key={sessionIdentity(session)} />;
}

function GptDirectContent() {
  const session = useAtomValue(sessionAtom);
  const [draft, setDraft] = useAtom(gptDirectDraftAtom);
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const search = useSearch({ strict: false }) as { cardId?: number };
  const { flags } = useFeatures();
  const [handoff, setHandoff] = useState(() => telegramHandoff());
  const { mode, sessionValue, batchValue, mailboxEmail, mailboxPassword, paymentRegionKey, planKey } = draft;
  const [cardId, setCardId] = useState(() => handoff ? String(handoff.cardId) : search.cardId ? String(search.cardId) : "");
  const [cardMode, setCardMode] = useState<"existing" | "auto" | "external">("existing");
  const [externalCardNumber, setExternalCardNumber] = useState("");
  const [externalCardExpiry, setExternalCardExpiry] = useState("");
  const [externalCardCvv, setExternalCardCvv] = useState("");
  const [externalCardHolder, setExternalCardHolder] = useState("");
  const [customProxyUrl, setCustomProxyUrl] = useState("");
  const [creditsCustomActive, setCreditsCustomActive] = useState(false);
  const [telegramIntentId, setTelegramIntentId] = useState(() => handoff?.id ?? "");
  const identity = sessionIdentity(session);
  const [savedProgress] = useState(() => readProgress(identity));
  const [activeOrderId, setActiveOrderId] = useState(savedProgress.activeOrderId);
  const [activeCdkId, setActiveCdkId] = useState("");
  const [orderSearchDraft, setOrderSearchDraft] = useState("");
  const [orderSearch, setOrderSearch] = useState("");
  const [acceptedOrder, setAcceptedOrder] = useState<GptDirectOrder | null>(null);
  const [cdkPaymentCountry, setCdkPaymentCountry] = useState("");
  const [purchasedCdk, setPurchasedCdk] = useState<GptCdkPurchase | null>(null);
  const [purchaseError, setPurchaseError] = useState("");
  const [purchasingPlan, setPurchasingPlan] = useState("");
  const [cdkQuantities, setCdkQuantities] = useState<Record<string, number>>({});
  const [forceNewCard, setForceNewCard] = useState(false);
  const [copiedCdk, setCopiedCdk] = useState("");
  const [revealedCdks, setRevealedCdks] = useState<Record<string, string>>({});
  const [revealingCdkId, setRevealingCdkId] = useState("");
  const [revealError, setRevealError] = useState("");
  const [exportingCdks, setExportingCdks] = useState(false);
  const [exportError, setExportError] = useState("");
  const [cdkPage, setCdkPage] = useState(1);
  const [preflightData, setPreflightData] = useState<GptDirectPreflight | null>(null);
  const [preflightPending, setPreflightPending] = useState(false);
  const [preflightError, setPreflightError] = useState("");
  const [preflightExpired, setPreflightExpired] = useState(false);
  const [dismissedRegionSwitch, setDismissedRegionSwitch] = useState("");
  const [orderPending, setOrderPending] = useState(false);
  const [singleUncertain, setSingleUncertain] = useState(Boolean(savedProgress.singleStatus));
  const [retryEnabled, setRetryEnabled] = useState(false);
  const [retryProductCode, setRetryProductCode] = useState("");
  const [retryBudget, setRetryBudget] = useState("");
  const [orderError, setOrderError] = useState("");
  const [batchPending, setBatchPending] = useState(false);
  const [batchImportPending, setBatchImportPending] = useState(false);
  const [importedSessionBatch, setImportedSessionBatch] = useState<ReturnType<typeof parseGptSessionBatch> | null>(null);
  const [runningBatchCapacity, setRunningBatchCapacity] = useState<number | null>(null);
  const batchPreview = useMemo(() => mode === "session_batch"
    ? importedSessionBatch ?? parseGptSessionBatch(batchValue)
    : parseGptMailboxBatch(batchValue), [mode, importedSessionBatch, batchValue]);
  const [batchError, setBatchError] = useState("");
  const [preparedBatch, setPreparedBatch] = useState<BatchPreviewRow[] | null>(null);
  const [toolsTab, setToolsTab] = useState<"orders" | "lifecycle" | "cdk">("orders");
  const [oneCardPerAccount, setOneCardPerAccount] = useState(false);
  const [batchResults, setBatchResults] = useState<BatchResult[]>(() => savedProgress.batch.map((row, index) => ({ ...row, maskedEmail: `#${index + 1}` })));

  useEffect(() => {
    if (identity === null) return;
    try {
      localStorage.setItem(progressStorageKey(identity), JSON.stringify({ activeOrderId, previewStatus: preparedBatch ? "preflight_only" : undefined, singleStatus: singleUncertain ? "unknown" : orderPending ? "submitting" : undefined, batch: batchResults.map(({ status, orderId }) => ({ status, orderId })) }));
    } catch { /* Progress still works when browser storage is unavailable. */ }
  }, [identity, activeOrderId, batchResults, preparedBatch, orderPending, singleUncertain]);
  const [renewalSession, setRenewalSession] = useState("");
  const [renewalPending, setRenewalPending] = useState(false);
  const [renewalError, setRenewalError] = useState("");
  const [recoverySession, setRecoverySession] = useState("");
  const [recoveryPending, setRecoveryPending] = useState(false);
  const [recoveryError, setRecoveryError] = useState("");
  const orderIntent = useRef<{ token: string; key: string; clientRequestId: string } | null>(null);
  const purchaseIntent = useRef<{ fingerprint: string; key: string } | null>(null);

  const plansQuery = useQuery({
    queryKey: ["gpt-direct-plans"],
    queryFn: () => getGptDirectPlans(session!.token),
    enabled: Boolean(session && flags.gptDirect),
    retry: false,
    refetchInterval: mode === "batch" || mode === "session_batch" ? 15_000 : false,
  });
  const paymentRegions = plansQuery.data?.data.checkoutCountries?.length
    ? plansQuery.data.data.checkoutCountries
    : defaultPaymentRegions;
  const cardsQuery = useQuery({
    queryKey: ["cards", "gpt-direct", session?.userId ?? session?.email],
    queryFn: async () => {
      const first = await getCards(session!.token);
      const list = [...first.data.list];
      const pageSize = first.data.pageSize ?? 20;
      for (let page = 2; (page - 1) * pageSize < first.data.total; page += 1) {
        const next = await getCards(session!.token, page, pageSize);
        list.push(...next.data.list);
        if (!next.data.list.length) break;
      }
      return { ...first, data: { ...first.data, list } };
    },
    enabled: Boolean(session && flags.gptDirect),
  });
  const productsQuery = useQuery({ queryKey: ["products"], queryFn: () => getProducts(session!.token), enabled: Boolean(session && flags.gptDirect && flags.cardOpening) });
  const observedQuotesQuery = useQuery({ queryKey: ["gpt-observed-quotes"], queryFn: () => getGptObservedQuotes(session!.token), enabled: Boolean(session && flags.gptDirect), retry: false });
  const cardSuccessesQuery = useQuery({ queryKey: ["gpt-card-successes"], queryFn: () => getGptCardSuccesses(session!.token), enabled: Boolean(session && flags.gptDirect), retry: false });
  const openAiPricesQuery = useQuery({ queryKey: ["openai-prices"], queryFn: () => getOpenAiPrices(session!.token), enabled: Boolean(session && flags.gptDirect && flags.cardOpening), retry: false });
  const ordersQuery = useQuery({
    queryKey: ["gpt-direct-orders", orderSearch],
    queryFn: () => getGptDirectOrders(session!.token, orderSearch),
    enabled: Boolean(session),
    refetchInterval: (query) => query.state.data?.data.list.some((order) => !financiallyFinal(order)) ? 3_000 : false,
  });
  const cdksQuery = useQuery({
    queryKey: ["gpt-direct-cdks", cdkPage],
    queryFn: () => getGptDirectCdks(session!.token, cdkPage, 100),
    enabled: Boolean(session),
    refetchInterval: (query) => {
      const active = query.state.data?.data.list.find((cdk) => cdk.id === activeCdkId);
      const order = cdkRedemptionOrder(active);
      return order && !financiallyFinal(order) ? 3_000 : false;
    },
  });
  const cdkRegionSelectionEnabled = plansQuery.data?.data.cdkRegionSelectionEnabled === true;
  const forceNewCardEnabled = cdksQuery.data?.data.forceNewCardEnabled === true;
  const dedicatedCardMode = forceNewCardEnabled && forceNewCard;
  const orderQuery = useQuery({
    queryKey: ["gpt-direct-order", activeOrderId],
    queryFn: () => getGptDirectOrder(session!.token, activeOrderId),
    enabled: Boolean(session && activeOrderId),
    refetchInterval: (query) => {
      const order = query.state.data?.data.order;
      if (financiallyFinal(order)) return false;
      const updates = query.state.dataUpdateCount;
      return updates > 120 ? 30_000 : updates > 20 ? 10_000 : 3_000;
    },
  });

  const pendingBatchIds = batchResults.filter((row) => row.orderId && row.status === "processing").map((row) => row.orderId!);
  const resumedBatchQuery = useQuery({
    queryKey: ["gpt-direct-batch-progress", identity, pendingBatchIds],
    queryFn: async () => Promise.all(pendingBatchIds.map(async (id) => {
      try { return (await getGptDirectOrder(session!.token, id)).data.order; }
      catch { return null; }
    })),
    enabled: Boolean(session && !batchPending && pendingBatchIds.length),
    refetchInterval: 3_000,
  });
  useEffect(() => {
    if (!resumedBatchQuery.data) return;
    setBatchResults((rows) => rows.map((row) => {
      const order = resumedBatchQuery.data.find((order) => order?.id === row.orderId);
      return order ? { ...row, maskedEmail: order.maskedEmail || row.maskedEmail,
        status: financiallyFinal(order) ? order.status === "completed" ? "completed" : "failed" : "processing",
        message: t(`gptOrderStage.${order.stage}`, { defaultValue: order.stage || order.status }) } : row;
    }));
  }, [resumedBatchQuery.data, t]);

  useEffect(() => {
    if (!preflightData) return;
    const remaining = Date.parse(preflightData.preflightExpiresAt) - Date.now();
    const delay = Number.isFinite(remaining) && remaining > 0 ? Math.min(remaining, 2_147_483_647) : 0;
    const timer = window.setTimeout(() => setPreflightExpired(true), delay);
    return () => window.clearTimeout(timer);
  }, [preflightData]);

  const plans = plansList(plansQuery.data?.data.plans).filter((plan) => plan.enabled);
  const availablePlans = preflightData ? plans.filter((plan) => Boolean(preflightData.quotes[plan.key])) : plans;
  const { subscriptionPlans, creditPlans } = splitDirectPlans(availablePlans);
  const activeCards = cardsQuery.isError ? [] : cardsQuery.data?.data.list.filter((card) => card.status === "ACTIVE") ?? [];
  const selectedCardMode = !handoff && cardMode === "existing" && cardsQuery.isSuccess && activeCards.length === 0 && flags.cardOpening
    ? "auto"
    : cardMode;
  const requestedPlanKey = handoff?.plan || planKey || plans[0]?.key || "";
  // Quote availability must never change the customer's purchase target.
  const selectedPlanKey = creditsCustomActive && !parseCreditQuantity(requestedPlanKey) ? "" : requestedPlanKey;
  const creditQuantity = creditQuantityForPlan(selectedPlanKey);
  const creditQuotes = preflightData && creditQuantity
    ? Object.fromEntries(
      [creditQuoteFromBase(preflightData.quotes, creditQuantity)]
        .filter((quote): quote is NonNullable<typeof quote> => Boolean(quote))
        .map((quote) => [quote.plan, quote]),
    )
    : {};
  const workingQuotes = { ...preflightData?.quotes, ...creditQuotes };
  const selectedCardId = activeCards.some((card) => String(card.id) === cardId) ? cardId : handoff ? "" : activeCards[0] ? String(activeCards[0].id) : "";
  const selectedPaymentRegion = paymentRegions.find(({ country, currency }) => `${country}:${currency}` === paymentRegionKey) ?? paymentRegions[0];
  const sessionNeedsRelogin = sessionRequiresRelogin(sessionValue);
  const isBatch = mode === "batch" || mode === "session_batch";

  function updateDraft(values: Partial<typeof draft>) {
    setDraft((current) => ({ ...current, ...values }));
  }

  function credential(): GptDirectCredential {
    if (mode === "mailbox") return { mode, email: mailboxEmail.trim(), password: mailboxPassword };
    return { mode: "session", session: normalizeGptSession(sessionValue) };
  }

  function clearPreflight() {
    setPreparedBatch(null);
    orderIntent.current = null;
    setPreflightData(null);
    setPreflightExpired(false);
    setPreflightError("");
    setOrderError("");
  }

  function clearSensitiveFields(preserveProxy = false) {
    setImportedSessionBatch(null);
    updateDraft({ sessionValue: "", batchValue: "", mailboxEmail: "", mailboxPassword: "" });
    setExternalCardNumber("");
    setExternalCardExpiry("");
    setExternalCardCvv("");
    setExternalCardHolder("");
    if (!preserveProxy) setCustomProxyUrl("");
  }

  function discardTelegramHandoff() {
    sessionStorage.removeItem("telegramGptIntent");
    setHandoff(null);
    setTelegramIntentId("");
    setCardId("");
    clearPreflight();
  }

  function requestRecentAuth() {
    sessionStorage.setItem("recentAuthReturnPath", "/gpt-direct");
    window.location.assign("/login");
  }

  async function generateCdk(plan: string) {
    if (purchasingPlan || !flags.gptCdk) return;
    const quantity = Math.min(Math.max(cdkQuantities[`generate:${plan}`] ?? 1, 1), 50);
    const country = cdkRegionSelectionEnabled ? cdkPaymentCountry || paymentRegions[0]?.country : undefined;
    const fingerprint = `generate:${plan}:${quantity}:${dedicatedCardMode ? 1 : 0}:${country}`;
    if (purchaseIntent.current?.fingerprint !== fingerprint) {
      purchaseIntent.current = { fingerprint, key: crypto.randomUUID() };
    }
    setPurchasingPlan(`generate:${plan}`);
    setPurchaseError("");
    setPurchasedCdk(null);
    setCopiedCdk("");
    try {
      const response = await generateGptCdk(session!.token, plan, quantity, dedicatedCardMode, purchaseIntent.current.key, country);
      setPurchasedCdk(response.data);
      purchaseIntent.current = null;
      setCdkPage(1);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["gpt-direct-cdks"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
    } catch (error) {
      if (error instanceof ApiError && error.errorCode === "RECENT_AUTH_REQUIRED") {
        requestRecentAuth();
        return;
      }
      setPurchaseError(error instanceof Error ? error.message : t("gptCdkGenerateFailed"));
    } finally {
      setPurchasingPlan("");
    }
  }

  async function toggleCdkSensitive(id: string) {
    if (revealedCdks[id]) {
      setRevealedCdks((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      return;
    }
    setRevealError("");
    setRevealingCdkId(id);
    try {
      const response = await getGptCdkSensitive(session!.token, id);
      setRevealedCdks((current) => ({ ...current, [id]: response.data.code }));
    } catch (error) {
      if (error instanceof ApiError && error.errorCode === "RECENT_AUTH_REQUIRED") {
        requestRecentAuth();
        return;
      }
      setRevealError(error instanceof Error ? error.message : t("gptCdkRevealFailed"));
    } finally {
      setRevealingCdkId("");
    }
  }

  async function exportCdks() {
    if (exportingCdks) return;
    setExportingCdks(true);
    setExportError("");
    try {
      const archive = await exportGptCdks(session!.token);
      const url = URL.createObjectURL(archive);
      const link = document.createElement("a");
      link.href = url;
      link.download = "avanfinity-cdks.zip";
      try {
        document.body.append(link);
        link.click();
      } finally {
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 0);
      }
    } catch (error) {
      if (error instanceof ApiError && error.errorCode === "RECENT_AUTH_REQUIRED") {
        requestRecentAuth();
        return;
      }
      setExportError(error instanceof Error ? error.message : t("gptCdkExportFailed"));
    } finally {
      setExportingCdks(false);
    }
  }

  const cancelOrder = useMutation({
    mutationFn: (id: string) => cancelGptDirectOrder(session!.token, id),
    onSuccess: async ({ data }) => {
      setAcceptedOrder(data);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["gpt-direct-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["gpt-direct-order", data.id] }),
      ]);
    },
  });

  if (!session) return <Navigate to="/login" />;

  const selectedPlan = plans.find((plan) => plan.key === selectedPlanKey)
    ?? (creditQuantity && (creditPlans[0] || plans.find((plan) => isCreditPlan(plan.key)))
      ? {
        ...(creditPlans[0] || plans.find((plan) => isCreditPlan(plan.key))!),
        key: selectedPlanKey,
        label: `Credits ${creditQuantity.toLocaleString("en-US")}`,
      }
      : undefined);
  const selectedQuote = workingQuotes[selectedPlanKey];
  const observedQuote = observedQuotesQuery.data?.data.list.find((quote) => quote.plan === selectedPlanKey
    && quote.country === selectedPaymentRegion.country && quote.currency === selectedPaymentRegion.currency);
  const quoteError = preflightData?.quoteError;
  const currentOrder = orderQuery.data?.data.order ?? acceptedOrder;
  const activeCdk = cdksQuery.data?.data.list.find((cdk) => cdk.id === activeCdkId);
  const activeCdkOrder = cdkRedemptionOrder(activeCdk);
  const drawerOrder = activeCdkId ? activeCdkOrder : currentOrder;
  const drawerEvents = activeCdkId ? activeCdk?.events : orderQuery.data?.data.events;
  const locale = i18n.language === "en" ? "en-US" : "zh-CN";
  const regionNames = new Intl.DisplayNames([locale], { type: "region" });
  const formatQuote = (quote: GptDirectQuote) => {
    const amount = quote.amountMajor ?? quote.amountMinor / 10 ** quote.minorUnitExponent;
    try {
      return new Intl.NumberFormat(locale, { style: "currency", currency: quote.currency , minimumFractionDigits: 0, maximumFractionDigits: 20 }).format(amount);
    } catch {
      return `${formatDecimal(amount)} ${quote.currency}`;
    }
  };
  const formatReferencePrice = (amount: string, currency: string) => {
    const numeric = Number(amount);
    try {
      return Number.isFinite(numeric) ? new Intl.NumberFormat(locale, { style: "currency", currency , minimumFractionDigits: 0, maximumFractionDigits: 20 }).format(numeric) : `${formatDecimal(amount)} ${currency}`;
    } catch {
      return `${formatDecimal(amount)} ${currency}`;
    }
  };
  const estimatedUsdLabel = (amount?: string | null) => {
    const numeric = Number(amount);
    return amount && Number.isFinite(numeric) && numeric > 0
      ? t("gptEstimatedUsd", { amount: numeric.toLocaleString(locale, { minimumFractionDigits: 0, maximumFractionDigits: 20 }) })
      : "";
  };
  const priceWithEstimate = (price: string, currency: string, estimatedUsd?: string | null) => {
    const estimate = currency === "USD" ? "" : estimatedUsdLabel(estimatedUsd);
    return `${formatDecimal(price)}${estimate ? ` · ${estimate}` : ""}`;
  };
  const cardPerformance = new Map(cardSuccessesQuery.data?.data.list.map((item) => [item.cardId, item]) ?? []);
  const selectedCardPerformance = cardPerformance.get(Number(selectedCardId));
  const statusLabel = (status: string) => t(`gptOrderStatus.${status}`, { defaultValue: status });
  const stageLabel = (stage?: string | null) => stage ? t(`gptOrderStage.${stage}`, { defaultValue: stage }) : "";
  const purchasedItems = purchasedCdk
    ? purchasedCdk.items?.length
      ? purchasedCdk.items
      : [{ saleId: purchasedCdk.saleId, cdkId: purchasedCdk.cdkId, code: purchasedCdk.code, codePrefix: purchasedCdk.codePrefix }]
    : [];
  const cdkTotalPages = Math.max(1, Math.ceil((cdksQuery.data?.data.total ?? 0) / 100));
  const customerFee = selectedCardMode === "external"
    ? plansQuery.data?.data.externalCardServiceFee ?? ""
    : selectedPlan?.customerServiceFee ?? ((selectedPlan?.serviceFeeUsdMinor ?? 0) / 100).toFixed(2);
  const autoQuoteUsd = preflightData?.quoteEstimatesUsd?.[selectedPlanKey]
    ?? (creditQuantity && preflightData?.quoteEstimatesUsd?.credits_250
      ? creditFundingUsd(preflightData.quoteEstimatesUsd.credits_250, 250, creditQuantity)
      : "");
  const displayQuoteUsd = preflightData?.displayQuoteEstimatesUsd?.[selectedPlanKey]
    ?? (creditQuantity && preflightData?.displayQuoteEstimatesUsd?.credits_250
      ? creditFundingUsd(preflightData.displayQuoteEstimatesUsd.credits_250, 250, creditQuantity)
      : autoQuoteUsd);
  const autoRequiredAmount = autoCardAmount(autoQuoteUsd);
  const autoProduct = selectAutoProduct(productsQuery.data?.data ?? [], autoRequiredAmount, selectedPlanKey, openAiPricesQuery.data?.data.binStats ?? []);
  const autoInitAmount = amountForProduct(autoRequiredAmount, autoProduct);
  const autoInitialRechargeFee = autoProduct && autoInitAmount ? initialRechargeFee4(autoInitAmount, autoProduct.rechargeRate) : "";
  const autoCardDebit = autoProduct && autoInitialRechargeFee ? addMoney4(autoInitAmount, autoProduct.openFee, autoInitialRechargeFee) : "";
  const autoEstimatedDebit = autoCardDebit ? addMoney4(autoCardDebit, customerFee) : "";
  const retryProducts = (productsQuery.data?.data ?? []).filter(product => !product.googleChatgptBlocked);
  const retryProduct = retryProducts.find(product => product.productCode === retryProductCode);
  const retryInitAmount = amountForProduct(autoRequiredAmount, retryProduct);
  const retryFundingFee = retryProduct && retryInitAmount ? initialRechargeFee4(retryInitAmount, retryProduct.rechargeRate) : "";
  const retryServiceFee = selectedPlan?.customerServiceFee ?? "";
  const retryEstimate = retryProduct && retryInitAmount && retryFundingFee
    ? addMoney4(retryInitAmount, retryProduct.openFee, retryFundingFee, retryServiceFee) : "";
  const retryBudgetUnits = money4Units(retryBudget);
  const retryReady = !retryEnabled || (flags.gptDirectNewCardRetry === true && flags.cardOpening && Boolean(retryProduct)
    && retryBudgetUnits !== null && retryBudgetUnits > 0n && retryBudgetUnits <= 10_000_000_000n
    && (isBatch || (Boolean(retryEstimate) && retryBudgetUnits >= (money4Units(retryEstimate) ?? 0n))));
  const externalCardReady = /^\d{12,19}$/.test(externalCardNumber)
    && /^\d{2}\/\d{2}$/.test(externalCardExpiry)
    && /^\d{3,4}$/.test(externalCardCvv)
    && externalCardHolder.length <= 80
    && Boolean(customerFee);
  const cardReady = selectedCardMode === "auto"
    ? Boolean(autoProduct && autoInitAmount && autoInitialRechargeFee)
    : selectedCardMode === "external" ? externalCardReady : Boolean(selectedCardId);
  const batchMaxAccounts = mode === "session_batch" ? GPT_SESSION_BATCH_MAX_ACCOUNTS : GPT_BATCH_MAX_ACCOUNTS;
  const batchCapacity = gptBatchConcurrency(plansQuery.data?.data.batchConcurrencyByCountry, selectedPaymentRegion.country, Boolean(customProxyUrl.trim()));
  const batchPaymentReady = selectedCardMode === "auto"
    ? !productsQuery.isLoading && !openAiPricesQuery.isLoading
    : selectedCardMode === "external" ? externalCardReady : Boolean(selectedCardId);
  const busy = preflightPending || orderPending || batchPending || batchImportPending;
  const checkoutReady = Boolean(preflightData) || Boolean(preparedBatch?.length) || batchResults.length > 0;
  const createDisabled = !flags.gptDirect || !selectedPlan || !cardReady || !preflightData || !selectedQuote || Boolean(quoteError) || preflightExpired || busy || singleUncertain || !retryReady || (creditsCustomActive && !creditQuantity);

  function orderPayload(
    preflight: GptDirectPreflight,
    accountCredential: GptDirectCredential,
    clientRequestId: string,
    smartCard = false,
    excludedCardIds: number[] = [],
  ): Parameters<typeof createGptDirectOrder>[1] {
    const quote = creditQuantity ? creditQuoteFromBase(preflight.quotes, creditQuantity) : preflight.quotes[selectedPlanKey];
    if (!plansQuery.data || !quote || preflight.quoteError) {
      throw new Error(preflight.quoteErrors?.[selectedPlanKey] || t("gptBatchPlanUnavailable"));
    }
    const quoteUsd = preflight.quoteEstimatesUsd?.[selectedPlanKey]
      ?? (creditQuantity && preflight.quoteEstimatesUsd?.credits_250
        ? creditFundingUsd(preflight.quoteEstimatesUsd.credits_250, 250, creditQuantity)
        : "");
    const requiredAmount = autoCardAmount(quoteUsd);
    const product = selectAutoProduct(
      productsQuery.data?.data ?? [],
      requiredAmount,
      selectedPlanKey,
      openAiPricesQuery.data?.data.binStats ?? [],
    );
    const initAmount = amountForProduct(requiredAmount, product);
    const rechargeFee = product && initAmount ? initialRechargeFee4(initAmount, product.rechargeRate) : "";
    if (selectedCardMode === "auto" && (!product || !initAmount || !rechargeFee)) {
      throw new Error(t("gptAutoCardUnavailable"));
    }
    if (selectedCardMode === "external" && !externalCardReady) {
      throw new Error(t("gptBatchPaymentRequired"));
    }
    if (selectedCardMode === "existing" && !selectedCardId) {
      throw new Error(t("gptBatchPaymentRequired"));
    }
    let retryPolicy: Parameters<typeof createGptDirectOrder>[1]["retryPolicy"];
    if (retryEnabled) {
      const initial = amountForProduct(requiredAmount, retryProduct);
      const fee = retryProduct && initial ? initialRechargeFee4(initial, retryProduct.rechargeRate) : "";
      const total = retryProduct && fee ? addMoney4(initial, retryProduct.openFee, fee, retryServiceFee) : "";
      if (!retryReady || !retryProduct || !total || retryBudgetUnits! < (money4Units(total) ?? 0n)
        || (money4Units(initial) ?? 0n) > (money4Units(retryProduct.maxAmount) ?? 0n)) {
        throw new Error(t("gptRetryInvalid"));
      }
      retryPolicy = { enabled: true, maxAdditionalAttempts: 1, productCode: retryProduct.productCode,
        maxAdditionalWalletDebitUsd: retryBudget, openQuoteVersion: retryProduct.openQuoteVersion,
        expectedOpenFee: retryProduct.openFee, expectedInitialRechargeFee: fee };
    }
    return {
      retryPolicy,
      cardId: selectedCardMode === "existing" ? Number(selectedCardId) : 0,
      autoCard: selectedCardMode === "auto" && product ? {
        productCode: product.productCode,
        initAmount,
        expectedOpenFee: product.openFee,
        expectedInitialRechargeFee: rechargeFee,
        openQuoteVersion: product.openQuoteVersion,
        quoteCountry: preflight.paymentCountry,
        quoteCurrency: preflight.paymentCurrency,
        quotedAmountUsd: quoteUsd,
        reuseExisting: smartCard ? !oneCardPerAccount : undefined,
        oneCardPerAccount: smartCard && oneCardPerAccount ? true : undefined,
        excludedCardIds: smartCard && excludedCardIds.length ? excludedCardIds : undefined,
      } : undefined,
      externalCard: selectedCardMode === "external" ? {
        number: externalCardNumber,
        expiry: externalCardExpiry,
        cvv: externalCardCvv,
        holder: externalCardHolder.trim() || undefined,
      } : undefined,
      plan: selectedPlanKey,
      credential: accountCredential,
      preflightToken: preflight.preflightToken,
      clientRequestId,
      pricingVersion: plansQuery.data.data.version,
      expectedCustomerServiceFee: customerFee,
    };
  }

  async function submitPreflight(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!flags.gptDirect) return;
    if (isBatch) {
      await preflightBatch();
      return;
    }
    await runPreflight(selectedPaymentRegion, customProxyUrl.trim());
  }

  async function runPreflight(region: { country: string; currency: string }, proxy: string) {
    orderIntent.current = null;
    setAcceptedOrder(null);
    setPreflightPending(true);
    setPreflightError("");
    setOrderError("");
    setPreflightData(null);
    try {
      const response = await preflightGptDirect(
        session!.token,
        credential(),
        region.country,
        region.currency,
        proxy,
      );
      setPreflightExpired(false);
      setPreflightData(response.data);
      void queryClient.invalidateQueries({ queryKey: ["gpt-observed-quotes"] });
    } catch (error) {
      setPreflightError(error instanceof Error ? error.message : t("gptPreflightFailed"));
    } finally {
      setPreflightPending(false);
    }
  }

  async function acceptUpgradeRegion(plan: string, region: { country: string; currency: string }) {
    if (busy || isBatch || !preflightData || preflightExpired || Date.parse(preflightData.preflightExpiresAt) <= Date.now()
      || preflightData.upgradeCurrencies?.[plan] !== region.currency
      || !plansQuery.data?.data.checkoutCountries?.some((item) => item.country === region.country && item.currency === region.currency)
      || (handoff && handoff.plan !== plan)) return;
    updateDraft({ paymentRegionKey: `${region.country}:${region.currency}`, planKey: plan });
    setCustomProxyUrl("");
    await runPreflight(region, "");
  }

  async function createWithCardWait(payload: Parameters<typeof createGptDirectOrder>[1], key: string, onWaiting: (message: string) => void) {
    const deadline = Date.now() + 120_000;
    for (;;) {
      try { return await createGptDirectOrder(session!.token, payload, key); }
      catch (error) {
        if (!(error instanceof ApiError)) throw error;
        const dispatchPending = error.errorCode === "GPT_DIRECT_DISPATCH_PENDING";
        if (!dispatchPending && (selectedCardMode !== "auto"
          || (!(["AUTO_CARD_PENDING", "SMART_CARD_POOL_BUSY"].includes(error.errorCode ?? "")) && error.status !== 429))) throw error;
        const delay = error.status === 429 ? Math.max(1, error.retryAfterSeconds ?? 60) * 1000 : 2_000;
        if (Date.now() + delay > deadline) throw error;
        onWaiting(dispatchPending ? error.message : t("gptAutoCardPending"));
        await new Promise((resolve) => window.setTimeout(resolve, delay));
      }
    }
  }

  async function submitOrder() {
    if (!flags.gptDirect || !selectedPlan || !cardReady || !selectedQuote || !preflightData || !plansQuery.data || orderPending || singleUncertain) return;
    if (preflightExpired || Date.parse(preflightData.preflightExpiresAt) <= Date.now()) {
      setPreflightData(null);
      setPreflightError(t("gptPreflightExpired"));
      return;
    }
    const token = preflightData.preflightToken;
    if (orderIntent.current?.token !== token) {
      orderIntent.current = { token, key: crypto.randomUUID(), clientRequestId: telegramIntentId ? `telegram:${telegramIntentId}` : crypto.randomUUID() };
    }
    const intent = orderIntent.current;
    setOrderPending(true);
    setOrderError("");
    try {
      const payload = orderPayload(preflightData, credential(), intent.clientRequestId);
      const response = await createWithCardWait(payload, intent.key, setOrderError);
      setOrderError("");
      if (telegramIntentId) sessionStorage.removeItem("telegramGptIntent");
      setSingleUncertain(false);
      setAcceptedOrder(response.data);
      setActiveOrderId(response.data.id);
      clearSensitiveFields();
      setPreflightData(null);
      orderIntent.current = null;
      if (telegramIntentId) {
        setTelegramIntentId("");
        setHandoff(null);
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["gpt-direct-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
    } catch (error) {
      if (error instanceof ApiError && ["PRICE_CHANGED", "AUTO_CARD_QUOTE_CHANGED", "AUTO_CARD_QUOTE_EXPIRED"].includes(error.errorCode ?? "")) {
        orderIntent.current = null;
        await queryClient.refetchQueries({ queryKey: ["products"], type: "active" });
        clearPreflight();
        setPreflightError(t("gptAutoCardQuoteChanged"));
        return;
      }
      if (error instanceof ApiError && ["RECENT_AUTH_REQUIRED", "PASSWORD_SESSION_REQUIRED"].includes(error.errorCode ?? "")) {
        clearSensitiveFields();
        requestRecentAuth();
        return;
      }
      if (!(error instanceof ApiError) || error.status >= 500 || error.status === 429 || ["AUTO_CARD_PENDING", "SMART_CARD_POOL_BUSY", "GPT_DIRECT_DISPATCH_PENDING"].includes(error.errorCode ?? "")) setSingleUncertain(true);
      setOrderError(error instanceof Error ? error.message : t("gptOrderFailed"));
    } finally {
      setOrderPending(false);
    }
  }

  function updateBatchResult(index: number, values: Partial<BatchResult>) {
    setBatchResults((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...values } : item));
  }

  function batchParseMessage(error = batchPreview.error) {
    if (!error) return "";
    return t(`gptBatchParseError.${error.code}`, {
      line: error.line,
      max: batchMaxAccounts,
    });
  }

  async function importSessionFile(file: File) {
    setPreparedBatch(null);
    setImportedSessionBatch(null);
    updateDraft({ batchValue: "" });
    setBatchError("");
    if (file.size > GPT_SESSION_FILE_MAX_BYTES) {
      setBatchError(t("gptBatchFileTooLarge"));
      return;
    }
    setBatchImportPending(true);
    try {
      const parsed = parseGptSessionBatch(await file.text());
      if (parsed.error) setBatchError(batchParseMessage(parsed.error));
      else setImportedSessionBatch(parsed);
    } catch {
      setBatchError(t("gptBatchFileFailed"));
    } finally {
      setBatchImportPending(false);
    }
  }

  async function waitForBatchOrder(orderId: string, index: number) {
    for (let attempt = 0; attempt < 600; attempt += 1) {
      const response = await getGptDirectOrder(session!.token, orderId);
      const order = response.data.order;
      updateBatchResult(index, { status: "processing", message: stageLabel(order.stage) || statusLabel(order.status) });
      if (financiallyFinal(order)) return order;
      await new Promise((resolve) => window.setTimeout(resolve, 3_000));
    }
    return null;
  }

  function batchCredential(account: ReturnType<typeof parseGptMailboxBatch>["accounts"][number] | ReturnType<typeof parseGptSessionBatch>["accounts"][number]): GptDirectCredential {
    return "session" in account ? { mode: "session", session: account.session }
      : account.chatgptPassword && account.totpSecret ? { mode: "password", email: account.email, password: account.chatgptPassword, totpSecret: account.totpSecret }
      : { mode: "mailbox", email: account.email, password: account.password };
  }

  async function previewAccount(row: BatchPreviewRow): Promise<BatchPreviewRow> {
    try {
      const preflight = (await preflightGptDirect(session!.token, row.credential, selectedPaymentRegion.country, selectedPaymentRegion.currency, customProxyUrl.trim())).data;
      const quote = creditQuantity ? creditQuoteFromBase(preflight.quotes, creditQuantity) : preflight.quotes[selectedPlanKey];
      return { ...row, preflight, error: !quote || preflight.quoteError ? preflight.quoteErrors?.[selectedPlanKey] || preflight.quoteError || t("gptBatchPlanUnavailable") : undefined, selected: Boolean(quote && !preflight.quoteError && row.selected) };
    } catch (error) {
      return { ...row, preflight: undefined, error: error instanceof Error ? error.message : t("gptPreflightFailed"), selected: false };
    }
  }

  async function preflightBatch() {
    if (busy) return;
    if (batchPreview.error) { setBatchError(batchParseMessage()); return; }
    if (!selectedPlan || !plansQuery.data) { setBatchError(t("gptBatchPlanRequired")); return; }
    setPreflightPending(true);
    setBatchError("");
    const rows = batchPreview.accounts.map((account) => ({ email: account.email, credential: batchCredential(account), selected: true }));
    setPreparedBatch(null);
    try {
      const capacity = gptBatchConcurrency((await getGptDirectPlans(session!.token)).data.batchConcurrencyByCountry, selectedPaymentRegion.country, Boolean(customProxyUrl.trim()));
      const results: BatchPreviewRow[] = rows.map((row) => ({ ...row, error: t("gptBatchNotSubmitted"), selected: false }));
      await runGptBatch(rows, async () => capacity, async (row, index) => { results[index] = await previewAccount(row); return true; });
      clearSensitiveFields(true);
      setPreparedBatch(results);
      void queryClient.invalidateQueries({ queryKey: ["gpt-observed-quotes"] });
    } catch (error) { setBatchError(error instanceof Error ? error.message : t("gptPreflightFailed")); }
    finally { setPreflightPending(false); }
  }

  async function submitBatch() {
    if (busy || !preparedBatch || !selectedPlan || !plansQuery.data) return;
    if (!batchPaymentReady) { setBatchError(t("gptBatchPaymentRequired")); return; }
    if (!retryReady) { setBatchError(t("gptRetryInvalid")); return; }
    const accounts = preparedBatch.filter((row) => row.selected && row.preflight && !row.error);
    if (!accounts.length) return;
    if (accounts.some((row) => Date.parse(row.preflight!.preflightExpiresAt) <= Date.now() + 5_000)) {
      setPreflightPending(true);
      try {
        const refreshed = await Promise.all(preparedBatch.map((row) => row.selected ? previewAccount(row) : row));
        setPreparedBatch(refreshed);
        setBatchError(t("gptBatchQuoteRefreshed"));
      } finally { setPreflightPending(false); }
      return;
    }
    setPreparedBatch(null);
    setBatchError("");
    setPreflightData(null);
    setAcceptedOrder(null);
    setBatchResults(accounts.map(({ email }) => ({ maskedEmail: maskEmail(email), status: "queued" })));
    updateDraft({ batchValue: "" });
    setBatchPending(true);
    const excludedCardIds: number[] = [];
    let haltBatch = false;
    let cardTail = Promise.resolve();
    let cachedCapacity = 0;
    let capacityCheckedAt = 0;
    const capacity = async () => {
      if (haltBatch) return 0;
      if (Date.now() - capacityCheckedAt >= 15_000) {
        const fresh = await getGptDirectPlans(session!.token);
        cachedCapacity = gptBatchConcurrency(fresh.data.batchConcurrencyByCountry, selectedPaymentRegion.country, Boolean(customProxyUrl.trim()));
        capacityCheckedAt = Date.now();
        setRunningBatchCapacity(cachedCapacity);
      }
      return cachedCapacity;
    };
    try {
      const dispatched = await runGptBatch<(typeof accounts)[number]>(accounts, capacity, async (account, index) => {
        let releaseCard: (() => void) | undefined;
        let submitting = false;
        let acceptedOrderId: string | undefined;
        const accountCredential = account.credential;
        try {
          for (let cardAttempt = 0; cardAttempt < 9; cardAttempt += 1) {
            updateBatchResult(index, { status: "preflighting", message: t(accountCredential.mode === "session" ? "gptBatchSessionPreflight" : "gptBatchLoggingIn") });
            const verify = async () => (await preflightGptDirect(
              session!.token,
              accountCredential,
              selectedPaymentRegion.country,
              selectedPaymentRegion.currency,
              customProxyUrl.trim(),
            )).data;
            if (cardAttempt === 0 && !(Date.parse(account.preflight!.preflightExpiresAt) > Date.now() + 5_000)) throw new Error(t("gptBatchQueuedQuoteExpired"));
            let preflight: GptDirectPreflight;
            try { preflight = cardAttempt === 0 ? account.preflight! : await verify(); } catch (error) {
              if (!(error instanceof ApiError) || error.status !== 429) throw error;
              updateBatchResult(index, { message: t("gptBatchRateWaiting") });
              await new Promise((resolve) => window.setTimeout(resolve, Math.max(60, error.retryAfterSeconds ?? 60) * 1000));
              if (haltBatch) return false;
              preflight = await verify();
            }
            if (selectedCardMode !== "auto" && !releaseCard) {
              const previous = cardTail;
              cardTail = new Promise<void>((resolve) => { releaseCard = resolve; });
              updateBatchResult(index, { message: t("gptBatchCardWaiting") });
              await previous;
              if (haltBatch) return false;
              if (!(Date.parse(preflight.preflightExpiresAt) > Date.now() + 5_000)) throw new Error(t("gptBatchQueuedQuoteExpired"));
            }
            if (haltBatch) return false;
            const approvedQuote = creditQuantity ? creditQuoteFromBase(account.preflight!.quotes, creditQuantity) : account.preflight!.quotes[selectedPlanKey];
            const currentQuote = creditQuantity ? creditQuoteFromBase(preflight.quotes, creditQuantity) : preflight.quotes[selectedPlanKey];
            if (!currentQuote || !approvedQuote || preflight.quoteError || currentQuote.amountMinor !== approvedQuote.amountMinor || currentQuote.currency !== approvedQuote.currency || currentQuote.country !== approvedQuote.country || preflight.currentPlan !== account.preflight!.currentPlan) throw new Error(t("gptBatchQueuedQuoteExpired"));
            updateBatchResult(index, { status: "submitting", message: t("gptBatchSubmitting") });
            const payload = orderPayload(
              preflight,
              accountCredential,
              crypto.randomUUID(),
              selectedCardMode === "auto",
              excludedCardIds,
            );
            const idempotencyKey = crypto.randomUUID();
            submitting = true;
            const created = await createWithCardWait(payload, idempotencyKey, (message) => updateBatchResult(index, { message }));
            acceptedOrderId = created.data.id;
            updateBatchResult(index, { status: "processing", orderId: created.data.id, message: statusLabel(created.data.status) });
            const finished = financiallyFinal(created.data)
              ? created.data
              : await waitForBatchOrder(created.data.id, index);
            if (!finished) {
              updateBatchResult(index, { status: "processing", message: t("gptBatchOrderStillRunning") });
              haltBatch = true;
              return false;
            }
            if (finished.status === "completed") {
              updateBatchResult(index, { status: "completed", message: t("gptBatchCompleted") });
              break;
            }
            const canRotate = selectedCardMode === "auto"
              && !oneCardPerAccount
              && finished.status === "declined"
              && finished.operationStatus === "COMPENSATED"
              && finished.autoOpenedCard === false
              && Number.isSafeInteger(finished.cardId)
              && finished.cardId! > 0
              && !excludedCardIds.includes(finished.cardId!)
              && excludedCardIds.length < 8;
            if (canRotate) {
              submitting = false;
              acceptedOrderId = undefined;
              excludedCardIds.push(finished.cardId!);
              updateBatchResult(index, { status: "preflighting", orderId: undefined, message: t("gptBatchSwitchingCard") });
              continue;
            }
            updateBatchResult(index, { status: "failed", message: statusLabel(finished.status) });
            break;
          }
        } catch (error) {
          const uncertain = submitting && (Boolean(acceptedOrderId) || !(error instanceof ApiError)
            || error.status >= 500 || error.status === 429 || ["AUTO_CARD_PENDING", "SMART_CARD_POOL_BUSY", "GPT_DIRECT_DISPATCH_PENDING"].includes(error.errorCode ?? ""));
          if (uncertain) haltBatch = true;
          updateBatchResult(index, {
            status: uncertain ? "processing" : "failed",
            message: error instanceof Error ? error.message : t("gptOrderFailed"),
          });
        } finally {
          releaseCard?.();
          if (accountCredential.mode === "session") accountCredential.session = "";
          else accountCredential.password = "";
        }
        return !haltBatch;
      });
      if (dispatched < accounts.length || haltBatch) {
        setBatchError(t("gptBatchStopped"));
        setBatchResults((current) => current.map((item) => !item.orderId && ["queued", "preflighting"].includes(item.status)
          ? { ...item, status: "not_submitted", message: t("gptBatchNotSubmitted") } : item));
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["gpt-direct-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
    } finally {
      accounts.forEach(({ credential }) => { if (credential.mode === "session") credential.session = ""; else credential.password = ""; });
      clearSensitiveFields();
      setBatchPending(false);
      setRunningBatchCapacity(null);
    }
  }

  async function submitRenewal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentOrder || renewalPending) return;
    setRenewalPending(true);
    setRenewalError("");
    try {
      await cancelGptDirectRenewal(session!.token, currentOrder.id, { mode: "session", session: renewalSession.trim() });
      setRenewalSession("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["gpt-direct-order", currentOrder.id] }),
        queryClient.invalidateQueries({ queryKey: ["gpt-direct-orders"] }),
      ]);
    } catch (error) {
      setRenewalError(error instanceof Error ? error.message : t("gptRenewalCancelFailed"));
    } finally {
      setRenewalPending(false);
    }
  }

  async function submitRecoverySession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentOrder || recoveryPending) return;
    setRecoveryPending(true);
    setRecoveryError("");
    try {
      await replaceGptDirectOrderSession(session!.token, currentOrder.id, { mode: "session", session: recoverySession.trim() });
      setRecoverySession("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["gpt-direct-order", currentOrder.id] }),
        queryClient.invalidateQueries({ queryKey: ["gpt-direct-orders"] }),
      ]);
    } catch (error) {
      setRecoveryError(error instanceof Error ? error.message : t("gptSessionRecoveryFailed"));
    } finally {
      setRecoveryPending(false);
    }
  }

  return <PageShell className="gpt-direct-page" eyebrow="GPT DIRECT" title={t("gptDirectTitle")} description={t("gptDirectDesc")}>
    {handoff && <section className="gpt-telegram-handoff" role="status">
      <Bot />
      <div><strong>{t("telegramGptHandoffTitle")}</strong><p>{t("telegramGptHandoffDesc")}</p></div>
      <Button type="button" variant="outline" onClick={discardTelegramHandoff}>{t("telegramGptHandoffDiscard")}</Button>
    </section>}

    <nav className="gpt-direct-steps" aria-label={t("gptDirectTitle")}>
      <div className={`gpt-direct-step${!checkoutReady ? " is-current" : " is-done"}`}>
        <span>1</span>
        <strong>{t("gptDirectStepPreflight")}</strong>
        {checkoutReady && <small>{t("gptDirectStepDone")}</small>}
      </div>
      <div className="gpt-direct-step-rail" aria-hidden="true" />
      <div className={`gpt-direct-step${checkoutReady ? " is-current" : " is-pending"}`}>
        <span>2</span>
        <strong>{t("gptDirectStepCheckout")}</strong>
        {!checkoutReady && <small>{t("gptDirectCheckoutWaiting")}</small>}
      </div>
    </nav>
    <p className="gpt-direct-flow-hint">{t("gptDirectFlowHint")}</p>

    <div className="gpt-direct-layout">
      <section className={`gpt-direct-panel${!checkoutReady ? " is-focus" : ""}`}>
        <div className="section-title"><div><span className="eyebrow">01 · PREFLIGHT</span><h2>{t("gptCredentialPreflight")}</h2></div></div>
        {flags.gptDirect ? <form className="gpt-direct-form" onSubmit={submitPreflight}>
          <fieldset className="gpt-credential-modes">
            <legend>{t("gptCredentialMode")}</legend>
            {(["session", "session_batch", "batch", "mailbox"] as const).map((value) => <label key={value}>
              <input type="radio" name="credentialMode" value={value} checked={mode === value} disabled={busy} onChange={() => {
                setImportedSessionBatch(null);
                updateDraft({ mode: value, sessionValue: "", batchValue: "", mailboxEmail: "", mailboxPassword: "" });
                if (value === "batch" && flags.cardOpening) setCardMode("auto");
                clearPreflight();
                setBatchError("");
                setBatchResults([]);
              }} />
              <span>{t(`gptCredentialModeLabel.${value}`)}</span>
            </label>)}
          </fieldset>

          {mode === "session" && <label>{t("gptSessionCredential")}
            <textarea aria-label={t("gptSessionCredential")} rows={4} value={sessionValue} onChange={(event) => { updateDraft({ sessionValue: event.target.value }); clearPreflight(); }} autoComplete="off" spellCheck={false} disabled={busy} required />
            <span className="gpt-session-help"><small>{t("gptSessionCredentialHint")}</small><a href="https://chatgpt.com/api/auth/session" target="_blank" rel="noreferrer">{t("gptGetSession")}</a></span>
            {sessionNeedsRelogin
              ? <small className="gpt-session-warning" role="alert">{t("gptSessionNeedsRelogin")}</small>
              : sessionValue.trim().startsWith("eyJ") && <small className="gpt-session-warning" role="alert">{t("gptSessionLooksLikeAccessToken")}</small>}
          </label>}
          {isBatch && <label>{t(mode === "session_batch" ? "gptBatchSessions" : "gptBatchAccounts")}
            <textarea aria-label={t(mode === "session_batch" ? "gptBatchSessions" : "gptBatchAccounts")} rows={8} value={batchValue} onChange={(event) => { setImportedSessionBatch(null); setPreparedBatch(null); updateDraft({ batchValue: event.target.value }); setBatchError(""); }} autoComplete="off" spellCheck={false} disabled={busy} placeholder={t(mode === "session_batch" ? "gptBatchSessionPlaceholder" : "gptBatchPlaceholder")} required={!importedSessionBatch} />
            <span className="gpt-session-help"><small>{t(mode === "session_batch" ? "gptBatchSessionHint" : "gptBatchHint", { max: batchMaxAccounts })}</small>{!batchPreview.error && <strong>{t("gptBatchCount", { count: batchPreview.accounts.length })}</strong>}</span>
          </label>}
          {mode === "session_batch" && <label>{t("gptBatchImportFile")}
            <input type="file" accept=".txt,.json,.jsonl,text/plain,application/json" aria-label={t("gptBatchImportFile")} disabled={busy} onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) void importSessionFile(file);
            }} />
            <small>{batchImportPending ? t("gptBatchImporting") : importedSessionBatch ? t("gptBatchFileReady", { count: importedSessionBatch.accounts.length }) : t("gptBatchFileHint")}</small>
          </label>}
          {isBatch && <small role="status">{t("gptBatchConcurrency", { count: runningBatchCapacity ?? batchCapacity })}</small>}
          {mode === "mailbox" && <div className="gpt-mailbox-fields">
            <label>{t("gptMailboxEmail")}<input type="email" value={mailboxEmail} onChange={(event) => { updateDraft({ mailboxEmail: event.target.value }); clearPreflight(); }} autoComplete="off" disabled={busy} required /></label>
            <label>{t("gptMailboxPassword")}<input type="password" value={mailboxPassword} onChange={(event) => { updateDraft({ mailboxPassword: event.target.value }); clearPreflight(); }} autoComplete="off" disabled={busy} required /></label>
            <small className="gpt-mailbox-hint">{t("gptMailboxHint")}</small>
          </div>}

          <label>{t("gptPaymentRegion")}
            <Select value={paymentRegionKey} onValueChange={(value) => { updateDraft({ paymentRegionKey: value }); clearPreflight(); }} disabled={busy}>
              <SelectTrigger aria-label={t("gptPaymentRegion")}><SelectValue /></SelectTrigger>
              <SelectContent>{paymentRegions.map(({ country, currency }) => <SelectItem key={country} value={`${country}:${currency}`}>{regionNames.of(country) ?? country} ({currency})</SelectItem>)}</SelectContent>
            </Select>
            <small>{t("gptPaymentRegionHint")}</small>
          </label>

          <label>{t("gptCustomProxy")}
            <input value={customProxyUrl} maxLength={512} onChange={(event) => { setCustomProxyUrl(event.target.value); clearPreflight(); }} placeholder="socks5://user:pass@host:port" autoComplete="off" spellCheck={false} disabled={busy} />
            <small>{t("gptCustomProxyHint")}</small>
          </label>

          <fieldset className="gpt-plan-options" disabled={plansQuery.isLoading || plans.length === 0 || Boolean(handoff) || busy}>
            <legend>{t("gptChoosePlan")}</legend>
            {subscriptionPlans.map((plan) => <label key={plan.key} className={selectedPlanKey === plan.key ? "is-selected" : ""}>
              <input type="radio" name="plan" value={plan.key} checked={selectedPlanKey === plan.key} onChange={() => { setCreditsCustomActive(false); updateDraft({ planKey: plan.key }); setPreparedBatch(null); orderIntent.current = null; }} />
              <span><strong>{t(`gptPlan.${plan.key}`, { defaultValue: plan.label })}</strong><small>{t("gptServiceFee", { amount: formatDecimal(selectedCardMode === "external" ? plansQuery.data?.data.externalCardServiceFee ?? "" : plan.customerServiceFee ?? (plan.serviceFeeUsdMinor / 100).toFixed(2)) })}</small></span>
              {preflightData?.quotes[plan.key] && <small>{formatQuote(preflightData.quotes[plan.key])}</small>}
            </label>)}
          </fieldset>
          <GptCreditsPlanFieldset
            plans={creditPlans}
            selectedPlanKey={selectedPlanKey}
            customActive={creditsCustomActive}
            quotes={workingQuotes}
            disabled={plansQuery.isLoading || Boolean(handoff) || busy}
            formatQuote={formatQuote}
            serviceFeeText={(plan) => t("gptServiceFee", { amount: formatDecimal(selectedCardMode === "external" ? plansQuery.data?.data.externalCardServiceFee ?? "" : plan.customerServiceFee ?? (plan.serviceFeeUsdMinor / 100).toFixed(2)) })}
            onSelect={(nextPlanKey) => { updateDraft({ planKey: nextPlanKey }); setPreparedBatch(null); orderIntent.current = null; }}
            onCustomActiveChange={setCreditsCustomActive}
          />
          {preflightData && preflightData.currentPlan !== "free" && <p role="status">{subscriptionPlans.length
            ? t("gptUpgradeOnly", { defaultValue: i18n.language === "en" ? "Same or lower plans are hidden. Prices include your upgrade credit." : "已隐藏相同或更低级套餐，仅展示官方升级应付价格。" })
            : Object.keys(preflightData.quoteErrors ?? {}).length
              ? t("gptNoUpgradeQuotes", { defaultValue: i18n.language === "en" ? "Upgrade quotes are unavailable. Check the reasons below and retry." : "升级报价暂不可用，请查看各套餐原因后重新预检。" })
              : creditPlans.length
                ? t("gptNoUpgrade", { defaultValue: i18n.language === "en" ? "You already have the highest plan. Credit packs below are still available." : "已存在最高级套餐；下方额度仍可直充。" })
                : t("gptNoUpgrade", { defaultValue: i18n.language === "en" ? "You already have the highest plan. No upgrades are available." : "已存在最高级套餐，暂无可升级套餐，不再展示价格。" })}</p>}
          {preflightData && Object.entries(preflightData.quoteErrors ?? {}).map(([plan, message]) =>
            <p key={plan} role="alert" className="gpt-quote-error"><AlertTriangle />{message}</p>)}
          {!isBatch && preflightData && preflightData.currentPlan !== "free" && dismissedRegionSwitch !== preflightData.preflightToken
            && Object.entries(preflightData.upgradeCurrencies ?? {}).filter(([plan]) => !handoff || handoff.plan === plan).map(([plan, currency]) => {
              const regions = (plansQuery.data?.data.checkoutCountries ?? []).filter((region) => region.currency === currency && region.country !== preflightData.paymentCountry);
              return <div key={plan} role="alert" className="gpt-quote-error gpt-region-consent">
                <p>{t("gptUpgradeRegionConsent", { defaultValue: i18n.language === "en"
                  ? "Your {{currentPlan}} subscription is still active. The {{plan}} upgrade quote is in {{currency}}, not the selected {{selectedCurrency}}. Do you agree to recheck in a matching billing region using its platform proxy? The new quote must be reviewed before payment."
                  : "当前账号的 {{currentPlan}} 套餐仍有效，{{plan}} 升级报价使用 {{currency}}，与所选地区的 {{selectedCurrency}} 不一致。是否同意切换至匹配账单币种的地区，并使用平台对应地区节点重新预检？新报价需由你确认后再提交支付。",
                  currentPlan: t(`gptPlan.${preflightData.currentPlan}`, { defaultValue: preflightData.currentPlan }), plan: t(`gptPlan.${plan}`, { defaultValue: plans.find((item) => item.key === plan)?.label ?? plan }), currency, selectedCurrency: preflightData.paymentCurrency })}</p>
                {regions.length ? regions.map((region) => <Button key={region.country} type="button" variant="outline" disabled={busy || preflightExpired}
                  onClick={() => void acceptUpgradeRegion(plan, region)}>{t("gptAgreeUpgradeRegion", { defaultValue: i18n.language === "en" ? "Agree: switch to {{region}} and recheck" : "同意切换至{{region}}并重新预检", region: regionNames.of(region.country) ?? region.country })}</Button>)
                  : <p>{t("gptUpgradeRegionUnavailable", { defaultValue: i18n.language === "en" ? "No matching billing region is currently enabled. Please contact support." : "暂未开放匹配此账单币种的地区，请联系客服；不会使用其他币种代替。" })}</p>}
                <Button type="button" variant="ghost" disabled={busy} onClick={() => setDismissedRegionSwitch(preflightData.preflightToken)}>{t("gptKeepUpgradeRegion", { defaultValue: i18n.language === "en" ? "Keep my selected region" : "暂不切换，保持所选地区" })}</Button>
              </div>;
            })}
          {!preflightData && <div className="gpt-observed-quote">
            <Clock3 />
            <div><span>{t("gptRecentObservedQuote")}</span>
              {observedQuotesQuery.isLoading ? <strong><DataSkeleton /></strong> : observedQuotesQuery.isError ? <strong>{t("gptRecentQuoteFailed")}</strong> : observedQuote ? <><strong>{priceWithEstimate(formatReferencePrice(observedQuote.amountMajor, observedQuote.currency), observedQuote.currency, observedQuote.amountUsd)} · {regionNames.of(observedQuote.country) ?? observedQuote.country}</strong><small>{t("gptRecentQuoteTime", { time: new Date(observedQuote.observedAt).toLocaleString(locale) })}</small></> : <strong>{t("gptRecentQuoteEmpty")}</strong>}
              <small>{t("gptRecentObservedQuoteHint")}</small>
            </div>
          </div>}
          {plansQuery.isError && <p role="alert" className="error">{t("gptPlansLoadFailed")}</p>}
          <Button type="submit" size="lg" disabled={busy || plans.length === 0 || (mode === "session" && sessionNeedsRelogin) || (isBatch && ((!batchValue.trim() && !importedSessionBatch) || !batchPaymentReady || !retryReady || batchCapacity === 0))}>
            <RefreshCw className={preflightPending || batchPending ? "is-spinning" : "is-reserved"} /><StableSwap state={preflightPending || batchPending ? (isBatch ? "batchBusy" : "busy") : (isBatch ? "batch" : "idle")} labels={{ idle: t("gptStartPreflight"), batch: t("gptStartBatch"), busy: t("gptPreflighting"), batchBusy: t("gptBatchRunning") }} />
          </Button>
          {preflightError && <p role="alert" className="error">{preflightError}</p>}
          {batchError && <p role="alert" className="error">{batchError}</p>}
          {savedProgress.previewStatus && !preparedBatch && batchResults.length === 0 && <p role="status">{t("gptBatchReloadPreview")}</p>}
          {preparedBatch && <section className="gpt-batch-preview" aria-label={t("gptBatchPreview")}>
            <strong>{t("gptBatchPreview")}</strong><p>{t("gptBatchPreviewHint")}</p>
            <div className="gpt-batch-selection-actions">
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setPreparedBatch((rows) => rows?.map((row) => ({ ...row, selected: Boolean(row.preflight && !row.error) })) ?? null)}>{t("gptBatchSelectAll")}</Button>
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setPreparedBatch((rows) => rows?.map((row) => ({ ...row, selected: Boolean(row.preflight && !row.error && !row.selected) })) ?? null)}>{t("gptBatchInvertSelection")}</Button>
            </div>
            <ol>{preparedBatch.map((row, index) => {
              const quote = row.preflight && (creditQuantity ? creditQuoteFromBase(row.preflight.quotes, creditQuantity) : row.preflight.quotes[selectedPlanKey]);
              return <li key={index}><label><input type="checkbox" aria-label={t("gptBatchSelectAccount", { index: index + 1 })} checked={row.selected} disabled={busy || Boolean(row.error) || !row.preflight} onChange={(event) => setPreparedBatch((rows) => rows?.map((item, i) => i === index ? { ...item, selected: event.target.checked } : item) ?? null)} /><strong>{row.preflight?.email || row.email}</strong></label>
                {row.preflight && <span>{t("gptCurrentPlan")}: {t(`gptPlan.${row.preflight.currentPlan}`, { defaultValue: row.preflight.currentPlan })}</span>}
                {quote && <span>{formatQuote(quote)} {quote.currency} · {t("gptServiceFee", { amount: formatDecimal(customerFee) })}</span>}
                {row.error && <small className="error">{row.error}</small>}
              </li>;
            })}</ol>
            <Button type="button" disabled={busy || !preparedBatch.some((row) => row.selected && row.preflight && !row.error) || !batchPaymentReady || !retryReady} onClick={() => void submitBatch()}>{t("gptBatchConfirmSelected")}</Button>
          </section>}
          {batchResults.length > 0 && <div className="gpt-batch-results" role="status" aria-live="polite">
            <header><strong>{t("gptBatchProgress")}</strong><span>{t("gptBatchProgressCount", { completed: batchResults.filter(({ status }) => ["completed", "failed", "not_submitted", "unknown"].includes(status)).length, total: batchResults.length })}</span></header>
            <ol>{batchResults.map((item, index) => <li className={`is-${item.status}`} key={`${item.maskedEmail}-${index}`}>
              <span>{item.status === "completed" ? <CheckCircle2 /> : ["failed", "not_submitted", "unknown"].includes(item.status) ? <X /> : item.status === "queued" ? <Clock3 /> : <RefreshCw className="is-spinning" />}</span>
              <span><strong>{item.maskedEmail}</strong><small>{item.message || t(item.status === "not_submitted" ? "gptBatchNotSubmitted" : item.status === "unknown" ? "gptBatchReloadUnknown" : `gptBatchStatus.${item.status}`)}</small></span>
              {item.orderId && <Link to="/gpt-direct/orders/$orderId" params={{ orderId: item.orderId }}>{t("gptViewBatchOrder")}</Link>}
            </li>)}</ol>
          </div>}
        </form> : <div className="feature-disabled"><ShieldCheck /><p>{t("featureUnavailable")}</p></div>}
      </section>

      <section className={`gpt-direct-panel gpt-order-panel${checkoutReady ? " is-focus" : " is-waiting"}`}>
        <div className="section-title"><div><span className="eyebrow">02 · CHECKOUT</span><h2>{t("gptOrderReview")}</h2></div>{!checkoutReady && <span className="gpt-direct-panel-badge">{t("gptDirectCheckoutWaiting")}</span>}</div>
        <div className="gpt-order-content">
          {flags.gptDirect && <>
          <fieldset className="gpt-card-modes">
            <legend>{t("gptPaymentMethod")}</legend>
            <label className={selectedCardMode === "existing" ? "is-selected" : ""}>
              <input type="radio" name="cardMode" value="existing" checked={selectedCardMode === "existing"} disabled={!activeCards.length || Boolean(handoff) || busy} onChange={() => { setCardMode("existing"); orderIntent.current = null; }} />
              <span><span className="gpt-card-mode-title"><CreditCard /><strong>{t("gptUseExistingCard")}</strong></span><small>{t("gptUseExistingCardHint")}</small></span>
            </label>
            <label className={selectedCardMode === "auto" ? "is-selected" : ""}>
              <input type="radio" name="cardMode" value="auto" checked={selectedCardMode === "auto"} disabled={!flags.cardOpening || Boolean(handoff) || busy} onChange={() => { setCardMode("auto"); orderIntent.current = null; }} />
              <span><span className="gpt-card-mode-title"><Sparkles /><strong>{t(isBatch ? oneCardPerAccount ? "gptOneCardPerAccount" : "gptSmartCard" : "gptAutoOpenCard")}</strong></span><small>{t(isBatch ? oneCardPerAccount ? "gptOneCardPerAccountHint" : "gptSmartCardHint" : "gptAutoOpenCardHint")}</small></span>
            </label>
            <label className={selectedCardMode === "external" ? "is-selected" : ""}>
              <input type="radio" name="cardMode" value="external" checked={selectedCardMode === "external"} disabled={Boolean(handoff) || busy} onChange={() => { setCardMode("external"); orderIntent.current = null; }} />
              <span><span className="gpt-card-mode-title"><CreditCard /><strong>{t("gptUseExternalCard")}</strong></span><small>{t("gptUseExternalCardHint")}</small></span>
            </label>
          </fieldset>

          {selectedCardMode === "existing" ? cardsQuery.isError ? <div className="error" role="alert">
            {cardsQuery.error.message}
            <Button variant="outline" disabled={cardsQuery.isFetching} onClick={() => void cardsQuery.refetch()}>{t("retry")}</Button>
          </div> : !activeCards.length && !cardsQuery.isLoading ? <div className="gpt-empty-card">
            <CreditCard /><strong>{t("gptNoActiveCard")}</strong><p>{t("gptNoActiveCardDesc")}</p>
            <div className="gpt-empty-actions"><Button asChild variant="outline"><Link to="/cards">{t("gptOpenCardFirst")}</Link></Button><Button asChild><Link to="/cdk/redeem">{t("gptUseCdkAutoCard")}</Link></Button></div>
          </div> : <label>{t("gptPaymentCard")}
            <Select value={selectedCardId} onValueChange={(value) => { setCardId(value); orderIntent.current = null; }} disabled={cardsQuery.isLoading || Boolean(handoff) || busy}>
              <SelectTrigger aria-label={t("gptPaymentCard")}><SelectValue /></SelectTrigger>
              <SelectContent>{activeCards.map((card) => {
                const performance = cardPerformance.get(card.id);
                const declineRate = formatRateBps(performance?.overall.declineRateBps);
                return <SelectItem value={String(card.id)} key={card.id}>{card.network} · {card.cardNumberMasked} · ${formatDecimal(card.balance)} · {declineRate === null ? t("paymentNoSample") : t("paymentDeclineRateShort", { rate: declineRate })}</SelectItem>;
              })}</SelectContent>
            </Select>
            <small>{t("gptPaymentCardHint")}</small>
            {selectedCardPerformance && <PaymentPerformance overall={selectedCardPerformance.overall} plans={selectedCardPerformance.plans} className="gpt-card-performance" />}
          </label> : selectedCardMode === "external" ? <div className="gpt-external-card-review">
            <div className="gpt-auto-card-heading"><CreditCard /><span><strong>{t("gptUseExternalCard")}</strong><small>{t("gptExternalCardTaxFreeHint")}</small></span></div>
            <div className="gpt-external-card-fields">
              <label>{t("gptExternalCardNumber")}<input inputMode="numeric" autoComplete="cc-number" value={externalCardNumber} maxLength={19} disabled={busy} onChange={(event) => { setExternalCardNumber(event.target.value.replace(/\D/g, "").slice(0, 19)); orderIntent.current = null; }} placeholder="1234123412341234" /></label>
              <label>{t("gptExternalCardExpiry")}<input inputMode="numeric" autoComplete="cc-exp" value={externalCardExpiry} maxLength={5} disabled={busy} onChange={(event) => { const digits = event.target.value.replace(/\D/g, "").slice(0, 4); setExternalCardExpiry(digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits); orderIntent.current = null; }} placeholder="MM/YY" /></label>
              <label>{t("gptExternalCardCvv")}<input type="password" inputMode="numeric" autoComplete="cc-csc" value={externalCardCvv} maxLength={4} disabled={busy} onChange={(event) => { setExternalCardCvv(event.target.value.replace(/\D/g, "").slice(0, 4)); orderIntent.current = null; }} placeholder="CVV" /></label>
              <label>{t("gptExternalCardHolder")}<input autoComplete="cc-name" value={externalCardHolder} maxLength={80} disabled={busy} onChange={(event) => { setExternalCardHolder(event.target.value); orderIntent.current = null; }} placeholder={t("gptExternalCardHolderPlaceholder")} /><small>{t("gptExternalCardHolderHint")}</small></label>
            </div>
          </div> : <div className="gpt-auto-card-review">
            {isBatch && <label className="gpt-one-card-per-account"><input type="checkbox" aria-label={t("gptOneCardPerAccount")} checked={oneCardPerAccount} disabled={busy} onChange={(event) => setOneCardPerAccount(event.target.checked)} /><span>{t("gptOneCardPerAccount")}<small>{t("gptOneCardPerAccountHint")}</small></span></label>}
            <div className="gpt-auto-card-heading"><Sparkles /><span><strong>{t(isBatch ? oneCardPerAccount ? "gptOneCardPerAccount" : "gptSmartCard" : "gptAutoOpenCard")}</strong><small>{t(isBatch ? oneCardPerAccount ? "gptOneCardPerAccountHint" : "gptSmartCardSafety" : "gptAutoCardOneOnly")}</small></span></div>
            {!preflightData ? <p>{t(isBatch ? oneCardPerAccount ? "gptOneCardPerAccountHint" : "gptSmartCardBatchHint" : "gptAutoCardAwaitingQuote")}</p> : !autoProduct ? <p className={productsQuery.isLoading || openAiPricesQuery.isLoading ? undefined : "error"} role={productsQuery.isLoading || openAiPricesQuery.isLoading ? "status" : "alert"}>{productsQuery.isLoading || openAiPricesQuery.isLoading ? <DataSkeleton /> : t("gptAutoCardUnavailable")}</p> : <>
              <dl>
                <div><dt>{t(isCreditPlan(selectedPlanKey) ? "gptCreditsEstimateUsd" : "gptSubscriptionEstimateUsd")}</dt><dd>${formatDecimal(displayQuoteUsd)}</dd></div>
                <div><dt>{t("gptAutoCardBuffer")}</dt><dd>+${formatDecimal(autoCardBufferUsd.toFixed(2))}</dd></div>
                <div><dt>{t("gptAutoCardInitialBalance")}</dt><dd>${formatDecimal(autoInitAmount)}</dd></div>
                <div><dt>{t("openFee")}</dt><dd>${formatDecimal(autoProduct.openFee)}</dd></div>
                <div><dt>{t("initialRechargeFee", { rate: `${formatDecimal((Number(autoProduct.rechargeRate) * 100).toFixed(2))}%` })}</dt><dd>${formatDecimal(autoInitialRechargeFee)}</dd></div>
                <div><dt>{t("gptServiceFeeLabel")}</dt><dd>${formatDecimal(customerFee)}</dd></div>
                <div><dt>{t("gptAutoCardTotalDebit")}</dt><dd>${formatDecimal(autoEstimatedDebit)}</dd></div>
              </dl>
              <p className="gpt-auto-card-notice"><ShieldCheck />{t(isCreditPlan(selectedPlanKey) ? "gptCreditsAutoCardFundingNotice" : "gptAutoCardFundingNotice", { buffer: formatDecimal(autoCardBufferUsd.toFixed(2)) })}</p>
            </>}
          </div>}

          {flags.gptDirectNewCardRetry && flags.cardOpening && <fieldset className="gpt-auto-card-review" data-testid="gpt-retry-authorization" disabled={busy || Boolean(orderIntent.current)}>
            <label className="legal-consent"><input type="checkbox" checked={retryEnabled} onChange={event => { setRetryEnabled(event.target.checked); orderIntent.current = null; }} />{t("gptRetryEnable")}</label>
            {retryEnabled && <>
              <p>{t("gptRetrySafetyNotice")}</p>
              <label>{t("gptRetryProduct")}<select value={retryProductCode} onChange={event => { setRetryProductCode(event.target.value); orderIntent.current = null; }}>
                <option value="">{t("gptRetrySelectProduct")}</option>
                {retryProducts.map(product => <option key={product.productCode} value={product.productCode}>{product.productCode} · {product.network}</option>)}
              </select></label>
              <label>{t("gptRetryBudget")}<input inputMode="decimal" value={retryBudget} onChange={event => { setRetryBudget(event.target.value); orderIntent.current = null; }} /></label>
              {isBatch && <strong>{t("gptRetryPerOrderBudget")}</strong>}
              {retryProduct && <dl>
                <div><dt>{t("gptAutoCardInitialBalance")}</dt><dd>{retryInitAmount ? `$${formatDecimal(retryInitAmount)}` : t("gptRetryAfterPreflight")}</dd></div>
                <div><dt>{t("openFee")}</dt><dd>${formatDecimal(retryProduct.openFee)}</dd></div>
                <div><dt>{t("initialRechargeFee", { rate: `${formatDecimal((Number(retryProduct.rechargeRate) * 100).toFixed(2))}%` })}</dt><dd>{retryFundingFee ? `$${formatDecimal(retryFundingFee)}` : t("gptRetryAfterPreflight")}</dd></div>
                <div><dt>{t("gptServiceFeeLabel")}</dt><dd>${formatDecimal(retryServiceFee)}</dd></div>
                <div><dt>{t("gptRetryEstimatedDebit")}</dt><dd>{retryEstimate ? `$${formatDecimal(retryEstimate)}` : t("gptRetryAfterPreflight")}</dd></div>
              </dl>}
              <p>{t("gptRetryBalanceNotice")}</p>
              {!retryReady && <p role="status">{t("gptRetryInvalid")}</p>}
            </>}
          </fieldset>}
          {isBatch ? <div className="gpt-preflight-placeholder"><ShieldCheck /><strong>{t("gptBatchCheckoutReady")}</strong><p>{t("gptBatchCheckoutReadyDesc")}</p></div> : !preflightData ? <div className="gpt-preflight-placeholder"><ShieldCheck /><strong>{t("gptAwaitingPreflight")}</strong><p>{t(isCreditPlan(selectedPlanKey) ? "gptCreditsAwaitingPreflightDesc" : "gptAwaitingPreflightDesc")}</p></div> : <div className="gpt-preflight-result">
            <div><span>{t("gptVerifiedAccount")}</span><strong>{preflightData.email}</strong></div>
            <div><span>{t("gptCurrentPlan")}</span><strong>{t(`gptPlan.${preflightData.currentPlan}`, { defaultValue: preflightData.currentPlan })}</strong></div>
            <div><span>{t("gptPaymentRegion")}</span><strong>{preflightData.paymentCountry} · {preflightData.paymentCurrency}</strong></div>
            {selectedQuote && (isCreditPlan(selectedPlanKey)
              ? <GptCreditsCheckoutSummary quote={selectedQuote} formattedQuote={formatQuote(selectedQuote)} estimatedUsd={displayQuoteUsd} priceWithEstimate={priceWithEstimate} />
              : <div><span>{preflightData.currentPlan === "free" ? t("gptSubscriptionQuote") : t("gptUpgradeQuote", { defaultValue: i18n.language === "en" ? "Upgrade amount due" : "升级应付金额" })}</span><strong>{priceWithEstimate(formatQuote(selectedQuote), selectedQuote.currency, displayQuoteUsd)}</strong></div>)}
            {selectedQuote && <div><span>{t("gptServiceFeeLabel")}</span><strong>${formatDecimal(customerFee)} USD</strong></div>}
            <small>{t("gptQuoteExpiry", { time: new Date(preflightData.preflightExpiresAt).toLocaleString(locale) })}</small>
          </div>}
          {!isBatch && preflightData && selectedPlanKey && !selectedQuote && !quoteError && !preflightData.quoteErrors?.[selectedPlanKey]
            && <p role="alert" className="error" data-testid="gpt-selected-plan-unavailable"><AlertTriangle />{t(`gptPlan.${selectedPlanKey}`, { defaultValue: selectedPlan?.label ?? selectedPlanKey })}：{t("gptBatchPlanUnavailable")}</p>}
          {!isBatch && quoteError && <p role="alert" className="gpt-quote-error"><AlertTriangle />{quoteError}</p>}
          {!isBatch && <Button size="lg" onClick={submitOrder} disabled={createDisabled}><StableSwap state={orderPending ? "busy" : isCreditPlan(selectedPlanKey) ? "alt" : "idle"} labels={{ idle: t("gptSubmitOrder"), alt: t("gptSubmitCreditsOrder"), busy: t("gptSubmitting") }} /></Button>}
          <p className="gpt-charge-note"><ShieldCheck />{t(isCreditPlan(selectedPlanKey) ? "gptCreditsChargeNotice" : "gptChargeNotice")}</p>
          {orderError && <p role="alert" className="error">{orderError}</p>}
          {singleUncertain && <div role="alert"><p>{t("gptBatchReloadUnknown")}</p><Button type="button" variant="outline" onClick={() => { setSingleUncertain(false); setOrderError(""); orderIntent.current = null; clearPreflight(); }}>{t("gptConfirmHistoryChecked")}</Button></div>}
          </>}

          {cancelOrder.isError && <p role="alert" className="error">{cancelOrder.error instanceof Error ? cancelOrder.error.message : t("gptCancelFailed")}</p>}
        </div>
      </section>
    </div>

    <section className="transaction-panel gpt-direct-tools">
      <div className="section-title gpt-direct-tools-title">
        <div className="gpt-direct-tool-tabs" role="tablist" aria-label={t("gptDirectTools")}>
          <button type="button" role="tab" aria-selected={toolsTab === "orders"} className={toolsTab === "orders" ? "is-active" : undefined} onClick={() => setToolsTab("orders")}>{t("gptOrderHistory")}</button>
          <button type="button" role="tab" aria-selected={toolsTab === "lifecycle"} className={toolsTab === "lifecycle" ? "is-active" : undefined} onClick={() => setToolsTab("lifecycle")}>{t("gptCdkHistory")}</button>
          <button type="button" role="tab" aria-selected={toolsTab === "cdk"} className={toolsTab === "cdk" ? "is-active" : undefined} onClick={() => setToolsTab("cdk")}>{t("gptCdkGenerate")}</button>
        </div>
      </div>

      {toolsTab === "cdk" && <div className="gpt-cdk-market" data-testid="gpt-cdk-generate">
      <div className="gpt-direct-tool-heading"><h3>{t("gptCdkGenerate")}</h3><div className="gpt-direct-tool-actions"><Button asChild size="sm" variant="utility"><Link to="/cdk/redeem"><KeyRound />{t("gptOpenCdkRedeem")}</Link></Button></div></div>
      <p className="gpt-cdk-market-intro">{t("gptCdkGenerateDesc")}</p>
      <ul className="gpt-cdk-requirements">
        <li>{t("gptCdkNeedSession")}</li>
        <li>{t(dedicatedCardMode ? "gptCdkForceNewCardRule" : "gptCdkNeedOwnCards")}</li>
        <li>{t(dedicatedCardMode ? "gptCdkForceNewCardFailureRule" : "gptCdkNeedCaps")}</li>
        <li>{t(dedicatedCardMode ? "gptCdkForceNewCardBalance" : "gptCdkNeedBalance")}</li>
      </ul>
      {!flags.gptCdk ? <div className="feature-disabled"><KeyRound /><p>{t("featureUnavailable")}</p></div> : <>
      {cdkRegionSelectionEnabled && <label className="gpt-cdk-quantity"><span>CDK 结账地区</span><select aria-label="CDK 结账地区" value={cdkPaymentCountry || paymentRegions[0]?.country || ""} disabled={Boolean(purchasingPlan)} onChange={event => setCdkPaymentCountry(event.target.value)}>{paymentRegions.map(region => <option key={region.country} value={region.country}>{regionNames.of(region.country)} · {region.currency}</option>)}</select><small>生成后固定使用该地区及币种，兑换时不可更改。</small></label>}
      {forceNewCardEnabled && <label className="gpt-cdk-force-new-card"><input type="checkbox" checked={dedicatedCardMode} disabled={Boolean(purchasingPlan)} onChange={(event) => setForceNewCard(event.target.checked)} /><span><strong>{t("gptCdkForceNewCard")}</strong><small>{t("gptCdkForceNewCardHint")}</small></span></label>}
      <div className="gpt-cdk-offers">{["go","plus","pro_5x","pro_20x","pro_25x"].map((plan) => {
        return <article key={plan} className="is-available">
        <div><span className="gpt-cdk-plan">{t(`gptPlan.${plan}`, { defaultValue: plan })}</span><strong data-testid={`gpt-cdk-listed-price-${plan}`}>{t("gptCdkGenerateFree", { price: "$0.00" })}</strong><small>{t("gptCdkGenerateHint")}</small></div>
        <label className="gpt-cdk-quantity"><span>{t("quantity")}</span><input type="number" min={1} max={50} aria-label={t("quantity")} value={Math.min(cdkQuantities[`generate:${plan}`] ?? 1, 50)} disabled={Boolean(purchasingPlan)} onChange={(event) => setCdkQuantities((current) => ({ ...current, [`generate:${plan}`]: Math.min(Math.max(Number.parseInt(event.target.value, 10) || 1, 1), 50) }))} /></label>
        <Button data-testid={`gpt-cdk-generate-${plan}`} onClick={() => generateCdk(plan)} disabled={Boolean(purchasingPlan)}><StableSwap state={purchasingPlan === `generate:${plan}` ? "busy" : "idle"} labels={{ idle: t("gptGenerateCdks", { count: Math.min(cdkQuantities[`generate:${plan}`] ?? 1, 50) }), busy: t("processing") }} /></Button>
      </article>;
      })}</div></>}
      {purchaseError && <p className="admin-alert is-error" role="alert">{purchaseError}</p>}
      {purchasedCdk && <div className="gpt-cdk-purchase-result" role="status" aria-live="polite">
        <CheckCircle2 />
        <div>{purchasedCdk.checkoutRegion && <p>结账地区：{regionNames.of(purchasedCdk.checkoutRegion.country)} · {purchasedCdk.checkoutRegion.currency}</p>}<strong>{t("gptCdkGenerateSuccessCount", { count: purchasedCdk.quantity ?? purchasedItems.length })}</strong><small>{t("gptCdkSavedDelivery")}{purchasedCdk.forceNewCard ? ` · ${t("gptCdkForceNewCardBadge")}` : ""}</small><div className="gpt-cdk-code-list">{purchasedItems.map((item) => <div key={item.cdkId}><code>{item.code ?? item.codePrefix}</code>{item.code && <Button size="xs" variant="utility" onClick={async () => { await navigator.clipboard.writeText(item.code!); setCopiedCdk(item.cdkId); }}>{copiedCdk === item.cdkId ? <Check /> : <Copy />}<StableSwap state={copiedCdk === item.cdkId ? "busy" : "idle"} labels={{ idle: t("copy"), busy: t("copied") }} /></Button>}</div>)}</div></div>
        <div className="gpt-cdk-purchase-actions">{purchasedItems.some((item) => item.code) && <Button size="sm" variant="utility" onClick={async () => { await navigator.clipboard.writeText(purchasedItems.flatMap((item) => item.code ? [item.code] : []).join("\n")); setCopiedCdk("all"); }}>{copiedCdk === "all" ? <Check /> : <Copy />}<StableSwap state={copiedCdk === "all" ? "busy" : "idle"} labels={{ idle: t("copyAll"), busy: t("copied") }} /></Button>}<Button asChild size="sm"><Link to="/cdk/redeem">{t("redeemNow")}</Link></Button></div>
      </div>}
      </div>}

      {toolsTab === "orders" && <div className="gpt-orders-panel gpt-direct-tool-panel">
      <div className="gpt-direct-tool-heading"><h3>{t("gptOrderHistory")}</h3><span>{ordersQuery.isLoading ? <DataSkeleton /> : t("records", { count: ordersQuery.data?.data.total ?? 0 })}</span></div>
      <form className="gpt-order-search" onSubmit={(event) => { event.preventDefault(); setOrderSearch(orderSearchDraft.trim()); }}>
        <label><Search /><input aria-label={t("gptOrderEmailSearch")} value={orderSearchDraft} maxLength={320} onChange={(event) => setOrderSearchDraft(event.target.value)} placeholder={t("gptOrderEmailSearchPlaceholder")} /></label>
        <Button size="sm" type="submit">{t("search")}</Button>
        {orderSearch && <Button size="sm" type="button" variant="outline" onClick={() => { setOrderSearchDraft(""); setOrderSearch(""); }}>{t("resetFilters")}</Button>}
      </form>
      {ordersQuery.isLoading ? <div aria-busy="true">{[0, 1, 2].map((item) => <div className="gpt-order-history-row" key={item}><div className="gpt-order-row"><div className="gpt-order-row-main is-static"><span className="gpt-status-dot" /><span><strong><DataSkeleton /></strong><small><DataSkeleton /></small></span><span className="gpt-order-row-state"><span className="gpt-row-progress-line"><i><b style={{ width: "35%" }} /></i><strong><DataSkeleton /></strong></span><small><DataSkeleton /></small></span></div></div></div>)}</div> : ordersQuery.isError ? <p className="gpt-list-state error" role="alert">{t("gptOrdersLoadFailed")}</p> : !ordersQuery.data?.data.list.length ? <p className="gpt-list-state">{t("gptNoOrders")}</p> : ordersQuery.data.data.list.map((order) => {
        const invoiceUrls = stripeInvoiceUrls(order.invoiceUrls, order.invoiceUrl);
        const progress = orderProgressPercent(order);
        return <div className="gpt-order-history-row" key={order.id}>
          <div className="gpt-order-row is-clickable" onClick={(event) => { if ((event.target as HTMLElement).closest("a,button")) return; setActiveCdkId(""); setAcceptedOrder(order); setActiveOrderId(order.id); }}>
            <div className="gpt-order-row-main is-static">
              <span className={`gpt-status-dot is-${order.status}`} />
              <div className="gpt-order-heading">
                <button className="gpt-order-heading-trigger" type="button" onClick={() => { setActiveCdkId(""); setAcceptedOrder(order); setActiveOrderId(order.id); }}>
                  <strong>{t(`gptPlan.${order.plan}`, { defaultValue: order.plan })}</strong>
                </button>
                <div className="gpt-order-heading-detail">
                  <button className="gpt-order-heading-lines" type="button" onClick={() => { setActiveCdkId(""); setAcceptedOrder(order); setActiveOrderId(order.id); }}>
                    <small>{order.email ?? order.maskedEmail ?? t("gptAccountPending")}</small>
                    <small>{t("gptPaymentCardLastFour")}：{paymentCardLastFour(order) ? `•••• ${paymentCardLastFour(order)}` : t("gptPaymentCardNotRecorded")}</small>
                  </button>
                  {invoiceUrls.length > 0 && <span className="gpt-order-invoices">{invoiceUrls.map((invoiceUrl, index) => <a className="gpt-invoice-link" href={invoiceUrl} target="_blank" rel="noopener noreferrer" key={invoiceUrl}>{t("gptViewStripeInvoice")}{invoiceUrls.length > 1 ? ` ${index + 1}` : ""}</a>)}</span>}
                </div>
              </div>
              <span className="gpt-order-row-state">
                <button type="button" className="gpt-cdk-progress-trigger" onClick={() => { setActiveCdkId(""); setAcceptedOrder(order); setActiveOrderId(order.id); }} aria-label={t("gptViewOrder", { id: order.id })}><span className="gpt-row-progress-line"><i aria-hidden="true"><b style={{ width: `${progress}%` }} /></i><strong>{progress}%</strong></span><small>{order.progress?.at(-1)?.publicMessage ?? stageLabel(order.stage)} · {new Date(order.updatedAt ?? order.createdAt).toLocaleString(locale)}</small></button>
              </span>
            </div>
          </div>
        </div>;
      })}
      </div>}

      {toolsTab === "lifecycle" && <div className="gpt-orders-panel gpt-direct-tool-panel">
      <div className="gpt-direct-tool-heading gpt-cdk-history-title"><h3>{t("gptCdkHistory")}</h3><div className="gpt-cdk-history-title-actions"><span>{cdksQuery.isLoading ? <DataSkeleton /> : t("records", { count: cdksQuery.data?.data.total ?? 0 })}</span><Button size="sm" variant="utility" onClick={() => void exportCdks()} disabled={exportingCdks || !cdksQuery.data?.data.total}>{exportingCdks ? <RefreshCw className="is-spinning" /> : <Download />}<StableSwap state={exportingCdks ? "busy" : "idle"} labels={{ idle: t("exportUnredeemedCdks"), busy: t("exportingCdks") }} /></Button></div></div>
      {cdksQuery.isLoading ? <div aria-busy="true">{[0, 1, 2].map((item) => <div className="gpt-order-history-row" key={item}><div className="gpt-order-row"><div className="gpt-order-row-main is-static"><span className="gpt-status-dot" /><span><strong className="gpt-cdk-history-code"><DataSkeleton /></strong><small><DataSkeleton /></small></span><span className="gpt-cdk-history-state"><DataSkeleton /></span></div></div></div>)}</div> : cdksQuery.isError ? <p className="gpt-list-state error" role="alert">{t("gptCdksLoadFailed")}</p> : !cdksQuery.data?.data.list.length ? <p className="gpt-list-state">{t("gptNoCdks")}</p> : cdksQuery.data.data.list.map((cdk) => {
        const invoiceUrls = stripeInvoiceUrls(cdk.invoiceUrls, cdk.invoiceUrl);
        const amount = quotedAmount(cdk.quotedAmountMinor, cdk.currency);
        const redeemed = Boolean(cdk.redemptionStatus || cdk.status === "consumed" || cdk.inventoryStatus === "CONSUMED");
        const redemptionOrder = cdkRedemptionOrder(cdk);
        const progress = redemptionOrder ? orderProgressPercent(redemptionOrder) : 0;
        return <div className="gpt-order-history-row" key={cdk.id}>
        <div className={`gpt-order-row${redemptionOrder ? " is-clickable" : ""}`} onClick={redemptionOrder ? (event) => { if ((event.target as HTMLElement).closest("a,button")) return; setActiveOrderId(""); setActiveCdkId(cdk.id); } : undefined}>
          <div className="gpt-order-row-main is-static">
            <span className={`gpt-status-dot is-${cdk.redemptionStatus || cdk.status}`} />
            <span><strong className="gpt-cdk-history-code">{revealedCdks[cdk.id] ?? cdk.codePrefix}</strong><small>{cdk.plan} · {cdk.forceNewCard ? `${t("gptCdkForceNewCardBadge")} · ` : ""}{cdk.maskedEmail ? `${cdk.maskedEmail} · ` : ""}{amount ? `${formatDecimal(amount)} · ` : ""}{new Date(cdk.updatedAt).toLocaleString(locale)}</small><small>{t("gptPaymentCardLastFour")}：{paymentCardLastFour(cdk) ? `•••• ${paymentCardLastFour(cdk)}` : t("gptPaymentCardNotRecorded")}</small></span>
            <span className="gpt-cdk-history-state">{invoiceUrls.length ? <span className="gpt-order-invoices">{invoiceUrls.map((invoiceUrl, index) => <a className="gpt-invoice-link" href={invoiceUrl} target="_blank" rel="noopener noreferrer" key={invoiceUrl}>{t("gptViewStripeInvoice")}{invoiceUrls.length > 1 ? ` ${index + 1}` : ""}</a>)}</span>
              : redeemed ? <span className="gpt-order-invoices"><span className="gpt-invoice-link">{t("cdkInvoicePending")} <Link to="/cdk/redeem">{t("cdkLookupTitle")}</Link></span></span> : null}{redemptionOrder ? <button type="button" className="gpt-cdk-progress-trigger" onClick={() => { setActiveOrderId(""); setActiveCdkId(cdk.id); }} aria-label={`${t("gptCdkHistory")} ${cdk.codePrefix}`}><span className="gpt-row-progress-line"><i aria-hidden="true"><b style={{ width: `${progress}%` }} /></i><strong>{progress}%</strong></span><small>{new Date(redemptionOrder.updatedAt ?? cdk.updatedAt).toLocaleString(locale)}</small></button> : <strong>{cdk.status}</strong>}<span className="gpt-cdk-history-actions"><Button size="xs" variant="utility" aria-pressed={Boolean(revealedCdks[cdk.id])} onClick={() => void toggleCdkSensitive(cdk.id)} disabled={revealingCdkId === cdk.id}>{revealingCdkId === cdk.id ? <RefreshCw className="is-spinning" /> : revealedCdks[cdk.id] ? <EyeOff /> : <Eye />}<StableSwap state={revealingCdkId === cdk.id ? "busy" : revealedCdks[cdk.id] ? "alt" : "idle"} labels={{ idle: t("viewCdkCode"), alt: t("hideCdkCode"), busy: t("processing") }} /></Button>{revealedCdks[cdk.id] && <Button size="xs" variant="utility" onClick={async () => { await navigator.clipboard.writeText(revealedCdks[cdk.id]); setCopiedCdk(cdk.id); }}>{copiedCdk === cdk.id ? <Check /> : <Copy />}<StableSwap state={copiedCdk === cdk.id ? "busy" : "idle"} labels={{ idle: t("copy"), busy: t("copied") }} /></Button>}</span></span>
          </div>
        </div>
        </div>;
      })}
      {revealError && <p className="admin-alert is-error" role="alert">{revealError}</p>}
      {exportError && <p className="admin-alert is-error" role="alert">{exportError}</p>}
      {cdkTotalPages > 1 && <div className="gpt-cdk-pagination"><Button size="sm" variant="outline" disabled={cdkPage <= 1} onClick={() => setCdkPage((page) => page - 1)}>{t("previousPage")}</Button><span>{t("pageOf", { page: cdkPage, total: cdkTotalPages })}</span><Button size="sm" variant="outline" disabled={cdkPage >= cdkTotalPages} onClick={() => setCdkPage((page) => page + 1)}>{t("nextPage")}</Button></div>}
      </div>}
    </section>

    <Dialog.Root open={Boolean(activeOrderId || activeCdkId)} onOpenChange={(open) => { if (!open) { setActiveOrderId(""); setActiveCdkId(""); } }}>
      <Dialog.Portal><div className="dialog-overlay" data-state={activeOrderId || activeCdkId ? "open" : "closed"} aria-hidden="true" onClick={() => { setActiveOrderId(""); setActiveCdkId(""); }} onWheel={(event) => event.preventDefault()} onTouchMove={(event) => event.preventDefault()} /><Dialog.Content className="dialog-content gpt-progress-drawer">
        <div className="card-transaction-drawer-head"><div><span>{drawerOrder && financiallyFinal(drawerOrder) && drawerOrder.status === "completed" ? <CheckCircle2 /> : <Clock3 />}</span><div><Dialog.Title>{drawerOrder ? orderHeadline(drawerOrder, t, statusLabel) : <DataSkeleton />}</Dialog.Title><Dialog.Description>{activeCdk ? `${t("gptCdkHistory")} · ${activeCdk.codePrefix}` : drawerOrder ? t("gptOrderNumber", { id: drawerOrder.id }) : activeOrderId}</Dialog.Description></div></div><Dialog.Close asChild><Button type="button" size="icon" variant="ghost" aria-label={t("close")}><X /></Button></Dialog.Close></div>
        {activeOrderId && orderQuery.isLoading && !drawerOrder ? <div className="gpt-progress-drawer-body" aria-busy="true"><div className="gpt-progress-order-meta"><DataSkeleton /><DataSkeleton /></div><div className="gpt-order-progress"><DataSkeleton /><DataSkeleton /><DataSkeleton /></div></div> : drawerOrder ? <div className="gpt-progress-drawer-body">
          <div className="gpt-progress-order-meta"><span>{t(`gptPlan.${drawerOrder.plan}`, { defaultValue: drawerOrder.plan })}</span><strong>{statusLabel(drawerOrder.status)}{drawerOrder.stage ? ` · ${stageLabel(drawerOrder.stage)}` : ""}</strong></div>
          <GptOrderProgress order={drawerOrder} events={drawerEvents} defaultExpanded renewalForm={!activeCdkId && drawerOrder.needsRenewalCancel ? { value: renewalSession, pending: renewalPending, error: renewalError, onChange: setRenewalSession, onSubmit: submitRenewal } : undefined} sessionRecoveryForm={!activeCdkId && drawerOrder.status === "requires_action" && (drawerOrder.nextAction === "submit_session" || (!drawerOrder.nextAction && drawerEvents?.at(-1)?.publicCode === "session_refresh_required")) ? { value: recoverySession, pending: recoveryPending, error: recoveryError, onChange: setRecoverySession, onSubmit: submitRecoverySession } : undefined} />
          {!activeCdkId && cancellableStatuses.has(drawerOrder.status) && <Button size="sm" variant="outline" onClick={() => cancelOrder.mutate(drawerOrder.id)} disabled={cancelOrder.isPending}>{t("cancel")}</Button>}
          {!activeCdkId && !cancellableStatuses.has(drawerOrder.status) && canStopRetry(drawerOrder) && <Button size="sm" variant="outline" onClick={() => cancelOrder.mutate(drawerOrder.id)} disabled={cancelOrder.isPending}>{t("gptStopRetry")}</Button>}
        </div> : <p className="gpt-list-state error" role="alert">{t("gptOrdersLoadFailed")}</p>}
      </Dialog.Content></Dialog.Portal>
    </Dialog.Root>
  </PageShell>;
}
