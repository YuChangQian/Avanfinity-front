import { formatDecimal } from "../decimal";
import { GPT_SESSION_MAX_BYTES } from "../gptSession";
import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, RefreshCw, ShieldAlert, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  ApiError,
  deleteAdminGptQuoteRefresh,
  getAdminGptCdks,
  getAdminGptQuoteRefresh,
  updateAdminGptCdkPricing,
  updateAdminGptQuoteRefresh,
  type AdminGptCdkInventory,
  type AdminGptCdkPricing,
  type AdminGptQuoteRefreshSettings,
} from "../api";
import { Button } from "./ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

type PricingInput = Parameters<typeof updateAdminGptCdkPricing>[1];

function money(value: string | null | undefined) {
  if (value == null || value === "") return "—";
  const amount = Number(value);
  return Number.isFinite(amount) ? `$${formatDecimal(value)}` : `$${value}`;
}

function quoted(minor: number | null | undefined, currency: string | null | undefined) {
  if (typeof minor !== "number" || !Number.isFinite(minor) || minor < 0) return "—";
  if (!currency || currency.length !== 3) return `$${formatDecimal((minor / 100).toFixed(2))}`;
  return `${currency} ${formatDecimal((minor / 100).toFixed(2))}`;
}

function QuoteRefreshForm({ token, settings }: { token: string; settings: AdminGptQuoteRefreshSettings }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "en" ? "en-US" : "zh-CN";
  const client = useQueryClient();
  const [session, setSession] = useState("");
  const save = useMutation({
    mutationFn: (input: Parameters<typeof updateAdminGptQuoteRefresh>[1]) => updateAdminGptQuoteRefresh(token, input),
    onSuccess: async () => {
      setSession("");
      await client.invalidateQueries({ queryKey: ["admin-gpt-quote-refresh"] });
    },
  });
  const remove = useMutation({
    mutationFn: () => deleteAdminGptQuoteRefresh(token),
    onSuccess: async () => {
      setSession("");
      await client.invalidateQueries({ queryKey: ["admin-gpt-quote-refresh"] });
    },
  });
  const error = save.error ?? remove.error;
  const recentAuthRequired = error instanceof ApiError && error.errorCode === "RECENT_AUTH_REQUIRED";
  const requestRecentAuth = () => {
    sessionStorage.setItem("recentAuthReturnPath", "/admin?panel=cdks");
    window.location.assign("/login");
  };
  const pending = save.isPending || remove.isPending;
  const displayDate = (value: string | null) => value ? new Date(value).toLocaleString(locale) : "—";

  return <section className="admin-surface" data-testid="admin-gpt-quote-refresh">
    <div className="admin-section-heading"><div><span className="admin-kicker">AUTO REFRESH</span><h3>{t("cdkQuoteRefresh")}</h3><p>{t("cdkQuoteRefreshHint")}</p></div><RefreshCw /></div>
    <form className="admin-cdk-refresh-form" onSubmit={(event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      save.mutate({
        ...(session ? { session } : {}),
        enabled: data.get("enabled") === "on",
        intervalMinutes: Number(data.get("intervalMinutes")),
      });
    }}>
      <label>{t(settings.configured ? "cdkReplaceRefreshSession" : "cdkRefreshSession")}
        <input name="session" type="password" autoComplete="off" minLength={8} maxLength={GPT_SESSION_MAX_BYTES} value={session} onChange={(event) => setSession(event.target.value)} placeholder={settings.configured ? t("cdkSessionStored") : t("cdkSessionPlaceholder")} required={!settings.configured} disabled={pending} />
      </label>
      <label>{t("cdkRefreshInterval")}<input name="intervalMinutes" type="number" min="15" max="300" step="1" defaultValue={settings.intervalMinutes} required disabled={pending} /></label>
      <label className="admin-cdk-toggle"><input name="enabled" type="checkbox" defaultChecked={settings.enabled} disabled={pending} />{t("cdkRefreshEnabled")}</label>
      <div className="admin-cdk-refresh-actions">
        <Button type="submit" size="sm" disabled={pending}>{t("save")}</Button>
        {settings.configured && <Button type="button" size="sm" variant="destructive" disabled={pending} onClick={() => {
          if (window.confirm(t("cdkDeleteRefreshConfirm"))) remove.mutate();
        }}><Trash2 />{t("delete")}</Button>}
      </div>
    </form>
    <dl className="admin-cdk-pricing-summary admin-cdk-refresh-summary">
      <div><dt>{t("status")}</dt><dd><span className={`status-pill ${settings.status === "healthy" ? "is-active" : ""}`}>{t(`cdkQuoteRefreshStatus.${settings.status}`)}</span></dd></div>
      <div><dt>{t("cdkLastRefresh")}</dt><dd>{displayDate(settings.lastRefreshAt)}</dd></div>
      <div><dt>{t("cdkLastRefreshSuccess")}</dt><dd>{displayDate(settings.lastSuccessAt)}</dd></div>
      <div><dt>{t("cdkNextRefresh")}</dt><dd>{settings.enabled ? displayDate(settings.nextRefreshAt) : "—"}</dd></div>
    </dl>
    {!settings.notificationReady && <p className="admin-alert is-warning"><ShieldAlert />{t("cdkRefreshTelegramRequired")}</p>}
    {error && <p className="admin-alert is-error" role="alert"><span>{error instanceof Error ? error.message : t("updateFailed")}</span>{recentAuthRequired && <Button type="button" size="xs" variant="outline" onClick={requestRecentAuth}>{t("verifyAgain")}</Button>}</p>}
  </section>;
}

