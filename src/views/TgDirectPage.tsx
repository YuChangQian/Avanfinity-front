import { useState } from "react";
import { CheckCircle2, Circle, History, Loader2, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useAtomValue } from "jotai";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageShell } from "../components/PageShell";
import { DirectOrderFilters, type DirectOrderQuery } from "../components/DirectOrderFilters";
import { TgDirectCdkPanel } from "../components/TgDirectCdkPanel";
import { sessionAtom, sessionIdentity } from "../state";
import { ApiError, cancelTgDirect, confirmTgDirect, getCards, getTgDirectOrder, getTgDirectOrders, getTgDirectPlans, prepareTgDirect, type TgDirectOrder } from "../api";

const statuses: Record<string, string> = {
  preparing: "正在检查资格和报价", prepared: "待确认付款", processing: "正在充值",
  completed: "充值完成", paid_pending_delivery: "已付款，等待到账", review_required: "结果待核对，请勿重复付款",
  requires_action: "支付需要进一步验证，请联系客服", ineligible: "账号暂不符合充值条件",
  failed_precharge: "未扣款，充值未完成", cancelled: "已取消",
};
const settledStatuses = ["completed", "paid_pending_delivery", "failed_precharge", "ineligible", "cancelled"];
const feeStatuses = { unpaid: "未收取", charged: "已收取", refunded: "已退还", waived: "免服务费" };
const paid = (order: TgDirectOrder) => ["completed", "paid_pending_delivery"].includes(order.status);
const paymentStarted = (order?: TgDirectOrder) => !!order && (order.paymentAttempted || order.paymentSubmitted || paid(order) || ["processing", "requires_action"].includes(order.status));
const amount = (order: TgDirectOrder) => order.amountMinor != null && order.currency
  ? `${order.currency.toUpperCase()} ${(order.amountMinor / 100).toFixed(2)}` : order.status === "preparing" ? "等待报价" : "未获取";

function TgOrderProgress({ order, preparing, confirming, uncertain }: { order?: TgDirectOrder; preparing: boolean; confirming: boolean; uncertain: boolean }) {
  const completed = order?.status === "completed";
  const paymentKnown = !!order && paid(order);
  const quoting = preparing || order?.status === "preparing";
  const stopped = ["ineligible", "failed_precharge", "cancelled", "review_required", "requires_action"].includes(order?.status ?? "");
  const started = confirming || uncertain || paymentStarted(order);
  const quoteReady = order?.amountMinor != null && !!order.currency && ["prepared", "cancelled"].includes(order.status);
  const current = quoting || !order || order.status === "ineligible" || (!started && !quoteReady) ? 0 : paymentKnown ? 2 : 1;
  const stoppedLabel = order?.status === "failed_precharge" ? (started ? "支付失败" : "获取报价失败") : order?.status === "ineligible" ? "资格未通过" : order?.status === "cancelled" ? (current === 1 ? "未开始" : "已取消") : order?.status === "requires_action" ? "待验证" : "待核对";
  const active = !stopped && (quoting || confirming || uncertain || ["processing", "paid_pending_delivery"].includes(order?.status ?? ""));
  return <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3" aria-live="polite">
    <ol aria-label="充值流程" className="space-y-4">
      {["检查资格与报价", "支付 TG 订单", "确认充值到账"].map((label, index) => {
        const done = completed || index < current;
        const running = !completed && index === current && active;
        const Icon = done ? CheckCircle2 : running ? Loader2 : Circle;
        return <li key={label} aria-current={!completed && index === current ? "step" : undefined} className={`flex items-center gap-3 text-sm ${done ? "text-emerald-700" : index === current ? "font-semibold" : "text-muted-foreground"}`}>
          <Icon aria-hidden="true" className={`size-4 shrink-0 ${running ? "animate-spin motion-reduce:animate-none" : ""}`} />
          <span>{label}</span><span className="ml-auto text-xs">{done ? "已完成" : index !== current ? "未开始" : stopped ? stoppedLabel : active ? "处理中" : "待确认"}</span>
        </li>;
      })}
    </ol>
    <p className="text-xs text-muted-foreground" role="status">{quoting ? "正在检查账号资格并获取官方报价，请稍候。" : completed ? "已通过 Telegram 赠送记录确认到账。" : paymentKnown ? "已确认付款，正在等待充值到账；请勿重复支付。" : confirming ? "正在提交付款，请勿重复操作。" : uncertain ? "付款结果尚未确认，正在查询原订单，请勿重复支付。" : order?.status === "processing" ? "正在查询支付结果，请勿重复操作。" : !started ? "当前仅为报价预览，确认支付后才会开始充值。" : "流程根据实际订单状态更新。"}</p>
  </div>;
}

