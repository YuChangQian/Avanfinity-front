import { formatDecimal } from "../decimal";
import { isCreditPlan, parseCreditQuantity } from "../gptDirect/plans";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAtomValue } from "jotai";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, CheckCircle2, Clock3, KeyRound, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { StableSwap } from "../components/StableSwap";
import { BrandIcon } from "@/components/BrandIcon";
import { GptOrderProgress } from "../components/GptOrderProgress";
import { LanguageButton } from "../components/LanguageButton";
import type { GptDirectEvent, GptDirectOrder } from "../api";
import { sessionAtom } from "../state";

const cdkApiBase = "/api/public/cdk";
const plans = new Set(["go", "plus", "pro_5x", "pro_20x", "pro_25x"]);
const statuses = new Set(["previewed", "preflighting", "preflighted", "dispatching", "queued", "running", "review", "pending", "awaiting_card", "funding_pending", "completed", "declined", "failed_precharge", "cancelled", "unused"]);
const terminalStatuses = new Set(["completed", "declined", "failed_precharge", "cancelled"]);

type RecordValue = Record<string, unknown>;
type Stage = "preview" | "credential" | "result";

function record(value: unknown): RecordValue | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : null;
}

function boundedString(value: unknown, max = 32 * 1024) {
  return typeof value === "string" && value.length > 0 && value.length <= max && !value.includes("\0") ? value : null;
}

