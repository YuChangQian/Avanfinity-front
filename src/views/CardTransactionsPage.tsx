import ledgerI18n, { t as ledgerT } from "i18next";
import { useTranslation } from "react-i18next";
import { Notice, NoticeScope } from "../components/ui/notice";
import { formatDecimal } from "../decimal";
import { useState, type FormEvent } from "react";
import { useAtomValue } from "jotai";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, Navigate, useSearch } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, ReceiptText, Search, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { Button } from "@/components/ui/button";
import { getCardSpending, type CardSpending } from "../api";
import { DataSkeleton, PageShell } from "../components/PageShell";
import { sessionAtom } from "../state";

const statusLabels: Record<string, string> = {
  get PENDING() { return ledgerT("ledgerText.pending"); }, get SETTLED() { return ledgerT("ledgerText.settled"); }, get DECLINED() { return ledgerT("ledgerText.failed"); }, get REFUNDED() { return ledgerT("ledgerText.refunded"); },
  get PARTIALLY_REFUNDED() { return ledgerT("ledgerText.partiallyRefunded"); }, get REVERSED() { return ledgerT("ledgerText.reversed"); },
};

function money(amount: string | null, currency: string | null) {
  if (amount === null) return "—";
  return `${currency || "USD"} ${formatDecimal(amount)}`;
}

