import { LedgerFilters } from "../components/LedgerFilters";
import type { LedgerFilters as LedgerFilterValues } from "../api";
import { AdminProfitPanel } from "../components/AdminProfitPanel";
import { useEffect, useState, type ReactNode } from "react";
import { useAtomValue } from "jotai";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate } from "@tanstack/react-router";
import { Dialog } from "radix-ui";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Bot,
  Boxes,
  CircleDollarSign,
  ClipboardList,
  CreditCard,
  Gift,
  Landmark,
  Layers3,
  LifeBuoy,
  Megaphone,
  KeyRound,
  Radio,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Users,
  WalletCards,
  Wifi,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { BrandIcon } from "@/components/BrandIcon";
import { LanguageButton } from "../components/LanguageButton";
import { StableSwap } from "../components/StableSwap";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AdminProductsPanel } from "../components/AdminProductsPanel";
import { AdminCustomersPanel } from "../components/AdminCustomersPanel";
import { AdminGptCdkPanel } from "../components/AdminGptCdkPanel";
import { AdminGptDirectOrdersPanel } from "../components/AdminGptDirectOrdersPanel";
import { AdminGptProxyPanel } from "../components/AdminGptProxyPanel";
import { AdminSystemSettingsPanel } from "../components/AdminSystemSettingsPanel";
import { AdminLegalDocumentsPanel } from "../components/AdminLegalDocumentsPanel";
import { AdminTelegramPanel } from "../components/AdminTelegramPanel";
import { AdminRewardsPanel } from "../components/AdminRewardsPanel";
import { AdminSupportTicketsPanel } from "../components/AdminSupportTicketsPanel";
import { AdminXDirectFees, AdminXDirectPanel } from "../components/AdminXDirectPanel";
import { AdminTgDirectFees, AdminTgDirectPanel } from "../components/AdminTgDirectPanel";
import { DataSkeleton, PageShell } from "../components/PageShell";
import { formatDecimal, formatRateAsPercent, shiftDecimal } from "../decimal";
import {
  applyAdminPricing,
  confirmAdminDepositManually,
  createAdminAnnouncement,
  deleteAdminCard,
  getAdminAnnouncements,
  getAdminCards,
  getAdminAuditLogs,
  getAdminDeposits,
  getAdminFinancialEvents,
  getAdminMoneyOperations,
  getAdminMoneyOperation,
  getAdminOverviewTrends,
  getAdminPricing,
  previewAdminReferralPolicy,
  getAdminStats,
  getAdminSupportTickets,
  getAdminTelegram,
  getAdminUpstreamBalance,
  getAdminUpstreamBalanceLogs,
  getAdminUpstreams,
  getReconciliation,
  previewAdminPricing,
  observeAdminCardDeleteNoEffect,
  resolveDeleteReconciliationByBalanceLog,
  resolveReconciliation,
  resolveAdminCardDeleteNoEffect,
  syncAdminUpstreamBalanceLogs,
  syncAdminUpstreamProducts,
  testAdminUpstream,
  unfreezeAdminCard,
  updateAdminMembershipTier,
  updateAdminMembershipDeclinePolicy,
  updateAdminReferralPolicy,
  updateAdminUpstream,
  withdrawAdminAnnouncement,
  type AdminDepositOrder,
  type AdminMembershipTier,
  type AdminCardRecord,
  type MembershipTierProfileInput,
  type PricingInput,
  type PricingPreview,
  type ReferralEstimateRange,
  type ReferralPolicy,
  type UpstreamProvider,
  type AdminAuditLog,
  type AdminOverviewTrend,
} from "../api";
import { sessionAtom } from "../state";
import { parseAdminCustomerReturnPath, type AdminCustomerView } from "../adminCustomerReturnPath";

type AdminPanel = "overview" | "profit" | "upstreams" | "costs" | "tiers" | "cards" | "cdks" | "gptOrders" | "xDirect" | "tgDirect" | "proxies" | "funds" | "customers" | "support" | "announcements" | "audit" | "rewards" | "telegram" | "system";

const adminSections: Array<{ id: AdminPanel; label: string; icon: typeof Activity }> = [
  { id: "overview", label: "adminOverview", icon: Activity },
  { id: "profit", label: "adminProfit", icon: CircleDollarSign },
  { id: "upstreams", label: "adminUpstreams", icon: Landmark },
  { id: "costs", label: "adminCosts", icon: CircleDollarSign },
  { id: "tiers", label: "adminTiers", icon: Layers3 },
  { id: "cards", label: "adminCards", icon: CreditCard },
  { id: "cdks", label: "adminGptCdks", icon: KeyRound },
  { id: "gptOrders", label: "adminGptDirectOrders", icon: Sparkles },
  { id: "xDirect", label: "X 直充", icon: Sparkles },
  { id: "tgDirect", label: "TG 直充", icon: Sparkles },
  { id: "proxies", label: "adminGptProxies", icon: Radio },
  { id: "funds", label: "adminFunds", icon: WalletCards },
  { id: "customers", label: "adminCustomers", icon: Users },
  { id: "support", label: "adminSupportTickets", icon: LifeBuoy },
  { id: "announcements", label: "adminAnnouncements", icon: Megaphone },
  { id: "audit", label: "adminAudit", icon: ClipboardList },
  { id: "rewards", label: "adminRewards", icon: Gift },
  { id: "telegram", label: "adminTelegram", icon: Bot },
  { id: "system", label: "adminSystemSettings", icon: SlidersHorizontal },
];

function panelFromLocation(): AdminPanel {
  const value = new URLSearchParams(window.location.search).get("panel") as AdminPanel | null;
  return adminSections.some((item) => item.id === value) ? value! : "overview";
}

function adminAccountLabel(email: string | null, userId?: number, telegramUsername?: string | null) {
  const username = telegramUsername?.replace(/^@/, "");
  return email ?? (username ? `@${username}` : userId === undefined ? "—" : `#${userId}`);
}

function upstreamIsHealthy(provider: UpstreamProvider) {
  return provider.connectionHealth === "healthy";
}

const auditActionsZh: Record<string, [string, string]> = {
  auto_sync_products: ["自动同步上游产品", "后台定时同步上游产品目录与可售状态。"],
  sync_products: ["手动同步上游产品", "管理员手动请求同步上游产品目录。"],
  telegram_publish_checkin: ["发布 Telegram 群签到", "在已启用群组中创建并发布新的签到面板。"],
  publish_checkin: ["发布 Telegram 群签到", "在已启用群组中创建并发布新的签到面板。"],
  telegram_ai_settings_update: ["更新 Telegram AI 配置", "调整 DeepSeek 模型、限流或密钥状态。"],
  telegram_knowledge_upsert: ["更新机器人知识库", "新增或修改 Telegram 智能助手使用的知识文章。"],
  feature_view: ["查看功能页面", "用户或管理员打开了受审计保护的功能页面。"],
};

function auditActionCopy(action: string, english: boolean) {
  if (english) return { label: action, description: action };
  const known = auditActionsZh[action];
  return known ? { label: known[0], description: known[1] } : { label: action.replaceAll("_", " "), description: `系统记录的“${action}”操作，详情中保留原始操作代码。` };
}

function operationStatusLabel(status: string, english: boolean) {
  if (english) return status.replaceAll("_", " ");
  return ({ success: "成功", SUCCEEDED: "成功", COMPLETE: "已完成", COMPLETED: "已完成", FAILED: "失败", COMPENSATED: "已补偿", PENDING: "处理中", PROCESSING: "处理中", DEBITED: "已扣款", SUBMITTED: "已提交", RECONCILE_REQUIRED: "等待核对" } as Record<string, string>)[status] ?? status;
}

function operationTypeLabel(type: string, english: boolean) {
  if (english) return type.replaceAll("_", " ");
  return ({ OPEN_CARD: "开卡", RECHARGE: "卡片充值", REFUND: "卡片退款", FREEZE: "冻结卡片", UNFREEZE: "解冻卡片", DELETE: "销卡", GPT_DIRECT: "GPT 直充", TG_DIRECT: "TG 直充" } as Record<string, string>)[type] ?? type;
}

function dispatchStateLabel(state: string, english: boolean) {
  if (english) return state.replaceAll("_", " ");
  return ({ READY: "等待提交", DISPATCHING: "提交中", CONFIRMED: "已确认", UNKNOWN: "结果待确认", FAILED: "提交失败" } as Record<string, string>)[state] ?? state;
}

function AdminTrendChart({ data }: { data: AdminOverviewTrend[] }) {
  const days = data.slice(-30).map((item) => ({ ...item, deposit: Number(item.depositTotal) || 0 }));
  const registrationTotal = days.reduce((total, item) => total + item.registrationCount, 0);
  const cardTotal = days.reduce((total, item) => total + item.cardCount, 0);
  const depositTotal = days.reduce((total, item) => total + item.deposit, 0);
  const compact = (value: number) => new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(value);
  return <section className="admin-surface admin-trend-card">
    <div className="admin-section-heading"><div><span className="admin-kicker">LAST 30 DAYS</span><h2>增长与平台入账</h2><p>每日新增客户、卡片与已确认入账</p></div><span className="admin-trend-period">近 30 天</span></div>
    <div className="admin-trend-summary" aria-label="30 天趋势汇总">
      <div className="is-users"><span>新增客户</span><strong>{registrationTotal}</strong></div>
      <div className="is-cards"><span>新增卡片</span><strong>{cardTotal}</strong></div>
      <div className="is-money"><span>确认入账</span><strong>${formatDecimal(depositTotal.toFixed(2))}</strong></div>
    </div>
    <div className="admin-trend-plot">
      <ResponsiveContainer width="100%" height="100%" debounce={80}>
        <ComposedChart data={days} margin={{ top: 12, right: 6, bottom: 2, left: 0 }} accessibilityLayer>
          <defs><linearGradient id="admin-money-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#171717" stopOpacity=".18" /><stop offset="100%" stopColor="#171717" stopOpacity=".02" /></linearGradient></defs>
          <CartesianGrid vertical={false} stroke="#e5e5e2" strokeDasharray="4 7" />
          <XAxis dataKey="date" axisLine={false} tickLine={false} minTickGap={36} tickFormatter={(value: string) => value.slice(5).replace("-", "/")} />
          <YAxis yAxisId="count" axisLine={false} tickLine={false} allowDecimals={false} width={34} />
          <YAxis yAxisId="money" orientation="right" axisLine={false} tickLine={false} width={56} tickFormatter={(value: number) => `$${compact(value)}`} />
          <Tooltip cursor={{ stroke: "#b0b0b0", strokeDasharray: "3 4" }} content={({ active, payload, label }) => active && payload?.length ? <div className="admin-trend-tooltip">
            <strong>{label}</strong>
            <span><i className="is-users" />新增客户<b>{payload.find((item) => item.dataKey === "registrationCount")?.value ?? 0}</b></span>
            <span><i className="is-cards" />新增卡片<b>{payload.find((item) => item.dataKey === "cardCount")?.value ?? 0}</b></span>
            <span><i className="is-money" />确认入账<b>${formatDecimal(Number(payload.find((item) => item.dataKey === "deposit")?.value ?? 0).toFixed(2))}</b></span>
          </div> : null} />
          <Area yAxisId="money" type="monotone" dataKey="deposit" name="确认入账" stroke="#171717" strokeWidth={3} fill="url(#admin-money-area)" dot={false} activeDot={{ r: 5, fill: "#fff", stroke: "#171717", strokeWidth: 3 }} />
          <Line yAxisId="count" type="monotone" dataKey="registrationCount" name="新增客户" stroke="#222" strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: "#fff", stroke: "#222", strokeWidth: 2.5 }} />
          <Line yAxisId="count" type="monotone" dataKey="cardCount" name="新增卡片" stroke="#888" strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: "#fff", stroke: "#888", strokeWidth: 2.5 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  </section>;
}