async function cdkRequest(path: string, device: string, body?: RecordValue) {
  let response: Response;
  try {
    response = await fetch(`${cdkApiBase}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Redemption-Device": device },
      body: JSON.stringify(body ?? {}),
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error("network");
  }
  const payload = record(await response.json().catch(() => null));
  if (!response.ok || payload?.code !== 0) throw new Error("rejected");
  const data = record(payload.data);
  if (!data) throw new Error("invalid");
  return data;
}

function stripeInvoiceUrl(value: unknown) {
  if (typeof value !== "string") return null;
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

function stripeInvoiceUrls(value: unknown, fallback: unknown) {
  const result: string[] = [];
  for (const item of [...(Array.isArray(value) ? value : []), fallback]) {
    const url = stripeInvoiceUrl(item);
    if (url && !result.includes(url)) result.push(url);
  }
  return result;
}

function quotedAmount(minor: unknown, currency: unknown) {
  const amount = typeof minor === "number" && Number.isFinite(minor) && minor >= 0 ? minor : null;
  const code = boundedString(currency, 3);
  if (amount === null || !code) return "";
  return `${code} ${formatDecimal((amount / 100).toFixed(2))}`;
}

function orderFromReceipt(data: RecordValue, plan: string, clientRequestId: string): GptDirectOrder {
  const status = boundedString(data.status, 32) ?? "pending";
  const operationStatus = boundedString(data.operationStatus, 32)
    ?? (status === "completed" ? "SUCCEEDED" : terminalStatuses.has(status) ? "COMPENSATED" : "PENDING");
  return {
    id: "cdk",
    plan,
    status,
    stage: boundedString(data.stage, 100),
    invoiceUrl: stripeInvoiceUrl(data.invoiceUrl),
    invoiceUrls: stripeInvoiceUrls(data.invoiceUrls, data.invoiceUrl),
    willRenew: data.willRenew === true ? true : data.willRenew === false ? false : null,
    needsRenewalCancel: data.needsRenewalCancel === true,
    maskedEmail: boundedString(data.maskedEmail, 320),
    cardLastFour: boundedString(data.cardLastFour, 4),
    quotedAmountMinor: typeof data.quotedAmountMinor === "number" ? data.quotedAmountMinor : undefined,
    currency: boundedString(data.currency, 3) ?? undefined,
    operationStatus,
    clientRequestId,
    createdAt: "",
  };
}

function eventsFromReceipt(data: RecordValue): GptDirectEvent[] {
  if (!Array.isArray(data.progress)) return [];
  return data.progress.map(record).flatMap((item, index) => {
    const stage = boundedString(item?.stage, 64);
    const occurredAt = boundedString(item?.occurred_at, 40);
    if (!item || !stage || !occurredAt) return [];
    return [{
      eventId: `cdk-${index}-${occurredAt}`,
      type: "gpt_direct.progress",
      status: boundedString(item.status, 32),
      stage,
      publicMessage: boundedString(item.public_message, 200),
      occurredAt,
      createdAt: occurredAt,
    }];
  });
}

function deviceId() {
  const existing = sessionStorage.getItem("cdkRedeemDevice");
  if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing;
  const next = crypto.randomUUID();
  sessionStorage.setItem("cdkRedeemDevice", next);
  return next;
}
export function GptCdkRedeemPage() {
  const session = useAtomValue(sessionAtom);
  const { t } = useTranslation();
  const device = useRef(deviceId());
  const clientRequestId = useRef("");
  const redeemSubmitted = useRef(false);
  const [stage, setStage] = useState<Stage>("preview");
  const [code, setCode] = useState("");
  const [lookupCode, setLookupCode] = useState("");
  const [plan, setPlan] = useState("");
  const [forceNewCard, setForceNewCard] = useState(false);
  const [redemptionToken, setRedemptionToken] = useState("");
  const [sessionValue, setSessionValue] = useState("");
  const [preflightToken, setPreflightToken] = useState("");
  const [status, setStatus] = useState("");
  const [stageLabel, setStageLabel] = useState("");
  const [invoiceUrls, setInvoiceUrls] = useState<string[]>([]);
  const [maskedEmail, setMaskedEmail] = useState("");
  const [amountLabel, setAmountLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [redeemLocked, setRedeemLocked] = useState(false);
  const [error, setError] = useState("");
  const [order, setOrder] = useState<GptDirectOrder | null>(null);
  const [events, setEvents] = useState<GptDirectEvent[]>([]);
  const [renewalSession, setRenewalSession] = useState("");
  const [renewalPending, setRenewalPending] = useState(false);
  const [renewalError, setRenewalError] = useState("");

  function applyReceipt(data: RecordValue) {
    const nextStatus = boundedString(data.status, 32);
    if (!nextStatus || !statuses.has(nextStatus)) throw new Error("invalid");
    const nextPlan = boundedString(data.plan, 32) ?? plan;
    setStatus(nextStatus);
    setStageLabel(boundedString(data.stage, 100) ?? "");
    setPlan(nextPlan);
    setInvoiceUrls(stripeInvoiceUrls(data.invoiceUrls, data.invoiceUrl));
    setMaskedEmail(boundedString(data.maskedEmail, 320) ?? "");
    setAmountLabel(quotedAmount(data.quotedAmountMinor, data.currency));
    setOrder(orderFromReceipt(data, nextPlan, clientRequestId.current));
    setEvents(eventsFromReceipt(data));
    return nextStatus;
  }

  useEffect(() => {
    if (stage !== "result" || terminalStatuses.has(status) || status === "unused") return;
    if (!redemptionToken && !lookupCode.trim()) return;
    let stopped = false;
    let timer = 0;
    const poll = async () => {
      try {
        const data = redemptionToken
          ? await cdkRequest("/result", device.current, { redemption_token: redemptionToken })
          : await cdkRequest("/receipt", device.current, { code: lookupCode.trim() });
        const nextStatus = applyReceipt(data);
        if (stopped) return;
        setError("");
        if (!terminalStatuses.has(nextStatus) && nextStatus !== "unused") timer = window.setTimeout(poll, 3_000);
      } catch {
        if (!stopped) timer = window.setTimeout(poll, 10_000);
      }
    };
    timer = window.setTimeout(poll, status ? 3_000 : 0);
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [redemptionToken, lookupCode, stage, status]);

  async function preview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = await cdkRequest("/preview", device.current, { code: code.trim() });
      const token = boundedString(data.redemption_token);
      const nextPlan = boundedString(data.plan, 32);
      if (!token || !nextPlan || (!plans.has(nextPlan) && !isCreditPlan(nextPlan))) throw new Error("invalid");
      setRedemptionToken(token);
      setPlan(nextPlan);
      setForceNewCard(data.forceNewCard === true);
      setCode("");
      setStage("credential");
    } catch {
      setError(t("cdkUnavailable"));
    } finally {
      setBusy(false);
    }
  }

  async function preflight(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const credential = { mode: "session" as const, session: sessionValue.trim() };
    try {
      const data = await cdkRequest("/preflight", device.current, { redemption_token: redemptionToken, credential });
      const token = boundedString(data.preflight_token);
      if (!token) throw new Error("invalid");
      setPreflightToken(token);
      setSessionValue("");
    } catch {
      setError(t("cdkCredentialRejected"));
    } finally {
      setBusy(false);
    }
  }

  async function redeem() {
    if (redeemSubmitted.current || !preflightToken) return;
    redeemSubmitted.current = true;
    setRedeemLocked(true);
    clientRequestId.current ||= crypto.randomUUID();
    setBusy(true);
    setError("");
    try {
      const data = await cdkRequest("/redeem", device.current, {
        redemption_token: redemptionToken,
        preflight_token: preflightToken,
        client_request_id: clientRequestId.current,
      });
      const nextStatus = applyReceipt(data);
      setStatus(nextStatus);
    } catch {
      setError(t("cdkRedeemUncertain"));
    } finally {
      setPreflightToken("");
      setStage("result");
      setBusy(false);
    }
  }

  async function submitRenewal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!redemptionToken || renewalPending) return;
    setRenewalPending(true);
    setRenewalError("");
    try {
      const data = await cdkRequest("/cancel-renewal", device.current, {
        redemption_token: redemptionToken,
        credential: { mode: "session", session: renewalSession.trim() },
      });
      applyReceipt(data);
      setRenewalSession("");
    } catch {
      setRenewalError(t("gptRenewalCancelFailed"));
    } finally {
      setRenewalPending(false);
    }
  }

  async function lookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = await cdkRequest("/receipt", device.current, { code: lookupCode.trim() });
      applyReceipt(data);
      setRedemptionToken("");
      setStage("result");
    } catch {
      setError(t("cdkReceiptUnavailable"));
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setStage("preview");
    setCode("");
    setLookupCode("");
    setPlan("");
    setForceNewCard(false);
    setRedemptionToken("");
    setSessionValue("");
    setPreflightToken("");
    setStatus("");
    setStageLabel("");
    setInvoiceUrls([]);
    setMaskedEmail("");
    setAmountLabel("");
    setError("");
    setOrder(null);
    setEvents([]);
    setRenewalSession("");
    setRenewalError("");
    setRedeemLocked(false);
    clientRequestId.current = "";
    redeemSubmitted.current = false;
    device.current = crypto.randomUUID();
    sessionStorage.setItem("cdkRedeemDevice", device.current);
  }

  const step = stage === "preview" ? 1 : stage === "credential" ? 2 : 3;
  const completed = status === "completed";
  return <main className={`cdk-page${session ? " is-embedded" : ""}`}>
    {!session && <header className="cdk-nav">
      <Link to={session ? "/dashboard" : "/login"} className="cdk-brand"><span><BrandIcon /></span><strong>AVANFINITY</strong></Link>
      <div><LanguageButton /><Button asChild variant="outline" size="sm"><Link to={session ? "/gpt-direct" : "/login"}><ArrowLeft />{session ? t("gptDirectNavigation") : t("login")}</Link></Button></div>
    </header>}

    <section className="cdk-hero">
      <div><span className="eyebrow"><Sparkles /> GPT CDK</span><h1>{t(session ? "cdkMemberRedeemTitle" : "cdkRedeemTitle")}</h1><p>{t(session ? "cdkMemberRedeemDesc" : "cdkRedeemDesc")}</p>
        <ol className="cdk-howto" aria-label={t("cdkHowToTitle")}>
          <li>{t("cdkHowToCode")}</li>
          <li>{t("cdkHowToSession")}</li>
          <li>{t("cdkHowToAuto")}</li>
          <li>{t("cdkHowToRenew")}</li>
        </ol>
      </div>
      <div className="cdk-trust"><ShieldCheck /><span><strong>{t("cdkPrivacyTitle")}</strong><small>{t("cdkPrivacyDesc")}</small></span></div>
    </section>

    <section className="cdk-workspace">
      <ol className="cdk-steps" aria-label={t("cdkRedeemProgress")}>
        {[t("cdkStepCode"), t("cdkStepAccount"), t("cdkStepResult")].map((label, index) => <li key={label} className={step > index ? "is-active" : ""} aria-current={step === index + 1 ? "step" : undefined}><span>{index + 1}</span><strong>{label}</strong></li>)}
      </ol>

      <div className="cdk-card">
        {stage === "preview" && <>
          <form onSubmit={preview} className="cdk-form">
          <div className="cdk-card-heading"><span><KeyRound /></span><div><small>01 CDK</small><h2>{t("cdkEnterCode")}</h2><p>{t("cdkEnterCodeDesc")}</p></div></div>
          <label>{t("cdkCode")}<input value={code} onChange={(event) => setCode(event.target.value)} autoComplete="off" spellCheck={false} maxLength={128} placeholder="AVF-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX" required /></label>
          {error && <p className="error" role="alert">{error}</p>}
          <Button size="lg" disabled={busy || code.trim().length < 8}><RefreshCw className={busy ? "is-spinning" : "is-reserved"} /><StableSwap state={busy ? "busy" : "idle"} labels={{ idle: t("cdkPreview"), busy: t("processing") }} /></Button>
        </form>
          <form onSubmit={lookup} className="cdk-form cdk-receipt-form">
            <div className="cdk-card-heading"><span><Clock3 /></span><div><small>BILL</small><h2>{t("cdkLookupTitle")}</h2><p>{t("cdkLookupDesc")}</p></div></div>
            <label>{t("cdkLookupCode")}<input aria-label={t("cdkLookupCode")} value={lookupCode} onChange={(event) => setLookupCode(event.target.value)} autoComplete="off" spellCheck={false} maxLength={128} placeholder="AVF-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX" required /></label>
            <Button size="lg" variant="outline" disabled={busy || lookupCode.trim().length < 8}><RefreshCw className={busy ? "is-spinning" : "is-reserved"} /><StableSwap state={busy ? "busy" : "idle"} labels={{ idle: t("cdkLookupAction"), busy: t("processing") }} /></Button>
          </form>
        </>}

        {stage === "credential" && <div className="cdk-form">
          <div className="cdk-card-heading"><span><ShieldCheck /></span><div><small>02 ACCOUNT</small><h2>{t("cdkVerifyAccount")}</h2><p>{t("cdkSelectedPlan", { plan: isCreditPlan(plan) ? t("gptCdkCreditsLabel", { count: parseCreditQuantity(plan) }) : t(`gptPlan.${plan}`, { defaultValue: plan }) })}</p>{forceNewCard && <p>{t("cdkForceNewCardNotice")}</p>}</div></div>
          {!preflightToken ? <form onSubmit={preflight} className="cdk-credential-form">
            <fieldset className="gpt-credential-modes"><legend>{t("gptCredentialMode")}</legend><label><input type="radio" name="cdkCredentialMode" value="session" checked readOnly /><span>{t("gptCredentialModeLabel.session")}</span></label></fieldset>
            <label>{t("gptSessionCredential")}<textarea aria-label={t("gptSessionCredential")} rows={5} value={sessionValue} onChange={(event) => setSessionValue(event.target.value)} autoComplete="off" spellCheck={false} required /><span className="gpt-session-help"><small>{t("gptSessionCredentialHint")}</small><a href="https://chatgpt.com/api/auth/session" target="_blank" rel="noreferrer">{t("gptGetSession")}</a></span></label>
            {error && <p className="error" role="alert">{error}</p>}
            <Button size="lg" disabled={busy}><RefreshCw className={busy ? "is-spinning" : "is-reserved"} /><StableSwap state={busy ? "busy" : "idle"} labels={{ idle: t("cdkRunPreflight"), busy: t("processing") }} /></Button>
          </form> : <div className="cdk-confirm">
            <CheckCircle2 /><div><strong>{t("cdkPreflightPassed")}</strong><p>{t(forceNewCard ? "cdkForceNewCardNotice" : "cdkAutoCardNotice")}</p></div>
            {error && <p className="error" role="alert">{error}</p>}
            <Button size="lg" onClick={redeem} disabled={busy || redeemLocked}><RefreshCw className={busy ? "is-spinning" : "is-reserved"} /><StableSwap state={busy ? "busy" : "idle"} labels={{ idle: t(isCreditPlan(plan) ? "cdkSubmitCredits" : "cdkSubmitRedeem"), busy: t("processing") }} /></Button>
          </div>}
        </div>}

        {stage === "result" && <div className={`cdk-result ${completed ? "is-completed" : terminalStatuses.has(status) ? "is-failed" : ""}`} role="status" aria-live="polite">
          <span>{completed ? <CheckCircle2 /> : <Clock3 />}</span>
          <div><small>03 RESULT</small><h2>{completed ? t(isCreditPlan(plan) ? "gptCreditsOrderCompleted" : "cdkRedeemCompleted") : status === "unused" ? t("cdkLookupNotRedeemed") : terminalStatuses.has(status) ? t("cdkRedeemEnded") : t("cdkRedeemProcessing")}</h2>
            <p>{status === "unused" ? t("cdkLookupNotRedeemedDesc") : stageLabel ? t(`gptOrderStage.${stageLabel.split(":")[0]}`, { defaultValue: stageLabel }) : status ? t(`gptOrderStatus.${status}`, { defaultValue: status }) : t("cdkCheckingResult")}</p>
            {maskedEmail && <p>{t("cdkRedeemedAccount", { email: maskedEmail })}</p>}
            {amountLabel && <p>{t("cdkReceiptAmount", { amount: formatDecimal(amountLabel) })}</p>}
            {order && status !== "unused" && <GptOrderProgress
              order={order}
              events={events}
              defaultExpanded
              renewalForm={order.needsRenewalCancel ? {
                value: renewalSession,
                pending: renewalPending,
                error: renewalError,
                onChange: setRenewalSession,
                onSubmit: submitRenewal,
              } : undefined}
            />}
            {!order && invoiceUrls.map((invoiceUrl, index) => <a className="gpt-invoice-link" href={invoiceUrl} target="_blank" rel="noopener noreferrer" key={invoiceUrl}>{t("gptViewStripeInvoice")}{invoiceUrls.length > 1 ? ` ${index + 1}` : ""}</a>)}
            {completed && invoiceUrls.length === 0 && !order ? <p>{t("cdkInvoicePending")}</p> : null}
          </div>
          {error && <p className="error" role="alert">{error}</p>}
          {(terminalStatuses.has(status) || status === "unused") && <Button onClick={reset} variant="outline">{t("cdkRedeemAnother")}</Button>}
        </div>}
      </div>
    </section>

    <footer className="cdk-footer"><ShieldCheck />{t("cdkFooterSecurity")}</footer>
  </main>;
}
