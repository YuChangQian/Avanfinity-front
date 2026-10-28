import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Dialog } from "radix-ui";
import { Download, RefreshCw, X } from "lucide-react";
import { Button } from "./ui/button";
import { formatDecimal } from "../decimal";
import { adminCustomerReturnPath } from "../adminCustomerReturnPath";
import { createProfitReport, exportProfitReport, getProfitConnections, getProfitReport, reviewProfitEvidence,
  type ProfitFilters, type ProfitItem } from "../api";
import "./AdminProfitPanel.css";

const kinds: Record<string, string> = { CARD_FEE: "卡片手续费", OPEN_CARD: "开卡", RECHARGE: "卡充值", REFUND: "退款", DELETE: "删卡退款", GPT_DIRECT: "GPT 直充", GPT_CDK: "CDK", FUNDING_FEE: "上游充值费", DEPOSIT_FEE: "客户充值费", TRANSFER_FEE: "转账手续费", REWARD: "返佣奖励", SUBSIDY: "业务补贴", UPSTREAM: "上游流水", WALLET: "其他钱包收支" };
const statuses: Record<string, string> = { confirmed: "已核实", pending: "待核实", excluded: "不计损益" };
function monthFilters(): ProfitFilters {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return { start: `${today.slice(0, 7)}-01`, end: today };
}
function usd(value: string | null) { return value === null ? "—" : `$${formatDecimal(value)}`; }
function errorText(error: unknown) { return error instanceof Error ? error.message : "操作失败，请重试"; }
const feeKinds: Record<string, string> = { DECLINE_FEE: "交易拒付手续费", REVERSAL_FEE: "交易撤销手续费", REFUND_COST: "交易退款手续费", AUTHORIZATION_FEE: "交易授权手续费", LOW_AUTH_FEE: "低额授权手续费", DECLINE_RATE_FEE: "拒付率附加费" };
type FeeCharge = { chargeId: number; kind: string; userEmail: string; cardId: number; cardLast4: string | null; transactionId: number | null; merchantName: string | null; transactionAmount: string | null; transactionCurrency: string | null; transactionTime: string | null; costSources: { sourceKey: string; allocatedAmount: string }[] };
function feeCharges(item: ProfitItem): FeeCharge[] { return Array.isArray(item.evidence.feeCharges) ? item.evidence.feeCharges as FeeCharge[] : []; }
function itemKind(item: ProfitItem) { return item.kind === "CARD_FEE" && feeCharges(item).length ? [...new Set(feeCharges(item).map(f => feeKinds[f.kind] ?? f.kind))].join("、") : kinds[item.kind] ?? item.kind; }
function FeeSources({ item }: { item: ProfitItem }) {
  return <>{feeCharges(item).map(f => <div key={f.chargeId}>
    <small>{f.userEmail}</small>
    <small>{item.userId ? <a href={adminCustomerReturnPath(item.userId, f.cardId)}>卡片 #{f.cardId} · 尾号 {f.cardLast4 ?? "未记录"}</a> : `卡片 #${f.cardId}`}</small>
    <small>{f.merchantName ?? "商户未记录"}{f.transactionAmount && ` · ${f.transactionCurrency ?? ""} ${formatDecimal(f.transactionAmount)}`}</small>
    {f.transactionTime && <small>{new Date(f.transactionTime).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}（北京时间）</small>}
    <small>收费记录 #{f.chargeId}{f.transactionId && ` · 交易 #${f.transactionId}`}</small>
    {(f.costSources ?? []).length ? f.costSources.map(c => <small key={c.sourceKey}>成本凭证 {c.sourceKey} · 已分摊 {usd(c.allocatedAmount)}（另列）</small>) : <small>尚未关联上游实际扣费，不能据此认定零成本</small>}
  </div>)}</>;
}

export function AdminProfitPanel({ token }: { token: string }) {
  const [filters, setFilters] = useState<ProfitFilters>(monthFilters);
  const [draft, setDraft] = useState(filters);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<ProfitItem | null>(null);
  const [classification, setClassification] = useState("unresolved");
  const [operationId, setOperationId] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const connections = useQuery({ queryKey: ["profit-connections"], queryFn: () => getProfitConnections(token) });
  const report = useQuery({ queryKey: ["profit-report", filters], queryFn: () => createProfitReport(token, filters), retry: false, staleTime: Infinity, refetchOnWindowFocus: false });
  const id = report.data?.data.id;
  const rows = useQuery({ queryKey: ["profit-items", id, page], queryFn: () => getProfitReport(token, id!, page), enabled: Boolean(id), staleTime: Infinity });
  const summary = report.data?.data.summary;
  const download = useMutation({ mutationFn: async () => {
    const blob = await exportProfitReport(token, id!);
    const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `真实利润-${filters.start ?? "累计"}-${filters.end ?? "全部"}-${id}.csv`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, onError: (e) => setMessage(errorText(e)) });
  const review = useMutation({ mutationFn: () => reviewProfitEvidence(token, { sourceKey: selected!.key, fingerprint: selected!.fingerprint, classification, operationId: classification === "operation_cost" ? operationId : undefined, note }),
    onSuccess: () => { setSelected(null); setMessage("核对记录已保存。正在重新生成报表，旧导出仍保留原数据。"); setPage(1); void report.refetch(); }, onError: (e) => setMessage(errorText(e)) });

  function submitFilters(event: FormEvent) { event.preventDefault(); setPage(1); setFilters({ ...draft }); }
  function inspect(item: ProfitItem) { setSelected(item); setClassification("unresolved"); setOperationId(typeof item.evidence.suggestedOperationId === "string" ? item.evidence.suggestedOperationId : ""); setNote(""); }
  return <div className="admin-panel-stack profit-panel" data-testid="admin-profit">
    <div className="admin-section-heading"><div><span className="admin-kicker">ACTUAL PROFIT</span><h2>收益与对账</h2><p>本站实际扣款减去上游实际扣款，退款与返款自动抵扣。无需网页登录 Token。</p></div>
      <Button onClick={() => { setPage(1); void report.refetch(); }} disabled={report.isFetching}><RefreshCw />{report.isFetching ? "正在核算" : "重新生成报表"}</Button></div>
    {message && <p className="admin-alert" role="status">{message}</p>}
    <form className="admin-surface profit-filters" onSubmit={submitFilters}>
      <label>开始日期（北京时间）<input type="date" value={draft.start ?? ""} onChange={e => setDraft({ ...draft, start: e.target.value || undefined })} /></label>
      <label>结束日期<input type="date" value={draft.end ?? ""} onChange={e => setDraft({ ...draft, end: e.target.value || undefined })} /></label>
      <label>业务<select value={draft.kind ?? ""} onChange={e => setDraft({ ...draft, kind: e.target.value || undefined })}><option value="">全部业务</option>{Object.entries(kinds).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>上游<select value={draft.provider ?? ""} onChange={e => setDraft({ ...draft, provider: e.target.value ? Number(e.target.value) : undefined })}><option value="">全站（含公共费用）</option>{connections.data?.data.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label>核对状态<select value={draft.status ?? ""} onChange={e => setDraft({ ...draft, status: e.target.value || undefined })}><option value="">全部状态</option>{Object.entries(statuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <Button type="submit">查询</Button><Button type="button" variant="outline" onClick={() => { setDraft({}); setFilters({}); setPage(1); }}>累计</Button>
    </form>
    {report.isError && <p role="alert" className="admin-alert is-error">{errorText(report.error)}</p>}
    {report.isLoading && <p aria-busy="true">正在核实资金凭证…</p>}
    {summary && <>
      <section className="admin-metric-grid profit-metrics" aria-label="真实利润汇总">
        <article className="profit-total"><span>业务净收益（充值费按 0.2%）</span><strong className={summary.netProfit.startsWith("-") ? "negative" : "positive"}>{usd(summary.netProfit)}</strong><small>按已入账收支核算；待核对成本见下方说明</small></article>
        {([["实际收入（扣退款）", summary.revenue], ["真实业务成本（扣返款）", summary.cost], ["充值手续费（固定 0.2%）", summary.fundingFee], ["实际返佣奖励", summary.reward], ["实际业务补贴", summary.subsidy]] as const).map(([label, value]) => <article key={label}><span>{label}</span><strong>{usd(value)}</strong></article>)}
      </section>
      <section className="admin-surface profit-notes"><p>业务差价：{usd(summary.grossProfit ?? summary.netProfit)} · 待结算业务 {summary.pendingBusinessCount ?? summary.pendingCount} 项 · 未归属收支 {summary.unassignedCount ?? 0} 项</p>
        <p>净收益 = 本站实际扣款（含加收费用、扣退款）− 上游实际扣款（扣返款）− 固定充值费 − 返佣 − 补贴。加收费用已在实际扣款中，不重复累加。</p>
        <p>充值费按上游 API 充值到账额 ÷ 99.8% × 0.2% 计算；属于固定费率口径，不代表逐笔网页账单手续费。客户充值本金不当收入，账户间本金划转不当利润。</p>
        {summary.pendingCount > 0 && <p>待结算和未归属收支尚未计入上述金额，可在明细查看；它们不会阻塞已完成业务的收益展示。</p>}
        {summary.warnings.map(w => <p role="status" className="negative" key={w}>{w}</p>)}
        <small>报表生成时间：{new Date(report.data!.data.generatedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}（北京时间）。金额保留原始精度；更新凭证后回补业务日期。稳定币按本站 USD 记账单位展示，不包含未记录的站外费用。</small>
      </section>
    </>}
    <section className="admin-surface">
      <div className="admin-section-heading"><h3>收支与凭证明细</h3><Button variant="outline" disabled={!id || download.isPending} onClick={() => download.mutate()}><Download />导出当前报表 CSV</Button></div>
      {rows.isError && <p role="alert">{errorText(rows.error)}</p>}
      <div className="admin-table-wrap profit-table"><table><thead><tr><th>业务日期</th><th>业务 / 来源</th><th>用户 / 卡片 / 交易</th><th>核对状态</th><th>收入</th><th>真实成本</th><th>充值费 / 返佣 / 补贴</th><th>利润</th><th>凭证</th></tr></thead><tbody>
        {rows.data?.data.list.map(item => <tr key={item.key}><td>{item.businessDate}</td><td>{itemKind(item)}<small>{item.key}</small>{item.operationId && <small>业务：{item.operationId}</small>}</td><td>{item.userId ? <a href={adminCustomerReturnPath(item.userId)}>用户 #{item.userId}</a> : "—"}<FeeSources item={item} /></td><td><span className={`status-pill ${item.status === "confirmed" ? "is-active" : ""}`}>{item.kind === "CARD_FEE" && item.status === "confirmed" ? "已收手续费" : statuses[item.status]}</span><small>{item.reason}</small></td>
          <td>{usd(item.revenue)}</td><td>{item.kind === "CARD_FEE" ? "成本另列" : usd(item.cost)}</td><td>{usd(item.fundingFee)} / {usd(item.reward)} / {usd(item.subsidy)}</td><td className={item.profit?.startsWith("-") ? "negative" : ""}>{item.kind === "CARD_FEE" ? "—" : usd(item.profit)}{item.kind === "CARD_FEE" && <small>收入行，不代表单笔净利润</small>}</td><td><Button size="sm" variant="outline" onClick={() => inspect(item)}>查看凭证</Button></td></tr>)}
      </tbody></table></div>
      {rows.data?.data.total === 0 && <p>所选条件下没有收支记录。</p>}
      <div className="profit-pagination"><Button variant="outline" disabled={page <= 1 || rows.isFetching} onClick={() => setPage(page - 1)}>上一页</Button><span>第 {page} 页 · 共 {rows.data?.data.total ?? 0} 项</span><Button variant="outline" disabled={!rows.data || page * 50 >= rows.data.data.total || rows.isFetching} onClick={() => setPage(page + 1)}>下一页</Button></div>
    </section>
    <Dialog.Root open={selected !== null} onOpenChange={open => { if (!open) setSelected(null); }}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog-content profit-detail">
      <Dialog.Title>真实资金凭证</Dialog.Title><Dialog.Description>核对来源、实际金额及业务关联。人工归类仅影响报表，不修改客户余额。</Dialog.Description><Dialog.Close asChild><Button variant="ghost" aria-label="关闭凭证" className="profit-close"><X /></Button></Dialog.Close>
      {selected && <><p>{itemKind(selected)} · {selected.key} · 来源金额 {usd(selected.sourceAmount)}</p>{selected.userId && <p><a href={adminCustomerReturnPath(selected.userId)}>用户 #{selected.userId}</a></p>}<FeeSources item={selected} /><pre>{JSON.stringify(selected.evidence, null, 2)}</pre>
        {selected.reviewable && <form onSubmit={e => { e.preventDefault(); review.mutate(); }}><label>核对结论<select value={classification} onChange={e => setClassification(e.target.value)}><option value="unresolved">保持待核实 / 撤销此前人工分类</option>
          {selected.key.startsWith("operation:") ? <option value="settlement_complete">已核实兑换完成且全部实际成本凭证已关联</option> : selected.kind === "UPSTREAM" ? <><option value="operation_cost">关联业务的实际成本 / 返款</option><option value="business_cost">本站独立业务成本 / 返款</option></> : <><option value="business_income">已核实的业务收入（钱包实际扣款）</option><option value="subsidy">实际发放的业务补贴</option></>}
          {!selected.key.startsWith("operation:") && <option value="non_business">已核实为非本站损益</option>}</select></label>
          {classification === "operation_cost" && <label>本站业务编号（UUID）<input required value={operationId} onChange={e => setOperationId(e.target.value)} placeholder="money operation ID" /></label>}
          <label>凭证依据与核对说明<textarea required minLength={10} maxLength={1000} value={note} onChange={e => setNote(e.target.value)} placeholder="填写已核实的订单、账单或付款凭证依据；不要填写密码、卡号或 Token" /></label>
          {review.isError && <p role="alert" className="negative">{errorText(review.error)}</p>}<Button type="submit" disabled={review.isPending}>保存核对记录</Button></form>}
      </>}
    </Dialog.Content></Dialog.Portal></Dialog.Root>
  </div>;
}