export function CardTransactionsPage() {
  useTranslation();
  const session = useAtomValue(sessionAtom);
  const search = useSearch({ strict: false }) as { cardId?: number | string; authId?: string };
  const initialCardId = Number.isSafeInteger(Number(search.cardId)) && Number(search.cardId) > 0 ? Number(search.cardId) : undefined;
  const initialAuthId = typeof search.authId === "string" && search.authId.length <= 200 ? search.authId : "";
  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState({ q: initialAuthId, status: "", cardStatus: "", from: "", to: "" });
  const [filters, setFilters] = useState(draft);
  const [selected, setSelected] = useState<CardSpending | null | undefined>(undefined);
  const query = useQuery({
    queryKey: ["card-spending", page, initialCardId, filters],
    queryFn: () => getCardSpending(session!.token, {
      page, pageSize: 30, cardId: initialCardId, q: filters.q, status: filters.status, cardStatus: filters.cardStatus,
      from: filters.from ? `${filters.from}T00:00:00Z` : undefined,
      to: filters.to ? `${filters.to}T23:59:59Z` : undefined,
    }),
    enabled: Boolean(session),
    placeholderData: keepPreviousData,
    refetchInterval: 10_000,
  });
  if (!session) return <Navigate to="/login" />;

  const data = query.data?.data;
  const visibleSelected = selected === undefined && initialAuthId
    ? data?.list.find((item) => item.authId === initialAuthId) ?? null
    : selected ?? null;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setPage(1);
    setFilters(draft);
  };
  const reset = () => {
    const empty = { q: "", status: "", cardStatus: "", from: "", to: "" };
    setDraft(empty); setFilters(empty); setPage(1);
  };

  return <PageShell eyebrow="CARD LEDGER" title={ledgerT("cardTransactions")} description={ledgerT("ledgerText.viewSpendingSettlementsRefundsAndReversalsAcross")} className="card-spending-page">
    <form className="card-spending-filters" onSubmit={submit}>
      <label className="card-spending-search"><span>{ledgerT("ledgerText.merchantOrTransactionId")}</span><div><Search /><input value={draft.q} onChange={(event) => setDraft({ ...draft, q: event.target.value })} placeholder={ledgerT("ledgerText.searchMerchantDescriptionOrTransactionId")} /></div></label>
      <label><span>{ledgerT("ledgerText.transactionStatus")}</span><select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}><option value="">{ledgerT("ledgerText.all")}</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label><span>{ledgerT("cardStatus")}</span><select value={draft.cardStatus} onChange={(event) => setDraft({ ...draft, cardStatus: event.target.value })}><option value="">{ledgerT("ledgerText.all")}</option><option value="ACTIVE">{ledgerT("ledgerText.active")}</option><option value="FROZEN">{ledgerT("ledgerText.frozen")}</option><option value="DELETED">{ledgerT("ledgerText.closed")}</option></select></label>
      <label><span>{ledgerT("startDate")}</span><input type="date" value={draft.from} onChange={(event) => setDraft({ ...draft, from: event.target.value })} /></label>
      <label><span>{ledgerT("endDate")}</span><input type="date" value={draft.to} onChange={(event) => setDraft({ ...draft, to: event.target.value })} /></label>
      <div className="card-spending-filter-actions"><Button type="submit"><Search />{ledgerT("search")}</Button><Button type="button" variant="outline" onClick={reset}>{ledgerT("ledgerText.reset")}</Button></div>
    </form>

    <section className="transaction-panel card-spending-table-panel">
      <div className="section-title"><div><h2>{ledgerT("ledgerText.allSpending")}</h2><p>{ledgerT("ledgerText.eachAuthorizationAppearsAsOneRowSelect")}</p></div><span>{data ? ledgerT("ledgerText.entryCount", { count: data.total }) : <DataSkeleton />}</span></div>
      {query.isError && <Notice className="error" role="alert">{query.error instanceof Error ? query.error.message : ledgerT("ledgerText.unableToLoadSpendingRecords")}</Notice>}
      {query.isPending && <div className="table-scroll" aria-busy="true"><table className="data-table card-spending-table"><thead><tr><th>{ledgerT("ledgerText.time")}</th><th>{ledgerT("ledgerText.card")}</th><th>{ledgerT("merchant")}</th><th>{ledgerT("status")}</th><th>{ledgerT("ledgerText.originalCurrencyAmount")}</th><th>{ledgerT("ledgerText.settlementAmount")}</th><th>{ledgerT("location")}</th><th>{ledgerT("ledgerText.failureReason")}</th><th>{ledgerT("ledgerText.transactionId")}</th></tr></thead><tbody>{[0, 1, 2, 3].map((row) => <tr key={row}>{Array.from({ length: 9 }, (_, cell) => <td key={cell}><DataSkeleton /></td>)}</tr>)}</tbody></table></div>}
      {data && data.list.length === 0 && <div className="empty-state">{ledgerT("ledgerText.noCardTransactionsMatchTheseFilters")}</div>}
      {data && data.list.length > 0 && <div className="table-scroll"><table className="data-table card-spending-table">
        <thead><tr><th>{ledgerT("ledgerText.time")}</th><th>{ledgerT("ledgerText.card")}</th><th>{ledgerT("merchant")}</th><th>{ledgerT("status")}</th><th>{ledgerT("ledgerText.originalCurrencyAmount")}</th><th>{ledgerT("ledgerText.settlementAmount")}</th><th>{ledgerT("location")}</th><th>{ledgerT("ledgerText.failureReason")}</th><th>{ledgerT("ledgerText.transactionId")}</th></tr></thead>
        <tbody>{data.list.map((item) => <tr key={`${item.providerId}-${item.cardId}-${item.authId}`} onClick={() => setSelected(item)} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") setSelected(item); }}>
          <td>{new Date(item.occurredAt).toLocaleString(ledgerI18n.language === "en" ? "en-US" : "zh-CN")}</td>
          <td><Link to="/cards/$cardId" params={{ cardId: String(item.cardId) }} onClick={(event) => event.stopPropagation()}>{item.cardNumberMasked}</Link>{item.cardStatus === "DELETED" && <small className="archived-label">{ledgerT("ledgerText.closed")}</small>}</td>
          <td><strong>{item.merchantName || item.description || ledgerT("unknownMerchant")}</strong><small>{item.billStatus || item.channel || "—"}</small></td>
          <td><span className={`status-pill card-transaction-status is-${item.status.toLowerCase()}`}>{statusLabels[item.status] || item.status}</span></td>
          <td>{money(item.merchantAmount || item.authorizedAmount, item.merchantCurrency || item.authCurrency)}</td>
          <td>{money(item.settledAmount, item.settleCurrency)}</td>
          <td>{[item.merchantLocation, item.merchantRegion, item.merchantCountry].filter(Boolean).join(" · ") || "—"}</td>
          <td>{item.failedReason || "—"}</td><td><code>{item.authId}</code></td>
        </tr>)}</tbody>
      </table></div>}
      {data && data.total > data.pageSize && <div className="card-spending-pagination"><Button variant="outline" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}><ChevronLeft />{ledgerT("previousPage")}</Button><span>{ledgerT("ledgerText.pageOfTotal", { page, total: Math.ceil(data.total / data.pageSize) })}</span><Button variant="outline" disabled={page * data.pageSize >= data.total} onClick={() => setPage((value) => value + 1)}>{ledgerT("nextPage")}<ChevronRight /></Button></div>}
    </section>

    <Dialog.Root open={Boolean(visibleSelected)} onOpenChange={(open) => !open && setSelected(null)}>
      <Dialog.Portal><div className="dialog-overlay" data-state={visibleSelected ? "open" : "closed"} aria-hidden="true" onClick={() => setSelected(null)} onWheel={(event) => event.preventDefault()} onTouchMove={(event) => event.preventDefault()} /><Dialog.Content className="dialog-content card-transaction-drawer"><NoticeScope />
        <div className="card-transaction-drawer-head"><div><span><ReceiptText /></span><div><Dialog.Title>{visibleSelected?.merchantName || visibleSelected?.description || ledgerT("ledgerText.transactionDetails")}</Dialog.Title><Dialog.Description>{visibleSelected?.authId}</Dialog.Description></div></div><Dialog.Close asChild><Button variant="ghost" size="icon" aria-label={ledgerT("ledgerText.close")}><X /></Button></Dialog.Close></div>
        {visibleSelected && <><dl className="transaction-detail-grid"><div><dt>{ledgerT("ledgerText.card")}</dt><dd>{visibleSelected.cardNumberMasked}</dd></div><div><dt>{ledgerT("ledgerText.finalStatus")}</dt><dd>{statusLabels[visibleSelected.status] || visibleSelected.status}</dd></div><div><dt>{ledgerT("ledgerText.authorizedAmount")}</dt><dd>{money(visibleSelected.authorizedAmount, visibleSelected.authCurrency)}</dd></div><div><dt>{ledgerT("ledgerText.settlementAmount")}</dt><dd>{money(visibleSelected.settledAmount, visibleSelected.settleCurrency)}</dd></div><div><dt>{ledgerT("ledgerText.refundedAmount")}</dt><dd>{money(visibleSelected.refundedAmount, visibleSelected.settleCurrency)}</dd></div><div><dt>{ledgerT("location")}</dt><dd>{[visibleSelected.merchantLocation, visibleSelected.merchantRegion, visibleSelected.merchantCountry].filter(Boolean).join(" · ") || "—"}</dd></div></dl>
          <section className="transaction-lifecycle"><h3>{ledgerT("ledgerText.transactionLifecycle")}</h3>{visibleSelected.events.map((event, index) => <article key={event.id}><i /><div><strong>{event.type} · {event.status}</strong><span>{new Date(event.authTime).toLocaleString(ledgerI18n.language === "en" ? "en-US" : "zh-CN")}</span><p>{money(event.type === "Settlement" || event.type === "Refund" ? event.settleAmount : event.authAmount, event.type === "Settlement" || event.type === "Refund" ? event.settleCurrency : event.authCurrency)}{event.failedReason ? ` · ${event.failedReason}` : ""}</p><small>{ledgerT("ledgerText.eventNumber", { number: index + 1 })} · {event.source || "webhook"}{event.channel ? ` / ${event.channel}` : ""}</small></div></article>)}</section>
        </>}
      </Dialog.Content></Dialog.Portal>
    </Dialog.Root>
  </PageShell>;
}
