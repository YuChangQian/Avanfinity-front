import { LedgerFilters } from "../components/LedgerFilters";
import type { LedgerFilters as LedgerFilterValues } from "../api";
import { formatDecimal } from "../decimal";
import { useState, type FormEvent } from "react";
import { useAtomValue } from "jotai";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate } from "@tanstack/react-router";
import { ArrowUpRight, Send, WalletCards } from "lucide-react";
import { Dialog } from "radix-ui";
import { Button } from "@/components/ui/button";
import { StableSwap } from "../components/StableSwap";
import { formatRateBps } from "../components/PaymentPerformance";
import { DataSkeleton } from "../components/PageShell";
import { getWallet, getWalletTransactions, requestTransferChallenge, transfer, type TransferChallenge } from "../api";
import { sessionAtom } from "../state";
import { useTranslation } from "react-i18next";
import { useFeatures } from "../features";

export function FinancePage() {
  const session = useAtomValue(sessionAtom);
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { flags } = useFeatures();
  const [error, setError] = useState("");
  const [ledgerFilters, setLedgerFilters] = useState<LedgerFilterValues>({});
  const [ledgerPage, setLedgerPage] = useState(1);
  const [transferOpen, setTransferOpen] = useState(false);
  const [recipientCode, setRecipientCode] = useState("");
  const [amount, setAmount] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [challenge, setChallenge] = useState<TransferChallenge | null>(null);
  const wallet = useQuery({
    queryKey: ["wallet"],
    queryFn: () => getWallet(session!.token),
    enabled: Boolean(session),
    refetchInterval: 10_000,
  });
  const transactions = useQuery({
    queryKey: ["wallet-transactions", ledgerFilters, ledgerPage],
    queryFn: () => getWalletTransactions(session!.token, ledgerFilters, ledgerPage),
    placeholderData: keepPreviousData,
    enabled: Boolean(session),
    refetchInterval: 10_000,
  });
  const mutation = useMutation({
    mutationFn: () => transfer(session!.token, recipientCode, amount, challenge!.challengeId, verificationCode, challenge!.idempotencyKey),
    onSuccess: async () => {
      setError("");
      setTransferOpen(false);
      setRecipientCode(""); setAmount(""); setVerificationCode(""); setChallenge(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["wallet"] }),
        queryClient.invalidateQueries({ queryKey: ["wallet-transactions"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : "Transfer failed"),
  });
  const challengeMutation = useMutation({
    mutationFn: () => requestTransferChallenge(session!.token, recipientCode, amount),
    onSuccess: ({ data }) => { setError(""); setChallenge(data); setVerificationCode(""); },
    onError: (cause) => setError(cause instanceof Error ? cause.message : "Verification code delivery failed"),
  });

  if (!session) return <Navigate to="/login" />;
  if (!wallet.data || transactions.isLoading) return <main className="finance-page" aria-busy="true">
    <header><div><span className="eyebrow">MONEY MOVEMENT</span><h1>{t("financeTitle")}</h1><p>{t("financeDesc")}</p></div>
      {flags.walletTransfer && <Button size="lg" disabled><Send /> {t("transfer")}</Button>}
    </header>
    <section className="finance-balance-grid">
      {["totalBalance", "riskLockedBalance", "spendableBalance"].map((label, index) => <div className={`finance-balance ${index === 1 ? "is-locked" : index === 2 ? "is-spendable" : ""}`} key={label}>
        <div className="stat-icon"><WalletCards /></div><span>{t(label)}</span><strong>$<DataSkeleton /></strong>
      </div>)}
    </section>
    <section className="transaction-panel payment-risk-summary">
      <div className="section-title"><div><h2>{t("customerPaymentPerformance")}</h2><p>{t("customerPaymentPerformanceHint", { days: 30 })}</p></div><DataSkeleton /></div>
      <div className="payment-risk-body"><div className="payment-risk-meter"><DataSkeleton /></div><dl className="payment-risk-metrics">
        {["paymentAttempts", "paymentSuccessRate", "paymentDeclineRate", "riskReserveRatio"].map((label) => <div key={label}><dt>{t(label)}</dt><dd><DataSkeleton /></dd></div>)}
      </dl></div>
    </section>
    <section className="transaction-panel">
      <div className="section-title"><h2>{t("ledger")}</h2><DataSkeleton /></div>
      {[0, 1, 2].map((item) => <article className="transaction-row" key={item}><div className="transaction-icon"><ArrowUpRight /></div><div><strong><DataSkeleton /></strong><small><DataSkeleton /></small></div><span><DataSkeleton /></span></article>)}
    </section>
  </main>;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!flags.walletTransfer) return;
    if (challenge) mutation.mutate();
    else challengeMutation.mutate();
  }

  function changeTransferTarget(nextRecipient: string, nextAmount: string) {
    setRecipientCode(nextRecipient); setAmount(nextAmount); setChallenge(null); setVerificationCode(""); setError("");
  }

  const { balance, lockedBalance = "0.0000", spendableBalance = balance, paymentRisk } = wallet.data.data;
  const declineRate = formatRateBps(paymentRisk?.declineRateBps);
  const successRate = formatRateBps(paymentRisk?.successRateBps);
  const successShare = paymentRisk && paymentRisk.attempts > 0 && paymentRisk.successRateBps !== null && paymentRisk.successRateBps !== undefined
    ? Math.min(100, Math.max(0, paymentRisk.successRateBps / 100))
    : null;

  return <main className="finance-page">
    <header><div><span className="eyebrow">MONEY MOVEMENT</span><h1>{t("financeTitle")}</h1><p>{t("financeDesc")}</p></div>
      {flags.walletTransfer && <Dialog.Root open={transferOpen} onOpenChange={(open) => { setTransferOpen(open); if (!open) { setChallenge(null); setVerificationCode(""); setError(""); } }}>
        <Dialog.Trigger asChild><Button size="lg"><Send /> {t("transfer")}</Button></Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content">
            <Dialog.Title>{t("transfer")}</Dialog.Title>
            <Dialog.Description>{t("transferWarning")}</Dialog.Description>
            <form onSubmit={submit}>
              <label>{t("recipientInviteCode")}<input name="recipientCode" value={recipientCode} onChange={(event) => changeTransferTarget(event.target.value, amount)} autoComplete="off" minLength={3} maxLength={32} pattern="[A-Za-z0-9-]+" placeholder={t("recipientInviteCodePlaceholder")} disabled={Boolean(challenge)} required /></label>
              <small className="field-hint">{t("recipientInviteCodeHint")}</small>
              <label>{t("transferAmount")}<input name="amount" value={amount} onChange={(event) => changeTransferTarget(recipientCode, event.target.value)} inputMode="decimal" pattern="[0-9]+([.][0-9]{1,4})?" placeholder="10.00" disabled={Boolean(challenge)} required /></label>
              {challenge && <><p className="transfer-verification-hint">{t(challenge.deliveryChannel === "telegram" ? "transferCodeSentTelegram" : "transferCodeSentEmail", { destination: challenge.destination })}</p><label>{t("transferVerificationCode")}<input value={verificationCode} onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} placeholder="000000" required /></label>{challenge.deliveryChannel === "email" && <small className="field-hint">{t("transferEmailSpamHint")}</small>}</>}
              {error && <p role="alert" className="error">{error}</p>}
              <Button type="submit" disabled={mutation.isPending || challengeMutation.isPending} size="lg"><StableSwap state={challengeMutation.isPending ? "code" : mutation.isPending ? "transfer" : challenge ? "confirm" : "send"} labels={{ send: t("sendTransferVerificationCode"), code: t("sendingVerificationCode"), transfer: t("transferring"), confirm: t("confirmTransfer") }} /></Button>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>}
    </header>
    <section className="finance-balance-grid" data-testid="wallet-balance-summary">
      <div className="finance-balance"><div className="stat-icon"><WalletCards /></div><span>{t("totalBalance")}</span><strong>${formatDecimal(balance)}</strong></div>
      <div className="finance-balance is-locked"><div className="stat-icon"><WalletCards /></div><span>{t("riskLockedBalance")}</span><strong>${formatDecimal(lockedBalance)}</strong></div>
      <div className="finance-balance is-spendable"><div className="stat-icon"><WalletCards /></div><span>{t("spendableBalance")}</span><strong>${formatDecimal(spendableBalance)}</strong></div>
    </section>
    {paymentRisk?.enabled && <section className="transaction-panel payment-risk-summary" data-testid="payment-risk-summary">
      <div className="section-title"><div><h2>{t("customerPaymentPerformance")}</h2><p>{t("customerPaymentPerformanceHint", { days: paymentRisk?.windowDays ?? 30 })}</p></div><span className={`status-pill ${paymentRisk?.reserveActive ? "is-warning" : "is-active"}`}>{t(paymentRisk?.reserveActive ? "paymentReserveActive" : "paymentReserveInactive")}</span></div>
      {paymentRisk && <p className="payment-risk-boundary">{t("paymentRiskReleaseBoundary", { rate: formatRateBps(paymentRisk.releaseThresholdBps) })}</p>}
      {!paymentRisk || paymentRisk.attempts === 0 || declineRate === null ? <div className="empty-state">{t("paymentNoSample")}</div> : <div className="payment-risk-body">
        {successShare !== null && <div className="payment-risk-meter" aria-hidden="true"><span className="payment-risk-meter-success" style={{ width: `${successShare}%` }} /></div>}
        <dl className="payment-risk-metrics">
          <div><dt>{t("paymentAttempts")}</dt><dd>{paymentRisk.attempts}</dd></div>
          <div className="is-success"><dt>{t("paymentSuccessRate")}</dt><dd>{successRate}</dd></div>
          <div className="is-decline"><dt>{t("paymentDeclineRate")}</dt><dd>{declineRate}</dd></div>
          <div><dt>{t("riskReserveRatio")}</dt><dd>{formatRateBps(paymentRisk.reserveBps)}</dd></div>
        </dl>
      </div>}
    </section>}
    <section className="transaction-panel">
      <div className="section-title"><h2>{t("ledger")}</h2><span>{t("records", { count: transactions.data?.data.total ?? 0 })}</span></div>
      <LedgerFilters id="wallet-ledger-filter" applied={ledgerFilters} wallet types={transactions.data?.data.types ?? ["deposit", "card_open", "card_recharge", "card_refund", "card_transaction_fee", "transfer_in", "transfer_out"]} onApply={filters => {if (ledgerPage === 1 && JSON.stringify(filters) === JSON.stringify(ledgerFilters)) void transactions.refetch();setLedgerFilters(filters);setLedgerPage(1);}} />
      {transactions.isPlaceholderData && <p role="status">{t("loading")}</p>}
      {transactions.isError && <p role="alert" className="error">{t("adminLoadFailed")}</p>}
      {(transactions.data?.data.list.length ?? 0) === 0 ? <div className="empty-state">{t("noLedger")}</div> :
        transactions.data?.data.list.map((item) => <article className="transaction-row" key={item.id}>
          <div className="transaction-icon"><ArrowUpRight /></div>
          <div><strong>{(item.feeKinds?.length ? item.feeKinds : item.feeKind ? [item.feeKind] : []).map(kind => t(`ledgerFees.${kind}`, { defaultValue: kind })).join(" / ")}{(item.feeKinds?.length || item.feeKind) ? " · " : ""}{item.remark ?? t(`ledgerTypes.${item.type}`, { defaultValue: item.type })}</strong><small>{new Date(item.createdAt).toLocaleString()}</small></div>
          <span className={Number(item.amount) >= 0 ? "positive" : "negative"}>{Number(item.amount) >= 0 ? "+" : ""}${formatDecimal(item.amount)}</span>
        </article>)}
      <div className="admin-pagination" data-testid="wallet-ledger-pagination"><span>{t("totalItems", { count: transactions.data?.data.total ?? 0 })}</span><div>
        <Button size="xs" variant="outline" disabled={ledgerPage <= 1 || transactions.isFetching} onClick={() => setLedgerPage(page => page - 1)}>{t("previousPage")}</Button><span>{ledgerPage}</span>
        <Button size="xs" variant="outline" disabled={ledgerPage * 20 >= (transactions.data?.data.total ?? 0) || transactions.isFetching} onClick={() => setLedgerPage(page => page + 1)}>{t("nextPage")}</Button>
      </div></div>
    </section>
  </main>;
}
