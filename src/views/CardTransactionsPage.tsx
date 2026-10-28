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
  PENDING: "待处理", SETTLED: "清算成功", DECLINED: "失败", REFUNDED: "已退款",
  PARTIALLY_REFUNDED: "部分退款", REVERSED: "已撤销",
};

function money(amount: string | null, currency: string | null) {
  if (amount === null) return "—";
  return `${currency || "USD"} ${formatDecimal(amount)}`;
}

export function CardTransactionsPage() {
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

  return <PageShell eyebrow="CARD LEDGER" title="卡消费记录" description="查看全部卡片的消费、清算、退款与撤销；已销卡历史也会永久保留。" className="card-spending-page">
    <form className="card-spending-filters" onSubmit={submit}>
      <label className="card-spending-search"><span>商户或交易 ID</span><div><Search /><input value={draft.q} onChange={(event) => setDraft({ ...draft, q: event.target.value })} placeholder="搜索商户、说明或交易 ID" /></div></label>
      <label><span>交易状态</span><select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}><option value="">全部</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label><span>卡片状态</span><select value={draft.cardStatus} onChange={(event) => setDraft({ ...draft, cardStatus: event.target.value })}><option value="">全部</option><option value="ACTIVE">使用中</option><option value="FROZEN">已冻结</option><option value="DELETED">已销卡</option></select></label>
      <label><span>开始日期</span><input type="date" value={draft.from} onChange={(event) => setDraft({ ...draft, from: event.target.value })} /></label>
      <label><span>结束日期</span><input type="date" value={draft.to} onChange={(event) => setDraft({ ...draft, to: event.target.value })} /></label>
      <div className="card-spending-filter-actions"><Button type="submit"><Search />查询</Button><Button type="button" variant="outline" onClick={reset}>重置</Button></div>
    </form>

    <section className="transaction-panel card-spending-table-panel">
      <div className="section-title"><div><h2>全部消费</h2><p>每个授权交易聚合为一行，点击可查看完整生命周期。</p></div><span>{data ? `${data.total} 条` : <DataSkeleton />}</span></div>
      {query.isError && <div className="error" role="alert">{query.error instanceof Error ? query.error.message : "消费记录加载失败"}</div>}
      {query.isPending && <div className="table-scroll" aria-busy="true"><table className="data-table card-spending-table"><thead><tr><th>时间</th><th>卡片</th><th>商户</th><th>状态</th><th>原币金额</th><th>结算金额</th><th>位置</th><th>失败原因</th><th>交易 ID</th></tr></thead><tbody>{[0, 1, 2, 3].map((row) => <tr key={row}>{Array.from({ length: 9 }, (_, cell) => <td key={cell}><DataSkeleton /></td>)}</tr>)}</tbody></table></div>}
      {data && data.list.length === 0 && <div className="empty-state">没有符合条件的卡消费记录</div>}
      {data && data.list.length > 0 && <div className="table-scroll"><table className="data-table card-spending-table">
        <thead><tr><th>时间</th><th>卡片</th><th>商户</th><th>状态</th><th>原币金额</th><th>结算金额</th><th>位置</th><th>失败原因</th><th>交易 ID</th></tr></thead>
        <tbody>{data.list.map((item) => <tr key={`${item.providerId}-${item.cardId}-${item.authId}`} onClick={() => setSelected(item)} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") setSelected(item); }}>
          <td>{new Date(item.occurredAt).toLocaleString()}</td>
          <td><Link to="/cards/$cardId" params={{ cardId: String(item.cardId) }} onClick={(event) => event.stopPropagation()}>{item.cardNumberMasked}</Link>{item.cardStatus === "DELETED" && <small className="archived-label">已销卡</small>}</td>
          <td><strong>{item.merchantName || item.description || "未知商户"}</strong><small>{item.billStatus || item.channel || "—"}</small></td>
          <td><span className={`status-pill card-transaction-status is-${item.status.toLowerCase()}`}>{statusLabels[item.status] || item.status}</span></td>
          <td>{money(item.merchantAmount || item.authorizedAmount, item.merchantCurrency || item.authCurrency)}</td>
          <td>{money(item.settledAmount, item.settleCurrency)}</td>
          <td>{[item.merchantLocation, item.merchantRegion, item.merchantCountry].filter(Boolean).join(" · ") || "—"}</td>
          <td>{item.failedReason || "—"}</td><td><code>{item.authId}</code></td>
        </tr>)}</tbody>
      </table></div>}
      {data && data.total > data.pageSize && <div className="card-spending-pagination"><Button variant="outline" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}><ChevronLeft />上一页</Button><span>第 {page} / {Math.ceil(data.total / data.pageSize)} 页</span><Button variant="outline" disabled={page * data.pageSize >= data.total} onClick={() => setPage((value) => value + 1)}>下一页<ChevronRight /></Button></div>}
    </section>

    <Dialog.Root open={Boolean(visibleSelected)} onOpenChange={(open) => !open && setSelected(null)}>
      <Dialog.Portal><div className="dialog-overlay" data-state={visibleSelected ? "open" : "closed"} aria-hidden="true" onClick={() => setSelected(null)} onWheel={(event) => event.preventDefault()} onTouchMove={(event) => event.preventDefault()} /><Dialog.Content className="dialog-content card-transaction-drawer">
        <div className="card-transaction-drawer-head"><div><span><ReceiptText /></span><div><Dialog.Title>{visibleSelected?.merchantName || visibleSelected?.description || "交易详情"}</Dialog.Title><Dialog.Description>{visibleSelected?.authId}</Dialog.Description></div></div><Dialog.Close asChild><Button variant="ghost" size="icon" aria-label="关闭"><X /></Button></Dialog.Close></div>
        {visibleSelected && <><dl className="transaction-detail-grid"><div><dt>卡片</dt><dd>{visibleSelected.cardNumberMasked}</dd></div><div><dt>终态</dt><dd>{statusLabels[visibleSelected.status] || visibleSelected.status}</dd></div><div><dt>授权金额</dt><dd>{money(visibleSelected.authorizedAmount, visibleSelected.authCurrency)}</dd></div><div><dt>结算金额</dt><dd>{money(visibleSelected.settledAmount, visibleSelected.settleCurrency)}</dd></div><div><dt>退款金额</dt><dd>{money(visibleSelected.refundedAmount, visibleSelected.settleCurrency)}</dd></div><div><dt>位置</dt><dd>{[visibleSelected.merchantLocation, visibleSelected.merchantRegion, visibleSelected.merchantCountry].filter(Boolean).join(" · ") || "—"}</dd></div></dl>
          <section className="transaction-lifecycle"><h3>交易生命周期</h3>{visibleSelected.events.map((event, index) => <article key={event.id}><i /><div><strong>{event.type} · {event.status}</strong><span>{new Date(event.authTime).toLocaleString()}</span><p>{money(event.type === "Settlement" || event.type === "Refund" ? event.settleAmount : event.authAmount, event.type === "Settlement" || event.type === "Refund" ? event.settleCurrency : event.authCurrency)}{event.failedReason ? ` · ${event.failedReason}` : ""}</p><small>事件 {index + 1} · {event.source || "webhook"}{event.channel ? ` / ${event.channel}` : ""}</small></div></article>)}</section>
        </>}
      </Dialog.Content></Dialog.Portal>
    </Dialog.Root>
  </PageShell>;
}