function PricingForm({ item, pending, save }: { item: AdminGptCdkPricing; pending: boolean; save: (input: PricingInput) => void }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "en" ? "en-US" : "zh-CN";
  const [mode, setMode] = useState(item.pricingMode);
  const listed = item.salePrice ?? item.fixedPrice;

  return <form onSubmit={(event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    save({
      plan: item.plan,
      enabled: data.get("enabled") === "on",
      salePrice: mode === "FIXED" ? String(data.get("salePrice")) : item.fixedPrice,
      pricingMode: mode,
      markupValue: mode === "FIXED" ? "0" : String(data.get("markupValue")),
    });
  }}>
    <div className="admin-cdk-pricing-title">
      <strong>{t(`gptPlan.${item.plan}`, { defaultValue: item.plan })}</strong>
      <small>v{item.version} · {t("updatedAt")}: {new Date(item.updatedAt).toLocaleString(locale)}</small>
    </div>
    <div className="admin-cdk-listed-price" data-testid={`cdk-listed-price-${item.plan}`}>
      <span>{t("cdkListedSalePrice")}</span>
      <strong>{money(listed)}</strong>
    </div>
    <div className="admin-cdk-pricing-mode">
      <span>{t("cdkPricingMode")}</span>
      <Select value={mode} onValueChange={(value) => setMode(value as AdminGptCdkPricing["pricingMode"])} disabled={pending}>
        <SelectTrigger aria-label={t("cdkPricingMode")}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="FIXED">{t("cdkPricingModeFixed")}</SelectItem>
          <SelectItem value="QUOTE_FIXED">{t("cdkPricingModeQuoteFixed")}</SelectItem>
          <SelectItem value="QUOTE_PERCENT">{t("cdkPricingModeQuotePercent")}</SelectItem>
        </SelectContent>
      </Select>
    </div>
    {mode === "FIXED" ? <label>{t("cdkFixedPrice")}<input name="salePrice" type="number" min="0" max="1000000" step="0.01" defaultValue={formatDecimal(item.fixedPrice)} required /></label>
      : <label>{mode === "QUOTE_FIXED" ? t("cdkFixedMarkup") : t("cdkPercentMarkup")}<input name="markupValue" type="number" min="0" max={mode === "QUOTE_FIXED" ? "1000000" : "1000"} step="0.01" defaultValue={item.markupValue} required /></label>}
    <div className="admin-cdk-pricing-actions">
      <label className="admin-cdk-toggle"><input name="enabled" type="checkbox" defaultChecked={item.configuredEnabled} />{t("cdkSalesEnabled")}</label>
      <Button size="sm" variant="outline" disabled={pending}>{t("save")}</Button>
    </div>
    <dl className="admin-cdk-pricing-summary">
      <div><dt>{t("cdkListedSalePrice")}</dt><dd>{money(listed)}</dd></div>
      <div><dt>{t("cdkLowestQuote")}</dt><dd>{item.quoteBaseUsd === null ? t("cdkQuoteUnavailable") : `$${formatDecimal(item.quoteBaseUsd)} · ${item.quoteCountry ?? "—"} / ${item.quoteCurrency ?? "—"}`}</dd></div>
      <div><dt>{t("status")}</dt><dd><span className={`status-pill ${item.pricingStatus === "READY" ? "is-active" : ""}`}>{t(item.pricingStatus === "READY" ? "cdkPricingReady" : "cdkPricingWaitingQuote")}</span></dd></div>
      <div><dt>{t("cdkQuoteObservedAt")}</dt><dd>{item.quoteObservedAt ? new Date(item.quoteObservedAt).toLocaleString(locale) : "—"}</dd></div>
      <div><dt>{t("cdkFxRateDate")}</dt><dd>{item.fxRateDate ?? "—"}</dd></div>
    </dl>
  </form>;
}

function usageLabel(item: AdminGptCdkInventory, t: (key: string, options?: Record<string, string>) => string) {
  if (item.used || item.inventoryStatus === "CONSUMED") return t("cdkUsed");
  if (item.redemptionStatus) return t(`gptOrderStatus.${item.redemptionStatus}`, { defaultValue: item.redemptionStatus });
  return t("cdkUnused");
}