function AdminState({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <div className={`admin-state ${error ? "is-error" : ""}`} role={error ? "alert" : undefined}>{children}</div>;
}

function AdminRowsSkeleton({ count = 3 }: { count?: number }) {
  return <div className="admin-list" aria-busy="true">{Array.from({ length: count }, (_, item) => <article className="admin-list-row" key={item}><div className="transaction-icon"><Activity /></div><div><strong><DataSkeleton /></strong><small><DataSkeleton /></small></div><DataSkeleton /></article>)}</div>;
}

function PanelHeading({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return <div className="admin-panel-heading">
    <div><span className="admin-kicker">{eyebrow}</span><h2>{title}</h2><p>{description}</p></div>
    {actions && <div className="admin-heading-actions">{actions}</div>}
  </div>;
}

function displayDate(value: string | null, locale: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function displayRate(value: string | null) {
  return formatRateAsPercent(value ?? "");
}

function displayPercentInput(value: string) {
  return shiftDecimal(value, 2);
}

function policyInput(percentage: string, displayMode: ReferralPolicy["displayMode"], version: number) {
  return { profitShareRate: shiftDecimal(percentage, -2, 6), displayMode, version };
}

function displayEstimate(range: ReferralEstimateRange | null, rate = false) {
  if (!range) return null;
  const min = rate ? formatRateAsPercent(range.min) : `$${formatDecimal(range.min)}`;
  const max = rate ? formatRateAsPercent(range.max) : `$${formatDecimal(range.max)}`;
  return range.min === range.max ? min : `${min}–${max}`;
}

function successfulStatus(status: string) {
  return ["CONFIRMED", "SUCCEEDED", "COMPLETED", "SUCCESS"].includes(status.toUpperCase());
}

function countdown(value: number) {
  const seconds = Math.max(0, Math.ceil(value / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function depositTiming(order: AdminDepositOrder, serverNow: number) {
  const expiresAt = new Date(order.expiredAt).getTime();
  const reservedUntil = order.reservedUntil ? new Date(order.reservedUntil).getTime() : Number.NaN;
  if (order.status === "confirmed") return { key: "depositOrderConfirmed", duration: "" };
  if (order.status === "failed") return { key: "depositOrderFailed", duration: "" };
  if (order.status === "cancelled") return { key: "depositStatus.cancelled", duration: "" };
  if (order.status === "pending" && Number.isFinite(expiresAt) && expiresAt > serverNow) {
    return { key: "depositOrderRemaining", duration: countdown(expiresAt - serverNow) };
  }
  if (Number.isFinite(reservedUntil) && reservedUntil > serverNow) {
    return { key: "depositLateReviewRemaining", duration: countdown(reservedUntil - serverNow) };
  }
  return { key: Number.isFinite(reservedUntil) ? "depositLateReviewEnded" : "depositOrderExpired", duration: "" };
}

function ReferralPolicyEditor({ token, policy, onApplied }: { token: string; policy: ReferralPolicy; onApplied: () => void }) {
  const { t, i18n } = useTranslation();
  const [percentage, setPercentage] = useState(displayPercentInput(policy.profitShareRate));
  const [displayMode, setDisplayMode] = useState(policy.displayMode);
  const [saveKey, setSaveKey] = useState(() => crypto.randomUUID());
  const [preview, setPreview] = useState<ReferralPolicy | null>(null);
  const [previewedInput, setPreviewedInput] = useState<ReturnType<typeof policyInput> | null>(null);
  const [notice, setNotice] = useState("");
  const previewMutation = useMutation({
    mutationFn: (input: ReturnType<typeof policyInput>) => previewAdminReferralPolicy(token, input),
    onSuccess: ({ data }, input) => { setPreview(data); setPreviewedInput(input); setNotice(""); },
  });
  const applyMutation = useMutation({
    mutationFn: () => updateAdminReferralPolicy(token, previewedInput!, saveKey),
    onSuccess: () => { setSaveKey(crypto.randomUUID()); setNotice(t("referralPolicySaved")); setPreview(null); setPreviewedInput(null); onApplied(); },
  });
  const resetPreview = () => { setSaveKey(crypto.randomUUID()); setPreview(null); setPreviewedInput(null); setNotice(""); };
  const shown = preview ?? policy;

  return <article className="admin-surface referral-policy-editor" data-testid="admin-referral-policy">
    <div className="admin-section-heading">
      <div><span className="admin-kicker">REFERRAL</span><h2>{t("referralProfitPolicy")}</h2><p>{t("referralPolicyVersion", { version: policy.version })}</p></div>
      <span className="status-pill is-active">{t("active")}</span>
    </div>
    <form className="pricing-form referral-policy-form" onSubmit={(event) => { event.preventDefault(); previewMutation.mutate(policyInput(percentage, displayMode, policy.version)); }}>
      <label>{t("referralProfitShareRate")}<input aria-describedby="referral-policy-rule" type="number" min="0" max="100" step="0.0001" value={percentage} onChange={(event) => { setPercentage(event.target.value); resetPreview(); }} required /></label>
      <label>{t("referralDisplayMode")}<select aria-label={t("referralDisplayMode")} value={displayMode} onChange={(event) => { setDisplayMode(event.target.value as ReferralPolicy["displayMode"]); resetPreview(); }}><option value="profit_share">{t("referralDisplayProfitShare")}</option><option value="equivalent">{t("referralDisplayEquivalent")}</option></select></label>
      <Button type="submit" variant="outline" disabled={previewMutation.isPending}><StableSwap state={previewMutation.isPending ? "busy" : "idle"} labels={{ idle: t("previewReferralPolicy"), busy: t("processing") }} /></Button>
      <p id="referral-policy-rule" className="pricing-formula-hint">{t("referralPolicySettlementRule")}</p>
    </form>
    {previewMutation.isError && <p className="admin-alert is-error" role="alert">{previewMutation.error instanceof Error ? previewMutation.error.message : t("updateFailed")}</p>}
    <div className="referral-policy-preview" aria-live="polite" data-testid="admin-referral-policy-preview">
      <div className="admin-alert is-neutral"><ShieldCheck /><span>{t("referralPolicyPreviewSummary", { rate: formatRateAsPercent(shown.profitShareRate) })}</span></div>
      <div className="referral-policy-preview-grid">{shown.tiers.map((tier) => <div key={tier.code}>
        <span>{i18n.language === "en" ? tier.nameEn : tier.nameZh}</span>
        <strong>{t("referralOpeningEstimate", { value: displayEstimate(tier.openingBaseReward) ?? t("referralEstimateUnavailable") })}</strong>
        <small>{t("referralRechargeEstimate", { value: displayEstimate(tier.rechargeRewardRate, true) ?? t("referralEstimateUnavailable") })}</small>
      </div>)}</div>
      {shown.tiers.length === 0 && <AdminState>{t("referralEstimateUnavailable")}</AdminState>}
      {preview && <div className="admin-card-actions"><Button onClick={() => applyMutation.mutate()} disabled={applyMutation.isPending}><StableSwap state={applyMutation.isPending ? "busy" : "idle"} labels={{ idle: t("saveReferralPolicy"), busy: t("processing") }} /></Button></div>}
    </div>
    {applyMutation.isError && <p className="admin-alert is-error" role="alert">{applyMutation.error instanceof Error ? applyMutation.error.message : t("updateFailed")}</p>}
    {notice && <p className="admin-alert is-success" role="status">{notice}</p>}
  </article>;
}

function reconciliationIsClosable(status: string, dispatchState: string) {
  return (status === "SUCCEEDED" && dispatchState === "CONFIRMED")
    || (["FAILED", "COMPENSATED"].includes(status) && dispatchState === "FAILED");
}

function PricingTierEditor({ token, tier, onApplied }: { token: string; tier: AdminMembershipTier; onApplied: () => void }) {
  const { t, i18n } = useTranslation();
  const [profile, setProfile] = useState<MembershipTierProfileInput>({
    version: tier.version,
    nameZh: tier.nameZh,
    nameEn: tier.nameEn,
    descriptionZh: tier.descriptionZh,
    descriptionEn: tier.descriptionEn,
    thresholdAmount: formatDecimal(tier.thresholdAmount),
  });
  const [draft, setDraft] = useState<PricingInput>({
    tierCode: tier.code,
    version: tier.version,
    openMultiplier: formatDecimal(tier.openMultiplier),
    minimumOpenFee: formatDecimal(tier.minimumOpenFee),
    rechargeMultiplier: formatDecimal(tier.rechargeMultiplier),
    minimumRechargeRate: formatDecimal(tier.minimumRechargeRate),
    declineFee: formatDecimal(tier.declineFee),
    refundMultiplier: formatDecimal(tier.refundMultiplier),
    gptDirectMultiplier: formatDecimal(tier.gptDirectMultiplier),
    gptDirectMinimumFee: formatDecimal(tier.gptDirectMinimumFee),
  });
  const [preview, setPreview] = useState<PricingPreview | null>(null);
  const [previewedInput, setPreviewedInput] = useState<PricingInput | null>(null);
  const [notice, setNotice] = useState("");
  const profileMutation = useMutation({
    mutationFn: () => updateAdminMembershipTier(token, tier.code, profile),
    onSuccess: () => { setNotice(t("tierProfileSaved")); onApplied(); },
  });
  const [declinePolicy, setDeclinePolicy] = useState({
    version: tier.version,
    feeRate1: formatDecimal(tier.authDeclineRate1 ?? "15"),
    feeAmount1: formatDecimal(tier.authDeclineAmount1 ?? "0.3"),
    feeRate2: formatDecimal(tier.authDeclineRate2 ?? "20"),
    feeAmount2: formatDecimal(tier.authDeclineAmount2 ?? "0.5"),
    feeRate3: formatDecimal(tier.authDeclineRate3 ?? "25"),
    feeAmount3: formatDecimal(tier.authDeclineAmount3 ?? "0.8"),
    freezeRate: formatDecimal(tier.authDeclineFreezeRate ?? "30"),
    freezeMargin: formatDecimal(tier.authDeclineFreezeMargin ?? "200"),
  });
  const declinePolicyMutation = useMutation({
    mutationFn: () => updateAdminMembershipDeclinePolicy(token, tier.code, declinePolicy),
    onSuccess: () => { setNotice(t("tierDeclinePolicySaved")); onApplied(); },
  });
  const previewMutation = useMutation({
    mutationFn: (input: PricingInput) => previewAdminPricing(token, input),
    onSuccess: ({ data }, input) => { setPreview(data); setPreviewedInput(input); setNotice(""); },
  });
  const applyMutation = useMutation({
    mutationFn: () => applyAdminPricing(token, previewedInput!),
    onSuccess: () => { setNotice(t("pricingApplied")); setPreview(null); setPreviewedInput(null); onApplied(); },
  });
  const update = (field: keyof PricingInput, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setPreview(null);
    setPreviewedInput(null);
    setNotice("");
  };
  const invalidMargin = preview?.products.some((product) => Number(product.openProfit) < 0 || Number(product.rechargeMargin) < 0 || Number(product.refundMargin) < 0) ?? false;
  const hasFreeRecharge = preview?.products.some((product) => Number(product.saleRechargeRate) === 0) ?? false;

  return <article className="admin-surface pricing-tier-card" data-testid={`pricing-tier-${tier.code}`}>
    <div className="admin-section-heading">
      <div><span className="admin-kicker">{tier.code}</span><h3>{i18n.language === "en" ? tier.nameEn : tier.nameZh}</h3><p>{t("pricingVersion", { version: tier.version })}</p></div>
      <span className="status-pill is-active">{t("active")}</span>
    </div>
    <form className="tier-profile-form" onSubmit={(event) => { event.preventDefault(); setNotice(""); profileMutation.mutate(); }}>
      <div className="tier-profile-heading"><strong>{t("tierProfile")}</strong><small>{t("tierProfileHint")}</small></div>
      <label>{t("tierNameZh")}<input value={profile.nameZh} maxLength={64} onChange={(event) => setProfile((current) => ({ ...current, nameZh: event.target.value }))} required /></label>
      <label>{t("tierNameEn")}<input value={profile.nameEn} maxLength={64} onChange={(event) => setProfile((current) => ({ ...current, nameEn: event.target.value }))} required /></label>
      <label>{t("tierDescriptionZh")}<textarea value={profile.descriptionZh} maxLength={500} onChange={(event) => setProfile((current) => ({ ...current, descriptionZh: event.target.value }))} required /></label>
      <label>{t("tierDescriptionEn")}<textarea value={profile.descriptionEn} maxLength={500} onChange={(event) => setProfile((current) => ({ ...current, descriptionEn: event.target.value }))} required /></label>
      <label>{t("tierThreshold")}<input type="number" min="0" step="0.0001" value={profile.thresholdAmount} onChange={(event) => setProfile((current) => ({ ...current, thresholdAmount: event.target.value }))} required /></label>
      <Button disabled={profileMutation.isPending}><StableSwap state={profileMutation.isPending ? "busy" : "idle"} labels={{ idle: t("saveTierProfile"), busy: t("processing") }} /></Button>
    </form>
    {profileMutation.isError && <p className="admin-alert is-error" role="alert">{profileMutation.error instanceof Error ? profileMutation.error.message : t("updateFailed")}</p>}
    <form className="tier-profile-form" data-testid={`tier-decline-policy-${tier.code}`} onSubmit={(event) => { event.preventDefault(); setNotice(""); declinePolicyMutation.mutate(); }}>
      <div className="tier-profile-heading"><strong>{t("tierDeclinePolicy")}</strong><small>{t("tierDeclinePolicyHint")}</small></div>
      <label>{t("authDeclineRate1")}<input type="number" min="0" max="100" step="0.01" value={declinePolicy.feeRate1} onChange={(event) => setDeclinePolicy((current) => ({ ...current, feeRate1: event.target.value }))} required /></label>
      <label>{t("authDeclineAmount1")}<input type="number" min="0" step="0.0001" value={declinePolicy.feeAmount1} onChange={(event) => setDeclinePolicy((current) => ({ ...current, feeAmount1: event.target.value }))} required /></label>
      <label>{t("authDeclineRate2")}<input type="number" min="0" max="100" step="0.01" value={declinePolicy.feeRate2} onChange={(event) => setDeclinePolicy((current) => ({ ...current, feeRate2: event.target.value }))} required /></label>
      <label>{t("authDeclineAmount2")}<input type="number" min="0" step="0.0001" value={declinePolicy.feeAmount2} onChange={(event) => setDeclinePolicy((current) => ({ ...current, feeAmount2: event.target.value }))} required /></label>
      <label>{t("authDeclineRate3")}<input type="number" min="0" max="100" step="0.01" value={declinePolicy.feeRate3} onChange={(event) => setDeclinePolicy((current) => ({ ...current, feeRate3: event.target.value }))} required /></label>
      <label>{t("authDeclineAmount3")}<input type="number" min="0" step="0.0001" value={declinePolicy.feeAmount3} onChange={(event) => setDeclinePolicy((current) => ({ ...current, feeAmount3: event.target.value }))} required /></label>
      <label>{t("authDeclineFreezeRate")}<input type="number" min="0" max="100" step="0.01" value={declinePolicy.freezeRate} onChange={(event) => setDeclinePolicy((current) => ({ ...current, freezeRate: event.target.value }))} required /></label>
      <label>{t("authDeclineFreezeMargin")}<input type="number" min="0" step="0.0001" value={declinePolicy.freezeMargin} onChange={(event) => setDeclinePolicy((current) => ({ ...current, freezeMargin: event.target.value }))} required /></label>
      <Button disabled={declinePolicyMutation.isPending}><StableSwap state={declinePolicyMutation.isPending ? "busy" : "idle"} labels={{ idle: t("saveTierDeclinePolicy"), busy: t("processing") }} /></Button>
    </form>
    {declinePolicyMutation.isError && <p className="admin-alert is-error" role="alert">{declinePolicyMutation.error instanceof Error ? declinePolicyMutation.error.message : t("updateFailed")}</p>}
    <AdminXDirectFees token={token} tierCode={tier.code} />
    <AdminTgDirectFees token={token} tierCode={tier.code} />
    <form className="pricing-form" onSubmit={(event) => { event.preventDefault(); previewMutation.mutate(draft); }}>
      <label>{t("openMultiplier")}<input type="number" min="0" max="100" step="0.0001" value={draft.openMultiplier} onChange={(event) => update("openMultiplier", event.target.value)} required /></label>
      <label>{t("minimumOpenFee")}<input type="number" min="0" step="0.0001" value={draft.minimumOpenFee} onChange={(event) => update("minimumOpenFee", event.target.value)} required /></label>
      <label>{t("rechargeMultiplier")}<input type="number" min="0" max="100" step="0.000001" value={draft.rechargeMultiplier} onChange={(event) => update("rechargeMultiplier", event.target.value)} required /></label>
      <label>{t("minimumRechargeRate")}<input type="number" min="0" max="1" step="0.000001" value={draft.minimumRechargeRate} onChange={(event) => update("minimumRechargeRate", event.target.value)} required /></label>
      <label>{t("declineFee")}<input type="number" min="0" max="1000000" step="0.0001" value={draft.declineFee} onChange={(event) => update("declineFee", event.target.value)} required /></label>
      <label>{t("refundMultiplier")}<input type="number" min="1" max="100" step="0.000001" value={draft.refundMultiplier} onChange={(event) => update("refundMultiplier", event.target.value)} required /></label>
      <label>{t("gptDirectMultiplier")}<input type="number" min="1" max="100" step="0.000001" value={draft.gptDirectMultiplier} onChange={(event) => update("gptDirectMultiplier", event.target.value)} required /></label>
      <label>{t("gptDirectMinimumFee")}<input type="number" min="0" max="1000000" step="0.0001" value={draft.gptDirectMinimumFee} onChange={(event) => update("gptDirectMinimumFee", event.target.value)} required /></label>
      <Button type="submit" variant="outline" disabled={previewMutation.isPending}><StableSwap state={previewMutation.isPending ? "busy" : "idle"} labels={{ idle: t("previewPricing"), busy: t("processing") }} /></Button>
      <p className="pricing-formula-hint">{t("rechargePricingFormula")}</p>
      <p className="pricing-formula-hint">{t("refundPricingFormula")}</p>
      <p className="pricing-formula-hint">{t("gptDirectPricingFormula")}</p>
    </form>
    {previewMutation.isError && <p className="admin-alert is-error" role="alert">{previewMutation.error instanceof Error ? previewMutation.error.message : t("updateFailed")}</p>}
    {preview && <div className="pricing-preview" aria-live="polite">
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead><tr><th>{t("productCode")}</th><th>{t("costOpenFee")}</th><th>{t("saleOpenFee")}</th><th>{t("openProfit")}</th><th>{t("costRechargeRate")}</th><th>{t("saleRechargeRate")}</th><th>{t("rechargeMargin")}</th><th>{t("costRefundRate")}</th><th>{t("saleRefundRate")}</th><th>{t("refundMargin")}</th></tr></thead>
          <tbody>{preview.products.map((product) => <tr key={product.productCode}>
            <td><code>{product.productCode}</code></td><td>${formatDecimal(product.costOpenFee)}</td><td>${formatDecimal(product.saleOpenFee)}</td><td className="positive">+${formatDecimal(product.openProfit)}</td><td>{displayRate(product.costRechargeRate)}</td><td>{displayRate(product.saleRechargeRate)}</td><td className="positive">+{displayRate(product.rechargeMargin)}</td><td>{displayRate(product.costRtfRate)}</td><td>{displayRate(product.saleRefundRate)}</td><td className="positive">+{displayRate(product.refundMargin)}</td>
          </tr>)}</tbody>
        </table>
      </div>
      {preview.products.length === 0 && <AdminState>{t("noSyncedProducts")}</AdminState>}
      <div className="admin-alert is-neutral" data-testid="decline-fee-preview"><ShieldCheck /><span>{t("declineFeePreview", { amount: formatDecimal(preview.declineFee) })}</span></div>
      {preview.referralOpenReward != null && <div className="admin-alert is-neutral" data-testid="referral-reward-preview"><ShieldCheck /><span>{t("referralPricingPreview", { open: preview.referralOpenReward, rate: displayRate(preview.referralRechargeRate ?? null) })}</span></div>}
      {preview.gptDirectPlans && preview.gptDirectPlans.length > 0 && <div className="admin-alert is-neutral" data-testid="gpt-direct-fee-preview"><ShieldCheck /><span>{t("gptDirectPlansPreview")}：{preview.gptDirectPlans.map((item) => `${t(`gptPlan.${item.plan}`, { defaultValue: item.plan })} $${formatDecimal(item.saleFee)}`).join(" · ")}</span></div>}
      {invalidMargin && <p className="admin-alert is-error" role="alert">{t("negativeMarginBlocked")}</p>}
      {hasFreeRecharge && <p className="admin-alert" role="status">{t("zeroRechargeRateWarning")}</p>}
      <div className="admin-card-actions"><Button onClick={() => applyMutation.mutate()} disabled={applyMutation.isPending || invalidMargin || preview.products.length === 0}><StableSwap state={applyMutation.isPending ? "busy" : "idle"} labels={{ idle: t("applyPricing"), busy: t("processing") }} /></Button></div>
    </div>}
    {applyMutation.isError && <p className="admin-alert is-error" role="alert">{applyMutation.error instanceof Error ? applyMutation.error.message : t("updateFailed")}</p>}
    {notice && <p className="admin-alert is-success" role="status">{notice}</p>}
  </article>;
}

export function AdminPage() {
  const session = useAtomValue(sessionAtom);
  const token = session?.token ?? "";
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "en" ? "en-US" : "zh-CN";
  const client = useQueryClient();
  const [initialCustomerContext] = useState(() => parseAdminCustomerReturnPath(`${window.location.pathname}${window.location.search}`));
  const [activePanel, setActivePanel] = useState<AdminPanel>(() => initialCustomerContext ? "customers" : panelFromLocation());
  const [actionMessage, setActionMessage] = useState("");
  const [selectedUpstreamCode, setSelectedUpstreamCode] = useState("");
  const [balanceLogPage, setBalanceLogPage] = useState(1);
  const [balanceLogFilters, setBalanceLogFilters] = useState<LedgerFilterValues>({});
  const [customerDetailId, setCustomerDetailId] = useState<number | null>(initialCustomerContext?.customerId ?? null);
  const [customerCardId, setCustomerCardId] = useState<number | null>(initialCustomerContext?.cardId ?? null);
  const [customerView, setCustomerView] = useState<AdminCustomerView>(() => initialCustomerContext?.view ?? (initialCustomerContext?.cardId ? "cards" : "overview"));
  const [customerReturnPanel, setCustomerReturnPanel] = useState<AdminPanel>(() => {
    const from = initialCustomerContext?.from as AdminPanel | null | undefined;
    return adminSections.some((item) => item.id === from) ? from! : "customers";
  });
  const [selectedMoneyId, setSelectedMoneyId] = useState<string | null>(null);
  const [selectedAudit, setSelectedAudit] = useState<AdminAuditLog | null>(null);
  const [announcementDraft, setAnnouncementDraft] = useState({ title: "", content: "", sendTelegram: false, telegramChatId: "" });
  const [announcementIdempotencyKey, setAnnouncementIdempotencyKey] = useState(() => crypto.randomUUID());
  const changeAnnouncementDraft = (change: Partial<typeof announcementDraft>) => {
    setAnnouncementDraft((current) => ({ ...current, ...change }));
    setAnnouncementIdempotencyKey(crypto.randomUUID());
  };
  const [announcementPage, setAnnouncementPage] = useState(1);
  const [announcementError, setAnnouncementError] = useState("");
  const [cardDeleteRequest, setCardDeleteRequest] = useState<{ card: AdminCardRecord; idempotencyKey: string } | null>(null);
  const [cardUnfreezeRequest, setCardUnfreezeRequest] = useState<{ cardId: number; idempotencyKey: string } | null>(null);
  const [cardQuery, setCardQuery] = useState<{ page: number; q: string; status: string; provider: string; pending?: boolean }>({ page: 1, q: "", status: "", provider: "" });
  const [depositQuery, setDepositQuery] = useState({ page: 1, q: "", status: "", network: "" });
  const [depositClock, setDepositClock] = useState(() => Date.now());
  const [moneyQuery, setMoneyQuery] = useState({ page: 1, q: "", status: "", type: "", provider: "" });
  const [financialPage, setFinancialPage] = useState(1);
  const [auditQuery, setAuditQuery] = useState({ page: 1, q: "", action: "", targetType: "" });
  const isPanel = (...panels: AdminPanel[]) => panels.includes(activePanel);

  function selectPanel(panel: AdminPanel, replace = false) {
    setActivePanel(panel);
    setCustomerDetailId(null);
    setCustomerCardId(null);
    setCustomerView("overview");
    const method = replace ? "replaceState" : "pushState";
    window.history[method]({ panel }, "", `/admin?panel=${panel}`);
  }

  function openCustomer(id: number, source: AdminPanel = activePanel, view: AdminCustomerView = "overview", cardId: number | null = null) {
    setCustomerReturnPanel(source);
    setCustomerDetailId(id);
    setCustomerCardId(cardId);
    setCustomerView(view);
    setActivePanel("customers");
    window.history.pushState({ panel: "customers", customerId: id, cardId, from: source, view }, "", `/admin?panel=customers&customerId=${id}${view === "cards" ? "&view=cards" : ""}${cardId ? `&cardId=${cardId}` : ""}&from=${source}`);
  }

  function closeCustomer() {
    setCustomerDetailId(null);
    setCustomerCardId(null);
    setCustomerView("overview");
    setActivePanel(customerReturnPanel);
    window.history.pushState({ panel: customerReturnPanel }, "", `/admin?panel=${customerReturnPanel}`);
  }

  const stats = useQuery({ queryKey: ["admin-stats"], queryFn: () => getAdminStats(token), enabled: Boolean(session), retry: false });
  const overviewTrends = useQuery({ queryKey: ["admin-overview-trends"], queryFn: () => getAdminOverviewTrends(token), enabled: Boolean(session) && activePanel === "overview", retry: false });
  const upstreams = useQuery({ queryKey: ["admin-upstreams"], queryFn: () => getAdminUpstreams(token), enabled: Boolean(session) && isPanel("overview", "upstreams", "cards", "funds"), retry: false });
  const upstreamCode = selectedUpstreamCode
    || upstreams.data?.data.find((provider) => provider.runtimeActive)?.code
    || upstreams.data?.data[0]?.code
    || "";
  const upstreamBalance = useQuery({ queryKey: ["admin-upstream-balance", upstreamCode], queryFn: () => getAdminUpstreamBalance(token, upstreamCode), enabled: Boolean(session && upstreamCode && activePanel === "upstreams"), retry: false });
  const balanceLogs = useQuery({ queryKey: ["admin-balance-logs", upstreamCode, balanceLogPage, balanceLogFilters], queryFn: () => getAdminUpstreamBalanceLogs(token, upstreamCode, balanceLogPage, 50, balanceLogFilters), enabled: Boolean(session && upstreamCode && isPanel("upstreams", "funds")), retry: false });
  const pricing = useQuery({ queryKey: ["admin-pricing"], queryFn: () => getAdminPricing(token), enabled: Boolean(session) && isPanel("costs", "tiers"), retry: false });
  const cards = useQuery({ queryKey: ["admin-cards", cardQuery], queryFn: () => getAdminCards(token, { ...cardQuery, pageSize: 50 }), enabled: Boolean(session) && activePanel === "cards", retry: false });
  const deposits = useQuery({
    queryKey: ["admin-deposits", depositQuery],
    queryFn: () => getAdminDeposits(token, { ...depositQuery, pageSize: 50 }),
    enabled: Boolean(session) && activePanel === "funds",
    retry: false,
    refetchInterval: (query) => {
      const data = query.state.data?.data;
      if (!data) return false;
      const serverNow = new Date(data.serverTime).getTime();
      return data.list.some((order) => order.status === "pending"
        || (order.status === "expired" && order.reservedUntil !== null
          && new Date(order.reservedUntil).getTime() > serverNow)) ? 5_000 : false;
    },
  });
  const moneyOperations = useQuery({ queryKey: ["admin-money-operations", moneyQuery], queryFn: () => getAdminMoneyOperations(token, { ...moneyQuery, pageSize: 50 }), enabled: Boolean(session) && isPanel("overview", "funds"), retry: false });
  const moneyOperationDetail = useQuery({ queryKey: ["admin-money-operation", selectedMoneyId], queryFn: () => getAdminMoneyOperation(token, selectedMoneyId!), enabled: Boolean(session && selectedMoneyId), retry: false });
  const financialEvents = useQuery({ queryKey: ["admin-financial-events", financialPage], queryFn: () => getAdminFinancialEvents(token, { page: financialPage, pageSize: 50 }), enabled: Boolean(session) && activePanel === "funds", retry: false });
  const auditLogs = useQuery({ queryKey: ["admin-audit-logs", auditQuery], queryFn: () => getAdminAuditLogs(token, { ...auditQuery, pageSize: 50 }), enabled: Boolean(session) && activePanel === "audit", retry: false });
  const adminSupportUnread = useQuery({ queryKey: ["admin-support-tickets", "", ""], queryFn: () => getAdminSupportTickets(token), enabled: Boolean(session), retry: false, refetchInterval: 30_000 });
  const adminSupportUnreadCount = adminSupportUnread.data?.data.reduce((total, ticket) => total + ticket.unreadCount, 0) ?? 0;
  const reconciliation = useQuery({ queryKey: ["admin-reconciliation"], queryFn: () => getReconciliation(token), enabled: Boolean(session) && activePanel === "funds", retry: false });
  const announcementHistory = useQuery({ queryKey: ["admin-announcements", announcementPage], queryFn: () => getAdminAnnouncements(token, announcementPage), enabled: Boolean(session) && activePanel === "announcements", retry: false });
  const announcementTelegram = useQuery({ queryKey: ["admin-telegram"], queryFn: () => getAdminTelegram(token), enabled: Boolean(session) && activePanel === "announcements", retry: false });
  const announcementGroups = announcementTelegram.data?.data.groups.filter((group) => group.enabled) ?? [];
  const selectedAnnouncementGroupId = announcementGroups.some((group) => group.chatId === announcementDraft.telegramChatId)
    ? announcementDraft.telegramChatId : (announcementGroups[0]?.chatId ?? "");

  useEffect(() => {
    if (activePanel !== "funds") return;
    const timer = window.setInterval(() => setDepositClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [activePanel]);

  useEffect(() => {
    const restore = () => {
      const context = parseAdminCustomerReturnPath(`${window.location.pathname}${window.location.search}`);
      setActivePanel(context ? "customers" : panelFromLocation());
      setCustomerDetailId(context?.customerId ?? null);
      setCustomerCardId(context?.cardId ?? null);
      setCustomerView(context?.view ?? (context?.cardId ? "cards" : "overview"));
      if (context?.from && adminSections.some((item) => item.id === context.from)) setCustomerReturnPanel(context.from as AdminPanel);
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);

  const upstreamAction = useMutation({
    mutationFn: async ({ code, action }: { code: string; action: "test" | "products" | "logs" }) => {
      if (action === "test") await testAdminUpstream(token, code);
      else if (action === "products") await syncAdminUpstreamProducts(token, code);
      else await syncAdminUpstreamBalanceLogs(token, code);
    },
    onSuccess: async (_, variables) => {
      setActionMessage(t(variables.action === "test" ? "connectionVerified" : variables.action === "products" ? "productsSynced" : "balanceLogsSynced"));
      await Promise.all([
        client.invalidateQueries({ queryKey: ["admin-upstreams"] }),
        client.invalidateQueries({ queryKey: ["admin-upstream-balance"] }),
        client.invalidateQueries({ queryKey: ["admin-balance-logs"] }),
        client.invalidateQueries({ queryKey: ["admin-products"] }),
      ]);
    },
    onError: (error) => setActionMessage(error instanceof Error ? error.message : t("updateFailed")),
  });
  const manualConfirmDeposit = useMutation({
    mutationFn: (gatewayRef: string) => confirmAdminDepositManually(token, gatewayRef),
    onSuccess: async (response) => {
      setActionMessage(t(response.data.replayed ? "manualDepositAlreadyConfirmed" : "manualDepositConfirmed", { amount: formatDecimal(response.data.creditedAmount) }));
      await Promise.all([
        client.invalidateQueries({ queryKey: ["admin-deposits"] }),
        client.invalidateQueries({ queryKey: ["admin-financial-events"] }),
        client.invalidateQueries({ queryKey: ["admin-customer-deposits"] }),
        client.invalidateQueries({ queryKey: ["admin-stats"] }),
      ]);
    },
    onError: (error) => setActionMessage(error instanceof Error ? error.message : t("manualDepositFailed")),
  });
  const upstreamUpdate = useMutation({
    mutationFn: ({ code, enabled, priority, version }: { code: string; enabled: boolean; priority: number; version: number }) => updateAdminUpstream(token, code, { enabled, priority, version }),
    onSuccess: async () => { setActionMessage(t("upstreamUpdated")); await client.invalidateQueries({ queryKey: ["admin-upstreams"] }); },
    onError: (error) => setActionMessage(error instanceof Error ? error.message : t("updateFailed")),
  });
  const resolve = useMutation({
    mutationFn: ({ id, status, note }: { id: number; status: "RESOLVED" | "IGNORED"; note: string }) => resolveReconciliation(token, id, status, note),
    onSettled: () => client.invalidateQueries({ queryKey: ["admin-reconciliation"] }),
  });
  const resolveDeleteBalanceLog = useMutation({
    mutationFn: ({ id, balanceLogId, note }: { id: number; balanceLogId: number; note: string }) =>
      resolveDeleteReconciliationByBalanceLog(token, id, balanceLogId, note),
    onSuccess: async () => {
      setActionMessage(t("deleteBalanceLogResolved"));
      await Promise.all([
        client.invalidateQueries({ queryKey: ["admin-cards"] }),
        client.invalidateQueries({ queryKey: ["admin-money-operations"] }),
        client.invalidateQueries({ queryKey: ["admin-reconciliation"] }),
        client.invalidateQueries({ queryKey: ["admin-balance-logs"] }),
        client.invalidateQueries({ queryKey: ["admin-stats"] }),
      ]);
    },
    onError: (error) => setActionMessage(error instanceof Error ? error.message : t("updateFailed")),
  });
  const adminCardDelete = useMutation({
    mutationFn: ({ card, idempotencyKey }: { card: AdminCardRecord; idempotencyKey: string }) => deleteAdminCard(token, card.id, idempotencyKey),
    onSuccess: async () => {
      setCardDeleteRequest(null);
      setActionMessage(t("adminCardDeleteAccepted"));
      await Promise.all([
        client.invalidateQueries({ queryKey: ["admin-cards"] }),
        client.invalidateQueries({ queryKey: ["admin-money-operations"] }),
        client.invalidateQueries({ queryKey: ["admin-reconciliation"] }),
        client.invalidateQueries({ queryKey: ["admin-stats"] }),
      ]);
    },
    onError: (error) => setActionMessage(error instanceof Error ? error.message : t("updateFailed")),
  });
  const adminCardUnfreeze = useMutation({
    mutationFn: ({ cardId, idempotencyKey }: { cardId: number; idempotencyKey: string }) => unfreezeAdminCard(token, cardId, idempotencyKey),
    onSuccess: async (response) => {
      if (!response.pending) setCardUnfreezeRequest(null);
      setActionMessage(t(response.pending ? "adminCardUnfreezePending" : "adminCardUnfreezeAccepted"));
      await Promise.all([
        client.invalidateQueries({ queryKey: ["admin-cards"] }),
        client.invalidateQueries({ queryKey: ["admin-money-operations"] }),
        client.invalidateQueries({ queryKey: ["admin-stats"] }),
      ]);
    },
    onError: (error) => setActionMessage(error instanceof Error ? error.message : t("updateFailed")),
  });
  const unfreezeCard = (cardId: number) => {
    const request = cardUnfreezeRequest?.cardId === cardId
      ? cardUnfreezeRequest
      : { cardId, idempotencyKey: crypto.randomUUID() };
    setCardUnfreezeRequest(request);
    adminCardUnfreeze.mutate(request);
  };
  const deleteReconciliationAction = useMutation({
    mutationFn: async ({ id, action }: { id: number; action: "observe" | "resolve" }) => {
      if (action === "observe") await observeAdminCardDeleteNoEffect(token, id);
      else await resolveAdminCardDeleteNoEffect(token, id);
    },
    onSuccess: async (_, variables) => {
      setActionMessage(t(variables.action === "observe" ? "deleteNoEffectObserved" : "deleteNoEffectResolved"));
      await Promise.all([
        client.invalidateQueries({ queryKey: ["admin-cards"] }),
        client.invalidateQueries({ queryKey: ["admin-money-operations"] }),
        client.invalidateQueries({ queryKey: ["admin-reconciliation"] }),
      ]);
    },
    onError: (error) => setActionMessage(error instanceof Error ? error.message : t("updateFailed")),
  });
  const announcementAction = useMutation({
    mutationFn: () => createAdminAnnouncement(token, announcementDraft.title, announcementDraft.content, announcementDraft.sendTelegram ? selectedAnnouncementGroupId : null, announcementIdempotencyKey),
    onSuccess: async () => {
      setAnnouncementDraft({ title: "", content: "", sendTelegram: false, telegramChatId: "" });
      setAnnouncementIdempotencyKey(crypto.randomUUID());
      setAnnouncementError("");
      setActionMessage(t("announcementSent"));
      await Promise.all([
        client.invalidateQueries({ queryKey: ["announcements"] }),
        client.invalidateQueries({ queryKey: ["announcement-history"] }),
        client.invalidateQueries({ queryKey: ["admin-announcements"] }),
      ]);
    },
    onError: (error) => { setActionMessage(""); setAnnouncementError(error instanceof Error ? error.message : t("announcementPublishFailed")); },
  });
  const retractAnnouncement = useMutation({
    mutationFn: (id: number) => withdrawAdminAnnouncement(token, id),
    onSuccess: async () => {
      setAnnouncementError("");
      setActionMessage(t("announcementWithdrawn"));
      await Promise.all([
        client.invalidateQueries({ queryKey: ["announcements"] }),
        client.invalidateQueries({ queryKey: ["announcement-history"] }),
        client.invalidateQueries({ queryKey: ["admin-announcements"] }),
      ]);
    },
    onError: (error) => { setActionMessage(""); setAnnouncementError(error instanceof Error ? error.message : t("announcementWithdrawFailed")); },
  });

  if (!session) return <Navigate to="/login" />;

  let panel: ReactNode;
  if (activePanel === "overview") {
    const provider = upstreams.data?.data.find((item) => item.runtimeActive) ?? upstreams.data?.data[0];
    panel = <div className="admin-panel-stack" data-testid="admin-panel-overview">
      <PanelHeading eyebrow="CONTROL CENTER" title={t("adminOverview")} description={t("adminOverviewDesc")} />
      {stats.isLoading && <section className="admin-metric-grid" aria-busy="true">{[[Users, "users", "registeredCustomers"], [CreditCard, "activeCards", "cardsInService"], [WalletCards, "platformWallet", "customerFundsSnapshot"], [CircleDollarSign, "customerCumulativeDeposits", "confirmedDepositOrders"], [ShieldCheck, "confirmedCustomerDeposits", "onChainReceived"], [Activity, "pendingCustomerDeposits", "pendingDepositOrders"]].map(([Icon, label, hint]) => <article key={label as string}><span><Icon />{t(label as string)}</span><strong><DataSkeleton /></strong><small>{t(hint as string, { count: 0 })}</small></article>)}</section>}
      {stats.isError && <AdminState error>{t("adminLoadFailed")}</AdminState>}
      {stats.data && <section className="admin-metric-grid" aria-label={t("platformMetrics")}>
        <article><span><Users />{t("users")}</span><strong>{stats.data.data.userCount}</strong><small>{t("registeredCustomers")}</small></article>
        <article><span><CreditCard />{t("activeCards")}</span><strong>{stats.data.data.activeCardCount}</strong><small>{t("cardsInService")}</small></article>
        <article className="is-dark"><span><WalletCards />{t("platformWallet")}</span><strong>${formatDecimal(stats.data.data.platformWalletTotal)}</strong><small>{t("customerFundsSnapshot")}</small></article>
        <article><span><CircleDollarSign />{t("customerCumulativeDeposits")}</span><strong>{stats.data.data.depositCurrency} {stats.data.data.customerCumulativeDepositTotal}</strong><small>{t("confirmedDepositOrders", { count: stats.data.data.confirmedDepositCount })}</small></article>
        <article><span><ShieldCheck />{t("confirmedCustomerDeposits")}</span><strong>{stats.data.data.depositCurrency} {stats.data.data.confirmedDepositTotal}</strong><small>{t("onChainReceived")}</small></article>
        <article><span><Activity />{t("pendingCustomerDeposits")}</span><strong>{stats.data.data.depositCurrency} {stats.data.data.pendingDepositTotal}</strong><small>{t("pendingDepositOrders", { count: stats.data.data.pendingDepositCount })}</small></article>
      </section>}
      {overviewTrends.data?.data.days && <AdminTrendChart data={overviewTrends.data.data.days} />}
      <div className="admin-overview-grid">
        <section className="admin-surface admin-health-card" data-testid="admin-overview-upstream">
          <div className="admin-section-heading"><div><span className="admin-kicker">UPSTREAM</span><h2>{t("upstreamHealth")}</h2></div>{provider && <span className={`status-pill ${upstreamIsHealthy(provider) ? "is-active" : ""}`}>{upstreamIsHealthy(provider) ? t("connected") : t("attention")}</span>}</div>
          {upstreams.isLoading && <div className="admin-provider-summary" aria-busy="true"><div className="admin-provider-mark"><Landmark /></div><div><strong><DataSkeleton /></strong><span><DataSkeleton /></span></div><dl><div><dt>{t("spendableBalance")}</dt><dd><DataSkeleton /></dd></div><div><dt>{t("lastHealthCheck")}</dt><dd><DataSkeleton /></dd></div></dl></div>}
          {upstreams.isError && <AdminState error>{t("adminLoadFailed")}</AdminState>}
          {upstreams.data?.data.length === 0 && <AdminState>{t("noUpstreams")}</AdminState>}
          {provider && <div className="admin-provider-summary"><div className="admin-provider-mark"><Landmark /></div><div><strong>{provider.name}</strong><span>{provider.environment} · {provider.upstreamTier ?? t("tierUnknown")}</span></div><dl><div><dt>{t("spendableBalance")}</dt><dd>{provider.currency ?? "USD"} {formatDecimal(provider.spendableBalance ?? "—")}</dd></div><div><dt>{t("lastHealthCheck")}</dt><dd>{displayDate(provider.lastHealthAt, locale)}</dd></div></dl></div>}
        </section>
        <section className="admin-surface">
          <div className="admin-section-heading"><div><span className="admin-kicker">RISK</span><h2>{t("operationsWatch")}</h2></div><ShieldCheck /></div>
          {moneyOperations.isLoading && <AdminRowsSkeleton />}
          {moneyOperations.isError && <AdminState error>{t("adminLoadFailed")}</AdminState>}
          {moneyOperations.data?.data.list.length === 0 && <AdminState>{t("noMoneyOperations")}</AdminState>}
          <div className="admin-activity-list">{moneyOperations.data?.data.list.slice(0, 5).map((operation) => <button type="button" key={operation.id} onClick={() => setSelectedMoneyId(operation.id)}><span className={`admin-dot ${successfulStatus(operation.status) ? "is-ok" : ""}`} /><div><strong>{operationTypeLabel(operation.type, i18n.language === "en")}</strong><small>{adminAccountLabel(operation.email)} · {displayDate(operation.createdAt, locale)}</small></div><span>{operationStatusLabel(operation.status, i18n.language === "en")}</span></button>)}</div>
        </section>
      </div>
    </div>;
  } else if (activePanel === "profit") {
    panel = <AdminProfitPanel token={token} />;
  } else if (activePanel === "upstreams") {
    panel = <div className="admin-panel-stack" data-testid="admin-panel-upstreams">
      <PanelHeading eyebrow="PROVIDERS" title={t("adminUpstreams")} description={t("adminUpstreamsDesc")} />
      {actionMessage && <p className={`admin-alert ${upstreamAction.isError || upstreamUpdate.isError ? "is-error" : "is-success"}`} role={upstreamAction.isError || upstreamUpdate.isError ? "alert" : "status"}>{actionMessage}</p>}
      {upstreams.isLoading && <AdminRowsSkeleton />}
      {upstreams.isError && <AdminState error>{t("adminLoadFailed")}</AdminState>}
      {upstreams.data?.data.length === 0 && <AdminState>{t("noUpstreams")}</AdminState>}
      <div className="admin-provider-grid">{upstreams.data?.data.map((provider) => {
        const operational = upstreamIsHealthy(provider);
        const canCall = provider.runtimeActive && provider.configured;
        const connectionLabel = provider.connectionHealth === "healthy" ? (i18n.language === "en" ? "OK" : "正常") : provider.connectionHealth;
        const productLabel = provider.productHealth === "healthy" ? (i18n.language === "en" ? "OK" : "正常") : provider.productHealth === "degraded" ? (i18n.language === "en" ? "Retrying" : "同步重试中") : (i18n.language === "en" ? "Stale" : "已过期");
        const balanceLabel = provider.balanceHealth === "healthy" ? (i18n.language === "en" ? "OK" : "正常") : (i18n.language === "en" ? "Pending" : "待同步");
        return <article className="admin-surface admin-provider-card" key={provider.code} data-testid={`upstream-${provider.code}`}>
        <div className="admin-provider-head">
          <div className="admin-provider-mark"><Landmark /></div>
          <div>
            <span className="admin-kicker">{provider.environment}</span>
            <h2>{provider.name}</h2>
            <p>
              <span className={`admin-dot ${operational ? "is-ok" : ""}`} />
              {provider.enabled ? t("enabled") : t("disabled")}
              <span aria-hidden="true">·</span>{provider.credentialSource}
              <span aria-hidden="true">·</span>{provider.runtimeActive ? t("runtimeActive") : t("runtimeInactive")}
              <span aria-hidden="true">·</span>{provider.configured ? t("credentialsConfigured") : t("credentialsMissing")}
              <span aria-hidden="true">·</span>{provider.writeEnabled ? t("realWritesEnabled") : t("realWritesDisabled")}
            </p>
          </div>
          <span className={`status-pill ${operational ? "is-active" : ""}`}>{operational ? t("connected") : t("attention")}</span>
        </div>
        <dl className="admin-provider-balances">
          <div><dt>{t("upstreamBalance")}</dt><dd>{provider.currency ?? "USD"} {formatDecimal(provider.balance ?? "—")}</dd></div>
          <div><dt>{t("spendableBalance")}</dt><dd>{provider.currency ?? "USD"} {formatDecimal(provider.spendableBalance ?? "—")}</dd></div>
          <div><dt>{t("reserveAmount")}</dt><dd>{provider.currency ?? "USD"} {formatDecimal(provider.reserveAmount ?? "—")}</dd></div>
        </dl>
        <div className="admin-provider-body">
          <section>
            <h3>{i18n.language === "en" ? "Provider" : "卡台信息"}</h3>
            <dl className="admin-provider-facts">
              <div><dt>{t("upstreamTier")}</dt><dd>{provider.upstreamTier ?? t("tierUnknown")}</dd></div>
              <div><dt>{t("upstreamRechargeRate")}</dt><dd>{displayRate(provider.upstreamRechargeRate)}</dd></div>
              <div><dt>{t("credentialFingerprint")}</dt><dd><code>{provider.credentialMask || "—"}</code></dd></div>
              <div><dt>{t("credentialVersion")}</dt><dd>{provider.configured && provider.credentialMask ? `v${provider.credentialVersion}` : "—"}</dd></div>
              <div><dt>{i18n.language === "en" ? "Connection" : "连接"}</dt><dd className={provider.connectionHealth === "healthy" ? "is-ok" : ""}>{connectionLabel}</dd></div>
              <div><dt>{i18n.language === "en" ? "Products" : "产品"}</dt><dd className={provider.productHealth === "healthy" ? "is-ok" : provider.productHealth === "degraded" ? "is-warning" : ""}>{productLabel}</dd></div>
              <div><dt>{i18n.language === "en" ? "Balance health" : "余额状态"}</dt><dd className={provider.balanceHealth === "healthy" ? "is-ok" : ""}>{balanceLabel}</dd></div>
            </dl>
          </section>
          <section>
            <h3>{i18n.language === "en" ? "Sync timeline" : "同步记录"}</h3>
            <dl className="admin-provider-facts">
              <div><dt>{t("lastHealthCheck")}</dt><dd>{displayDate(provider.lastHealthAt, locale)}</dd></div>
              <div><dt>{t("lastProductSync")}</dt><dd>{displayDate(provider.lastProductSyncAt, locale)}</dd></div>
              <div><dt>{i18n.language === "en" ? "Last product attempt" : "最近产品尝试"}</dt><dd>{displayDate(provider.lastProductAttemptAt, locale)}</dd></div>
              <div><dt>{i18n.language === "en" ? "Failures" : "连续失败"}</dt><dd>{provider.productFailureCount}</dd></div>
              <div><dt>{i18n.language === "en" ? "Next retry" : "下次重试"}</dt><dd>{displayDate(provider.nextProductRetryAt, locale)}</dd></div>
              <div><dt>{t("lastBalanceSync")}</dt><dd>{displayDate(provider.lastBalanceSyncAt, locale)}</dd></div>
            </dl>
          </section>
        </div>
        <p className="admin-provider-note">{t("credentialRotationHint")}</p>
        {provider.lastError && <p className="admin-alert is-error">{provider.lastError}</p>}
        {provider.lastProductError && <p className="admin-alert is-warning">{i18n.language === "en" ? "Product sync retrying" : "产品同步重试中"} · {provider.lastProductError}</p>}
        {!provider.lastError && provider.enabled && provider.runtimeActive && provider.configured && !operational && <p className="admin-alert is-neutral">{t("healthCheckStale")}</p>}
        {!canCall && <p className="admin-alert is-neutral"><RefreshCw />{t("runtimeRestartHint")}</p>}
        <div className="admin-provider-foot">
          <form className="admin-upstream-settings" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); upstreamUpdate.mutate({ code: provider.code, enabled: data.get("enabled") === "on", priority: Number(data.get("priority")), version: provider.version }); }}>
            <label className="admin-check"><input name="enabled" type="checkbox" defaultChecked={provider.enabled} /><span>{t("providerEnabled")}</span></label>
            <label>{t("providerPriority")}<input name="priority" type="number" min="-1000" max="1000" defaultValue={provider.priority} required /></label>
            <Button size="sm" variant="outline" type="submit" disabled={upstreamUpdate.isPending}><StableSwap state={upstreamUpdate.isPending ? "busy" : "idle"} labels={{ idle: t("saveProvider"), busy: t("processing") }} /></Button>
          </form>
          <div className="admin-card-actions">
            <Button size="sm" variant="outline" aria-pressed={upstreamCode === provider.code} onClick={() => { setSelectedUpstreamCode(provider.code); setBalanceLogPage(1); }}>{t("selectProvider")}</Button>
            <Button size="sm" onClick={() => { setSelectedUpstreamCode(provider.code); setBalanceLogPage(1); upstreamAction.mutate({ code: provider.code, action: "test" }); }} disabled={upstreamAction.isPending || !canCall}><Wifi />{t("testConnection")}</Button>
            <Button size="sm" variant="outline" onClick={() => { setSelectedUpstreamCode(provider.code); setBalanceLogPage(1); upstreamAction.mutate({ code: provider.code, action: "products" }); }} disabled={upstreamAction.isPending || !canCall}><Boxes />{t("syncProducts")}</Button>
            <Button size="sm" variant="outline" onClick={() => { setSelectedUpstreamCode(provider.code); setBalanceLogPage(1); upstreamAction.mutate({ code: provider.code, action: "logs" }); }} disabled={upstreamAction.isPending || !canCall}><RefreshCw />{t("syncBalanceLogs")}</Button>
          </div>
        </div>
      </article>})}</div>
      <section className="admin-surface">
        <div className="admin-section-heading"><div><span className="admin-kicker">BALANCE · {upstreamCode}</span><h2>{t("latestBalanceSnapshot")}</h2></div>{upstreamBalance.data && <span>{displayDate(upstreamBalance.data.data.fetchedAt, locale)}</span>}</div>
        {upstreamBalance.isLoading && <dl className="admin-metrics wide" aria-busy="true">{["upstreamBalance", "spendableBalance", "reserveAmount"].map((label) => <div key={label}><dt>{t(label)}</dt><dd><DataSkeleton /></dd></div>)}</dl>}
        {upstreamBalance.isError && <AdminState>{t("noBalanceSnapshot")}</AdminState>}
        {upstreamBalance.data && <dl className="admin-metrics wide"><div><dt>{t("upstreamBalance")}</dt><dd>{upstreamBalance.data.data.currency} {formatDecimal(upstreamBalance.data.data.balance)}</dd></div><div><dt>{t("spendableBalance")}</dt><dd>{upstreamBalance.data.data.currency} {formatDecimal(upstreamBalance.data.data.spendableBalance)}</dd></div><div><dt>{t("reserveAmount")}</dt><dd>{upstreamBalance.data.data.currency} {formatDecimal(upstreamBalance.data.data.reserveAmount)}</dd></div></dl>}
      </section>
    </div>;
  } else if (activePanel === "costs") {
    panel = <div className="admin-panel-stack" data-testid="admin-panel-costs">
      <PanelHeading eyebrow="CATALOG & COST" title={t("adminCosts")} description={t("adminCostsDesc")} />
      <div className="admin-alert is-neutral"><ShieldCheck />{t("verifiedCostSource")}</div>
      <AdminProductsPanel token={token} />
    </div>;
  } else if (activePanel === "tiers") {
    panel = <div className="admin-panel-stack" data-testid="admin-panel-tiers">
      <PanelHeading eyebrow="MEMBERSHIP" title={t("adminTiers")} description={t("adminTiersDesc")} />
      <div className="admin-alert is-neutral"><ShieldCheck />{t("pricingPreviewRule")}</div>
      {pricing.isLoading && <AdminRowsSkeleton />}
      {pricing.isError && <AdminState error>{t("adminLoadFailed")}</AdminState>}
      {pricing.data?.data.referralPolicy && <ReferralPolicyEditor key={pricing.data.data.referralPolicy.version} token={token} policy={pricing.data.data.referralPolicy} onApplied={() => { void client.invalidateQueries({ queryKey: ["admin-pricing"] }); }} />}
      {pricing.data?.data.tiers.length === 0 && <AdminState>{t("noMembershipTiers")}</AdminState>}
      <div className="pricing-tier-grid">{pricing.data?.data.tiers.map((tier) => <PricingTierEditor key={`${tier.code}-${tier.version}`} token={token} tier={tier} onApplied={() => { void client.invalidateQueries({ queryKey: ["admin-pricing"] }); }} />)}</div>
    </div>;
  } else if (activePanel === "cards") {
    panel = <div className="admin-panel-stack" data-testid="admin-panel-cards">
      <PanelHeading eyebrow="ISSUED CARDS" title={t("adminCards")} description={t("adminCardsDesc")} actions={<form className="admin-filter-bar" onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const pending = String(data.get("pending"));
        setCardQuery({ page: 1, q: String(data.get("q")).trim(), status: String(data.get("status")), provider: String(data.get("provider")), pending: pending === "" ? undefined : pending === "true" });
      }}>
        <label><span>{t("search")}</span><input name="q" defaultValue={cardQuery.q} placeholder={t("searchCards")} /></label>
        <label><span>{t("provider")}</span><select name="provider" defaultValue={cardQuery.provider}><option value="">{t("allProviders")}</option>{upstreams.data?.data.map((provider) => <option key={provider.code} value={provider.code}>{provider.name}</option>)}</select></label>
        <label><span>{t("status")}</span><select name="status" defaultValue={cardQuery.status}><option value="">{t("allStatuses")}</option><option value="ACTIVE">ACTIVE</option><option value="FROZEN">FROZEN</option><option value="DELETED">DELETED</option></select></label>
        <label><span>{t("pendingOperation")}</span><select name="pending" defaultValue={cardQuery.pending === undefined ? "" : String(cardQuery.pending)}><option value="">{t("allStatuses")}</option><option value="true">{t("pendingOnly")}</option><option value="false">{t("settledOnly")}</option></select></label>
        <Button type="submit" size="sm">{t("filter")}</Button>
      </form>} />
      <section className="admin-surface">
        {actionMessage && <p className={`admin-alert ${adminCardDelete.isError || adminCardUnfreeze.isError ? "is-error" : "is-success"}`} role={adminCardDelete.isError || adminCardUnfreeze.isError ? "alert" : "status"}>{actionMessage}</p>}
        {cardDeleteRequest && <div className="admin-alert is-warning" data-testid="admin-card-delete-confirmation">
          <ShieldCheck />
          <div>
            <strong>{t("adminCardDeleteConfirm", { card: cardDeleteRequest.card.cardNumberMasked })}</strong>
            <small>{t("adminCardDeleteRefundHint", { amount: formatDecimal(cardDeleteRequest.card.balance), email: adminAccountLabel(cardDeleteRequest.card.email) })}</small>
          </div>
          <div className="admin-card-actions">
            <Button type="button" size="xs" variant="destructive" disabled={adminCardDelete.isPending} onClick={() => adminCardDelete.mutate(cardDeleteRequest)}><StableSwap state={adminCardDelete.isPending ? "busy" : "idle"} labels={{ idle: t("confirmDeleteCard"), busy: t("processing") }} /></Button>
            <Button type="button" size="xs" variant="outline" disabled={adminCardDelete.isPending} onClick={() => { setCardDeleteRequest(null); setActionMessage(""); }}>{t("cancel")}</Button>
          </div>
        </div>}
        {cards.isLoading && <AdminRowsSkeleton />}
        {cards.isError && <AdminState error>{t("adminLoadFailed")}</AdminState>}
        {cards.data?.data.list.length === 0 && <AdminState>{t("noCards")}</AdminState>}
        {cards.data && cards.data.data.list.length > 0 && <div className="admin-table-wrap"><table className="admin-table" data-testid="admin-cards-table">
          <thead><tr><th>{t("cardNumber")}</th><th>{t("customer")}</th><th>{t("provider")}</th><th>{t("productCode")}</th><th>{t("status")}</th><th>{t("pendingOperation")}</th><th>{t("balance")}</th><th>{t("upstreamReference")}</th><th>{t("createdTime")}</th><th>{t("actions")}</th></tr></thead>
          <tbody>{cards.data.data.list.map((card) => <tr key={card.id}>
            <td><strong>{card.cardNumberMasked}</strong></td><td>{adminAccountLabel(card.email)}</td><td><code>{card.provider ?? "—"}</code></td><td><code>{card.productCode}</code></td>
            <td><span className={`status-pill ${card.status === "ACTIVE" ? "is-active" : ""}`}>{card.status}</span></td>
            <td>{card.pendingOperationId ? <><span className="status-pill">{t("pending")}</span><small>{card.pendingOperationId.slice(0, 8)}</small></> : t("noPendingOperation")}</td>
            <td>${formatDecimal(card.balance)}</td><td><code>{card.upstreamCardId ? `••••${card.upstreamCardId.slice(-8)}` : "—"}</code></td><td>{displayDate(card.createdAt, locale)}</td>
            <td><div className="admin-card-actions">
              {card.status === "FROZEN" && <Button type="button" size="xs" variant="outline" data-testid={`admin-card-unfreeze-${card.id}`} disabled={Boolean(card.pendingOperationId) || adminCardUnfreeze.isPending} onClick={() => { setActionMessage(""); unfreezeCard(card.id); }}>{t("unfreeze")}</Button>}
              <Button type="button" size="xs" variant="destructive" data-testid={`admin-card-delete-${card.id}`} disabled={Boolean(card.pendingOperationId) || card.status !== "ACTIVE" || adminCardDelete.isPending || adminCardUnfreeze.isPending} onClick={() => { setActionMessage(""); setCardDeleteRequest({ card, idempotencyKey: crypto.randomUUID() }); }}>{t("deleteCard")}</Button>
            </div></td>
          </tr>)}</tbody>
        </table></div>}
        {cards.data && <div className="admin-pagination"><span>{t("totalItems", { count: cards.data.data.total })}</span><div><Button size="xs" variant="outline" onClick={() => setCardQuery((current) => ({ ...current, page: current.page - 1 }))} disabled={cards.data.data.page <= 1}>{t("previousPage")}</Button><span>{cards.data.data.page}</span><Button size="xs" variant="outline" onClick={() => setCardQuery((current) => ({ ...current, page: current.page + 1 }))} disabled={cards.data.data.page * cards.data.data.pageSize >= cards.data.data.total}>{t("nextPage")}</Button></div></div>}
      </section>
    </div>;
  } else if (activePanel === "cdks") {
    panel = <AdminGptCdkPanel token={token} />;
  } else if (activePanel === "gptOrders") {
    panel = <AdminGptDirectOrdersPanel token={token} onOpenCustomer={(userId) => openCustomer(userId, "gptOrders")} onOpenCard={(userId, cardId) => openCustomer(userId, "gptOrders", "cards", cardId)} />;
  } else if (activePanel === "tgDirect") {
    panel = <AdminTgDirectPanel token={token} />;
  } else if (activePanel === "xDirect") {
    panel = <AdminXDirectPanel token={token} />;
  } else if (activePanel === "proxies") {
    panel = <AdminGptProxyPanel token={token} />;
  } else if (activePanel === "funds") {
    const openItems = reconciliation.data?.data.filter((item) => item.status === "OPEN") ?? [];
    const responseServerTime = deposits.data ? new Date(deposits.data.data.serverTime).getTime() : Number.NaN;
    const depositServerNow = Number.isFinite(responseServerTime)
      ? responseServerTime + Math.max(0, depositClock - deposits.dataUpdatedAt)
      : depositClock;
    panel = <div className="admin-panel-stack" data-testid="admin-panel-funds">
      <PanelHeading eyebrow="LEDGER & RISK" title={t("adminFunds")} description={t("adminFundsDesc")} actions={<form className="admin-filter-bar" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); setMoneyQuery({ page: 1, q: String(data.get("q")).trim(), status: String(data.get("status")), type: String(data.get("type")), provider: String(data.get("provider")) }); }}>
        <label><span>{t("search")}</span><input name="q" defaultValue={moneyQuery.q} placeholder={t("searchOperations")} /></label>
        <label><span>{t("provider")}</span><select name="provider" defaultValue={moneyQuery.provider}><option value="">{t("allProviders")}</option>{upstreams.data?.data.map((provider) => <option key={provider.code} value={provider.code}>{provider.name}</option>)}</select></label>
        <label><span>{t("status")}</span><select name="status" defaultValue={moneyQuery.status}><option value="">{t("allStatuses")}</option>{["PENDING", "DEBITED", "SUBMITTED", "SUCCEEDED", "RECONCILE_REQUIRED", "FAILED", "COMPENSATED"].map((status) => <option value={status} key={status}>{operationStatusLabel(status, i18n.language === "en")}</option>)}</select></label>
        <label><span>{t("type")}</span><select name="type" defaultValue={moneyQuery.type}><option value="">{t("allTypes")}</option>{["OPEN_CARD", "RECHARGE", "REFUND", "FREEZE", "UNFREEZE", "DELETE", "GPT_DIRECT", "TG_DIRECT"].map((type) => <option value={type} key={type}>{operationTypeLabel(type, i18n.language === "en")}</option>)}</select></label>
        <Button type="submit" size="sm">{t("filter")}</Button>
      </form>} />
      {actionMessage && <p className={`admin-alert ${resolve.isError || deleteReconciliationAction.isError || manualConfirmDeposit.isError ? "is-error" : "is-success"}`} role={resolve.isError || deleteReconciliationAction.isError || manualConfirmDeposit.isError ? "alert" : "status"}>{actionMessage}</p>}
      <section className="admin-surface" data-testid="admin-deposit-orders">
        <div className="admin-section-heading"><div><span className="admin-kicker">DEPOSITS</span><h2>{t("adminDepositOrders")}</h2><p>{t("adminDepositOrdersDesc")}</p></div>{deposits.data && <span>{t("serverTimeLabel")}: {displayDate(deposits.data.data.serverTime, locale)}</span>}</div>
        <form className="admin-filter-bar" data-testid="admin-deposit-filter" onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          setDepositQuery({ page: 1, q: String(data.get("q")).trim(), network: String(data.get("network")), status: String(data.get("status")) });
        }}>
          <label><span>{t("search")}</span><input name="q" defaultValue={depositQuery.q} placeholder={t("searchDepositOrders")} /></label>
          <label><span>{t("depositNetwork")}</span><select name="network" defaultValue={depositQuery.network}><option value="">{t("allNetworks")}</option><option value="TRON">TRON</option><option value="BSC">BSC</option><option value="SOL">SOL</option><option value="ETH">ETH</option><option value="XLAYER">XLAYER</option></select></label>
          <label><span>{t("status")}</span><select name="status" defaultValue={depositQuery.status}><option value="">{t("allStatuses")}</option><option value="pending">{t("depositStatus.pending")}</option><option value="confirmed">{t("depositStatus.confirmed")}</option><option value="expired">{t("depositStatus.expired")}</option><option value="failed">{t("depositStatus.failed")}</option><option value="cancelled">{t("depositStatus.cancelled")}</option></select></label>
          <Button type="submit" size="sm">{t("filter")}</Button>
        </form>
        {deposits.isLoading && <AdminRowsSkeleton />}
        {deposits.isError && <AdminState error>{t("adminLoadFailed")}</AdminState>}
        {deposits.data?.data.list.length === 0 && <AdminState>{t("noAdminDepositOrders")}</AdminState>}
        {deposits.data && deposits.data.data.list.length > 0 && <div className="admin-table-wrap"><table className="admin-table" data-testid="admin-deposit-table">
          <thead><tr><th>{t("orderNumber")}</th><th>{t("customer")}</th><th>{t("depositNetwork")}</th><th>{t("requestedAndExpected")}</th><th>{t("receivedAndCredited")}</th><th>{t("status")}</th><th>{t("depositTiming")}</th><th>{t("createdTime")}</th><th>{t("actions")}</th></tr></thead>
          <tbody>{deposits.data.data.list.map((order) => {
            const timing = depositTiming(order, depositServerNow);
            return <tr key={order.gatewayRef}>
              <td><code>{order.gatewayRef}</code></td>
              <td>
                <button type="button" className="admin-customer-inviter" onClick={() => openCustomer(order.userId, "funds")}>
                  <span>{adminAccountLabel(order.email, order.userId)}</span><ArrowRight />
                </button>
                <small>#{order.userId}</small>
              </td>
              <td><strong>{order.network}</strong><small>{order.currency}</small></td>
              <td><strong>{t("requestedAmount")}: {formatDecimal(order.requestedAmount ?? "—")}</strong><small>{t("expectedPaymentAmount")}: {formatDecimal(order.expectedAmount ?? "—")}</small></td>
              <td><strong>{t("receivedAmount")}: {formatDecimal(order.actualAmount ?? "—")}</strong><small>{t("creditedAmount")}: {formatDecimal(order.creditedAmount ?? "—")}</small></td>
              <td><span className={`status-pill ${order.status === "confirmed" ? "is-active" : ""}`}>{t(`depositStatus.${order.status}`)}</span>{order.confirmedAt && <small>{displayDate(order.confirmedAt, locale)}</small>}</td>
              <td><strong>{t(timing.key, { duration: timing.duration })}</strong><small>{t("depositExpiresAt")}: {displayDate(order.expiredAt, locale)}</small>{order.reservedUntil && order.status !== "cancelled" && <small>{t("depositReviewUntil")}: {displayDate(order.reservedUntil, locale)}</small>}</td>
              <td>{displayDate(order.createdAt, locale)}</td>
              <td>{(order.status === "pending" || order.status === "expired") && <Button type="button" size="xs" variant="outline" data-testid={`admin-deposit-manual-${order.gatewayRef}`} disabled={manualConfirmDeposit.isPending} onClick={() => {
                if (!window.confirm(t("manualDepositConfirmPrompt", { amount: formatDecimal(order.expectedAmount ?? "—"), customer: adminAccountLabel(order.email, order.userId) }))) return;
                setActionMessage("");
                manualConfirmDeposit.mutate(order.gatewayRef);
              }}><StableSwap state={manualConfirmDeposit.isPending && manualConfirmDeposit.variables === order.gatewayRef ? "busy" : "idle"} labels={{ idle: t("manualDepositConfirm"), busy: t("processing") }} /></Button>}</td>
            </tr>;
          })}</tbody>
        </table></div>}
        {deposits.data && <div className="admin-pagination"><span>{t("totalItems", { count: deposits.data.data.total })}</span><div><Button size="xs" variant="outline" onClick={() => setDepositQuery((current) => ({ ...current, page: current.page - 1 }))} disabled={deposits.data.data.page <= 1}>{t("previousPage")}</Button><span>{deposits.data.data.page}</span><Button size="xs" variant="outline" onClick={() => setDepositQuery((current) => ({ ...current, page: current.page + 1 }))} disabled={deposits.data.data.page * deposits.data.data.pageSize >= deposits.data.data.total}>{t("nextPage")}</Button></div></div>}
      </section>
      <section className="admin-surface">
        <div className="admin-section-heading"><div><span className="admin-kicker">OPERATIONS</span><h2>{t("moneyOperations")}</h2><p>{t("moneyOperationsDesc")}</p></div></div>
        {moneyOperations.isLoading && <AdminRowsSkeleton />}
        {moneyOperations.isError && <AdminState error>{t("adminLoadFailed")}</AdminState>}
        {moneyOperations.data?.data.list.length === 0 && <AdminState>{t("noMoneyOperations")}</AdminState>}
        {moneyOperations.data && moneyOperations.data.data.list.length > 0 && <div className="admin-table-wrap"><table className="admin-table" data-testid="admin-money-table">
          <thead><tr><th>{t("operation")}</th><th>{t("customer")}</th><th>{t("status")}</th><th>{t("gptAdminDiagnostics")}</th><th>{t("targetCard")}</th><th>{t("amount")}</th><th>{t("costAndCharge")}</th><th>{t("profit")}</th><th>{t("upstreamEvidence")}</th><th>{t("pricingSnapshot")}</th><th>{t("createdTime")}</th></tr></thead>
          <tbody>{moneyOperations.data.data.list.map((operation) => {
            const direct = operation.gptDirect;
            const directStatus = direct?.status ? t(`gptOrderStatus.${direct.status}`, { defaultValue: direct.status }) : "—";
            const directStage = direct?.stage ? t(`gptOrderStage.${direct.stage}`, { defaultValue: direct.stage }) : "—";
            const needsAttention = Boolean(direct && (["declined", "failed_precharge"].includes(direct.status ?? "")
              || ["FAILED", "RECONCILE_REQUIRED"].includes(operation.status)
              || (operation.status === "COMPENSATED" && direct.status !== "cancelled")));
            return <tr key={operation.id}>
              <td><strong>{operationTypeLabel(operation.type, i18n.language === "en")}</strong><small>{operation.id.slice(0, 8)}</small></td>
              <td><button type="button" className="admin-customer-inviter" onClick={() => openCustomer(operation.userId, "funds")}><span>{adminAccountLabel(operation.email, operation.userId)}</span><ArrowRight /></button><small>{operation.provider ?? "—"}</small></td>
              <td><button type="button" className="admin-detail-link" onClick={() => setSelectedMoneyId(operation.id)}><span className={`status-pill ${successfulStatus(operation.status) ? "is-active" : ""}`}>{operationStatusLabel(operation.status, i18n.language === "en")}</span></button><small>{t("dispatchState")}: {dispatchStateLabel(operation.dispatchState, i18n.language === "en")}</small></td>
              <td className="admin-gpt-diagnostics-cell">{direct ? <div className="admin-gpt-diagnostics" data-testid={`admin-gpt-operation-${operation.id}`}>
                <strong>{directStatus} · {directStage}</strong>
                <small>{direct.latestMessage || t("gptAdminStageExplanation", { stage: directStage })}</small>
                <dl>
                  <div><dt>{t("gptRelatedOrder")}</dt><dd><code>{direct.orderId}</code></dd></div>
                  <div><dt>{t("gptPlanLabel")}</dt><dd>{direct.plan ? t(`gptPlan.${direct.plan}`, { defaultValue: direct.plan }) : "—"}</dd></div>
                  <div><dt>{t("gptVerifiedAccount")}</dt><dd>{direct.accountEmailMasked || "—"}</dd></div>
                  <div><dt>{t("source")}</dt><dd>{direct.source || "—"}</dd></div>
                  <div><dt>{t("gptServiceFeeState")}</dt><dd>{direct.serviceFeeStatus ?? "—"}</dd></div>
                  <div><dt>{t("updatedAt")}</dt><dd>{displayDate(direct.updatedAt, locale)}</dd></div>
                </dl>
                {needsAttention && <div className="admin-gpt-failure" role="note">
                  <strong>{t("gptFailureReason")}: {direct.failureReason || t("gptFailureReasonUnavailable")}</strong>
                  <small>{t("gptErrorCode")}: {direct.failureCode || direct.latestCode || t("gptErrorCodeUnavailable")}</small>
                </div>}
                <details className="admin-gpt-events">
                  <summary>{t("gptRecentEvents", { count: direct.recentEvents.length })}</summary>
                  {direct.recentEvents.length > 0 ? <ol>{direct.recentEvents.map((event) => <li key={event.eventId}>
                    <span><strong>{event.stage ? t(`gptOrderStage.${event.stage}`, { defaultValue: event.stage }) : event.type}</strong><time>{displayDate(event.occurredAt, locale)}</time></span>
                    <small>{[event.type, event.status, event.category, event.step].filter(Boolean).join(" · ")}</small>
                    {event.message && <small>{event.message}</small>}
                    {event.code && <code>{event.code}</code>}
                  </li>)}</ol> : <small>{t("gptNoRecordedEvents")}</small>}
                </details>
              </div> : "—"}</td>
              <td>{operation.targetCard ? <><strong>{operation.targetCard.cardNumberMasked ?? `#${operation.targetCard.id}`}</strong><small>{operation.targetCard.productCode ?? "—"}</small></> : "—"}</td>
              <td>${formatDecimal(operation.amount)}</td>
              <td><strong>{operation.upstreamCost === null ? "—" : `$${formatDecimal(operation.upstreamCost)}`}</strong><small>{t("customerCharge")}: {operation.customerCharge === null ? "—" : `$${formatDecimal(operation.customerCharge)}`}</small><small>{t("customerFee")}: {operation.customerFee === null ? "—" : `$${formatDecimal(operation.customerFee)}`}</small></td>
              <td className={operation.expectedProfit !== null && Number(operation.expectedProfit) < 0 ? "negative" : "positive"}><strong>{operation.expectedProfit === null ? "—" : `$${formatDecimal(operation.expectedProfit)}`}</strong><small>{t("actualProfit")}: {operation.actualProfit === null ? "—" : `$${formatDecimal(operation.actualProfit)}`}</small></td>
              <td><code>{operation.upstreamBusinessId ?? "—"}</code><small>{t("lastVerified")}: {displayDate(operation.lastVerifiedAt, locale)}</small>{operation.lastError && !direct && <small className="negative">{operation.lastError}</small>}</td>
              <td>{operation.pricingSnapshot ? <details className="admin-json"><summary>{t("viewSnapshot")}</summary><code>{JSON.stringify(operation.pricingSnapshot)}</code></details> : "—"}</td>
              <td>{displayDate(operation.createdAt, locale)}</td>
            </tr>;
          })}</tbody>
        </table></div>}
        {moneyOperations.data && <div className="admin-pagination"><span>{t("totalItems", { count: moneyOperations.data.data.total })}</span><div><Button size="xs" variant="outline" onClick={() => setMoneyQuery((current) => ({ ...current, page: current.page - 1 }))} disabled={moneyOperations.data.data.page <= 1}>{t("previousPage")}</Button><span>{moneyOperations.data.data.page}</span><Button size="xs" variant="outline" onClick={() => setMoneyQuery((current) => ({ ...current, page: current.page + 1 }))} disabled={moneyOperations.data.data.page * moneyOperations.data.data.pageSize >= moneyOperations.data.data.total}>{t("nextPage")}</Button></div></div>}
      </section>
      <section className="admin-surface">
        <div className="admin-section-heading"><div><span className="admin-kicker">FINANCIAL TRAIL</span><h2>{t("financialEvents")}</h2><p>{t("financialEventsDesc")}</p></div></div>
        {financialEvents.isLoading && <AdminRowsSkeleton />}
        {financialEvents.isError && <AdminState error>{t("adminLoadFailed")}</AdminState>}
        {financialEvents.data?.data.list.length === 0 && <AdminState>{t("noFinancialEvents")}</AdminState>}
        {financialEvents.data && financialEvents.data.data.list.length > 0 && <div className="admin-table-wrap"><table className="admin-table" data-testid="admin-financial-events-table">
          <thead><tr><th>{t("createdTime")}</th><th>{t("source")}</th><th>{t("customer")}</th><th>{t("type")}</th><th>{t("status")}</th><th>{t("amount")}</th><th>{t("balanceChange")}</th><th>{t("reference")}</th><th>{t("auditDetail")}</th></tr></thead>
          <tbody>{financialEvents.data.data.list.map((entry) => <tr key={`${entry.source}:${entry.id}`}>
            <td>{displayDate(entry.createdAt, locale)}</td><td><code>{entry.source}</code></td><td>{adminAccountLabel(entry.email)}</td><td>{entry.type}</td>
            <td><span className={`status-pill ${successfulStatus(entry.status) || entry.status === "COMPLETE" ? "is-active" : ""}`}>{entry.status}</span></td>
            <td>{entry.amount === null ? "—" : `$${formatDecimal(entry.amount)}`}</td><td>{entry.balanceBefore === null || entry.balanceAfter === null ? "—" : `${formatDecimal(entry.balanceBefore)} → ${formatDecimal(entry.balanceAfter)}`}</td>
            <td><code>{entry.referenceId ? entry.referenceId.slice(0, 16) : "—"}</code></td><td><details className="admin-json"><summary>{t("viewSnapshot")}</summary><code>{JSON.stringify(entry.detail)}</code></details></td>
          </tr>)}</tbody>
        </table></div>}
        {financialEvents.data && <div className="admin-pagination"><span>{t("totalItems", { count: financialEvents.data.data.total })}</span><div><Button size="xs" variant="outline" onClick={() => setFinancialPage((page) => page - 1)} disabled={financialEvents.data.data.page <= 1}>{t("previousPage")}</Button><span>{financialEvents.data.data.page}</span><Button size="xs" variant="outline" onClick={() => setFinancialPage((page) => page + 1)} disabled={financialEvents.data.data.page * financialEvents.data.data.pageSize >= financialEvents.data.data.total}>{t("nextPage")}</Button></div></div>}
      </section>
      <section className="admin-surface">
        <div className="admin-section-heading"><div><span className="admin-kicker">RECONCILIATION</span><h2>{t("reconciliation")}</h2><p>{t("reconciliationDesc")}</p></div><span>{openItems.length}</span></div>
        {reconciliation.isLoading && <AdminRowsSkeleton />}
        {reconciliation.isError && <AdminState error>{t("adminLoadFailed")}</AdminState>}
        {resolve.isError && <p className="admin-alert is-error" role="alert">{resolve.error instanceof Error ? resolve.error.message : t("updateFailed")}</p>}
        {reconciliation.data && openItems.length === 0 && <AdminState>{t("noOpenReconciliation")}</AdminState>}
        <div className="admin-list">{openItems.map((item) => {
          const closable = reconciliationIsClosable(item.operationStatus, item.dispatchState);
          const canProveDeleteNoEffect = item.type === "DELETE" && item.operationStatus === "RECONCILE_REQUIRED" && item.dispatchState === "UNKNOWN";
          return <article className="admin-list-row transaction-row" key={item.id}>
            <div className="transaction-icon"><ShieldCheck /></div>
            <div>
              <strong>{adminAccountLabel(item.email)} · {item.type}</strong>
              <small>{item.provider ?? "—"} · {item.operationId.slice(0, 8)} · {item.operationStatus}/{item.dispatchState}</small>
              <small>{t("amount")}: ${formatDecimal(item.amount)} · {t("customerFee")}: ${formatDecimal(item.fee)} · {t("customerCharge")}: ${formatDecimal(item.totalAmount)}</small>
              <small>{t("upstreamEvidence")}: {item.upstreamBusinessId ?? "—"}</small>
              <small>{item.reason}{item.lastError ? ` · ${item.lastError}` : ""}</small>
              {!closable && <p className="admin-alert is-warning">{t("reconciliationEvidenceRequired")}</p>}
              {canProveDeleteNoEffect && <div className="delete-reconciliation-actions">
                <small>{t("deleteNoEffectEvidenceHint")}</small>
                <div className="admin-card-actions">
                  <Button type="button" size="xs" variant="outline" disabled={deleteReconciliationAction.isPending} onClick={() => { setActionMessage(""); deleteReconciliationAction.mutate({ id: item.id, action: "observe" }); }}>{t("recordDeleteNoEffect")}</Button>
                  <Button type="button" size="xs" disabled={deleteReconciliationAction.isPending} onClick={() => { setActionMessage(""); deleteReconciliationAction.mutate({ id: item.id, action: "resolve" }); }}>{t("resolveDeleteNoEffect")}</Button>
                </div>
                <form className="admin-override-form" onSubmit={(event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  resolveDeleteBalanceLog.mutate({
                    id: item.id,
                    balanceLogId: Number(data.get("balanceLogId")),
                    note: String(data.get("balanceLogNote")),
                  });
                }}>
                  <small>{t("balanceLogEvidenceHint")}</small>
                  <label><span>{t("balanceLogEvidenceId")}</span><input name="balanceLogId" type="number" min={1} step={1} required /></label>
                  <label><span>{t("resolutionNote")}</span><input name="balanceLogNote" minLength={10} maxLength={1000} required /></label>
                  <div className="admin-card-actions"><Button type="submit" size="xs" disabled={resolveDeleteBalanceLog.isPending}>{t("resolveDeleteFromBalanceLog")}</Button></div>
                </form>
              </div>}
              {closable && <form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); const status = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "IGNORED" ? "IGNORED" : "RESOLVED"; resolve.mutate({ id: item.id, status, note: String(data.get("note")) }); }}>
                <input name="note" minLength={10} maxLength={1000} placeholder={t("resolutionNote")} required />
                <div className="admin-card-actions"><Button name="status" value="RESOLVED" size="xs" disabled={resolve.isPending}>{t("resolve")}</Button><Button name="status" value="IGNORED" size="xs" variant="outline" disabled={resolve.isPending}>{t("ignore")}</Button></div>
              </form>}
            </div>
          </article>;
        })}</div>
      </section>
      <section className="admin-surface">
        <div className="admin-section-heading"><div><span className="admin-kicker">UPSTREAM LEDGER</span><h2>{t("upstreamBalanceLogs")}</h2></div></div>
        <LedgerFilters id="upstream-ledger-filter" applied={balanceLogFilters} types={balanceLogs.data?.types ?? ["reversal_fee", "refund_fee", "decline_fee", "authorization_fee", "low_auth_fee", "foreign_tx_fee", "small_tx_fee", "merchant_violation_fee", "open_card", "card_recharge", "refund", "transfer_fee"]} onApply={filters => {if (balanceLogPage === 1 && JSON.stringify(filters) === JSON.stringify(balanceLogFilters)) void balanceLogs.refetch();setBalanceLogFilters(filters);setBalanceLogPage(1);}} />
        {balanceLogs.isLoading && <AdminRowsSkeleton />}
        {balanceLogs.isError && <AdminState error>{t("adminLoadFailed")}</AdminState>}
        {balanceLogs.data?.data.length === 0 && <AdminState>{t("noBalanceLogs")}</AdminState>}
        {balanceLogs.data && balanceLogs.data.data.length > 0 && <div className="admin-table-wrap"><table className="admin-table" data-testid="admin-balance-log-table">
          <thead><tr><th>{t("type")}</th><th>{t("amount")}</th><th>{t("balanceBefore")}</th><th>{t("balanceAfter")}</th><th>{t("remark")}</th><th>{t("linkedOperation")}</th><th>{t("matchStatus")}</th><th>{t("createdTime")}</th></tr></thead>
          <tbody>{balanceLogs.data.data.map((log) => <tr key={log.id}><td>{t(`ledgerTypes.${log.type}`, { defaultValue: log.type })}</td><td className={Number(log.amount) >= 0 ? "positive" : "negative"}>{formatDecimal(log.amount)}</td><td>{log.before}</td><td>{log.after}</td><td>{log.remark ?? "—"}</td><td><code>{log.operationId ? log.operationId.slice(0, 8) : "—"}</code></td><td>{log.matchStatus}</td><td>{displayDate(log.occurredAt, locale)}</td></tr>)}</tbody>
        </table></div>}
        {balanceLogs.data && <div className="admin-pagination"><span>{t("totalItems", { count: balanceLogs.data.pagination.total })}</span><div><Button size="xs" variant="outline" onClick={() => setBalanceLogPage((page) => page - 1)} disabled={balanceLogs.data.pagination.page <= 1}>{t("previousPage")}</Button><span>{balanceLogs.data.pagination.page}</span><Button size="xs" variant="outline" onClick={() => setBalanceLogPage((page) => page + 1)} disabled={balanceLogs.data.pagination.page * balanceLogs.data.pagination.pageSize >= balanceLogs.data.pagination.total}>{t("nextPage")}</Button></div></div>}
      </section>
    </div>;
  } else if (activePanel === "customers") {
    panel = <AdminCustomersPanel token={token} customerId={customerDetailId} cardId={customerCardId} customerView={customerView} returnPanel={customerReturnPanel} onSelectCustomer={(id, view = "overview") => id === null ? closeCustomer() : openCustomer(id, customerDetailId === null ? "customers" : customerReturnPanel, view)} />;
  } else if (activePanel === "support") {
    panel = <AdminSupportTicketsPanel token={token} />;
  } else if (activePanel === "announcements") {
    panel = <div className="admin-panel-stack" data-testid="admin-panel-announcements">
      <PanelHeading eyebrow="COMMUNICATIONS" title={t("adminAnnouncements")} description={t("adminAnnouncementsDesc")} />
      {actionMessage && <p className="admin-alert is-success" role="status">{actionMessage}</p>}
      {announcementError && <p className="admin-alert is-error" role="alert">{announcementError}</p>}
      <section className="admin-surface">
        <div className="admin-section-heading"><div><span className="admin-kicker">BROADCAST</span><h2><Megaphone />{t("publishAnnouncement")}</h2><p>{t("publishAnnouncementHint")}</p></div></div>
        <form className="admin-product-form admin-announcement-form" onSubmit={(event) => { event.preventDefault(); announcementAction.mutate(); }}>
          <label>{t("announcementTitle")}<input value={announcementDraft.title} onChange={(event) => changeAnnouncementDraft({ title: event.target.value })} maxLength={120} required /></label>
          <label>{t("announcementContent")}<textarea value={announcementDraft.content} onChange={(event) => changeAnnouncementDraft({ content: event.target.value })} maxLength={10_000} required /></label>
          <label className="admin-settings-toggle"><input type="checkbox" checked={announcementDraft.sendTelegram} onChange={(event) => changeAnnouncementDraft({ sendTelegram: event.target.checked })} disabled={announcementGroups.length === 0} /><span><strong>{t("announcementTelegramSend")}</strong><small>{t("announcementTelegramSendHint")}</small></span></label>
          {announcementDraft.sendTelegram && <label>{t("announcementTelegramGroup")}<Select value={selectedAnnouncementGroupId} onValueChange={(telegramChatId) => changeAnnouncementDraft({ telegramChatId })}><SelectTrigger aria-label={t("announcementTelegramGroup")}><SelectValue placeholder={t("selectTelegramGroup")} /></SelectTrigger><SelectContent>{announcementGroups.map((group) => <SelectItem key={group.chatId} value={group.chatId}>{group.title}</SelectItem>)}</SelectContent></Select></label>}
          <div className="admin-form-actions"><Button type="submit" disabled={announcementAction.isPending || (announcementDraft.sendTelegram && !selectedAnnouncementGroupId)}><StableSwap state={announcementAction.isPending ? "busy" : "idle"} labels={{ idle: t("sendAnnouncement"), busy: t("sendingAnnouncement") }} /></Button></div>
        </form>
      </section>
      <section className="admin-surface">
        <div className="admin-section-heading"><div><span className="admin-kicker">HISTORY</span><h2><Megaphone />{t("announcementHistory")}</h2><p>{t("adminAnnouncementHistoryHint")}</p></div>{announcementHistory.data && <span>{t("totalItems", { count: announcementHistory.data.data.total })}</span>}</div>
        {announcementHistory.isLoading && <AdminRowsSkeleton />}
        {announcementHistory.isError && <AdminState error>{t("announcementHistoryLoadFailed")}</AdminState>}
        {announcementHistory.data?.data.list.length === 0 && <AdminState>{t("noAnnouncements")}</AdminState>}
        {announcementHistory.data && <div className="admin-list">{announcementHistory.data.data.list.map((item) => <article className="admin-list-row announcement-admin-row" key={item.id}>
          <div className="transaction-icon"><Megaphone /></div>
          <div><strong>{item.title}</strong><p>{item.content}</p><small>{displayDate(item.createdAt, locale)} · {t("announcementReadCount", { count: item.readCount ?? 0 })}{item.telegramDelivery ? ` · ${t("announcementTelegramDelivery", { group: item.telegramDelivery.groupTitle, status: item.telegramDelivery.status })}` : ""}</small></div>
          <div className="admin-list-row-actions"><span className={`status-pill ${item.isActive ? "is-active" : ""}`}>{item.isActive ? t("published") : t("withdrawn")}</span>{item.isActive && <Button size="xs" variant="outline" onClick={() => { if (window.confirm(t("withdrawAnnouncementConfirm"))) retractAnnouncement.mutate(item.id); }} disabled={retractAnnouncement.isPending}>{t("withdrawAnnouncement")}</Button>}</div>
        </article>)}</div>}
        {announcementHistory.data && announcementHistory.data.data.total > announcementHistory.data.data.pageSize && <div className="admin-pagination"><span>{t("totalItems", { count: announcementHistory.data.data.total })}</span><div><Button size="xs" variant="outline" onClick={() => setAnnouncementPage((page) => page - 1)} disabled={announcementPage <= 1}>{t("previousPage")}</Button><span>{announcementPage}</span><Button size="xs" variant="outline" onClick={() => setAnnouncementPage((page) => page + 1)} disabled={announcementPage * announcementHistory.data.data.pageSize >= announcementHistory.data.data.total}>{t("nextPage")}</Button></div></div>}
      </section>
    </div>;
  } else if (activePanel === "audit") {
    panel = <div className="admin-panel-stack" data-testid="admin-panel-audit">
      <PanelHeading eyebrow="AUDIT TRAIL" title={t("adminAudit")} description={t("adminAuditDesc")} actions={<form className="admin-filter-bar" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); setAuditQuery({ page: 1, q: String(data.get("q")).trim(), action: String(data.get("action")).trim(), targetType: String(data.get("targetType")).trim() }); }}>
        <label><span>{t("search")}</span><input name="q" defaultValue={auditQuery.q} placeholder={t("searchAudit")} /></label>
        <label><span>{t("auditAction")}</span><input name="action" defaultValue={auditQuery.action} placeholder="adjust_wallet" /></label>
        <label><span>{t("auditTargetType")}</span><input name="targetType" defaultValue={auditQuery.targetType} placeholder="user / upstream" /></label>
        <Button type="submit" size="sm">{t("filter")}</Button>
      </form>} />
      <section className="admin-surface">
        {auditLogs.isLoading && <AdminRowsSkeleton />}
        {auditLogs.isError && <AdminState error>{t("adminLoadFailed")}</AdminState>}
        {auditLogs.data?.data.list.length === 0 && <AdminState>{t("noAuditLogs")}</AdminState>}
        {auditLogs.data && auditLogs.data.data.list.length > 0 && <div className="admin-table-wrap"><table className="admin-table" data-testid="admin-audit-table">
          <thead><tr><th>{t("createdTime")}</th><th>{t("administrator")}</th><th>{t("auditAction")}</th><th>{t("auditOutcome")}</th><th>{t("auditSource")}</th><th>{t("auditTarget")}</th><th>{t("auditDetail")}</th></tr></thead>
          <tbody>{auditLogs.data.data.list.map((entry) => {
            const copy = auditActionCopy(entry.action, i18n.language === "en");
            return <tr key={entry.id}><td>{displayDate(entry.createdAt, locale)}</td><td>{entry.actorUserId ? <button type="button" className="admin-customer-inviter" onClick={() => openCustomer(entry.actorUserId!, "audit")}><span>{adminAccountLabel(entry.actorEmail, entry.actorUserId)}</span><ArrowRight /></button> : adminAccountLabel(entry.actorEmail)}<small>{entry.actorType === "system" && i18n.language !== "en" ? "系统任务" : entry.actorType}</small></td><td><button type="button" className="admin-detail-link" title={copy.description} onClick={() => setSelectedAudit(entry)}>{copy.label}</button><small>{copy.description}</small></td><td><span className={`status-pill ${entry.outcome === "success" ? "is-active" : ""}`}>{entry.outcome === "success" && i18n.language !== "en" ? "成功" : entry.outcome}</span></td><td>{entry.sourceIp ?? "—"}<small>{entry.requestId.slice(0, 8)}</small></td><td>{entry.targetUserId ? <button type="button" className="admin-customer-inviter" onClick={() => openCustomer(entry.targetUserId!, "audit")}><span>用户 #{entry.targetUserId}</span><ArrowRight /></button> : entry.targetType ?? "—"}<small>{entry.targetId ?? "—"}</small></td><td><Button size="xs" variant="outline" onClick={() => setSelectedAudit(entry)}>{t("details")}</Button></td></tr>;
          })}</tbody>
        </table></div>}
        {auditLogs.data && <div className="admin-pagination"><span>{t("totalItems", { count: auditLogs.data.data.total })}</span><div><Button size="xs" variant="outline" onClick={() => setAuditQuery((current) => ({ ...current, page: current.page - 1 }))} disabled={auditLogs.data.data.page <= 1}>{t("previousPage")}</Button><span>{auditLogs.data.data.page}</span><Button size="xs" variant="outline" onClick={() => setAuditQuery((current) => ({ ...current, page: current.page + 1 }))} disabled={auditLogs.data.data.page * auditLogs.data.data.pageSize >= auditLogs.data.data.total}>{t("nextPage")}</Button></div></div>}
      </section>
    </div>;
  } else if (activePanel === "rewards") {
    panel = <AdminRewardsPanel token={token} displayDate={(value) => displayDate(value, locale)} onSelectCustomer={(id) => openCustomer(id, "rewards")} />;
  } else if (activePanel === "telegram") {
    panel = <AdminTelegramPanel token={token} onSelectCustomer={(id) => openCustomer(id, "telegram")} />;
  } else {
    panel = <div className="admin-panel-stack"><AdminSystemSettingsPanel token={token} /><AdminLegalDocumentsPanel token={token} /></div>;
  }

  return <div className="admin-shell" data-testid="admin-shell">
    <a className="skip-link" href="#main-content">{t("skipToContent")}</a>
    <aside className="admin-local-sidebar">
      <div className="admin-local-brand"><span><BrandIcon /></span><div><strong>AVANFINITY</strong><small>{t("adminWorkspace")}</small></div></div>
      <nav aria-label={t("adminNavigation")} data-testid="admin-local-nav">
        {adminSections.map(({ id, label, icon: Icon }) => <button key={id} type="button" onClick={() => { selectPanel(id); setActionMessage(""); }} aria-current={activePanel === id ? "page" : undefined} data-testid={`admin-nav-${id}`}><Icon /><span>{t(label)}</span>{id === "support" && adminSupportUnreadCount > 0 && <b className="sidebar-badge" aria-label={t("unreadSupportMessages", { count: adminSupportUnreadCount })}>{adminSupportUnreadCount > 99 ? "99+" : adminSupportUnreadCount}</b>}</button>)}
      </nav>
      <div className="admin-local-foot">
        <LanguageButton />
        <Link to="/dashboard" className="admin-back-link" data-testid="admin-back-to-app"><ArrowLeft /><span>{t("adminBackToApp")}</span></Link>
        <div className="admin-local-audit"><ShieldCheck /><span><strong>{t("auditEnabled")}</strong><small>{t("allActionsRecorded")}</small></span></div>
      </div>
    </aside>
    <div className="admin-shell-content" id="main-content" tabIndex={-1} data-testid="admin-workspace">
      <PageShell eyebrow="OPERATIONS" title={t("adminTitle")} description={t("adminDesc")} className="admin-page">
        <section className="admin-panel" aria-live="polite">{panel}</section>
      </PageShell>
    <Dialog.Root open={Boolean(selectedMoneyId)} onOpenChange={(open) => !open && setSelectedMoneyId(null)}>
      <Dialog.Portal><div className="dialog-overlay" data-state={selectedMoneyId ? "open" : "closed"} aria-hidden="true" onClick={() => setSelectedMoneyId(null)} onWheel={(event) => event.preventDefault()} onTouchMove={(event) => event.preventDefault()} /><Dialog.Content className="dialog-content admin-observability-drawer">
        <div className="card-transaction-drawer-head"><div><span><WalletCards /></span><div><Dialog.Title>资金操作详情</Dialog.Title><Dialog.Description>{selectedMoneyId}</Dialog.Description></div></div><Dialog.Close asChild><Button size="icon" variant="ghost" aria-label={t("close")}><X /></Button></Dialog.Close></div>
        {moneyOperationDetail.isLoading && <div className="admin-observability-body" aria-busy="true"><dl className="admin-metrics wide">{[0, 1, 2, 3].map((item) => <div key={item}><dt><DataSkeleton /></dt><dd><DataSkeleton /></dd></div>)}</dl><AdminRowsSkeleton /></div>}
        {moneyOperationDetail.isError && <AdminState error>{t("adminLoadFailed")}</AdminState>}
        {moneyOperationDetail.data && <div className="admin-observability-body">
          <div className="admin-drawer-hero">
            <div>
              <span className="admin-drawer-hero-kicker">CHARGE</span>
              <div className="admin-drawer-hero-status"><span className="status-pill is-active">{operationStatusLabel(moneyOperationDetail.data.data.operation.status, i18n.language === "en")}</span></div>
              <p className="admin-drawer-hero-amount">{formatDecimal(moneyOperationDetail.data.data.operation.customerCharge ?? "—")}<small>客户扣款 · 费用 {formatDecimal(moneyOperationDetail.data.data.operation.customerFee ?? "—")}</small></p>
            </div>
            <div className="admin-drawer-hero-side">
              <span className="admin-drawer-hero-kicker">OPERATION</span>
              <dl>
                <div><dt>类型</dt><dd>{operationTypeLabel(moneyOperationDetail.data.data.operation.type, i18n.language === "en")}</dd></div>
                <div><dt>上游金额</dt><dd>{formatDecimal(moneyOperationDetail.data.data.operation.upstreamCost ?? "—")}</dd></div>
                <div><dt>调度</dt><dd>{dispatchStateLabel(moneyOperationDetail.data.data.operation.dispatchState, i18n.language === "en")}</dd></div>
              </dl>
            </div>
          </div>
          <section className="admin-drawer-section">
            <header><span>SUMMARY</span><h3>基础信息</h3></header>
            <dl className="admin-drawer-facts">
              <div className="is-wide"><dt>客户</dt><dd><button type="button" className="admin-detail-link" onClick={() => openCustomer(moneyOperationDetail.data!.data.operation.userId, activePanel)}>{adminAccountLabel(moneyOperationDetail.data.data.operation.email, moneyOperationDetail.data.data.operation.userId)}</button></dd></div>
              <div><dt>时间</dt><dd>{displayDate(moneyOperationDetail.data.data.operation.createdAt, locale)}</dd></div>
              <div><dt>调度状态</dt><dd>{dispatchStateLabel(moneyOperationDetail.data.data.operation.dispatchState, i18n.language === "en")}</dd></div>
              <div className="is-emphasis"><dt>客户扣款</dt><dd>{formatDecimal(moneyOperationDetail.data.data.operation.customerCharge ?? "—")}</dd></div>
              <div className="is-emphasis"><dt>上游金额</dt><dd>{formatDecimal(moneyOperationDetail.data.data.operation.upstreamCost ?? "—")}</dd></div>
              <div className="is-emphasis"><dt>费用</dt><dd>{formatDecimal(moneyOperationDetail.data.data.operation.customerFee ?? "—")}</dd></div>
            </dl>
          </section>
          {moneyOperationDetail.data.data.operation.lastError && <p className="admin-alert is-error">{moneyOperationDetail.data.data.operation.lastError}</p>}
          <section className="admin-drawer-section">
            <header><span>EVIDENCE</span><h3>定价快照与核对证据</h3></header>
            <details className="admin-json" open><summary>查看 JSON</summary><pre>{JSON.stringify({ pricingSnapshot: moneyOperationDetail.data.data.operation.pricingSnapshot, reconciliation: moneyOperationDetail.data.data.reconciliation, upstreamEvidence: moneyOperationDetail.data.data.upstreamEvidence }, null, 2)}</pre></details>
          </section>
          {moneyOperationDetail.data.data.operation.gptDirect?.recentEvents.length ? <section className="admin-drawer-section"><header><span>TIMELINE</span><h3>GPT 事件时间线</h3></header><div className="transaction-lifecycle">{moneyOperationDetail.data.data.operation.gptDirect.recentEvents.map((event) => <article key={event.eventId}><i /><div><strong>{event.message || event.type}</strong><span>{displayDate(event.occurredAt, locale)}</span><p>{[event.stage, event.status, event.step].filter(Boolean).join(" · ")}</p></div></article>)}</div></section> : null}
        </div>}
      </Dialog.Content></Dialog.Portal>
    </Dialog.Root>
    <Dialog.Root open={Boolean(selectedAudit)} onOpenChange={(open) => !open && setSelectedAudit(null)}>
      <Dialog.Portal><div className="dialog-overlay" data-state={selectedAudit ? "open" : "closed"} aria-hidden="true" onClick={() => setSelectedAudit(null)} onWheel={(event) => event.preventDefault()} onTouchMove={(event) => event.preventDefault()} /><Dialog.Content className="dialog-content admin-observability-drawer">
        <div className="card-transaction-drawer-head"><div><span><ClipboardList /></span><div><Dialog.Title>{selectedAudit ? auditActionCopy(selectedAudit.action, i18n.language === "en").label : "审计详情"}</Dialog.Title><Dialog.Description>{selectedAudit?.requestId}</Dialog.Description></div></div><Dialog.Close asChild><Button size="icon" variant="ghost" aria-label={t("close")}><X /></Button></Dialog.Close></div>
        {selectedAudit && <div className="admin-observability-body">
          <div className="admin-drawer-hero">
            <div>
              <span className="admin-drawer-hero-kicker">AUDIT</span>
              <div className="admin-drawer-hero-status"><span className="status-pill is-active">{selectedAudit.outcome === "success" && i18n.language !== "en" ? "成功" : selectedAudit.outcome}</span></div>
              <p className="admin-drawer-hero-amount">{auditActionCopy(selectedAudit.action, i18n.language === "en").label}<small>{displayDate(selectedAudit.createdAt, locale)}</small></p>
            </div>
            <div className="admin-drawer-hero-side">
              <span className="admin-drawer-hero-kicker">CONTEXT</span>
              <dl>
                <div><dt>目标</dt><dd>{selectedAudit.targetType ?? "—"} · {selectedAudit.targetId ?? "—"}</dd></div>
                <div><dt>来源 IP</dt><dd>{selectedAudit.sourceIp ?? "—"}</dd></div>
                <div><dt>代码</dt><dd><code>{selectedAudit.action}</code></dd></div>
              </dl>
            </div>
          </div>
          <p className="admin-drawer-note">{auditActionCopy(selectedAudit.action, i18n.language === "en").description}</p>
          <section className="admin-drawer-section">
            <header><span>DETAILS</span><h3>请求信息</h3></header>
            <dl className="admin-drawer-facts">
              <div><dt>原始操作代码</dt><dd><code>{selectedAudit.action}</code></dd></div>
              <div><dt>结果</dt><dd>{selectedAudit.outcome === "success" && i18n.language !== "en" ? "成功" : selectedAudit.outcome}</dd></div>
              <div><dt>时间</dt><dd>{displayDate(selectedAudit.createdAt, locale)}</dd></div>
              <div><dt>来源 IP</dt><dd>{selectedAudit.sourceIp ?? "—"}</dd></div>
              <div className="is-wide"><dt>目标</dt><dd>{selectedAudit.targetType ?? "—"} · {selectedAudit.targetId ?? "—"}</dd></div>
              <div className="is-wide"><dt>请求 ID</dt><dd><code>{selectedAudit.requestId}</code></dd></div>
            </dl>
          </section>
          <section className="admin-drawer-section">
            <header><span>PAYLOAD</span><h3>脱敏详情</h3></header>
            <details className="admin-json" open><summary>查看 JSON</summary><pre>{JSON.stringify({ ...selectedAudit.detail, userAgent: selectedAudit.userAgent }, null, 2)}</pre></details>
          </section>
        </div>}
      </Dialog.Content></Dialog.Portal>
    </Dialog.Root>
    </div>
  </div>;
}
