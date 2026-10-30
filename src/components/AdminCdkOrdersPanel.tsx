import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getAdminCdkOrders, getAdminCdkOrder } from "../api";
import { formatDecimal } from "../decimal";
import { AdminGptOrderDetail } from "./AdminGptOrderDetail";
import { Button } from "./ui/button";

export function AdminCdkOrdersPanel({ token, onOpenCustomer, onOpenCard }: { token: string; onOpenCustomer: (userId: number, email: string | null) => void; onOpenCard: (userId: number, cardId: number) => void }) {
  const { t, i18n } = useTranslation();
  const en = i18n.language === "en";
  const [query, setQuery] = useState({ page: 1, q: new URLSearchParams(window.location.search).get("q") ?? "", status: "", plan: "" });
  const [selected, setSelected] = useState<string | null>(null);
  const orders = useQuery({ queryKey: ["admin-cdk-orders", query], queryFn: () => getAdminCdkOrders(token, query), retry: false, refetchInterval: 10000 });
  const detail = useQuery({ queryKey: ["admin-cdk-order", selected], queryFn: () => getAdminCdkOrder(token, selected!), enabled: Boolean(selected), retry: false, refetchInterval: selected ? 10000 : false });
  const state = (value: string) => t(`gptOrderStatus.${value}`, { defaultValue: value });
  const date = (value: string) => new Date(value).toLocaleString(en ? "en-US" : "zh-CN");
  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setQuery({ page: 1, q: String(data.get("q")).trim(), status: String(data.get("status")), plan: String(data.get("plan")) });
  }
  return <div className="admin-panel-stack" data-testid="admin-cdk-orders">
    <div className="admin-panel-heading"><div><span className="admin-kicker">GPT DIRECT · CDK</span><h2>{en ? "CDK direct orders" : "CDK 直充订单"}</h2><p>{en ? "The same direct payment flow, with CDK card funding records." : "与普通直充共用支付流程，同时查看 CDK 开卡与补款记录。"}</p></div>
      <form className="admin-filter-bar" onSubmit={filter}>
        <label>{t("search")}<input name="q" defaultValue={query.q} placeholder={en ? "Customer / CDK / order / card last four" : "用户邮箱 / 用户ID / CDK编号 / 订单号 / 卡后四位"} /></label>
        <label>{t("status")}<select name="status"><option value="">{t("allStatuses")}</option>{["previewed", "preflighting", "preflighted", "dispatching", "awaiting_card", "funding_pending", "queued", "running", "pending", "completed", "failed_precharge", "declined", "cancelled"].map(s => <option key={s} value={s}>{state(s)}</option>)}</select></label>
        <label>{t("gptPlanLabel")}<select name="plan"><option value="">{t("allPlans")}</option>{["go", "plus", "pro_5x", "pro_20x", "pro_25x"].map(p => <option key={p} value={p}>{t(`gptPlan.${p}`)}</option>)}</select></label>
        <Button type="submit" size="sm">{t("filter")}</Button>
        <Button type="button" size="sm" variant="outline" onClick={() => void orders.refetch()}>{en ? "Refresh" : "刷新"}</Button>
      </form>
    </div>
    <section className="admin-surface"><div className="admin-section-heading"><div><span className="admin-kicker">ORDERS</span><h3>{t("gptOrderHistory")}</h3></div><Sparkles /></div>
    {orders.isLoading && <p>{t("loading")}</p>}
    {orders.isError && <p className="admin-state is-error" role="alert">{t("adminLoadFailed")}</p>}
    {orders.data?.data.total === 0 && <p>{t("gptNoOrders")}</p>}
    <div className="admin-table-wrap"><table className="admin-table"><thead><tr>
      <th>{t("customer")}</th><th>{t("gptPlanLabel")}</th><th>{t("status")}</th><th>{t("gptOrderProgress")}</th><th>{t("amount")}</th><th>{t("targetCard")}</th><th>{t("createdTime")}</th><th>{t("details")}</th>
    </tr></thead><tbody>{orders.data?.data.list.map(order => <tr key={order.id}>
      <td><button type="button" className="admin-customer-inviter" onClick={() => order.userId && onOpenCustomer(order.userId, order.email)}><span>{order.email ?? `#${order.userId}`}</span><ArrowRight /></button><small>#{order.userId} · {order.maskedEmail}</small></td>
      <td><strong>{t(`gptPlan.${order.plan}`)}</strong><small>CDK #{order.cdkId}</small><small>{t("adminGptCheckoutBranch")}: {order.checkoutBranch || t("adminGptNotRecorded")}</small><small>{order.id.slice(0, 8)}</small></td>
      <td><span className={`status-pill ${order.status === "completed" ? "is-active" : ""}`}>{state(order.status)}</span><small>{order.operationStatus}</small></td><td><strong>{t(`gptOrderStage.${order.stage?.split(":")[0]}`, { defaultValue: order.stage ?? "—" })}</strong></td><td>{order.quotedAmountMinor != null ? `${order.currency ?? ""} ${formatDecimal((order.quotedAmountMinor / 100).toFixed(2))}` : "—"}</td>
      <td>{order.cardLastFour ? `•••• ${order.cardLastFour}` : "—"}</td><td>{date(order.createdAt)}</td>
      <td><Button size="xs" variant="outline" onClick={() => setSelected(order.id)}>{t("details")}</Button></td>
    </tr>)}</tbody></table></div>
    {orders.data && <div className="admin-pagination"><span>{t("totalItems", { count: orders.data.data.total })}</span><div>
      <Button size="xs" variant="outline" disabled={query.page <= 1} onClick={() => setQuery(q => ({ ...q, page: q.page-1 }))}>{t("previousPage")}</Button>
      <span>{query.page}</span><Button size="xs" variant="outline" disabled={query.page*50 >= orders.data.data.total} onClick={() => setQuery(q => ({ ...q, page: q.page+1 }))}>{t("nextPage")}</Button>
    </div></div>}
    </section>
    <AdminGptOrderDetail selectedId={selected} order={detail.data?.data.order} events={detail.data?.data.events}
      title={en ? "CDK direct order details" : "CDK 直充订单详情"} isLoading={detail.isLoading} isError={detail.isError}
      onRetry={() => detail.refetch()} onClose={() => setSelected(null)} onOpenCustomer={onOpenCustomer} onOpenCard={onOpenCard}>
      {detail.data && <>
        <section className="admin-drawer-section">
          <header><span>FUNDING</span><h3>{en ? "Funding calculation" : "补款计算依据"}</h3></header>
          {detail.data.data.order.fundingQuote ? <dl className="admin-drawer-facts">
            <div className="is-emphasis"><dt>{en ? "Quote in USD" : "本次报价折美元"}</dt><dd>${formatDecimal(detail.data.data.order.fundingQuote.amountUsd)}</dd></div>
            <div className="is-emphasis"><dt>{en ? "Safety buffer" : "安全余量"}</dt><dd>${formatDecimal(detail.data.data.order.fundingQuote.bufferUsd)}</dd></div>
            <div className="is-emphasis"><dt>{en ? "Required balance" : "所需卡片余额"}</dt><dd>${formatDecimal(detail.data.data.order.fundingQuote.requiredUsd)}</dd></div>
            <div><dt>{en ? "FX rate" : "美元换算汇率"}</dt><dd>{detail.data.data.order.fundingQuote.usdPerUnit}</dd></div>
          </dl> : <p className="admin-drawer-note">{en ? "No calculation snapshot was saved for this historical attempt." : "此历史订单未保存补款计算快照，不能精确还原当时依据。"}</p>}
        </section>
        <section className="admin-drawer-section">
          <header><span>TOP-UPS</span><h3>{en ? "Linked card top-ups" : "已关联的卡片补款记录"}</h3></header>
          <p className="admin-drawer-note">{en ? "Older retries may have no retained funding association. This list is not a complete card ledger." : "旧版重新兑换可能未保留补款关联；此列表不代表卡片全部资金流水。"}</p>
          <div className="admin-drawer-funding-list">
            {detail.data.data.funding.map(f => <article key={f.id}>
              <strong>{en ? "Card" : "卡片"} #{f.cardId} · ${formatDecimal(f.amountUsd)} · {f.status}</strong>
              <p>{en ? "Balance before / after" : "补款前 / 补款后余额"}: {f.balanceBeforeUsd ?? "—"} / {f.balanceAfterUsd ?? "—"}</p>
              <small>{date(f.createdAt)} · {f.id}</small>
            </article>)}
          </div>
        </section>
      </>}
    </AdminGptOrderDetail>
  </div>;
}