export function AdminGptCdkPanel({ token }: { token: string }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "en" ? "en-US" : "zh-CN";
  const client = useQueryClient();

  const inventory = useQuery({
    queryKey: ["admin-gpt-cdks"],
    queryFn: () => getAdminGptCdks(token),
    retry: false,
  });
  const quoteRefresh = useQuery({
    queryKey: ["admin-gpt-quote-refresh"],
    queryFn: () => getAdminGptQuoteRefresh(token),
    retry: false,
  });
  const pricing = useMutation({
    mutationFn: (input: PricingInput) =>
      updateAdminGptCdkPricing(token, input, crypto.randomUUID()),
    onSuccess: async () => client.invalidateQueries({ queryKey: ["admin-gpt-cdks"] }),
  });

  return <div className="admin-panel-stack" data-testid="admin-panel-cdks">
    <div className="admin-panel-heading">
      <div><span className="admin-kicker">GPT CDK</span><h2>{t("adminGptCdks")}</h2><p>{t("adminGptCdksDesc")}</p></div>
    </div>

    {quoteRefresh.isLoading && <p className="admin-state loading-skeleton loading-skeleton-block" aria-label={t("loading")}>{t("loading")}</p>}
    {quoteRefresh.isError && <p className="admin-state is-error" role="alert">{quoteRefresh.error instanceof Error ? quoteRefresh.error.message : t("adminLoadFailed")}</p>}
    {quoteRefresh.data && <QuoteRefreshForm key={`${quoteRefresh.data.data.configured}:${quoteRefresh.data.data.enabled}:${quoteRefresh.data.data.intervalMinutes}:${quoteRefresh.data.data.status}:${quoteRefresh.data.data.nextRefreshAt}`} token={token} settings={quoteRefresh.data.data} />}

    <section className="admin-surface">
      <div className="admin-section-heading"><div><span className="admin-kicker">PRICING</span><h3>{t("cdkPricing")}</h3><p>{t("cdkPricingHint")}</p></div><KeyRound /></div>
      {inventory.isLoading && <p className="admin-state loading-skeleton loading-skeleton-table" aria-label={t("loading")}>{t("loading")}</p>}
      {inventory.isError && <p className="admin-state is-error" role="alert">{inventory.error instanceof Error ? inventory.error.message : t("adminLoadFailed")}</p>}
      <div className="admin-cdk-pricing-list">{inventory.data?.data.pricing.map((item) => <PricingForm key={`${item.plan}:${item.version}`} item={item} pending={pricing.isPending} save={(input) => pricing.mutate(input)} />)}</div>
      {pricing.isError && <p className="admin-alert is-error" role="alert">{pricing.error instanceof Error ? pricing.error.message : t("updateFailed")}</p>}
    </section>

    <section className="admin-surface">
      <div className="admin-section-heading"><div><span className="admin-kicker">CUSTOMER CDK</span><h3>{t("cdkInventory")}</h3><p>{t("cdkInventoryHint")}</p></div><span>{inventory.data?.data.inventory.length ?? 0}</span></div>
      {inventory.data?.data.inventory.length === 0 && <p className="admin-state">{t("noCdks")}</p>}
      {inventory.data && inventory.data.data.inventory.length > 0 && <div className="admin-table-wrap"><table className="admin-table">
        <thead><tr>
          <th>{t("cdkPrefix")}</th>
          <th>{t("gptPlanLabel")}</th>
          <th>{t("owner")}</th>
          <th>{t("cdkListedSalePrice")}</th>
          <th>{t("cdkWalletSpent")}</th>
          <th>{t("cdkUsage")}</th>
          <th>{t("cdkRedeemProgressCol")}</th>
          <th>{t("cdkRedeemQuoted")}</th>
          <th>{t("updatedAt")}</th>
        </tr></thead>
        <tbody>{inventory.data.data.inventory.map((item) => <tr key={item.id}>
          <td><code>{item.codePrefix}</code>{item.publicId && item.redemptionStatus && <small><a href={`/admin?panel=gptOrders&source=cdk&q=${encodeURIComponent(item.publicId)}`}>{t("details")}</a></small>}</td>
          <td>{t(`gptPlan.${item.plan}`, { defaultValue: item.plan })}{item.forceNewCard ? ` · ${t("gptCdkForceNewCardBadge")}` : ""}</td>
          <td>{item.ownerEmail ?? item.ownerUserId ?? "—"}</td>
          <td>{money(item.salePrice)}</td>
          <td>{money(item.walletCharged)}</td>
          <td><span className={`status-pill ${item.used ? "is-active" : ""}`}>{usageLabel(item, t)}</span></td>
          <td>{item.redemptionStage ? t(`gptOrderStage.${item.redemptionStage.split(":")[0]}`, { defaultValue: item.redemptionStage }) : item.redemptionStatus ? t(`gptOrderStatus.${item.redemptionStatus}`, { defaultValue: item.redemptionStatus }) : "—"}</td>
          <td>{quoted(item.quotedAmountMinor, item.currency)}{item.redeemedAccount ? ` · ${item.redeemedAccount}` : ""}</td>
          <td>{new Date(item.updatedAt).toLocaleString(locale)}</td>
        </tr>)}</tbody>
      </table></div>}
    </section>
  </div>;
}
