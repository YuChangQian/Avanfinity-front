import { formatDecimal } from "../decimal";
import { useAtomValue } from "jotai";
import { useQuery } from "@tanstack/react-query";
import { Navigate } from "@tanstack/react-router";
import { AlertTriangle, BarChart3, CheckCircle2, Clock3, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataSkeleton, PageShell } from "../components/PageShell";
import { PaymentPerformance } from "../components/PaymentPerformance";
import { getOpenAiPrices } from "../api";
import { sessionAtom } from "../state";
import { useTranslation } from "react-i18next";
import { useFeatures } from "../features";

export function MarketPage() {
  const session = useAtomValue(sessionAtom);
  const { t, i18n } = useTranslation();
  const featureAccess = useFeatures();
  const { flags } = featureAccess;
  const query = useQuery({ queryKey: ["openai-prices"], queryFn: () => getOpenAiPrices(session!.token), enabled: Boolean(session && featureAccess.data?.data.market) });
  if (!session) return <Navigate to="/login" />;
  const loadingPage = <PageShell eyebrow="PAYMENT REFERENCE" title={t("marketTitle")} description={t("marketDesc")}>
    <div aria-busy="true">
      <section className="market-context-panel"><div><BarChart3 /><span>{t("marketReferenceCount")}</span><strong><DataSkeleton /></strong><small>{t("marketVerifiedSource")}</small></div><div><Clock3 /><span>{t("marketObservedAt")}</span><strong><DataSkeleton /></strong><small>{t("marketLatestSuccess")}</small></div><Button variant="outline" disabled><RefreshCw />{t("refresh")}</Button></section>
      <section className="transaction-panel market-performance"><div className="section-title"><div><h2>{t("paymentPerformanceByBin")}</h2><p>{t("paymentPerformanceBinHint")}</p></div></div><div className="market-performance-grid">{[0, 1, 2].map((item) => <article key={item}><h3><DataSkeleton /></h3><DataSkeleton /><DataSkeleton /></article>)}</div></section>
      <section className="module-grid market-grid">{[0, 1, 2].map((item) => <article className="module-card market-card" key={item}><div className="stat-icon"><CheckCircle2 /></div><span>{t("marketDirectType")}</span><h2><DataSkeleton /></h2><strong><DataSkeleton /></strong><p><DataSkeleton /></p><small><DataSkeleton /></small></article>)}</section>
      <section className="market-disclaimer"><AlertTriangle /><p><strong>{t("marketDisclaimerTitle")}</strong><span>{t("marketDisclaimer")}</span></p></section>
    </div>
  </PageShell>;
  if (featureAccess.isPending) return loadingPage;
  if (featureAccess.isError || !flags.market) return <PageShell eyebrow="PAYMENT REFERENCE" title={t("marketTitle")} description={t("marketDesc")}>
    <section className="deposit-panel feature-disabled"><BarChart3 /><p>{t("featureUnavailable")}</p></section>
  </PageShell>;
  if (query.isError) return <PageShell eyebrow="PAYMENT REFERENCE" title={t("marketTitle")} description={t("marketDesc")}>
    <section className="deposit-panel query-error" role="alert">
      <strong>{t("marketLoadFailed")}</strong>
      {flags.market && <Button variant="outline" onClick={() => void query.refetch()}><RefreshCw />{t("retry")}</Button>}
    </section>
  </PageShell>;
  if (!query.data) return loadingPage;
  const references = query.data.data.references;
  const binStats = query.data.data.binStats ?? [];
  const locale = i18n.language === "en" ? "en-US" : "zh-CN";
  const formatTime = (value?: string) => {
    if (!value) return t("marketTimeUnavailable");
    return Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString(locale) : value;
  };
  const formatPrice = (amount: string, currency: string) => {
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
  const priceWithEstimate = (amount: string, currency: string, estimatedUsd?: string | null) => {
    const estimate = currency === "USD" ? "" : estimatedUsdLabel(estimatedUsd);
    return `${formatPrice(amount, currency)}${estimate ? ` · ${estimate}` : ""}`;
  };

  return <PageShell eyebrow="PAYMENT REFERENCE" title={t("marketTitle")} description={t("marketDesc")}>
    <section className="market-context-panel">
      <div><BarChart3 /><span>{t("marketReferenceCount")}</span><strong>{references.length}</strong><small>{t("marketVerifiedSource")}</small></div>
      <div><Clock3 /><span>{t("marketObservedAt")}</span><strong>{formatTime(references[0]?.completedAt)}</strong><small>{t("marketLatestSuccess")}</small></div>
      {flags.market && <Button variant="outline" onClick={() => void query.refetch()} disabled={query.isFetching}>
        <RefreshCw className={query.isFetching ? "is-spinning" : ""} />{query.isFetching ? t("refreshing") : t("refresh")}
      </Button>}
    </section>
    <section className="transaction-panel market-performance" data-testid="market-payment-performance">
      <div className="section-title"><div><h2>{t("paymentPerformanceByBin")}</h2><p>{t("paymentPerformanceBinHint")}</p></div></div>
      {binStats.length === 0 ? <div className="empty-state">{t("paymentNoSample")}</div> : <div className="market-performance-grid">{binStats.map((item) => <article key={item.bin6}>
        <h3>{t("paymentBinLabel", { bin: item.bin6 })}</h3>
        <PaymentPerformance overall={item.overall} plans={item.plans} />
      </article>)}</div>}
    </section>
    {references.length === 0 ? <section className="empty-state market-empty">
      <BarChart3 />
      <strong>{t("marketNoPrices")}</strong>
      <span>{t("marketNoPricesHint")}</span>
    </section> : <section className="module-grid market-grid">{references.map((reference, index) => <article className="module-card market-card" key={`${reference.completedAt}:${reference.bin6 ?? "unknown"}:${index}`}>
      <div className="stat-icon"><CheckCircle2 /></div>
      <span>{t("marketDirectType")}</span>
      <h2>{t("marketReferenceCard", { bin: reference.bin6 ?? t("marketBinUnavailable") })}</h2>
      <strong>{priceWithEstimate(reference.priceMajor, reference.currency, reference.estimatedUsd)}</strong>
      <p>{t("marketReferencePlan", { plan: t(`gptPlan.${reference.plan}`, { defaultValue: reference.plan }) })}</p>
      <small>{t("marketRecordTime", { time: formatTime(reference.completedAt) })}</small>
    </article>)}</section>}
    <section className="market-disclaimer"><AlertTriangle /><p><strong>{t("marketDisclaimerTitle")}</strong><span>{t("marketDisclaimer")}</span></p></section>
  </PageShell>;
}
