import { formatDecimal, formatRateAsPercent } from "../decimal";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAtomValue } from "jotai";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, useNavigate, useParams } from "@tanstack/react-router";
import { Check, Clock3, Copy, CreditCard, Eye, EyeOff, ReceiptText, RefreshCw, ShieldCheck, Snowflake, Trash2, UserRound, WalletCards } from "lucide-react";
import { Dialog } from "radix-ui";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { CardNetworkBrand } from "../components/CardNetworkBrand";
import { CardRechargeQuoteSummary, rechargeDebitExceedsSpendable, useCardRechargeQuote } from "../components/CardRechargeQuote";
import { PaymentPerformance } from "../components/PaymentPerformance";
import { ProductFeeDetails } from "../components/ProductFeeDetails";
import { DataSkeleton, PageShell } from "../components/PageShell";
import { ApiError, PendingOperationError, getCardDetail, getCardLedger, getCardOperation, getDashboard, getGptCardSuccesses, getSensitiveCard, runCardAction, runCardRechargeAction, saveCardNote, syncCard, type CardAddress } from "../api";
import { useFeatures } from "../features";
import { sessionAtom, sessionIdentity } from "../state";
import { interactiveCardMotion } from "../interactiveCardMotion";

type CardMoneyAction = "recharge" | "refund";
type IntentKey = { fingerprint: string; key: string };

function keyForIntent(ref: { current: IntentKey | null }, fingerprint: string) {
  if (ref.current?.fingerprint !== fingerprint) ref.current = { fingerprint, key: crypto.randomUUID() };
  return ref.current.key;
}

function rate(value: string) {
  return formatRateAsPercent(value ?? "");
}

