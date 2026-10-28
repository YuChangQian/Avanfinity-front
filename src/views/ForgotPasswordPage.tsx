import { useEffect, useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { KeyRound, RefreshCw, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { BrandIcon } from "@/components/BrandIcon";
import { createLoginCaptcha, requestPasswordReset } from "../api";

export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [captchaCode, setCaptchaCode] = useState("");
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [remaining, setRemaining] = useState(0);
  const captcha = useQuery({ queryKey: ["password-reset-captcha"], queryFn: createLoginCaptcha, retry: false, staleTime: Infinity });

  useEffect(() => {
    if (remaining <= 0) return;
    const timer = window.setTimeout(() => setRemaining((value) => Math.max(0, value - 1)), 1_000);
    return () => window.clearTimeout(timer);
  }, [remaining]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (remaining > 0) return;
    const data = new FormData(event.currentTarget);
    setSending(true);
    setMessage("");
    setError("");
    try {
      const result = await requestPasswordReset(
        String(data.get("email")),
        captcha.data?.data.id,
        captchaCode,
      );
      setMessage(result.msg);
      setRemaining(result.data.cooldownSeconds);
      if (captcha.data?.data.required) {
        setCaptchaCode("");
        await captcha.refetch();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("passwordResetRequestFailed"));
      if (captcha.data?.data.required) {
        setCaptchaCode("");
        await captcha.refetch();
      }
    } finally {
      setSending(false);
    }
  }

  return <main className="auth-page"><div className="auth-shell">
    <section className="auth-story"><div className="brand-mark"><BrandIcon /> AVANFINITY</div><div><span className="eyebrow"><KeyRound size={14} /> ACCOUNT RECOVERY</span><h2>{t("forgotPasswordStory")}</h2><p>{t("forgotPasswordStoryDesc")}</p></div><div className="trust"><ShieldCheck /> {t("loginSecurityLabel")}</div></section>
    <form className="auth-card" onSubmit={submit}>
      <div className="auth-heading"><span className="eyebrow">PASSWORD RESET</span><h1>{t("forgotPasswordTitle")}</h1><p>{t("forgotPasswordPrompt")}</p></div>
      <label>{t("email")}<input name="email" type="email" autoComplete="email" placeholder="your@email.com" required /></label>
      {captcha.data?.data.required && <label>{t("captchaLabel")}<span className="captcha-field">
        <input name="captchaCode" inputMode="numeric" autoComplete="off" maxLength={5} value={captchaCode} onChange={(event) => setCaptchaCode(event.target.value.replace(/\D/g, "").slice(0, 5))} placeholder={t("captchaPlaceholder")} required />
        {captcha.data.data.image && <img src={captcha.data.data.image} alt={t("captchaImageAlt")} />}
        <Button type="button" size="icon" variant="outline" onClick={async () => { setCaptchaCode(""); await captcha.refetch(); }} aria-label={t("refreshCaptcha")} disabled={captcha.isFetching}><RefreshCw /></Button>
      </span></label>}
      {captcha.isError && <div className="captcha-load-error" role="alert"><span>{t("captchaLoadFailed")}</span><Button type="button" size="sm" variant="outline" onClick={() => void captcha.refetch()}>{t("retry")}</Button></div>}
      {message && <p role="status" className="success-note">{message}</p>}
      {error && <p role="alert" className="error">{error}</p>}
      <Button size="lg" className="primary" disabled={sending || remaining > 0 || captcha.isLoading || captcha.isError}>{sending ? t("sending") : remaining > 0 ? t("passwordResetCountdown", { seconds: remaining }) : t("sendPasswordReset")}</Button>
      <p className="secure-note"><ShieldCheck size={14} /> {t("emailDeliveryCheckSpamHint")}</p>
      <Button asChild variant="ghost"><Link to="/login">{t("backToLogin")}</Link></Button>
      <p className="secure-note"><ShieldCheck size={14} /> {t("passwordResetPrivacy")}</p>
    </form>
  </div></main>;
}
