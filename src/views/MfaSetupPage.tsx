import { useState, type FormEvent } from "react";
import { Navigate, Link } from "@tanstack/react-router";
import { useAtom } from "jotai";
import { useMutation, useQuery } from "@tanstack/react-query";
import { KeyRound, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { BrandIcon } from "@/components/BrandIcon";
import { DataSkeleton } from "../components/PageShell";
import { confirmMfaEnrollment, getMfaStatus, startMfaEnrollment } from "../api";
import { sessionAtom, sessionIdentity } from "../state";

export function MfaSetupPage() {
  const { t } = useTranslation();
  const [session, setSession] = useAtom(sessionAtom);
  const [enrollment, setEnrollment] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const status = useQuery({
    queryKey: ["mfa-status", sessionIdentity(session)],
    queryFn: () => getMfaStatus(session!.token),
    enabled: Boolean(session) && recoveryCodes.length === 0,
    retry: false,
  });
  const enroll = useMutation({
    mutationFn: () => startMfaEnrollment(session!.token),
    onSuccess: (result) => setEnrollment(result.data),
  });
  const confirm = useMutation({
    mutationFn: (credential: string) => confirmMfaEnrollment(session!.token, credential),
    onSuccess: (result) => {
      setRecoveryCodes(result.data.recoveryCodes);
      setEnrollment(null);
      setSession(null);
    },
  });

  if (!session && recoveryCodes.length === 0) return <Navigate to="/login" />;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    confirm.mutate(String(new FormData(event.currentTarget).get("credential")));
  }

  return <main className="auth-page"><div className="identity-card">
    <div className="brand-mark dark-brand"><BrandIcon /> AVANFINITY</div>
    <div className="identity-heading"><span><ShieldCheck /></span><div><small>ACCOUNT SECURITY</small><h1>{t("mfaSetupTitle")}</h1><p>{t("mfaSetupDesc")}</p></div></div>
    {recoveryCodes.length > 0 ? <section className="recovery-panel" aria-live="polite">
      <h2>{t("recoveryCodesTitle")}</h2><p>{t("recoveryCodesOnce")}</p>
      <ul>{recoveryCodes.map((code) => <li key={code}><code>{code}</code></li>)}</ul>
      <Button asChild size="lg"><Link to="/login">{t("savedCodesLogin")}</Link></Button>
    </section> : <>
      {status.isLoading && <section className="mfa-enrollment" aria-busy="true"><p><DataSkeleton /></p><label>{t("mfaSecretLabel")}<output className="secret-output"><DataSkeleton /></output></label><label>{t("mfaUriLabel")}<textarea readOnly rows={4} /></label><form className="stacked-form"><label>{t("mfaConfirmCode")}<input disabled /></label><Button size="lg" disabled>{t("enableMfa")}</Button></form></section>}
      {status.isError && <p role="alert" className="error">{t("mfaStatusFailed")}</p>}
      {status.data?.data.state === "pending" && !enrollment && <p role="alert" className="security-warning"><KeyRound />{t("mfaSecretNotRepeated")}</p>}
      {status.data?.data.state === "enabled" && <p className="success-note">{t("mfaAlreadyEnabled")}</p>}
      {status.data?.data.state === "not_enrolled" && !enrollment && <Button size="lg" onClick={() => enroll.mutate()} disabled={enroll.isPending}>{enroll.isPending ? t("processing") : t("startMfaSetup")}</Button>}
      {enroll.isError && <p role="alert" className="error">{enroll.error.message}</p>}
      {enrollment && <section className="mfa-enrollment" aria-live="polite">
        <p>{t("mfaAddAuthenticator")}</p>
        <label>{t("mfaSecretLabel")}<output className="secret-output">{enrollment.secret}</output></label>
        <label>{t("mfaUriLabel")}<textarea readOnly value={enrollment.otpauthUri} rows={4} /></label>
        <form className="stacked-form" onSubmit={submit}>
          <label>{t("mfaConfirmCode")}<input name="credential" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} required /></label>
          {confirm.isError && <p role="alert" className="error">{confirm.error.message}</p>}
          <Button size="lg" disabled={confirm.isPending}>{confirm.isPending ? t("processing") : t("enableMfa")}</Button>
        </form>
      </section>}
    </>}
  </div></main>;
}
