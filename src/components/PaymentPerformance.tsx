import { formatDecimal } from "../decimal";
import { useTranslation } from "react-i18next";
import type { OpenAiPlanPerformance, PaymentRate } from "../api";

const planOrder = ["go", "plus", "pro_5x", "pro_20x", "pro_25x"];

export function formatRateBps(value: number | null | undefined) {
  return value === null || value === undefined ? null : `${formatDecimal((value / 100).toFixed(2))}%`;
}

export function PaymentPerformance({ overall, plans, className = "" }: {
  overall?: PaymentRate | null;
  plans?: OpenAiPlanPerformance[];
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "en" ? "en-US" : "zh-CN";
  const rows = [...(plans ?? [])].sort((a, b) => {
    const left = planOrder.indexOf(a.plan);
    const right = planOrder.indexOf(b.plan);
    return (left < 0 ? planOrder.length : left) - (right < 0 ? planOrder.length : right);
  });
  const formatPrice = (value: string, currency: string) => {
    const amount = Number(value);
    try {
      return Number.isFinite(amount) ? new Intl.NumberFormat(locale, { style: "currency", currency , minimumFractionDigits: 0, maximumFractionDigits: 20 }).format(amount) : `${value} ${currency}`;
    } catch {
      return `${value} ${currency}`;
    }
  };

  const overallShare = overall && overall.attempts > 0 && overall.successRateBps !== null && overall.successRateBps !== undefined
    ? Math.min(100, Math.max(0, overall.successRateBps / 100))
    : null;

  return <div className={`payment-performance ${className}`.trim()} data-testid="payment-performance">
    {overall && <div className="payment-performance-overall">
      <div><strong>{t("paymentOverallRate")}</strong><span>{overallShare === null ? t("paymentNoSample") : formatRateBps(overall.successRateBps)}</span></div>
      {overallShare !== null && <div className="payment-performance-meter" role="progressbar" aria-label={t("paymentOverallSummary", {
        successRate: formatRateBps(overall.successRateBps),
        declineRate: formatRateBps(overall.declineRateBps),
        attempts: overall.attempts,
      })} aria-valuemin={0} aria-valuemax={100} aria-valuenow={overallShare}><span style={{ width: `${overallShare}%` }} /></div>}
    </div>}
    {rows.length > 0 && <details className="payment-performance-details">
      <summary>{t("paymentPlanDetails")}<span>{rows.length}</span></summary>
      <div className="payment-performance-plans">{rows.map((item) => {
        const success = item.latestSuccess;
        const rate = formatRateBps(item.declineRateBps);
        return <div className="payment-performance-row" data-plan={item.plan} key={item.plan}>
          <strong>{t(`gptPlan.${item.plan}`, { defaultValue: item.plan })}</strong>
          <span>{success
            ? `${formatPrice(success.priceMajor, success.currency)} · ${new Date(success.completedAt).toLocaleString(locale)}`
            : t("paymentNoRecentSuccess")}</span>
          <small>{rate === null
            ? t("paymentNoSample")
            : t("paymentDeclineSummary", { rate, declines: item.declines, attempts: item.attempts })}</small>
        </div>;
      })}</div>
    </details>}
  </div>;
}
