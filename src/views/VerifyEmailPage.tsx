import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { MailCheck, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { StableSwap } from "../components/StableSwap";
import { BrandIcon } from "@/components/BrandIcon";
import { ApiError, resendVerificationEmail, verifyEmail } from "../api";
import { clearEmailVerificationState, loadEmailVerificationState, saveEmailVerificationState } from "../emailVerificationState";
import { forgetEmailVerificationToken, readEmailVerificationToken } from "../emailVerificationToken";

export function VerifyEmailPage() {
  const { t } = useTranslation();
  const [token] = useState(readEmailVerificationToken);
  const started = useRef(false);
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">(token ? "loading" : "idle");
  const [message, setMessage] = useState("");
  const [resending, setResending] = useState(false);
  const [pending, setPending] = useState(loadEmailVerificationState);
  const [remaining, setRemaining] = useState(() => Math.max(0, Math.ceil((pending.resendAt - Date.now()) / 1_000)));

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    forgetEmailVerificationToken();
    verifyEmail(token).then((result) => {
      clearEmailVerificationState();
      setMessage(result.msg);
      setStatus("success");
    }).catch((cause) => {
      setMessage(cause instanceof Error ? cause.message : t("emailVerificationFailed"));
      setStatus("error");
    });
  }, [t, token]);

  useEffect(() => {
    const update = () => setRemaining(Math.max(0, Math.ceil((pending.resendAt - Date.now()) / 1_000)));
    update();
    if (pending.resendAt <= Date.now()) return;
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [pending.resendAt]);

  async function resend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = pending.email.trim();
    if (!email || remaining > 0) return;
    setResending(true);
    setMessage("");
    try {
      const result = await resendVerificationEmail(email);
      setPending(saveEmailVerificationState(email, result.data.cooldownSeconds));
      setMessage(result.msg);
      setStatus("success");
    } catch (cause) {
      if (cause instanceof ApiError && cause.retryAfterSeconds) {
        setPending(saveEmailVerificationState(email, cause.retryAfterSeconds));
      }
      setMessage(cause instanceof Error ? cause.message : t("emailResendFailed"));
      setStatus("error");
    } finally {
      setResending(false);
    }
  }

  return <main className="auth-page"><div className="auth-shell">
    <section className="auth-story"><div className="brand-mark"><BrandIcon /> AVANFINITY</div><div><span className="eyebrow"><MailCheck size={14} /> VERIFIED ACCESS</span><h2>{t("verifyEmailStory")}</h2><p>{t("verifyEmailStoryDesc")}</p></div><div className="trust"><ShieldCheck /> {t("loginSecurityLabel")}</div></section>
    <section className="auth-card" aria-live="polite">
      <div className="auth-heading"><span className="eyebrow">EMAIL VERIFICATION</span><h1>{t("verifyEmailTitle")}</h1><p>{token ? t("verifyingEmail") : t("verifyEmailPrompt")}</p></div>
      <p className="secure-note"><ShieldCheck size={14} /> {t("emailDeliveryCheckSpamHint")}</p>
      {status === "loading" && <p>{t("verifyingEmail")}</p>}
      {message && <p role={status === "error" ? "alert" : "status"} className={status === "error" ? "error" : "success-note"}>{message}</p>}
      {status === "success" && token && <Button asChild size="lg"><Link to="/login">{t("continueToLogin")}</Link></Button>}
      {(!token || status === "error") && <form className="stacked-form" onSubmit={resend}>
        <label>{t("email")}<input name="email" type="email" autoComplete="email" value={pending.email} onChange={(event) => setPending({ email: event.target.value, resendAt: pending.resendAt })} required /></label>
        <Button disabled={resending || remaining > 0 || !pending.email.trim()}><StableSwap state={resending ? "busy" : remaining > 0 ? "wait" : "idle"} labels={{ idle: t("resendVerification"), busy: t("sending"), wait: t("resendVerificationCountdown", { seconds: remaining }), reserve: t("resendVerificationCountdown", { seconds: 60 }) }} /></Button>
      </form>}
      <Button asChild variant="ghost"><Link to="/login">{t("haveAccount")}</Link></Button>
    </section>
  </div></main>;
}
