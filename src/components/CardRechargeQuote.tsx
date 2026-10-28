import { formatDecimal } from "../decimal";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError, getCardRechargeQuote, type CardRechargeQuote } from "../api";

function decimalUnits(value: string) {
  const match = /^(\d+)(?:\.(\d{1,4}))?$/.exec(value);
  if (!match) return null;
  return BigInt(match[1]) * 10_000n + BigInt((match[2] ?? "").padEnd(4, "0"));
}

export function isValidCardRechargeAmount(value: string, minimum?: string, maximum?: string) {
  const amount = decimalUnits(value);
  const min = minimum ? decimalUnits(minimum) : null;
  const max = maximum ? decimalUnits(maximum) : null;
  return amount !== null && min !== null && max !== null && amount >= min && amount <= max;
}

function formatRateAsPercent(value: string) {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return value;
  const whole = match[1];
  const digits = `${whole}${match[2] ?? ""}`.padEnd(whole.length + 2, "0");
  const decimalIndex = whole.length + 2;
  const integer = digits.slice(0, decimalIndex).replace(/^0+(?=\d)/, "") || "0";
  const fraction = digits.slice(decimalIndex).replace(/0+$/, "");
  return `${integer}${fraction ? `.${fraction}` : ""}%`;
}

export function useCardRechargeQuote(
  token: string | undefined,
  cardId: number | undefined,
  amount: string,
  minimum: string | undefined,
  maximum: string | undefined,
  enabled: boolean,
) {
  const amountIsValid = isValidCardRechargeAmount(amount, minimum, maximum);
  const query = useQuery({
    queryKey: ["card-recharge-quote", cardId, amount],
    queryFn: async ({ signal }) => ({
      requestedAmount: amount,
      quote: (await getCardRechargeQuote(token!, cardId!, amount, signal)).data,
    }),
    enabled: enabled && token !== undefined && Number.isInteger(cardId) && amountIsValid,
    retry: false,
    staleTime: 0,
  });
  return {
    ...query,
    amountIsValid,
    currentQuote: query.data?.requestedAmount === amount ? query.data.quote : undefined,
  };
}

export function rechargeDebitExceedsSpendable(totalDebit?: string, spendableBalance?: string) {
  const debit = moneyUnits(totalDebit);
  const spendable = moneyUnits(spendableBalance);
  return debit !== null && spendable !== null && spendable < debit;
}

function moneyUnits(value?: string) {
  const match = value ? /^(\d+)(?:\.(\d+))?$/.exec(value) : null;
  if (!match) return null;
  return BigInt(match[1]) * 100_000_000n + BigInt((match[2] ?? "").slice(0, 8).padEnd(8, "0"));
}

export function CardRechargeQuoteSummary({
  amount,
  amountIsValid,
  isFetching,
  isError,
  quote,
  error,
  spendableBalance,
  onRetry,
}: {
  amount: string;
  amountIsValid: boolean;
  isFetching: boolean;
  isError: boolean;
  quote?: CardRechargeQuote;
  error?: unknown;
  spendableBalance?: string;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  const insufficient = rechargeDebitExceedsSpendable(quote?.totalDebit, spendableBalance);
  return <div className={`card-recharge-quote${insufficient ? " is-insufficient" : ""}`} data-testid="card-recharge-quote" aria-live="polite">
    {spendableBalance !== undefined && <div className="card-recharge-spendable" data-testid="recharge-quote-spendable"><span>{t("spendableBalance")}</span><strong>${formatDecimal(spendableBalance)}</strong></div>}
    {!amount ? <p>{t("rechargeQuoteEnterAmount")}</p>
      : !amountIsValid ? <p>{t("rechargeQuoteInvalidAmount")}</p>
        : isFetching ? <p role="status" className="loading-skeleton loading-skeleton-inline">{t("rechargeQuoteLoading")}</p>
          : isError ? <div><p role="alert" className="error">{t(error instanceof ApiError && error.errorCode === "RECHARGE_PRICING_UNAVAILABLE" ? "rechargePricingUnavailable" : "rechargeQuoteFailed")}</p>{onRetry && <button type="button" onClick={onRetry}>{t("retry")}</button>}</div>
            : quote ? <>
              <dl>
                <div><dt>{t("rechargeQuoteAmount")}</dt><dd data-testid="recharge-quote-amount">${formatDecimal(quote.amount)}</dd></div>
                <div><dt>{t("rechargeQuoteFee", { rate: formatRateAsPercent(quote.effectiveRechargeRate) })}</dt><dd data-testid="recharge-quote-fee">${formatDecimal(quote.fee)}</dd></div>
                <div><dt>{t("rechargeQuoteWalletDebit")}</dt><dd data-testid="recharge-quote-total">${formatDecimal(quote.totalDebit)}</dd></div>
              </dl>
              {insufficient && <p role="alert" className="error">{t("rechargeSpendableInsufficient")}</p>}
            </>
              : <p>{t("rechargeQuoteEnterAmount")}</p>}
  </div>;
}
