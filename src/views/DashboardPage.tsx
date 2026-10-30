import { formatDecimal } from "../decimal";
import { useAtomValue } from "jotai";
import { useQuery } from "@tanstack/react-query";
import { Link, Navigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowUpRight, CreditCard, Landmark, Megaphone, Plus, ShieldCheck, WalletCards, type LucideIcon } from "lucide-react";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ApiError, getAnnouncementHistory, getCardTransactions, getDashboard, getDashboardCharts } from "../api";
import { formatRateBps } from "../components/PaymentPerformance";
import { sessionAtom, sessionIdentity } from "../state";
import { Button } from "@/components/ui/button";
import { DataSkeleton } from "../components/PageShell";
import { interactiveCardMotion } from "../interactiveCardMotion";

export function DashboardPage() {
  const { t } = useTranslation();
  const session = useAtomValue(sessionAtom);
  const query = useQuery({
    queryKey: ["dashboard", sessionIdentity(session)],
    queryFn: () => getDashboard(session!.token),
    enabled: Boolean(session),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
  const charts = useQuery({ queryKey: ["dashboard-charts"], queryFn: () => getDashboardCharts(session!.token), enabled: Boolean(session), staleTime: 30_000 });
  const recentTransactions = useQuery({ queryKey: ["dashboard-card-transactions"], queryFn: () => getCardTransactions(session!.token), enabled: Boolean(session), staleTime: 30_000 });
  const announcements = useQuery({ queryKey: ["dashboard-announcements"], queryFn: () => getAnnouncementHistory(session!.token, 1, 4), enabled: Boolean(session), staleTime: 30_000 });

  if (!session) return <Navigate to="/login" />;
  if (query.error instanceof ApiError && query.error.errorCode === "AUTH_REQUIRED") return <Navigate to="/login" />;
  if (query.isError) return <main className="center"><div role="alert" className="error">
    <p>{query.error instanceof Error ? query.error.message : "Request failed"}</p>
    <Button type="button" variant="outline" onClick={() => void query.refetch()}>{t("retry")}</Button>
  </div></main>;
  if (!query.data) return <main className="dashboard" aria-busy="true">
    <header><div><span className="eyebrow">ACCOUNT OVERVIEW</span><h1>{t("welcome")}</h1><p><span className="loading-skeleton loading-skeleton-inline">{t("loading")}</span></p></div>
      <Button asChild size="lg"><Link to="/cards"><Plus /> {t("newCard")}</Link></Button>
    </header>
    <section className="balance-hero">
      <div><span>{t("totalAvailable")}</span><strong><span className="loading-skeleton loading-skeleton-inline">{t("loading")}</span></strong><p>{t("spendableBalanceHint")}</p></div>
      <div className="virtual-card overview-card"><span>AVANFINITY / VIRTUAL</span><strong><span className="loading-skeleton loading-skeleton-inline">{t("loading")}</span></strong><small>VALID THRU&nbsp;&nbsp; <span className="loading-skeleton loading-skeleton-inline">{t("loading")}</span></small></div>
    </section>
    <section className="stats">{[
      { label: t("totalBalance"), note: t("walletTotalBalanceHint"), icon: WalletCards },
      { label: t("spendableBalance"), note: t("available"), icon: WalletCards },
      { label: t("riskLockedBalance"), note: t("available"), icon: ShieldCheck },
      { label: t("cardBalance"), note: t("available"), icon: CreditCard },
      { label: t("cards"), note: t("activeCards"), icon: Landmark },
      { label: t("inviteCode"), note: "", icon: ArrowUpRight },
    ].map(({ label, note, icon: LoadingIcon }) => <article key={label}><div className="stat-icon"><LoadingIcon /></div><span>{label}</span><strong><span className="loading-skeleton loading-skeleton-inline">{t("loading")}</span></strong>{note && <small>{note}</small>}</article>)}</section>
    <section className="dashboard-insight-grid">
      <article className="transaction-panel dashboard-trend-panel"><div className="section-title"><h2><ArrowUpRight />30 天余额与消费</h2><span>USD</span></div><div className="dashboard-trend"><div className="dashboard-trend-legend"><span className="is-balance">账户余额</span><span className="is-spend">每日消费</span></div><div className="dashboard-trend-chart dashboard-loading-chart"><span className="loading-skeleton loading-skeleton-inline">{t("loading")}</span><span className="loading-skeleton loading-skeleton-inline">{t("loading")}</span><span className="loading-skeleton loading-skeleton-inline">{t("loading")}</span></div></div></article>
      {[{ title: "最近卡片交易", icon: CreditCard, link: "/card-transactions" as const }, { title: "最近公告", icon: Megaphone, link: "/announcements" as const }].map(({ title, icon: LoadingIcon, link }) => <article className="transaction-panel" key={title}><div className="section-title"><h2><LoadingIcon />{title}</h2><Button asChild size="xs" variant="outline"><Link to={link}>查看全部</Link></Button></div><div className="dashboard-feed dashboard-loading-feed">{[0, 1, 2].map((item) => <div key={item}><span><strong><span className="loading-skeleton loading-skeleton-inline">{t("loading")}</span></strong><small><span className="loading-skeleton loading-skeleton-inline">{t("loading")}</span></small></span><b><span className="loading-skeleton loading-skeleton-inline">{t("loading")}</span></b></div>)}</div></article>)}
    </section>
  </main>;

  const spendableBalance = query.data.spendableBalance ?? query.data.walletBalance;
  const lockedBalance = query.data.lockedBalance ?? "0.0000";
  const declineRate = formatRateBps(query.data.paymentRisk?.declineRateBps);
  const cards: Array<{ label: string; value: string | number; note: string; icon: LucideIcon }> = [
    { label: t("totalBalance"), value: `$${formatDecimal(query.data.walletBalance)}`, note: t("walletTotalBalanceHint"), icon: WalletCards },
    { label: t("spendableBalance"), value: `$${formatDecimal(spendableBalance)}`, note: t("available"), icon: WalletCards },
    { label: t("riskLockedBalance"), value: `$${formatDecimal(lockedBalance)}`, note: query.data.paymentRisk?.enabled ? t(query.data.paymentRisk.reserveActive ? "paymentReserveActive" : "paymentReserveInactive") : t("available"), icon: ShieldCheck },
    ...(query.data.paymentRisk?.enabled ? [{ label: t("paymentDeclineRate"), value: declineRate ?? t("paymentNoSample"), note: query.data.paymentRisk.attempts ? t("paymentSampleCount", { count: query.data.paymentRisk.attempts }) : "", icon: ShieldCheck }] : []),
    { label: t("cardBalance"), value: `$${formatDecimal(query.data.cardBalance)}`, note: t("available"), icon: CreditCard },
    { label: t("cards"), value: query.data.cardCount, note: t("activeCards"), icon: Landmark },
    { label: t("inviteCode"), value: query.data.inviteCode, note: "", icon: ArrowUpRight },
  ];

  return <main className="dashboard">
    <header><div><span className="eyebrow">ACCOUNT OVERVIEW</span><h1>{t("welcome")}</h1><p>{query.data.displayName ?? query.data.email ?? `#${query.data.userId}`}</p></div>
      <Button asChild size="lg"><Link to="/cards"><Plus /> {t("newCard")}</Link></Button>
    </header>
    <section className="balance-hero">
      <div><span>{t("totalAvailable")}</span><strong>${formatDecimal(spendableBalance)}</strong><p>{t("spendableBalanceHint")}</p></div>
      <div className="virtual-card overview-card interactive-card" {...interactiveCardMotion}><span>AVANFINITY / VIRTUAL</span><strong>•••• 8842</strong><small>VALID THRU&nbsp;&nbsp; 12/29</small></div>
    </section>
    <section className="stats">{cards.map(({ label, value, note, icon: CardIcon }) => {
      return <article key={label}><div className="stat-icon"><CardIcon /></div><span>{label}</span><strong>{value}</strong><small>{note}</small></article>;
    })}</section>
    <section className="dashboard-insight-grid">
      <article className="transaction-panel dashboard-trend-panel"><div className="section-title"><h2><ArrowUpRight />30 天余额与消费</h2><span>USD</span></div>{charts.data ? <DashboardTrend balance={charts.data.data.balance} spend={charts.data.data.spend} /> : <div className="dashboard-trend"><div className="dashboard-trend-legend"><span className="is-balance">账户余额</span><span className="is-spend">每日消费</span></div><div className="dashboard-trend-chart dashboard-loading-chart"><DataSkeleton /><DataSkeleton /><DataSkeleton /></div></div>}</article>
      <article className="transaction-panel"><div className="section-title"><h2><CreditCard />最近卡片交易</h2><Button asChild size="xs" variant="outline"><Link to="/card-transactions">查看全部</Link></Button></div><div className="dashboard-feed">{recentTransactions.isLoading && [0, 1, 2].map((item) => <div key={item}><span><strong><DataSkeleton /></strong><small><DataSkeleton /></small></span><b><DataSkeleton /></b></div>)}{recentTransactions.data?.data.list.slice(0, 4).map((item) => <Link key={item.id} to="/cards/$cardId" params={{ cardId: String(item.cardId) }}><span><strong>{item.merchantName ?? item.description ?? "卡片交易"}</strong><small>{item.cardNumberMasked ?? `#${item.cardId}`} · {new Date(item.authTime).toLocaleString()}</small></span><b>{formatDecimal(item.settleAmount)} {item.settleCurrency}</b></Link>)}{recentTransactions.data?.data.list.length === 0 && <div className="empty-state">暂时没有卡片交易</div>}</div></article>
      <article className="transaction-panel"><div className="section-title"><h2><Megaphone />最近公告</h2><Button asChild size="xs" variant="outline"><Link to="/announcements">查看全部</Link></Button></div><div className="dashboard-feed">{announcements.isLoading && [0, 1, 2].map((item) => <div key={item}><span><strong><DataSkeleton /></strong><small><DataSkeleton /></small></span><b><DataSkeleton /></b></div>)}{announcements.data?.data.list.map((item) => <a key={item.id} href={item.metadata?.targetPath ?? "/announcements"}><span><strong>{item.title}</strong><small>{new Date(item.createdAt).toLocaleString()}</small></span>{!item.isRead && <b>未读</b>}</a>)}{announcements.data?.data.list.length === 0 && <div className="empty-state">暂无公告</div>}</div></article>
    </section>
  </main>;
}

function DashboardTrend({ balance, spend }: { balance: Array<{ date: string; balance: string }>; spend: Array<{ date: string; spend: string }> }) {
  const spendByDate = new Map(spend.map((item) => [item.date, Number(item.spend) || 0]));
  const days = balance.map((item) => ({ date: item.date, balance: Number(item.balance) || 0, spend: spendByDate.get(item.date) ?? 0 }));
  return <div className="dashboard-trend">
    <div className="dashboard-trend-legend"><span className="is-balance">账户余额</span><span className="is-spend">每日消费</span></div>
    <div className="dashboard-trend-chart">
      <ResponsiveContainer width="100%" height="100%" debounce={80}>
        <ComposedChart data={days} margin={{ top: 10, right: 4, bottom: 2, left: 0 }} accessibilityLayer>
          <defs><linearGradient id="dashboard-balance-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#252525" stopOpacity=".2" /><stop offset="100%" stopColor="#252525" stopOpacity=".02" /></linearGradient></defs>
          <CartesianGrid vertical={false} stroke="#e5e5e2" strokeDasharray="4 7" />
          <XAxis dataKey="date" axisLine={false} tickLine={false} minTickGap={34} tickFormatter={(value: string) => value.slice(5).replace("-", "/")} />
          <YAxis yAxisId="balance" axisLine={false} tickLine={false} width={49} tickFormatter={(value: number) => `$${formatDecimal(value)}`} />
          <YAxis yAxisId="spend" orientation="right" axisLine={false} tickLine={false} width={45} tickFormatter={(value: number) => `$${formatDecimal(value)}`} />
          <Tooltip cursor={{ stroke: "#b0b0b0", strokeDasharray: "3 4" }} content={({ active, payload, label }) => active && payload?.length ? <div className="admin-trend-tooltip dashboard-trend-tooltip">
            <strong>{label}</strong>
            <span><i className="is-balance" />账户余额<b>${formatDecimal(Number(payload.find((item) => item.dataKey === "balance")?.value ?? 0))}</b></span>
            <span><i className="is-spend" />当日消费<b>${formatDecimal(Number(payload.find((item) => item.dataKey === "spend")?.value ?? 0))}</b></span>
          </div> : null} />
          <Area yAxisId="balance" type="monotone" dataKey="balance" name="账户余额" stroke="#252525" strokeWidth={3} fill="url(#dashboard-balance-area)" dot={false} activeDot={{ r: 5, fill: "#fff", stroke: "#252525", strokeWidth: 3 }} />
          <Line yAxisId="spend" type="monotone" dataKey="spend" name="每日消费" stroke="#888" strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: "#fff", stroke: "#888", strokeWidth: 2.5 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  </div>;
}
