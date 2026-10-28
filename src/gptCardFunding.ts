// Exact fixed-point arithmetic: estimates may have eight decimals; card money has four.
function units(value: string, scale: number) {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value);
  const fraction = (match?.[2] ?? "").replace(/0+$/, "");
  if (!match || fraction.length > scale) throw new Error("Invalid funding amount");
  return BigInt(match[1]) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, "0"));
}

function money(value: bigint) {
  return `${value / 10_000n}.${(value % 10_000n).toString().padStart(4, "0")}`;
}

export function fundingAmount(balance: string, estimateUsd: string, minimum: string, maximum: string) {
  const estimate = units(estimateUsd, 8);
  const available = units(balance, 4);
  if (estimate <= 0n) throw new Error("Invalid funding estimate");
  const target = ((estimate + 300_000_000n + 999_999n) / 1_000_000n) * 100n;
  if (available >= target) return "0.0000";
  const min = units(minimum, 4);
  const amount = target - available > min ? target - available : min;
  // Round up to cents without underfunding a four-decimal card balance.
  const rounded = ((amount + 99n) / 100n) * 100n;
  if (rounded > units(maximum, 4)) throw new Error("Funding exceeds card limit");
  return money(rounded);
}

export function fundingTotal(amount: string, fee: string) {
  return money(units(amount, 4) + units(fee, 4));
}

export function fundingCovered(balance: string, amount: string) {
  return units(balance, 4) >= units(amount, 4);
}
