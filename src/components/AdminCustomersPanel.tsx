import { formatDecimal } from "../decimal";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, ClipboardList, CreditCard, Gift, ShieldCheck, Users, WalletCards } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { formatRateBps } from "./PaymentPerformance";
import {
  ApiError,
  adjustWallet,
  deleteAdminCard,
  getAdminAuditLogs,
  getAdminCardTransactions,
  getAdminCustomerCardSpending,
  getAdminCustomerCardSensitive,
  getAdminDeposits,
  getAdminFinancialEvents,
  getAdminPricing,
  getAdminUserDetail,
  getAdminUsers,
  resetAdminCustomerPassword,
  unfreezeAdminCard,
  updateAdminCustomerProfile,
  updateAdminUser,
  type AdminUserDetail,
  type AdminUserQuery,
  type SensitiveCard,
} from "../api";
import { adminCustomerReturnPath, type AdminCustomerView } from "../adminCustomerReturnPath";

function AdminState({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <div className={`admin-state ${error ? "is-error" : ""}`} role={error ? "alert" : undefined}>{children}</div>;
}

function PanelHeading({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return <div className="admin-panel-heading">
    <div><span className="admin-kicker">{eyebrow}</span><h2>{title}</h2><p>{description}</p></div>
    {actions && <div className="admin-heading-actions">{actions}</div>}
  </div>;
}

function adminAccountLabel(email: string | null, userId?: number, telegramUsername?: string | null) {
  const username = telegramUsername?.replace(/^@/, "");
  return email ?? (username ? `@${username}` : userId === undefined ? "—" : `#${userId}`);
}

function displayDate(value: string | null, locale: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
}


function CustomerDetailSection({ title, count, icon: Icon, empty, testId, children }: { title: string; count: number; icon: typeof Users; empty: string; testId: string; children: ReactNode }) {
  return <section className="admin-surface admin-customer-detail-section" id={testId} data-testid={testId}>
    <div className="admin-section-heading"><div><h3><Icon />{title}</h3></div><span>{count}</span></div>
    {count === 0 ? <AdminState>{empty}</AdminState> : <div className="admin-customer-detail-list">{children}</div>}
  </section>;
}

type CustomerRecordTab = "audit" | "deposits" | "spending" | "financial";

function CustomerRecordPager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (page: number) => void }) {
  const { t } = useTranslation();
  return <div className="admin-pagination"><span>{t("totalItems", { count: total })}</span><div>
    <Button size="xs" variant="outline" onClick={() => onPage(page - 1)} disabled={page <= 1}>{t("previousPage")}</Button>
    <span>{page} / {Math.max(1, Math.ceil(total / pageSize))}</span>
    <Button size="xs" variant="outline" onClick={() => onPage(page + 1)} disabled={page * pageSize >= total}>{t("nextPage")}</Button>
  </div></div>;
}

