function positiveId(value: string) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

const returnPanels = new Set(["overview", "upstreams", "costs", "tiers", "cards", "funds", "customers", "support", "announcements", "telegram", "audit", "system", "gptOrders"]);
export type AdminCustomerView = "overview" | "cards";

export function parseAdminCustomerReturnPath(value: string | null | undefined) {
  if (!value) return null;
  const url = new URL(value, "https://local.invalid");
  if (url.pathname !== "/admin" || url.searchParams.get("panel") !== "customers") return null;
  const customerId = positiveId(url.searchParams.get("customerId") ?? "");
  const cardValue = url.searchParams.get("cardId");
  const cardId = cardValue ? positiveId(cardValue) : null;
  const viewValue = url.searchParams.get("view");
  const from = url.searchParams.get("from");
  if (!customerId || (cardValue && !cardId) || (viewValue && viewValue !== "cards") || (from && !returnPanels.has(from))) return null;
  return { customerId, cardId, ...(viewValue ? { view: viewValue as AdminCustomerView } : {}), ...(from ? { from } : {}) };
}

export function adminCustomerReturnPath(customerId: number, cardId?: number | null, from?: string | null) {
  if (!Number.isSafeInteger(customerId) || customerId <= 0
    || (cardId != null && (!Number.isSafeInteger(cardId) || cardId <= 0))
    || (from != null && !returnPanels.has(from))) {
    throw new Error("Invalid admin customer return path");
  }
  return `/admin?panel=customers&customerId=${customerId}${cardId == null ? "" : `&cardId=${cardId}`}${from == null ? "" : `&from=${from}`}`;
}
