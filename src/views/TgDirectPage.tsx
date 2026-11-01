import { t } from "i18next";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import { Notice, NoticeScope } from "../components/ui/notice";
import { useState } from "react";
import { CheckCircle2, Circle, History, Loader2, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useAtomValue } from "jotai";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { tgStatuses, tgPlanLabel, tgOrderStatus, tgOrderExplanation, TgOrderTiming } from "../components/TgOrderStatus";
import { StableSwap } from "../components/StableSwap";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageShell } from "../components/PageShell";
import { DirectOrderFilters, type DirectOrderQuery } from "../components/DirectOrderFilters";
import { TgDirectCdkPanel } from "../components/TgDirectCdkPanel";
import { sessionAtom, sessionIdentity } from "../state";
import { ApiError, cancelTgDirect, confirmTgDirect, getCards, getTgDirectOrder, getTgDirectOrders, getTgDirectPlans, prepareTgDirect, type TgDirectOrder } from "../api";

const statuses = tgStatuses;
const settledStatuses = ["completed", "paid_pending_delivery", "failed_precharge", "ineligible", "cancelled"];
const feeStatuses = { get unpaid() { return t("serviceText.notCharged"); }, get charged() { return t("serviceText.charged"); }, get refunded() { return t("serviceText.refunded"); }, get waived() { return t("serviceText.serviceFeeWaived"); } };
const paid = (order: TgDirectOrder) => ["completed", "paid_pending_delivery"].includes(order.status);
const paymentStarted = (order?: TgDirectOrder) => !!order && (order.paymentAttempted || order.paymentSubmitted || paid(order) || ["processing", "requires_action"].includes(order.status));
const amount = (order: TgDirectOrder) => order.amountMinor != null && order.currency
  ? `${order.currency.toUpperCase()} ${(order.amountMinor / 100).toFixed(2)}` : order.status === "preparing" ? t("serviceText.awaitingQuote") : t("serviceText.notAvailable");

function TgOrderProgress({ order, preparing, confirming, uncertain }: { order?: TgDirectOrder; preparing: boolean; confirming: boolean; uncertain: boolean }) {
  useTranslation();
  const completed = order?.status === "completed";
  const paymentKnown = !!order && paid(order);
  const quoting = preparing || order?.status === "preparing";
  const stopped = ["ineligible", "failed_precharge", "cancelled", "review_required", "requires_action"].includes(order?.status ?? "");
  const started = confirming || uncertain || paymentStarted(order);
  const quoteReady = order?.amountMinor != null && !!order.currency && ["prepared", "cancelled"].includes(order.status);
  const current = quoting || !order || order.status === "ineligible" || (!started && !quoteReady) ? 0 : paymentKnown ? 2 : 1;
  const stoppedLabel = order?.status === "failed_precharge" ? (started ? t("serviceText.paymentFailed") : t("serviceText.quoteFailed")) : order?.status === "ineligible" ? t("serviceText.eligibilityCheckFailed") : order?.status === "cancelled" ? (current === 1 ? t("serviceText.notStarted") : t("serviceText.cancelled")) : order?.status === "requires_action" ? t("serviceText.verificationRequired") : t("serviceText.underReview");
  const active = !stopped && (quoting || confirming || uncertain || ["processing", "paid_pending_delivery"].includes(order?.status ?? ""));
  return <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3" aria-live="polite">
    <p className="text-sm font-semibold">{t("serviceText.currentStep")}{completed ? t("serviceText.deliveryConfirmed") : quoting ? t("serviceText.checkAccountAndQuote") : paymentKnown ? t("serviceText.checkTelegramGiftDelivery") : order?.stage === "authenticating" ? t("serviceText.paymentAuthenticationAndVerification") : order?.stage === "tokenizing" ? t("serviceText.preparePaymentInformation") : started ? t("serviceText.submitPaymentAndCheckResult") : t("serviceText.awaitingPaymentConfirmation")}</p>
    <ol aria-label={t("serviceText.topUpProcess")} className="space-y-4">
      {[t("serviceText.checkEligibilityAndQuote"), t("serviceText.payForTgOrder"), t("serviceText.confirmDelivery")].map((label, index) => {
        const done = completed || index < current;
        const running = !completed && index === current && active;
        const Icon = done ? CheckCircle2 : running ? Loader2 : Circle;
        return <li key={label} aria-current={!completed && index === current ? "step" : undefined} className={`flex items-center gap-3 text-sm ${done ? "text-emerald-700" : index === current ? "font-semibold" : "text-muted-foreground"}`}>
          <Icon aria-hidden="true" className={`size-4 shrink-0 ${running ? "animate-spin motion-reduce:animate-none" : ""}`} />
          <span>{label}</span><span className="ml-auto text-xs">{done ? t("serviceText.completed") : index !== current ? t("serviceText.notStarted") : stopped ? stoppedLabel : active ? t("serviceText.processing") : t("serviceText.awaitingConfirmation")}</span>
        </li>;
      })}
    </ol>
    <p className="text-xs text-muted-foreground" role="status">{quoting ? t("serviceText.checkingAccountEligibilityAndObtainingTheOfficialQuote") : completed ? t("serviceText.deliveryConfirmedThroughTelegramGiftRecords") : paymentKnown ? t("serviceText.paymentConfirmedWaitingForDeliveryDoNotPay") : confirming ? t("serviceText.submittingPaymentDoNotSubmitAgain") : uncertain ? t("serviceText.paymentResultUnconfirmedCheckingTheOriginalOrderDo") : order?.status === "processing" ? t("serviceText.checkingPaymentResultDoNotSubmitAgain") : !started ? t("serviceText.thisIsAQuotePreviewTopUpStarts") : t("serviceText.progressReflectsTheActualOrderStatus")}</p>
  </div>;
}

