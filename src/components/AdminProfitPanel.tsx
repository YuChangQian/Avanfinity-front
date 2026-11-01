import adminI18n, { t as adminT } from "i18next";
import { useTranslation } from "react-i18next";
import { Notice, NoticeScope } from "./ui/notice";
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

const kinds: Record<string, string> = { get CARD_FEE() { return adminT("adminText.cardFees"); }, get OPEN_CARD() { return adminT("adminText.openCard"); }, get RECHARGE() { return adminT("adminText.cardTopUpLabel"); }, get REFUND() { return adminT("adminText.refund"); }, get DELETE() { return adminT("adminText.cardClosureRefund"); }, get GPT_DIRECT() { return adminT("adminText.gptDirect"); }, GPT_CDK: "CDK", get FUNDING_FEE() { return adminT("adminText.upstreamFundingFee"); }, get DEPOSIT_FEE() { return adminT("adminText.customerDepositFee"); }, get TRANSFER_FEE() { return adminT("adminText.transferFee"); }, get REWARD() { return adminT("adminText.referralRewards"); }, get SUBSIDY() { return adminT("adminText.businessSubsidy"); }, get UPSTREAM() { return adminT("adminText.upstreamEntries"); }, get WALLET() { return adminT("adminText.otherWalletEntries"); } };
const statuses: Record<string, string> = { get confirmed() { return adminT("adminText.verified"); }, get pending() { return adminT("adminText.awaitingVerification"); }, get excluded() { return adminT("adminText.excludedFromProfit"); } };
function monthFilters(): ProfitFilters {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return { start: `${today.slice(0, 7)}-01`, end: today };
}
function usd(value: string | null) { return value === null ? "—" : `$${formatDecimal(value)}`; }
function errorText(error: unknown) { return error instanceof Error ? error.message : adminT("adminText.operationFailedPleaseRetry"); }
const feeKinds: Record<string, string> = { get DECLINE_FEE() { return adminT("adminText.declinedTransactionFee"); }, get REVERSAL_FEE() { return adminT("adminText.transactionReversalFee"); }, get REFUND_COST() { return adminT("adminText.transactionRefundFee"); }, get AUTHORIZATION_FEE() { return adminT("adminText.transactionAuthorizationFee"); }, get LOW_AUTH_FEE() { return adminT("adminText.lowValueAuthorizationFee"); }, get DECLINE_RATE_FEE() { return adminT("adminText.declineRateSurcharge"); } };
type FeeCharge = { chargeId: number; kind: string; userEmail: string; cardId: number; cardLast4: string | null; transactionId: number | null; merchantName: string | null; transactionAmount: string | null; transactionCurrency: string | null; transactionTime: string | null; costSources: { sourceKey: string; allocatedAmount: string }[] };
function feeCharges(item: ProfitItem): FeeCharge[] { return Array.isArray(item.evidence.feeCharges) ? item.evidence.feeCharges as FeeCharge[] : []; }
function itemKind(item: ProfitItem) { return item.kind === "CARD_FEE" && feeCharges(item).length ? [...new Set(feeCharges(item).map(f => feeKinds[f.kind] ?? f.kind))].join("、") : kinds[item.kind] ?? item.kind; }
function FeeSources({ item }: { item: ProfitItem }) {
  useTranslation();
  return <>{feeCharges(item).map(f => <div key={f.chargeId}>
    <small>{f.userEmail}</small>
    <small>{item.userId ? <a href={adminCustomerReturnPath(item.userId, f.cardId)}>{adminT("adminText.card")}{f.cardId} {adminT("adminText.lastFour")}{f.cardLast4 ?? adminT("adminText.notRecorded")}</a> : adminT("adminText.cardLabel", { cardId: f.cardId })}</small>
    <small>{f.merchantName ?? adminT("adminText.merchantNotRecorded")}{f.transactionAmount && ` · ${f.transactionCurrency ?? ""} ${formatDecimal(f.transactionAmount)}`}</small>
    {f.transactionTime && <small>{new Date(f.transactionTime).toLocaleString(adminI18n.language === "en" ? "en-US" : "zh-CN", { timeZone: "Asia/Shanghai" })}{adminT("adminText.beijingTime")}</small>}
    <small>{adminT("adminText.chargeRecord")}{f.chargeId}{f.transactionId && adminT("adminText.transaction", { transactionId: f.transactionId })}</small>
    {(f.costSources ?? []).length ? f.costSources.map(c => <small key={c.sourceKey}>{adminT("adminText.costEvidence")}{c.sourceKey} {adminT("adminText.allocated")}{usd(c.allocatedAmount)}{adminT("adminText.listedSeparately")}</small>) : <small>{adminT("adminText.actualUpstreamChargesHaveNotBeenLinked")}</small>}
  </div>)}</>;
}

