import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useAtom, useAtomValue } from "jotai";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, useNavigate } from "@tanstack/react-router";
import { KeyRound, Send, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataSkeleton, PageShell } from "../components/PageShell";
import { EmailLoginSetup } from "../components/EmailLoginSetup";
import { changePassword, getSettings, getTelegram, issueTelegramBindCode, requestTelegramUnbindCode, unbindTelegram, updateAvatar } from "../api";
import { emptyGptDirectDraft, gptDirectDraftAtom, sessionAtom } from "../state";
import { useTranslation } from "react-i18next";
import { useFeatures } from "../features";

export function SettingsPage() {
  const session = useAtomValue(sessionAtom);
  const { t } = useTranslation();
  const [, setSession] = useAtom(sessionAtom);
  const [, setGptDirectDraft] = useAtom(gptDirectDraftAtom);
  const navigate = useNavigate();
  const client = useQueryClient();
  const { flags } = useFeatures();
  const [error, setError] = useState("");
  const [telegramBindCode, setTelegramBindCode] = useState<string | null>(null);
  const [telegramError, setTelegramError] = useState("");
  const [telegramUnbind, setTelegramUnbind] = useState<{ id: string; maskedEmail: string; expiresAt: number; resendAt: number } | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const query = useQuery({ queryKey: ["settings"], queryFn: () => getSettings(session!.token), enabled: Boolean(session) });
  const telegram = useQuery({ queryKey: ["telegram"], queryFn: () => getTelegram(session!.token), enabled: Boolean(session) });
  const pendingUnbind = telegram.data?.data.pendingUnbind;
  const activeTelegramUnbind = useMemo(() => telegramUnbind ?? (pendingUnbind ? {
      id: pendingUnbind.challengeId,
      maskedEmail: pendingUnbind.maskedEmail,
      expiresAt: new Date(pendingUnbind.expiresAt).getTime(),
      resendAt: new Date(pendingUnbind.cooldownAt).getTime(),
    } : null), [pendingUnbind, telegramUnbind]);
  const mutation = useMutation({
    mutationFn: (value: { old: string; next: string; confirm: string }) => changePassword(session!.token, value.old, value.next, value.confirm),
    onSuccess: async () => { client.clear(); setGptDirectDraft(emptyGptDirectDraft()); setSession(null); await navigate({ to: "/login" }); },
    onError: (cause) => setError(cause instanceof Error ? cause.message : t("updateFailed")),
  });
  const avatar = useMutation({ mutationFn: (url: string) => updateAvatar(session!.token, url), onSuccess: () => client.invalidateQueries({ queryKey: ["settings"] }), onError: (cause) => setError(cause instanceof Error ? cause.message : t("updateFailed")) });
  const issueBindCode = useMutation({
    mutationFn: () => issueTelegramBindCode(session!.token),
    onSuccess: (result) => setTelegramBindCode(result.data.bindCode),
    onError: (cause) => setError(cause instanceof Error ? cause.message : t("updateFailed")),
  });
  const issueUnbindCode = useMutation({
    mutationFn: () => requestTelegramUnbindCode(session!.token),
    onSuccess: (result) => {
      const current = Date.now();
      setTelegramError("");
      setClock(current);
      setTelegramUnbind({
        id: result.data.challengeId,
        maskedEmail: result.data.maskedEmail,
        expiresAt: current + result.data.expiresInSeconds * 1_000,
        resendAt: current + result.data.cooldownSeconds * 1_000,
      });
    },
    onError: async (cause) => {
      setTelegramError(cause instanceof Error ? cause.message : t("updateFailed"));
      await client.invalidateQueries({ queryKey: ["telegram"] });
    },
  });
  const unbind = useMutation({
    mutationFn: (code: string) => unbindTelegram(session!.token, activeTelegramUnbind!.id, code),
    onSuccess: async () => {
      setTelegramBindCode(null);
      client.clear();
      setGptDirectDraft(emptyGptDirectDraft());
      setSession(null);
      localStorage.removeItem("session");
      await navigate({ to: "/login" });
    },
    onError: (cause) => setTelegramError(cause instanceof Error ? cause.message : t("updateFailed")),
  });
  useEffect(() => {
    if (!activeTelegramUnbind) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [activeTelegramUnbind]);
  if (!session) return <Navigate to="/login" />;
  if (!query.data || !telegram.data) return <PageShell eyebrow="SECURITY" title={t("settingsTitle")} description={t("settingsDesc")}>
    <section className="settings-layout" aria-busy="true">
      <article className="module-card settings-profile">
        <div className="stat-icon"><UserRound /></div>
        <h2><DataSkeleton /></h2>
        <p><DataSkeleton /></p>
        <strong>{t("inviteCode")} <DataSkeleton className="settings-invite-skeleton" /></strong>
        <form><label>{t("avatarUrl")}<input type="url" placeholder="https://…" disabled /></label><Button disabled>{t("save")}</Button></form>
      </article>
      <article className="module-card settings-security">
        <div className="stat-icon"><KeyRound /></div>
        <h2>{t("changePassword")}</h2>
        <form>
          <label>{t("oldPassword")}<input type="password" autoComplete="current-password" disabled /></label>
          <label>{t("newPassword")}<input type="password" autoComplete="new-password" disabled /></label>
          <label>{t("confirmPassword")}<input type="password" autoComplete="new-password" disabled /></label>
          <Button disabled>{t("saveRelogin")}</Button>
        </form>
      </article>
      <section className="deposit-panel settings-telegram">
        <div className="section-title"><h2><Send /> Telegram</h2></div>
        <div className="deposit-address"><DataSkeleton /><DataSkeleton /></div>
      </section>
    </section>
  </PageShell>;
  const settings = query.data.data;
  const emailLoginEnabled = settings.emailLoginEnabled ?? Boolean(settings.email);
  const canUnbind = settings.canUnbind ?? Boolean(settings.email);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    mutation.mutate({ old: String(data.get("old")), next: String(data.get("next")), confirm: String(data.get("confirm")) });
  }
  return <PageShell eyebrow="SECURITY" title={t("settingsTitle")} description={t("settingsDesc")}>
    <section className="settings-layout">
      <article className="module-card settings-profile">
        <div className="stat-icon"><UserRound /></div>
        <h2>{settings.displayName ?? settings.email ?? `#${settings.userId}`}</h2>
        <p>{settings.role} · {settings.memberTier}</p>
        <strong>{t("inviteCode")} {settings.inviteCode}</strong>
        {settings.memberTier !== "none" && <form onSubmit={(event) => {
          event.preventDefault();
          avatar.mutate(String(new FormData(event.currentTarget).get("avatarUrl")));
        }}>
          <label>{t("avatarUrl")}<input name="avatarUrl" type="url" defaultValue={settings.avatarUrl ?? ""} placeholder="https://…" required /></label>
          <Button disabled={avatar.isPending}>{t("save")}</Button>
        </form>}
      </article>
      {emailLoginEnabled ? <article className="module-card settings-security">
        <div className="stat-icon"><KeyRound /></div>
        <h2>{t("changePassword")}</h2>
        <form onSubmit={submit}>
          <label>{t("oldPassword")}<input name="old" type="password" autoComplete="current-password" required /></label>
          <label>{t("newPassword")}<input name="next" type="password" autoComplete="new-password" minLength={12} required /></label>
          <label>{t("confirmPassword")}<input name="confirm" type="password" autoComplete="new-password" minLength={12} required /></label>
          {error && <p role="alert" className="error">{error}</p>}
          <Button disabled={mutation.isPending}>{t("saveRelogin")}</Button>
        </form>
      </article> : <EmailLoginSetup token={session.token} verificationPending={settings.emailVerificationPending ?? false} initialEmail={settings.pendingEmail ?? settings.email ?? ""} onComplete={() => void client.invalidateQueries({ queryKey: ["settings"] })} />}
      <section className="deposit-panel settings-telegram">
        <div className="section-title"><h2><Send /> Telegram</h2></div>
        {telegram.data.data.isBound
          ? <div className="deposit-address">
            <strong>@{telegram.data.data.username ?? telegram.data.data.chatId}</strong>
            {!canUnbind
              ? <p className="security-warning">{t("emailLoginRequiredBeforeUnbind")}</p>
              : !activeTelegramUnbind
              ? <Button variant="outline" disabled={issueUnbindCode.isPending} onClick={() => issueUnbindCode.mutate()}>{t("sendTelegramUnbindCode")}</Button>
              : <form key={activeTelegramUnbind.id} onSubmit={(event) => {
                event.preventDefault();
                setTelegramError("");
                unbind.mutate(String(new FormData(event.currentTarget).get("telegramUnbindCode")));
              }}>
                <p>{t("telegramUnbindCodeSent", { email: activeTelegramUnbind.maskedEmail })}</p>
                <label>{t("telegramUnbindCodeLabel")}<input name="telegramUnbindCode" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} required /></label>
                <small>{t("telegramUnbindExpires", { seconds: Math.max(0, Math.ceil((activeTelegramUnbind.expiresAt - clock) / 1_000)) })}</small>
                <div className="inline-action">
                  <Button type="submit" variant="destructive" disabled={unbind.isPending || clock >= activeTelegramUnbind.expiresAt}>{t("confirmTelegramUnbind")}</Button>
                  <Button type="button" variant="outline" disabled={issueUnbindCode.isPending || clock < activeTelegramUnbind.resendAt} onClick={() => issueUnbindCode.mutate()}>
                    {clock < activeTelegramUnbind.resendAt ? t("resendTelegramUnbindCountdown", { seconds: Math.ceil((activeTelegramUnbind.resendAt - clock) / 1_000) }) : t("resendTelegramUnbindCode")}
                  </Button>
                </div>
              </form>}
            {canUnbind && <small>{t("emailDeliveryCheckSpamHint")}</small>}
            {telegramError && <p role="alert" className="error">{telegramError}</p>}
          </div>
          : !flags.telegram ? <div className="feature-disabled"><Send /><p>{t("featureUnavailable")}</p></div>
          : !telegram.data.data.botConfigured ? <div className="feature-disabled"><Send /><p>{t("telegramBotUnavailable")}</p></div>
          : <div className="deposit-address">
            <span>{t("telegramBindHint")}</span>
            {telegramBindCode && <>
              <strong data-testid="telegram-bind-code">/start {telegramBindCode}</strong>
              <small>{t("telegramBindCodeOnce")}</small>
              <Button asChild variant="outline"><a href={`https://t.me/${telegram.data.data.botName}?start=${telegramBindCode}`} target="_blank" rel="noreferrer">{t("openTelegramBot")}</a></Button>
            </>}
            <Button variant="outline" disabled={issueBindCode.isPending} onClick={() => issueBindCode.mutate()}>
              {t(telegramBindCode ? "regenerateTelegramBindCode" : "generateTelegramBindCode")}
            </Button>
          </div>}
      </section>
    </section>
  </PageShell>;
}
