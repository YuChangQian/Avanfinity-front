import { formatDecimal } from "../decimal";
import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CircleStop, Sparkles } from "lucide-react";
import { AdminGptOrderDetail } from "./AdminGptOrderDetail";
import { useTranslation } from "react-i18next";
import { endAdminGptDirectOrder, getAdminGptDirectOrder, getAdminGptDirectOrders } from "../api";
import { Button } from "./ui/button";
import { needsRenewalSession } from "./GptOrderProgress";
import { AdminCdkOrdersPanel } from "./AdminCdkOrdersPanel";

const plans = ["", "go", "plus", "pro_5x", "pro_20x", "pro_25x"] as const;
const statuses = ["", "ready", "queued", "running", "pending", "requires_action", "completed", "failed_precharge", "declined", "cancelled"] as const;

type Props = { token: string; onOpenCustomer: (userId: number, email: string | null) => void; onOpenCard: (userId: number, cardId: number) => void };

export function AdminGptDirectOrdersPanel(props: Props) {
  const { i18n } = useTranslation();
  const [source, setSource] = useState(new URLSearchParams(window.location.search).get("source") === "cdk" ? "cdk" : "direct");
  return <div className="admin-panel-stack"><div className="admin-filter-bar" role="group" aria-label={i18n.language === "en" ? "Order source" : "订单来源"}>
    <Button variant={source === "direct" ? "default" : "outline"} onClick={() => setSource("direct")}>{i18n.language === "en" ? "Direct orders" : "普通直充"}</Button>
    <Button variant={source === "cdk" ? "default" : "outline"} onClick={() => setSource("cdk")}>{i18n.language === "en" ? "CDK orders" : "CDK 直充"}</Button>
  </div>{source === "cdk" ? <AdminCdkOrdersPanel {...props} /> : <DirectOrdersPanel {...props} />}</div>;
}