export function TgDirectPage() {
  const session = useAtomValue(sessionAtom);
  const token = session?.token ?? "";
  const queryClient = useQueryClient();
  const [tab, setTab] = useState(() => new URLSearchParams(window.location.search).get("tab") === "cdk" ? "cdk" : "direct");
  const [recipient, setRecipient] = useState("");
  const tier = "premium";
  const [duration, setDuration] = useState("3m");
  const plan = `${tier}_${duration}`;
  const [cardId, setCardId] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [orderQuery, setOrderQuery] = useState<DirectOrderQuery>({ recipient: "", status: "", page: 1 });
  const [selected, setSelected] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [submitting, setSubmitting] = useState<"prepare" | "confirm" | null>(null);
  const [uncertainOrderId, setUncertainOrderId] = useState<string | null>(null);
  const key = ["tg-direct", sessionIdentity(session)];
  const plans = useQuery({ queryKey: [...key, "plans"], queryFn: () => getTgDirectPlans(token), enabled: !!session });
  const cards = useQuery({ queryKey: [...key, "cards"], queryFn: () => getCards(token, 1, 100), enabled: !!session });
  const orders = useQuery({ queryKey: [...key, "orders", orderQuery], queryFn: () => getTgDirectOrders(token, orderQuery), enabled: !!session && tab === "direct", refetchInterval: tab === "direct" ? 15000 : false });
  const detail = useQuery({ queryKey: [...key, "order", selected], queryFn: () => getTgDirectOrder(token, selected!), enabled: !!session && !!selected && tab === "direct",
    refetchInterval: query => submitting === "confirm" || (uncertainOrderId === selected && !!selected && !settledStatuses.includes(query.state.data?.data.status ?? "")) || ["processing", "preparing", "paid_pending_delivery"].includes(query.state.data?.data.status ?? "") ? 3000 : false });
  const order = detail.data?.data ?? orders.data?.data.find(item => item.id === selected);
  const refresh = async (value: TgDirectOrder) => {
    await queryClient.cancelQueries({ queryKey: [...key, "order", value.id] });
    setSelected(value.id);
    queryClient.setQueryData([...key, "order", value.id], { code: 200, data: value });
    await queryClient.invalidateQueries({ queryKey: [...key, "orders"] });
    if (value.paymentAttempted) await queryClient.invalidateQueries({ queryKey: ["dashboard", sessionIdentity(session)] });
  };
  const action = useMutation({ mutationFn: async (kind: "prepare" | "confirm" | "cancel") => {
    setMessage("");
    if (kind === "prepare") {
      setSubmitting("prepare");
      setSelected(null);
      return prepareTgDirect(token, { recipient, plan, cardId: Number(cardId), clientRequestId: requestId });
    }
    if (!order) throw new Error("请先选择订单");
    if (kind === "confirm") {
      setSubmitting("confirm");
      setUncertainOrderId(order.id);
      setDrawerOpen(true);
    }
    return kind === "confirm" ? confirmTgDirect(token, order) : cancelTgDirect(token, order.id);
  }, onSuccess: async response => { setUncertainOrderId(null); await refresh(response.data); if (["cancelled", "ineligible", "failed_precharge"].includes(response.data.status)) setRequestId(crypto.randomUUID()); },
  onError: (error, kind) => {
    const rejected = error instanceof ApiError && error.status >= 400 && error.status < 500;
    if (kind === "confirm" && rejected) setUncertainOrderId(null);
    setMessage(kind === "confirm" && !rejected ? "付款请求未返回明确结果，请查询原订单，勿重复支付。" : error instanceof Error ? error.message : "请求失败，请查看订单记录");
    void orders.refetch();
    if (kind === "confirm") void detail.refetch();
  }, onSettled: () => setSubmitting(null) });
  if (!session) return <Navigate to="/login" />;
  const changeInput = () => { setRequestId(crypto.randomUUID()); setSelected(null); setMessage(""); };
  const planList = plans.data?.data.plans ?? [];
  const history = (orders.data?.data ?? []).filter(item => item.paymentAttempted || item.paymentSubmitted || paid(item));
  const activeCards = (cards.data?.data.list ?? []).filter(card => card.status === "ACTIVE" && !card.pendingOperationId);

  const preview = submitting !== "confirm" && uncertainOrderId !== order?.id && !paymentStarted(order);
  const recovered = uncertainOrderId === order?.id && settledStatuses.includes(order?.status ?? "");
  const orderContent = <div className="space-y-4">
        {message && !recovered && <p role="alert">{message}</p>}
        {detail.isError && <p role="alert">状态暂时无法获取，请刷新原订单，勿重复充值。</p>}
        {(order || submitting === "prepare") && <TgOrderProgress order={order} preparing={submitting === "prepare"} confirming={submitting === "confirm"} uncertain={uncertainOrderId === order?.id && !recovered} />}
        {order ? <>
          <strong>@{order.recipient} · {planList.find(item => item.key === order.plan)?.label ?? order.plan}</strong>
          <p>{submitting === "confirm" && !paid(order) ? "正在充值" : preview && order.status === "failed_precharge" ? "报价获取失败，未开始充值" : preview && order.status === "review_required" ? "报价结果待核对，未开始充值" : statuses[order.status] ?? "结果待核对"}</p>
          {order.message && <p role="alert">{order.message}</p>}
          <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-2">
            <div className="flex items-center justify-between gap-3"><span>官方金额</span><strong>{amount(order)}</strong></div>
            {order.amountMinor != null && <div className="flex items-center justify-between gap-3"><span>美元参考金额</span><strong>{order.estimatedUsd ? `约 USD ${order.estimatedUsd}` : "暂无法换算"}</strong></div>}
            <div className="flex items-center justify-between gap-3"><span>卡台服务费</span><span>USD {order.serviceFee}{order.serviceFeeStatus ? `（${feeStatuses[order.serviceFeeStatus]}）` : ""}</span></div>
            <p className="text-xs text-muted-foreground">{order.fxRateDate ? `参考汇率日期：${order.fxRateDate}。` : ""}最终美元扣款以发卡行入账金额为准。</p>
          </div>
          {order.status === "prepared" && uncertainOrderId !== order.id && <><Button disabled={action.isPending || !plans.data?.data.paymentsEnabled} onClick={() => action.mutate("confirm")}>确认支付 {amount(order)}</Button><Button variant="outline" disabled={action.isPending} onClick={() => action.mutate("cancel")}>取消此报价</Button></>}
          <Button variant="outline" disabled={action.isPending || detail.isFetching} onClick={() => void detail.refetch()}>刷新订单状态</Button>
          {paid(order) && <div><strong>赠送到账</strong><p>{order.deliveryStatus === "delivered" ? `已核验赠送记录${order.giftMessageId ? ` #${order.giftMessageId}` : ""}${order.giftDays ? ` · ${order.giftDays} 天` : ""}` : "付款已确认，正在核对 Telegram 赠送记录。"}</p></div>}
          <small>订单编号：{order.id}</small>
        </> : submitting !== "prepare" && <p>完成资格检查后，在这里核对账号、套餐和金额。</p>}
  </div>;
  const openDetails = (id: string) => { setSelected(id); setMessage(""); setDrawerOpen(true); };

  return <PageShell className="gpt-direct-page" eyebrow="TG DIRECT" title="TG 直充" description="输入 TG 用户名，赠送 Telegram Premium，支持 3 个月、6 个月和 1 年。">
    <div className="admin-filter-bar mb-5" role="tablist" aria-label="TG 直充模式">{[["direct", "直充"], ["cdk", "CDK"]].map(([value, label]) => <Button key={value} role="tab" aria-selected={tab === value} variant={tab === value ? "default" : "outline"} disabled={action.isPending} onClick={() => { setTab(value); window.history.replaceState(null, "", value === "cdk" ? "/tg-direct?tab=cdk" : "/tg-direct"); }}>{label}</Button>)}</div>
    {tab === "cdk" ? <TgDirectCdkPanel token={token} plans={planList} cards={activeCards} /> : <>
    <div className="gpt-direct-layout">
      <section className="gpt-direct-panel"><form className="gpt-direct-form" onSubmit={event => { event.preventDefault(); action.mutate("prepare"); }}>
        <label>TG 用户名<input required maxLength={33} pattern="@?[A-Za-z0-9_]{1,32}" placeholder="@username" value={recipient} disabled={action.isPending} onChange={event => { setRecipient(event.target.value); changeInput(); }} /></label>
        <p>Telegram Premium</p>
        <label>充值时长<Select value={duration} disabled={action.isPending || plans.isLoading} onValueChange={value => { setDuration(value); changeInput(); }}>
          <SelectTrigger aria-label="充值时长"><SelectValue /></SelectTrigger>
          <SelectContent>{[["3m", "3 个月"], ["6m", "6 个月"], ["12m", "1 年"]].map(([value, label]) => {
            const enabled = planList.find(item => item.key === `${tier}_${value}`)?.enabled;
            return <SelectItem key={value} value={value} disabled={!enabled}>{label}{enabled ? "" : "（暂未开放）"}</SelectItem>;
          })}</SelectContent>
        </Select></label>
        <label>支付卡<Select required value={cardId} disabled={action.isPending || cards.isLoading} onValueChange={value => { setCardId(value); changeInput(); }}>
          <SelectTrigger aria-label="支付卡"><SelectValue placeholder="请选择可用卡片" /></SelectTrigger>
          <SelectContent>{activeCards.map(card => <SelectItem key={card.id} value={String(card.id)}>{card.cardNumberMasked} · 余额 USD {card.balance}</SelectItem>)}</SelectContent>
        </Select></label>
        <p>所选套餐服务费：USD {planList.find(item => item.key === plan)?.serviceFee ?? "0.00"}。先检查账号资格并获取官方报价。确认后从所选卡付款，卡台服务费从钱包另行收取；换汇及发卡行费用以卡片实际账单为准。</p>
        {plans.isError && <p role="alert">TG 服务暂不可用，请稍后重试。</p>}
        {cards.isError && <p role="alert">卡片加载失败，请刷新页面。</p>}
        {plans.data && !plans.data.data.paymentsEnabled && <p role="status">付款暂未开启，可以预检已开放套餐。</p>}
        <Button type="submit" disabled={action.isPending || !cardId || !planList.find(item => item.key === plan)?.enabled}>{action.isPending ? "处理中…" : "检查资格并获取报价"}</Button>
      </form></section>
      <section className="gpt-direct-panel"><div className="gpt-order-content" aria-live="polite">
        <h2>{preview ? "报价预览" : "充值确认"}</h2>
        {drawerOpen ? <p>正在侧边窗口查看订单进度与到账。</p> : orderContent}
      </div></section>
    </div>
    <section className="transaction-panel gpt-orders-panel mt-5" aria-labelledby="tg-order-history-title">
      <div className="section-title"><h2 id="tg-order-history-title"><History />TG 直充订单</h2><span>{orders.data?.meta?.total ?? history.length} 笔订单</span></div>
      <DirectOrderFilters query={orderQuery} statuses={statuses} maxUsername={32} total={orders.data?.meta?.total} busy={orders.isFetching} onChange={setOrderQuery} />
      {orders.isError ? <p className="gpt-list-state error" role="alert">订单加载失败，请刷新。</p> : orders.isLoading ? <p className="gpt-list-state">正在加载订单…</p> : !history.length ? <p className="gpt-list-state">{orderQuery.recipient || orderQuery.status ? "暂无符合条件的订单" : "暂无充值订单"}</p> : history.map(item => <div className="gpt-order-history-row" key={item.id}>
        <div className="gpt-order-row"><div className="gpt-order-row-main is-static">
          <span className={`gpt-status-dot is-${item.status}`} />
          <button type="button" className="gpt-order-heading-trigger" disabled={action.isPending} onClick={() => openDetails(item.id)}>
            <strong>@{item.recipient}</strong><small>{planList.find(p => p.key === item.plan)?.label ?? item.plan}</small>
            <small>{statuses[item.status] ?? "结果待核对"}{item.createdAt ? ` · ${new Date(item.createdAt).toLocaleString("zh-CN")}` : ""}</small>
          </button>
          <span className="gpt-order-row-state"><strong>{amount(item)}</strong>{item.estimatedUsd && <small>约 USD {item.estimatedUsd}</small>}
            <Button variant="outline" size="sm" disabled={action.isPending} onClick={() => openDetails(item.id)}>订单详情</Button>
          </span>
        </div></div>
      </div>)}
    </section>
    <Dialog.Root open={drawerOpen} onOpenChange={setDrawerOpen}><Dialog.Portal>
      <Dialog.Overlay className="dialog-overlay" />
      <Dialog.Content className="dialog-content gpt-progress-drawer">
        <div className="card-transaction-drawer-head"><div><Dialog.Title>TG 直充进度与到账</Dialog.Title><Dialog.Description>查看当前流程、支付结果和赠送到账记录。</Dialog.Description></div><Dialog.Close asChild><Button type="button" variant="ghost" size="icon" aria-label="关闭"><X /></Button></Dialog.Close></div>
        <div className="gpt-progress-drawer-body">{orderContent}</div>
      </Dialog.Content>
    </Dialog.Portal></Dialog.Root>
    </>}
  </PageShell>;
}
