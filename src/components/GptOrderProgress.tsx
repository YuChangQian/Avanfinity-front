import { useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, CheckCircle2, ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { GptDirectEvent, GptDirectOrder } from "../api";
import { creditQuantityForPlan, isCreditPlan } from "../gptDirect/plans";
import { formatDecimal } from "../decimal";

const terminalStatuses = new Set(["completed", "declined", "failed", "failed_precharge", "cancelled"]);
export const FLOW_STEPS = ["queued", "prechecking", "creating_checkout", "checkout", "tokenizing", "submitting", "charging", "verifying", "canceling", "complete"] as const;
const PRO_UPGRADE_FLOW_STEPS = ["queued", "prechecking", "creating_checkout", "checkout", "tokenizing", "submitting", "charging", "verifying", "upgrading", "tokenizing", "submitting", "charging", "verifying", "canceling", "complete"] as const;
export const CREDIT_FLOW_STEPS = ["queued", "prechecking", "creating_checkout", "checkout", "tokenizing", "submitting", "charging", "verifying", "complete"] as const;

export function paymentCardLastFour(order: Pick<GptDirectOrder, "cardLastFour" | "cardNumberMasked">) {
  if (order.cardLastFour !== undefined) return /^\d{4}$/.test(order.cardLastFour ?? "") ? order.cardLastFour : null;
  return order.cardNumberMasked?.match(/(\d{4})\s*$/)?.[1] ?? null;
}

export function financiallyFinal(order?: GptDirectOrder) {
  if (!order) return false;
  if (order.processing) return order.processing.status === "finished" && !order.processing.active;
  return (order.status === "completed" && order.operationStatus === "SUCCEEDED")
    || (terminalStatuses.has(order.status) && order.status !== "completed" && order.operationStatus === "COMPENSATED");
}

export function safeToRetry(order?: GptDirectOrder) {
  return order?.retry?.allowed === true && order.processing?.status === "finished"
    && !order.processing.active && ["not_submitted", "declined"].includes(order.payment?.status ?? "unknown");
}

export function canStopRetry(order: GptDirectOrder) {
  return order.retry?.maxAttempts === 2 && !order.retry.cancelRequested
    && ["armed", "checking", "reserved", "opening", "dispatching", "reconciling"].includes(order.retry.phase ?? "");
}

export function stripeInvoiceUrl(value?: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.host === "invoice.stripe.com"
      && !url.username
      && !url.password
      && !url.hash
      && url.pathname !== "/"
      ? url.href : null;
  } catch {
    return null;
  }
}

export function stripeInvoiceUrls(values?: string[] | null, fallback?: string | null) {
  const result: string[] = [];
  for (const value of [...(Array.isArray(values) ? values : []), fallback]) {
    const url = stripeInvoiceUrl(value);
    if (url && !result.includes(url)) result.push(url);
  }
  return result;
}

function normalizedStage(stage?: string | null) {
  if (stage === "retrying_checkout") return "creating_checkout";
  return stage ?? "";
}

function observedProgress(order: GptDirectOrder, events: GptDirectEvent[]) {
  const progress = order.progress?.length
    ? order.progress
    : events.flatMap((event) => event.stage ? [{ stage: event.stage, status: event.status, publicMessage: event.publicMessage, occurredAt: event.occurredAt ?? event.createdAt }] : []);
  const currentStage = order.status === "completed" ? "complete" : order.stage;
  return currentStage && normalizedStage(progress.at(-1)?.stage) !== normalizedStage(currentStage)
    ? [...progress, { stage: currentStage }]
    : progress;
}

export function orderProgressState(order: GptDirectOrder, events: GptDirectEvent[] = []) {
  const steps: readonly string[] = isCreditPlan(order.plan)
    ? CREDIT_FLOW_STEPS
    : ["pro_20x", "pro_25x"].includes(order.plan) ? PRO_UPGRADE_FLOW_STEPS : FLOW_STEPS;
  const observed = observedProgress(order, events);
  let currentIndex = -1;
  for (const progress of observed) {
    const stage = normalizedStage(progress.stage);
    const nextIndex = steps.indexOf(stage, currentIndex + 1);
    if (nextIndex >= 0) {
      currentIndex = nextIndex;
    }
  }
  return {
    observed,
    percent: typeof order.display?.progressPercent === "number"
      ? Math.max(0, Math.min(100, order.display.progressPercent))
      : currentIndex < 0 ? 0 : Math.round(((currentIndex + 1) / steps.length) * 100),
  };
}

export function orderProgressPercent(order: GptDirectOrder, events: GptDirectEvent[] = []) {
  return orderProgressState(order, events).percent;
}

export function needsRenewalSession(order: GptDirectOrder, events: GptDirectEvent[] = []) {
  if (isCreditPlan(order.plan)) return false;
  // The payment flow enters canceling only after confirming the target subscription.
  return order.status === "requires_action"
    && order.willRenew !== false
    && (order.nextAction === "submit_session" || (order.publicCode ?? events.at(-1)?.publicCode) === "session_refresh_required")
    && (order.progress?.some((step) => step.stage === "canceling") || events.some((event) => event.stage === "canceling"));
}