function DirectOrdersPanel({ token, onOpenCustomer, onOpenCard }: Props) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const locale = i18n.language === "en" ? "en-US" : "zh-CN";
  const [query, setQuery] = useState({ page: 1, q: "", status: "", plan: "" });
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const orders = useQuery({ queryKey: ["admin-gpt-direct-orders", query], queryFn: () => getAdminGptDirectOrders(token, { ...query, pageSize: 50 }), retry: false });
  const orderDetail = useQuery({ queryKey: ["admin-gpt-direct-order", selectedOrderId], queryFn: () => getAdminGptDirectOrder(token, selectedOrderId!), enabled: Boolean(selectedOrderId), retry: false });
  const endOrder = useMutation({
    mutationFn: (id: string) => endAdminGptDirectOrder(token, id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-gpt-direct-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-gpt-direct-order", selectedOrderId] }),
      ]);
    },
  });

  function submitFilter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setQuery({ page: 1, q: String(data.get("q")).trim(), status: String(data.get("status")), plan: String(data.get("plan")) });
  }

  const statusLabel = (status: string) => t(`gptOrderStatus.${status}`, { defaultValue: status });
  const stageLabel = (stage?: string | null) => stage ? t(`gptOrderStage.${stage}`, { defaultValue: stage }) : "";
  const planLabel = (plan?: string | null) => plan === "free" ? "Free" : plan ? t(`gptPlan.${plan}`, { defaultValue: plan }) : t("adminGptNotRecorded");
  const detail = orderDetail.data?.data.order;
  const renewalRecovery = detail && needsRenewalSession(detail, orderDetail.data?.data.events);

  return <div className="admin-panel-stack" data-testid="admin-panel-gptOrders">
    <div className="admin-panel-heading">
      <div><span className="admin-kicker">GPT DIRECT</span><h2>{t("adminGptDirectOrders")}</h2><p>{t("adminGptDirectOrdersDesc")}</p></div>
      <form className="admin-filter-bar" onSubmit={submitFilter}>
        <label><span>{t("search")}</span><input name="q" defaultValue={query.q} placeholder={t("searchGptDirectOrders")} /></label>
        <label><span>{t("gptPlanLabel")}</span><select name="plan" defaultValue={query.plan}><option value="">{t("allPlans")}</option>{plans.filter(Boolean).map((plan) => <option key={plan} value={plan}>{t(`gptPlan.${plan}`, { defaultValue: plan })}</option>)}</select></label>
        <label><span>{t("status")}</span><select name="status" defaultValue={query.status}><option value="">{t("allStatuses")}</option>{statuses.filter(Boolean).map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</select></label>
        <Button type="submit" size="sm" variant="outline">{t("filter")}</Button>
      </form>
    </div>
    <section className="admin-surface">
      <div className="admin-section-heading"><div><span className="admin-kicker">ORDERS</span><h3>{t("gptOrderHistory")}</h3></div><Sparkles /></div>
      {orders.isLoading && <p className="admin-state loading-skeleton loading-skeleton-table" aria-label={t("loading")}>{t("loading")}</p>}
      {orders.isError && <p className="admin-state is-error" role="alert">{t("adminLoadFailed")}</p>}
      {orders.data?.data.list.length === 0 && <p className="admin-state">{t("gptNoOrders")}</p>}
      {orders.data && orders.data.data.list.length > 0 && <div className="admin-table-wrap"><table className="admin-table" data-testid="admin-gpt-direct-table">
        <thead><tr><th>{t("customer")}</th><th>{t("gptPlanLabel")}</th><th>{t("status")}</th><th>{t("gptOrderProgress")}</th><th>{t("amount")}</th><th>{t("targetCard")}</th><th>{t("createdTime")}</th><th>{t("details")}</th></tr></thead>
        <tbody>{orders.data.data.list.map((order) => <tr key={order.id}>
          <td><button type="button" className="admin-customer-inviter" onClick={() => onOpenCustomer(order.userId, order.email)}><span>{order.email ?? `#${order.userId}`}</span><ArrowRight /></button><small>#{order.userId}{order.accountEmailMasked ? ` · ${order.accountEmailMasked}` : ""}</small></td>
          <td><strong>{planLabel(order.originalPlan)} → {planLabel(order.plan)}</strong><small>{t("adminGptObservedPlan")}: {planLabel(order.observedPlan)}</small><small>{t("adminGptCheckoutBranch")}: {order.checkoutBranch || t("adminGptNotRecorded")}</small><small>{order.id.slice(0, 8)}</small></td>
          <td><span className={`status-pill ${order.status === "completed" && order.operationStatus === "SUCCEEDED" ? "is-active" : ""}`}>{statusLabel(order.status)}</span><small>{order.operationStatus}</small></td>
          <td><strong>{stageLabel(order.stage) || "—"}</strong><small>{order.lastError || "—"}</small></td>
          <td><strong>${formatDecimal(order.customerServiceFee)}</strong><small>{order.serviceFeeStatus || order.dispatchState}</small></td>
          <td>{order.linkedCardId ? <button type="button" className="admin-customer-inviter" onClick={() => onOpenCard(order.userId, order.linkedCardId!)}>{order.cardNumberMasked || `#${order.cardId}`}<ArrowRight /></button> : order.cardNumberMasked || t("adminGptNotRecorded")}<small>{order.cardId ? `#${order.cardId} · ` : ""}{order.cardProductCode || ""}</small><small>{order.paymentCardSource === "external" ? t("adminGptExternalCard") : order.autoOpenedCard ? t("adminGptAutoCard") : t("adminGptSelectedCard")}</small></td><td>{new Date(order.createdAt).toLocaleString(locale)}</td>
          <td><Button type="button" size="xs" variant="outline" onClick={() => setSelectedOrderId(order.id)}>{t("details")}</Button></td>
        </tr>)}</tbody>
      </table></div>}
      {orders.data && <div className="admin-pagination"><span>{t("totalItems", { count: orders.data.data.total })}</span><div><Button size="xs" variant="outline" onClick={() => setQuery((current) => ({ ...current, page: current.page - 1 }))} disabled={orders.data.data.page <= 1}>{t("previousPage")}</Button><span>{orders.data.data.page}</span><Button size="xs" variant="outline" onClick={() => setQuery((current) => ({ ...current, page: current.page + 1 }))} disabled={orders.data.data.page * orders.data.data.pageSize >= orders.data.data.total}>{t("nextPage")}</Button></div></div>}
    </section>
    <AdminGptOrderDetail selectedId={selectedOrderId} order={detail} events={orderDetail.data?.data.events}
      isLoading={orderDetail.isLoading} isError={orderDetail.isError} onRetry={() => orderDetail.refetch()}
      onClose={() => setSelectedOrderId(null)} onOpenCustomer={onOpenCustomer} onOpenCard={onOpenCard}
      actions={orderDetail.data && <>{orderDetail.data.data.order.status === "requires_action" && <section className="admin-alert is-warning"><div>{renewalRecovery ? <><strong>{t("gptRenewalSessionTitle")}</strong><p>{t("adminGptRenewalSessionHint")}</p></> : <p>{t("adminGptEndOrderWarning")}</p>}</div><Button type="button" size="sm" variant="outline" disabled={endOrder.isPending} onClick={() => { if (window.confirm(t("adminGptEndOrderConfirm"))) endOrder.mutate(orderDetail.data.data.order.id); }}><CircleStop />{endOrder.isPending ? t("adminGptEndingOrder") : t("adminGptEndOrder")}</Button>{endOrder.isError && <small role="alert">{endOrder.error instanceof Error ? endOrder.error.message : t("adminLoadFailed")}</small>}</section>}</>} />

  </div>;
}
