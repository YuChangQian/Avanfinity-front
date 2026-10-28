import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { StableSwap } from "../components/StableSwap";
import { ApiError, PendingOperationError, getCardDetail, getCardOperation, getCardRechargeQuote, getWallet, runCardAction, syncCard, type CardRechargeQuote } from "../api";
import { formatDecimal } from "../decimal";
import { fundingAmount, fundingCovered, fundingTotal } from "../gptCardFunding";

type FundingIntent = { key: string; amount: string; fee: string; operationId?: string; succeeded?: boolean };
type Review = { balance: string; quote: CardRechargeQuote; wallet: string; total: string; serviceFee: string };

export function GptExistingCardCheckout({ token, userKey, cardId, estimateUsd, serviceFee, expiresAt, disabled, canRecharge, hasDispatched, onBusy, onContinue, submitLabel }: {
  token: string; userKey: string; cardId: number; estimateUsd: string; serviceFee: string;
  expiresAt?: string; disabled: boolean; canRecharge: boolean; hasDispatched: () => boolean;
  onBusy: (busy: boolean) => void; onContinue: () => Promise<void>;
  submitLabel?: string;
}) {
  const { t } = useTranslation();
  const storageKey = `gpt-card-funding:${userKey}:${cardId}`;
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const running = useRef(false);

  function readIntent(): FundingIntent | null {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const value = JSON.parse(raw) as FundingIntent;
    if (!value || typeof value.key !== "string" || !/^[0-9a-f-]{36}$/.test(value.key)
      || typeof value.amount !== "string" || typeof value.fee !== "string"
      || (value.operationId !== undefined && typeof value.operationId !== "string")
      || (value.succeeded !== undefined && typeof value.succeeded !== "boolean")) throw new Error(t("gptFundingStorageError"));
    fundingTotal(value.amount, value.fee);
    return value;
  }

  function saveIntent(intent: FundingIntent) {
    // Persist only the recharge request, never Session/access tokens or card secrets.
    localStorage.setItem(storageKey, JSON.stringify(intent));
  }

  function requireFreshPreflight() {
    if (!expiresAt || !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now()) {
      throw new Error(t("gptFundingExpired"));
    }
  }

  async function balanceAndAmount() {
    let card = (await getCardDetail(token, cardId)).data;
    if (card.pendingOperationId || card.status !== "ACTIVE") throw new Error(t("gptFundingCardBusy"));
    let balance = card.availableAmount;
    const age = Date.now() - Date.parse(card.upstreamSyncedAt ?? "");
    if (!Number.isFinite(age) || age < -5_000 || age >= 60_000) {
      const sync = (await syncCard(token, cardId)).data;
      if (!sync.balanceSnapshotApplied || sync.status !== "ACTIVE") throw new Error(t("gptFundingSyncFailed"));
      balance = sync.balance;
      card = (await getCardDetail(token, cardId)).data;
      if (card.pendingOperationId || card.status !== "ACTIVE") throw new Error(t("gptFundingCardBusy"));
    }
    try {
      return { balance, amount: fundingAmount(balance, estimateUsd, card.minAmount, card.maxAmount) };
    } catch {
      throw new Error(t("gptFundingEstimateInvalid"));
    }
  }

  async function prepare(): Promise<Review | null> {
    requireFreshPreflight();
    const { balance, amount } = await balanceAndAmount();
    if (amount === "0.0000") return null;
    if (!canRecharge) throw new Error(t("gptFundingUnavailable"));
    const [quoted, wallet] = await Promise.all([getCardRechargeQuote(token, cardId, amount), getWallet(token)]);
    const quote = quoted.data;
    if (!fundingCovered(quote.amount, amount) || !fundingCovered(amount, quote.amount)
      || fundingTotal(quote.amount, quote.fee) !== fundingTotal(quote.totalDebit, "0")) throw new Error(t("gptFundingQuoteInvalid"));
    return { balance, quote, wallet: wallet.data.spendableBalance ?? wallet.data.balance, total: fundingTotal(quote.totalDebit, serviceFee), serviceFee };
  }

  async function finishFunding(intent: FundingIntent) {
    saveIntent({ ...intent, succeeded: true });
    setPending(true);
    requireFreshPreflight();
    const { amount } = await balanceAndAmount();
    if (amount !== "0.0000") throw new Error(t("gptFundingBalanceChanged"));
    localStorage.removeItem(storageKey);
    setPending(false);
    setReview(null);
    await onContinue();
  }

  async function resume(intent: FundingIntent) {
    setPending(true);
    if (intent.succeeded) return finishFunding(intent);
    if (intent.operationId) {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const operation = (await getCardOperation(token, intent.operationId)).data;
        if (operation.type !== "RECHARGE") throw new Error(t("gptFundingStorageError"));
        if (operation.status === "SUCCEEDED") return finishFunding(intent);
        if (operation.status === "FAILED" && operation.terminal) {
          localStorage.removeItem(storageKey);
          setPending(false);
          setReview(null);
          throw new Error(t("gptFundingFailed"));
        }
        if (operation.status === "RECONCILE_REQUIRED" || attempt === 3) break;
        await new Promise(resolve => window.setTimeout(resolve, 2_000));
      }
      throw new Error(t("gptFundingPending"));
    }
    // A timeout must replay the exact request/key; never generate a second top-up.
    requireFreshPreflight();
    try {
      await runCardAction(token, cardId, "recharge", intent.key, intent.amount, intent.fee);
    } catch (cause) {
      if (cause instanceof PendingOperationError && cause.operationId) {
        const queued = { ...intent, operationId: cause.operationId };
        saveIntent(queued);
        return resume(queued);
      }
      if (cause instanceof ApiError && cause.errorCode === "PRICE_CHANGED") {
        localStorage.removeItem(storageKey);
        setPending(false);
        setReview(null);
        throw new Error(t("rechargePriceChanged"), { cause });
      }
      throw cause;
    }
    return finishFunding(intent);
  }

  async function execute(confirm: boolean) {
    if (running.current) return;
    running.current = true;
    onBusy(true);
    setError("");
    try {
      if (hasDispatched()) return await onContinue();
      const work = async () => {
        const existing = readIntent();
        if (existing) return resume(existing);
        const latest = await prepare();
        if (!latest) { setReview(null); return onContinue(); }
        if (!confirm || !review || review.quote.amount !== latest.quote.amount || review.quote.fee !== latest.quote.fee || review.total !== latest.total) {
          setReview(latest);
          if (confirm) setError(t("gptFundingQuoteChanged"));
          return;
        }
        setReview(latest);
        if (!fundingCovered(latest.wallet, latest.total)) throw new Error(t("gptFundingWalletLow"));
        requireFreshPreflight();
        const intent = { key: crypto.randomUUID(), amount: latest.quote.amount, fee: latest.quote.fee };
        saveIntent(intent);
        return resume(intent);
      };
      // Serialize this browser's tabs; the existing backend provides financial idempotency.
      if (navigator.locks) await navigator.locks.request(storageKey, work);
      else await work();
    } catch (cause) {
      setError(cause instanceof PendingOperationError ? t("gptFundingPending") : cause instanceof Error ? cause.message : t("gptFundingSyncFailed"));
    } finally {
      running.current = false;
      onBusy(false);
    }
  }

  return <div data-testid="gpt-existing-checkout">
    {review && <div className="gpt-auto-card-review" data-testid="gpt-funding-review">
      <strong>{t("gptFundingTitle")}</strong>
      <dl>
        <div><dt>{t("gptFundingCardBalance")}</dt><dd>${formatDecimal(review.balance)}</dd></div>
        <div><dt>{t("gptSubscriptionEstimateUsd")}</dt><dd>${formatDecimal(estimateUsd)}</dd></div>
        <div><dt>{t("rechargeQuoteAmount")}</dt><dd>${formatDecimal(review.quote.amount)}</dd></div>
        <div><dt>{t("gptFundingFee")}</dt><dd>${formatDecimal(review.quote.fee)}</dd></div>
        <div><dt>{t("gptServiceFeeLabel")}</dt><dd>${formatDecimal(review.serviceFee)}</dd></div>
        <div><dt>{t("gptFundingTotal")}</dt><dd>${formatDecimal(review.total)}</dd></div>
        <div><dt>{t("gptFundingWallet")}</dt><dd>${formatDecimal(review.wallet)}</dd></div>
      </dl>
      <p>{t("gptFundingNotice")}</p>
      {!fundingCovered(review.wallet, review.total) && <p role="alert">{t("gptFundingWalletLow")} <Link to="/finance">{t("gptFundingDeposit")}</Link></p>}
    </div>}
    {error && <p role="alert" className="error">{error} <Link to="/cards/$cardId" params={{ cardId: String(cardId) }}>{t("gptFundingViewCard")}</Link></p>}
    {pending && <p role="status">{t("gptFundingPending")} <Link to="/cards/$cardId" params={{ cardId: String(cardId) }}>{t("gptFundingViewCard")}</Link></p>}
    <Button size="lg" disabled={disabled && !pending || running.current || Boolean(review && !pending && !fundingCovered(review.wallet, review.total))} onClick={() => void execute(Boolean(review))}>
      <StableSwap state={running.current ? "busy" : pending ? "check" : review ? "confirm" : "idle"} labels={{ idle: t(submitLabel ?? "gptSubmitOrder"), check: t("gptFundingCheck"), confirm: t("gptFundingConfirm"), busy: t("processing") }} />
    </Button>
    {review && !pending && <Button variant="outline" disabled={running.current} onClick={() => { setReview(null); setError(""); }}>{t("cancel")}</Button>}
  </div>;
}
