// Display only: trim fixed-point padding without Number conversion or rounding.
export function formatDecimal(value: string | number | bigint | null | undefined) {
  if (value === null || value === undefined) return "—";
  const text = String(value);
  const match = /^([+-]?\d+)\.(\d+)$/.exec(text);
  if (!match) return text;
  const fraction = match[2].replace(/0+$/, "");
  const result = fraction ? `${match[1]}.${fraction}` : match[1];
  return /^-0+$/.test(result) ? "0" : result;
}

export function shiftDecimal(value: string, places: number, fixedScale?: number) {
  const match = /^(\d+)(?:\.(\d*))?$/.exec(value.trim());
  if (!match) return "";
  const digits = `${match[1]}${match[2] ?? ""}`;
  const point = match[1].length + places;
  const whole = (point <= 0 ? "0" : point >= digits.length ? digits.padEnd(point, "0") : digits.slice(0, point))
    .replace(/^0+(?=\d)/, "");
  let fraction = point <= 0 ? `${"0".repeat(-point)}${digits}` : point >= digits.length ? "" : digits.slice(point);
  if (fixedScale !== undefined) {
    if (fraction.length > fixedScale && /[1-9]/.test(fraction.slice(fixedScale))) return "";
    fraction = fraction.slice(0, fixedScale).padEnd(fixedScale, "0");
  } else {
    fraction = fraction.replace(/0+$/, "");
  }
  return fraction ? `${whole || "0"}.${fraction}` : whole || "0";
}

export function formatRateAsPercent(value: string) {
  const percentage = shiftDecimal(value, 2);
  return percentage ? `${percentage}%` : "—";
}