export function orderHeadline(
  order: GptDirectOrder,
  t: (key: string, options?: { status?: string }) => string,
  statusLabel: (status: string) => string,
) {
  if (order.display?.statusLabel) return order.display.statusLabel;
  if (needsRenewalSession(order)) return t("gptRenewalSessionTitle");
  const ended = ["declined", "failed", "failed_precharge", "cancelled"].includes(order.status);
  if (financiallyFinal(order) && order.status === "completed") {
    return t(isCreditPlan(order.plan) ? "gptCreditsOrderCompleted" : "gptOrderCompleted");
  }
  if (ended && !financiallyFinal(order)) return t("gptOrderReconciling");
  if (ended) return t("gptOrderEnded", { status: statusLabel(order.status) });
  return t("gptOrderAccepted");
}

export function renewalCopy(order: GptDirectOrder, t: (key: string) => string) {
  if (isCreditPlan(order.plan)) return null;
  if (order.willRenew === false) return t("gptRenewalCancelled");
  if (order.willRenew === true) return t("gptRenewalActive");
  if (order.needsRenewalCancel || order.status === "completed" || order.stage === "complete" || order.stage === "canceling") {
    return t("gptRenewalUnknown");
  }
  return null;
}

type Props = {
  order: GptDirectOrder;
  events?: GptDirectEvent[];
  defaultExpanded?: boolean;
  openPageLink?: boolean;
  renewalForm?: {
    value: string;
    pending: boolean;
    error: string;
    onChange: (value: string) => void;
    onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  };
  sessionRecoveryForm?: {
    value: string;
    pending: boolean;
    error: string;
    onChange: (value: string) => void;
    onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  };
};

