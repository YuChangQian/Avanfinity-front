import { useTranslation } from "react-i18next";
import type { GptDirectQuote } from "../api";

type Props = {
  quote: GptDirectQuote;
  formattedQuote: string;
  estimatedUsd?: string | null;
  priceWithEstimate: (price: string, currency: string, estimatedUsd?: string | null) => string;
};

export function GptCreditsCheckoutSummary({
  quote,
  formattedQuote,
  estimatedUsd,
  priceWithEstimate,
}: Props) {
  const { t } = useTranslation();
  return (
    <div data-testid="gpt-credits-quote">
      <span>{t("gptCreditsQuote")}</span>
      <strong>{priceWithEstimate(formattedQuote, quote.currency, estimatedUsd)}</strong>
    </div>
  );
}
