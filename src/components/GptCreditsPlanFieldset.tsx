import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { GptDirectPlan, GptDirectQuote } from "../api";
import {
  creditPlanKey,
  creditQuantityForPlan,
  isCreditPresetPlan,
  parseCreditQuantityDraft,
} from "../gptDirect/plans";

type Props = {
  plans: GptDirectPlan[];
  selectedPlanKey: string;
  customActive?: boolean;
  quotes?: Record<string, GptDirectQuote>;
  disabled?: boolean;
  formatQuote: (quote: GptDirectQuote) => string;
  serviceFeeText: (plan: GptDirectPlan) => string;
  onSelect: (planKey: string) => void;
  onCustomActiveChange?: (active: boolean) => void;
};

export function GptCreditsPlanFieldset({
  plans,
  selectedPlanKey,
  customActive,
  quotes,
  disabled,
  formatQuote,
  serviceFeeText,
  onSelect,
  onCustomActiveChange,
}: Props) {
  const { t } = useTranslation();
  const selectedQuantity = creditQuantityForPlan(selectedPlanKey);
  const customSelected = Boolean(customActive) || (Boolean(selectedQuantity) && !isCreditPresetPlan(selectedPlanKey));
  const [customDraft, setCustomDraft] = useState(
    selectedQuantity && !isCreditPresetPlan(selectedPlanKey) ? String(selectedQuantity) : "",
  );
  const customQuantity = parseCreditQuantityDraft(customDraft);

  if (plans.length === 0) return null;

  function selectCustom(raw: string) {
    setCustomDraft(raw);
    const quantity = parseCreditQuantityDraft(raw);
    onSelect(quantity ? creditPlanKey(quantity) : "");
    onCustomActiveChange?.(true);
  }

  return (
    <fieldset className="gpt-plan-options" data-testid="gpt-credits-plans" disabled={disabled}>
      <legend>{t("gptChooseCredits")}</legend>
      <small>{t("gptCreditsHint")}</small>
      {plans.map((plan) => (
        <label key={plan.key} className={!customSelected && selectedPlanKey === plan.key ? "is-selected" : ""}>
          <input
            type="radio"
            name="plan"
            value={plan.key}
            checked={!customSelected && selectedPlanKey === plan.key}
            onChange={() => {
              onCustomActiveChange?.(false);
              onSelect(plan.key);
            }}
          />
          <span>
            <strong>{t(`gptPlan.${plan.key}`, { defaultValue: plan.label })}</strong>
            <small>{serviceFeeText(plan)}</small>
          </span>
          {quotes?.[plan.key] && <small>{formatQuote(quotes[plan.key])}</small>}
        </label>
      ))}
      <label className={`gpt-credits-custom${customSelected ? " is-selected" : ""}`}>
        <input
          type="radio"
          name="plan"
          value="credits_custom"
          checked={customSelected}
          onChange={() => selectCustom(customDraft)}
        />
        <span>
          <strong>{t("gptCreditsCustom")}</strong>
          <small>{t("gptCreditsCustomHint")}</small>
        </span>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          className="gpt-credits-quantity"
          value={customDraft}
          placeholder={t("gptCreditsCustomPlaceholder")}
          aria-label={t("gptCreditsCustom")}
          data-testid="gpt-credits-custom-quantity"
          onFocus={() => selectCustom(customDraft)}
          onChange={(event) => selectCustom(event.target.value)}
        />
        <span className="gpt-credits-custom-preview" data-testid="gpt-credits-custom-preview">
          {customSelected && customQuantity > 0 && quotes?.[creditPlanKey(customQuantity)] ? (
            <>
              <strong data-testid="gpt-credits-custom-quote">{formatQuote(quotes[creditPlanKey(customQuantity)])}</strong>
              <small>{t("gptCreditsCustomQuoteHint")}</small>
            </>
          ) : customSelected && customDraft !== "" && customQuantity <= 0 ? (
            <small role="alert">{t("gptCreditsQuantityInvalid")}</small>
          ) : (
            <small>{t("gptCreditsCustomQuotePending")}</small>
          )}
        </span>
      </label>
    </fieldset>
  );
}
