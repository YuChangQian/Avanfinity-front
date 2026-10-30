import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Bot, Brain, Gift, RefreshCw, Send, ShieldCheck, Trash2, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  adminTelegramCommand,
  deleteAdminTelegramKnowledge,
  getAdminTelegram,
  getAdminTelegramAi,
  getAdminTelegramBindings,
  getAdminTelegramKnowledge,
  saveAdminTelegramKnowledge,
  updateAdminTelegramAi,
  type AdminTelegramCommand,
  type AdminTelegramGroup,
} from "../api";
import { Button } from "./ui/button";
import { StableSwap } from "./StableSwap";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { DataSkeleton } from "./PageShell";

type TelegramTab = "overview" | "groups" | "queue" | "publish" | "ai" | "bindings";

function TelegramGroupForm({ group, pending, save }: { group: AdminTelegramGroup; pending: boolean; save: (input: AdminTelegramCommand) => void }) {
  const { t } = useTranslation();
  const [reportMode, setReportMode] = useState(group.checkinReportMode ?? "off");
  const reportTime = group.checkinReportTime ?? "20:00";
  const reportInterval = group.checkinReportIntervalMinutes ?? 0;
  return <form className="admin-telegram-group" onSubmit={(event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const enabled = data.get("enabled") === "on";
    save({
      action: "group_update",
      chatId: group.chatId,
      enabled,
      lotteryEnabled: data.get("lotteryEnabled") === "on",
      joinVerificationEnabled: data.get("joinVerificationEnabled") === "on",
      memberVerificationEnabled: data.get("memberVerificationEnabled") === "on",
      verificationTtlSeconds: Number(data.get("verificationTtlSeconds")),
      checkinReportMode: enabled ? reportMode : "off",
      checkinReportTime: String(data.get("checkinReportTime") ?? reportTime),
      checkinReportIntervalMinutes: Number(data.get("checkinReportIntervalMinutes") ?? reportInterval),
    });
  }}>
    <div className="admin-telegram-group-heading">
      <div><strong>{group.title}</strong><small><code>{group.chatId}</code> · {group.status} · {t("updatedAt")} {new Date(group.updatedAt).toLocaleString()}</small></div>
      <span className={`status-pill ${group.enabled ? "is-active" : ""}`}>{group.enabled ? t("enabled") : t("disabled")}</span>
    </div>
    <div className="admin-runtime-flags" aria-label={t("telegramBotPermissions")}>
      <span className={group.botIsAdmin ? "is-on" : ""}>{t(group.botIsAdmin ? "telegramBotAdminReady" : "telegramBotAdminMissing")}</span>
      <span className={group.canInviteUsers ? "is-on" : ""}>{t("telegramInvitePermission")}</span>
      <span className={group.canDeleteMessages ? "is-on" : ""}>{t("telegramDeletePermission")}</span>
      <span className={group.canRestrictMembers ? "is-on" : ""}>{t("telegramRestrictPermission")}</span>
      {group.pendingJoinRequests > 0 && <span className="is-warning">{t("telegramPendingJoins", { count: group.pendingJoinRequests })}</span>}
      {group.failedJoinRequests > 0 && <span className="is-warning">{t("telegramFailedJoins", { count: group.failedJoinRequests })}</span>}
      {group.pendingMemberVerifications > 0 && <span className="is-warning">{t("telegramPendingMembers", { count: group.pendingMemberVerifications })}</span>}
    </div>
    <div className="admin-telegram-group-body">
      <div className="admin-telegram-group-block">
        <span className="admin-telegram-group-label">{t("telegramGroupSwitches")}</span>
        <div className="admin-telegram-group-toggles">
          <label className="admin-settings-toggle"><input name="enabled" type="checkbox" defaultChecked={group.enabled} /><span><strong>{t("telegramManageGroup")}</strong><small>{t("telegramManageGroupHint")}</small></span></label>
          <label className="admin-settings-toggle"><input name="lotteryEnabled" type="checkbox" defaultChecked={group.lotteryEnabled} /><span><strong>{t("telegramGroupLottery")}</strong><small>{t("telegramGroupLotteryHint")}</small></span></label>
          <label className="admin-settings-toggle"><input name="joinVerificationEnabled" type="checkbox" defaultChecked={group.joinVerificationEnabled} /><span><strong>{t("telegramJoinVerification")}</strong><small>{t("telegramJoinVerificationHint")}</small></span></label>
          <label className="admin-settings-toggle"><input name="memberVerificationEnabled" type="checkbox" defaultChecked={group.memberVerificationEnabled} disabled={!group.canRestrictMembers} /><span><strong>{t("telegramMemberVerification")}</strong><small>{t("telegramMemberVerificationHint")}</small></span></label>
        </div>
      </div>
      <div className="admin-telegram-group-block">
        <span className="admin-telegram-group-label">{t("telegramGroupVerification")}</span>
        <div className="admin-telegram-group-fields">
          <label>{t("telegramVerificationTtl")}<input name="verificationTtlSeconds" type="number" min="60" max="600" step="60" defaultValue={group.verificationTtlSeconds} required /><small>{t("telegramVerificationTtlHint")}</small></label>
        </div>
      </div>
      <div className="admin-telegram-group-block">
        <span className="admin-telegram-group-label">{t("telegramCheckinReportMode")}</span>
        <div className="admin-telegram-group-fields">
          <label>{t("telegramCheckinReportMode")}<Select value={reportMode} onValueChange={(value) => setReportMode(value as AdminTelegramGroup["checkinReportMode"])}><SelectTrigger aria-label={t("telegramCheckinReportMode")}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="off">{t("telegramCheckinReportOff")}</SelectItem><SelectItem value="immediate">{t("telegramCheckinReportImmediate")}</SelectItem><SelectItem value="scheduled">{t("telegramCheckinReportScheduled")}</SelectItem></SelectContent></Select><small>{t("telegramCheckinReportHint")}</small></label>
          <label>{t("telegramCheckinReportTime")}<input name="checkinReportTime" type="time" defaultValue={reportTime} disabled={reportMode !== "scheduled"} required /><small>{t("telegramCheckinReportTimezone")}</small></label>
          <label>{t("telegramCheckinReportInterval")}<input name="checkinReportIntervalMinutes" type="number" min="0" max="1440" step="15" defaultValue={reportInterval} disabled={reportMode !== "scheduled"} required /><small>{t("telegramCheckinReportIntervalHint")}</small></label>
          <div className="admin-telegram-report-status"><span>{t("telegramCheckinReportNext")}</span><strong>{group.checkinReportNextAt ? new Date(group.checkinReportNextAt).toLocaleString() : "—"}</strong><small>{t("telegramCheckinReportLast")}: {group.checkinReportLastSentAt ? new Date(group.checkinReportLastSentAt).toLocaleString() : "—"}</small></div>
        </div>
      </div>
    </div>
    <div className="admin-form-actions"><Button size="sm" variant="outline" disabled={pending}><StableSwap state={pending ? "busy" : "idle"} labels={{ idle: t("saveGroupSettings"), busy: t("processing") }} /></Button></div>
  </form>;
}