function CustomerRecords({ userId, locale, token, initialTab = "financial" }: { userId: number; locale: string; token: string; initialTab?: CustomerRecordTab }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<CustomerRecordTab>(initialTab);
  const [auditFilter, setAuditFilter] = useState({ page: 1, q: "", action: "", outcome: "" });
  const [depositFilter, setDepositFilter] = useState({ page: 1, q: "", network: "", status: "" });
  const [spendingFilter, setSpendingFilter] = useState({ page: 1, q: "", status: "", cardStatus: "", from: "", to: "" });
  const [financialFilter, setFinancialFilter] = useState({ page: 1, q: "", source: "", status: "", type: "" });
  const audit = useQuery({
    queryKey: ["admin-customer-audit", userId, auditFilter],
    queryFn: () => getAdminAuditLogs(token, { ...auditFilter, pageSize: 25, user: userId }),
    enabled: tab === "audit",
  });
  const spending = useQuery({
    queryKey: ["admin-customer-spending", userId, spendingFilter],
    queryFn: () => getAdminCustomerCardSpending(token, userId, {
      ...spendingFilter, pageSize: 25,
      from: spendingFilter.from ? `${spendingFilter.from}T00:00:00Z` : undefined,
      to: spendingFilter.to ? `${spendingFilter.to}T23:59:59Z` : undefined,
    }),
    enabled: tab === "spending",
  });
  const deposits = useQuery({
    queryKey: ["admin-customer-deposits", userId, depositFilter],
    queryFn: () => getAdminDeposits(token, { ...depositFilter, pageSize: 25, user: userId }),
    enabled: tab === "deposits",
  });
  const financial = useQuery({
    queryKey: ["admin-customer-financial", userId, financialFilter],
    queryFn: () => getAdminFinancialEvents(token, { ...financialFilter, pageSize: 25, user: userId }),
    enabled: tab === "financial",
  });
  const query = tab === "audit" ? audit : tab === "deposits" ? deposits : tab === "spending" ? spending : financial;
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const value = (name: string) => String(data.get(name) ?? "").trim();
    if (tab === "audit") setAuditFilter({ page: 1, q: value("q"), action: value("action"), outcome: value("outcome") });
    else if (tab === "deposits") setDepositFilter({ page: 1, q: value("q"), network: value("network"), status: value("status") });
    else if (tab === "spending") setSpendingFilter({ page: 1, q: value("q"), status: value("status"), cardStatus: value("cardStatus"), from: value("from"), to: value("to") });
    else setFinancialFilter({ page: 1, q: value("q"), source: value("source"), status: value("status"), type: value("type") });
  };
  const successStatus = (status: string) => ["success", "COMPLETE", "SUCCEEDED", "confirmed"].includes(status);
  return <section className="admin-surface admin-customer-records" id="admin-customer-records" data-testid="admin-customer-records">
    <div className="admin-section-heading"><div><h3><ClipboardList />{t("customerRecords")}</h3><p>{t("customerRecordsHint")}</p></div></div>
    <nav className="admin-customer-record-tabs" aria-label={t("customerRecords")}>
      {(["financial", "deposits", "spending", "audit"] as CustomerRecordTab[]).map((item) => <button type="button" key={item} aria-current={tab === item ? "page" : undefined} onClick={() => setTab(item)}>{t(`customerRecordTab.${item}`)}</button>)}
    </nav>
    <form className="admin-customer-record-filters" key={tab} onSubmit={submit}>
      <label><span>{t("search")}</span><input name="q" defaultValue={tab === "audit" ? auditFilter.q : tab === "deposits" ? depositFilter.q : tab === "spending" ? spendingFilter.q : financialFilter.q} placeholder={t("customerRecordSearch")} /></label>
      {tab === "audit" && <><label><span>{t("auditAction")}</span><input name="action" defaultValue={auditFilter.action} placeholder="adjust_wallet" /></label><label><span>{t("auditOutcome")}</span><select name="outcome" defaultValue={auditFilter.outcome}><option value="">{t("allOptions")}</option><option value="success">success</option><option value="failure">failure</option><option value="blocked">blocked</option></select></label></>}
      {tab === "deposits" && <><label><span>{t("depositNetwork")}</span><select name="network" defaultValue={depositFilter.network}><option value="">{t("allNetworks")}</option>{["TRON", "BSC", "SOL", "ETH", "XLAYER"].map((value) => <option key={value}>{value}</option>)}</select></label><label><span>{t("status")}</span><select name="status" defaultValue={depositFilter.status}><option value="">{t("allStatuses")}</option>{["pending", "confirmed", "expired", "failed", "cancelled"].map((value) => <option key={value} value={value}>{t(`depositStatus.${value}`)}</option>)}</select></label></>}
      {tab === "spending" && <><label><span>{t("status")}</span><select name="status" defaultValue={spendingFilter.status}><option value="">{t("allOptions")}</option>{["PENDING", "SETTLED", "DECLINED", "REFUNDED", "PARTIALLY_REFUNDED", "REVERSED"].map((value) => <option key={value}>{value}</option>)}</select></label><label><span>{t("cardStatus")}</span><select name="cardStatus" defaultValue={spendingFilter.cardStatus}><option value="">{t("allOptions")}</option>{["ACTIVE", "FROZEN", "DELETED"].map((value) => <option key={value}>{value}</option>)}</select></label><label><span>{t("startDate")}</span><input name="from" type="date" defaultValue={spendingFilter.from} /></label><label><span>{t("endDate")}</span><input name="to" type="date" defaultValue={spendingFilter.to} /></label></>}
      {tab === "financial" && <><label><span>{t("source")}</span><input name="source" defaultValue={financialFilter.source} placeholder="wallet" /></label><label><span>{t("status")}</span><input name="status" defaultValue={financialFilter.status} placeholder="COMPLETE" /></label><label><span>{t("type")}</span><input name="type" defaultValue={financialFilter.type} placeholder="admin_adjust" /></label></>}
      <Button type="submit" size="sm" variant="outline">{t("filter")}</Button>
    </form>
    {query.isLoading && <AdminState><span className="loading-skeleton loading-skeleton-table" aria-label={t("loading")}>{t("loading")}</span></AdminState>}
    {query.isError && <AdminState error>{t("adminLoadFailed")}</AdminState>}
    {tab === "financial" && financial.data && <>
      {financial.data.data.list.length === 0 ? <AdminState>{t("noFinancialEvents")}</AdminState> : <div className="admin-table-wrap"><table className="admin-table" data-testid="admin-customer-financial-table"><thead><tr><th>{t("createdTime")}</th><th>{t("source")}</th><th>{t("type")}</th><th>{t("status")}</th><th>{t("amount")}</th><th>{t("balanceChange")}</th><th>{t("reference")}</th><th>{t("auditDetail")}</th></tr></thead><tbody>{financial.data.data.list.map((entry) => <tr key={`${entry.source}:${entry.id}`}><td>{displayDate(entry.createdAt, locale)}</td><td><code>{entry.source}</code></td><td><strong>{entry.type}</strong></td><td><span className={`status-pill ${successStatus(entry.status) ? "is-active" : ""}`}>{entry.status}</span></td><td className={Number(entry.amount) >= 0 ? "positive" : "negative"}>{entry.amount === null ? "—" : `$${formatDecimal(entry.amount)}`}</td><td>{entry.balanceBefore === null || entry.balanceAfter === null ? "—" : `${formatDecimal(entry.balanceBefore)} → ${formatDecimal(entry.balanceAfter)}`}</td><td><code>{entry.referenceId ?? "—"}</code></td><td><details className="admin-json"><summary>{t("viewSnapshot")}</summary><code>{JSON.stringify(entry.detail)}</code></details></td></tr>)}</tbody></table></div>}
      <CustomerRecordPager page={financial.data.data.page} pageSize={financial.data.data.pageSize} total={financial.data.data.total} onPage={(page) => setFinancialFilter((current) => ({ ...current, page }))} />
    </>}
    {tab === "deposits" && deposits.data && <>
      {deposits.data.data.list.length === 0 ? <AdminState>{t("noCustomerDeposits")}</AdminState> : <div className="admin-table-wrap"><table className="admin-table" data-testid="admin-customer-deposit-table"><thead><tr><th>{t("createdTime")}</th><th>{t("orderNumber")}</th><th>{t("depositNetwork")}</th><th>{t("requestedAndExpected")}</th><th>{t("receivedAndCredited")}</th><th>{t("status")}</th><th>{t("depositDetailedLog")}</th></tr></thead><tbody>{deposits.data.data.list.map((entry) => <tr key={entry.gatewayRef}><td>{displayDate(entry.createdAt, locale)}</td><td><code>{entry.gatewayRef}</code>{entry.transactionHashMasked && <small>{entry.transactionHashMasked}</small>}</td><td><strong>{entry.network}</strong><small>{entry.currency}</small></td><td><strong>{t("requestedAmount")}: {formatDecimal(entry.requestedAmount ?? "—")}</strong><small>{t("expectedPaymentAmount")}: {formatDecimal(entry.expectedAmount ?? "—")}</small></td><td><strong>{t("receivedAmount")}: {formatDecimal(entry.actualAmount ?? "—")}</strong><small>{t("creditedAmount")}: {formatDecimal(entry.creditedAmount ?? "—")}</small></td><td><span className={`status-pill ${entry.status === "confirmed" ? "is-active" : ""}`}>{t(`depositStatus.${entry.status}`)}</span>{entry.confirmedAt && <small>{displayDate(entry.confirmedAt, locale)}</small>}</td><td><details className="admin-customer-deposit-log"><summary>{t("viewDepositLog")}</summary><span>{displayDate(entry.createdAt, locale)} · {t("depositLogCreated")}</span><span>{displayDate(entry.expiredAt, locale)} · {t("depositLogExpires")}</span>{entry.reservedUntil && <span>{displayDate(entry.reservedUntil, locale)} · {t("depositLogReviewUntil")}</span>}{entry.confirmedAt && <span>{displayDate(entry.confirmedAt, locale)} · {t("depositLogConfirmed", { amount: formatDecimal(entry.creditedAmount ?? "—") })}</span>}<span>{t("depositLogCurrentStatus")}: {t(`depositStatus.${entry.status}`)}</span></details></td></tr>)}</tbody></table></div>}
      <CustomerRecordPager page={deposits.data.data.page} pageSize={deposits.data.data.pageSize} total={deposits.data.data.total} onPage={(page) => setDepositFilter((current) => ({ ...current, page }))} />
    </>}
    {tab === "spending" && spending.data && <>
      {spending.data.data.list.length === 0 ? <AdminState>{t("noCardTransactions")}</AdminState> : <div className="admin-table-wrap"><table className="admin-table" data-testid="admin-customer-spending-table"><thead><tr><th>{t("createdTime")}</th><th>{t("cardNumber")}</th><th>{t("merchant")}</th><th>{t("status")}</th><th>{t("authorizedAmount")}</th><th>{t("settledAmount")}</th><th>{t("location")}</th><th>{t("reference")}</th></tr></thead><tbody>{spending.data.data.list.map((entry) => <tr key={`${entry.providerId}:${entry.cardId}:${entry.authId}`}><td>{displayDate(entry.occurredAt, locale)}</td><td><strong>{entry.cardNumberMasked}</strong><small>#{entry.cardId} · {entry.cardStatus}</small></td><td><strong>{entry.merchantName || entry.description || t("unknownMerchant")}</strong><details className="admin-customer-lifecycle"><summary>{t("transactionLifecycle")} · {entry.events.length}</summary>{entry.events.map((event) => <span key={event.id}>{displayDate(event.authTime, locale)} · {event.type}/{event.status} · {formatDecimal(event.type === "Authorization" ? event.authAmount : event.settleAmount)} {event.type === "Authorization" ? event.authCurrency : event.settleCurrency}</span>)}</details></td><td><span className={`status-pill ${entry.status === "SETTLED" ? "is-active" : ""}`}>{entry.status}</span>{entry.failedReason && <small className="negative">{entry.failedReason}</small>}</td><td>{formatDecimal(entry.authorizedAmount)} {entry.authCurrency}</td><td>{formatDecimal(entry.settledAmount)} {entry.settleCurrency}</td><td>{[entry.merchantLocation, entry.merchantRegion, entry.merchantCountry].filter(Boolean).join(" · ") || "—"}</td><td><code>{entry.authId}</code></td></tr>)}</tbody></table></div>}
      <CustomerRecordPager page={spending.data.data.page} pageSize={spending.data.data.pageSize} total={spending.data.data.total} onPage={(page) => setSpendingFilter((current) => ({ ...current, page }))} />
    </>}
    {tab === "audit" && audit.data && <>
      {audit.data.data.list.length === 0 ? <AdminState>{t("noAuditLogs")}</AdminState> : <div className="admin-table-wrap"><table className="admin-table" data-testid="admin-customer-audit-table"><thead><tr><th>{t("createdTime")}</th><th>{t("administrator")}</th><th>{t("auditAction")}</th><th>{t("auditOutcome")}</th><th>{t("auditSource")}</th><th>{t("auditTarget")}</th><th>{t("auditDetail")}</th></tr></thead><tbody>{audit.data.data.list.map((entry) => <tr key={entry.id}><td>{displayDate(entry.createdAt, locale)}</td><td>{adminAccountLabel(entry.actorEmail, entry.actorUserId ?? undefined)}<small>{entry.actorType}</small></td><td><code>{entry.action}</code></td><td><span className={`status-pill ${entry.outcome === "success" ? "is-active" : ""}`}>{entry.outcome}</span></td><td>{entry.sourceIp ?? "—"}<small>{entry.requestId.slice(0, 8)}</small></td><td>{entry.targetType ?? "—"}<small>{entry.targetId ?? "—"}</small></td><td><details className="admin-json"><summary>{t("viewSnapshot")}</summary><code>{JSON.stringify({ ...entry.detail, userAgent: entry.userAgent })}</code></details></td></tr>)}</tbody></table></div>}
      <CustomerRecordPager page={audit.data.data.page} pageSize={audit.data.data.pageSize} total={audit.data.data.total} onPage={(page) => setAuditFilter((current) => ({ ...current, page }))} />
    </>}
  </section>;
}

function CustomerDetail({ detail, initialCardId, locale, onSelectCustomer, onView, returnPanel, token, view }: { detail: AdminUserDetail; initialCardId: number | null; locale: string; onSelectCustomer: (id: number) => void; onView: (view: AdminCustomerView) => void; returnPanel: string; token: string; view: AdminCustomerView }) {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const { profile } = detail;
  const [expandedCardId, setExpandedCardId] = useState<number | null>(initialCardId);
  const [riskMessage, setRiskMessage] = useState("");
  const [managementMessage, setManagementMessage] = useState("");
  const [commandKeys, setCommandKeys] = useState(() => ({
    setInviter: crypto.randomUUID(), setInviteCode: crypto.randomUUID(), unbindTelegram: crypto.randomUUID(),
  }));
  const [sensitive, setSensitive] = useState<{ cardId: number; data?: SensitiveCard; error?: unknown; loading: boolean } | null>(null);
  const sensitiveRequest = useRef(0);
  const clearSensitive = () => { sensitiveRequest.current += 1; setSensitive(null); };
  useEffect(() => () => { sensitiveRequest.current += 1; }, []);
  const cardTransactions = useQuery({
    queryKey: ["admin-card-transactions", profile.id, expandedCardId],
    queryFn: () => getAdminCardTransactions(token, profile.id, expandedCardId!),
    enabled: expandedCardId !== null,
  });
  const riskAction = useMutation({
    mutationFn: async (remark: string) => {
      if (detail.risk.owedCharges.count > 0) {
        await updateAdminUser(token, { action: "resolve_risk_charges", userId: profile.id, remark }, crypto.randomUUID());
      }
      for (const riskHoldReason of detail.risk.holdReasons) {
        await updateAdminUser(token, { action: "clear_risk_hold", userId: profile.id, remark, riskHoldReason });
      }
    },
    onSuccess: () => setRiskMessage(t("customerRiskResolved")),
    onError: (error) => setRiskMessage(error instanceof Error ? error.message : t("customerRiskResolutionFailed")),
    onSettled: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["admin-user-detail", profile.id] }),
        client.invalidateQueries({ queryKey: ["admin-users"] }),
      ]);
    },
  });
  const pricing = useQuery({ queryKey: ["admin-pricing"], queryFn: () => getAdminPricing(token), retry: false });
  const refreshCustomer = async () => Promise.all([
    client.invalidateQueries({ queryKey: ["admin-user-detail", profile.id] }),
    client.invalidateQueries({ queryKey: ["admin-users"] }),
    client.invalidateQueries({ queryKey: ["admin-customer-audit", profile.id] }),
    client.invalidateQueries({ queryKey: ["admin-customer-financial", profile.id] }),
  ]);
  const profileAction = useMutation({
    mutationFn: ({ input, key }: { input: { action: "setInviter" | "setInviteCode" | "unbindTelegram"; reason: string; inviterId?: number | null; inviteCode?: string }; key: string }) =>
      updateAdminCustomerProfile(token, profile.id, input, key),
    onSuccess: async (_, variables) => {
      setManagementMessage(t("customerUpdated"));
      setCommandKeys((current) => ({ ...current, [variables.input.action]: crypto.randomUUID() }));
      await refreshCustomer();
    },
    onError: (error) => setManagementMessage(error instanceof Error ? error.message : t("updateFailed")),
  });
  const legacyAction = useMutation({
    mutationFn: async (input: { action: "set_status" | "set_tier" | "adjust_wallet"; status?: string; tier?: string; amount?: string; remark?: string }) => {
      if (input.action === "adjust_wallet") return adjustWallet(token, profile.id, input.amount!, input.remark!);
      return updateAdminUser(token, { ...input, userId: profile.id });
    },
    onSuccess: async () => { setManagementMessage(t("customerUpdated")); await refreshCustomer(); },
    onError: (error) => setManagementMessage(error instanceof Error ? error.message : t("updateFailed")),
  });
  const passwordResetAction = useMutation({
    mutationFn: (input: { password: string; confirmPassword: string }) =>
      resetAdminCustomerPassword(token, profile.id, input.password, input.confirmPassword),
    onSuccess: async (result) => {
      setManagementMessage(result.msg || t("adminResetPasswordSaved"));
      await refreshCustomer();
    },
    onError: (error) => setManagementMessage(error instanceof Error ? error.message : t("updateFailed")),
  });
  const cardAction = useMutation({
    mutationFn: ({ cardId, action }: { cardId: number; action: "delete" | "unfreeze" }) => action === "delete"
      ? deleteAdminCard(token, cardId, crypto.randomUUID())
      : unfreezeAdminCard(token, cardId, crypto.randomUUID()),
    onSuccess: async () => { clearSensitive(); await refreshCustomer(); },
    onError: (error) => setManagementMessage(error instanceof Error ? error.message : t("updateFailed")),
  });
  async function revealSensitive(cardId: number) {
    const request = ++sensitiveRequest.current;
    setSensitive({ cardId, loading: true });
    try {
      const response = await getAdminCustomerCardSensitive(token, profile.id, cardId);
      if (request === sensitiveRequest.current) setSensitive({ cardId, data: response.data, loading: false });
    } catch (error) {
      if (request === sensitiveRequest.current) setSensitive({ cardId, error, loading: false });
    }
  }
  const membershipName = (i18n.language === "en" ? profile.membership.nameEn : profile.membership.nameZh) ?? profile.membership.code;
  const accountLabel = adminAccountLabel(profile.email, profile.id, profile.telegram.username);
  const paymentRisk = detail.risk.paymentPerformance;
  const paymentDeclineRate = formatRateBps(paymentRisk?.declineRateBps);
  const paymentSuccessRate = formatRateBps(paymentRisk?.successRateBps);
  const lockedBalance = profile.lockedBalance ?? "0.0000";
  const spendableBalance = profile.spendableBalance ?? profile.walletBalance;
  const successShare = paymentRisk && paymentRisk.attempts > 0 && paymentRisk.successRateBps !== null && paymentRisk.successRateBps !== undefined
    ? Math.min(100, Math.max(0, paymentRisk.successRateBps / 100))
    : null;
  const hasRiskAction = detail.risk.owedCharges.count > 0 || detail.risk.holdReasons.length > 0;
  const riskActionBlocked = profile.riskHold && detail.risk.holdReasons.length === 0;
  const profileRecentAuthRequired = profileAction.error instanceof ApiError && profileAction.error.errorCode === "RECENT_AUTH_REQUIRED";
  const passwordRecentAuthRequired = passwordResetAction.error instanceof ApiError && passwordResetAction.error.errorCode === "RECENT_AUTH_REQUIRED";
  const managementFailed = profileAction.isError || legacyAction.isError || cardAction.isError || passwordResetAction.isError;
  const requestRecentAuth = (cardId?: number | null) => {
    sessionStorage.setItem("recentAuthReturnPath", adminCustomerReturnPath(profile.id, cardId, returnPanel));
    window.location.assign("/login");
  };
  const managementAlert = managementMessage ? (
    <div className={`admin-alert ${managementFailed ? "is-error" : "is-success"}`} role={managementFailed ? "alert" : "status"}>
      <span>{managementMessage}</span>
      {(profileRecentAuthRequired || passwordRecentAuthRequired) && (
        <Button type="button" size="xs" variant="outline" onClick={() => requestRecentAuth(expandedCardId)}>{t("verifyAgain")}</Button>
      )}
    </div>
  ) : null;
  return <div className={`admin-customer-detail is-${view}-view`} data-testid="admin-customer-detail">
    {managementAlert}
    <nav className="admin-customer-view-tabs" aria-label={t("customerWorkspace")} data-testid="admin-customer-view-tabs">
      <button type="button" aria-current={view === "overview" ? "page" : undefined} onClick={() => onView("overview")}><Users /><span><strong>{t("customerOverview")}</strong><small>{t("customerOverviewHint")}</small></span></button>
      <button type="button" aria-current={view === "cards" ? "page" : undefined} data-testid="admin-customer-card-page" onClick={() => onView("cards")}><CreditCard /><span><strong>{t("customerCardWorkspace")}</strong><small>{t("customerCardWorkspaceHint", { count: detail.cards.total })}</small></span><b>{detail.cards.total}</b></button>
    </nav>
    <section className="admin-surface admin-customer-identity">
      <div className="admin-customer-detail-profile">
        <span className="admin-customer-detail-avatar"><Users /></span>
        <div><strong>{accountLabel}</strong><small>#{profile.id} · {profile.role} · {membershipName}</small></div>
        <span className={`status-pill ${profile.status === "active" ? "is-active" : "is-inactive"}`} data-status={profile.status}>{t(`accountStatus.${profile.status}`, { defaultValue: profile.status })}</span>
      </div>
      <dl className="admin-customer-detail-metrics">
        <div><dt>{t("inviteCode")}</dt><dd>{profile.inviteCode}</dd></div>
        <div><dt>{t("createdTime")}</dt><dd>{displayDate(profile.createdAt, locale)}</dd></div>
        <div><dt>{t("telegramAccount")}</dt><dd>{profile.telegram.bound ? (profile.telegram.username ? `@${profile.telegram.username.replace(/^@/, "")}` : t("telegramBoundReady")) : t("telegramNotBound")}</dd></div>
        <div><dt>{t("telegramVerifiedAt")}</dt><dd>{displayDate(profile.telegram.verifiedAt, locale)}</dd></div>
        <div><dt>{t("invitedBy")}</dt><dd>{profile.inviter ? <button type="button" className="admin-customer-inviter" data-testid="admin-customer-inviter" onClick={() => onSelectCustomer(profile.inviter!.id)} aria-label={t("viewCustomerDetails", { email: profile.inviter.email ?? `#${profile.inviter.id}` })}><span>{profile.inviter.email ?? `#${profile.inviter.id}`}</span><ArrowRight /></button> : "—"}</dd></div>
      </dl>
    </section>

    <section className="admin-surface admin-customer-funds" data-testid="admin-customer-funds">
      <div className="admin-section-heading"><div><h3><WalletCards />{t("customerFunds")}</h3><p>{t("customerFundsHint")}</p></div>
        <span className={`status-pill ${paymentRisk?.reserveActive ? "is-warning" : "is-active"}`}>{t(paymentRisk?.reserveActive ? "paymentReserveActive" : "paymentReserveInactive")}</span>
      </div>
      <dl className="admin-customer-fund-metrics">
        <div><dt>{t("totalBalance")}</dt><dd>${formatDecimal(profile.walletBalance)}</dd></div>
        <div className={Number(lockedBalance) > 0 ? "is-locked" : undefined}><dt>{t("riskLockedBalance")}</dt><dd>${formatDecimal(lockedBalance)}</dd></div>
        <div className="is-spendable"><dt>{t("spendableBalance")}</dt><dd>${formatDecimal(spendableBalance)}</dd></div>
        <div><dt>{t("promoBalance")}</dt><dd>${formatDecimal(profile.promoBalance)}</dd></div>
        <div><dt>{t("cumulativeRecharge")}</dt><dd>${formatDecimal(profile.cumulativeRecharge)}</dd></div>
      </dl>
      {paymentRisk?.enabled && <p className="payment-risk-boundary">{t("paymentRiskReleaseBoundary", { rate: formatRateBps(paymentRisk.releaseThresholdBps) })}</p>}
      {successShare !== null && <div className="payment-risk-meter" aria-hidden="true"><span className="payment-risk-meter-success" style={{ width: `${successShare}%` }} /></div>}
      <dl className="admin-customer-fund-rates">
        <div><dt>{t("paymentAttempts")}</dt><dd>{paymentRisk?.attempts ?? 0}</dd></div>
        <div className="is-success"><dt>{t("paymentSuccessRate")}</dt><dd>{paymentSuccessRate ?? t("paymentNoSample")}</dd></div>
        {paymentRisk?.enabled && <div className="is-decline"><dt>{t("paymentDeclineRate")}</dt><dd>{paymentDeclineRate ?? t("paymentNoSample")}</dd></div>}
        {paymentRisk?.enabled && <div><dt>{t("riskReserveRatio")}</dt><dd>{formatRateBps(paymentRisk.reserveBps)}</dd></div>}
      </dl>
      <nav className="admin-customer-fund-links" aria-label={t("customerFunds")}>
        <a href="#admin-customer-records">{t("customerRecords")}</a>
        <a href="#admin-customer-deposits">{t("customerDeposits")} · {detail.deposits.total}</a>
        <a href="#admin-customer-operations">{t("customerOperations")} · {detail.operations.total}</a>
        <button type="button" onClick={() => onView("cards")}>{t("customerCardWorkspace")} · {detail.cards.total}</button>
      </nav>
      <form className="admin-customer-fund-adjust" data-testid="admin-customer-wallet-adjust" onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        legacyAction.mutate({ action: "adjust_wallet", amount: String(data.get("amount")).trim(), remark: String(data.get("remark")).trim() });
      }}>
        <div><strong>{t("walletAdjustment")}</strong><small>{t("walletAdjustmentHint")}</small></div>
        <label>{t("adjustmentAmount")}<input name="amount" type="number" step="0.0001" required /></label>
        <label>{t("adjustmentRemark")}<input name="remark" minLength={3} maxLength={200} required /></label>
        <Button type="submit" disabled={legacyAction.isPending}>{t("confirmAdjustment")}</Button>
      </form>
    </section>

    <CustomerRecords key={`${profile.id}:${view}`} userId={profile.id} locale={locale} token={token} initialTab={view === "cards" ? "spending" : "financial"} />

    <section className="admin-surface" data-testid="admin-customer-management">
      <div className="admin-section-heading"><div><h3><Users />{t("manageCustomer")}</h3><p>{t("adminCustomerManagementHint")}</p></div></div>
      <div className="admin-customer-management-grid">
        <div className="admin-customer-management-group"><header><strong>{i18n.language === "en" ? "Invitation relationship" : "邀请关系"}</strong><small>{i18n.language === "en" ? "Manage inviter and invite code" : "管理直属邀请人与客户邀请码"}</small></header>
        <form className="admin-product-form" data-testid="admin-customer-inviter-form" onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const raw = String(data.get("inviterId")).trim();
          const inviterId = raw === "" ? null : Number(raw);
          if (inviterId !== null && (!Number.isSafeInteger(inviterId) || inviterId <= 0)) { setManagementMessage(t("invalidInviterId")); return; }
          profileAction.mutate({ key: commandKeys.setInviter, input: { action: "setInviter", inviterId, reason: String(data.get("reason")).trim() } });
        }}>
          <div><strong>{t("changeDirectInviter")}</strong><small>{t("futureReferralOnlyHint")}</small></div>
          <label>{t("inviterUserId")}<input name="inviterId" inputMode="numeric" defaultValue={profile.inviter?.id ?? ""} placeholder={t("leaveBlankToClear")} /></label>
          <label>{t("operationReason")}<input name="reason" minLength={10} maxLength={200} required /></label>
          <Button type="submit" disabled={profileAction.isPending}>{t("save")}</Button>
        </form>
        <form className="admin-product-form" data-testid="admin-customer-invite-code-form" onSubmit={(event) => {
          event.preventDefault(); const data = new FormData(event.currentTarget);
          profileAction.mutate({ key: commandKeys.setInviteCode, input: { action: "setInviteCode", inviteCode: String(data.get("inviteCode")).trim(), reason: String(data.get("reason")).trim() } });
        }}>
          <div><strong>{t("customInviteCode")}</strong><small>{t("customInviteCodeHint")}</small></div>
          <label>{t("inviteCode")}<input name="inviteCode" minLength={3} maxLength={32} pattern="[A-Za-z0-9-]{3,32}" defaultValue={profile.inviteCode} required /></label>
          <label>{t("operationReason")}<input name="reason" minLength={10} maxLength={200} required /></label>
          <Button type="submit" disabled={profileAction.isPending}>{t("save")}</Button>
        </form>
        </div>
        <div className="admin-customer-management-group is-security"><header><strong>{i18n.language === "en" ? "Account security" : "账号安全"}</strong><small>{i18n.language === "en" ? "Binding and login credentials" : "处理绑定关系与登录凭据"}</small></header>
        <form className="admin-product-form" data-testid="admin-customer-telegram-unbind-form" onSubmit={(event) => {
          event.preventDefault(); const data = new FormData(event.currentTarget);
          if (!window.confirm(t("adminTelegramUnbindConfirm"))) return;
          profileAction.mutate({ key: commandKeys.unbindTelegram, input: { action: "unbindTelegram", reason: String(data.get("reason")).trim() } });
        }}>
          <div><strong>{t("unbindTelegram")}</strong><small>{t(profile.emailLoginAvailable ? "adminTelegramUnbindHint" : "adminTelegramUnbindBlocked")}</small></div>
          <label>{t("operationReason")}<input name="reason" minLength={10} maxLength={200} required /></label>
          <Button type="submit" variant="destructive" disabled={profileAction.isPending || !profile.telegram.bound || !profile.emailLoginAvailable}>{t("unbindTelegram")}</Button>
        </form>
        {profile.role !== "admin" && <form className="admin-product-form" data-testid="admin-customer-password-reset-form" onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          const password = String(data.get("password"));
          const confirmPassword = String(data.get("confirmPassword"));
          if (password !== confirmPassword) { setManagementMessage(t("passwordConfirmationMismatch")); return; }
          if (password.length < 12 || password.length > 72 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) { setManagementMessage(t("passwordResetRequirements")); return; }
          if (!window.confirm(t("adminResetPasswordConfirm"))) return;
          passwordResetAction.mutate({ password, confirmPassword }, { onSuccess: () => form.reset() });
        }}>
          <div><strong>{t("adminResetPassword")}</strong><small>{t(profile.emailLoginAvailable ? "adminResetPasswordHint" : "adminResetPasswordTelegramHint")}</small></div>
          <label>{t("newPassword")}<input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={72} required /></label>
          <label>{t("confirmPassword")}<input name="confirmPassword" type="password" autoComplete="new-password" minLength={12} maxLength={72} required /></label>
          <Button type="submit" variant="destructive" disabled={passwordResetAction.isPending}>{t("adminResetPasswordAction")}</Button>
        </form>}
        </div>
        <div className="admin-customer-management-group"><header><strong>{i18n.language === "en" ? "Tier and status" : "等级与状态"}</strong><small>{i18n.language === "en" ? "Membership pricing and account availability" : "设置会员价格等级与账号可用状态"}</small></header>
        <div className="admin-customer-editor">
          <form onSubmit={(event) => { event.preventDefault(); legacyAction.mutate({ action: "set_tier", tier: String(new FormData(event.currentTarget).get("tier")) }); }}>
            <div><strong>{t("customerTier")}</strong><small>{t("tierChangeHint")}</small></div>
            <label>{t("customerTier")}<select name="tier" defaultValue={profile.membership.code} disabled={!pricing.data}>{pricing.data?.data.tiers.map((tier) => <option key={tier.code} value={tier.code}>{i18n.language === "en" ? tier.nameEn : tier.nameZh}</option>)}</select></label>
            <Button type="submit" variant="outline" disabled={legacyAction.isPending || !pricing.data}>{t("saveTier")}</Button>
          </form>
          <Button type="button" variant="outline" disabled={legacyAction.isPending} onClick={() => legacyAction.mutate({ action: "set_status", status: profile.status === "active" ? "suspended" : "active" })}>{t(profile.status === "active" ? "suspend" : "activate")}</Button>
        </div>
        </div>
      </div>
    </section>

    <section className="admin-surface admin-customer-risk" data-testid="admin-customer-risk">
      <div className="admin-section-heading"><div><h3><ShieldCheck />{t("customerRiskManagement")}</h3><p>{t("customerRiskManagementHint")}</p></div></div>
      <dl className="admin-customer-detail-metrics">
        <div><dt>{t("riskHoldStatus")}</dt><dd>{t(profile.riskHold ? "yes" : "no")}</dd></div>
        <div><dt>{t("paymentAttempts")}</dt><dd>{paymentRisk?.attempts ?? 0}</dd></div>
        <div><dt>{t("paymentSuccessRate")}</dt><dd>{paymentSuccessRate ?? t("paymentNoSample")}</dd></div>
        {paymentRisk?.enabled && <div><dt>{t("paymentDeclineRate")}</dt><dd>{paymentDeclineRate ?? t("paymentNoSample")}</dd></div>}
        {paymentRisk?.enabled && <div><dt>{t("riskReserveRatio")}</dt><dd>{formatRateBps(paymentRisk.reserveBps)}</dd></div>}
        {paymentRisk?.enabled && <div><dt>{t("paymentReserveStatus")}</dt><dd>{t(paymentRisk.reserveActive ? "paymentReserveActive" : "paymentReserveInactive")}</dd></div>}
        <div><dt>{t("unsettledRiskCharges")}</dt><dd>{detail.risk.owedCharges.count}</dd></div>
        <div><dt>{t("unsettledRiskAmount")}</dt><dd>${formatDecimal(detail.risk.owedCharges.total)}</dd></div>
      </dl>
      {detail.risk.holdReasons.length > 0 && <div className="admin-customer-detail-list">
        <article className="admin-customer-detail-item"><div><strong>{t("riskReasons")}</strong><small>{detail.risk.holdReasons.join(" · ")}</small></div></article>
      </div>}
      {detail.risk.owedCharges.byKind.length > 0 && <div className="admin-customer-detail-list" data-testid="admin-customer-risk-kinds">
        {detail.risk.owedCharges.byKind.map((item) => <article className="admin-customer-detail-item" key={item.kind}>
          <div><strong>{item.kind}</strong><small>{t("riskChargeKindCount", { count: item.count })}</small></div><span><strong>${formatDecimal(item.total)}</strong></span>
        </article>)}
      </div>}
      {riskActionBlocked && <p className="admin-alert is-error" role="alert">{t("riskReasonMissing")}</p>}
      {riskMessage && <p className={`admin-alert ${riskAction.isError ? "is-error" : "is-success"}`} role={riskAction.isError ? "alert" : "status"}>{riskMessage}</p>}
      {hasRiskAction && <form className="admin-product-form" onSubmit={(event) => {
        event.preventDefault();
        setRiskMessage("");
        riskAction.mutate(String(new FormData(event.currentTarget).get("remark")).trim());
      }}>
        <label>{t("riskResolutionNote")}<input name="remark" minLength={10} maxLength={200} placeholder={t("riskResolutionNotePlaceholder")} required /></label>
        <small>{t("riskResolutionDebitHint", { amount: formatDecimal(detail.risk.owedCharges.total) })}</small>
        <div className="admin-form-actions"><Button type="submit" disabled={riskAction.isPending || riskActionBlocked}>{riskAction.isPending ? t("processing") : t("resolveCustomerRisk")}</Button></div>
      </form>}
    </section>

    <div className="admin-customer-detail-grid">
      <CustomerDetailSection title={t("customerReferrals")} count={detail.directReferrals.total} icon={Users} empty={t("noCustomerReferrals")} testId="admin-customer-referrals">
        {detail.directReferrals.list.map((item) => <article className="admin-customer-detail-item" key={item.id}>
          <div><strong>{adminAccountLabel(item.email, item.id)}</strong><small>#{item.id} · {item.status} · {item.memberTier} · {displayDate(item.createdAt, locale)}</small><small>{t("openCardEarned")}: ${formatDecimal(item.openCardEarned)} · {t("rechargeEarned")}: ${formatDecimal(item.rechargeEarned)}</small></div>
          <span><small>{t("earnedFromReferral")}</small><strong>${formatDecimal(item.earned)}</strong></span>
        </article>)}
      </CustomerDetailSection>
      <CustomerDetailSection title={t("customerReferralRewards")} count={detail.earnings.total} icon={Gift} empty={t("noCustomerReferralRewards")} testId="admin-customer-referral-rewards">
        {detail.earnings.list.map((item) => <article className="admin-customer-detail-item" key={item.id}>
          <div><strong>{item.type}</strong><small>{item.refUserEmail ?? (item.refUserId ? `#${item.refUserId}` : "—")} · {displayDate(item.createdAt, locale)}</small>{item.remark && <small>{item.remark}</small>}</div>
          <strong className="positive">+${formatDecimal(item.amount)}</strong>
        </article>)}
      </CustomerDetailSection>
    </div>

    <CustomerDetailSection title={t("customerCards")} count={detail.cards.total} icon={CreditCard} empty={t("noCustomerCards")} testId="admin-customer-cards">
      {detail.cards.list.map((card) => {
        const expanded = expandedCardId === card.id;
        const revealed = sensitive?.cardId === card.id ? sensitive : null;
        const recentAuthRequired = revealed?.error instanceof ApiError && revealed.error.errorCode === "RECENT_AUTH_REQUIRED";
        const address = revealed?.data?.cardAddress;
        return <article className="admin-customer-card" key={card.id}>
          <div className="admin-customer-detail-item admin-customer-card-toggle">
            <button type="button" className="admin-customer-card-summary" data-testid={`admin-customer-card-${card.id}`} aria-expanded={expanded} aria-label={t(expanded ? "hideAdminCardTransactions" : "viewAdminCardTransactions", { card: card.cardNumberMasked })} onClick={() => { clearSensitive(); setExpandedCardId((current) => current === card.id ? null : card.id); }}>
              <strong>{card.cardNumberMasked}</strong><small>{card.issuer} · {card.network} · {card.productCode} · {displayDate(card.createdAt, locale)}</small><small>{card.firstName} {card.lastName} · {card.issuingArea}</small>
            </button>
            <div className="admin-customer-card-overview">
              <div className="admin-customer-card-inline-actions">
                <Button type="button" size="xs" variant="outline" data-testid={`admin-customer-card-sensitive-${card.id}`} disabled={revealed?.loading || card.status === "DELETED"} onClick={() => { if (revealed?.data) clearSensitive(); else { setExpandedCardId(card.id); void revealSensitive(card.id); } }}>{revealed?.data ? t("hideDetails") : t("showDetails")}</Button>
                {card.status === "FROZEN" && <Button type="button" size="xs" variant="outline" disabled={cardAction.isPending} onClick={() => cardAction.mutate({ cardId: card.id, action: "unfreeze" })}>{t("unfreeze")}</Button>}
                {card.status === "ACTIVE" && <Button type="button" size="xs" variant="destructive" disabled={cardAction.isPending} onClick={() => { if (window.confirm(t("confirmDeleteCard"))) cardAction.mutate({ cardId: card.id, action: "delete" }); }}>{t("deleteCard")}</Button>}
              </div>
              <span><span className={`status-pill ${card.status === "ACTIVE" ? "is-active" : ""}`}>{card.status}</span><strong>${formatDecimal(card.balance)}</strong><small className="admin-customer-card-action">{t(expanded ? "hideCardTransactions" : "viewCardTransactions")}</small></span>
            </div>
          </div>
          {expanded && <div className="admin-customer-card-transactions" data-testid={`admin-customer-card-transactions-${card.id}`}>
            {revealed?.loading && <AdminState><span className="loading-skeleton loading-skeleton-block" aria-label={t("loadingCardDetails")}>{t("loadingCardDetails")}</span></AdminState>}
            {Boolean(revealed?.error) && <div role="alert" className="card-sensitive-error"><span>{t(recentAuthRequired ? "cardRecentAuthRequired" : "cardDetailsLoadFailed")}</span><Button type="button" size="xs" variant="outline" onClick={() => {
              if (!recentAuthRequired) return void revealSensitive(card.id);
              requestRecentAuth(card.id);
            }}>{t(recentAuthRequired ? "verifyAgain" : "retry")}</Button></div>}
            {revealed?.data && <div className="developer-secret-reveal" data-testid={`admin-customer-card-sensitive-data-${card.id}`}>
              <div><span>{t("cardNumber")}</span><code>{revealed.data.cardNumber}</code></div>
              <div><span>{t("expiry")}</span><code>{revealed.data.expire}</code></div>
              <div><span>CVV</span><code>{revealed.data.cvv}</code></div>
              <div><span>{t("billingAddress")}</span><code>{address ? [address.addressLineOne, address.addressLineTwo, address.city, address.state, address.postCode, address.country].filter(Boolean).join(", ") : t("noBillingAddress")}</code></div>
            </div>}
            {cardTransactions.isLoading && <AdminState><span className="loading-skeleton loading-skeleton-table" aria-label={t("loading")}>{t("loading")}</span></AdminState>}
            {cardTransactions.isError && <div className="admin-customer-card-transactions-state" role="alert"><span>{t("adminCardTransactionsLoadFailed")}</span><Button type="button" size="xs" variant="outline" onClick={() => void cardTransactions.refetch()}>{t("retry")}</Button></div>}
            {cardTransactions.data && <>
              <dl className="admin-card-technical-grid">
                <div><dt>平台卡 ID</dt><dd>#{cardTransactions.data.data.card.id}</dd></div><div><dt>上游 Provider ID</dt><dd>#{cardTransactions.data.data.card.providerId}</dd></div>
                <div><dt>上游卡 ID</dt><dd>{cardTransactions.data.data.card.upstreamCardId || "—"}</dd></div><div><dt>VM Card ID</dt><dd>{cardTransactions.data.data.card.vmCardId || "—"}</dd></div>
                <div><dt>上游创建时间</dt><dd>{displayDate(cardTransactions.data.data.card.upstreamCreatedAt, locale)}</dd></div><div><dt>最近同步</dt><dd>{displayDate(cardTransactions.data.data.card.upstreamSyncedAt, locale)}</dd></div>
                <div><dt>本地更新时间</dt><dd>{displayDate(cardTransactions.data.data.card.updatedAt, locale)}</dd></div><div><dt>待处理操作</dt><dd>{cardTransactions.data.data.card.pendingOperationId || "—"}</dd></div>
              </dl>
              <div className="admin-customer-card-transactions-heading"><strong>财务汇总</strong><span>{cardTransactions.data.data.financialSummary.transactionCount} 笔有效授权</span></div>
              <dl className="admin-card-financial-grid">
                <div><dt>本金入卡</dt><dd>${formatDecimal(cardTransactions.data.data.financialSummary.totalPrincipalIn)}</dd></div><div><dt>钱包扣款</dt><dd>${formatDecimal(cardTransactions.data.data.financialSummary.walletDebited)}</dd></div>
                <div><dt>退回钱包</dt><dd>${formatDecimal(cardTransactions.data.data.financialSummary.walletRefunded)}</dd></div><div><dt>平台费用</dt><dd>${formatDecimal(cardTransactions.data.data.financialSummary.platformFees)}</dd></div>
                <div><dt>成功消费</dt><dd>${formatDecimal(cardTransactions.data.data.financialSummary.settledSpend)}</dd></div><div><dt>商户退款</dt><dd>${formatDecimal(cardTransactions.data.data.financialSummary.merchantRefunds)}</dd></div>
                <div><dt>冻结授权</dt><dd>${formatDecimal(cardTransactions.data.data.financialSummary.heldAmount)}</dd></div><div><dt>拒付率</dt><dd>{cardTransactions.data.data.financialSummary.declineRateBps === null ? "—" : `${formatDecimal((cardTransactions.data.data.financialSummary.declineRateBps / 100).toFixed(2))}%`}</dd></div>
              </dl>
              <div className="admin-customer-card-transactions-heading"><strong>OpenAI 支付表现</strong><span>{cardTransactions.data.data.openAiPerformance?.overall.attempts ?? 0} 笔</span></div>
              {cardTransactions.data.data.openAiPerformance ? <div className="admin-card-openai-performance">{cardTransactions.data.data.openAiPerformance.plans.map((plan) => <article key={plan.plan}><strong>{t(`gptPlan.${plan.plan}`, { defaultValue: plan.plan })}</strong><span>成功 {plan.successes} · 失败 {plan.declines}</span><small>{plan.latestSuccess ? `${plan.latestSuccess.priceMajor} ${plan.latestSuccess.currency} · ${displayDate(plan.latestSuccess.completedAt, locale)}` : "暂无成功记录"}</small></article>)}</div> : <AdminState>{t("paymentNoSample")}</AdminState>}
              <div className="admin-customer-card-transactions-heading"><strong>{t("cardTransactions")}</strong><span>{cardTransactions.data.data.grouped.total}</span></div>
              {cardTransactions.data.data.grouped.list.length === 0 && <AdminState>{t("noCardTransactions")}</AdminState>}
              {cardTransactions.data.data.grouped.list.map((item) => <details className="admin-card-transaction-life" key={`${item.providerId}-${item.authId}`}>
                <summary><div><strong>{item.merchantName ?? item.description ?? "未知商户"}</strong><small>{item.authId} · {item.status} · {displayDate(item.occurredAt, locale)}</small>{item.failedReason && <small className="is-error">{item.failedReason}</small>}</div><span><strong>{formatDecimal(item.settledAmount)} {item.settleCurrency}</strong><small>{item.events.length} 个原始事件</small></span></summary>
                <div className="admin-card-life-events">{item.events.map((event) => <article key={event.id}><strong>{event.type} · {event.status}</strong><small>{displayDate(event.authTime, locale)}</small><small>{formatDecimal(event.type === "Authorization" ? event.authAmount : event.settleAmount)} {event.type === "Authorization" ? event.authCurrency : event.settleCurrency} · {event.source || "webhook"}{event.channel ? ` / ${event.channel}` : ""}</small>{event.failedReason && <small className="is-error">{event.failedReason}</small>}</article>)}</div>
              </details>)}
              <details className="admin-card-json"><summary>费用策略与脱敏上游原始 JSON</summary><div><h4>费用策略</h4><pre>{JSON.stringify(cardTransactions.data.data.card.feePolicy, null, 2)}</pre><h4>上游原文（已脱敏）</h4><pre>{JSON.stringify(cardTransactions.data.data.card.upstreamPayload ?? {}, null, 2)}</pre></div></details>
            </>}
          </div>}
        </article>;
      })}
    </CustomerDetailSection>

    <div className="admin-customer-detail-grid">
      <CustomerDetailSection title={t("customerDeposits")} count={detail.deposits.total} icon={WalletCards} empty={t("noCustomerDeposits")} testId="admin-customer-deposits">
        {detail.deposits.list.map((deposit) => <article className="admin-customer-detail-item" key={deposit.gatewayRef}>
          <div><strong>{deposit.network} · {deposit.status}</strong><small>{t("requestedAmount")}: ${formatDecimal(deposit.requestedAmount ?? "—")} · {t("receivedAmount")}: ${formatDecimal(deposit.actualAmount ?? "—")}</small><small>{deposit.transactionHashMasked || "—"} · {displayDate(deposit.confirmedAt ?? deposit.createdAt, locale)}</small></div>
          <span><small>{t("creditedAmount")}</small><strong>${formatDecimal(deposit.creditedAmount ?? "—")}</strong></span>
        </article>)}
      </CustomerDetailSection>
      <CustomerDetailSection title={t("customerOperations")} count={detail.operations.total} icon={ClipboardList} empty={t("noCustomerOperations")} testId="admin-customer-operations">
        {detail.operations.list.map((operation) => <article className="admin-customer-detail-item" key={operation.id}>
          <div><strong>{operation.type} · {operation.status}</strong><small>{operation.cardId ? `${t("cardNumber")} #${operation.cardId} · ` : operation.openedCardIds.length > 0 ? `${t("cards")} #${operation.openedCardIds.join(", #")} · ` : ""}{displayDate(operation.completedAt ?? operation.createdAt, locale)}</small><small>{t("serviceFee")}: ${formatDecimal(operation.fee)} · {t("customerCharge")}: ${formatDecimal(operation.customerCharge)}</small></div>
          <strong>${formatDecimal(operation.amount)}</strong>
        </article>)}
      </CustomerDetailSection>
    </div>
  </div>;
}

