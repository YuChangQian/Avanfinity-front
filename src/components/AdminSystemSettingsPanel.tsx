import { formatDecimal } from "../decimal";
import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Mail, RadioTower, RefreshCw, Save, Send, ShieldAlert, ShieldCheck, SlidersHorizontal, WalletCards } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  ApiError,
  getAdminSystemSettings,
  testAdminDepositSettings,
  testAdminSmtpSettings,
  updateAdminDepositSettings,
  updateAdminFeatures,
  updateAdminPaymentRisk,
  updateAdminDeclineThreshold,
  updateAdminWalletPolicy,
  updateAdminSmtpSettings,
  updateAdminGptProtocol,
  type AdminSystemSettings,
  type DeclineThresholdSettings,
  type DepositNetwork,
  type DepositSettings,
  type DepositSettingsInput,
  type FeatureFlags,
  type GptProtocolSettings,
  type PaymentRiskSettings,
  type SmtpSettings,
  type SmtpSettingsInput,
  type WalletPolicy,
} from "../api";
import { Button } from "./ui/button";
import { StableSwap } from "./StableSwap";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { DataSkeleton } from "./PageShell";

const featureKeys = [
  "registration",
  "walletTransfer",
  "cardOpening",
  "cardRecharge",
  "cardManagement",
  "cardDelete",
  "gptDirect",
  "gptCdk",
  "deposits",
  "rewards",
  "agent",
  "market",
  "developerApi",
  "telegram",
] as const satisfies ReadonlyArray<Exclude<keyof FeatureFlags, "version">>;

export function AdminSystemSettingsPanel({ token }: { token: string }) {
  const { t } = useTranslation();
  const settings = useQuery({
    queryKey: ["admin-system-settings"],
    queryFn: () => getAdminSystemSettings(token),
    retry: false,
  });
  if (settings.isLoading) return <div className="admin-panel-stack" data-testid="admin-panel-system" aria-busy="true">
    <div className="admin-panel-heading"><div><span className="admin-kicker">PLATFORM</span><h2>{t("adminSystemSettings")}</h2><p>{t("adminSystemSettingsDesc")}</p></div></div>
    {[[Mail, "SMTP", "smtpSettings", "smtpSettingsHint"], [RadioTower, "USDT", "depositMonitorSettings", "depositMonitorSettingsHint"], [SlidersHorizontal, "FEATURES", "featureSettings", "featureSettingsHint"]].map(([Icon, kicker, title, hint]) => <section className="admin-surface admin-system-section" key={title as string}><div className="admin-section-heading"><div><span className="admin-kicker">{kicker as string}</span><h2><Icon />{t(title as string)}</h2><p>{t(hint as string)}</p></div><DataSkeleton /></div><form className="admin-system-form"><label className="admin-settings-toggle"><input type="checkbox" disabled /><span><strong><DataSkeleton /></strong><small><DataSkeleton /></small></span></label><div className="admin-system-form-grid">{[0, 1, 2, 3].map((field) => <label key={field}><DataSkeleton /><input disabled /></label>)}</div><div className="admin-form-actions"><Button disabled><Save />{t("save")}</Button></div></form></section>)}
  </div>;
  if (settings.isError || !settings.data) {
    return (
      <section className="admin-surface">
        <div className="admin-state is-error" role="alert">
          <span>{t("systemSettingsLoadFailed")}</span>
          <Button size="sm" variant="outline" onClick={() => void settings.refetch()}>{t("retry")}</Button>
        </div>
      </section>
    );
  }

  return <SystemSettingsForms token={token} initial={settings.data.data} />;
}

