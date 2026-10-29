import { tgOrderStatus, tgOrderExplanation, TgOrderTiming } from "./TgOrderStatus";
import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleDollarSign, RefreshCw, Save, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useTranslation } from "react-i18next";
import { ApiError, getAdminTgDirectOrder, getAdminTgDirectOrders, getAdminTgDirectSettings, updateAdminTgDirectSettings, type AdminTgDirectOrder } from "../api";
import { formatDecimal } from "../decimal";
import { AdminTgDirectSessionPanel } from "./AdminTgDirectSessionPanel";
import { Button } from "./ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

const statuses: Record<string, string> = {
  preparing: "正在检查资格和报价", prepared: "待确认付款", processing: "正在充值", completed: "充值完成",
  paid_pending_delivery: "已付款，等待到账", review_required: "结果待核对", requires_action: "支付需要进一步验证",
  ineligible: "账号暂不符合充值条件", failed_precharge: "未扣款，充值未完成", cancelled: "已取消",
};
const feeStatuses: Record<string, string> = { unpaid: "未收取", charged: "已扣费", refunded: "已退费", waived: "免服务费" };
const officialAmount = (order: AdminTgDirectOrder) => order.amountMinor != null && order.currency ? `${order.currency.toUpperCase()} ${(order.amountMinor / 100).toFixed(2)}` : "—";

export function AdminTgDirectFees({ token, tierCode }: { token: string; tierCode: string }) {
  const { i18n } = useTranslation();
  const en = i18n.language === "en";
  const client = useQueryClient();
  const settings = useQuery({ queryKey: ["admin-tg-direct-settings", tierCode], queryFn: () => getAdminTgDirectSettings(token, tierCode), retry: false });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: (input: { plan: string; serviceFee: string; version: number }) => updateAdminTgDirectSettings(token, { ...input, tierCode }),
    onSuccess: (result, input) => {
      client.setQueryData(["admin-tg-direct-settings", tierCode], result);
      setDrafts(current => { const next = { ...current }; delete next[input.plan]; return next; });
      void client.invalidateQueries({ queryKey: ["tg-direct"] });
    },
  });
  const recentAuth = save.error instanceof ApiError && save.error.errorCode === "RECENT_AUTH_REQUIRED";
  const conflict = save.error instanceof ApiError && save.error.status === 409;
  const reloadFees = async () => { const result = await settings.refetch(); if (!result.isError) { setDrafts({}); save.reset(); } };

  return <section className="admin-surface admin-system-section" aria-labelledby={`tg-direct-fees-${tierCode}`} data-testid="admin-tg-direct-fees">
      <div className="admin-section-heading"><div><span className="admin-kicker">USD FEES</span><h2 id={`tg-direct-fees-${tierCode}`}><CircleDollarSign />{en ? "TG Direct service fees" : "TG 直充套餐服务费"}</h2><p>{en ? "Official charges use the selected card. The USD service fee is taken from the wallet on payment confirmation. A confirmed failure without an official charge refunds the fee; uncertain results remain pending review." : "官方金额从所选卡扣除；USD 服务费在确认支付时从钱包扣除。明确未扣官方费用的失败会退还服务费，结果不明时保持待核对。"}</p></div></div>
      <div className="admin-system-form">
        <p className="admin-settings-note">{en ? "Applies to customers in this tier, including CDKs and API orders. USD 0–10,000, with up to two decimal places. Fee changes require fresh quotes." : "适用于本等级客户的直充、兑换码及 API 订单。可设置 USD 0–10,000，最多两位小数；修改后需重新获取报价。"}</p>
        {settings.isLoading && <p>{en ? "Loading fees…" : "正在加载费用…"}</p>}
        {settings.isError && <p className="admin-alert is-error" role="alert">{en ? "Unable to load fees." : "费用加载失败。"}<Button type="button" size="sm" variant="outline" onClick={() => void settings.refetch()}>{en ? "Retry" : "重试"}</Button></p>}
        <div className="admin-system-form-grid">{settings.data?.data.plans.map(plan => {
          const value = drafts[plan.key] ?? plan.serviceFee;
          const invalid = !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value) || Number(value) > 10000;
          return <form key={plan.key} data-testid={`tg-fee-${plan.key}`} onSubmit={event => { event.preventDefault(); if (!invalid) save.mutate({ plan: plan.key, serviceFee: value, version: plan.version }); }}>
            <label>{plan.label} · {en ? "Service fee (USD)" : "服务费 (USD)"}<input type="number" min="0" max="10000" step="0.01" value={value} disabled={save.isPending} onChange={event => { setDrafts(current => ({ ...current, [plan.key]: event.target.value })); save.reset(); }} required /></label>
            <div className="admin-form-actions"><Button type="submit" size="sm" disabled={save.isPending || invalid || value === plan.serviceFee}><Save />{save.isPending && save.variables.plan === plan.key ? (en ? "Saving…" : "正在保存…") : (en ? "Save fee" : "保存服务费")}</Button></div>
          </form>;
        })}</div>
        {save.isSuccess && <p className="admin-alert is-success" role="status">{en ? "Service fee saved." : "服务费已保存。"}</p>}
        {save.isError && <div className="admin-alert is-error" role="alert"><span>{recentAuth ? (en ? "Verify your administrator account again before changing fees." : "修改费用需要重新认证管理员身份。") : conflict ? (en ? "Another administrator changed these fees. Reload before saving." : "费用已被其他管理员修改，请重新加载后再保存。") : (en ? "Unable to save fees. Retry later." : "费用保存失败，请稍后重试。")}</span>
          {conflict && <Button type="button" size="sm" variant="outline" disabled={settings.isFetching} onClick={() => void reloadFees()}>{en ? "Reload fees" : "重新加载费用"}</Button>}
          {recentAuth && <Button type="button" size="sm" variant="outline" onClick={() => { sessionStorage.setItem("recentAuthReturnPath", "/admin?panel=tiers"); window.location.assign("/login"); }}>{en ? "Verify again" : "重新认证"}</Button>}
        </div>}
      </div>
    </section>;
}

