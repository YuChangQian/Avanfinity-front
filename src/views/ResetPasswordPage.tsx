import { useLayoutEffect, useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { KeyRound, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { StableSwap } from "../components/StableSwap";
import { BrandIcon } from "@/components/BrandIcon";
import { resetPassword } from "../api";

export function ResetPasswordPage() {
  const { t } = useTranslation();
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [message, setMessage] = useState("");

  useLayoutEffect(() => {
    if (token) window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
  }, [token]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password"));
    const confirmation = String(data.get("confirmation"));
    if (password !== confirmation) {
      setMessage(t("passwordConfirmationMismatch"));
      return;
    }
    if (password.length < 12 || password.length > 72 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      setMessage(t("passwordResetRequirements"));
      return;
    }
    setSubmitting(true);
    setMessage("");
    try {
      const result = await resetPassword(token, password);
      setSuccess(true);
      setMessage(result.msg);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : t("passwordResetFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  return <main className="auth-page"><div className="auth-shell">
    <section className="auth-story"><div className="brand-mark"><BrandIcon /> AVANFINITY</div><div><span className="eyebrow"><KeyRound size={14} /> SECURE RESET</span><h2>{t("resetPasswordStory")}</h2><p>{t("resetPasswordStoryDesc")}</p></div><div className="trust"><ShieldCheck /> {t("loginSecurityLabel")}</div></section>
    <section className="auth-card">
      <div className="auth-heading"><span className="eyebrow">NEW PASSWORD</span><h1>{t("resetPasswordTitle")}</h1><p>{t("passwordResetRequirements")}</p></div>
      {!token && <p role="alert" className="error">{t("passwordResetLinkInvalid")}</p>}
      {token && !success && <form className="stacked-form" onSubmit={submit}>
        <label>{t("newPassword")}<input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={72} required /></label>
        <label>{t("confirmPassword")}<input name="confirmation" type="password" autoComplete="new-password" minLength={12} maxLength={72} required /></label>
        {message && <p role="alert" className="error">{message}</p>}
        <Button size="lg" className="primary" disabled={submitting}><StableSwap state={submitting ? "busy" : "idle"} labels={{ idle: t("resetPasswordAction"), busy: t("processing") }} /></Button>
      </form>}
      {success && <p role="status" className="success-note">{message}</p>}
      <Button asChild variant={success ? "default" : "ghost"}><Link to="/login">{success ? t("continueToLogin") : t("backToLogin")}</Link></Button>
      <p className="secure-note"><ShieldCheck size={14} /> {t("passwordResetSessionNotice")}</p>
    </section>
  </div></main>;
}
