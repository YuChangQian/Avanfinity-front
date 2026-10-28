import { formatDecimal } from "../decimal";
import { useEffect, useState } from "react";
import { useAtomValue } from "jotai";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate } from "@tanstack/react-router";
import { CalendarCheck2, Gift, Sparkles, Ticket, UserPlus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataSkeleton, PageShell } from "../components/PageShell";
import { ApiError, checkInPoints, getLottery, getPoints, joinLottery, redeemPoints, type LotteryActivity, type LotteryParticipationMode } from "../api";
import { sessionAtom } from "../state";
import { useTranslation } from "react-i18next";
import { useFeatures } from "../features";

type ActivityFilter = "all" | LotteryParticipationMode;

function CheckinCalendar({ month, checkedDates = [], today }: { month: string; checkedDates?: string[]; today: string }) {
  const { t, i18n } = useTranslation();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
  const [year, monthNumber] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year, monthNumber - 1, 1));
  const dayCount = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const locale = i18n.language.startsWith("zh") ? "zh-CN" : "en-US";
  const title = new Intl.DateTimeFormat(locale, { year: "numeric", month: "long", timeZone: "UTC" }).format(first);
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "narrow", timeZone: "UTC" });
  const checked = new Set(checkedDates);
  const weekCount = Math.ceil((first.getUTCDay() + dayCount) / 7);
  return <table className="checkin-calendar" data-testid="checkin-calendar">
    <caption><span><strong>{title}</strong><small>{t("checkinCalendarCount", { count: checked.size })}</small></span></caption>
    <thead><tr>{Array.from({ length: 7 }, (_, index) => <th key={index} scope="col">{weekday.format(new Date(Date.UTC(2026, 7, 2 + index)))}</th>)}</tr></thead>
    <tbody>{Array.from({ length: weekCount }, (_, week) => <tr key={week}>{Array.from({ length: 7 }, (_, weekdayIndex) => {
      const day = week * 7 + weekdayIndex - first.getUTCDay() + 1;
      if (day < 1 || day > dayCount) return <td key={weekdayIndex} />;
      const date = `${month}-${String(day).padStart(2, "0")}`;
      const isChecked = checked.has(date);
      const isToday = date === today;
      const isFuture = date > today;
      const status = [isToday && t("checkinCalendarToday"), isChecked && t("checkinCalendarChecked"), isFuture && t("checkinCalendarFuture")].filter(Boolean).join(" · ");
      return <td key={date}><time dateTime={date} data-testid={`checkin-date-${date}`} className={`${isChecked ? "is-checked" : ""} ${isToday ? "is-today" : ""} ${isFuture ? "is-future" : ""}`.trim()} aria-current={isToday ? "date" : undefined} aria-label={`${date}${status ? ` · ${status}` : ""}`}><span>{day}</span>{isChecked && <b aria-hidden="true">✓</b>}</time></td>;
    })}</tr>)}</tbody>
  </table>;
}