export function AdminTgDirectPanel({ token }: { token: string }) {
  const { i18n } = useTranslation();
  const en = i18n.language === "en";
  const plans = ["premium_3m", "premium_6m", "premium_12m"].map((key, index) => ({ key, label: `Premium · ${en ? ["3 months", "6 months", "1 year"][index % 3] : ["3 个月", "6 个月", "1 年"][index % 3]}` }));
  return <div className="admin-panel-stack" data-testid="admin-panel-tgDirect">
    <div className="admin-panel-heading"><div><span className="admin-kicker">TG DIRECT</span><h2>{en ? "TG Direct" : "TG 直充"}</h2><p>{en ? "Manage the sender session and customer orders. Service fees are configured under Customer tiers." : "管理发送方会话及客户订单，服务费请在「客户等级」中设置。"}</p></div></div>
    <AdminTgDirectSessionPanel token={token} />
    <TgDirectOrders token={token} plans={plans} />
  </div>;
}

function TgDirectOrders({ token, plans }: { token: string; plans: Array<{ key: string; label: string }> }) {
  const { t, i18n } = useTranslation();
  const en = i18n.language === "en";
  const [query, setQuery] = useState<{ page: number; recipient: string; status: string; userId?: number }>({ page: 1, recipient: "", status: "" });
  const [status, setStatus] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const orders = useQuery({ queryKey: ["admin-tg-direct-orders", query], queryFn: () => getAdminTgDirectOrders(token, query), retry: false });
  const detail = useQuery({ queryKey: ["admin-tg-direct-order", selectedId], queryFn: () => getAdminTgDirectOrder(token, selectedId!), enabled: Boolean(selectedId), retry: false });
  const order = detail.data?.data;
  const planLabel = (key: string) => plans.find(plan => plan.key === key)?.label ?? key;
  const statusLabel = (value: string) => statuses[value] ? (en ? value.replaceAll("_", " ") : statuses[value]) : (en ? "Pending review" : "待核对");
  const feeLabel = (value: string) => feeStatuses[value] ? (en ? value.replaceAll("_", " ") : feeStatuses[value]) : (en ? "Not recorded" : "未记录");
  const dateLabel = (value: string) => new Date(value).toLocaleString(en ? "en-US" : "zh-CN");
  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setQuery({ page: 1, recipient: String(data.get("recipient") ?? "").trim().replace(/^@/, ""), status: status === "all" ? "" : status, ...(data.get("userId") ? { userId: Number(data.get("userId")) } : {}) });
    setSelectedId(null);
  }

  return <>
    <section className="admin-surface" data-testid="admin-tg-direct-orders" aria-labelledby="tg-direct-orders-title">
      <div className="admin-section-heading"><div><span className="admin-kicker">CUSTOMER ORDERS</span><h2 id="tg-direct-orders-title">{en ? "All customer TG orders" : "全部客户 TG 订单"}</h2><p>{en ? "Read-only saved status and delivery evidence. Refreshing does not submit payments." : "仅查询已保存的订单状态与到账，刷新不会提交支付。"}</p></div><Button type="button" size="sm" variant="outline" disabled={orders.isFetching} onClick={() => void orders.refetch()}><RefreshCw />{en ? "Refresh records" : "刷新记录"}</Button></div>
      <form className="admin-filter-bar p-5" onSubmit={filter}>
        <label>{en ? "TG username" : "TG 用户名"}<input name="recipient" maxLength={33} pattern="@?[A-Za-z0-9_]{0,32}" placeholder="@username" /></label>
        <label>{en ? "User ID" : "用户 ID"}<input name="userId" type="number" min="1" step="1" /></label>
        <label>{en ? "Order status" : "订单状态"}<Select value={status} onValueChange={setStatus}><SelectTrigger aria-label={en ? "Order status" : "订单状态"}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">{t("allStatuses")}</SelectItem>{Object.keys(statuses).filter(value => value !== "preparing" && value !== "prepared").map(value => <SelectItem key={value} value={value}>{statusLabel(value)}</SelectItem>)}</SelectContent></Select></label>
        <Button type="submit" size="sm" variant="outline">{t("filter")}</Button>
      </form>
      {orders.isLoading && <p className="admin-state" aria-busy="true">{t("loading")}</p>}
      {orders.isError && <p className="admin-state is-error" role="alert">{en ? "Unable to load orders. Refresh records to retry." : "订单加载失败，请刷新记录重试。"}</p>}
      {orders.data?.data.list.length === 0 && <p className="admin-state">{en ? "No matching orders." : "暂无符合条件的订单。"}</p>}
      {orders.data && orders.data.data.list.length > 0 && <div className="admin-table-wrap"><table className="admin-table">
        <thead><tr><th>{t("customer")}</th><th>{en ? "TG account / plan" : "TG 账号 / 套餐"}</th><th>{t("status")}</th><th>{en ? "Official card amount" : "官方扣卡金额"}</th><th>{en ? "Wallet service fee" : "钱包服务费"}</th><th>{t("createdTime")}</th><th>{t("details")}</th></tr></thead>
        <tbody>{orders.data.data.list.map(item => <tr key={item.id}>
          <td>{item.ownerEmail || `#${item.ownerUserId}`}<small>#{item.ownerUserId}</small></td>
          <td><strong>@{item.recipient}</strong><small>{planLabel(item.plan)}</small><small>{item.id.slice(0, 8)}</small></td>
          <td><span className={`status-pill ${item.status === "completed" ? "is-active" : ""}`}>{en ? statusLabel(item.status) : tgOrderStatus(item)}</span></td>
          <td><strong>{officialAmount(item)}</strong>{item.estimatedUsd && <small>{en ? "Approx." : "约"} USD {formatDecimal(item.estimatedUsd)}</small>}</td>
          <td><strong>USD {formatDecimal(item.serviceFee)}</strong><small>{feeLabel(item.serviceFeeStatus)}</small></td>
          <td>{dateLabel(item.createdAt)}</td>
          <td><Button type="button" size="xs" variant="outline" onClick={() => setSelectedId(item.id)}>{en ? "Details / receipts" : "订单详情"}</Button></td>
        </tr>)}</tbody>
      </table></div>}
      {orders.data && <div className="admin-pagination"><span>{t("totalItems", { count: orders.data.data.total })}</span><div><Button type="button" size="xs" variant="outline" disabled={query.page <= 1 || orders.isFetching} onClick={() => setQuery(current => ({ ...current, page: current.page - 1 }))}>{t("previousPage")}</Button><span>{orders.data.data.page}</span><Button type="button" size="xs" variant="outline" disabled={orders.data.data.page * orders.data.data.pageSize >= orders.data.data.total || orders.isFetching} onClick={() => setQuery(current => ({ ...current, page: current.page + 1 }))}>{t("nextPage")}</Button></div></div>}
    </section>
    <Dialog.Root open={Boolean(selectedId)} onOpenChange={open => { if (!open) setSelectedId(null); }}><Dialog.Portal>
      <div className="dialog-overlay" data-state={selectedId ? "open" : "closed"} aria-hidden="true" onClick={() => setSelectedId(null)} />
      <Dialog.Content className="dialog-content admin-gpt-order-drawer">
        <div className="card-transaction-drawer-head"><div><Dialog.Title>{en ? "TG order details" : "TG 直充订单详情"}</Dialog.Title><Dialog.Description>{selectedId}</Dialog.Description></div><Dialog.Close asChild><Button type="button" variant="ghost" size="icon" aria-label={t("close")}><X /></Button></Dialog.Close></div>
        {detail.isLoading && <p className="admin-state">{t("loading")}</p>}
        {detail.isError && <p className="admin-state is-error" role="alert">{en ? "Unable to load order details." : "订单详情加载失败。"}</p>}
        <div className="admin-gpt-order-detail-body">
          <Button type="button" size="sm" variant="outline" disabled={detail.isFetching} onClick={() => void detail.refetch()}><RefreshCw />{en ? "Refresh saved details" : "刷新已保存详情"}</Button>
          {order && <>
            <dl className="transaction-detail-grid">
              <div><dt>{t("customer")}</dt><dd>{order.ownerEmail || "—"} · #{order.ownerUserId}</dd></div>
              <div><dt>{en ? "TG account" : "TG 账号"}</dt><dd>@{order.recipient}</dd></div>
              <div><dt>{en ? "Plan" : "套餐"}</dt><dd>{planLabel(order.plan)}</dd></div>
              <div><dt>{t("status")}</dt><dd>{en ? statusLabel(order.status) : tgOrderStatus(order)}</dd></div>
              <div><dt>{en ? "Official card amount" : "官方扣卡金额"}</dt><dd>{officialAmount(order)}</dd></div>
              <div><dt>{en ? "USD estimate" : "美元参考金额"}</dt><dd>{order.estimatedUsd ? `${en ? "Approx." : "约"} USD ${formatDecimal(order.estimatedUsd)}` : "—"}</dd></div>
              <div><dt>{en ? "Wallet service fee" : "钱包服务费"}</dt><dd>USD {formatDecimal(order.serviceFee)}</dd></div>
              <div><dt>{en ? "Service fee status" : "服务费状态"}</dt><dd>{feeLabel(order.serviceFeeStatus)}</dd></div>
              <div><dt>{en ? "Payment attempted" : "是否尝试支付"}</dt><dd>{order.paymentAttempted === true ? (en ? "Yes" : "是") : order.paymentAttempted === false ? (en ? "No" : "否") : "—"}</dd></div>
              <div><dt>{en ? "Payment card" : "支付卡"}</dt><dd>#{order.cardId}{/^\d{4}$/.test(order.cardLast4 ?? "") ? ` · **** ${order.cardLast4}` : ""}</dd></div>
              <div><dt>{t("createdTime")}</dt><dd>{dateLabel(order.createdAt)}</dd></div>
            </dl>
            {tgOrderExplanation(order) && <p className="admin-alert is-warning">{tgOrderExplanation(order)}</p>}
            <TgOrderTiming order={order} />
            <p className="admin-settings-note">{en ? "The card statement determines the final charge. Uncertain payments remain pending review; do not submit another payment." : "最终扣卡金额以卡片账单为准。结果不明的支付保持待核对，请勿重复支付。"}</p>
            <section className="admin-gpt-invoices"><h3>{en ? "Gift delivery" : "赠送到账"}</h3><p>{order.deliveryStatus === "delivered" ? (en ? "Delivery verified" : "已核验到账") : (en ? "Delivery not yet verified" : "尚未核验到账")}{order.giftMessageId ? ` #${order.giftMessageId}` : ""}{order.giftDays ? ` · ${order.giftDays} ${en ? "days" : "天"}` : ""}</p></section>
          </>}
        </div>
      </Dialog.Content>
    </Dialog.Portal></Dialog.Root>
  </>;
}