function SystemSettingsForms({ token, initial }: { token: string; initial: AdminSystemSettings }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [smtp, setSmtp] = useState<SmtpSettings>(initial.smtp);
  const [password, setPassword] = useState("");
  const [deposits, setDeposits] = useState<DepositSettings[]>(initial.deposits);
  const [savedDeposits, setSavedDeposits] = useState<DepositSettings[]>(initial.deposits);
  const [selectedDepositNetwork, setSelectedDepositNetwork] = useState<DepositNetwork>(initial.deposits[0]?.network ?? "TRON");
  const [depositAddresses, setDepositAddresses] = useState<Record<DepositNetwork, string>>({
    TRON: initial.deposits.find((item) => item.network === "TRON")?.addresses.join("\n") ?? "",
    BSC: initial.deposits.find((item) => item.network === "BSC")?.addresses.join("\n") ?? "",
    SOL: initial.deposits.find((item) => item.network === "SOL")?.addresses.join("\n") ?? "",
  });
  const [depositApiKeys, setDepositApiKeys] = useState<Record<DepositNetwork, string>>({ TRON: "", BSC: "", SOL: "" });
  const [removeDepositApiKeys, setRemoveDepositApiKeys] = useState<Record<DepositNetwork, boolean>>({ TRON: false, BSC: false, SOL: false });
  const [features, setFeatures] = useState<FeatureFlags>(initial.features);
  const [paymentRisk, setPaymentRisk] = useState<PaymentRiskSettings | null>(initial.paymentRisk ?? null);
  const [walletPolicy, setWalletPolicy] = useState<WalletPolicy>(initial.walletPolicy ?? { marginReserve: "20", version: 1 });
  const [gptProtocol, setGptProtocol] = useState<GptProtocolSettings | null>(initial.gptProtocol ?? null);
  const [csVisionApiKey, setCsVisionApiKey] = useState("");
  const [gptProtocolNotice, setGptProtocolNotice] = useState("");
  const [declineThreshold, setDeclineThreshold] = useState<DeclineThresholdSettings | null>(initial.declineThreshold ?? null);
  const [smtpNotice, setSmtpNotice] = useState("");
  const [smtpNoticeError, setSmtpNoticeError] = useState(false);
  const [depositNotice, setDepositNotice] = useState("");
  const [depositNoticeError, setDepositNoticeError] = useState(false);
  const [featureNotice, setFeatureNotice] = useState("");
  const [paymentRiskNotice, setPaymentRiskNotice] = useState("");
  const [walletPolicyNotice, setWalletPolicyNotice] = useState("");
  const [declineThresholdNotice, setDeclineThresholdNotice] = useState("");

  const smtpInput = (): SmtpSettingsInput => ({
    host: smtp.host.trim(),
    port: smtp.port,
    security: smtp.security,
    username: smtp.username.trim(),
    fromEmail: smtp.fromEmail.trim(),
    fromName: smtp.fromName.trim(),
    enabled: smtp.enabled,
    version: smtp.version,
    ...(password ? { password } : {}),
  });
  const smtpComplete = Boolean(
    smtp.host.trim()
    && smtp.username.trim()
    && smtp.fromEmail.trim()
    && smtp.fromName.trim()
    && (smtp.passwordConfigured || password),
  );
  const savedSmtp = initial.smtp;
  const smtpDirty = Boolean(password) || [
    "host", "port", "security", "username", "fromEmail", "fromName", "enabled",
  ].some((key) => smtp[key as keyof SmtpSettings] !== savedSmtp[key as keyof SmtpSettings]);
  const savedSmtpComplete = Boolean(smtp.enabled && smtpComplete && smtp.passwordConfigured && !smtpDirty);
  const deposit = (deposits.find((item) => item.network === selectedDepositNetwork) ?? deposits[0])!;
  const savedDeposit = (savedDeposits.find((item) => item.network === selectedDepositNetwork) ?? deposit)!;
  const depositAddressDraft = depositAddresses[selectedDepositNetwork];
  const depositApiKey = depositApiKeys[selectedDepositNetwork];
  const removeDepositApiKey = removeDepositApiKeys[selectedDepositNetwork];
  const normalizedDepositAddresses = depositAddressDraft
    .split(/\r?\n/)
    .map((address) => address.trim())
    .filter(Boolean);
  const depositInput = (): DepositSettingsInput => ({
    network: deposit.network,
    enabled: deposit.enabled,
    addresses: normalizedDepositAddresses,
    version: deposit.version,
    ...(deposit.network !== "SOL" ? (removeDepositApiKey ? { apiKey: "" } : depositApiKey ? { apiKey: depositApiKey } : {}) : {}),
  });
  const depositDirty = Boolean(depositApiKey || removeDepositApiKey)
    || deposit.enabled !== savedDeposit.enabled
    || normalizedDepositAddresses.join("\n") !== savedDeposit.addresses.join("\n");
  const depositComplete = !deposit.enabled || normalizedDepositAddresses.length > 0;
  const savedDepositComplete = Boolean(
    deposit.enabled
    && normalizedDepositAddresses.length
    && !depositDirty,
  );
  const clearDepositSecretDraft = (network: DepositNetwork) => {
    setDepositApiKeys((current) => ({ ...current, [network]: "" }));
    setRemoveDepositApiKeys((current) => ({ ...current, [network]: false }));
  };
  const reloadSettings = async (resetDepositNetwork?: DepositNetwork) => {
    const refreshed = await getAdminSystemSettings(token);
    client.setQueryData(["admin-system-settings"], refreshed);
    setSmtp(refreshed.data.smtp);
    setDeposits((current) => refreshed.data.deposits.map((item) => ({
      ...item,
      enabled: resetDepositNetwork === item.network
        ? item.enabled
        : current.find((draft) => draft.network === item.network)?.enabled ?? item.enabled,
    })));
    setSavedDeposits(refreshed.data.deposits);
    if (resetDepositNetwork) {
      const saved = refreshed.data.deposits.find((item) => item.network === resetDepositNetwork);
      if (saved) setDepositAddresses((current) => ({ ...current, [resetDepositNetwork]: saved.addresses.join("\n") }));
    }
    setFeatures(refreshed.data.features);
    setPaymentRisk(refreshed.data.paymentRisk ?? null);
    setWalletPolicy(refreshed.data.walletPolicy ?? { marginReserve: "20", version: 1 });
    setGptProtocol(refreshed.data.gptProtocol ?? null);
    setDeclineThreshold(refreshed.data.declineThreshold ?? null);
    await client.invalidateQueries({ queryKey: ["features"] });
  };
  const saveSmtp = useMutation({
    mutationFn: () => updateAdminSmtpSettings(token, smtpInput()),
    onSuccess: async () => { await reloadSettings(); setSmtpNoticeError(false); setSmtpNotice(t("smtpSettingsSaved")); },
    onError: (cause) => { setSmtpNoticeError(true); setSmtpNotice(cause instanceof Error ? cause.message : t("updateFailed")); },
    onSettled: () => setPassword(""),
  });
  const testSmtp = useMutation({
    mutationFn: () => testAdminSmtpSettings(token, smtp.version),
    onSuccess: async () => { await reloadSettings(); setSmtpNoticeError(false); setSmtpNotice(t("smtpTestSent")); },
    onError: async (cause) => {
      setSmtpNoticeError(true);
      setSmtpNotice(cause instanceof Error ? cause.message : t("smtpTestFailed"));
      try { await reloadSettings(); } catch { /* keep the original delivery error */ }
    },
    onSettled: () => setPassword(""),
  });
  const saveDeposits = useMutation({
    mutationFn: () => updateAdminDepositSettings(token, depositInput()),
    onSuccess: async () => { await reloadSettings(deposit.network); setDepositNoticeError(false); setDepositNotice(t("depositSettingsSaved")); },
    onError: (cause) => { setDepositNoticeError(true); setDepositNotice(cause instanceof Error ? cause.message : t("updateFailed")); },
    onSettled: () => clearDepositSecretDraft(deposit.network),
  });
  const testDeposits = useMutation({
    mutationFn: () => testAdminDepositSettings(token, deposit.network, deposit.version),
    onSuccess: async () => { await reloadSettings(); setDepositNoticeError(false); setDepositNotice(t("depositTestComplete")); },
    onError: async (cause) => {
      setDepositNoticeError(true);
      setDepositNotice(cause instanceof Error ? cause.message : t("depositTestFailed"));
      try { await reloadSettings(); } catch { /* keep the original scanner error */ }
    },
    onSettled: () => clearDepositSecretDraft(deposit.network),
  });
  const saveFeatures = useMutation({
    mutationFn: () => updateAdminFeatures(token, features),
    onSuccess: async () => { await reloadSettings(); setFeatureNotice(t("featureSettingsSaved")); },
    onError: (cause) => setFeatureNotice(cause instanceof Error ? cause.message : t("updateFailed")),
  });
  const savePaymentRisk = useMutation({
    mutationFn: () => updateAdminPaymentRisk(token, {
      version: paymentRisk!.version,
      enabled: paymentRisk!.enabled,
      windowDays: paymentRisk!.windowDays,
      minAttempts: paymentRisk!.minAttempts,
      lockThresholdBps: paymentRisk!.lockThresholdBps,
      releaseThresholdBps: paymentRisk!.releaseThresholdBps,
      reserveBps: paymentRisk!.reserveBps,
    }),
    onSuccess: async () => { await reloadSettings(); setPaymentRiskNotice(t("paymentRiskSettingsSaved")); },
    onError: (cause) => setPaymentRiskNotice(cause instanceof Error ? cause.message : t("updateFailed")),
  });
  const saveWalletPolicy = useMutation({
    mutationFn: () => updateAdminWalletPolicy(token, {
      version: walletPolicy.version,
      marginReserve: walletPolicy.marginReserve.trim(),
    }),
    onSuccess: async () => { await reloadSettings(); setWalletPolicyNotice(t("walletPolicySettingsSaved")); },
    onError: (cause) => setWalletPolicyNotice(cause instanceof Error ? cause.message : t("updateFailed")),
  });
  const saveGptProtocol = useMutation({
    mutationFn: () => updateAdminGptProtocol(token, {
      version: gptProtocol!.version,
      commitPayments: gptProtocol!.commitPayments,
      externalCardServiceFee: gptProtocol!.externalCardServiceFee,
      plusAccountCap: gptProtocol!.plusAccountCap,
      proAccountCap: gptProtocol!.proAccountCap,
      countries: gptProtocol!.countries.map((item) => ({
        country: item.country,
        currency: item.currency,
        enabled: item.enabled,
        sortOrder: item.sortOrder,
      })),
      ...(gptProtocol!.csVisionBaseUrl ? { csVisionBaseUrl: gptProtocol!.csVisionBaseUrl.trim() } : {}),
      ...(gptProtocol!.csVisionModel ? { csVisionModel: gptProtocol!.csVisionModel.trim() } : {}),
      ...(csVisionApiKey.trim() ? { csVisionApiKey: csVisionApiKey.trim() } : {}),
    }),
    onSuccess: async (response) => {
      setCsVisionApiKey("");
      setGptProtocol(response.data);
      await reloadSettings();
      setGptProtocolNotice(t("gptProtocolSettingsSaved"));
    },
    onError: (cause) => setGptProtocolNotice(cause instanceof Error ? cause.message : t("updateFailed")),
  });
  const saveDeclineThreshold = useMutation({
    mutationFn: () => updateAdminDeclineThreshold(token, {
      version: declineThreshold!.version,
      minAttempts: declineThreshold!.minAttempts,
      autoDeleteDeclines: declineThreshold!.autoDeleteDeclines,
      reversalFeeRate: declineThreshold!.reversalFeeRate.trim(),
    }),
    onSuccess: async () => { await reloadSettings(); setDeclineThresholdNotice(t("declineThresholdSettingsSaved")); },
    onError: (cause) => setDeclineThresholdNotice(cause instanceof Error ? cause.message : t("updateFailed")),
  });
  const declineThresholdInvalid = !declineThreshold
    || !Number.isInteger(declineThreshold.minAttempts)
    || declineThreshold.minAttempts < 1
    || declineThreshold.minAttempts > 10_000
    || !Number.isInteger(declineThreshold.autoDeleteDeclines)
    || declineThreshold.autoDeleteDeclines < 1
    || declineThreshold.autoDeleteDeclines > 4
    || !/^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/.test(declineThreshold.reversalFeeRate.trim())
    || Number(declineThreshold.reversalFeeRate) > 100;
  const walletPolicyInvalid = !/^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/.test(walletPolicy.marginReserve.trim())
    || Number(walletPolicy.marginReserve) > 1_000_000;
  const paymentRiskRecentAuthRequired = savePaymentRisk.error instanceof ApiError
    && savePaymentRisk.error.errorCode === "RECENT_AUTH_REQUIRED";
  const requestPaymentRiskRecentAuth = () => {
    sessionStorage.setItem("recentAuthReturnPath", "/admin?panel=system");
    window.location.assign("/login");
  };
  const paymentRiskInvalid = !paymentRisk
    || !Number.isInteger(paymentRisk.windowDays) || paymentRisk.windowDays < 1 || paymentRisk.windowDays > 365
    || !Number.isInteger(paymentRisk.minAttempts) || paymentRisk.minAttempts < 1 || paymentRisk.minAttempts > 10_000
    || !Number.isInteger(paymentRisk.lockThresholdBps) || paymentRisk.lockThresholdBps < 1 || paymentRisk.lockThresholdBps > 10_000
    || !Number.isInteger(paymentRisk.releaseThresholdBps) || paymentRisk.releaseThresholdBps < 0 || paymentRisk.releaseThresholdBps > 10_000
    || !Number.isInteger(paymentRisk.reserveBps) || paymentRisk.reserveBps < 1 || paymentRisk.reserveBps > 10_000
    || paymentRisk.releaseThresholdBps >= paymentRisk.lockThresholdBps;

  function submitSmtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSmtpNotice("");
    saveSmtp.mutate();
  }

  return <div className="admin-panel-stack" data-testid="admin-panel-system">
    <div className="admin-panel-heading">
      <div><span className="admin-kicker">PLATFORM</span><h2>{t("adminSystemSettings")}</h2><p>{t("adminSystemSettingsDesc")}</p></div>
    </div>

    <section className="admin-surface admin-system-section" aria-labelledby="smtp-settings-title">
      <div className="admin-section-heading">
        <div><span className="admin-kicker">SMTP</span><h2 id="smtp-settings-title"><Mail />{t("smtpSettings")}</h2><p>{t("smtpSettingsHint")}</p></div>
        <span className={`status-pill ${smtp.enabled ? "is-active" : ""}`}>{smtp.enabled ? t("enabled") : t("disabled")}</span>
      </div>
      <form className="admin-system-form" onSubmit={submitSmtp}>
        <label className="admin-settings-toggle">
          <input type="checkbox" checked={smtp.enabled} onChange={(event) => setSmtp((current) => ({ ...current, enabled: event.target.checked }))} />
          <span><strong>{t("smtpEnabled")}</strong><small>{t("smtpEnabledHint")}</small></span>
        </label>
        <div className="admin-system-form-grid">
          <label>{t("smtpHost")}<input value={smtp.host} onChange={(event) => setSmtp((current) => ({ ...current, host: event.target.value }))} placeholder="smtp.example.com" required={smtp.enabled} /></label>
          <label>{t("smtpTransport")}
            <Select value={`${smtp.port}:${smtp.security}`} onValueChange={(value) => setSmtp((current) => value === "587:starttls" ? { ...current, port: 587, security: "starttls" } : { ...current, port: 465, security: "tls" })}>
              <SelectTrigger aria-label={t("smtpTransport")}><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="465:tls">465 · TLS</SelectItem><SelectItem value="587:starttls">587 · STARTTLS</SelectItem></SelectContent>
            </Select>
          </label>
          <label>{t("smtpUsername")}<input value={smtp.username} onChange={(event) => setSmtp((current) => ({ ...current, username: event.target.value }))} autoComplete="username" required={smtp.enabled} /></label>
          <label>{t("smtpPassword")}<input data-testid="smtp-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" required={smtp.enabled && !smtp.passwordConfigured} placeholder={smtp.passwordConfigured ? t("smtpPasswordUnchanged") : t("smtpPasswordRequired")} /><small>{smtp.passwordConfigured ? t("smtpPasswordConfigured") : t("smtpPasswordNotConfigured")}</small></label>
          <label>{t("smtpFromEmail")}<input type="email" value={smtp.fromEmail} onChange={(event) => setSmtp((current) => ({ ...current, fromEmail: event.target.value }))} placeholder="no-reply@example.com" required={smtp.enabled} /></label>
          <label>{t("smtpFromName")}<input value={smtp.fromName} onChange={(event) => setSmtp((current) => ({ ...current, fromName: event.target.value }))} placeholder="AVANFINITY" required={smtp.enabled} /></label>
        </div>
        <p className="admin-settings-note">{t("smtpTestRecipientHint", { email: smtp.fromEmail || "—" })} {smtpDirty ? t("smtpSaveBeforeTest") : ""}</p>
        <dl className="admin-smtp-status" aria-label={t("smtpDeliveryStatus")}>
          <div><dt>{t("smtpReady")}</dt><dd><span className={`status-pill ${smtp.ready ? "is-active" : ""}`}>{smtp.ready ? t("ready") : t("notReady")}</span></dd></div>
          <div><dt>{t("smtpLastTest")}</dt><dd>{t(`smtpTestStatus.${smtp.lastTestStatus}`)}{smtp.lastTestAt ? ` · ${new Date(smtp.lastTestAt).toLocaleString()}` : ""}</dd></div>
          {smtp.lastErrorCode && <div><dt>{t("smtpLastErrorCode")}</dt><dd><code>{smtp.lastErrorCode}</code></dd></div>}
        </dl>
        {smtpNotice && <p className={`admin-alert ${smtpNoticeError ? "is-error" : "is-success"}`} role={smtpNoticeError ? "alert" : "status"}>{smtpNotice}</p>}
        <div className="admin-form-actions">
          <Button type="button" variant="outline" disabled={!savedSmtpComplete || saveSmtp.isPending || testSmtp.isPending} onClick={() => { setSmtpNotice(""); testSmtp.mutate(); }}><Send /><StableSwap state={testSmtp.isPending ? "busy" : "idle"} labels={{ idle: t("sendSmtpTest"), busy: t("sending") }} /></Button>
          <Button type="submit" disabled={(smtp.enabled && !smtpComplete) || saveSmtp.isPending || testSmtp.isPending}><Save /><StableSwap state={saveSmtp.isPending ? "busy" : "idle"} labels={{ idle: t("save"), busy: t("processing") }} /></Button>
        </div>
      </form>
    </section>

    <section className="admin-surface admin-system-section" aria-labelledby="deposit-settings-title">
      <div className="admin-section-heading">
        <div><span className="admin-kicker">{deposit.standard} · USDT</span><h2 id="deposit-settings-title"><RadioTower />{t("depositMonitorSettings")}</h2><p>{t("depositMonitorSettingsHint")}</p></div>
        <span className={`status-pill ${deposit.enabled ? "is-active" : ""}`}>{deposit.enabled ? t("enabled") : t("disabled")}</span>
      </div>
      <form className="admin-deposit-form" onSubmit={(event) => { event.preventDefault(); setDepositNotice(""); saveDeposits.mutate(); }}>
        <label className="admin-settings-toggle">
          <input type="checkbox" checked={deposit.enabled} onChange={(event) => setDeposits((current) => current.map((item) => item.network === deposit.network ? { ...item, enabled: event.target.checked } : item))} />
          <span><strong>{t("depositMonitorEnabled")}</strong><small>{t("depositMonitorEnabledHint")}</small></span>
        </label>
        <div className="admin-deposit-asset" aria-label={t("depositMonitorAsset")}> 
          <div><span>{t("depositAsset")}</span><strong>{deposit.currency}</strong></div>
          <div><span>{t("depositNetwork")}</span>
            <Select value={deposit.network} onValueChange={(value) => { setSelectedDepositNetwork(value as DepositNetwork); setDepositNotice(""); }} disabled={saveDeposits.isPending || testDeposits.isPending}>
              <SelectTrigger className="deposit-network-trigger" aria-label={t("depositNetworkSelect")} data-testid="admin-deposit-network-select"><SelectValue /></SelectTrigger>
              <SelectContent>{deposits.map((item) => <SelectItem key={item.network} value={item.network}>{t(`depositNetworkName.${item.network}`)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <div className="admin-system-form-grid">
          <label className="admin-deposit-address-field">{deposit.network === "SOL" ? t("solanaWalletAddresses") : t("depositWalletAddresses")}
            <textarea
              data-testid="deposit-address-pool"
              value={depositAddressDraft}
              onChange={(event) => setDepositAddresses((current) => ({ ...current, [deposit.network]: event.target.value }))}
              placeholder={deposit.network === "SOL" ? t("solanaWalletAddressesPlaceholder") : t("depositWalletAddressesPlaceholder", { network: t(`depositNetworkName.${deposit.network}`) })}
              autoComplete="off"
              spellCheck={false}
              required={deposit.enabled}
            />
            <small>{deposit.network === "SOL" ? t("solanaWalletAddressesHint") : t("depositWalletAddressesHint", { network: t(`depositNetworkName.${deposit.network}`) })}</small>
          </label>
          {deposit.network !== "SOL" && <div className="admin-deposit-key-field">
            <label>{t(deposit.network === "BSC" ? "bscRpcApiKey" : "tronGridApiKey")}
              <input
                data-testid="deposit-api-key"
                type="password"
                value={depositApiKey}
                onChange={(event) => setDepositApiKeys((current) => ({ ...current, [deposit.network]: event.target.value }))}
                autoComplete="new-password"
                disabled={removeDepositApiKey}
                placeholder={deposit.apiKeyConfigured ? t("depositApiKeyUnchanged") : t("depositApiKeyOptional")}
              />
              <small>{deposit.apiKeyConfigured ? t("depositApiKeyConfigured") : t("depositApiKeyNotConfigured")}</small>
            </label>
            {deposit.apiKeyConfigured && <label className="admin-settings-toggle admin-deposit-remove-key">
              <input
                type="checkbox"
                checked={removeDepositApiKey}
                disabled={Boolean(depositApiKey)}
                onChange={(event) => {
                  setRemoveDepositApiKeys((current) => ({ ...current, [deposit.network]: event.target.checked }));
                  if (event.target.checked) setDepositApiKeys((current) => ({ ...current, [deposit.network]: "" }));
                }}
              />
              <span><strong>{t(deposit.network === "BSC" ? "removeBscRpcApiKey" : "removeDepositApiKey")}</strong><small>{t("removeDepositApiKeyHint")}</small></span>
            </label>}
          </div>}
        </div>
        <p className="admin-alert is-warning admin-deposit-secret-warning" role="note"><ShieldCheck />{t("depositPublicAddressOnly")}</p>
        {deposit.network === "SOL" && <p className="admin-alert is-warning" role="note">{t("solanaWalletAddressWarning")}</p>}
        {deposit.network === "TRON" && (!deposit.apiKeyConfigured || removeDepositApiKey) && !depositApiKey && <p className="admin-alert is-warning" role="note">{t("depositKeylessAddressWarning")}</p>}
        {deposit.network === "BSC" && (!deposit.apiKeyConfigured || removeDepositApiKey) && !depositApiKey && <p className="admin-alert is-warning" role="note">{t("bscKeylessAddressWarning")}</p>}
        <dl className="admin-smtp-status admin-deposit-status" aria-label={t("depositMonitorStatus")}> 
          <div><dt>{t("depositScanner")}</dt><dd><span className={`status-pill ${deposit.ready ? "is-active" : ""}`}>{deposit.ready ? t("ready") : t("notReady")}</span></dd></div>
          <div><dt>{deposit.network === "SOL" ? t("usdtTokenMint") : t("depositTokenContract")}</dt><dd><code>{deposit.tokenContract}</code></dd></div>
          {deposit.network !== "SOL" && <div><dt>{t("depositApiCredential")}</dt><dd>{deposit.apiKeyConfigured ? t("depositCredentialConfigured") : t("depositCredentialNotConfigured")}</dd></div>}
          <div><dt>{t("depositAddressCount")}</dt><dd>{deposit.addresses.length}</dd></div>
          <div><dt>{t("depositLastTest")}</dt><dd>{t(`depositTestStatus.${deposit.lastTestStatus}`)}{deposit.lastTestAt ? ` · ${new Date(deposit.lastTestAt).toLocaleString()}` : ""}</dd></div>
          <div><dt>{t("depositLastSuccess")}</dt><dd>{deposit.lastSuccessAt ? new Date(deposit.lastSuccessAt).toLocaleString() : "—"}</dd></div>
        </dl>
        {deposit.lastError && <p className="admin-alert is-error" role="note"><span><strong>{t("depositLastError")}</strong>{deposit.lastErrorAt ? ` · ${new Date(deposit.lastErrorAt).toLocaleString()}` : ""}<br />{deposit.lastError}</span></p>}
        {depositNotice && <p className={`admin-alert ${depositNoticeError ? "is-error" : "is-success"}`} role={depositNoticeError ? "alert" : "status"}>{depositNotice}</p>}
        <div className="admin-form-actions">
          <Button type="button" variant="outline" disabled={!savedDepositComplete || saveDeposits.isPending || testDeposits.isPending} onClick={() => { setDepositNotice(""); testDeposits.mutate(); }}><RefreshCw /><StableSwap state={testDeposits.isPending ? "busy" : "idle"} labels={{ idle: t("testDepositMonitor"), busy: t("depositTesting") }} /></Button>
          <Button type="submit" disabled={!depositComplete || saveDeposits.isPending || testDeposits.isPending}><Save /><StableSwap state={saveDeposits.isPending ? "busy" : "idle"} labels={{ idle: t("save"), busy: t("processing") }} /></Button>
        </div>
      </form>
    </section>

    {paymentRisk && <section className="admin-surface admin-system-section" aria-labelledby="payment-risk-settings-title" data-testid="payment-risk-settings">
      <div className="admin-section-heading">
        <div><span className="admin-kicker">PAYMENT RISK</span><h2 id="payment-risk-settings-title"><ShieldCheck />{t("paymentRiskSettings")}</h2><p>{t("paymentRiskSettingsHint")}</p></div>
        <span className={`status-pill ${paymentRisk.enabled ? "is-active" : ""}`}>{paymentRisk.enabled ? t("enabled") : t("disabled")}</span>
      </div>
      <form className="admin-system-form" onSubmit={(event) => { event.preventDefault(); setPaymentRiskNotice(""); savePaymentRisk.mutate(); }}>
        <label className="admin-settings-toggle">
          <input type="checkbox" checked={paymentRisk.enabled} onChange={(event) => setPaymentRisk((current) => current ? { ...current, enabled: event.target.checked } : current)} />
          <span><strong>{t("paymentRiskEnabled")}</strong><small>{t("paymentRiskEnabledHint")}</small></span>
        </label>
        <div className="admin-system-form-grid payment-risk-settings-grid">
          <label>{t("paymentRiskWindowDays")}<input type="number" min={1} max={365} value={paymentRisk.windowDays} onChange={(event) => setPaymentRisk((current) => current ? { ...current, windowDays: Number(event.target.value) } : current)} required /></label>
          <label>{t("paymentRiskMinAttempts")}<input type="number" min={1} max={10000} value={paymentRisk.minAttempts} onChange={(event) => setPaymentRisk((current) => current ? { ...current, minAttempts: Number(event.target.value) } : current)} required /></label>
          <label>{t("paymentRiskLockThreshold")}<input type="number" min={0.01} max={100} step="0.01" value={paymentRisk.lockThresholdBps / 100} onChange={(event) => setPaymentRisk((current) => current ? { ...current, lockThresholdBps: Math.round(Number(event.target.value) * 100) } : current)} required /><small>{t("paymentRiskPercentHint")}</small></label>
          <label>{t("paymentRiskReleaseThreshold")}<input type="number" min={0} max={100} step="0.01" value={paymentRisk.releaseThresholdBps / 100} onChange={(event) => setPaymentRisk((current) => current ? { ...current, releaseThresholdBps: Math.round(Number(event.target.value) * 100) } : current)} required /><small>{t("paymentRiskReleaseHint")}</small></label>
          <label>{t("paymentRiskReserveRatio")}<input type="number" min={0.01} max={100} step="0.01" value={paymentRisk.reserveBps / 100} onChange={(event) => setPaymentRisk((current) => current ? { ...current, reserveBps: Math.round(Number(event.target.value) * 100) } : current)} required /><small>{t("paymentRiskPercentHint")}</small></label>
        </div>
        <p className="admin-settings-note">{t("paymentRiskCurrentPolicy", { days: paymentRisk.windowDays, attempts: paymentRisk.minAttempts, lock: formatDecimal((paymentRisk.lockThresholdBps / 100).toFixed(2)), release: formatDecimal((paymentRisk.releaseThresholdBps / 100).toFixed(2)), reserve: formatDecimal((paymentRisk.reserveBps / 100).toFixed(2)) })}</p>
        {paymentRiskNotice && <p className={`admin-alert ${savePaymentRisk.isError ? "is-error" : "is-success"}`} role={savePaymentRisk.isError ? "alert" : "status"}><span>{paymentRiskNotice}</span>{paymentRiskRecentAuthRequired && <Button type="button" size="xs" variant="outline" onClick={requestPaymentRiskRecentAuth}>{t("verifyAgain")}</Button>}</p>}
        <div className="admin-form-actions"><Button type="submit" disabled={savePaymentRisk.isPending || paymentRiskInvalid}><Save /><StableSwap state={savePaymentRisk.isPending ? "busy" : "idle"} labels={{ idle: t("save"), busy: t("processing") }} /></Button></div>
      </form>
    </section>}

    {gptProtocol && <section className="admin-surface admin-system-section" aria-labelledby="gpt-protocol-settings-title" data-testid="gpt-protocol-settings">
      <div className="admin-section-heading">
        <div><span className="admin-kicker">GPT</span><h2 id="gpt-protocol-settings-title"><Bot />{t("gptProtocolSettings")}</h2><p>{t("gptProtocolSettingsHint")}</p></div>
      </div>
      <form className="admin-system-form" onSubmit={(event) => { event.preventDefault(); setGptProtocolNotice(""); saveGptProtocol.mutate(); }}>
        <label className="admin-settings-toggle">
          <input type="checkbox" checked={gptProtocol.commitPayments} onChange={(event) => setGptProtocol((current) => current ? { ...current, commitPayments: event.target.checked } : current)} />
          <span><strong>{t("gptProtocolCommit")}</strong><small>{t("gptProtocolCommitHint")}</small></span>
        </label>
        <div className="admin-system-form-grid">
          <label>{t("gptExternalCardServiceFee")}
            <input type="number" min="0.0001" max="1000000" step="0.0001" value={gptProtocol.externalCardServiceFee} onChange={(event) => setGptProtocol((current) => current ? { ...current, externalCardServiceFee: event.target.value } : current)} required />
            <small>{t("gptExternalCardServiceFeeHint")}</small>
          </label>
          <label>{t("gptProtocolPlusCap")}
            <input type="number" min={1} max={50} value={gptProtocol.plusAccountCap} onChange={(event) => setGptProtocol((current) => current ? { ...current, plusAccountCap: Number(event.target.value) } : current)} />
          </label>
          <label>{t("gptProtocolProCap")}
            <input type="number" min={1} max={50} value={gptProtocol.proAccountCap} onChange={(event) => setGptProtocol((current) => current ? { ...current, proAccountCap: Number(event.target.value) } : current)} />
          </label>
        </div>
        <h3>{t("gptCsVision")}</h3>
        <p className="admin-settings-note">{t("gptCsVisionHint")}</p>
        <div className="admin-system-form-grid">
          <label>{t("gptCsVisionBase")}
            <input value={gptProtocol.csVisionBaseUrl ?? ""} onChange={(event) => setGptProtocol((current) => current ? { ...current, csVisionBaseUrl: event.target.value } : current)} autoComplete="off" />
          </label>
          <label>{t("gptCsVisionModel")}
            <input value={gptProtocol.csVisionModel ?? ""} onChange={(event) => setGptProtocol((current) => current ? { ...current, csVisionModel: event.target.value } : current)} autoComplete="off" />
          </label>
          <label>{t("gptCsVisionApiKey")}
            <input data-testid="gpt-cs-vision-api-key" type="password" value={csVisionApiKey} onChange={(event) => setCsVisionApiKey(event.target.value)} autoComplete="new-password" placeholder={gptProtocol.csVisionApiKeyConfigured ? t("gptCsVisionApiKeyConfigured") : t("gptCsVisionApiKeyMissing")} />
            <small>{gptProtocol.csVisionApiKeyConfigured ? t("gptCsVisionApiKeyConfigured") : t("gptCsVisionApiKeyMissing")}</small>
          </label>
        </div>
        <h3>{t("gptProtocolCountries")}</h3>
        <div className="admin-feature-grid">
          {gptProtocol.countries.map((country) => <label className="admin-settings-toggle" key={country.country}>
            <input type="checkbox" checked={country.enabled} onChange={(event) => setGptProtocol((current) => current ? {
              ...current,
              countries: current.countries.map((item) => item.country === country.country ? { ...item, enabled: event.target.checked } : item),
            } : current)} />
            <span><strong>{country.country} · {country.currency}</strong><small>{t("gptProtocolCountryEnabled")}</small></span>
          </label>)}
        </div>
        {gptProtocolNotice && <p className={`admin-alert ${saveGptProtocol.isError ? "is-error" : "is-success"}`} role={saveGptProtocol.isError ? "alert" : "status"}>{gptProtocolNotice}</p>}
        <div className="admin-form-actions"><Button type="submit" disabled={saveGptProtocol.isPending}><Save /><StableSwap state={saveGptProtocol.isPending ? "busy" : "idle"} labels={{ idle: t("save"), busy: t("processing") }} /></Button></div>
      </form>
    </section>}

    <section className="admin-surface admin-system-section" aria-labelledby="wallet-policy-settings-title" data-testid="wallet-policy-settings">
      <div className="admin-section-heading">
        <div><span className="admin-kicker">WALLET</span><h2 id="wallet-policy-settings-title"><WalletCards />{t("walletPolicySettings")}</h2><p>{t("walletPolicySettingsHint")}</p></div>
      </div>
      <form className="admin-system-form" onSubmit={(event) => { event.preventDefault(); setWalletPolicyNotice(""); saveWalletPolicy.mutate(); }}>
        <div className="admin-system-form-grid">
          <label>{t("walletPolicyMarginReserve")}
            <input
              type="number"
              min={0}
              max={1000000}
              step="0.0001"
              value={walletPolicy.marginReserve}
              onChange={(event) => setWalletPolicy((current) => ({ ...current, marginReserve: event.target.value }))}
              required
            />
            <small>{t("walletPolicyMarginReserveHint")}</small>
          </label>
        </div>
        {walletPolicyNotice && <p className={`admin-alert ${saveWalletPolicy.isError ? "is-error" : "is-success"}`} role={saveWalletPolicy.isError ? "alert" : "status"}>{walletPolicyNotice}</p>}
        <div className="admin-form-actions"><Button type="submit" disabled={saveWalletPolicy.isPending || walletPolicyInvalid}><Save /><StableSwap state={saveWalletPolicy.isPending ? "busy" : "idle"} labels={{ idle: t("saveWalletPolicy"), busy: t("processing") }} /></Button></div>
      </form>
    </section>

    {declineThreshold && <section className="admin-surface admin-system-section" aria-labelledby="decline-threshold-settings-title" data-testid="decline-threshold-settings">
      <div className="admin-section-heading">
        <div><span className="admin-kicker">RISK</span><h2 id="decline-threshold-settings-title"><ShieldAlert />{t("declineThresholdSettings")}</h2><p>{t("declineThresholdSettingsHint")}</p></div>
      </div>
      <form className="admin-system-form" onSubmit={(event) => { event.preventDefault(); setDeclineThresholdNotice(""); saveDeclineThreshold.mutate(); }}>
        <div className="admin-system-form-grid">
          <label>{t("declineThresholdMinAttempts")}
            <input
              type="number"
              min={1}
              max={10000}
              value={declineThreshold.minAttempts}
              onChange={(event) => setDeclineThreshold((current) => current ? { ...current, minAttempts: Number(event.target.value) } : current)}
              required
            />
            <small>{t("declineThresholdMinAttemptsHint")}</small>
          </label>
          <label>{t("declineThresholdReversalFeeRate")}
            <input
              type="number"
              min={0}
              max={100}
              step="0.0001"
              value={declineThreshold.reversalFeeRate}
              onChange={(event) => setDeclineThreshold((current) => current ? { ...current, reversalFeeRate: event.target.value } : current)}
              required
            />
            <small>{t("declineThresholdReversalFeeRateHint")}</small>
          </label>
          <label>{t("declineAutoDeleteAttempts")}
            <input
              type="number"
              min={1}
              max={4}
              value={declineThreshold.autoDeleteDeclines}
              onChange={(event) => setDeclineThreshold((current) => current ? { ...current, autoDeleteDeclines: Number(event.target.value) } : current)}
              required
            />
            <small>{t("declineAutoDeleteAttemptsHint")}</small>
          </label>
        </div>
        <p className="admin-settings-note">{t("declineThresholdCurrentPolicy", { attempts: declineThreshold.minAttempts, reversal: declineThreshold.reversalFeeRate, autoDelete: declineThreshold.autoDeleteDeclines })}</p>
        {declineThresholdNotice && <p className={`admin-alert ${saveDeclineThreshold.isError ? "is-error" : "is-success"}`} role={saveDeclineThreshold.isError ? "alert" : "status"}>{declineThresholdNotice}</p>}
        <div className="admin-form-actions"><Button type="submit" disabled={saveDeclineThreshold.isPending || declineThresholdInvalid}><Save /><StableSwap state={saveDeclineThreshold.isPending ? "busy" : "idle"} labels={{ idle: t("save"), busy: t("processing") }} /></Button></div>
      </form>
    </section>}

    <section className="admin-surface admin-system-section" aria-labelledby="feature-settings-title">
      <div className="admin-section-heading">
        <div><span className="admin-kicker">FEATURES</span><h2 id="feature-settings-title"><SlidersHorizontal />{t("featureSettings")}</h2><p>{t("featureSettingsHint")}</p></div>
      </div>
      <form className="admin-feature-form" onSubmit={(event) => { event.preventDefault(); setFeatureNotice(""); saveFeatures.mutate(); }}>
        <div className="admin-feature-grid">
          {featureKeys.map((key) => {
            const requiresSmtp = key === "registration" && !smtp.ready && !features.registration;
            const requiresDepositMonitor = key === "deposits" && !deposits.some((item) => item.ready) && !features.deposits;
            return <label className="admin-settings-toggle" key={key}>
              <input type="checkbox" checked={features[key]} disabled={requiresSmtp || requiresDepositMonitor} onChange={(event) => setFeatures((current) => ({ ...current, [key]: event.target.checked }))} />
              <span><strong>{t(`feature.${key}`)}</strong><small>{requiresSmtp ? t("registrationRequiresSmtp") : requiresDepositMonitor ? t("depositRequiresMonitor") : t(`featureHint.${key}`)}</small></span>
            </label>;
          })}
        </div>
        {featureNotice && <p className={`admin-alert ${saveFeatures.isError ? "is-error" : "is-success"}`} role={saveFeatures.isError ? "alert" : "status"}>{featureNotice}</p>}
        <div className="admin-form-actions"><Button type="submit" disabled={saveFeatures.isPending}><Save /><StableSwap state={saveFeatures.isPending ? "busy" : "idle"} labels={{ idle: t("saveFeatureSettings"), busy: t("processing") }} /></Button></div>
      </form>
    </section>
  </div>;
}
