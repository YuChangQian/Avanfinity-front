import { useState, type FormEvent } from "react";
import { Link, Navigate, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Clock3, CreditCard, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAtomValue } from "jotai";
import { ApiError, cancelGptDirectOrder, cancelGptDirectRenewal, getGptDirectOrder, replaceGptDirectOrderSession } from "../api";
import { Button } from "@/components/ui/button";
import { DataSkeleton, PageShell } from "../components/PageShell";
import { canStopRetry, financiallyFinal, GptOrderProgress, orderHeadline, safeToRetry } from "../components/GptOrderProgress";
import { sessionAtom } from "../state";

const cancellableStatuses = new Set(["queued", "awaiting_card", "funding_pending"]);

export function GptDirectOrderPage() {
  const session = useAtomValue(sessionAtom);
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { orderId } = useParams({ strict: false }) as { orderId: string };
  const [sessionValue, setSessionValue] = useState("");
  const [renewalPending, setRenewalPending] = useState(false);
  const [renewalError, setRenewalError] = useState("");
  const [recoverySession, setRecoverySession] = useState("");
  const [recoveryPending, setRecoveryPending] = useState(false);
  const [recoveryError, setRecoveryError] = useState("");

  const orderQuery = useQuery({
    queryKey: ["gpt-direct-order", orderId],
    queryFn: () => getGptDirectOrder(session!.token, orderId),
    enabled: Boolean(session && orderId),
    refetchInterval: (query) => {
      const order = query.state.data?.data.order;
      if (order?.needsRenewalCancel) return 30_000;
      if (financiallyFinal(order)) return false;
      const updates = query.state.dataUpdateCount;
      return updates > 120 ? 30_000 : updates > 20 ? 10_000 : 3_000;
    },
  });
  const cancelOrder = useMutation({
    mutationFn: (id: string) => cancelGptDirectOrder(session!.token, id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["gpt-direct-order", orderId] }),
        queryClient.invalidateQueries({ queryKey: ["gpt-direct-orders"] }),
      ]);
    },
  });

  if (!session) return <Navigate to="/login" />;

  const order = orderQuery.data?.data.order;
  const events = orderQuery.data?.data.events ?? [];
  const needsSessionRecovery = order?.status === "requires_action" && (order.nextAction === "submit_session" || (!order.nextAction && events.at(-1)?.publicCode === "session_refresh_required"));
  const canRetryWithCard = Boolean(
    order
    && safeToRetry(order)
    && order.nextAction === "change_card_and_reorder",
  );
  const statusLabel = (status: string) => t(`gptOrderStatus.${status}`, { defaultValue: status });
  const stageLabel = (stage?: string | null) => stage ? t(`gptOrderStage.${stage}`, { defaultValue: stage }) : "";

  async function submitRenewal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!order || renewalPending) return;
    setRenewalPending(true);
    setRenewalError("");
    try {
      await cancelGptDirectRenewal(session!.token, order.id, { mode: "session", session: sessionValue.trim() });
      setSessionValue("");
      await queryClient.invalidateQueries({ queryKey: ["gpt-direct-order", order.id] });
      await queryClient.invalidateQueries({ queryKey: ["gpt-direct-orders"] });
    } catch (error) {
      setRenewalError(error instanceof ApiError ? error.message : error instanceof Error ? error.message : t("gptRenewalCancelFailed"));
    } finally {
      setRenewalPending(false);
    }
  }

  async function submitRecoverySession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!order || recoveryPending) return;
    setRecoveryPending(true);
    setRecoveryError("");
    try {
      await replaceGptDirectOrderSession(session!.token, order.id, { mode: "session", session: recoverySession.trim() });
      setRecoverySession("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["gpt-direct-order", order.id] }),
        queryClient.invalidateQueries({ queryKey: ["gpt-direct-orders"] }),
      ]);
    } catch (error) {
      setRecoveryError(error instanceof Error ? error.message : t("gptSessionRecoveryFailed"));
    } finally {
      setRecoveryPending(false);
    }
  }

  return <PageShell className="gpt-direct-page" eyebrow="GPT DIRECT" title={t("gptProgressPageTitle")} description={t("gptProgressPageDesc")}>
    <p><Link to="/gpt-direct" aria-label={t("back")}><ArrowLeft /></Link></p>
    {orderQuery.isLoading ? <section className="gpt-direct-panel gpt-order-panel" aria-busy="true"><div className="gpt-live-order"><Clock3 /><div><strong><DataSkeleton /></strong><span><DataSkeleton /></span><small><DataSkeleton /></small><div className="gpt-order-progress"><DataSkeleton /><DataSkeleton /><DataSkeleton /></div></div><Button size="sm" variant="outline" disabled>{t("cancel")}</Button></div></section>
      : orderQuery.isError || !order ? <p className="gpt-list-state error" role="alert">{t("gptOrdersLoadFailed")}</p>
      : <section className="gpt-direct-panel gpt-order-panel">
        <div className={`gpt-live-order is-${order.status}`} role="status" aria-live="polite">
          {financiallyFinal(order) && order.status === "completed" ? <CheckCircle2 /> : <Clock3 />}
          <div>
            <strong>{orderHeadline(order, t, statusLabel)}</strong>
            <span>{t(`gptPlan.${order.plan}`, { defaultValue: order.plan })} · {statusLabel(order.status)}{order.stage ? ` · ${stageLabel(order.stage)}` : ""}</span>
            <small>{t("gptOrderNumber", { id: order.id })}</small>
            <GptOrderProgress
              order={order}
              events={events}
              defaultExpanded
              renewalForm={order.needsRenewalCancel ? {
                value: sessionValue,
                pending: renewalPending,
                error: renewalError,
                onChange: setSessionValue,
                onSubmit: submitRenewal,
              } : undefined}
              sessionRecoveryForm={needsSessionRecovery ? {
                value: recoverySession,
                pending: recoveryPending,
                error: recoveryError,
                onChange: setRecoverySession,
                onSubmit: submitRecoverySession,
              } : undefined}
            />
            {canRetryWithCard && <div className="gpt-order-recovery">
              <p>{t("gptRetryAfterRefund")}</p>
              <div>
                <Button asChild size="sm"><Link to="/gpt-direct"><CreditCard />{t("gptSwitchCardRetry")}</Link></Button>
                <Button asChild size="sm" variant="outline"><Link to="/cards" search={{ gptRetry: true }}><Plus />{t("gptOpenCardRetry")}</Link></Button>
              </div>
            </div>}
          </div>
          {cancellableStatuses.has(order.status) && <Button size="sm" variant="outline" onClick={() => cancelOrder.mutate(order.id)} disabled={cancelOrder.isPending}>{t("cancel")}</Button>}
          {!cancellableStatuses.has(order.status) && canStopRetry(order) && <Button size="sm" variant="outline" onClick={() => cancelOrder.mutate(order.id)} disabled={cancelOrder.isPending}>{t("gptStopRetry")}</Button>}
        </div>
        {cancelOrder.isError && <p role="alert" className="error">{cancelOrder.error instanceof Error ? cancelOrder.error.message : t("gptCancelFailed")}</p>}
      </section>}
  </PageShell>;
}
