import { formatDecimal, formatRateAsPercent } from "../decimal";
import { useTranslation } from "react-i18next";
import type { Product } from "../api";

type FeePolicy = Pick<Product,
  "productCode" | "refundRate" | "declineFee" | "authorizationReversalRate" | "authorizationFee" |
  "smallTransactionFee" | "crossBorderFee" | "lowAuthorizationThreshold" | "lowAuthorizationFee" |
  "lowAuthorizationStackMode" | "refundKeepMinimum"
> & { binNotes?: Record<string, string> };

function money(value: string | null | undefined) {
  return value == null ? "—" : `$${formatDecimal(value)}`;
}

function rate(value: string | undefined) {
  return formatRateAsPercent(value ?? "");
}

export function ProductFeeDetails({ product }: { product: FeePolicy }) {
  const { t } = useTranslation();
  const hasLowAuthorizationRule = product.lowAuthorizationThreshold != null && product.lowAuthorizationFee != null;
  const binNotes = Object.entries(product.binNotes ?? {}).filter(([, note]) => note.trim());
  const stackMode = product.lowAuthorizationStackMode === "replace_platform_small_tx"
    ? t("lowAuthorizationReplacesSmallTransactionFee")
    : product.lowAuthorizationStackMode === "stack"
      ? t("lowAuthorizationStacksWithSmallTransactionFee")
      : product.lowAuthorizationStackMode
        ? t("lowAuthorizationStackModeValue", { mode: product.lowAuthorizationStackMode })
        : null;

  return <section className="product-fee-details" data-testid={`product-fees-${product.productCode}`}>
    <h3>{t("completeFeeSchedule")}</h3>
    <dl className="core-fee-list">
      <div><dt>{t("transactionRefundRateWithCode")}</dt><dd data-testid="open-refund-rate">{rate(product.refundRate)}</dd></div>
    </dl>
    <p>{t("transactionRefundRateHint")}</p>
    <p>{t("refundKeepMinimumRule", { amount: formatDecimal(product.refundKeepMinimum ?? "—") })}</p>
    <details className="additional-fee-details">
      <summary>{t("additionalFeeDetails")}</summary>
      <div className="additional-fee-content">
        <dl>
          <div><dt>{t("authorizationFee")}</dt><dd>{money(product.authorizationFee)}</dd></div>
          <div><dt>{t("productDeclineFee")}</dt><dd>{money(product.declineFee)}</dd></div>
          <div><dt>{t("authorizationReversalRate")}</dt><dd>{rate(product.authorizationReversalRate)}</dd></div>
          <div><dt>{t("smallTransactionFee")}</dt><dd>{money(product.smallTransactionFee)}</dd></div>
          <div><dt>{t("crossBorderFee")}</dt><dd>{money(product.crossBorderFee)}</dd></div>
        </dl>
        <p>{t("transactionFeeTriggerHint")}</p>
        {hasLowAuthorizationRule && <p className="low-authorization-rule"><strong>{t("lowAuthorizationRuleTitle")}</strong>{t("lowAuthorizationRule", { threshold: formatDecimal(product.lowAuthorizationThreshold), fee: formatDecimal(product.lowAuthorizationFee) })}{stackMode && <> {stackMode}</>}</p>}
      </div>
    </details>
    {binNotes.length > 0 && <div className="bin-notes"><strong>{t("binNotes")}</strong><ul>{binNotes.map(([bin, note]) => <li key={bin}>{bin}: {note}</li>)}</ul></div>}
  </section>;
}
