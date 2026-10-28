import { useState, type FormEvent } from "react";
import { useSetAtom } from "jotai";
import { useNavigate } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowUpRight, KeyRound, RefreshCw, Send, ShieldCheck, Sparkles } from "lucide-react";
import { ApiError, createLoginCaptcha, login } from "../api";
import { emptyGptDirectDraft, gptDirectDraftAtom, referralStorageKey, sessionAtom } from "../state";
import { useFeatures } from "../features";
import { Button } from "@/components/ui/button";
import { BrandIcon } from "@/components/BrandIcon";
import { parseAdminCustomerReturnPath } from "../adminCustomerReturnPath";

const LOGIN_ERROR_KEYS: Record<string, string> = {
  INVALID_CREDENTIALS: "loginInvalidCredentials",
  ACCOUNT_SUSPENDED: "loginAccountSuspended",
  ACCOUNT_BANNED: "loginAccountBanned",
  EMAIL_NOT_VERIFIED: "loginEmailNotVerified",
  EMAIL_LOGIN_DISABLED: "loginEmailDisabled",
  MFA_INVALID: "loginMfaInvalid",
  CAPTCHA_INVALID: "captchaInvalid",
};

export function LoginPage() {
  const { t, i18n } = useTranslation();
  const setSession = useSetAtom(sessionAtom);
  const setGptDirectDraft = useSetAtom(gptDirectDraftAtom);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { flags } = useFeatures();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [captchaCode, setCaptchaCode] = useState("");
  const [mfaRequired, setMfaRequired] = useState(false);
  const captcha = useQuery({ queryKey: ["login-captcha"], queryFn: createLoginCaptcha, retry: false, staleTime: Infinity });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setLoading(true);
    setError("");
    try {
      const session = await login(
        String(data.get("email")),
        String(data.get("password")),
        String(data.get("mfaCode") ?? ""),
        captcha.data?.data.id,
        captchaCode,
      );
      queryClient.clear();
      setGptDirectDraft(emptyGptDirectDraft());
      localStorage.removeItem(referralStorageKey);
      localStorage.setItem("session", JSON.stringify(session));
      setSession(session);
      const returnPath = sessionStorage.getItem("recentAuthReturnPath");
      if (!session.mfaEnrollmentRequired && returnPath
        && (/^\/cards\/\d+$/.test(returnPath) || /^\/gpt-direct\/orders\/[0-9a-f-]+$/i.test(returnPath) || ["/cards/owned", "/gpt-direct", "/telegram-payment", "/admin?panel=cdks", "/admin?panel=system", "/developer"].includes(returnPath)
          || parseAdminCustomerReturnPath(returnPath) !== null)) {
        sessionStorage.removeItem("recentAuthReturnPath");
        window.location.replace(returnPath);
        return;
      }
      await navigate({ to: session.mfaEnrollmentRequired ? "/mfa/setup" : "/dashboard" });
    } catch (cause) {
      if (cause instanceof ApiError && cause.errorCode === "MFA_REQUIRED") {
        setMfaRequired(true);
        setError(t("mfaRequiredPrompt"));
      } else if (cause instanceof ApiError && cause.errorCode && LOGIN_ERROR_KEYS[cause.errorCode]) {
        setError(t(LOGIN_ERROR_KEYS[cause.errorCode]));
      } else {
        setError(cause instanceof Error ? cause.message : "Login failed");
      }
      if (captcha.data?.data.required) {
        setCaptchaCode("");
        await captcha.refetch();
      }
    } finally {
      setLoading(false);
    }
  }

  const toggleLanguage = () => {
    const next = i18n.language === "zh" ? "en" : "zh";
    localStorage.setItem("language", next);
    void i18n.changeLanguage(next);
  };

  return <main className="auth-page">
    <div className="auth-shell">
      <section className="auth-story">
        <div className="brand-mark"><BrandIcon /> AVANFINITY</div>
        <div>
          <span className="eyebrow"><Sparkles size={14} /> Banking, reimagined</span>
          <h2>Money moves<br />at your speed.</h2>
          <p>{t("loginStory")}</p>
        </div>
        <div className="trust"><ShieldCheck /> {t("loginSecurityLabel")} <ArrowUpRight /></div>
      </section>
      <form className="auth-card" onSubmit={submit}>
        <Button asChild className="auth-home-link" variant="ghost"><Link to="/"><ArrowLeft />{t("backToHome")}</Link></Button>
        <Button className="language" variant="ghost" type="button" onClick={toggleLanguage}>{t("language")}</Button>
        <div className="mobile-brand"><div className="logo"><BrandIcon /></div><strong>{t("brand")}</strong></div>
        <div className="auth-heading"><span className="eyebrow">SECURE ACCESS</span><h1>{t("loginTitle")}</h1><p>{t("loginPrompt")}</p></div>
        <label>{t("email")}<input name="email" type="email" placeholder="your@email.com" required /></label>
        <label>{t("password")}<input name="password" type="password" placeholder="8+" minLength={8} required /></label>
        {captcha.data?.data.required && <label>{t("captchaLabel")}<span className="captcha-field">
          <input name="captchaCode" inputMode="numeric" autoComplete="off" maxLength={5} value={captchaCode} onChange={(event) => setCaptchaCode(event.target.value.replace(/\D/g, "").slice(0, 5))} placeholder={t("captchaPlaceholder")} required />
          {captcha.data.data.image && <img src={captcha.data.data.image} alt={t("captchaImageAlt")} />}
          <Button type="button" size="icon" variant="outline" onClick={async () => { setCaptchaCode(""); await captcha.refetch(); }} aria-label={t("refreshCaptcha")} disabled={captcha.isFetching}><RefreshCw /></Button>
        </span></label>}
        {captcha.isError && <div className="captcha-load-error" role="alert"><span>{t("captchaLoadFailed")}</span><Button type="button" size="sm" variant="outline" onClick={() => void captcha.refetch()}>{t("retry")}</Button></div>}
        {mfaRequired && <label>{t("mfaCredential")}<input name="mfaCode" autoComplete="one-time-code" maxLength={64} placeholder={t("mfaCredentialPlaceholder")} required autoFocus /></label>}
        {error && <p role="alert" className="error">{error}</p>}
        <Button size="lg" className="primary" disabled={loading || captcha.isLoading || captcha.isError}>{loading ? t("loggingIn") : t("login")}</Button>
        {flags.telegram && <div className="telegram-login-options">
          <Button asChild size="lg" variant="outline"><a href="/api/auth/telegram?next=%2Fdashboard"><Send />{t("telegramLogin")}</a></Button>
        </div>}
        <Button asChild variant="ghost"><Link to="/forgot-password">{t("forgotPasswordNavigation")}</Link></Button>
        {flags.registration && <Button asChild variant="ghost"><Link to="/register">{t("createNewAccount")}</Link></Button>}
        <Button asChild variant="ghost"><Link to="/verify-email">{t("verifyEmailNavigation")}</Link></Button>
        <Button asChild variant="outline"><Link to="/cdk/redeem"><KeyRound />{t("cdkRedeemNavigation")}</Link></Button>
        <p className="login-legal-note">{t("loginLegalPrefix")} <Link to="/user-agreement" target="_blank">{t("userAgreementLabel")}</Link> {t("loginLegalConnector")} <Link to="/terms" target="_blank">{t("privacyTermsLabel")}</Link>{t("loginLegalSuffix")}</p>
        <p className="secure-note"><ShieldCheck size={14} /> {t("secureSession")}</p>
      </form>
    </div>
  </main>;
}