function ActivityCard({ item, telegramBound, pending, join }: { item: LotteryActivity; telegramBound: boolean; pending: boolean; join: (id: number) => void }) {
  const { t, i18n } = useTranslation();
  const remaining = Math.max(0, item.requiredDirectReferrals - item.eligibleDirectReferrals);
  const modeIcon = item.participationMode === "direct_referrals" ? UserPlus : item.participationMode === "points" ? Ticket : Gift;
  const ModeIcon = modeIcon;
  const [now, setNow] = useState(() => Date.now());
  const requirement = item.participationMode === "points"
    ? t("rewardPointRequirement", { points: item.costPoints })
    : item.participationMode === "direct_referrals"
      ? t("rewardReferralRequirement", { current: item.eligibleDirectReferrals, required: item.requiredDirectReferrals })
      : t("rewardFreeRequirement");
  const endsAt = item.endsAt ? new Date(item.endsAt) : null;
  const endsAtMs = endsAt?.getTime() ?? Number.NaN;
  const expired = Number.isFinite(endsAtMs) && endsAtMs <= now;
  const referralActivity = item.participationMode === "direct_referrals";
  const canJoinPendingReferral = referralActivity && !item.participated && item.eligibilityReason === "direct_referrals_required";
  const disabled = pending || item.status !== "open" || expired || (!item.eligible && !canJoinPendingReferral) || (referralActivity ? item.participated : item.myTickets >= item.maxTicketsPerUser);
  const status = item.status === "open" ? t("openStatus") : item.status === "drawing" ? t("drawingStatus") : t("closedStatus");
  const participation = !item.participated
    ? t("referralParticipationNotJoined", { current: item.eligibleDirectReferrals, required: item.requiredDirectReferrals })
    : t(item.eligibleForDraw ? "referralParticipationEligible" : "referralParticipationPending", { current: item.eligibleDirectReferrals, required: item.requiredDirectReferrals });
  useEffect(() => {
    if (!Number.isFinite(endsAtMs)) return;
    const timeout = window.setTimeout(() => setNow(Date.now()), Math.max(0, endsAtMs - now) + 10);
    return () => window.clearTimeout(timeout);
  }, [endsAtMs, now]);
  return <article className={`module-card reward-card reward-mode-${item.participationMode}`} data-testid={`reward-activity-${item.id}`}>
    <div className="reward-card-head"><div className="stat-icon"><ModeIcon /></div><span>{t(`rewardMode.${item.participationMode}`)}</span></div>
    <div className="reward-card-copy"><h2>{item.title}</h2><p>{item.description}</p></div>
    <strong>{item.prize}</strong>
    <dl className="reward-activity-meta">
      <div><dt>{t("participationRequirement")}</dt><dd>{requirement}</dd></div>
      <div><dt>{t("activityParticipation")}</dt><dd>{item.participantCount} {t("participants")} · {referralActivity ? participation : `${item.myTickets}/${item.maxTicketsPerUser} ${t("rewardChances")}`}</dd></div>
      <div><dt>{t("activityStatus")}</dt><dd>{status}</dd></div>
      <div><dt>{t("activityEndTime")}</dt><dd>{endsAt && !Number.isNaN(endsAt.getTime()) ? <time dateTime={item.endsAt!}>{new Intl.DateTimeFormat(i18n.language.startsWith("zh") ? "zh-CN" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(endsAt)}</time> : t("noActivityEndTime")}</dd></div>
      <div><dt>{t("telegramBindingRequirement")}</dt><dd>{t(telegramBound ? "telegramBoundReady" : "telegramBindingNeeded")}</dd></div>
    </dl>
    {!item.eligible && <p className="reward-eligibility" role="status">{t(`rewardEligibility.${item.eligibilityReason ?? "account_ineligible"}`, { count: remaining })}</p>}
    <div className="reward-card-footer">{item.eligibilityReason === "telegram_binding_required" && !item.participated
      ? <Button asChild><Link to="/settings">{t("bindTelegramToJoin")}</Link></Button>
      : <Button onClick={() => join(item.id)} disabled={disabled}>{expired ? t("participationStopped") : item.status === "drawing" ? t("drawingStatus") : item.status !== "open" ? t("closedStatus") : referralActivity && item.participated ? t("lotteryParticipated") : item.myTickets >= item.maxTicketsPerUser ? t("chanceLimitReached") : t("joinOnce")}</Button>}
    </div>
  </article>;
}

export function RewardsPage() {
  const session = useAtomValue(sessionAtom);
  const { t } = useTranslation();
  const client = useQueryClient();
  const { flags } = useFeatures();
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const points = useQuery({ queryKey: ["points"], queryFn: () => getPoints(session!.token), enabled: Boolean(session) });
  const lottery = useQuery({ queryKey: ["lottery"], queryFn: () => getLottery(session!.token), enabled: Boolean(session) });
  const refresh = () => Promise.all([client.invalidateQueries({ queryKey: ["points"] }), client.invalidateQueries({ queryKey: ["lottery"] }), client.invalidateQueries({ queryKey: ["wallet"] })]);
  const redeem = useMutation({ mutationFn: () => redeemPoints(session!.token, 2), onSuccess: async () => { setNotice({ text: t("pointsRedeemed"), error: false }); await refresh(); }, onError: (error) => setNotice({ text: error instanceof Error ? error.message : t("rewardActionFailed"), error: true }) });
  const checkin = useMutation({ mutationFn: () => checkInPoints(session!.token), onSuccess: async (result) => { setNotice({ text: t("checkinSuccess", { points: result.data.awardedPoints }), error: false }); await refresh(); }, onError: (error) => setNotice({ text: error instanceof Error ? error.message : t("rewardActionFailed"), error: true }) });
  const join = useMutation({ mutationFn: (id: number) => joinLottery(session!.token, id, 1), onSuccess: async (result) => {
    const { current, required, eligibleForDraw } = result.data;
    const remaining = Math.max(0, required - current);
    setNotice({ text: required > 0 ? t(eligibleForDraw ? "lotteryReferralJoinedEligible" : "lotteryReferralJoinedPending", { current, required, count: remaining }) : t("lotteryJoined"), error: false });
    await refresh();
  }, onError: async (error) => { setNotice({ text: error instanceof Error ? error.message : t("rewardActionFailed"), error: !(error instanceof ApiError && error.errorCode === "DIRECT_REFERRALS_REQUIRED") }); await client.invalidateQueries({ queryKey: ["lottery"] }); } });
  if (!session) return <Navigate to="/login" />;
  if (points.isLoading || lottery.isLoading) return <PageShell eyebrow="REWARDS" title={t("rewardsTitle")} description={t("rewardsDesc")}>
    <div aria-busy="true">
      <section className="rewards-hero-grid">
        <article className="finance-balance rewards-balance"><div className="stat-icon"><Sparkles /></div><div><span>{t("availablePoints")}</span><strong><DataSkeleton /></strong><small>{t("pointsBalanceHint")}</small></div>{flags.rewards && <Button disabled>{t("redeemDollar")}</Button>}</article>
        <article className="module-card checkin-card">
          <div className="checkin-heading"><span><CalendarCheck2 /></span><div><small>{t("dailyCheckin")}</small><strong><DataSkeleton /></strong></div></div>
          <div className="checkin-awards"><div><span>{t("todayAward")}</span><strong><DataSkeleton /></strong></div><div><span>{t("tomorrowAward")}</span><strong><DataSkeleton /></strong></div></div>
          <small><DataSkeleton /></small><Button disabled>{t("checkinNow")}</Button>
          <table className="checkin-calendar"><caption><DataSkeleton /></caption><tbody>{[0, 1, 2, 3, 4].map((week) => <tr key={week}>{[0, 1, 2, 3, 4, 5, 6].map((day) => <td key={day}><DataSkeleton /></td>)}</tr>)}</tbody></table>
        </article>
      </section>
      <div className="reward-filter" aria-hidden="true">{["allActivities", "rewardMode.free", "rewardMode.points", "rewardMode.direct_referrals"].map((label, index) => <button type="button" className={index === 0 ? "is-active" : ""} disabled key={label}>{t(label)}</button>)}</div>
      <section className="module-grid rewards-grid">{[0, 1, 2].map((item) => <article className="module-card reward-card" key={item}>
        <div className="reward-card-head"><div className="stat-icon"><Gift /></div><DataSkeleton /></div><div className="reward-card-copy"><h2><DataSkeleton /></h2><p><DataSkeleton /></p></div><strong><DataSkeleton /></strong>
        <dl className="reward-activity-meta">{["participationRequirement", "activityParticipation", "activityStatus", "activityEndTime", "telegramBindingRequirement"].map((label) => <div key={label}><dt>{t(label)}</dt><dd><DataSkeleton /></dd></div>)}</dl>
        <div className="reward-card-footer"><Button disabled>{t("joinOnce")}</Button></div>
      </article>)}</section>
    </div>
  </PageShell>;
  if (!points.data || !lottery.data) return <main className="center error" role="alert">{t("rewardsLoadFailed")}</main>;
  const checkinData = points.data.data.checkin;
  const activities = filter === "all" ? lottery.data.data : lottery.data.data.filter((item) => item.participationMode === filter);
  return <PageShell eyebrow="REWARDS" title={t("rewardsTitle")} description={t("rewardsDesc")}>
    {notice && <p className={`notice ${notice.error ? "error" : ""}`} role={notice.error ? "alert" : "status"}>{notice.text}</p>}
    <section className="rewards-hero-grid">
      <article className="finance-balance rewards-balance">
        <div className="stat-icon"><Sparkles /></div>
        <div><span>{t("availablePoints")}</span><strong>{formatDecimal(points.data.data.balance)}</strong><small>{t("pointsBalanceHint")}</small></div>
        {flags.rewards && <Button onClick={() => { setNotice(null); redeem.mutate(); }} disabled={redeem.isPending}>{t("redeemDollar")}</Button>}
      </article>
      <article className="module-card checkin-card" data-testid="checkin-card">
        <div className="checkin-heading"><span><CalendarCheck2 /></span><div><small>{t("dailyCheckin")}</small><strong>{t("currentStreakDays", { count: checkinData.currentStreak })}</strong></div></div>
        <div className="checkin-awards"><div><span>{t("todayAward")}</span><strong>+{checkinData.todayAward}</strong></div><div><span>{t("tomorrowAward")}</span><strong>+{checkinData.nextAward}</strong></div></div>
        <small>{t("checkinFormula", { base: checkinData.basePoints, bonus: checkinData.streakBonusPerDay, cap: checkinData.streakBonusCapDays })}</small>
        {!checkinData.eligible && <p>{t(`checkinEligibility.${checkinData.eligibilityReason}`)}</p>}
        {checkinData.eligibilityReason === "telegram_binding_required"
          ? <Button asChild><Link to="/settings">{t("bindTelegramFirst")}</Link></Button>
          : <Button onClick={() => { setNotice(null); checkin.mutate(); }} disabled={!flags.rewards || !checkinData.enabled || !checkinData.eligible || checkinData.checkedToday || checkin.isPending}>{checkinData.checkedToday ? t("checkedInToday") : checkinData.enabled ? t("checkinNow") : t("checkinDisabled")}</Button>}
        <CheckinCalendar {...(points.data.data.calendar ?? { month: checkinData.businessDate.slice(0, 7), checkedDates: checkinData.checkedDates })} today={checkinData.businessDate} />
      </article>
    </section>
    <div className="reward-filter" role="group" aria-label={t("activityFilter")}>{(["all", "free", "points", "direct_referrals"] as ActivityFilter[]).map((value) => <button key={value} type="button" className={filter === value ? "is-active" : ""} onClick={() => setFilter(value)} aria-pressed={filter === value}>{value === "all" ? t("allActivities") : t(`rewardMode.${value}`)}</button>)}</div>
    {activities.length === 0 ? <section className="empty-state rewards-empty"><Users /><h2>{t("noActivities")}</h2><p>{t("noActivitiesHint")}</p></section> : <section className="module-grid rewards-grid">{activities.map((item) => <ActivityCard key={item.id} item={item} telegramBound={points.data.data.telegramBound} pending={join.isPending || !flags.rewards} join={(id) => { setNotice(null); join.mutate(id); }} />)}</section>}
  </PageShell>;
}
