import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { LedgerFilters as Filters } from "../api";

const feeTypes = ["REVERSAL_FEE", "REFUND_COST", "DECLINE_FEE", "AUTHORIZATION_FEE", "LOW_AUTH_FEE", "FOREIGN_TX_FEE", "SMALL_TX_FEE", "MERCHANT_VIOLATION_FEE", "DECLINE_RATE_FEE"];
function localDay(value?: string, exclusive = false) {
  if (!value) return "";
  const date = new Date(value);
  if (exclusive) date.setDate(date.getDate() - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function LedgerFilters({ id, types, wallet = false, applied = {}, onApply }: {
  id: string; types: string[]; wallet?: boolean; applied?: Filters; onApply: (filters: Filters) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(() => ({ type: applied.type ?? "", direction: applied.direction ?? "", startDate: localDay(applied.startAt), endDate: localDay(applied.endAt, true), q: applied.q ?? "", feeKind: applied.feeKind ?? "" }));
  const availableTypes = Array.from(new Set([...types, ...(draft.type ? [draft.type] : [])]));
  const set = (key: keyof typeof draft, value: string) => setDraft(previous => ({ ...previous, [key]: value }));
  return <form className={`admin-filter-bar ledger-filter-bar${wallet ? " is-wallet" : ""}`} data-testid={id} onSubmit={event => {
    event.preventDefault();
    const boundary = (day: string, next = false) => {
      if (!day) return undefined;
      const date = new Date(`${day}T00:00:00`);
      if (next) date.setDate(date.getDate() + 1);
      return date.toISOString();
    };
    onApply({ type: draft.type || undefined, direction: draft.direction || undefined,
      startAt: boundary(draft.startDate), endAt: boundary(draft.endDate, true),
      q: draft.q.trim() || undefined, feeKind: draft.feeKind || undefined });
  }}>
    <label><span>{t("type")}</span><select aria-label={t("type")} value={draft.type} onChange={event => set("type", event.target.value)}>
      <option value="">{t("allTypes")}</option>{availableTypes.map(type => <option key={type} value={type}>{t(`ledgerTypes.${type}`, { defaultValue: type })}</option>)}
    </select></label>
    {wallet && <label><span>{t("ledgerFeeKind")}</span><select value={draft.feeKind} onChange={event => set("feeKind", event.target.value)}>
      <option value="">{t("allTypes")}</option>{feeTypes.map(type => <option key={type} value={type}>{t(`ledgerFees.${type}`, { defaultValue: type })}</option>)}
    </select></label>}
    <label><span>{t("ledgerDirection")}</span><select value={draft.direction} onChange={event => set("direction", event.target.value)}>
      <option value="">{t("ledgerAllDirections")}</option><option value="credit">{t("ledgerCredit")}</option><option value="debit">{t("ledgerDebit")}</option>
    </select></label>
    <label><span>{t("startDate")}</span><input type="date" value={draft.startDate} max={draft.endDate || undefined} onChange={event => set("startDate", event.target.value)} /></label>
    <label><span>{t("endDate")}</span><input type="date" value={draft.endDate} min={draft.startDate || undefined} onChange={event => set("endDate", event.target.value)} /></label>
    <label><span>{t("ledgerKeyword")}</span><input maxLength={100} value={draft.q} onChange={event => set("q", event.target.value)} /></label>
    <Button type="submit" size="sm">{t("filter")}</Button>
    <Button type="button" size="sm" variant="outline" onClick={() => {setDraft({ type: "", direction: "", startDate: "", endDate: "", q: "", feeKind: "" });onApply({});}}>{t("ledgerReset")}</Button>
  </form>;
}
