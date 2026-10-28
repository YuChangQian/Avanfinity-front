import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { KeyRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { setupEmailLogin } from "../api";
import { saveEmailVerificationState } from "../emailVerificationState";
import { Button } from "./ui/button";
import { StableSwap } from "./StableSwap";

export function EmailLoginSetup({ token, verificationPending, initialEmail, onComplete }: {
  token: string;
  verificationPending: boolean;
  initialEmail: string;
  onComplete: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const mutation = useMutation({
    mutationFn: (value: { email: string; password: string; confirmPassword: string }) => setupEmailLogin(token, value.email, value.password, value.confirmPassword),
    onSuccess: async (result) => {
      setError("");
      if (result.data.emailVerificationRequired) {
        saveEmailVerificationState(result.data.email, result.data.cooldownSeconds);
        await navigate({ to: "/verify-email" });
      } else {
        onComplete();
      }
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : t("updateFailed")),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password"));
    const confirmPassword = String(data.get("confirmPassword"));
    if (password !== confirmPassword) {
      setError(t("passwordsDoNotMatch"));
      return;
    }
    mutation.mutate({ email: String(data.get("email")), password, confirmPassword });
  }

  return <article className="module-card settings-security" data-testid="email-login-setup">
    <div className="stat-icon"><KeyRound /></div>
    <h2>{t("setupEmailLogin")}</h2>
    {verificationPending && <p className="success-note">{t("emailLoginVerificationPending")}</p>}
    <form onSubmit={submit}>
        <p>{t("setupEmailLoginHint")}</p>
        <label>{t("email")}<input name="email" type="email" autoComplete="email" defaultValue={initialEmail} required /></label>
        <label>{t("newPassword")}<input name="password" type="password" autoComplete="new-password" minLength={12} required /></label>
        <label>{t("confirmPassword")}<input name="confirmPassword" type="password" autoComplete="new-password" minLength={12} required /></label>
        {error && <p role="alert" className="error">{error}</p>}
        <Button disabled={mutation.isPending}><StableSwap state={mutation.isPending ? "busy" : verificationPending ? "alt" : "idle"} labels={{ idle: t("setupEmailLoginAction"), alt: t("updateEmailLoginAction"), busy: t("processing") }} /></Button>
        <p className="secure-note">{t("emailDeliveryCheckSpamHint")}</p>
      </form>
  </article>;
}
