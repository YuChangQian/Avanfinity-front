import { formatDecimal } from "../decimal";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Gift, UserCheck, WalletCards } from "lucide-react";
import { useTranslation } from "react-i18next";
import { adminLotteryCommand, getAdminLottery, getAdminLotteryParticipants, getDeferredRewards, payDeferredReward, type LotteryParticipationMode } from "../api";
import { Button } from "./ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { DataSkeleton } from "./PageShell";

function Message({ value, error }: { value: string; error: boolean }) {
  return value ? <p className={`admin-alert ${error ? "is-error" : "is-success"}`} role={error ? "alert" : "status"}>{value}</p> : null;
}

function localDateTime(value: Date) {
  return new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function AdminRewardsPanel({ token, displayDate, onSelectCustomer }: { token: string; displayDate: (value: string) => string; onSelectCustomer: (id: number) => void }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [mode, setMode] = useState<LotteryParticipationMode>("free");
  const [prizeType, setPrizeType] = useState("balance");
  const [expandedActivityId, setExpandedActivityId] = useState<number | null>(null);
  const [participantPage, setParticipantPage] = useState(1);
  const [endTimeDefaults] = useState(() => ({
    minimum: localDateTime(new Date(Date.now() + 60_000)),
    value: localDateTime(new Date(Date.now() + 86_400_000)),
  }));
  const lottery = useQuery({
    queryKey: ["admin-lottery"],
    queryFn: () => getAdminLottery(token),
    retry: false,
    refetchInterval: (query) => query.state.data?.data.activities.some((activity) => activity.drawState !== "scheduled" && activity.drawState !== "completed") ? 3_000 : false,
  });
  const participants = useQuery({
    queryKey: ["admin-lottery-participants", expandedActivityId, participantPage],
    queryFn: () => getAdminLotteryParticipants(token, expandedActivityId!, participantPage),
    enabled: expandedActivityId !== null,
    retry: false,
  });
  const deferred = useQuery({ queryKey: ["admin-deferred"], queryFn: () => getDeferredRewards(token), retry: false });
  const lotteryAction = useMutation({
    mutationFn: (input: Record<string, unknown>) => adminLotteryCommand(token, input),
    onSuccess: async () => { setNotice({ text: t("saved"), error: false }); await Promise.all([client.invalidateQueries({ queryKey: ["admin-lottery"] }), client.invalidateQueries({ queryKey: ["admin-telegram"] })]); },
    onError: async (error) => { setNotice({ text: error instanceof Error ? error.message : t("updateFailed"), error: true }); await client.invalidateQueries({ queryKey: ["admin-lottery"] }); },
  });
  const payDeferred = useMutation({
    mutationFn: (id: number) => payDeferredReward(token, id),
    onSuccess: async () => { setNotice({ text: t("saved"), error: false }); await Promise.all([client.invalidateQueries({ queryKey: ["admin-deferred"] }), client.invalidateQueries({ queryKey: ["admin-lottery"] })]); },
    onError: (error) => setNotice({ text: error instanceof Error ? error.message : t("updateFailed"), error: true }),
  });
  if (lottery.isLoading || deferred.isLoading) return <div className="admin-panel-stack" data-testid="admin-panel-rewards" aria-busy="true">
    <div className="admin-panel-heading"><div><span className="admin-kicker">GROWTH</span><h2>{t("adminRewards")}</h2><p>{t("adminRewardsDesc")}</p></div></div>
    <section className="admin-surface"><div className="admin-section-heading"><div><span className="admin-kicker">CHECK-IN</span><h3>{t("checkinSettings")}</h3><p>{t("checkinSettingsHint")}</p></div></div><form className="admin-checkin-form"><label className="admin-settings-toggle"><input type="checkbox" disabled /><span><strong>{t("enableDailyCheckin")}</strong><small>{t("enableDailyCheckinHint")}</small></span></label>{["dailyBasePoints", "streakBonusPerDay", "streakBonusCapDays"].map((label) => <label key={label}>{t(label)}<input disabled /></label>)}<Button disabled>{t("saveCheckinSettings")}</Button></form></section>
    <section className="admin-surface"><div className="admin-section-heading"><div><span className="admin-kicker">ACTIVITIES</span><h3>{t("lotteryAdmin")}</h3></div><DataSkeleton /></div><div className="admin-list">{[0, 1, 2].map((item) => <article className="admin-list-row" key={item}><div className="transaction-icon"><Gift /></div><div><strong><DataSkeleton /></strong><small><DataSkeleton /></small><small><DataSkeleton /></small></div><Button size="xs" variant="outline" disabled>{t("viewLotteryParticipants", { count: 0 })}</Button></article>)}</div></section>
    <section className="admin-surface"><div className="admin-section-heading"><div><span className="admin-kicker">DEFERRED</span><h3>{t("deferredRewards")}</h3></div><DataSkeleton /></div><div className="admin-list">{[0, 1].map((item) => <article className="admin-list-row" key={item}><div className="transaction-icon"><WalletCards /></div><div><strong><DataSkeleton /></strong><small><DataSkeleton /></small></div><Button size="xs" disabled>{t("payReward")}</Button></article>)}</div></section>
  </div>;
  if (lottery.isError || deferred.isError || !lottery.data || !deferred.data) return <div className="admin-state is-error" role="alert"><span>{t("adminLoadFailed")}</span><Button size="sm" variant="outline" onClick={() => void Promise.all([lottery.refetch(), deferred.refetch()])}>{t("retry")}</Button></div>;
  const data = lottery.data.data;
  const settings = data.checkinSettings;
  return <div className="admin-panel-stack" data-testid="admin-panel-rewards">
    <div className="admin-panel-heading"><div><span className="admin-kicker">GROWTH</span><h2>{t("adminRewards")}</h2><p>{t("adminRewardsDesc")}</p></div></div>
    <Message value={notice?.text ?? ""} error={notice?.error ?? false} />
    <section className="admin-surface">
      <div className="admin-section-heading"><div><span className="admin-kicker">CHECK-IN</span><h3>{t("checkinSettings")}</h3><p>{t("checkinSettingsHint")}</p></div></div>
      <form className="admin-checkin-form" key={settings.version} onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); setNotice(null); lotteryAction.mutate({ action: "set_checkin", enabled: form.get("enabled") === "on", basePoints: Number(form.get("basePoints")), streakBonusPerDay: Number(form.get("streakBonusPerDay")), streakBonusCapDays: Number(form.get("streakBonusCapDays")), version: settings.version }); }}>
        <label className="admin-settings-toggle"><input name="enabled" type="checkbox" defaultChecked={settings.enabled} /><span><strong>{t("enableDailyCheckin")}</strong><small>{t("enableDailyCheckinHint")}</small></span></label>
        <label>{t("dailyBasePoints")}<input name="basePoints" type="number" min="1" max="10000" defaultValue={settings.basePoints} required /></label>
        <label>{t("streakBonusPerDay")}<input name="streakBonusPerDay" type="number" min="0" max="10000" defaultValue={settings.streakBonusPerDay} required /></label>
        <label>{t("streakBonusCapDays")}<input name="streakBonusCapDays" type="number" min="1" max="365" defaultValue={settings.streakBonusCapDays} required /></label>
        <Button disabled={lotteryAction.isPending}>{t("saveCheckinSettings")}</Button>
      </form>
    </section>
    <section className="admin-surface">
      <div className="admin-section-heading"><div><span className="admin-kicker">ACTIVITIES</span><h3>{t("lotteryAdmin")}</h3></div><span>{t("marketingBudget")} ${formatDecimal(data.marketingBudget)}</span></div>
      <div className="admin-reward-forms">
        <form onSubmit={(event) => { event.preventDefault(); setNotice(null); lotteryAction.mutate({ action: "fund_budget", amount: String(new FormData(event.currentTarget).get("amount")) }); }}><label>{t("fundBudget")}<input name="amount" inputMode="decimal" placeholder="1000.00" required /></label><Button disabled={lotteryAction.isPending}>{t("fund")}</Button></form>
        <form className="admin-activity-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const endsAt = new Date(String(form.get("endsAt"))); setNotice(null); if (Number.isNaN(endsAt.getTime()) || endsAt.getTime() <= Date.now()) { setNotice({ text: t("activityEndTimeInvalid"), error: true }); return; } lotteryAction.mutate({ action: "create", title: String(form.get("title")), description: String(form.get("description")), endsAt: endsAt.toISOString(), participationMode: mode, costPoints: mode === "points" ? Number(form.get("costPoints")) : 0, requiredDirectReferrals: mode === "direct_referrals" ? Number(form.get("requiredDirectReferrals")) : 0, maxTicketsPerUser: Number(form.get("maxTickets")), prizes: [{ label: String(form.get("prizeLabel")), qty: Number(form.get("prizeQuantity")), type: prizeType, value: String(form.get("prizeValue")) }] }); }}>
          <label>{t("activityTitle")}<input name="title" maxLength={100} required /></label>
          <label>{t("activityDescription")}<input name="description" maxLength={500} required /></label>
          <label>{t("activityEndTime")}<input name="endsAt" type="datetime-local" min={endTimeDefaults.minimum} defaultValue={endTimeDefaults.value} required /><small>{t("activityEndTimeHint")}</small></label>
          <label>{t("participationMode")}<Select value={mode} onValueChange={(value) => setMode(value as LotteryParticipationMode)}><SelectTrigger aria-label={t("participationMode")}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="free">{t("rewardMode.free")}</SelectItem><SelectItem value="points">{t("rewardMode.points")}</SelectItem><SelectItem value="direct_referrals">{t("rewardMode.direct_referrals")}</SelectItem></SelectContent></Select></label>
          {mode === "points" && <label>{t("pointCost")}<input name="costPoints" type="number" min="1" max="1000" defaultValue="10" required /></label>}
          {mode === "direct_referrals" && <label>{t("requiredDirectReferrals")}<input name="requiredDirectReferrals" type="number" min="1" max="10000" defaultValue="1" required /></label>}
          <label>{t("maxParticipationCount")}<input name="maxTickets" type="number" min="1" max="10" defaultValue="1" required /></label>
          <label>{t("prizeLabel")}<input name="prizeLabel" required /></label>
          <label>{t("prizeType")}<Select value={prizeType} onValueChange={setPrizeType}><SelectTrigger aria-label={t("prizeType")}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="balance">{t("prizeTypeBalance")}</SelectItem><SelectItem value="points">{t("prizeTypePoints")}</SelectItem><SelectItem value="vip">{t("prizeTypeVip")}</SelectItem><SelectItem value="physical">{t("prizeTypePhysical")}</SelectItem></SelectContent></Select>{prizeType === "balance" && <small>{t("balancePrizeAutoCredit")}</small>}</label>
          <label>{t("prizeQuantity")}<input name="prizeQuantity" type="number" min="1" max="100" defaultValue="1" required /></label>
          <label>{t("prizeValue")}<input name="prizeValue" inputMode="decimal" placeholder="5.00" required={prizeType === "balance" || prizeType === "points"} /></label>
          <Button disabled={lotteryAction.isPending}>{t("createActivity")}</Button>
        </form>
      </div>
      <div className="admin-list">{data.activities.map((activity) => <div className="admin-lottery-activity" key={activity.id}>
        <article className="admin-list-row"><div className="transaction-icon"><Gift /></div><div><strong>{activity.title}</strong><small>{t(`rewardMode.${activity.participationMode}`)}{activity.participationMode === "points" ? ` · ${activity.costPoints} ${t("pointsUnit")}` : activity.participationMode === "direct_referrals" ? ` · ${activity.requiredDirectReferrals} ${t("directReferralsUnit")}` : ""} · {activity.winnerCount} {t("winners")}</small><small>{t("activityEndTime")}: {activity.endsAt ? displayDate(activity.endsAt) : t("noActivityEndTime")}</small>{activity.drawState === "retrying" && <small className="is-error">{t("automaticDrawRetrying", { code: activity.drawLastErrorCode ?? "retry", count: activity.drawAttempts })}</small>}</div><div className="admin-lottery-actions"><Button size="xs" variant="outline" onClick={() => { setParticipantPage(1); setExpandedActivityId((current) => current === activity.id ? null : activity.id); }} aria-expanded={expandedActivityId === activity.id}>{t("viewLotteryParticipants", { count: activity.participantCount })}</Button>{activity.status === "open" && <Button size="xs" onClick={() => { setNotice(null); lotteryAction.mutate({ action: "draw", id: activity.id }); }} disabled={lotteryAction.isPending}>{t("endAndDraw")}</Button>}{activity.drawState !== "scheduled" && activity.drawState !== "completed" && <span className="status-pill">{t(activity.drawState === "retrying" ? "drawingRetryStatus" : "drawingStatus")}</span>}{activity.drawState === "completed" && <span className="status-pill is-active">{t("drawCompleted")}</span>}</div></article>
        {expandedActivityId === activity.id && <div className="admin-lottery-participants" data-testid={`lottery-participants-${activity.id}`}>
          {participants.isLoading && <div className="admin-state loading-skeleton loading-skeleton-table" aria-label={t("loading")}>{t("loading")}</div>}
          {participants.isError && <div className="admin-state is-error" role="alert"><span>{t("lotteryParticipantsLoadFailed")}</span><Button size="xs" variant="outline" onClick={() => void participants.refetch()}>{t("retry")}</Button></div>}
          {participants.data?.data.list.length === 0 && <div className="admin-state">{t("noLotteryParticipants")}</div>}
          {participants.data?.data.list.map((participant) => <button type="button" className="admin-lottery-participant" key={participant.userId} onClick={() => onSelectCustomer(participant.userId)} aria-label={t("viewCustomerDetails", { email: participant.email ?? `#${participant.userId}` })}><span><UserCheck /><strong>{participant.email ?? `#${participant.userId}`}</strong></span><small>{participant.tier} · {participant.tickets} {t("rewardChances")}{activity.participationMode === "direct_referrals" ? ` · ${t(participant.eligibleForDraw ? "referralParticipationEligible" : "referralParticipationPending", { current: participant.eligibleDirectReferrals, required: activity.requiredDirectReferrals })}` : ""} · {t(participant.telegramBound ? "telegramBoundReady" : "telegramBindingNeeded")}</small><time dateTime={participant.joinedAt}>{displayDate(participant.joinedAt)}</time></button>)}
          {participants.data && <div className="admin-lottery-participant-pagination"><small>{t("totalItems", { count: participants.data.data.total })}</small><span><Button size="xs" variant="outline" onClick={() => setParticipantPage((page) => page - 1)} disabled={participants.data.data.page <= 1}>{t("previousPage")}</Button><small>{participants.data.data.page}</small><Button size="xs" variant="outline" onClick={() => setParticipantPage((page) => page + 1)} disabled={participants.data.data.page * participants.data.data.pageSize >= participants.data.data.total}>{t("nextPage")}</Button></span></div>}
        </div>}
      </div>)}</div>
    </section>
    <section className="admin-surface"><div className="admin-section-heading"><div><span className="admin-kicker">DEFERRED</span><h3>{t("deferredRewards")}</h3></div><span>{deferred.data.data.length}</span></div>{deferred.data.data.length === 0 && <div className="admin-state">{t("noDeferredRewards")}</div>}<div className="admin-list">{deferred.data.data.map((reward) => <article className="admin-list-row" key={reward.id}><div className="transaction-icon"><WalletCards /></div><div><strong>{reward.email ?? `#${reward.userId}`} · ${formatDecimal(reward.amount)}</strong><small>{reward.type} · {displayDate(reward.createdAt)}</small></div><Button size="xs" onClick={() => { setNotice(null); payDeferred.mutate(reward.id); }} disabled={payDeferred.isPending}>{t("payReward")}</Button></article>)}</div></section>
  </div>;
}
