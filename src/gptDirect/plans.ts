export const MIN_CREDIT_QUANTITY = 250;
export const MAX_CREDIT_QUANTITY = 9_999_999;
export const CREDIT_PRESET_QUANTITIES = [250, 1000, 2500, 5000] as const;
export const CREDIT_PLAN_QUANTITY: Record<string, number> = {
  credits_250: 250,
  credits_1000: 1000,
  credits_2500: 2500,
  credits_5000: 5000,
};
const CREDIT_PLAN_RE = /^credits_([1-9]\d{0,6})$/;
const DEFAULT_CREDIT_DISCOUNT_TIERS = [
  { minimumQuantity: 2500, percentOff: 10 },
  { minimumQuantity: 5000, percentOff: 20 },
  { minimumQuantity: 25000, percentOff: 30 },
] as const;

export function creditPlanKey(quantity: number) {
  return `credits_${quantity}`;
}

export function parseCreditQuantity(value?: string | null) {
  const match = CREDIT_PLAN_RE.exec(value ?? "");
  if (!match) return 0;
  const quantity = Number(match[1]);
  if (!Number.isSafeInteger(quantity) || quantity < MIN_CREDIT_QUANTITY || quantity > MAX_CREDIT_QUANTITY) {
    return 0;
  }
  return quantity;
}

export function isCreditPlan(value?: string | null) {
  return parseCreditQuantity(value) > 0;
}

export function isCreditPresetPlan(value?: string | null) {
  return Boolean(value && value in CREDIT_PLAN_QUANTITY);
}

export function creditQuantityForPlan(value?: string | null) {
  return parseCreditQuantity(value);
}

export function splitDirectPlans<T extends { key: string }>(plans: T[]) {
  return {
    subscriptionPlans: plans.filter((plan) => !isCreditPlan(plan.key)),
    creditPlans: plans.filter((plan) => isCreditPlan(plan.key)),
  };
}

export function parseCreditQuantityDraft(value: string) {
  const normalized = value.trim().replace(/[,_\s]/g, "");
  if (!normalized || !/^[1-9]\d{0,6}$/.test(normalized)) return 0;
  return parseCreditQuantity(creditPlanKey(Number(normalized)));
}

export function creditPercentOff(quantity: number) {
  let percent = 0;
  for (const tier of DEFAULT_CREDIT_DISCOUNT_TIERS) {
    if (quantity >= tier.minimumQuantity) percent = Math.max(percent, tier.percentOff);
  }
  return percent;
}

export function creditAmountMinor(quantity: number, amountPerCredit: number, exponent: number) {
  if (quantity <= 0 || amountPerCredit <= 0 || exponent < 0) return 0;
  const scale = 10 ** exponent;
  return Math.round(amountPerCredit * quantity * (100 - creditPercentOff(quantity)) / 100 * scale);
}

export function creditFundingUsd(catalogUsd: string, catalogQuantity: number, quantity: number) {
  if (catalogQuantity <= 0 || quantity <= 0) return "";
  const match = /^(\d+)(?:\.(\d{1,8}))?$/.exec(catalogUsd.trim());
  if (!match) return "";
  const units = BigInt(match[1]) * 100_000_000n + BigInt((match[2] ?? "").padEnd(8, "0").slice(0, 8));
  const scaled = (units * BigInt(quantity) + BigInt(catalogQuantity) - 1n) / BigInt(catalogQuantity);
  const whole = scaled / 100_000_000n;
  const fraction = scaled % 100_000_000n;
  return `${whole}.${fraction.toString().padStart(8, "0")}`;
}

export function creditQuoteFromBase(
  quotes: Record<string, { country: string; currency: string; plan: string; amountMinor: number; amountMajor?: number; minorUnitExponent: number; fetchedAt?: number }>,
  quantity: number,
) {
  if (parseCreditQuantity(creditPlanKey(quantity)) !== quantity) return undefined;
  const existing = quotes[creditPlanKey(quantity)];
  if (existing && existing.amountMinor > 0) return existing;
  const base = quotes.credits_250;
  if (!base || base.amountMinor <= 0) return undefined;
  const amountPerCredit = base.amountMinor / 10 ** base.minorUnitExponent / 250;
  const amountMinor = creditAmountMinor(quantity, amountPerCredit, base.minorUnitExponent);
  if (amountMinor <= 0) return undefined;
  return {
    country: base.country,
    currency: base.currency,
    plan: creditPlanKey(quantity),
    amountMinor,
    amountMajor: amountMinor / 10 ** base.minorUnitExponent,
    minorUnitExponent: base.minorUnitExponent,
    fetchedAt: base.fetchedAt,
  };
}