const defaultCustomerQuery: AdminUserQuery = { page: 1, pageSize: 20, sort: "createdAt", direction: "desc" };

function optionalText(data: FormData, name: string) {
  return String(data.get(name) ?? "").trim() || undefined;
}

function optionalNumber(data: FormData, name: string) {
  const value = optionalText(data, name);
  return value === undefined ? undefined : Number(value);
}

function optionalBoolean(data: FormData, name: string) {
  const value = optionalText(data, name);
  return value === undefined ? undefined : value === "true";
}

export function AdminCustomersPanel({ token, customerId, cardId, customerView, returnPanel, onSelectCustomer }: {
  token: string;
  customerId: number | null;
  cardId: number | null;
  customerView: AdminCustomerView;
  returnPanel: string;
  onSelectCustomer: (id: number | null, view?: AdminCustomerView) => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "en" ? "en-US" : "zh-CN";
  const [query, setQuery] = useState<AdminUserQuery>(defaultCustomerQuery);
  const users = useQuery({
    queryKey: ["admin-users", query],
    queryFn: () => getAdminUsers(token, query),
    enabled: customerId === null,
    retry: false,
  });
  const detail = useQuery({
    queryKey: ["admin-user-detail", customerId],
    queryFn: () => getAdminUserDetail(token, customerId!),
    enabled: customerId !== null,
    retry: false,
  });
  const pricing = useQuery({
    queryKey: ["admin-pricing"],
    queryFn: () => getAdminPricing(token),
    enabled: customerId === null,
    retry: false,
  });

  if (customerId !== null) {
    return <div className="admin-panel-stack" data-testid="admin-panel-customers">
      <PanelHeading
        eyebrow="CUSTOMER PROFILE"
        title={detail.data ? adminAccountLabel(detail.data.data.profile.email, detail.data.data.profile.id, detail.data.data.profile.telegram.username) : t("customerDetails")}
        description={t("customerDetailsDesc")}
        actions={<Button size="sm" variant="outline" onClick={() => onSelectCustomer(null)}><ArrowLeft />{t("backToCustomers")}</Button>}
      />
      {detail.isLoading && <section className="admin-surface"><AdminState><span className="loading-skeleton loading-skeleton-block" aria-label={t("loadingCustomerDetails")}>{t("loadingCustomerDetails")}</span></AdminState></section>}
      {detail.isError && <section className="admin-surface"><AdminState error><span>{t("customerDetailsLoadFailed")} <Button size="xs" variant="outline" onClick={() => void detail.refetch()}>{t("retry")}</Button></span></AdminState></section>}
      {detail.data && <CustomerDetail key={detail.data.data.profile.id} detail={detail.data.data} initialCardId={cardId} locale={locale} onSelectCustomer={(id) => onSelectCustomer(id)} onView={(view) => onSelectCustomer(detail.data!.data.profile.id, view)} returnPanel={returnPanel} token={token} view={customerView} />}
    </div>;
  }

  return <div className="admin-panel-stack" data-testid="admin-panel-customers">
    <PanelHeading eyebrow="CUSTOMERS" title={t("adminCustomers")} description={t("adminCustomersDesc")} />
    <details className="admin-surface admin-customer-filters" data-testid="admin-customer-filters">
      <summary>{t("customerFilters")}</summary>
      <form key={JSON.stringify(query)} className="admin-filter-bar admin-customer-filter-form" onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        setQuery({
          page: 1,
          pageSize: 20,
          q: optionalText(data, "q"),
          status: optionalText(data, "status"),
          role: optionalText(data, "role"),
          tier: optionalText(data, "tier"),
          telegramBound: optionalBoolean(data, "telegramBound"),
          emailVerified: optionalBoolean(data, "emailVerified"),
          riskHold: optionalBoolean(data, "riskHold"),
          cardStatus: optionalText(data, "cardStatus"),
          hasActiveCard: optionalBoolean(data, "hasActiveCard"),
          rechargeMin: optionalText(data, "rechargeMin"),
          rechargeMax: optionalText(data, "rechargeMax"),
          walletMin: optionalText(data, "walletMin"),
          walletMax: optionalText(data, "walletMax"),
          referralsMin: optionalNumber(data, "referralsMin"),
          referralsMax: optionalNumber(data, "referralsMax"),
          cardsMin: optionalNumber(data, "cardsMin"),
          cardsMax: optionalNumber(data, "cardsMax"),
          createdFrom: optionalText(data, "createdFrom"),
          createdTo: optionalText(data, "createdTo"),
          sort: optionalText(data, "sort") as AdminUserQuery["sort"],
          direction: optionalText(data, "direction") as AdminUserQuery["direction"],
        });
      }}>
        <label><span>{t("search")}</span><input name="q" defaultValue={query.q} placeholder={t("searchCustomersExpanded")} /></label>
        <label><span>{t("status")}</span><select name="status" defaultValue={query.status}><option value="">{t("allStatuses")}</option><option value="pending_verification">{t("accountStatus.pending_verification")}</option><option value="active">{t("accountStatus.active")}</option><option value="suspended">{t("accountStatus.suspended")}</option><option value="banned">{t("accountStatus.banned")}</option></select></label>
        <label><span>{t("customerRole")}</span><select name="role" defaultValue={query.role}><option value="">{t("allCustomerRoles")}</option><option value="customer">customer</option><option value="agent">agent</option><option value="admin">admin</option></select></label>
        <label><span>{t("customerTier")}</span><select name="tier" defaultValue={query.tier}><option value="">{t("allCustomerTiers")}</option>{pricing.data?.data.tiers.map((tier) => <option key={tier.code} value={tier.code}>{i18n.language === "en" ? tier.nameEn : tier.nameZh}</option>)}</select></label>
        <label><span>{t("telegramAccount")}</span><select name="telegramBound" defaultValue={query.telegramBound?.toString()}><option value="">{t("allOptions")}</option><option value="true">{t("telegramBoundReady")}</option><option value="false">{t("telegramNotBound")}</option></select></label>
        <label><span>{t("emailVerifiedFilter")}</span><select name="emailVerified" defaultValue={query.emailVerified?.toString()}><option value="">{t("allOptions")}</option><option value="true">{t("yes")}</option><option value="false">{t("no")}</option></select></label>
        <label><span>{t("riskHoldStatus")}</span><select name="riskHold" defaultValue={query.riskHold?.toString()}><option value="">{t("allOptions")}</option><option value="true">{t("yes")}</option><option value="false">{t("no")}</option></select></label>
        <label><span>{t("cardStatusFilter")}</span><select name="cardStatus" defaultValue={query.cardStatus}><option value="">{t("allStatuses")}</option><option value="ACTIVE">ACTIVE</option><option value="FROZEN">FROZEN</option><option value="DELETED">DELETED</option></select></label>
        <label><span>{t("hasActiveCard")}</span><select name="hasActiveCard" defaultValue={query.hasActiveCard?.toString()}><option value="">{t("allOptions")}</option><option value="true">{t("yes")}</option><option value="false">{t("no")}</option></select></label>
        <label><span>{t("rechargeMin")}</span><input name="rechargeMin" type="number" min="0" step="0.000001" defaultValue={query.rechargeMin} /></label>
        <label><span>{t("rechargeMax")}</span><input name="rechargeMax" type="number" min="0" step="0.000001" defaultValue={query.rechargeMax} /></label>
        <label><span>{t("walletMin")}</span><input name="walletMin" type="number" min="0" step="0.000001" defaultValue={query.walletMin} /></label>
        <label><span>{t("walletMax")}</span><input name="walletMax" type="number" min="0" step="0.000001" defaultValue={query.walletMax} /></label>
        <label><span>{t("referralsMin")}</span><input name="referralsMin" type="number" min="0" step="1" defaultValue={query.referralsMin} /></label>
        <label><span>{t("referralsMax")}</span><input name="referralsMax" type="number" min="0" step="1" defaultValue={query.referralsMax} /></label>
        <label><span>{t("cardsMin")}</span><input name="cardsMin" type="number" min="0" step="1" defaultValue={query.cardsMin} /></label>
        <label><span>{t("cardsMax")}</span><input name="cardsMax" type="number" min="0" step="1" defaultValue={query.cardsMax} /></label>
        <label><span>{t("registeredFrom")}</span><input name="createdFrom" type="date" defaultValue={query.createdFrom} /></label>
        <label><span>{t("registeredTo")}</span><input name="createdTo" type="date" defaultValue={query.createdTo} /></label>
        <label><span>{t("sortBy")}</span><select name="sort" defaultValue={query.sort}><option value="createdAt">{t("createdTime")}</option><option value="cumulativeRecharge">{t("cumulativeRecharge")}</option><option value="walletBalance">{t("walletBalance")}</option><option value="referralCount">{t("customerReferrals")}</option><option value="cardCount">{t("customerCards")}</option></select></label>
        <label><span>{t("sortDirection")}</span><select name="direction" defaultValue={query.direction}><option value="desc">{t("descending")}</option><option value="asc">{t("ascending")}</option></select></label>
        <div className="admin-customer-filter-actions"><Button type="submit" size="sm">{t("applyFilters")}</Button><Button type="button" size="sm" variant="outline" onClick={() => setQuery(defaultCustomerQuery)}>{t("resetFilters")}</Button></div>
      </form>
    </details>
    <section className="admin-surface">
      {users.isLoading && <AdminState><span className="loading-skeleton loading-skeleton-table" aria-label={t("loading")}>{t("loading")}</span></AdminState>}
      {users.isError && <AdminState error>{t("adminLoadFailed")}</AdminState>}
      {users.data?.data.list.length === 0 && <AdminState>{t("noCustomers")}</AdminState>}
      <div className="admin-list">{users.data?.data.list.map((user) => <article className="admin-customer-row" key={user.id}>
        <div className="admin-list-row transaction-row">
          <div className="transaction-icon"><Users /></div>
          <button type="button" className="admin-customer-summary" onClick={() => onSelectCustomer(user.id)} aria-label={t("viewCustomerDetails", { email: adminAccountLabel(user.email, user.id, user.telegram.username) })}>
            <strong>{adminAccountLabel(user.email, user.id, user.telegram.username)}</strong>
            <small>{user.role} · {t(`accountStatus.${user.status}`, { defaultValue: user.status })} · {user.memberTier} · {user.cardCount} {t("cards")} ({user.activeCardCount} {t("active")}) · {user.referralCount} {t("customerReferrals")}</small>
            <small>{t("cumulativeRecharge")}: ${formatDecimal(user.cumulativeRecharge)} · {t("inviteCode")}: {user.inviteCode}</small>
            <small>{t("telegramAccount")}: {user.telegram.bound ? (user.telegram.username ? `@${user.telegram.username.replace(/^@/, "")}` : t("telegramBoundReady")) : t("telegramNotBound")}{user.riskHold ? ` · ${t("riskHoldStatus")}` : ""}</small>
          </button>
          <div className="admin-customer-row-aside">
            <div className="admin-customer-wallet">
              <span>{t("walletBalance")}</span>
              <strong>${formatDecimal(user.walletBalance)}</strong>
            </div>
            <div className="admin-card-actions"><Button size="xs" variant="outline" onClick={() => onSelectCustomer(user.id, "cards")}><CreditCard />{t("viewCustomerCards")}</Button><Button size="xs" variant="outline" onClick={() => onSelectCustomer(user.id)}>{t("viewDetails")}</Button></div>
          </div>
        </div>
      </article>)}</div>
      {users.data && <div className="admin-pagination"><span>{t("totalItems", { count: users.data.data.total })}</span><div><Button size="xs" variant="outline" onClick={() => setQuery((current) => ({ ...current, page: Math.max(1, (current.page ?? 1) - 1) }))} disabled={(query.page ?? 1) <= 1}>{t("previousPage")}</Button><span>{query.page ?? 1}</span><Button size="xs" variant="outline" onClick={() => setQuery((current) => ({ ...current, page: (current.page ?? 1) + 1 }))} disabled={(query.page ?? 1) * (query.pageSize ?? 20) >= users.data.data.total}>{t("nextPage")}</Button></div></div>}
    </section>
  </div>;
}
