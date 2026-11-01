import { t } from "i18next";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import { useEffect, useState } from "react";
import type { TgDirectOrder } from "../api";

export const tgStatuses: Record<string, string> = {
  get preparing() { return t("serviceText.checkingEligibilityAndQuote"); }, get prepared() { return t("serviceText.awaitingPaymentConfirmation2"); }, get processing() { return t("serviceText.toppingUp"); },
  get completed() { return t("serviceText.topUpCompleted"); }, get paid_pending_delivery() { return t("serviceText.paidAwaitingDelivery"); }, get review_required() { return t("serviceText.resultUnderReviewDoNotPayAgain"); },
  get requires_action() { return t("serviceText.paymentVerificationPending"); }, get ineligible() { return t("serviceText.accountIsNotCurrentlyEligible"); },
  get failed_precharge() { return t("serviceText.notChargedTopUpIncomplete"); }, get cancelled() { return t("serviceText.cancelled"); },
};

export function tgPlanLabel(plan: string, fallback?: string) {
  const labels: Record<string, string> = {
    premium_3m: t("serviceText.premium3Months"),
    premium_6m: t("serviceText.premium6Months"),
    premium_12m: t("serviceText.premium1Year"),
  };
  return labels[plan] ?? fallback ?? plan;
}

export function tgOrderStatus(order: TgDirectOrder) {
  if (order.status === "completed") return tgStatuses.completed;
  if (order.errorCode === "execution_timeout" && order.status === "cancelled") return t("serviceText.timedOutAndCancelledPaymentNotSubmitted");
  if (order.errorCode === "delivery_timeout") return t("serviceText.paidDeliveryCheckTimedOut");
  if (order.errorCode === "payment_execution_timeout") return t("serviceText.timedOutPaymentResultUnderReview");
  if (order.errorCode === "authentication_unsupported") return t("serviceText.paymentAuthenticationCannotContinue");
  return tgStatuses[order.status] ?? t("serviceText.resultUnderReview");
}

export function tgOrderExplanation(order: TgDirectOrder) {
  if (order.errorCode === "payment_execution_timeout") return t("serviceText.topUpProcessingExceeded8MinutesAndAutomatic");
  if (order.errorCode === "delivery_timeout") return t("serviceText.paymentIsConfirmedButTheDeliveryCheckExceeded");
  if (order.errorCode === "execution_timeout" && order.status === "cancelled") return t("serviceText.noPaymentWasSubmittedWithin8MinutesSo");
  if (order.errorCode === "authentication_unsupported") return t("serviceText.thePaymentProviderReturnedAnAuthenticationPageThis");
  if (order.status === "requires_action") return t("serviceText.thePaymentProviderRequiresFurtherVerificationPaymentIs");
  if (order.status === "review_required" && !order.paymentAttempted && !order.paymentSubmitted) return t("serviceText.theQuoteIsNotYetConfirmedAndTop");
  if (order.status === "review_required") return t("serviceText.noClearPaymentResultHasBeenReceivedThe");
  return "";
}

export function TgOrderTiming({ order }: { order: TgDirectOrder }) {
  useTranslation();
  const [now, setNow] = useState(() => Date.now());
  const finished = ["completed", "cancelled", "failed_precharge", "ineligible"].includes(order.status);
  useEffect(() => {
    if (!order.deadlineAt || finished || order.executionTimedOut) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [order.deadlineAt, order.executionTimedOut, finished]);
  const seconds = order.deadlineAt ? Math.max(0, Math.ceil((Date.parse(order.deadlineAt) - now) / 1000)) : null;
  const updated = order.updatedAt ? new Date(order.updatedAt) : null;
  return <div className="tg-order-timing" aria-live="off">
    {!finished && seconds !== null && !order.executionTimedOut && <p>{seconds > 0 ? t("serviceText.processingTimeRemainingMaximum8Minutes", { minutes: Math.floor(seconds / 60), seconds: String(seconds % 60).padStart(2, "0") }) : t("serviceText.the8MinuteProcessingDeadlineHasBeenReached")}</p>}
    {updated && !Number.isNaN(updated.getTime()) && <p>{t("serviceText.lastUpdated")}{updated.toLocaleString(i18n.resolvedLanguage)}</p>}
    <p>{finished ? t("serviceText.orderEnded") : t("serviceText.statusUpdatesAutomaticallyYouCanStillViewThis")}{t("serviceText.usersWithALinkedTelegramAccountReceiveA")}</p>
  </div>;
}