export function GptOrderProgress({ order, events = [], defaultExpanded = false, openPageLink = false, renewalForm, sessionRecoveryForm }: Props) {
  const { t, i18n } = useTranslation();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const renewalRecovery = needsRenewalSession(order, events);
  const progress = orderProgressState(order, events);
  const current = progress.observed.at(-1);
  const currentLabel = order.display?.message ?? current?.publicMessage
    ?? t(`gptOrderStage.${current?.stage ?? order.stage ?? order.status}`, { defaultValue: current?.stage ?? order.stage ?? order.status });
  const renewal = renewalCopy(order, t);
  const invoiceUrls = stripeInvoiceUrls(order.invoiceUrls, order.invoiceUrl);
  const locale = i18n.language === "zh" ? "zh-CN" : "en-US";
  const cardLastFour = paymentCardLastFour(order);

  return <div className={`gpt-order-tracker ${expanded ? "is-expanded" : "is-collapsed"}`}>
    {renewalRecovery && <section className="gpt-order-recovery gpt-renewal-action" aria-label={t("gptRecoveryNextStep")}>
      <strong>{t("gptRenewalSessionTitle")}</strong>
      <p>{t("gptRenewalSessionHint")}</p>
    </section>}
    <div className="gpt-order-progress-summary">
      <header><span><Sparkles />{t("gptLiveOrder")}</span><b>{progress.percent}%</b></header>
      <strong>{t(`gptPlan.${order.plan}`, { defaultValue: isCreditPlan(order.plan) ? `Credits ${creditQuantityForPlan(order.plan).toLocaleString("en-US")}` : order.plan })}</strong>
      <p>{renewalRecovery ? t("gptRenewalSessionMessage") : currentLabel}</p>
      <p data-testid="gpt-payment-card-last-four">{t("gptPaymentCardLastFour")}：{cardLastFour ? `•••• ${cardLastFour}` : t("gptPaymentCardNotRecorded")}</p>
      <div role="progressbar" aria-label={t("gptOrderProgress")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent} style={{ ["--gpt-flow-progress" as string]: `${progress.percent}%` }} />
      <footer><span><CheckCircle2 />{order.display?.statusLabel ?? t(`gptOrderStatus.${order.status}`, { defaultValue: order.status })}</span><span>{t("gptInvoiceCount", { count: invoiceUrls.length })}</span></footer>
    </div>
    <div className="gpt-order-tracker-toolbar">
      <button type="button" className="gpt-order-tracker-toggle" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
        {expanded ? <ChevronUp /> : <ChevronDown />}
        {expanded ? t("gptProgressCollapse") : t("gptProgressExpand")}
      </button>
      {openPageLink && <Link className="gpt-order-progress-link" to="/gpt-direct/orders/$orderId" params={{ orderId: order.id }}>{t("gptOpenProgressPage")}<ArrowUpRight /></Link>}
    </div>
    {renewal && <em className="gpt-renewal-note">{renewal}</em>}
    {!renewalRecovery && order.recoveryMessage && order.nextAction !== "none" && order.nextAction !== "wait" && <section className="gpt-order-recovery" aria-label={t("gptRecoveryNextStep")}>
      <strong>{t("gptRecoveryNextStep")}</strong>
      <p>{order.recoveryMessage}</p>
      {safeToRetry(order) && ["refresh_session_and_reorder", "retry_preflight"].includes(order.nextAction ?? "") && <Button asChild size="sm"><Link to="/gpt-direct">{t("gptRetryPreflight")}</Link></Button>}
    </section>}
    {order.payment && <p>{t("gptEvidencePayment")}：{t(`gptEvidencePaymentStatus.${order.payment.status}`, { defaultValue: t("gptEvidenceUnknown") })}</p>}
    {order.failure && order.failure.message !== currentLabel && <p role="status">{order.failure.message}</p>}
    {order.attempts?.length && <section data-testid="gpt-order-attempts" className="gpt-order-events">
      <strong>{t("gptRetryAttempts")}</strong>
      <ol>{order.attempts.map((attempt, index) => <li key={attempt.id}>
        <strong>{t("gptRetryAttempt", { number: index + 1 })} · •••• {paymentCardLastFour(attempt) ?? t("gptPaymentCardNotRecorded")}</strong>
        <p>{attempt.display?.statusLabel ?? t(`gptOrderStatus.${attempt.status}`, { defaultValue: attempt.status })}{attempt.failure?.message ? ` · ${attempt.failure.message}` : ""}</p>
      </li>)}</ol>
    </section>}
    {order.financials && <section data-testid="gpt-order-financials" className="gpt-auto-card-review">
      <strong>{t("gptEvidenceFinancials")}</strong>
      <dl>{Object.entries(order.financials).flatMap(([kind, entries]) => entries.map((entry, index) =>
        <div key={`${kind}:${index}`}><dt>{t(`gptFinancialKind.${kind}`, { defaultValue: kind })}</dt>
          <dd>{entry.amount !== null && entry.currency ? `${entry.currency} ${formatDecimal(entry.amount)}` : t("gptEvidenceUnknown")} · {t(`gptFinancialStatus.${entry.status}`, { defaultValue: t("gptEvidenceUnknown") })}</dd></div>))}</dl>
      <small>{t("gptRetryBalanceNotice")}</small>
    </section>}
    {invoiceUrls.length > 0 && <div className="gpt-order-invoices gpt-progress-invoices">{invoiceUrls.map((invoiceUrl, index) => <a className="gpt-invoice-link" href={invoiceUrl} target="_blank" rel="noopener noreferrer" key={invoiceUrl}>{t("gptViewStripeInvoice")}{invoiceUrls.length > 1 ? ` ${index + 1}` : ""}</a>)}</div>}
    {sessionRecoveryForm && <form className="gpt-renewal-form" onSubmit={sessionRecoveryForm.onSubmit}>
      <p>{t(renewalRecovery ? "gptRenewalSessionHint" : "gptSessionRecoveryHint")}</p>
      <label>{t("gptSessionCredential")}
        <textarea aria-label={t("gptSessionCredential")} value={sessionRecoveryForm.value} onChange={(event) => sessionRecoveryForm.onChange(event.target.value)} rows={5} autoComplete="off" spellCheck={false} required />
        <small>{t("gptSessionCredentialHint")}</small>
      </label>
      {sessionRecoveryForm.error && <p role="alert" className="error">{sessionRecoveryForm.error}</p>}
      <Button type="submit" size="sm" disabled={sessionRecoveryForm.pending || !sessionRecoveryForm.value.trim()}>{sessionRecoveryForm.pending ? t("processing") : t(renewalRecovery ? "gptRenewalSessionSubmit" : "gptSubmitRecoverySession")}</Button>
    </form>}
    {order.needsRenewalCancel && renewalForm && <form className="gpt-renewal-form" onSubmit={renewalForm.onSubmit}>
      <p>{t(order.autoCancelRenewal === false ? "gptRenewalKeptHint" : "gptRenewalResubmitHint")}</p>
      <label>{t("gptSessionCredential")}
        <textarea aria-label={t("gptSessionCredential")} value={renewalForm.value} onChange={(event) => renewalForm.onChange(event.target.value)} rows={5} autoComplete="off" spellCheck={false} required />
        <small>{t("gptSessionCredentialHint")}</small>
      </label>
      {renewalForm.error && <p role="alert" className="error">{renewalForm.error}</p>}
      <Button type="submit" size="sm" disabled={renewalForm.pending || !renewalForm.value.trim()}>{renewalForm.pending ? t("processing") : t("gptSubmitRenewalSession")}</Button>
    </form>}
    {expanded && events.length > 0 && <section className="gpt-order-events">
      <div className="gpt-order-events-heading"><strong>{t("gptPublicTimeline")}</strong><small>{events.length}</small></div>
      <ol className="gpt-order-event-list" aria-label={t("gptPublicTimeline")}>
        {events.map((event, index) => <li className={index === events.length - 1 ? "is-current" : ""} key={event.eventId}>
          <span className="gpt-order-event-dot" aria-hidden="true" />
          <div><strong>{renewalRecovery && event.publicCode === "session_refresh_required" ? t("gptRenewalSessionMessage") : event.publicMessage ?? event.message ?? event.stage ?? event.type}</strong>
            <time>{new Date(event.occurredAt ?? event.createdAt).toLocaleString(locale)}</time></div>
        </li>)}
      </ol>
    </section>}
  </div>;
}
