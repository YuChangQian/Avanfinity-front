import { t } from "i18next";
import { useTranslation } from "react-i18next";
import { tgPlanLabel } from "./TgOrderStatus";
import { Notice } from "./ui/notice";
import { useRef, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Copy, Download, KeyRound } from "lucide-react";
import { ApiError, exportTgDirectCdk, generateTgDirectCdks, getProducts, getTgDirectCdks, revokeTgDirectCdk, type Card, type TgDirectCdk, type TgDirectPlan } from "../api";
import { formatDecimal, shiftDecimal } from "../decimal";
import { Button } from "./ui/button";
import { StableSwap } from "./StableSwap";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

const statuses: Record<string, string> = { get unused() { return t("serviceText.unused"); }, get preparing() { return t("serviceText.runningPreflight2"); }, get prepared() { return t("serviceText.awaitingConfirmation2"); }, get funding() { return t("serviceText.preparingPaymentCard"); }, get funded() { return t("serviceText.paymentCardReady"); }, get paying() { return t("serviceText.paying"); }, get review_required() { return t("serviceText.underReview"); }, get completed() { return t("serviceText.completed"); }, get failed_precharge() { return t("serviceText.redemptionIncomplete"); }, get ineligible() { return t("serviceText.accountIneligible"); }, get revoked() { return t("serviceText.revoked"); }, get paid_pending_delivery() { return t("serviceText.paidAwaitingDelivery"); } };

