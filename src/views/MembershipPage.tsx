import { formatDecimal, formatRateAsPercent } from "../decimal";
import { useAtomValue } from "jotai";
import { useQuery } from "@tanstack/react-query";
import { Navigate } from "@tanstack/react-router";
import { Check, Crown, Sparkles, TrendingUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { DataSkeleton, PageShell } from "../components/PageShell";
import { getMembership, type MembershipTier } from "../api";
import { sessionAtom, sessionIdentity } from "../state";

function number(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rate(value: string) {
  return formatRateAsPercent(value ?? "");
}

function tierName(tier: MembershipTier, language: string) {
  return language === "en" ? tier.nameEn : tier.nameZh;
}

function tierDescription(tier: MembershipTier, language: string) {
  return language === "en" ? tier.descriptionEn : tier.descriptionZh;
}

export function MembershipPage() {
  const session = useAtomValue(sessionAtom);
  const { t, i18n } = useTranslation();
  const query = useQuery({
    queryKey: ["membership", sessionIdentity(session)],
    queryFn: () => getMembership(session!.token),
    enabled: Boolean(session),
  });

  if (!session) return <Navigate to="/login" />;
  if (query.isError) return <PageShell eyebrow="MEMBERSHIP" title={t("membershipTitle")} description={t("membershipDesc")}>
    <section className="deposit-panel query-error" role="alert">
      <strong>{t("membershipLoadFailed")}</strong>
      <Button variant="outline" onClick={() => void query.refetch()}>{t("retry")}</Button>
    </section>
  </PageShell>;
  if (!query.data) return <PageShell eyebrow="MEMBERSHIP" title={t("membershipTitle")} description={t("membershipDesc")} className="membership-page">
    <div aria-busy="true">
      <section className="membership-hero"><span className="membership-emblem"><Crown /></span><div><span>{t("currentMembership")}</span><h2><DataSkeleton /></h2><p><DataSkeleton /></p></div><dl><div><dt>{t("cumulativeRecharge")}</dt><dd>$<DataSkeleton /></dd></div><div><dt>{t("membershipTierThreshold")}</dt><dd>$<DataSkeleton /></dd></div></dl></section>
      <section className="membership-progress-panel"><div className="section-title"><h2><TrendingUp /><DataSkeleton /></h2><DataSkeleton /></div><progress value="35" max="100" aria-label={t("membershipProgress")} /><div className="membership-progress-labels"><DataSkeleton /><DataSkeleton /></div></section>
      <section className="membership-levels"><div className="section-title"><h2><Sparkles />{t("allMemberships")}</h2><span>{t("membershipRulesHint")}</span></div><div className="membership-tier-list">{[0, 1, 2].map((item) => <article key={item}><div className="membership-tier-heading"><span><Crown /></span><div><small><DataSkeleton /></small><h3><DataSkeleton /></h3></div><b className="status-pill"><DataSkeleton /></b></div><p><DataSkeleton /></p><ul>{[0, 1, 2, 3, 4].map((benefit) => <li key={benefit}><Check /><DataSkeleton /></li>)}</ul></article>)}</div></section>
    </div>
  </PageShell>;

  const { currentTier, cumulativeRecharge, nextTier, tiers } = query.data.data;
  const cumulative = number(cumulativeRecharge);
  const currentThreshold = number(currentTier.thresholdAmount);
  const nextThreshold = nextTier ? number(nextTier.thresholdAmount) : currentThreshold;
  const range = nextThreshold - currentThreshold;
  const progress = nextTier && range > 0 ? Math.min(100, Math.max(0, (cumulative - currentThreshold) / range * 100)) : 100;
  const amountNeeded = Math.max(0, nextThreshold - cumulative);
  const currentTierIndex = tiers.findIndex((tier) => tier.code === currentTier.code);

  return <PageShell eyebrow="MEMBERSHIP" title={t("membershipTitle")} description={t("membershipDesc")} className="membership-page">
    <section className="membership-hero">
      <span className="membership-emblem"><Crown /></span>
      <div>
        <span>{t("currentMembership")}</span>
        <h2>{tierName(currentTier, i18n.language)}</h2>
        <p>{tierDescription(currentTier, i18n.language)}</p>
      </div>
      <dl>
        <div><dt>{t("cumulativeRecharge")}</dt><dd>${formatDecimal(cumulativeRecharge)}</dd></div>
        <div><dt>{t("membershipTierThreshold")}</dt><dd>${formatDecimal(currentTier.thresholdAmount)}</dd></div>
      </dl>
    </section>

    <section className="membership-progress-panel">
      <div className="section-title">
        <h2><TrendingUp />{nextTier ? t("nextMembership", { name: tierName(nextTier, i18n.language) }) : t("highestMembership")}</h2>
        <span>{nextTier ? t("membershipAmountNeeded", { amount: formatDecimal(amountNeeded.toFixed(4)) }) : t("highestMembershipReached")}</span>
      </div>
      <progress value={progress} max="100" aria-label={t("membershipProgress")} />
      <div className="membership-progress-labels"><span>${formatDecimal(cumulativeRecharge)}</span><span>{nextTier ? `$${formatDecimal(nextTier.thresholdAmount)}` : "100%"}</span></div>
    </section>

    <section className="membership-levels" aria-labelledby="membership-levels-title">
      <div className="section-title"><h2 id="membership-levels-title"><Sparkles />{t("allMemberships")}</h2><span>{t("membershipRulesHint")}</span></div>
      <div className="membership-tier-list">{tiers.map((tier, index) => {
        const isCurrent = tier.code === currentTier.code;
        const unlocked = index <= currentTierIndex || cumulative >= number(tier.thresholdAmount);
        return <article key={tier.code} className={isCurrent ? "is-current" : ""} data-testid={`membership-tier-${tier.code}`}>
          <div className="membership-tier-heading">
            <span><Crown /></span>
            <div><small>{t("rechargeThreshold", { amount: formatDecimal(tier.thresholdAmount) })}</small><h3>{tierName(tier, i18n.language)}</h3></div>
            <b className={`status-pill ${isCurrent || unlocked ? "is-active" : ""}`}>{isCurrent ? t("current") : unlocked ? t("unlocked") : t("locked")}</b>
          </div>
          <p>{tierDescription(tier, i18n.language)}</p>
          <ul>
            <li><Check /><span>{t("membershipOpenBenefit", { minimum: formatDecimal(tier.minimumOpenFee) })}</span></li>
            <li><Check /><span>{t("membershipRechargeBenefit", { minimum: rate(tier.minimumRechargeRate) })}</span></li>
            <li><Check /><span>{t("membershipRefundBenefit")}</span></li>
            <li><Check /><span>{t("membershipDeclineFeeBenefit", { amount: formatDecimal(tier.declineFee) })}</span></li>
            <li><Check /><span>{t("membershipGptBenefit", { minimum: formatDecimal(tier.gptDirectMinimumFee) })}</span></li>
          </ul>
        </article>;
      })}</div>
    </section>
  </PageShell>;
}