export function TgDirectPage() {
  useTranslation();
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
    refetchInterval: query => query.state.data?.data.statusSnapshot || submitting === "confirm" || (uncertainOrderId === selected && !!selected && !settledStatuses.includes(query.state.data?.data.status ?? "")) || ["processing", "preparing", "paid_pending_delivery", "requires_action", "review_required"].includes(query.state.data?.data.status ?? "") ? 3000 : false });
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
    if (!order) throw new Error(t("serviceText.selectAnOrderFirst"));
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
    setMessage(kind === "confirm" && !rejected ? t("serviceText.paymentRequestReturnedNoClearResultCheckThe") : error instanceof Error ? error.message : t("serviceText.requestFailedCheckYourOrderHistory"));
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
  const orderContent = <div className="tg-order-content space-y-4">
        {selected && detail.isPending && <p role="status">{t("serviceText.loadingOriginalOrderProgress")}</p>}
        {message && !recovered && <Notice role="alert" className="error">{message}</Notice>}
        {detail.isError && <Notice role="alert" className="error">{t("serviceText.statusIsTemporarilyUnavailableRefreshTheOriginalOrder")}</Notice>}
        {(order || submitting === "prepare") && <TgOrderProgress order={order} preparing={submitting === "prepare"} confirming={submitting === "confirm"} uncertain={uncertainOrderId === order?.id && !recovered} />}
        {order ? <>
          <strong>@{order.recipient} · {tgPlanLabel(order.plan, planList.find(item => item.key === order.plan)?.label)}</strong>
          <p>{submitting === "confirm" && !paid(order) ? t("serviceText.toppingUp") : preview && order.status === "failed_precharge" ? t("serviceText.quoteFailedTopUpHasNotStarted") : preview && order.status === "review_required" ? t("serviceText.quoteUnderReviewTopUpHasNotStarted") : tgOrderStatus(order)}</p>
          {tgOrderExplanation(order) && <p className="tg-order-explanation" role="status">{tgOrderExplanation(order)}</p>}
          {order.message && !tgOrderExplanation(order) && <Notice role="alert" className="error">{order.message}</Notice>}
          <TgOrderTiming order={order} />
          <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-2">
            <div className="flex items-center justify-between gap-3"><span>{t("serviceText.officialAmount")}</span><strong>{amount(order)}</strong></div>
            {order.amountMinor != null && <div className="flex items-center justify-between gap-3"><span>{t("serviceText.estimatedUsdAmount")}</span><strong>{order.estimatedUsd ? t("serviceText.approxUsd", { amount: order.estimatedUsd }) : t("serviceText.conversionUnavailable")}</strong></div>}
            <div className="flex items-center justify-between gap-3"><span>{t("serviceText.platformServiceFee")}</span><span>USD {order.serviceFee}{order.serviceFeeStatus ? `（${feeStatuses[order.serviceFeeStatus]}）` : ""}</span></div>
            <p className="text-xs text-muted-foreground">{order.fxRateDate ? t("serviceText.referenceExchangeRateDate", { date: order.fxRateDate }) : ""}{t("serviceText.finalUsdDebitIsDeterminedByTheCard")}</p>
          </div>
          {order.status === "prepared" && uncertainOrderId !== order.id && <><Button disabled={action.isPending || !plans.data?.data.paymentsEnabled} onClick={() => action.mutate("confirm")}>{t("serviceText.confirmPayment")}{amount(order)}</Button><Button variant="outline" disabled={action.isPending} onClick={() => action.mutate("cancel")}>{t("serviceText.cancelThisQuote")}</Button></>}
          <Button variant="outline" disabled={action.isPending || detail.isFetching} onClick={() => void detail.refetch()}>{t("serviceText.refreshOrderStatus")}</Button>
          {paid(order) && <div><strong>{t("serviceText.giftDelivery")}</strong><p>{order.deliveryStatus === "delivered" ? t("serviceText.giftRecordVerified", { record: order.giftMessageId ? ` #${order.giftMessageId}` : "", duration: order.giftDays ? t("serviceText.days2", { days: order.giftDays }) : "" }) : t("serviceText.paymentConfirmedCheckingTelegramGiftRecords")}</p></div>}
          <small>{t("serviceText.orderId2")}{order.id}</small>
        </> : submitting !== "prepare" && !selected && <p>{t("serviceText.afterTheEligibilityCheckReviewTheAccountPlan")}</p>}
  </div>;
  const openDetails = (id: string) => { setSelected(id); setMessage(""); setDrawerOpen(true); };

  return <PageShell className="gpt-direct-page" eyebrow="TG DIRECT" title={t("serviceText.tgDirectTopUp")} description={t("serviceText.enterATgUsernameToGiftTelegramPremium")}>
    <div className="admin-filter-bar mb-5" role="tablist" aria-label={t("serviceText.tgDirectTopUpMode")}>{[["direct", t("serviceText.directTopUp")], ["cdk", "CDK"]].map(([value, label]) => <Button key={value} role="tab" aria-selected={tab === value} variant={tab === value ? "default" : "outline"} disabled={action.isPending} onClick={() => { setTab(value); window.history.replaceState(null, "", value === "cdk" ? "/tg-direct?tab=cdk" : "/tg-direct"); }}>{label}</Button>)}</div>
    {tab === "cdk" ? <TgDirectCdkPanel token={token} plans={planList} cards={activeCards} /> : <>
    <div className="gpt-direct-layout">
      <section className="gpt-direct-panel"><form className="gpt-direct-form" onSubmit={event => { event.preventDefault(); action.mutate("prepare"); }}>
        <label>{t("serviceText.tgUsername")}<input required maxLength={33} pattern="@?[A-Za-z0-9_]{1,32}" placeholder="@username" value={recipient} disabled={action.isPending} onChange={event => { setRecipient(event.target.value); changeInput(); }} /></label>
        <p>Telegram Premium</p>
        <label>{t("serviceText.subscriptionDuration")}<Select value={duration} disabled={action.isPending || plans.isLoading} onValueChange={value => { setDuration(value); changeInput(); }}>
          <SelectTrigger aria-label={t("serviceText.subscriptionDuration")}><SelectValue /></SelectTrigger>
          <SelectContent>{[["3m", t("serviceText.3Months")], ["6m", t("serviceText.6Months")], ["12m", t("serviceText.1Year")]].map(([value, label]) => {
            const enabled = planList.find(item => item.key === `${tier}_${value}`)?.enabled;
            return <SelectItem key={value} value={value} disabled={!enabled}>{label}{enabled ? "" : t("serviceText.unavailable")}</SelectItem>;
          })}</SelectContent>
        </Select></label>
        <label>{t("serviceText.paymentCard")}<Select required value={cardId} disabled={action.isPending || cards.isLoading} onValueChange={value => { setCardId(value); changeInput(); }}>
          <SelectTrigger aria-label={t("serviceText.paymentCard")}><SelectValue placeholder={t("serviceText.chooseAnAvailableCard")} /></SelectTrigger>
          <SelectContent>{activeCards.map(card => <SelectItem key={card.id} value={String(card.id)}>{card.cardNumberMasked} {t("serviceText.balanceUsd")}{card.balance}</SelectItem>)}</SelectContent>
        </Select></label>
        <p>{t("serviceText.selectedPlanServiceFeeUsd")}{planList.find(item => item.key === plan)?.serviceFee ?? "0.00"}{t("serviceText.checkAccountEligibilityAndObtainTheOfficialQuote")}</p>
        {plans.isError && <Notice role="alert" className="error">{t("serviceText.tgServiceIsTemporarilyUnavailablePleaseTryAgain")}</Notice>}
        {cards.isError && <Notice role="alert" className="error">{t("serviceText.failedToLoadCardsRefreshThePage")}</Notice>}
        {plans.data && !plans.data.data.paymentsEnabled && <Notice className="admin-alert is-warning" role="status">{t("serviceText.paymentsAreNotYetEnabledYouCanCheck")}</Notice>}
        <Button type="submit" disabled={action.isPending || !cardId || !planList.find(item => item.key === plan)?.enabled}><StableSwap state={action.isPending ? "busy" : "idle"} labels={{ idle: t("serviceText.checkEligibilityAndGetQuote"), busy: t("serviceText.processing2") }} /></Button>
      </form></section>
      <section className="gpt-direct-panel"><div className="gpt-order-content" aria-live="polite">
        <h2>{preview ? t("serviceText.quotePreview") : t("serviceText.topUpConfirmation")}</h2>
        {drawerOpen ? <><p>{order ? tgOrderStatus(order) : t("serviceText.loadingOrderProgress")}</p><Button variant="outline" onClick={() => setDrawerOpen(true)}>{t("serviceText.viewCurrentTopUpProgress")}</Button></> : orderContent}
      </div></section>
    </div>
    <section className="transaction-panel gpt-orders-panel mt-5" aria-labelledby="tg-order-history-title">
      <div className="section-title"><h2 id="tg-order-history-title"><History />{t("serviceText.tgDirectTopUpOrders")}</h2><span>{orders.data?.meta?.total ?? history.length} {t("serviceText.orders")}</span></div>
      <DirectOrderFilters query={orderQuery} statuses={statuses} maxUsername={32} total={orders.data?.meta?.total} busy={orders.isFetching} onChange={setOrderQuery} />
      {orders.isError ? <Notice className="gpt-list-state error" role="alert">{t("serviceText.failedToLoadOrdersPleaseRefresh")}</Notice> : orders.isLoading ? <p className="gpt-list-state">{t("serviceText.loadingOrders")}</p> : !history.length ? <p className="gpt-list-state">{orderQuery.recipient || orderQuery.status ? t("serviceText.noMatchingOrders") : t("serviceText.noTopUpOrdersYet")}</p> : history.map(item => <div className="gpt-order-history-row" key={item.id}>
        <div className="gpt-order-row"><div className="gpt-order-row-main is-static">
          <span className={`gpt-status-dot is-${item.status}`} />
          <button type="button" className="gpt-order-heading-trigger" disabled={action.isPending} onClick={() => openDetails(item.id)}>
            <strong>@{item.recipient}</strong><small>{tgPlanLabel(item.plan, planList.find(p => p.key === item.plan)?.label)}</small>
            <small>{tgOrderStatus(item)}{item.createdAt ? ` · ${new Date(item.createdAt).toLocaleString(i18n.resolvedLanguage)}` : ""}</small>
          </button>
          <span className="gpt-order-row-state"><strong>{amount(item)}</strong>{item.estimatedUsd && <small>{t("serviceText.approxUsd2")}{item.estimatedUsd}</small>}
            <Button variant="outline" size="sm" disabled={action.isPending} onClick={() => openDetails(item.id)}>{t("serviceText.orderDetails")}</Button>
          </span>
        </div></div>
      </div>)}
    </section>
    <Dialog.Root open={drawerOpen} onOpenChange={setDrawerOpen}><Dialog.Portal>
      <Dialog.Overlay className="dialog-overlay" />
      <Dialog.Content className="dialog-content gpt-progress-drawer tg-progress-drawer"><NoticeScope />
        <div className="card-transaction-drawer-head"><div><Dialog.Title>{t("serviceText.tgTopUpProgressAndDelivery")}</Dialog.Title><Dialog.Description>{t("serviceText.viewProgressPaymentResultsAndGiftDeliveryRecords")}</Dialog.Description></div><Dialog.Close asChild><Button type="button" variant="ghost" size="icon" aria-label={t("serviceText.close")}><X /></Button></Dialog.Close></div>
        <div className="gpt-progress-drawer-body tg-progress-drawer-body">{orderContent}</div>
      </Dialog.Content>
    </Dialog.Portal></Dialog.Root>
    </>}
  </PageShell>;
}
