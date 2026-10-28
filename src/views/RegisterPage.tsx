import { useState, type FormEvent } from "react";
import { useAtomValue } from "jotai";
import { Link, useNavigate } from "@tanstack/react-router";
import { ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BrandIcon } from "@/components/BrandIcon";
import { DataSkeleton } from "../components/PageShell";
import { register } from "../api";
import { useTranslation } from "react-i18next";
import { useFeatures } from "../features";
import { clearEmailVerificationState, saveEmailVerificationState } from "../emailVerificationState";
import { referralAttributionAtom } from "../state";

export function RegisterPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { flags, isPending: featuresPending } = useFeatures();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const attributedCode = useAtomValue(referralAttributionAtom);
  const [manualInviteCode, setManualInviteCode] = useState("");
  const inviteCode = attributedCode ?? manualInviteCode;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!flags.registration) return;
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email"));
    setLoading(true);
    try {
      const result = await register(email, String(data.get("password")), inviteCode);
      if (result.data.emailVerificationRequired) saveEmailVerificationState(email, 60);
      else clearEmailVerificationState();
      await navigate({ to: result.data.emailVerificationRequired ? "/verify-email" : "/login" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("registerFailed"));
    } finally {
      setLoading(false);
    }
  }
  return <main className="auth-page"><div className="auth-shell">
    <section className="auth-story"><div className="brand-mark"><BrandIcon /> AVANFINITY</div><div><span className="eyebrow"><Sparkles size={14} /> START NOW</span><h2>Your money.<br />Your rules.</h2><p>{t("registerStory")}</p></div><div className="trust"><ShieldCheck /> {t("loginSecurityLabel")}</div></section>
    {featuresPending ? <form className="auth-card" aria-busy="true"><div className="auth-heading"><span className="eyebrow">NEW ACCOUNT</span><h1>{t("registerTitle")}</h1><p>{t("registerDesc")}</p></div><label>{t("email")}<input type="email" placeholder="your@email.com" disabled /></label><p className="secure-note"><ShieldCheck size={14} /> {t("emailDeliveryCheckSpamHint")}</p><label>{t("password")}<input type="password" placeholder="12+ characters" disabled /></label><label>{t("optionalInvite")}<input disabled /></label><Button size="lg" disabled>{t("createAccount")}</Button><Button variant="ghost" disabled>{t("haveAccount")}</Button><DataSkeleton /></form> : !flags.registration ? <section className="auth-card feature-disabled">
      <ShieldCheck />
      <div><h1>{t("registrationUnavailable")}</h1><p>{t("featureUnavailable")}</p></div>
      <Button asChild variant="outline"><Link to="/login">{t("haveAccount")}</Link></Button>
    </section> : <form className="auth-card" onSubmit={submit}>
      <div className="auth-heading"><span className="eyebrow">NEW ACCOUNT</span><h1>{t("registerTitle")}</h1><p>{t("registerDesc")}</p></div>
      <label>{t("email")}<input name="email" type="email" placeholder="your@email.com" required /></label>
      <p className="secure-note"><ShieldCheck size={14} /> {t("emailDeliveryCheckSpamHint")}</p>
      <label>{t("password")}<input name="password" type="password" placeholder="12+ characters" minLength={12} required /></label>
      {attributedCode
        ? <p className="success-note" data-testid="invite-attribution-locked">{t("inviteAttributionLocked")}</p>
        : <label>{t("optionalInvite")}<input name="inviteCode" placeholder="e.g. INVITE2026" value={manualInviteCode} onChange={(event) => setManualInviteCode(event.target.value)} /></label>}
      <label className="legal-consent"><input name="legalConsent" type="checkbox" required /><span>我已年满 18 周岁，确认不在中国大陆地区，且已阅读并同意 <Link to="/terms" target="_blank">服务条款</Link> 和 <Link to="/user-agreement" target="_blank">用户协议</Link>。</span></label>
      {error && <p role="alert" className="error">{error}</p>}
      <Button size="lg" disabled={loading}>{loading ? t("creatingAccount") : t("createAccount")}</Button>
      <Button asChild variant="ghost"><Link to="/login">{t("haveAccount")}</Link></Button>
    </form>}
  </div></main>;
}