export function CardDetailPage() {
  const session = useAtomValue(sessionAtom);
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { cardId } = useParams({ strict: false });
  const id = Number(cardId);
  const client = useQueryClient();
  const { flags } = useFeatures();
  const [visible, setVisible] = useState(false);
  const [dialogAction, setDialogAction] = useState<CardMoneyAction | "delete" | null>(null);
  const [actionAmount, setActionAmount] = useState("");
  const [actionError, setActionError] = useState("");
  const [pendingOperationId, setPendingOperationId] = useState<string | null>(null);
  const [closingRequested, setClosingRequested] = useState(false);
  const [syncNotice, setSyncNotice] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
  const [sensitiveCopyError, setSensitiveCopyError] = useState("");
  const [expandedTransaction, setExpandedTransaction] = useState<string | null>(null);
  const actionIntent = useRef<IntentKey | null>(null);
  const viewedCard = useRef<string | null>(null);
  const dashboard = useQuery({
    queryKey: ["dashboard", sessionIdentity(session)],
    queryFn: () => getDashboard(session!.token),
    enabled: Boolean(session),
  });
  const card = useQuery({ queryKey: ["card", id], queryFn: () => getCardDetail(session!.token, id), enabled: Boolean(session && Number.isInteger(id)), refetchInterval: 10_000 });
  const paymentPerformance = useQuery({ queryKey: ["gpt-card-successes"], queryFn: () => getGptCardSuccesses(session!.token), enabled: Boolean(session && Number.isInteger(id) && flags.gptDirect), retry: false });
  const trackedOperationId = pendingOperationId ?? card.data?.data.pendingOperationId ?? null;
  const operation = useQuery({
    queryKey: ["card-operation", trackedOperationId],
    queryFn: () => getCardOperation(session!.token, trackedOperationId!),
    enabled: Boolean(session && trackedOperationId),
    retry: false,
    refetchInterval: (query) => {
      const status = query.state.data?.data.status;
      if (query.state.data?.data.terminal || status === "SUCCEEDED" || status === "FAILED" || status === "COMPENSATED") return false;
      return status === "RECONCILE_REQUIRED" ? 5_000 : 2_000;
    },
  });
  const operationType = operation.data?.data.type ?? card.data?.data.pendingOperationType;
  const operationEnded = Boolean(operation.data?.data.terminal || ["SUCCEEDED", "FAILED", "COMPENSATED"].includes(operation.data?.data.status ?? ""));
  const operationPending = Boolean(trackedOperationId && !operationEnded);
  const operationFailure = operation.data?.data && ["FAILED", "COMPENSATED"].includes(operation.data.data.status)
    ? [t(`cardActionFailedByType.${operation.data.data.type}`, { defaultValue: t("cardActionFailed") }),
      operation.data.data.status === "COMPENSATED" ? t("cardActionCompensated") : null,
      operation.data.data.error].filter(Boolean).join(": ") : "";
  const cardClosed = card.data?.data.status === "DELETED";
  const upstreamClosed = (card.data?.data.accountingStatus ?? card.data?.data.status) !== "DELETED" && ["DELETED", "CANCELLED", "CANCELED"].includes(card.data?.data.upstreamStatus?.toUpperCase() ?? "");
  const cardClosing = closingRequested
    || (operationType === "DELETE" && operationPending);
  const readOnlyCard = cardClosed || cardClosing || upstreamClosed;
  const sensitive = useQuery({
    queryKey: ["card-sensitive", id],
    queryFn: () => getSensitiveCard(session!.token, id),
    enabled: Boolean(session && visible && !readOnlyCard),
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  useEffect(() => () => {
    client.removeQueries({ queryKey: ["card-sensitive", id], exact: true });
  }, [client, id]);
  useEffect(() => {
    if (readOnlyCard) client.removeQueries({ queryKey: ["card-sensitive", id], exact: true });
  }, [client, id, readOnlyCard]);
  useEffect(() => {
    if (!["DELETE", "FREEZE", "UNFREEZE"].includes(operation.data?.data.type ?? "") || !operationEnded) return;
    if (operation.data?.data.type === "DELETE" && operation.data.data.status === "SUCCEEDED") {
      void Promise.all([
        client.invalidateQueries({ queryKey: ["cards"] }),
        client.invalidateQueries({ queryKey: ["wallet"] }),
        client.invalidateQueries({ queryKey: ["dashboard"] }),
      ]).then(() => navigate({ to: "/cards/owned", replace: true }));
    } else {
      void Promise.all([
        client.invalidateQueries({ queryKey: ["card", id] }),
        client.invalidateQueries({ queryKey: ["cards"] }),
      ]).then(() => {
        actionIntent.current = null;
        setClosingRequested(false);
        setPendingOperationId(null);
        setActionError("");
        if (operationFailure) setSyncNotice({ kind: "error", message: operationFailure });
      });
    }
  }, [client, id, navigate, operation.data?.data.status, operation.data?.data.type, operationEnded, operationFailure]);
  const transactions = useQuery({ queryKey: ["card-transactions", id], queryFn: () => getCardLedger(session!.token, id), enabled: Boolean(session && Number.isInteger(id)), refetchInterval: 10_000 });
  const detail = card.data?.data;
  useEffect(() => {
    const refund = operation.data?.data;
    if (refund?.type !== "REFUND") return;
    void Promise.all([
      client.invalidateQueries({ queryKey: ["card", id] }),
      client.invalidateQueries({ queryKey: ["card-transactions", id] }),
      client.invalidateQueries({ queryKey: ["cards"] }),
      ...(refund.terminal ? [
        client.invalidateQueries({ queryKey: ["wallet"] }),
        client.invalidateQueries({ queryKey: ["dashboard"] }),
      ] : []),
    ]).then(() => {
      if (!refund.terminal) return;
      actionIntent.current = null;
      setPendingOperationId(null);
      setActionError("");
      setSyncNotice(refund.status === "SUCCEEDED"
        ? { kind: "success", message: t("refundCompleted") }
        : { kind: "error", message: operationFailure || t("cardActionFailed") });
    });
  }, [client, id, operation.data?.data, operationFailure, t]);
  useEffect(() => {
    const recharge = operation.data?.data;
    if (recharge?.type !== "RECHARGE" || !recharge.terminal) return;
    void Promise.all([
      client.invalidateQueries({ queryKey: ["card", id] }),
      client.invalidateQueries({ queryKey: ["card-transactions", id] }),
      client.invalidateQueries({ queryKey: ["cards"] }),
      client.invalidateQueries({ queryKey: ["wallet"] }),
      client.invalidateQueries({ queryKey: ["dashboard"] }),
    ]).then(() => {
      actionIntent.current = null;
      setPendingOperationId(null);
      setActionError("");
      setDialogAction(null);
      if (operationFailure) setSyncNotice({ kind: "error", message: operationFailure });
    });
  }, [client, id, operation.data?.data, operationFailure]);
  const rechargeQuote = useCardRechargeQuote(
    session?.token,
    id,
    actionAmount,
    detail?.minAmount,
    detail?.maxAmount,
    dialogAction === "recharge",
  );
  const note = useMutation({
    mutationFn: (value: string) => saveCardNote(session!.token, id, value),
    onSuccess: () => client.invalidateQueries({ queryKey: ["card", id] }),
  });
  const sync = useMutation({
    mutationFn: () => syncCard(session!.token, id),
    onSuccess: async (result) => {
      setSyncNotice({ kind: "success", message: t(result.data.reusedSnapshot ? "cardSyncRecent" : "cardSyncSuccess") });
      await Promise.all([
        client.invalidateQueries({ queryKey: ["card", id] }),
        client.invalidateQueries({ queryKey: ["card-transactions", id] }),
        client.invalidateQueries({ queryKey: ["cards"] }),
        client.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
    },
    onError: async (cause) => {
      const key = cause instanceof ApiError && cause.status === 429 ? "cardSyncCooldown"
        : cause instanceof ApiError && cause.status === 409 ? "cardSyncBusy"
          : cause instanceof ApiError && cause.status === 403 ? "cardSyncRestricted"
            : "cardSyncFailedCached";
      setSyncNotice({ kind: "error", message: t(key) });
      await Promise.all([
        client.invalidateQueries({ queryKey: ["card", id] }),
        client.invalidateQueries({ queryKey: ["card-transactions", id] }),
        client.invalidateQueries({ queryKey: ["cards"] }),
        client.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
    },
  });
  const syncViewedCard = sync.mutate;
  useEffect(() => {
    if (!session || !Number.isInteger(id) || !card.data?.data || readOnlyCard) return;
    const key = `${sessionIdentity(session)}:${id}`;
    if (viewedCard.current === key) return;
    viewedCard.current = key;
    syncViewedCard();
  }, [card.data?.data, id, readOnlyCard, session, syncViewedCard]);
  const action = useMutation({
    mutationFn: ({ action, amount, expectedFee, idempotencyKey }: { action: string; amount?: string; expectedFee?: string; idempotencyKey: string }) =>
      action === "recharge"
        ? runCardRechargeAction(session!.token, id, idempotencyKey, amount, expectedFee)
        : runCardAction(session!.token, id, action, idempotencyKey, amount, expectedFee),
    onSuccess: async (_, variables) => {
      actionIntent.current = null;
      setClosingRequested(false);
      setActionError("");
      setDialogAction(null);
      await Promise.all([
        client.invalidateQueries({ queryKey: ["card", id] }),
        client.invalidateQueries({ queryKey: ["card-transactions", id] }),
        client.invalidateQueries({ queryKey: ["cards"] }),
        client.invalidateQueries({ queryKey: ["wallet"] }),
        client.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
      if (variables.action === "freeze" || variables.action === "unfreeze") syncViewedCard();
      if (variables.action === "delete") await navigate({ to: "/cards/owned", replace: true });
    },
    onError: async (cause, variables) => {
      if (variables.action === "refund" && cause instanceof ApiError && cause.errorCode === "REFUND_BALANCE_UNAVAILABLE") {
        setActionError(t("refundBalanceUnavailable"));
        return;
      }
      if (variables.action === "refund" && cause instanceof ApiError && ["REFUND_BALANCE_CHANGED", "REFUND_BALANCE_REJECTED"].includes(cause.errorCode ?? "")) {
        actionIntent.current = null;
        setActionAmount("");
        await Promise.all([
          client.invalidateQueries({ queryKey: ["card", id] }),
          client.invalidateQueries({ queryKey: ["card-transactions", id] }),
          client.invalidateQueries({ queryKey: ["cards"] }),
          client.invalidateQueries({ queryKey: ["dashboard"] }),
        ]);
        setActionError(t("refundBalanceChanged"));
        return;
      }
      if (variables.action === "recharge" && cause instanceof ApiError && cause.status === 409 && cause.errorCode === "PRICE_CHANGED") {
        actionIntent.current = null;
        setActionError(t("rechargePriceChanged"));
        void rechargeQuote.refetch();
        return;
      }
      if (cause instanceof PendingOperationError) {
        if (cause.operationId) {
          setPendingOperationId(cause.operationId);
          if (variables.action === "delete") {
            setClosingRequested(true);
            setVisible(false);
            setCopiedAddress(null);
            setSensitiveCopyError("");
            client.removeQueries({ queryKey: ["card-sensitive", id], exact: true });
          }
          if (variables.action !== "recharge") setDialogAction(null);
        }
        setActionError(t("operationPendingDoNotRetry"));
        return;
      }
      if (variables.action === "delete") setClosingRequested(false);
      setActionError(`${t(`cardActionFailedByType.${variables.action.toUpperCase()}`, { defaultValue: t("cardActionFailed") })}${cause instanceof Error ? `: ${cause.message}` : ""}`);
      await Promise.all([
        client.invalidateQueries({ queryKey: ["card", id] }),
        client.invalidateQueries({ queryKey: ["cards"] }),
      ]);
    },
  });
  if (!session) return <Navigate to="/login" />;
  if (!Number.isInteger(id)) return <Navigate to="/cards/owned" />;
  if ((card.isError && !card.data) || (transactions.isError && !transactions.data)) return <PageShell eyebrow="VIRTUAL CARD" title={t("cardDetails")} description={t("cardLoadFailed")}>
    <div className="empty-state"><Button asChild variant="outline"><Link to="/cards/owned">{t("backToCards")}</Link></Button></div>
  </PageShell>;
  if (!card.data || !transactions.data) return <PageShell eyebrow="VIRTUAL CARD" title={t("cardDetails")} description="">
    <div aria-busy="true">
      <div className="card-detail-layout">
        <article className="card-detail-visual"><div><span>AVANFINITY</span><DataSkeleton /></div><small><DataSkeleton /></small><strong><DataSkeleton /></strong><div><span><DataSkeleton /></span><b>$<DataSkeleton /></b></div></article>
        <section className="deposit-panel card-security-panel"><div className="section-title"><h2><ShieldCheck /> {t("cardSecurityDetails")}</h2><div className="card-detail-actions"><Button variant="outline" disabled><RefreshCw /> {t("refreshCardData")}</Button><Button variant="outline" disabled><Eye /> {t("showDetails")}</Button></div></div><p>{t("sensitiveCardHint")}</p><div className="card-holder-summary"><UserRound /><div><span>{t("cardholder")}</span><strong><DataSkeleton /></strong></div><div><span>{t("cardOpenedAt")}</span><strong><DataSkeleton /></strong></div></div><div className="stats compact-stats">{["expiry", "CVV", "status"].map((label) => <article key={label}><span>{label === "CVV" ? label : t(label)}</span><strong><DataSkeleton /></strong></article>)}</div><form className="inline-action"><input aria-label={t("cardNote")} disabled /><Button disabled>{t("save")}</Button></form></section>
      </div>
      {flags.gptDirect && <section className="transaction-panel"><div className="section-title"><div><h2>{t("paymentPerformanceTitle")}</h2><p>{t("paymentPerformanceCardHint")}</p></div></div><div className="payment-risk-metrics"><DataSkeleton /><DataSkeleton /><DataSkeleton /></div></section>}
      <section className="transaction-panel card-operations-panel"><div className="section-title"><div><h2><CreditCard /> {t("cardOperations")}</h2><p>{t("cardOperationsDesc")}</p></div><DataSkeleton /></div><div className="card-operation-body"><dl>{["rechargeAmountRangeLabel", "rechargeRate", "transactionRefundRate", "refundableAmount"].map((label) => <div key={label}><dt>{t(label)}</dt><dd><DataSkeleton /></dd></div>)}</dl><div className="card-operation-actions"><Button disabled>{t("recharge")}</Button><Button variant="secondary" disabled>{t("refund")}</Button><Button variant="outline" disabled>{t("freeze")}</Button></div></div></section>
      <section className="transaction-panel"><div className="section-title"><div><h2><ReceiptText />统一卡流水</h2><p>开卡、充值、退款、销卡退款、费用和消费按时间合并展示。</p></div><DataSkeleton /></div>{[0, 1, 2].map((item) => <article className="transaction-row" key={item}><div className="transaction-icon"><WalletCards /></div><div><strong><DataSkeleton /></strong><small><DataSkeleton /></small><small><DataSkeleton /></small></div><span><DataSkeleton /></span></article>)}</section>
    </div>
  </PageShell>;
  const loadedDetail = card.data.data;
  const spendableBalance = dashboard.data?.spendableBalance ?? dashboard.data?.walletBalance;
  const pendingStatus = operationPending && operationType !== "GPT_DIRECT"
    ? t(`cardActionPending.${operationType}`, { defaultValue: t("operationPendingTitle") }) : null;
  const statusLabel = upstreamClosed ? t("cardUpstreamClosed") : cardClosing ? t("cardClosing") : cardClosed ? t("cardClosed") : pendingStatus ?? loadedDetail.status;
  const statusClass = cardClosing || pendingStatus ? "closing" : cardClosed ? "deleted" : loadedDetail.status.toLowerCase();
  const recentAuthRequired = sensitive.error instanceof ApiError && sensitive.error.errorCode === "RECENT_AUTH_REQUIRED";
  const holderName = `${loadedDetail.firstName} ${loadedDetail.lastName}`.trim() || "—";
  const cardTransactions = transactions.data.data.transactions;
  const cardActivities = transactions.data.data.activities;
  const unifiedLedger = [
    ...cardActivities.map((item) => ({ kind: "activity" as const, occurredAt: item.occurredAt, item })),
    ...cardTransactions.map((item) => ({ kind: "transaction" as const, occurredAt: item.occurredAt, item })),
  ].sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt));
  const revealed = visible && !readOnlyCard ? sensitive.data?.data : undefined;
  const billingAddress = revealed?.cardAddress ?? null;
  const billingAddressFields: Array<{ key: keyof CardAddress; label: string; value: string }> = billingAddress ? [
    { key: "addressLineOne", label: t("billingAddressLineOne"), value: billingAddress.addressLineOne },
    { key: "addressLineTwo", label: t("billingAddressLineTwo"), value: billingAddress.addressLineTwo },
    { key: "city", label: t("billingAddressCity"), value: billingAddress.city },
    { key: "state", label: t("billingAddressState"), value: billingAddress.state },
    { key: "postCode", label: t("billingAddressPostCode"), value: billingAddress.postCode },
    { key: "country", label: t("billingAddressCountry"), value: billingAddress.country },
  ] : [];
  const fullBillingAddress = billingAddressFields.map((field) => field.value.trim()).filter(Boolean).join(", ");
  const maximumRefund = Math.max(0, Number(loadedDetail.availableAmount) - Number(loadedDetail.refundKeepMinimum)).toFixed(4);
  const gptOrderPending = operationPending && (operation.data?.data.type ?? loadedDetail.pendingOperationType) === "GPT_DIRECT";
  const pendingOperationCopy = operation.data?.data.status === "RECONCILE_REQUIRED" && operation.data.data.type === "DELETE"
    ? t("deleteRefundPending")
    : operation.data?.data.error ?? t(
      operationType === "REFUND" ? "refundProcessing"
        : operationType === "RECHARGE" && operation.data?.data.status !== "RECONCILE_REQUIRED"
          ? "rechargeProcessing"
          : ["FREEZE", "UNFREEZE"].includes(operationType ?? "") ? "cardStatusPendingHint" : "operationPendingDoNotRetry",
    );
  const cardPaymentPerformance = paymentPerformance.data?.data.list.find((item) => item.cardId === id);
  function runAction(actionName: string, amount?: string, expectedFee?: string) {
    if (actionName === "recharge" && !flags.cardRecharge) return;
    if (["refund", "freeze", "unfreeze"].includes(actionName) && !flags.cardManagement) return;
    if (actionName === "delete" && !flags.cardDelete) return;
    setSyncNotice(null);
    setActionError("");
    const fingerprint = JSON.stringify({ cardId: id, action: actionName, amount: amount ?? null, expectedFee: expectedFee ?? null });
    action.mutate({ action: actionName, amount, expectedFee, idempotencyKey: keyForIntent(actionIntent, fingerprint) });
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    note.mutate(String(new FormData(event.currentTarget).get("note")));
  }
  function submitCardAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (dialogAction !== "recharge" && dialogAction !== "refund") return;
    if (dialogAction === "recharge") {
      if (!rechargeQuote.currentQuote || rechargeQuote.isFetching || rechargeQuote.isError) return;
      if (rechargeDebitExceedsSpendable(rechargeQuote.currentQuote.totalDebit, spendableBalance)) return;
      runAction(dialogAction, actionAmount, rechargeQuote.currentQuote.fee);
      return;
    }
    runAction(dialogAction, actionAmount);
  }
  function toggleSensitive() {
    if (!visible) {
      setVisible(true);
      return;
    }
    setVisible(false);
    setCopiedAddress(null);
    setSensitiveCopyError("");
    client.removeQueries({ queryKey: ["card-sensitive", id], exact: true });
  }
  async function copyBillingAddress(value: string, key: string) {
    try {
      await navigator.clipboard.writeText(value);
      setSensitiveCopyError("");
      setCopiedAddress(key);
      window.setTimeout(() => setCopiedAddress((current) => current === key ? null : current), 1_500);
    } catch {
      setSensitiveCopyError(t("copyFailed"));
    }
  }
  return <PageShell eyebrow="VIRTUAL CARD" title={`${loadedDetail.network} · ${holderName}`} description={`${loadedDetail.issuingArea} · ${loadedDetail.issuer}`}>
    <div className="card-detail-layout">
      <article className="card-detail-visual interactive-card" {...interactiveCardMotion}>
        <div><span>AVANFINITY</span><CardNetworkBrand network={loadedDetail.network} /></div>
        <small>{loadedDetail.productCode} · {t("virtualStoredValueCard")}</small>
        <strong data-testid="card-number">{revealed ? revealed.cardNumber : loadedDetail.cardNumberMasked}</strong>
        <div><span>{holderName}</span><b>${formatDecimal(loadedDetail.availableAmount)}</b></div>
      </article>
      <section className="deposit-panel card-security-panel">
        <div className="section-title"><h2><ShieldCheck /> {t("cardSecurityDetails")}</h2><div className="card-detail-actions"><Button variant="outline" onClick={() => { setSyncNotice(null); sync.mutate(); }} disabled={sync.isPending}><RefreshCw className={sync.isPending ? "is-spinning" : undefined} /> {sync.isPending ? t("refreshing") : t("refreshCardData")}</Button>{!readOnlyCard && <Button variant="outline" onClick={toggleSensitive}>{visible ? <EyeOff /> : <Eye />} {visible ? t("hideDetails") : t("showDetails")}</Button>}</div></div>
        <p>{t(cardClosing ? "cardClosingHint" : cardClosed ? "cardClosedHint" : "sensitiveCardHint")}</p>
        {syncNotice && <p role={syncNotice.kind === "error" ? "alert" : "status"} className={syncNotice.kind === "error" ? "error" : "card-sync-status"}>{syncNotice.message}</p>}
        <div className="card-holder-summary"><UserRound /><div><span>{t("cardholder")}</span><strong>{holderName}</strong></div><div><span>{t("cardOpenedAt")}</span><strong>{new Date(loadedDetail.createdAt).toLocaleDateString()}</strong></div></div>
        <div className="stats compact-stats"><article><span>{t("expiry")}</span><strong>{revealed?.expire ?? (visible ? loadedDetail.expiry : "**/**")}</strong></article><article><span>CVV</span><strong>{revealed?.cvv ?? "***"}</strong></article><article><span>{t("status")}</span><strong>{statusLabel}</strong></article></div>
        {visible && sensitive.isFetching && <p role="status" className="card-sensitive-status loading-skeleton loading-skeleton-inline">{t("loadingCardDetails")}</p>}
        {visible && sensitive.isError && <div role="alert" className="card-sensitive-error"><span>{t(recentAuthRequired ? "cardRecentAuthRequired" : "cardDetailsLoadFailed")}</span><Button size="sm" variant="outline" onClick={() => {
          if (!recentAuthRequired) return void sensitive.refetch();
          sessionStorage.setItem("recentAuthReturnPath", window.location.pathname);
          window.location.assign("/login");
        }}>{t(recentAuthRequired ? "verifyAgain" : "retry")}</Button></div>}
        {revealed && <div className="developer-secret-reveal" data-testid="card-billing-address">
          <p>{t("billingAddress")}</p>
          {fullBillingAddress ? <>
            <div data-testid="billing-address-full"><span>{t("billingAddressFull")}</span><code>{fullBillingAddress}</code><Button type="button" size="xs" variant="outline" aria-label={t("copyFullBillingAddress")} onClick={() => copyBillingAddress(fullBillingAddress, "full")}>{copiedAddress === "full" ? <Check /> : <Copy />}{copiedAddress === "full" ? t("copied") : t("copy")}</Button></div>
            {billingAddressFields.map((field) => <div key={field.key} data-testid={`billing-address-${field.key}`}><span>{field.label}</span><code>{field.value || "—"}</code><Button type="button" size="xs" variant="outline" aria-label={t("copyBillingAddressField", { field: field.label })} disabled={!field.value} onClick={() => copyBillingAddress(field.value, field.key)}>{copiedAddress === field.key ? <Check /> : <Copy />}{copiedAddress === field.key ? t("copied") : t("copy")}</Button></div>)}
          </> : <div><span>{t("billingAddress")}</span><code>{t("noBillingAddress")}</code></div>}
          {sensitiveCopyError && <p role="alert" className="error">{sensitiveCopyError}</p>}
        </div>}
        {!readOnlyCard && <form className="inline-action" onSubmit={submit}><input name="note" maxLength={100} defaultValue={loadedDetail.note} aria-label={t("cardNote")} /><Button type="submit" disabled={note.isPending}>{t("save")}</Button></form>}
      </section>
    </div>
    {flags.gptDirect && <section className="transaction-panel" data-testid="card-payment-performance">
      <div className="section-title"><div><h2>{t("paymentPerformanceTitle")}</h2><p>{t("paymentPerformanceCardHint")}</p></div></div>
      {paymentPerformance.isLoading ? <div className="empty-state loading-skeleton loading-skeleton-block" aria-label={t("loading")}>{t("loading")}</div> : cardPaymentPerformance
        ? <PaymentPerformance overall={cardPaymentPerformance.overall} plans={cardPaymentPerformance.plans} />
        : <div className="empty-state">{t("paymentNoSample")}</div>}
    </section>}
    {loadedDetail.financialSummary && <section className="transaction-panel card-financial-summary" data-testid="card-financial-summary">
      <div className="section-title"><div><h2><WalletCards />卡片财务汇总</h2><p>本金、费用、钱包影响和商户消费分别统计。</p></div>{loadedDetail.upstreamSyncedAt && <span>同步于 {new Date(loadedDetail.upstreamSyncedAt).toLocaleString()}</span>}</div>
      <dl className="card-financial-summary-grid">
        <div><dt>可用余额</dt><dd>${formatDecimal(loadedDetail.financialSummary.availableBalance)}</dd></div>
        <div><dt>累计本金</dt><dd>${formatDecimal(loadedDetail.financialSummary.totalPrincipalIn)}</dd><small>开卡 ${formatDecimal(loadedDetail.financialSummary.openingPrincipal)} · 充值 ${formatDecimal(loadedDetail.financialSummary.rechargePrincipal)}</small></div>
        <div><dt>钱包实际扣款</dt><dd>${formatDecimal(loadedDetail.financialSummary.walletDebited)}</dd></div>
        <div><dt>退回钱包</dt><dd>${formatDecimal(loadedDetail.financialSummary.walletRefunded)}</dd></div>
        <div><dt>平台费用</dt><dd>${formatDecimal(loadedDetail.financialSummary.platformFees)}</dd></div>
        <div><dt>成功消费</dt><dd>${formatDecimal(loadedDetail.financialSummary.settledSpend)}</dd></div>
        <div><dt>商户退款</dt><dd>${formatDecimal(loadedDetail.financialSummary.merchantRefunds)}</dd></div>
        <div><dt>冻结授权</dt><dd>${formatDecimal(loadedDetail.financialSummary.heldAmount)}</dd></div>
        <div><dt>有效授权</dt><dd>{loadedDetail.financialSummary.transactionCount}</dd></div>
        <div><dt>拒付率</dt><dd>{loadedDetail.financialSummary.declineRateBps === null ? "—" : `${formatDecimal((loadedDetail.financialSummary.declineRateBps / 100).toFixed(2))}%`}</dd><small>{loadedDetail.financialSummary.declineCount} 笔失败</small></div>
      </dl>
    </section>}
    <section className="transaction-panel card-operations-panel">
      <div className="section-title"><div><h2><CreditCard /> {t("cardOperations")}</h2><p>{t("cardOperationsDesc")}</p></div><span className={`card-status-badge is-${statusClass}`}>{statusLabel}</span></div>
      <p className="card-operation-warning"><ShieldCheck />{t("cardDeclineDeleteWarning", { count: loadedDetail.autoDeleteDeclines })}</p>
      {operationPending && <div className={`card-pending-operation ${operation.data?.data.status === "RECONCILE_REQUIRED" ? "is-warning" : ""}`} role="status">
        <span className="card-pending-operation-icon"><Clock3 /></span>
        {gptOrderPending ? <div>
          <strong>直充订单占用此卡</strong>
          <small>请到直充订单详情查看进度或处理提示。订单资金处理完成后，充值与退款将恢复。</small>
          <Link to="/gpt-direct/orders/$orderId" params={{ orderId: trackedOperationId! }}>查看直充订单</Link>
        </div> : <>
          <div><strong>{pendingStatus}</strong><small>{pendingOperationCopy}</small></div>
          {operation.data?.data.type !== "REFUND" && <span className="card-pending-operation-state">{operation.data?.data.status ?? t("processing")}</span>}
        </>}
      </div>}
      {readOnlyCard ? <div className="card-closed-state" role="status">{t(upstreamClosed && !loadedDetail.closureReason ? "cardUpstreamClosedHint" : cardClosing ? "cardClosingHint" : "cardClosedHint")}{loadedDetail.closureReason && <p>{loadedDetail.closureReason}</p>}</div> : <>
        <div className="card-operation-body"><dl><div><dt>{t("rechargeAmountRangeLabel")}</dt><dd>${formatDecimal(loadedDetail.minAmount)}–${formatDecimal(loadedDetail.maxAmount)}</dd></div><div><dt>{t("rechargeRate")}</dt><dd>{rate(loadedDetail.rechargeRate)}</dd></div><div className="refund-rate-field"><dt>{t("transactionRefundRate")}</dt><dd data-testid="card-refund-rate">{rate(loadedDetail.refundRate)}</dd><small>{t("transactionRefundRateHint")}</small></div><div><dt>{t("refundableAmount")}</dt><dd>${formatDecimal(maximumRefund)}</dd></div></dl>
          <div className="card-operation-actions">
          {flags.cardRecharge && loadedDetail.status === "ACTIVE" && <Button type="button" onClick={() => { setActionError(""); setActionAmount(""); setDialogAction("recharge"); }} disabled={action.isPending || operationPending}>{t("recharge")}</Button>}
          {flags.cardManagement && loadedDetail.status === "ACTIVE" && <Button type="button" variant="secondary" onClick={() => { setActionError(""); setActionAmount(""); setDialogAction("refund"); }} title={t("refundMinimumAmountHint")} disabled={action.isPending || operationPending || Number(maximumRefund) < 1}>{t("refund")}</Button>}
          {flags.cardManagement && (loadedDetail.status === "ACTIVE" ? <Button type="button" variant="outline" onClick={() => runAction("freeze")} disabled={action.isPending || operationPending}><Snowflake />{t("freeze")}</Button> : loadedDetail.status === "FROZEN" ? <Button type="button" variant="outline" onClick={() => runAction("unfreeze")} disabled={action.isPending || operationPending}><Snowflake />{t("unfreeze")}</Button> : null)}
          {flags.cardDelete && loadedDetail.status === "ACTIVE" && <Button type="button" variant="destructive" onClick={() => { setActionError(""); setActionAmount(""); setDialogAction("delete"); }} disabled={action.isPending || operationPending}><Trash2 />{t("deleteCard")}</Button>}
          </div>
        </div>
        <ProductFeeDetails product={loadedDetail} />
      </>}
      {operationFailure && !syncNotice && <p role="alert" className="error">{operationFailure}</p>}
      {actionError && !dialogAction && <p role="alert" className="error">{actionError}</p>}
    </section>
    <section className="transaction-panel" data-testid="card-funds-activities">
      <div className="section-title"><div><h2><ReceiptText />统一卡流水</h2><p>开卡、充值、退款、销卡退款、费用和消费按时间合并展示。</p></div><span>{unifiedLedger.length}</span></div>
      {unifiedLedger.length === 0 ? <div className="empty-state">暂无卡片流水</div> : unifiedLedger.map((entry) => {
        if (entry.kind === "activity") {
          const displayType = entry.item.displayType || entry.item.type;
          const title = displayType === "DELETED_CARD_RETURN" ? t("cardDeletedReturn")
            : displayType === "DECLINE_FEE" ? (entry.item.remark || t("cardDeclineFeeActivity"))
              : displayType === "DELETE" ? t("cardDeleteRefundActivity")
                : entry.item.type;
          const credit = displayType === "REFUND" || displayType === "DELETE" || displayType === "DELETED_CARD_RETURN";
          return <article className="transaction-row card-ledger-row" key={`activity-${entry.item.id}`}>
          <div className="transaction-icon"><WalletCards /></div>
          <div><strong>{title}</strong><small>{entry.item.status} · {new Date(entry.occurredAt).toLocaleString()}</small><small>影响：{entry.item.balanceImpact === "WALLET" ? "钱包余额" : "卡余额与钱包余额"} · 手续费 ${formatDecimal(entry.item.fee)} · 钱包金额 ${formatDecimal(entry.item.totalAmount)}</small>{entry.item.remark && displayType !== "DECLINE_FEE" ? <small>{entry.item.remark}</small> : null}</div>
          <span className={credit ? "positive" : "negative"}>{credit ? "+" : "-"}${formatDecimal(entry.item.amount)}</span>
        </article>;
        }
        const refunded = entry.item.status === "REFUNDED" || entry.item.status === "PARTIALLY_REFUNDED";
        const amount = entry.item.status === "PENDING" ? `${t("cardAuthorizationHold")} ${formatDecimal(entry.item.authorizedAmount)} ${entry.item.authCurrency}`
          : entry.item.status === "SETTLED" ? `-${formatDecimal(entry.item.settledAmount)} ${entry.item.settleCurrency}`
            : refunded ? `${t("cardTransactionRefunded")} +${formatDecimal(entry.item.refundedAmount)} ${entry.item.settleCurrency}`
              : t(entry.item.status === "REVERSED" ? "cardTransactionReversed" : "cardTransactionDeclined");
        return <div className="card-ledger-transaction" key={`transaction-${entry.item.providerId}-${entry.item.authId}`}>
          <button type="button" className="transaction-row" onClick={() => setExpandedTransaction((current) => current === entry.item.authId ? null : entry.item.authId)} aria-expanded={expandedTransaction === entry.item.authId}>
            <div className="transaction-icon"><ReceiptText /></div>
            <div><strong>{entry.item.merchantName || entry.item.description || "未知商户"}</strong><small>{entry.item.authId} · {entry.item.status} · {new Date(entry.occurredAt).toLocaleString()}</small><small>{[entry.item.merchantLocation, entry.item.merchantRegion, entry.item.merchantCountry, entry.item.failedReason].filter(Boolean).join(" · ") || "商户消费"}</small></div>
            <span className={refunded ? "positive" : entry.item.status === "SETTLED" ? "negative" : undefined}>{formatDecimal(amount)}</span>
          </button>
          <div className="card-ledger-disclosure" data-open={expandedTransaction === entry.item.authId} aria-hidden={expandedTransaction !== entry.item.authId}><div><div className="card-ledger-lifecycle">{entry.item.events.map((event) => <div key={event.id}><strong>{event.type} · {event.status}</strong><span>{new Date(event.authTime).toLocaleString()}</span><small>{formatDecimal(event.type === "Authorization" ? event.authAmount : event.settleAmount)} {event.type === "Authorization" ? event.authCurrency : event.settleCurrency}{event.failedReason ? ` · ${event.failedReason}` : ""}</small></div>)}</div></div></div>
        </div>;
      })}
    </section>
    {Boolean(transactions.data?.data.upstreamRecharges?.length) && <section className="transaction-panel" data-testid="card-upstream-recharges">
      <div className="section-title"><div><h2><WalletCards />上游充值记录</h2><p>直接读取已同步的上游记录，包含在上游操作的充值。可能与本站流水重复，不重复计入钱包扣款；部分产品不含开卡初始入金。</p></div><span>最近 {transactions.data!.data.upstreamRecharges!.length} / {transactions.data!.data.upstreamRechargeTotal ?? transactions.data!.data.upstreamRecharges!.length} 笔</span></div>
      {transactions.data!.data.upstreamRecharges!.map((recharge) => <article className="transaction-row" key={recharge.id}>
        <div className="transaction-icon"><WalletCards /></div>
        <div><strong>卡充值 · #{recharge.id}</strong><small>{recharge.status} · {new Date(recharge.occurredAt).toLocaleString()}</small><small>上游手续费 ${formatDecimal(recharge.fee)} · 同步于 {new Date(recharge.syncedAt).toLocaleString()}</small></div>
        <span>${formatDecimal(recharge.amount)}</span>
      </article>)}
    </section>}
    <Dialog.Root open={dialogAction !== null} onOpenChange={(open) => { if (!open && !action.isPending) { setDialogAction(null); setActionAmount(""); } }}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content card-action-dialog">
          <Dialog.Title>{dialogAction === "recharge" ? t("rechargeCard") : dialogAction === "refund" ? t("refundCard") : t("deleteCard")}</Dialog.Title>
          <Dialog.Description>{loadedDetail.cardNumberMasked} · {t("currentBalance")} ${formatDecimal(loadedDetail.availableAmount)}</Dialog.Description>
          {dialogAction === "delete" ? <div className="card-delete-confirmation">
            <p>{t("deleteCardWarning")}</p>
            {actionError && <p role="alert" className="error">{actionError}</p>}
            <div><Dialog.Close asChild><Button type="button" variant="outline" disabled={action.isPending}>{t("cancel")}</Button></Dialog.Close><Button type="button" variant="destructive" onClick={() => runAction("delete")} disabled={action.isPending}>{action.isPending ? t("processing") : t("confirmDeleteCard")}</Button></div>
          </div> : <form onSubmit={submitCardAction}>
            {dialogAction === "refund" && <p>{t("refundBalanceSyncHint")}</p>}
            <label>{t("amountUsd")}<input name="amount" type="number" inputMode="decimal" step="0.0001" min={dialogAction === "recharge" ? loadedDetail.minAmount : "1"} max={dialogAction === "recharge" ? loadedDetail.maxAmount : maximumRefund} placeholder={dialogAction === "recharge" ? loadedDetail.minAmount : maximumRefund} value={actionAmount} onChange={(event) => { setActionAmount(event.target.value); setActionError(""); }} disabled={action.isPending} required /><small>{dialogAction === "recharge" ? t("rechargeAmountRange", { min: formatDecimal(loadedDetail.minAmount), max: formatDecimal(loadedDetail.maxAmount) }) : t("refundAmountRange", { max: formatDecimal(maximumRefund), minimum: formatDecimal(loadedDetail.refundKeepMinimum) })}</small></label>
            {dialogAction === "recharge" && <CardRechargeQuoteSummary amount={actionAmount} amountIsValid={rechargeQuote.amountIsValid} isFetching={rechargeQuote.isFetching} isError={rechargeQuote.isError} quote={rechargeQuote.currentQuote} error={rechargeQuote.error} spendableBalance={spendableBalance} onRetry={() => { void rechargeQuote.refetch(); }} />}
            {actionError && <p role="alert" className="error">{actionError}</p>}
            <div className="card-action-dialog-buttons"><Dialog.Close asChild><Button type="button" variant="outline" disabled={action.isPending}>{t("cancel")}</Button></Dialog.Close><Button type="submit" disabled={action.isPending || (dialogAction === "recharge" && (!rechargeQuote.currentQuote || rechargeQuote.isFetching || rechargeQuote.isError || rechargeDebitExceedsSpendable(rechargeQuote.currentQuote.totalDebit, spendableBalance)))}>{action.isPending ? t("processing") : t("confirmAction")}</Button></div>
          </form>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </PageShell>;
}