function MetricCard({ label, value, hint, icon: Icon }: { label: string; value: ReactNode; hint: string; icon: typeof Users }) {
  return <article><span><Icon />{label}</span><strong>{value}</strong><small>{hint}</small></article>;
}

export function AdminTelegramPanel({ token, onSelectCustomer }: { token: string; onSelectCustomer: (id: number) => void }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "en" ? "en-US" : "zh-CN";
  const en = i18n.language === "en";
  const client = useQueryClient();
  const [tab, setTab] = useState<TelegramTab>("overview");
  const [groupId, setGroupId] = useState("");
  const [checkinGroupId, setCheckinGroupId] = useState("");
  const [activityId, setActivityId] = useState("");
  const [notice, setNotice] = useState("");
  const [memberPassNotice, setMemberPassNotice] = useState<{ id: string; status: "queued" | "passed" | "error"; message?: string } | null>(null);
  const [bindingPage, setBindingPage] = useState(1);
  const [bindingQuery, setBindingQuery] = useState("");
  const telegram = useQuery({ queryKey: ["admin-telegram"], queryFn: () => getAdminTelegram(token), retry: false, refetchInterval: 3_000 });
  const bindings = useQuery({ queryKey: ["admin-telegram-bindings", bindingPage, bindingQuery], queryFn: () => getAdminTelegramBindings(token, bindingPage, 20, bindingQuery), retry: false, enabled: tab === "bindings" });
  const ai = useQuery({ queryKey: ["admin-telegram-ai"], queryFn: () => getAdminTelegramAi(token), retry: false, enabled: tab === "ai" });
  const knowledge = useQuery({ queryKey: ["admin-telegram-knowledge"], queryFn: () => getAdminTelegramKnowledge(token), retry: false, enabled: tab === "ai" });
  const command = useMutation({
    mutationFn: (input: AdminTelegramCommand) => adminTelegramCommand(token, input),
    onSuccess: async (result, input) => {
      const memberStatus = result.data.status === "passed" ? "passed" : "queued";
      if (input.action === "member_verification_pass") setMemberPassNotice({ id: input.challengeId, status: memberStatus });
      setNotice(t(input.action === "health" ? "telegramHealthComplete" : input.action === "group_update" ? "telegramGroupSaved" : input.action === "member_verification_pass" ? memberStatus === "passed" ? "telegramMemberPassed" : "telegramMemberPassQueued" : input.action === "publish_lottery" ? "telegramLotteryPublished" : input.action === "publish_checkin" ? "telegramCheckinPublished" : "telegramResultsPublished"));
      await client.invalidateQueries({ queryKey: ["admin-telegram"] });
    },
    onError: (error, input) => {
      const message = error instanceof Error ? error.message : t("updateFailed");
      if (input.action === "member_verification_pass") setMemberPassNotice({ id: input.challengeId, status: "error", message });
      setNotice(message);
    },
  });
  const saveAi = useMutation({
    mutationFn: (form: HTMLFormElement) => {
      const data = new FormData(form);
      return updateAdminTelegramAi(token, {
        enabled: data.get("enabled") === "on", groupEnabled: data.get("groupEnabled") === "on", privateEnabled: data.get("privateEnabled") === "on",
        model: String(data.get("model")) as "deepseek-v4-flash" | "deepseek-v4-pro",
        perUserPerMinute: Number(data.get("perUserPerMinute")), perGroupPerMinute: Number(data.get("perGroupPerMinute")), globalPerMinute: Number(data.get("globalPerMinute")), maxOutputTokens: Number(data.get("maxOutputTokens")),
        apiKey: String(data.get("apiKey") ?? "").trim() || undefined,
      });
    },
    onSuccess: async () => { setNotice(en ? "AI settings saved" : "AI 配置已保存"); await client.invalidateQueries({ queryKey: ["admin-telegram-ai"] }); },
    onError: (error) => setNotice(error instanceof Error ? error.message : t("updateFailed")),
  });
  const knowledgeAction = useMutation({
    mutationFn: async ({ action, id, form }: { action: "save" | "delete"; id?: number; form?: HTMLFormElement }) => {
      if (action === "delete") return deleteAdminTelegramKnowledge(token, id!);
      const data = new FormData(form!);
      return saveAdminTelegramKnowledge(token, { title: String(data.get("title")), content: String(data.get("content")), tags: String(data.get("tags")).split(/[,，]/).map((value) => value.trim()).filter(Boolean), language: String(data.get("language")) as "zh" | "en", audience: String(data.get("audience")) as "group" | "private" | "both", status: "active" });
    },
    onSuccess: async (_, variables) => { variables.form?.reset(); setNotice(en ? "Knowledge base updated" : "知识库已更新"); await client.invalidateQueries({ queryKey: ["admin-telegram-knowledge"] }); },
    onError: (error) => setNotice(error instanceof Error ? error.message : t("updateFailed")),
  });
  const data = telegram.data?.data;
  const availableGroups = data?.groups.filter((group) => group.enabled && group.lotteryEnabled) ?? [];
  const checkinGroups = data?.groups.filter((group) => group.enabled) ?? [];
  const openActivities = data?.lotteryActivities.filter((activity) => activity.status === "open") ?? [];
  const selectedGroupId = availableGroups.some((group) => group.chatId === groupId) ? groupId : (availableGroups[0]?.chatId ?? "");
  const selectedActivityId = openActivities.some((activity) => String(activity.id) === activityId) ? activityId : (openActivities[0] ? String(openActivities[0].id) : "");
  const selectedCheckinGroupId = checkinGroups.some((group) => group.chatId === checkinGroupId) ? checkinGroupId : (checkinGroups[0]?.chatId ?? "");
  const queueCount = data?.memberVerifications.filter((item) => !item.completedAt && !["passed", "released", "kicked"].includes(item.status)).length ?? 0;

  const tabs: { id: TelegramTab; label: string; hint: string; icon: typeof Bot; count?: number }[] = [
    { id: "overview", label: t("telegramTabOverview"), hint: t("telegramTabOverviewHint"), icon: Activity },
    { id: "groups", label: t("telegramTabGroups"), hint: t("telegramTabGroupsHint"), icon: Users, count: data?.groups.length },
    { id: "queue", label: t("telegramTabQueue"), hint: t("telegramTabQueueHint"), icon: ShieldCheck, count: queueCount || undefined },
    { id: "publish", label: t("telegramTabPublish"), hint: t("telegramTabPublishHint"), icon: Send },
    { id: "ai", label: t("telegramTabAi"), hint: t("telegramTabAiHint"), icon: Brain },
    { id: "bindings", label: t("telegramTabBindings"), hint: t("telegramTabBindingsHint"), icon: Bot, count: data?.stats.boundUsers },
  ];

  if (telegram.isLoading) return <div className="admin-panel-stack" data-testid="admin-panel-telegram" aria-busy="true">
    <div className="admin-panel-heading"><div><span className="admin-kicker">TELEGRAM</span><h2>{t("adminTelegram")}</h2><p>{t("adminTelegramDesc")}</p></div><Button size="sm" variant="outline" disabled><RefreshCw />{t("checkTelegramHealth")}</Button></div>
    <nav className="admin-telegram-tabs" aria-hidden="true">{[0, 1, 2, 3].map((item) => <button type="button" key={item} disabled><span><strong><DataSkeleton /></strong></span></button>)}</nav>
    <section className="admin-metric-grid admin-telegram-metrics">{[0, 1, 2, 3].map((item) => <article key={item}><span><DataSkeleton /></span><strong><DataSkeleton /></strong><small><DataSkeleton /></small></article>)}</section>
  </div>;
  if (telegram.isError || !data) return <div className="admin-state is-error" role="alert"><span>{t("telegramAdminLoadFailed")}</span><Button size="sm" variant="outline" onClick={() => void telegram.refetch()}>{t("retry")}</Button></div>;

  const healthy = data.configured && data.featureEnabled && data.health.botCanReceiveUpdates;

  return <div className="admin-panel-stack" data-testid="admin-panel-telegram">
    <div className="admin-panel-heading">
      <div><span className="admin-kicker">TELEGRAM</span><h2>{t("adminTelegram")}</h2><p>{t("adminTelegramDesc")}</p></div>
      <div className="admin-heading-actions"><Button size="sm" variant="outline" disabled={command.isPending || !data.configured} onClick={() => { setNotice(""); command.mutate({ action: "health" }); }}><RefreshCw />{t("checkTelegramHealth")}</Button></div>
    </div>

    {notice && <p className={`admin-alert ${command.isError || saveAi.isError || knowledgeAction.isError ? "is-error" : "is-success"}`} role={command.isError || saveAi.isError || knowledgeAction.isError ? "alert" : "status"}>{notice}</p>}

    <nav className="admin-telegram-tabs" aria-label={t("adminTelegram")}>
      {tabs.map((item) => {
        const Icon = item.icon;
        return <button type="button" key={item.id} aria-current={tab === item.id ? "page" : undefined} onClick={() => setTab(item.id)}>
          <Icon />
          <span><strong>{item.label}</strong><small>{item.hint}</small></span>
          {item.count !== undefined && <b>{item.count}</b>}
        </button>;
      })}
    </nav>

    {tab === "overview" && <div className="admin-telegram-pane" data-testid="admin-telegram-overview">
      <section className="admin-surface admin-telegram-status-card">
        <div className="admin-section-heading">
          <div><span className="admin-kicker">BOT STATUS</span><h3><Bot />{t("telegramBotStatus")}</h3><p>{data.botName ? `@${data.botName}` : t("telegramBotNotConfigured")}</p></div>
          <span className={`status-pill ${healthy ? "is-active" : ""}`}>{data.health.status}</span>
        </div>
        <dl className="admin-metrics compact">
          <div><dt>{t("telegramConfigured")}</dt><dd>{t(data.configured ? "yes" : "no")}</dd></div>
          <div><dt>{t("telegramFeatureStatus")}</dt><dd>{t(data.featureEnabled ? "enabled" : "disabled")}</dd></div>
          <div><dt>{t("telegramCanReceiveUpdates")}</dt><dd>{t(data.health.botCanReceiveUpdates ? "yes" : "no")}</dd></div>
          <div><dt>{t("telegramPendingUpdates")}</dt><dd>{data.health.pendingUpdates ?? "—"}</dd></div>
          <div><dt>{t("telegramLastUpdate")}</dt><dd>{data.health.lastCompletedUpdateAt ? new Date(data.health.lastCompletedUpdateAt).toLocaleString(locale) : "—"}</dd></div>
          <div><dt>{t("telegramLastHealthCheck")}</dt><dd>{data.health.lastHealthCheckAt ? new Date(data.health.lastHealthCheckAt).toLocaleString(locale) : "—"}</dd></div>
        </dl>
      </section>

      <section className="admin-metric-grid admin-telegram-metrics" aria-label={t("telegramMetrics")}>
        <MetricCard label={t("telegramUsersTotal")} value={data.stats.usersTotal} hint={t("telegramUsersTotalHint")} icon={Users} />
        <MetricCard label={t("telegramActive30d")} value={data.stats.active30d} hint={t("telegramActive30dHint")} icon={Activity} />
        <MetricCard label={t("telegramBoundUsers")} value={data.stats.boundUsers} hint={t("telegramBoundUsersHint")} icon={ShieldCheck} />
        <MetricCard label={t("telegramManagedGroups")} value={data.stats.managedGroups} hint={t("telegramManagedGroupsHint")} icon={Send} />
      </section>

      <div className="admin-telegram-signal-row" aria-label={t("telegramMetrics")}>
        <div><span>{t("telegramLogins30d")}</span><strong>{data.stats.successfulLogins30d}</strong></div>
        <div><span>{t("telegramPendingJoinRequests")}</span><strong>{data.stats.pendingJoinRequests}</strong></div>
        <div><span>{t("telegramFailedJoinRequests")}</span><strong>{data.stats.failedJoinRequests}</strong></div>
        <div><span>{t("telegramMemberVerificationQueue")}</span><strong>{queueCount}</strong></div>
      </div>

      <section className="admin-surface">
        <div className="admin-section-heading"><div><span className="admin-kicker">GROUP SETUP</span><h3><ShieldCheck />{t("telegramGroupSetup")}</h3><p>{t("telegramGroupSetupHint")}</p></div></div>
        <div className="admin-capability-note"><Bot /><div><strong><code>/setup</code></strong><p>{t("telegramSetupCommandHint")}</p></div></div>
        <p className="admin-alert is-neutral"><ShieldCheck />{t("telegramSecretsProtected")}</p>
      </section>
    </div>}

    {tab === "groups" && <section className="admin-surface" data-testid="admin-telegram-groups">
      <div className="admin-section-heading"><div><span className="admin-kicker">GROUPS</span><h3>{t("telegramManagedGroupList")}</h3><p>{t("telegramManagedGroupListHint")}</p></div><span>{data.groups.length}</span></div>
      {data.groups.length === 0 ? <div className="admin-state">{t("noTelegramGroups")}</div> : <div className="admin-telegram-group-list">{data.groups.map((group) => <TelegramGroupForm key={`${group.chatId}:${group.updatedAt}`} group={group} pending={command.isPending} save={(input) => { setNotice(""); command.mutate(input); }} />)}</div>}
    </section>}

    {tab === "queue" && <section className="admin-surface" data-testid="admin-telegram-member-verifications">
      <div className="admin-section-heading"><div><span className="admin-kicker">NEW MEMBERS</span><h3>{t("telegramMemberVerificationQueue")}</h3><p>{t("telegramMemberVerificationQueueHint")}</p></div><span>{data.memberVerifications.length}</span></div>
      {memberPassNotice && <p className={`admin-alert ${memberPassNotice.status === "error" ? "is-error" : "is-neutral"}`} role={memberPassNotice.status === "error" ? "alert" : "status"} data-testid="admin-telegram-member-feedback">{memberPassNotice.status === "error" ? memberPassNotice.message : t(data.memberVerifications.find((item) => item.id === memberPassNotice.id)?.status === "passed" || memberPassNotice.status === "passed" ? "telegramMemberPassed" : "telegramMemberPassQueued")}</p>}
      <div className="admin-list">{data.memberVerifications.map((verification) => {
        const isTargetPending = command.isPending && command.variables?.action === "member_verification_pass" && command.variables.challengeId === verification.id;
        const isTerminal = verification.completedAt !== null || ["passed", "released", "kicked"].includes(verification.status);
        const canApprove = !command.isPending && !verification.approvalPending && !verification.manualPassed && !isTerminal && !["banning", "unbanning"].includes(verification.status);
        const visibleStatus = verification.approvalPending && verification.status === "pending" ? "releasing" : verification.status;
        const answered = verification.answeredAt
          ? t("telegramVerificationClickedAt", { time: new Date(verification.answeredAt).toLocaleString(locale) })
          : t(verification.answered ? "telegramVerificationClickedLegacy" : "telegramVerificationNotClicked");
        return <article className="admin-list-row" key={verification.id}>
          <div className="transaction-icon"><ShieldCheck /></div>
          <div><strong>{verification.displayName}</strong><small>{verification.groupTitle} · {answered} · {t("telegramVerificationWrongAnswers", { count: verification.attempts })} · {t("telegramVerificationUpdatedAt", { time: new Date(verification.updatedAt).toLocaleString(locale) })}{verification.retryCount > 0 ? ` · ${t("telegramVerificationRetrying", { count: verification.retryCount })}` : ""}{verification.lastErrorCode ? ` · ${t("telegramVerificationLastError", { error: t(`telegramVerificationError.${verification.lastErrorCode}`, { defaultValue: verification.lastErrorCode }) })}` : ""}</small></div>
          <div className="admin-list-row-actions">
            <span className={`status-pill ${visibleStatus === "passed" ? "is-active" : ""}`}>{t(`telegramMemberVerificationStatus.${visibleStatus}`, { defaultValue: visibleStatus })}</span>
            {isTargetPending ? <Button size="xs" variant="outline" disabled>{t("processing")}</Button> : canApprove ? <Button size="xs" variant="outline" onClick={() => { setNotice(""); setMemberPassNotice(null); command.mutate({ action: "member_verification_pass", challengeId: verification.id }); }}>{t("telegramManualPass")}</Button> : null}
          </div>
        </article>;
      })}</div>
      {data.memberVerifications.length === 0 && <div className="admin-state">{t("telegramNoMemberVerifications")}</div>}
    </section>}

    {tab === "publish" && <div className="admin-telegram-pane admin-telegram-publish-pane" data-testid="admin-telegram-publish">
      <section className="admin-surface">
        <div className="admin-section-heading"><div><span className="admin-kicker">GROUP CHECK-IN</span><h3>{t("telegramPublishCheckin")}</h3><p>{t("telegramPublishCheckinHint")}</p></div></div>
        <form className="admin-telegram-publish" onSubmit={(event) => { event.preventDefault(); if (!selectedCheckinGroupId) return; setNotice(""); command.mutate({ action: "publish_checkin", chatId: selectedCheckinGroupId }); }}>
          <label>{t("telegramTargetGroup")}<Select value={selectedCheckinGroupId} onValueChange={setCheckinGroupId}><SelectTrigger data-testid="telegram-checkin-group-select" aria-label={t("telegramTargetGroup")}><SelectValue placeholder={t("selectTelegramGroup")} /></SelectTrigger><SelectContent>{checkinGroups.map((group) => <SelectItem key={group.chatId} value={group.chatId}>{group.title}</SelectItem>)}</SelectContent></Select></label>
          <Button disabled={command.isPending || !data.featureEnabled || !selectedCheckinGroupId}><Send />{t("publishToTelegramGroup")}</Button>
        </form>
        {checkinGroups.length === 0 && <p className="admin-alert is-neutral">{t("telegramNoCheckinGroups")}</p>}
        <div className="admin-list">{data.checkinPublications.map((publication) => {
          const group = data.groups.find((item) => item.chatId === publication.chatId);
          return <article className="admin-list-row" key={publication.id}><div className="transaction-icon"><Send /></div><div><strong>{group?.title ?? publication.chatId}</strong><small>{publication.renderedBusinessDate ?? "—"} · {publication.status} · {publication.publishedAt ? new Date(publication.publishedAt).toLocaleString(locale) : "—"}</small></div><span className={`status-pill ${publication.status === "published" ? "is-active" : ""}`}>{publication.status}</span></article>;
        })}</div>
        {data.checkinPublications.length === 0 && <div className="admin-state">{t("noTelegramCheckinPublications")}</div>}
      </section>

      <section className="admin-surface">
        <div className="admin-section-heading"><div><span className="admin-kicker">GROUP LOTTERY</span><h3><Gift />{t("telegramPublishLottery")}</h3><p>{t("telegramPublishLotteryHint")}</p></div></div>
        <form className="admin-telegram-publish is-lottery" onSubmit={(event) => { event.preventDefault(); if (!selectedGroupId || !selectedActivityId) return; setNotice(""); command.mutate({ action: "publish_lottery", chatId: selectedGroupId, activityId: Number(selectedActivityId) }); }}>
          <label>{t("telegramTargetGroup")}<Select value={selectedGroupId} onValueChange={setGroupId}><SelectTrigger data-testid="telegram-group-select" aria-label={t("telegramTargetGroup")}><SelectValue placeholder={t("selectTelegramGroup")} /></SelectTrigger><SelectContent>{availableGroups.map((group) => <SelectItem key={group.chatId} value={group.chatId}>{group.title}</SelectItem>)}</SelectContent></Select></label>
          <label>{t("telegramLotteryActivity")}<Select value={selectedActivityId} onValueChange={setActivityId}><SelectTrigger data-testid="telegram-activity-select" aria-label={t("telegramLotteryActivity")}><SelectValue placeholder={t("selectLotteryActivity")} /></SelectTrigger><SelectContent>{openActivities.map((activity) => <SelectItem key={activity.id} value={String(activity.id)}>{activity.title} · {t(`rewardMode.${activity.participationMode}`)}{activity.participationMode === "points" ? ` · ${activity.costPoints} ${t("pointsUnit")}` : activity.participationMode === "direct_referrals" ? ` · ${activity.requiredDirectReferrals} ${t("directReferralsUnit")}` : ""}</SelectItem>)}</SelectContent></Select></label>
          <Button disabled={command.isPending || !data.featureEnabled || !selectedGroupId || !selectedActivityId}><Send />{t("publishToTelegramGroup")}</Button>
        </form>
        {(availableGroups.length === 0 || openActivities.length === 0) && <p className="admin-alert is-neutral">{t(availableGroups.length === 0 ? "telegramNoLotteryGroups" : "telegramNoOpenActivities")}</p>}
        <div className="admin-list">{data.publications.map((publication) => {
          const activity = data.lotteryActivities.find((item) => item.id === publication.activityId);
          const group = data.groups.find((item) => item.chatId === publication.chatId);
          const canPublishResults = data.featureEnabled && activity?.status === "closed" && activity.winnerCount > 0 && publication.status === "published";
          return <article className="admin-list-row" key={publication.id}><div className="transaction-icon"><Send /></div><div><strong>{activity?.title ?? `#${publication.activityId}`}</strong><small>{activity ? t(`rewardMode.${activity.participationMode}`) : "—"} · {group?.title ?? publication.chatId} · {publication.status} · {publication.publishedAt ? new Date(publication.publishedAt).toLocaleString(locale) : "—"}</small></div>{publication.resultsPublishedAt ? <span className="status-pill is-active">{t("telegramResultsPublished")}</span> : canPublishResults ? <Button size="xs" variant="outline" disabled={command.isPending} onClick={() => { setNotice(""); command.mutate({ action: "publish_results", publicationId: publication.id }); }}>{t("publishLotteryResults")}</Button> : <span className="status-pill">{publication.status}</span>}</article>;
        })}</div>
        {data.publications.length === 0 && <div className="admin-state">{t("noTelegramPublications")}</div>}
      </section>
    </div>}

    {tab === "ai" && <section className="admin-surface" data-testid="admin-telegram-ai">
      <div className="admin-section-heading"><div><span className="admin-kicker">DEEPSEEK</span><h3><Brain />{en ? "Intelligent assistant" : "智能机器人"}</h3><p>{en ? "Public knowledge in groups; verified private tools in direct messages." : "群聊只使用公共知识，私聊绑定后才能查询本人脱敏信息。"}</p></div>{ai.data && <span className={`status-pill ${ai.data.data.enabled ? "is-active" : ""}`}>{ai.data.data.enabled ? t("enabled") : t("disabled")}</span>}</div>
      {ai.isLoading && <div className="admin-state loading-skeleton loading-skeleton-block" aria-label={t("loading")}>{t("loading")}</div>}
      {ai.data && <form key={ai.data.data.version} className="admin-ai-settings" onSubmit={(event) => { event.preventDefault(); setNotice(""); saveAi.mutate(event.currentTarget); }}>
        <label className="admin-settings-toggle"><input name="enabled" type="checkbox" defaultChecked={ai.data.data.enabled} /><span><strong>{en ? "Enable AI" : "启用 AI"}</strong><small>{en ? "DeepSeek answers are audited without storing chat text." : "不保存聊天全文，仅记录模型、Token、耗时和工具。"}</small></span></label>
        <label className="admin-settings-toggle"><input name="groupEnabled" type="checkbox" defaultChecked={ai.data.data.groupEnabled} /><span><strong>{en ? "Group mentions" : "群聊 @ 回答"}</strong><small>{en ? "Public tools only" : "只允许公共知识和可售卡头"}</small></span></label>
        <label className="admin-settings-toggle"><input name="privateEnabled" type="checkbox" defaultChecked={ai.data.data.privateEnabled} /><span><strong>{en ? "Private assistant" : "私聊助手"}</strong><small>{en ? "Requires a verified binding" : "要求已验证的账号绑定"}</small></span></label>
        <label>{en ? "Model" : "模型"}<select name="model" defaultValue={ai.data.data.model}><option value="deepseek-v4-flash">deepseek-v4-flash</option><option value="deepseek-v4-pro">deepseek-v4-pro</option></select></label>
        <label>{en ? "User / minute" : "每用户每分钟"}<input name="perUserPerMinute" type="number" min={1} max={60} defaultValue={ai.data.data.perUserPerMinute} /></label>
        <label>{en ? "Group / minute" : "每群每分钟"}<input name="perGroupPerMinute" type="number" min={1} max={120} defaultValue={ai.data.data.perGroupPerMinute} /></label>
        <label>{en ? "Global / minute" : "全局每分钟"}<input name="globalPerMinute" type="number" min={1} max={600} defaultValue={ai.data.data.globalPerMinute} /></label>
        <label>{en ? "Max output tokens" : "最大输出 Token"}<input name="maxOutputTokens" type="number" min={64} max={4096} defaultValue={ai.data.data.maxOutputTokens} /></label>
        <label className="admin-ai-key-field">{en ? "DeepSeek API key" : "DeepSeek API 密钥"}<input name="apiKey" type="password" autoComplete="new-password" placeholder={ai.data.data.apiKeyConfigured ? `已配置 · ${ai.data.data.apiKeyFingerprint}` : "sk-..."} /><small>{en ? "Leave blank to keep the current key." : "留空保留现有密钥；保存后无法读取明文。"}</small></label>
        <div className="admin-form-actions"><Button disabled={saveAi.isPending}><StableSwap state={saveAi.isPending ? "busy" : "idle"} labels={{ idle: t("save"), busy: t("processing") }} /></Button></div>
      </form>}
      <div className="admin-knowledge-grid">
        <form className="admin-product-form" onSubmit={(event) => { event.preventDefault(); knowledgeAction.mutate({ action: "save", form: event.currentTarget }); }}><div><strong>{en ? "Add knowledge" : "新增知识文章"}</strong><small>{en ? "Keyword retrieval; no vector database." : "使用关键词与标签检索，不引入向量数据库。"}</small></div><label>{en ? "Title" : "标题"}<input name="title" maxLength={160} required /></label><label>{en ? "Content" : "正文"}<textarea name="content" maxLength={12000} required /></label><label>{en ? "Tags" : "标签"}<input name="tags" placeholder="GPT, CDK, 财务" /></label><div className="admin-form-grid two"><label>{en ? "Language" : "语言"}<select name="language"><option value="zh">中文</option><option value="en">English</option></select></label><label>{en ? "Audience" : "可见范围"}<select name="audience"><option value="both">群聊与私聊</option><option value="group">仅群聊</option><option value="private">仅私聊</option></select></label></div><Button disabled={knowledgeAction.isPending}>{en ? "Add article" : "添加文章"}</Button></form>
        <div className="admin-knowledge-list">{knowledge.isLoading ? <div className="admin-state">{t("loading")}</div> : knowledge.data?.data.list.map((article) => <article key={article.id}><div><strong>{article.title}</strong><small>{article.language} · {article.audience} · v{article.version}</small><p>{article.content}</p></div><Button size="icon-xs" variant="ghost" aria-label={en ? "Disable article" : "停用文章"} disabled={article.status === "disabled" || knowledgeAction.isPending} onClick={() => knowledgeAction.mutate({ action: "delete", id: article.id })}><Trash2 /></Button></article>)}</div>
      </div>
    </section>}

    {tab === "bindings" && <section className="admin-surface" data-testid="admin-telegram-bindings">
      <div className="admin-section-heading"><div><span className="admin-kicker">BOUND USERS</span><h3>{t("telegramBoundUserList")}</h3><p>{t("telegramBoundUserListHint")}</p></div><span>{bindings.data?.data.total ?? data.stats.boundUsers}</span></div>
      <form className="admin-telegram-binding-search" onSubmit={(event) => { event.preventDefault(); setBindingPage(1); setBindingQuery(String(new FormData(event.currentTarget).get("q") ?? "").trim()); }}>
        <label>{t("search")}<input name="q" placeholder={t("telegramBindingSearchPlaceholder")} /></label><Button type="submit" size="sm">{t("search")}</Button>
      </form>
      {bindings.isLoading && <div className="admin-state loading-skeleton loading-skeleton-table" aria-label={t("loading")}>{t("loading")}</div>}
      {bindings.isError && <div className="admin-state is-error" role="alert"><span>{t("telegramBindingsLoadFailed")}</span><Button size="xs" variant="outline" onClick={() => void bindings.refetch()}>{t("retry")}</Button></div>}
      {bindings.data?.data.list.length === 0 && <div className="admin-state">{t("noTelegramBindings")}</div>}
      {bindings.data && bindings.data.data.list.length > 0 && <div className="admin-telegram-binding-list">{bindings.data.data.list.map((binding) => <button type="button" key={binding.userId} className="admin-telegram-binding-row" onClick={() => onSelectCustomer(binding.userId)} aria-label={t("viewCustomerDetails", { email: binding.email ?? binding.displayName ?? `#${binding.userId}` })}>
        <span><strong>{binding.email ?? binding.displayName}</strong><small>{binding.memberTier} · {binding.status}</small></span><span><strong>{binding.telegramUsername ? `@${binding.telegramUsername.replace(/^@/, "")}` : t("telegramUsernameUnavailable")}</strong><small>{t("telegramVerifiedAt")} {new Date(binding.verifiedAt).toLocaleString(locale)}</small></span>
      </button>)}</div>}
      {bindings.data && <div className="admin-pagination"><span>{t("totalItems", { count: bindings.data.data.total })}</span><div><Button size="xs" variant="outline" onClick={() => setBindingPage((page) => page - 1)} disabled={bindings.data.data.page <= 1}>{t("previousPage")}</Button><span>{bindings.data.data.page}</span><Button size="xs" variant="outline" onClick={() => setBindingPage((page) => page + 1)} disabled={bindings.data.data.page * bindings.data.data.pageSize >= bindings.data.data.total}>{t("nextPage")}</Button></div></div>}
    </section>}
  </div>;
}