export function TgDirectCdkPanel({ token, plans, cards }: { token: string; plans: TgDirectPlan[]; cards: Card[] }) {
  useTranslation();
  const tier = "premium";
  const [duration, setDuration] = useState("3m");
  const plan = `${tier}_${duration}`;
  const [mode, setMode] = useState("existing");
  const [cardId, setCardId] = useState("");
  const [productCode, setProductCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [issued, setIssued] = useState<TgDirectCdk[]>([]);
  const intent = useRef<{ fingerprint: string; key: string } | null>(null);
  const cdks = useQuery({ queryKey: ["tg-direct-cdks", token], queryFn: () => getTgDirectCdks(token), retry: false });
  const products = useQuery({ queryKey: ["tg-cdk-products", token], queryFn: () => getProducts(token), enabled: mode === "new", retry: false });
  const product = products.data?.data.find(item => item.productCode === productCode);
  const unused = (cdks.data?.data.list ?? []).filter(item => item.status === "unused");
  function fail(cause: unknown, fallback: string) {
    if (cause instanceof ApiError && cause.errorCode === "RECENT_AUTH_REQUIRED") {
      sessionStorage.setItem("recentAuthReturnPath", "/tg-direct?tab=cdk");
      window.location.assign("/login");
    } else setError(fallback);
  }
  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    const officialMinor = shiftDecimal(String(data.get("officialAmount")), 2, 0);
    if (!officialMinor || !Number.isSafeInteger(Number(officialMinor)) || Number(officialMinor) <= 0) { setError(t("serviceText.officialAmountLimitMustBeGreaterThan0")); return; }
    const input = {
      plan, quantity: Number(data.get("quantity")), fundingAmountUsd: String(data.get("fundingAmountUsd")),
      maxWalletDebitUsd: String(data.get("maxWalletDebitUsd")), maxOfficialAmountMinor: Number(officialMinor), currency: "USD",
      ...(mode === "existing" ? { cardId: Number(cardId) } : { autoCard: { productCode, firstName: String(data.get("firstName")).trim(), lastName: String(data.get("lastName")).trim() } }),
    };
    const fingerprint = JSON.stringify(input);
    if (intent.current?.fingerprint !== fingerprint) intent.current = { fingerprint, key: crypto.randomUUID() };
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await generateTgDirectCdks(token, input, intent.current.key);
      setIssued(response.data.list); intent.current = null;
      setNotice(t("serviceText.generatedCdksForFreeStoreTheRedemptionCodes", { count: response.data.list.length }));
      await cdks.refetch();
    } catch (cause) { fail(cause, t("serviceText.generationFailedCheckTheAuthorizedAmountsAndCard")); }
    finally { setBusy(false); }
  }
  async function copy(id: string) {
    setBusy(true); setError("");
    try { const response = await exportTgDirectCdk(token, id); await navigator.clipboard.writeText(response.data.code); setNotice(t("serviceText.redemptionCodeCopied")); }
    catch (cause) { fail(cause, t("serviceText.copyFailedRetryOrExportTheRedemptionCode")); }
    finally { setBusy(false); }
  }
  async function exportUnused() {
    setBusy(true); setError("");
    try {
      const codes = await Promise.all(unused.map(async item => (await exportTgDirectCdk(token, item.id)).data.code));
      const url = URL.createObjectURL(new Blob([codes.join("\n")], { type: "text/plain;charset=utf-8" }));
      const link = document.createElement("a"); link.href = url; link.download = "tg-cdks.txt"; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { fail(cause, t("serviceText.exportFailedRefreshTheListAndRetry")); }
    finally { setBusy(false); }
  }
  async function revoke(id: string) {
    setBusy(true); setError("");
    try { await revokeTgDirectCdk(token, id); setIssued(current => current.filter(item => item.id !== id)); await cdks.refetch(); setNotice(t("serviceText.unusedCdkRevoked")); }
    catch (cause) { fail(cause, t("serviceText.revocationFailedACdkWhoseRedemptionHasStarted")); }
    finally { setBusy(false); }
  }
  return <section className="transaction-panel gpt-cdk-market mt-5" data-testid="tg-cdk-issuer">
    <div className="section-title"><div><span className="eyebrow">TG CDK ISSUE</span><h2><KeyRound />{t("serviceText.generateTgCdksForFree")}</h2></div><Button asChild variant="outline" size="sm"><Link to="/tg-cdk/redeem">{t("serviceText.openTgCdkRedemption")}</Link></Button></div>
    <p className="gpt-cdk-market-intro">{t("serviceText.generationIsFreeOnRedemptionTheIssuerS")}</p>
    <form className="admin-system-form" onSubmit={generate}>
      <div className="admin-system-form-grid">
        <p>Telegram Premium</p>
        <label>{t("serviceText.subscriptionDuration")}<Select value={duration} onValueChange={setDuration} disabled={busy}><SelectTrigger aria-label={t("serviceText.subscriptionDuration")}><SelectValue /></SelectTrigger><SelectContent>{[["3m", t("serviceText.3Months")], ["6m", t("serviceText.6Months")], ["12m", t("serviceText.1Year")]].map(([value, label]) => <SelectItem value={value} key={value} disabled={!plans.find(item => item.key === `${tier}_${value}`)?.enabled}>{label}</SelectItem>)}</SelectContent></Select></label>
        <label>{t("serviceText.quantity2")}<input name="quantity" type="number" min="1" max="50" step="1" defaultValue="1" required disabled={busy} /></label>
        <label>{t("serviceText.paymentCardMode")}<Select value={mode} onValueChange={setMode} disabled={busy}><SelectTrigger aria-label={t("serviceText.paymentCardMode")}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="existing">{t("serviceText.useAnExistingCard")}</SelectItem><SelectItem value="new">{t("serviceText.openANewCardForEachCdk")}</SelectItem></SelectContent></Select></label>
        {mode === "existing" ? <label>{t("serviceText.paymentCard")}<Select value={cardId} onValueChange={setCardId} disabled={busy}><SelectTrigger aria-label={t("serviceText.paymentCard")}><SelectValue placeholder={t("serviceText.chooseTheIssuerSCard")} /></SelectTrigger><SelectContent>{cards.filter(card => card.status === "ACTIVE" && !card.pendingOperationId).map(card => <SelectItem key={card.id} value={String(card.id)}>{card.cardNumberMasked} · USD {card.balance}</SelectItem>)}</SelectContent></Select></label> : <>
          <label>{t("serviceText.cardProduct")}<Select value={productCode} onValueChange={setProductCode} disabled={busy || products.isLoading}><SelectTrigger aria-label={t("serviceText.cardProduct")}><SelectValue placeholder={t("serviceText.chooseACardProduct")} /></SelectTrigger><SelectContent>{products.data?.data.map(item => <SelectItem value={item.productCode} key={item.productCode}>{item.network} · {item.productCode}</SelectItem>)}</SelectContent></Select></label>
          <label>{t("serviceText.cardholderFirstName")}<input name="firstName" required maxLength={64} disabled={busy} /></label><label>{t("serviceText.cardholderLastName")}<input name="lastName" required maxLength={64} disabled={busy} /></label>
        </>}
        <label>{t("serviceText.fixedFundingAmountPerCardUsd")}<input name="fundingAmountUsd" type="number" min={mode === "new" ? product?.minAmount ?? "0.0001" : "0"} max={mode === "new" ? product?.maxAmount : undefined} step="0.0001" defaultValue="0" required disabled={busy} /></label>
        <label>{t("serviceText.walletDebitLimitPerCdkUsd")}<input name="maxWalletDebitUsd" type="number" min="0" max="10000" step="0.0001" required disabled={busy} /></label>
        <label>{t("serviceText.officialAmountLimitUsd")}<input name="officialAmount" type="number" min="0.01" step="0.01" required disabled={busy} /></label>
      </div>
      {product && mode === "new" && <p>{t("serviceText.currentCardOpeningFeeUsd")}{formatDecimal(product.openFee)}{t("serviceText.fundingFeeRate")}{formatDecimal(shiftDecimal(product.rechargeRate, 2))}{t("serviceText.actualFeesAreVerifiedBeforeExecutionProcessingStops")}</p>}
      {products.isError && mode === "new" && <Notice role="alert" className="error">{t("serviceText.failedToLoadCardProductsTryAgainLater")}</Notice>}
      <p className="admin-settings-note">{t("serviceText.theFixedFundingAmountIsAppliedAtRedemption")}</p>
      <Button type="submit" disabled={busy || !plans.find(item => item.key === plan)?.enabled || (mode === "existing" ? !cardId : !productCode || products.isError)}><StableSwap state={busy ? "busy" : "idle"} labels={{ idle: t("serviceText.generateCdksForFree"), busy: t("serviceText.processing2") }} /></Button>
    </form>
    {error && <Notice className="admin-alert is-error" role="alert">{error}</Notice>}{notice && <Notice className="admin-alert is-success" role="status">{notice}</Notice>}
    {issued.length > 0 && <div className="gpt-cdk-purchase-result"><div className="gpt-cdk-code-list">{issued.map(item => <div key={item.id}><code>{item.code ?? item.codePrefix}</code><Button size="xs" variant="outline" disabled={busy} onClick={() => void copy(item.id)}><Copy />{t("serviceText.copy")}</Button></div>)}</div></div>}
    <div className="section-title gpt-cdk-history-title"><h2>{t("serviceText.myTgCdks")}</h2><Button size="sm" variant="outline" disabled={busy || !unused.length} onClick={() => void exportUnused()}><Download />{t("serviceText.exportUnusedCdks")}</Button></div>
    {cdks.isLoading ? <p className="gpt-list-state">{t("serviceText.loadingCdks")}</p> : cdks.isError ? <Notice className="gpt-list-state" role="alert">{t("serviceText.failedToLoadCdks")}<Button variant="outline" size="sm" onClick={() => void cdks.refetch()}>{t("serviceText.retry")}</Button></Notice> : !cdks.data?.data.list.length ? <p className="gpt-list-state">{t("serviceText.noTgCdksYet")}</p> : cdks.data.data.list.map(item => <div className="gpt-order-history-row" key={item.id}><div className="gpt-order-row"><div className="gpt-order-row-main is-static"><span><strong>{item.codePrefix}</strong><small>{tgPlanLabel(item.plan, plans.find(p => p.key === item.plan)?.label)} · {statuses[item.status] ?? t("serviceText.underReview")}{item.recipient ? ` · @${item.recipient}` : ""}</small><small>{t("serviceText.redemptionWalletBudgetUsd")}{formatDecimal(item.totalWalletDebitUsd)} {t("serviceText.authorizedLimitUsd")}{formatDecimal(item.maxWalletDebitUsd)} {t("serviceText.serviceFeeUsd")}{formatDecimal(item.serviceFee)}</small><small>{item.cardId != null ? t("serviceText.paymentCard2", { cardId: item.cardId }) : ""}{t("serviceText.cardOpeningFeeUsd")}{item.openFeeUsd == null ? t("serviceText.pending") : formatDecimal(item.openFeeUsd)} {t("serviceText.fundingFeeUsd")}{item.fundingFeeUsd == null ? t("serviceText.pending") : formatDecimal(item.fundingFeeUsd)}{item.fundingDispatched ? t("serviceText.cardOpeningFundingInitiated") : ""}{item.paymentDispatched ? t("serviceText.officialPaymentInitiated") : ""}</small><small>{t("serviceText.fixedFundingUsd")}{formatDecimal(item.fundingAmountUsd)} {t("serviceText.officialLimit")}{item.currency.toUpperCase()} {(item.maxOfficialAmountMinor / 100).toFixed(2)}</small></span><span className="gpt-cdk-history-actions">{item.status === "unused" && <><Button size="xs" variant="outline" disabled={busy} onClick={() => void copy(item.id)}>{t("serviceText.copyRedemptionCode")}</Button><Button size="xs" variant="outline" disabled={busy} onClick={() => void revoke(item.id)}>{t("serviceText.revokeUnusedCdk")}</Button></>}</span></div></div></div>)}
  </section>;
}