export function AdminProfitPanel({ token }: { token: string }) {
  useTranslation();
  const [filters, setFilters] = useState<ProfitFilters>(monthFilters);
  const [draft, setDraft] = useState(filters);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<ProfitItem | null>(null);
  const [classification, setClassification] = useState("unresolved");
  const [operationId, setOperationId] = useState("");
  const [note, setNote] = useState("");
  const [flash, setFlash] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const connections = useQuery({ queryKey: ["profit-connections"], queryFn: () => getProfitConnections(token) });
  const report = useQuery({ queryKey: ["profit-report", filters], queryFn: () => createProfitReport(token, filters), retry: false, staleTime: Infinity, refetchOnWindowFocus: false });
  const id = report.data?.data.id;
  const rows = useQuery({ queryKey: ["profit-items", id, page], queryFn: () => getProfitReport(token, id!, page), enabled: Boolean(id), staleTime: Infinity });
  const summary = report.data?.data.summary;
  const download = useMutation({ mutationFn: async () => {
    const blob = await exportProfitReport(token, id!);
    const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
    anchor.href = url; anchor.download = adminT("adminText.actualProfitCsv", { startDate: filters.start ?? adminT("adminText.allTime"), endDate: filters.end ?? adminT("adminText.all"), reportId: id }); anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, onError: (e) => setFlash({ kind: "error", text: errorText(e) }) });
  const review = useMutation({ mutationFn: () => reviewProfitEvidence(token, { sourceKey: selected!.key, fingerprint: selected!.fingerprint, classification, operationId: classification === "operation_cost" ? operationId : undefined, note }),
    onSuccess: () => { setSelected(null); setFlash({ kind: "success", text: adminT("adminText.reviewSavedRegeneratingTheReportPreviousExports") }); setPage(1); void report.refetch(); }, onError: (e) => setFlash({ kind: "error", text: errorText(e) }) });

  function submitFilters(event: FormEvent) { event.preventDefault(); setPage(1); setFilters({ ...draft }); }
  function inspect(item: ProfitItem) { setSelected(item); setClassification("unresolved"); setOperationId(typeof item.evidence.suggestedOperationId === "string" ? item.evidence.suggestedOperationId : ""); setNote(""); }
  return <div className="admin-panel-stack profit-panel" data-testid="admin-profit">
    <div className="admin-section-heading"><div><span className="admin-kicker">ACTUAL PROFIT</span><h2>{adminT("adminText.profitAndReconciliation")}</h2><p>{adminT("adminText.actualPlatformChargesMinusActualUpstreamCharges")}</p></div>
      <Button onClick={() => { setPage(1); void report.refetch(); }} disabled={report.isFetching}><RefreshCw />{report.isFetching ? adminT("adminText.calculating") : adminT("adminText.regenerateReport")}</Button></div>
    {flash && <Notice className={`admin-alert ${flash.kind === "error" ? "is-error" : "is-success"}`} role={flash.kind === "error" ? "alert" : "status"}>{flash.text}</Notice>}
    <form className="admin-surface profit-filters" onSubmit={submitFilters}>
      <label>{adminT("adminText.startDateBeijingTime")}<input type="date" value={draft.start ?? ""} onChange={e => setDraft({ ...draft, start: e.target.value || undefined })} /></label>
      <label>{adminT("adminText.endDate")}<input type="date" value={draft.end ?? ""} onChange={e => setDraft({ ...draft, end: e.target.value || undefined })} /></label>
      <label>{adminT("adminText.business")}<select value={draft.kind ?? ""} onChange={e => setDraft({ ...draft, kind: e.target.value || undefined })}><option value="">{adminT("adminText.allBusinessTypes")}</option>{Object.entries(kinds).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>{adminT("adminText.upstream")}<select value={draft.provider ?? ""} onChange={e => setDraft({ ...draft, provider: e.target.value ? Number(e.target.value) : undefined })}><option value="">{adminT("adminText.entirePlatformIncludingSharedCosts")}</option>{connections.data?.data.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label>{adminT("adminText.reviewStatus")}<select value={draft.status ?? ""} onChange={e => setDraft({ ...draft, status: e.target.value || undefined })}><option value="">{adminT("adminText.allStatuses")}</option>{Object.entries(statuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <Button type="submit">{adminT("adminText.search")}</Button><Button type="button" variant="outline" onClick={() => { setDraft({}); setFilters({}); setPage(1); }}>{adminT("adminText.allTime")}</Button>
    </form>
    {report.isError && <Notice role="alert" className="admin-alert is-error">{errorText(report.error)}</Notice>}
    {report.isLoading && <p aria-busy="true">{adminT("adminText.verifyingFinancialEvidence")}</p>}
    {summary && <>
      <section className="admin-metric-grid profit-metrics" aria-label={adminT("adminText.actualProfitSummary")}>
        <article className="profit-total"><span>{adminT("adminText.netBusinessProfit02FundingFee")}</span><strong className={summary.netProfit.startsWith("-") ? "negative" : "positive"}>{usd(summary.netProfit)}</strong><small>{adminT("adminText.basedOnPostedEntriesSeeNotesBelow")}</small></article>
        {([[adminT("adminText.actualIncomeAfterRefunds"), summary.revenue], [adminT("adminText.actualBusinessCostAfterReturns"), summary.cost], [adminT("adminText.fundingFeeFixed02"), summary.fundingFee], [adminT("adminText.actualReferralRewards"), summary.reward], [adminT("adminText.actualBusinessSubsidies"), summary.subsidy]] as const).map(([label, value]) => <article key={label}><span>{label}</span><strong>{usd(value)}</strong></article>)}
      </section>
      <section className="admin-surface profit-notes"><p>{adminT("adminText.businessMargin")}{usd(summary.grossProfit ?? summary.netProfit)} {adminT("adminText.pendingBusinessEntries")}{summary.pendingBusinessCount ?? summary.pendingCount} {adminT("adminText.unassignedEntries")}{summary.unassignedCount ?? 0} {adminT("adminText.items")}</p>
        <p>{adminT("adminText.netProfitActualPlatformChargesIncludingExtra")}</p>
        <p>{adminT("adminText.fundingFeesAreCalculatedAsTheAmount")}</p>
        {summary.pendingCount > 0 && <p>{adminT("adminText.pendingAndUnassignedEntriesAreExcludedFrom")}</p>}
        {summary.warnings.map(w => <Notice role="note" className="admin-alert is-warning" key={w}>{w}</Notice>)}
        <small>{adminT("adminText.reportGenerated")}{new Date(report.data!.data.generatedAt).toLocaleString(adminI18n.language === "en" ? "en-US" : "zh-CN", { timeZone: "Asia/Shanghai" })}{adminT("adminText.beijingTimeAmountsRetainTheirOriginalPrecision")}</small>
      </section>
    </>}
    <section className="admin-surface">
      <div className="admin-section-heading"><h3>{adminT("adminText.incomeExpensesAndEvidence")}</h3><Button variant="outline" disabled={!id || download.isPending} onClick={() => download.mutate()}><Download />{adminT("adminText.exportCurrentReportCsv")}</Button></div>
      {rows.isError && <Notice role="alert" className="error">{errorText(rows.error)}</Notice>}
      <div className="admin-table-wrap profit-table"><table><thead><tr><th>{adminT("adminText.businessDate")}</th><th>{adminT("adminText.businessSource")}</th><th>{adminT("adminText.userCardTransaction")}</th><th>{adminT("adminText.reviewStatus")}</th><th>{adminT("adminText.income")}</th><th>{adminT("adminText.actualCost")}</th><th>{adminT("adminText.fundingFeeRewardsSubsidies")}</th><th>{adminT("adminText.profit")}</th><th>{adminT("adminText.evidence")}</th></tr></thead><tbody>
        {rows.data?.data.list.map(item => <tr key={item.key}><td>{item.businessDate}</td><td>{itemKind(item)}<small>{item.key}</small>{item.operationId && <small>{adminT("adminText.operation")}{item.operationId}</small>}</td><td>{item.userId ? <a href={adminCustomerReturnPath(item.userId)}>{adminT("adminText.user")}{item.userId}</a> : "—"}<FeeSources item={item} /></td><td><span className={`status-pill ${item.status === "confirmed" ? "is-active" : ""}`}>{item.kind === "CARD_FEE" && item.status === "confirmed" ? adminT("adminText.feeCollected") : statuses[item.status]}</span><small>{item.reason}</small></td>
          <td>{usd(item.revenue)}</td><td>{item.kind === "CARD_FEE" ? adminT("adminText.costListedSeparately") : usd(item.cost)}</td><td>{usd(item.fundingFee)} / {usd(item.reward)} / {usd(item.subsidy)}</td><td className={item.profit?.startsWith("-") ? "negative" : ""}>{item.kind === "CARD_FEE" ? "—" : usd(item.profit)}{item.kind === "CARD_FEE" && <small>{adminT("adminText.incomeEntryDoesNotRepresentPerTransaction")}</small>}</td><td><Button size="sm" variant="outline" onClick={() => inspect(item)}>{adminT("adminText.viewEvidence")}</Button></td></tr>)}
      </tbody></table></div>
      {rows.data?.data.total === 0 && <p>{adminT("adminText.noEntriesMatchTheSelectedFilters")}</p>}
      <div className="profit-pagination"><Button variant="outline" disabled={page <= 1 || rows.isFetching} onClick={() => setPage(page - 1)}>{adminT("adminText.previousPage")}</Button><span>{adminT("adminText.pageSummary", { page, total: rows.data?.data.total ?? 0 })}</span><Button variant="outline" disabled={!rows.data || page * 50 >= rows.data.data.total || rows.isFetching} onClick={() => setPage(page + 1)}>{adminT("adminText.nextPage")}</Button></div>
    </section>
    <Dialog.Root open={selected !== null} onOpenChange={open => { if (!open) setSelected(null); }}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog-content profit-detail"><NoticeScope />
      <Dialog.Title>{adminT("adminText.actualFinancialEvidence")}</Dialog.Title><Dialog.Description>{adminT("adminText.reviewTheSourceActualAmountsAndLinked")}</Dialog.Description><Dialog.Close asChild><Button variant="ghost" aria-label={adminT("adminText.closeEvidence")} className="profit-close"><X /></Button></Dialog.Close>
      {selected && <><p>{itemKind(selected)} · {selected.key} {adminT("adminText.sourceAmount")}{usd(selected.sourceAmount)}</p>{selected.userId && <p><a href={adminCustomerReturnPath(selected.userId)}>{adminT("adminText.user")}{selected.userId}</a></p>}<FeeSources item={selected} /><pre>{JSON.stringify(selected.evidence, null, 2)}</pre>
        {selected.reviewable && <form onSubmit={e => { e.preventDefault(); review.mutate(); }}><label>{adminT("adminText.reviewConclusion")}<select value={classification} onChange={e => setClassification(e.target.value)}><option value="unresolved">{adminT("adminText.keepPendingUndoPreviousManualClassification")}</option>
          {selected.key.startsWith("operation:") ? <option value="settlement_complete">{adminT("adminText.redemptionVerifiedCompleteWithAllActualCost")}</option> : selected.kind === "UPSTREAM" ? <><option value="operation_cost">{adminT("adminText.actualCostsReturnsLinkedToAnOperation")}</option><option value="business_cost">{adminT("adminText.independentPlatformBusinessCostsReturns")}</option></> : <><option value="business_income">{adminT("adminText.verifiedBusinessIncomeActualWalletDebits")}</option><option value="subsidy">{adminT("adminText.businessSubsidiesActuallyPaid")}</option></>}
          {!selected.key.startsWith("operation:") && <option value="non_business">{adminT("adminText.verifiedAsUnrelatedToPlatformProfit")}</option>}</select></label>
          {classification === "operation_cost" && <label>{adminT("adminText.platformOperationIdUuid")}<input required value={operationId} onChange={e => setOperationId(e.target.value)} placeholder="money operation ID" /></label>}
          <label>{adminT("adminText.supportingEvidenceAndReviewNotes")}<textarea required minLength={10} maxLength={1000} value={note} onChange={e => setNote(e.target.value)} placeholder={adminT("adminText.describeVerifiedOrdersInvoicesOrPaymentEvidence")} /></label>
          {review.isError && <Notice role="alert" className="error">{errorText(review.error)}</Notice>}<Button type="submit" disabled={review.isPending}>{adminT("adminText.saveReview")}</Button></form>}
      </>}
    </Dialog.Content></Dialog.Portal></Dialog.Root>
  </div>;
}
