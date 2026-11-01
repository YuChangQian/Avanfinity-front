import { t } from "i18next";
import { useTranslation } from "react-i18next";
import { Notice } from "../components/ui/notice";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useAtomValue } from "jotai";
import { Link } from "@tanstack/react-router";
import { KeyRound, ShieldCheck } from "lucide-react";
import { publicTgCdkPreflight, publicTgCdkPreview, publicTgCdkRedeem, publicTgCdkResult, type PublicTgCdkResult } from "../api";
import { sessionAtom } from "../state";
import { Button } from "../components/ui/button";
import { StableSwap } from "../components/StableSwap";
import { BrandIcon } from "../components/BrandIcon";

const planLabels: Record<string, string> = { get premium_3m() { return t("serviceText.premium3Months"); }, get premium_6m() { return t("serviceText.premium6Months"); }, get premium_12m() { return t("serviceText.premium1Year"); }, };
const statusLabels: Record<string, string> = { get unused() { return t("serviceText.notRedeemed"); }, get preparing() { return t("serviceText.checkingEligibilityAndQuote"); }, get prepared() { return t("serviceText.quoteReadyConfirmRedemption"); }, get funding() { return t("serviceText.preparingTheIssuerSPaymentCard"); }, get funded() { return t("serviceText.paymentCardReadyContinueRedemption"); }, get paying() { return t("serviceText.redeemingDoNotSubmitAgain"); }, get review_required() { return t("serviceText.resultUnderReviewCheckTheOriginalRedemptionStatus"); }, get completed() { return t("serviceText.redemptionCompleted"); }, get paid_pending_delivery() { return t("serviceText.paidAwaitingDelivery"); }, get failed_precharge() { return t("serviceText.redemptionIncompleteContactTheIssuer"); }, get ineligible() { return t("serviceText.accountIsNotCurrentlyEligible"); }, get revoked() { return t("serviceText.redemptionCodeRevoked"); } };
type Intent = { clientRequestId: string; recipient: string; plan: string; submitted: boolean };
function readIntent(): Intent | null {
  try { const value = JSON.parse(sessionStorage.getItem("tgCdkIntent") ?? "null"); return value && typeof value.clientRequestId === "string" && /^[0-9a-f-]{36}$/i.test(value.clientRequestId) && typeof value.recipient === "string" && typeof value.plan === "string" ? value : null; }
  catch { return null; }
}
function deviceToken() {
  const existing = localStorage.getItem("tgCdkDevice");
  if (existing && /^[0-9a-f]{64}$/.test(existing)) return existing;
  const value = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("");
  localStorage.setItem("tgCdkDevice", value);
  return value;
}

export function TgCdkRedeemPage() {
  useTranslation();
  const session = useAtomValue(sessionAtom);
  const [device] = useState(deviceToken);
  const [intent, setIntent] = useState<Intent | null>(readIntent);
  const [recovering, setRecovering] = useState(Boolean(intent));
  const [code, setCode] = useState("");
  const [recipient, setRecipient] = useState(intent?.recipient ?? "");
  const [result, setResult] = useState<PublicTgCdkResult | null>(null);
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const [error, setError] = useState("");
  const [recoveryChecked, setRecoveryChecked] = useState(false);
  const run = useCallback(async (action: "preview" | "preflight" | "redeem" | "result") => {
    if (working.current || !code.trim()) return;
    working.current = true; setBusy(true); setError("");
    const credential = { code: code.trim(), deviceToken: device };
    function remember(next: Intent) { sessionStorage.setItem("tgCdkIntent", JSON.stringify(next)); setIntent(next); }
    try {
      let data: PublicTgCdkResult;
      if (action === "preview") data = (await publicTgCdkPreview(credential)).data;
      else if (action === "preflight") {
        const next = intent ?? { clientRequestId: crypto.randomUUID(), recipient: recipient.trim().replace(/^@/, ""), plan: result?.plan ?? "", submitted: false };
        remember(next);
        data = (await publicTgCdkPreflight({ ...credential, recipient: next.recipient, clientRequestId: next.clientRequestId })).data;
      } else {
        if (!intent) throw new Error("Missing request");
        if (action === "redeem") {
          if (result?.amountMinor == null || !result.currency) throw new Error("Missing quote");
          remember({ ...intent, submitted: true }); setRecoveryChecked(false);
          data = (await publicTgCdkRedeem({ ...credential, clientRequestId: intent.clientRequestId, expectedAmountMinor: result.amountMinor, currency: result.currency })).data;
        } else {
          data = (await publicTgCdkResult({ ...credential, clientRequestId: intent.clientRequestId })).data;
          setRecoveryChecked(true); setRecovering(false);
        }
      }
      setResult(data);
    } catch {
      setError(action === "redeem" ? t("serviceText.submissionResultIsUnclearCheckTheOriginalRedemption") : action === "preflight" ? t("serviceText.preflightIsIncompleteRetryPreflightOrCheckThe") : action === "result" ? t("serviceText.unableToCheckTheOriginalRedemptionStatusEnter") : t("serviceText.redemptionCodeIsTemporarilyUnavailableCheckItAnd"));
    } finally { working.current = false; setBusy(false); }
  }, [code, device, intent, recipient, result]);
  useEffect(() => {
    if (recovering || !code || !intent || !["preparing", "funding", "paying", "paid_pending_delivery"].includes(result?.status ?? "")) return;
    const timer = window.setInterval(() => { void run("result"); }, 5000);
    return () => window.clearInterval(timer);
  }, [recovering, code, intent, result?.status, run]); // Polls only the bound request; never submits a payment.
  function reset() {
    sessionStorage.removeItem("tgCdkIntent"); setIntent(null); setRecovering(false); setCode(""); setRecipient(""); setResult(null); setError(""); setRecoveryChecked(false);
  }
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void run(recovering ? "result" : "preview"); }
  const canConfirm = intent && result && (result.status === "funded" || (result.status === "prepared" && (!intent.submitted || recoveryChecked))) && result.amountMinor != null && Boolean(result.currency);
  return <main className={`cdk-page${session ? " is-embedded" : ""}`}>
    {!session && <header className="cdk-nav"><Link to="/login" className="cdk-brand"><span><BrandIcon /></span><strong>AVANFINITY</strong></Link><Button asChild variant="outline" size="sm"><Link to="/cdk/redeem">{t("serviceText.redeemGptCdk")}</Link></Button></header>}
    <section className="cdk-hero"><div><span className="eyebrow"><KeyRound />TG CDK</span><h1>{t("serviceText.redeemTgCdk")}</h1><p>{t("serviceText.noLoginRequiredEnterYourRedemptionCodeAnd")}</p><ol className="cdk-howto"><li>{t("serviceText.checkRedemptionCode")}</li><li>{t("serviceText.checkTgAccountEligibilityAndOfficialQuote")}</li><li>{t("serviceText.confirmRedemptionThenCheckStatusAndDelivery")}</li></ol></div><div className="cdk-trust"><ShieldCheck /><span><strong>{t("serviceText.noPaymentCardOrSessionRequiredFromThe")}</strong><small>{t("serviceText.eachRedemptionIsBoundToOneTgAccount")}</small></span></div></section>
    <section className="cdk-workspace" style={{ gridTemplateColumns: "minmax(0, 1fr)" }}><div className="cdk-card"><div className="cdk-form">
      {(!result || recovering) && <form className="grid gap-6" onSubmit={submit}>
        {recovering && <p>{t("serviceText.aPreviousRedemptionRequestWasDetectedEnterThe")}</p>}
        <label>{t("serviceText.tgCdkRedemptionCode")}<input value={code} onChange={event => setCode(event.target.value)} autoComplete="off" spellCheck={false} maxLength={256} disabled={busy} required /></label>
        <Button disabled={busy || !code.trim()}><StableSwap state={busy ? "busy" : recovering ? "alt" : "idle"} labels={{ idle: t("serviceText.checkRedemptionCode"), alt: t("serviceText.checkOriginalRedemptionStatus"), busy: t("serviceText.processing3") }} /></Button>
      </form>}
      {result && !recovering && <>
        <h2>{planLabels[result.plan] ?? "Telegram Premium"}</h2>
        <p role="status">{statusLabels[result.status] ?? t("serviceText.resultUnderReviewCheckTheOriginalRedemptionStatus")}</p>
        {result.status === "ineligible" && <Notice role="alert" className="error">{t("serviceText.thisTelegramAccountCannotCurrentlyReceiveThisPlan")}</Notice>}
        {result.status === "unused" && <form className="grid gap-6" onSubmit={event => { event.preventDefault(); void run("preflight"); }}>
          <label>{t("serviceText.tgUsername")}<input value={recipient} onChange={event => setRecipient(event.target.value)} readOnly={Boolean(intent)} disabled={busy} maxLength={33} pattern="@?[A-Za-z0-9_]{1,32}" autoComplete="off" required /></label>
          <Button disabled={busy}><StableSwap state={busy ? "busy" : intent ? "alt" : "idle"} labels={{ idle: t("serviceText.checkEligibilityAndGetQuote"), alt: t("serviceText.retryPreflight"), busy: t("serviceText.runningPreflight") }} /></Button>
        </form>}
        {(result.recipient || intent?.recipient) && <p>{t("serviceText.tgAccount")}{result.recipient ?? intent?.recipient}</p>}
        {result.amountMinor != null && result.currency && <div className="cdk-confirm"><ShieldCheck /><div><strong>{t("serviceText.officialAmount")}</strong><p>{result.currency.toUpperCase()} {(result.amountMinor / 100).toFixed(2)}</p><p>{t("serviceText.theIssuerPaysTheServiceFeeTheRecipient")}</p></div></div>}
        {canConfirm && <Button disabled={busy} onClick={() => void run("redeem")}><StableSwap state={busy ? "busy" : intent?.submitted || result.status === "funded" ? "alt" : "idle"} labels={{ idle: t("serviceText.confirmRedemption"), alt: t("serviceText.continueRedemption"), busy: t("serviceText.submitting") }} /></Button>}
        {["prepared", "funded"].includes(result.status) && intent && <Button variant="outline" disabled={busy} onClick={() => void run("preflight")}>{t("serviceText.refreshOfficialQuote")}</Button>}
        {intent && <Button variant="outline" disabled={busy} onClick={() => void run("result")}>{t("serviceText.checkOriginalRedemptionStatus")}</Button>}
        {["ineligible", "failed_precharge"].includes(result.status) && intent && result.canRetryPreflight === true && <Button variant="outline" disabled={busy} onClick={() => { sessionStorage.removeItem("tgCdkIntent"); setIntent(null); setResult({ ...result, status: "unused" }); setError(""); setRecoveryChecked(false); }}>{t("serviceText.checkAccountAndRunPreflightAgain")}</Button>}
        {result.deliveryStatus === "delivered" && <p>{t("serviceText.verifiedGiftRecord")}{result.giftMessageId} · {result.giftDays} {t("serviceText.days")}</p>}
        {((!intent && result.status !== "unused") || ["completed", "revoked", "ineligible", "failed_precharge"].includes(result.status)) && <Button variant="outline" disabled={busy} onClick={reset}>{t("serviceText.redeemAnotherCdk")}</Button>}
      </>}
      {error && <Notice className="error" role="alert">{error}</Notice>}
    </div></div></section>
    <footer className="cdk-footer"><ShieldCheck />{t("serviceText.checkTheOriginalRedemptionRecordToRecoverIts")}</footer>
  </main>;
}
