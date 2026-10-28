import { useState } from "react";
import { useAtomValue } from "jotai";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate } from "@tanstack/react-router";
import { CircleDollarSign, Network, ReceiptText, ShieldCheck, UserRound, WalletCards } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataSkeleton, PageShell } from "../components/PageShell";
import { InviteLinksPanel } from "../components/InviteLinksPanel";
import { getReferral, withdrawPromo, type ReferralEstimateRange } from "../api";
import { formatDecimal, formatRateAsPercent } from "../decimal";
import { sessionAtom } from "../state";
import { useTranslation } from "react-i18next";

function formatEstimate(range: ReferralEstimateRange | null, rate = false) {
  if (!range) return null;
  const min = rate ? formatRateAsPercent(range.min) : `$${formatDecimal(range.min)}`;
  const max = rate ? formatRateAsPercent(range.max) : `$${formatDecimal(range.max)}`;
  return range.min === range.max ? min : `${min}–${max}`;
}

export function ReferralPage() {
  const session = useAtomValue(sessionAtom);
  const { t, i18n } = useTranslation();
  const [actionError, setActionError] = useState("");
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["referral"], queryFn: () => getReferral(session!.token), enabled: Boolean(session) });
  const withdraw = useMutation({
    mutationFn: () => withdrawPromo(session!.token),
    onSuccess: async () => {
      setActionError("");
      await Promise.all([client.invalidateQueries({ queryKey: ["referral"] }), client.invalidateQueries({ queryKey: ["dashboard"] })]);
    },
    onError: (cause) => setActionError(cause instanceof Error ? cause.message : t("referralActionFailed")),
  });
  if (!session) return <Navigate to="/login" />;
  if (query.isError) return <PageShell eyebrow="AGENT" title={t("referralTitle")} description={t("referralDesc")}>
    <section className="deposit-panel query-error" role="alert">
      <strong>{t("referralLoadFailed")}</strong>
      <Button variant="outline" onClick={() => void query.refetch()}>{t("retry")}</Button>
    </section>
  </PageShell>;
  if (!query.data) return <PageShell eyebrow="AGENT" title={t("referralTitle")} description={t("referralDesc")} className="referral-page">
    <div aria-busy="true">
      <section className="stats compact-stats referral-stats">{[[Network, "referrals"], [CircleDollarSign, "earnings"], [WalletCards, "promoBalance"]].map(([Icon, label]) => <article key={label as string}><Icon /><span>{t(label as string)}</span><strong><DataSkeleton /></strong></article>)}</section>
      <p className="referral-balance-note">{t("promoBalanceUsageHint")}</p>
      <section className="invite-link-panel"><div className="section-title"><h2><Network />{t("inviteLink")}</h2><span>{t("inviteCode")}: <DataSkeleton /></span></div><div className="invite-link-switch"><button type="button" className="is-active" disabled>{t("inviteLinkPath")}</button><button type="button" disabled>{t("inviteLinkQuery")}</button><button type="button" disabled>{t("inviteLinkBot")}</button></div><div className="invite-link-list"><article className="referral-hero"><div><span>{t("inviteLinkPath")}</span><strong className="referral-link-value"><DataSkeleton /></strong></div><Button variant="outline" disabled>{t("copyInviteLink")}</Button></article></div></section>
      <section className="referral-tier-overview"><div className="section-title"><h2><Network />{t("referralTierOverview")}</h2><DataSkeleton /></div><div className="referral-tier-count-grid">{[0, 1, 2].map((item) => <div key={item}><span><DataSkeleton /></span><strong><DataSkeleton /></strong></div>)}</div></section>
      <section className="transaction-panel referral-directs"><div className="section-title"><h2><UserRound />{t("directReferralContributions")}</h2><DataSkeleton /></div><div className="referral-direct-list">{[0, 1].map((item) => <article className="referral-direct-row" key={item}><div className="referral-direct-identity"><span><UserRound /></span><div><strong><DataSkeleton /></strong><small><DataSkeleton /></small></div></div><dl>{["referralContributionTotal", "referralContributionOpen", "referralContributionRecharge"].map((label) => <div key={label}><dt>{t(label)}</dt><dd><DataSkeleton /></dd></div>)}</dl></article>)}</div></section>
      <section className="referral-policy-panel"><div className="section-title"><h2><ShieldCheck />{t("referralRewardRules")}</h2><DataSkeleton /></div><div className="referral-policy-summary"><span>{t("referralPolicyHeadline")}</span><strong><DataSkeleton /></strong><p><DataSkeleton /></p></div></section>
      <section className="transaction-panel referral-transactions"><div className="section-title"><h2><ReceiptText />{t("referralRewardHistory")}</h2><DataSkeleton /></div>{[0, 1, 2].map((item) => <article className="transaction-row" key={item}><div className="transaction-icon"><CircleDollarSign /></div><div><strong><DataSkeleton /></strong><small><DataSkeleton /></small></div><span><DataSkeleton /></span></article>)}</section>
    </div>
  </PageShell>;
  const data = query.data.data;
  const directReferrals = data.directReferrals ?? { total: data.referralCount, limit: 0, list: [] };
  const locale = i18n.language === "en" ? "en-US" : "zh-CN";
  return <PageShell eyebrow="AGENT" title={t("referralTitle")} description={t("referralDesc")} className="referral-page">
    <section className="stats compact-stats referral-stats" data-testid="referral-overview">
      <article><Network /><span>{t("referrals")}</span><strong>{data.referralCount}</strong></article>
      <article><CircleDollarSign /><span>{t("earnings")}</span><strong>${formatDecimal(data.cumulativeEarnings)}</strong></article>
      <article><WalletCards /><span>{t("promoBalance")}</span><strong>${formatDecimal(data.promoBalance)}</strong>{Number(data.promoBalance) > 0 && <Button size="sm" onClick={() => withdraw.mutate()} disabled={withdraw.isPending}>{withdraw.isPending ? t("processing") : t("withdrawPromo")}</Button>}</article>
    </section>
    <p className="referral-balance-note">{t("promoBalanceUsageHint")}</p>

    <InviteLinksPanel referral={data} />
    {actionError && <p className="admin-alert is-error" role="alert">{actionError}</p>}

    <section className="referral-tier-overview" data-testid="referral-tier-overview">
      <div className="section-title"><h2><Network />{t("referralTierOverview")}</h2><span>{t("records", { count: data.referralCount })}</span></div>
      <div className="referral-tier-count-grid">
        {data.policy.tierRewards.map((tier) => <div key={tier.code} data-testid={`referral-tier-count-${tier.code}`}>
          <span>{i18n.language === "en" ? tier.nameEn : tier.nameZh}</span>
          <strong>{t("referralTierCountValue", { count: tier.referralCount ?? 0 })}</strong>
        </div>)}
      </div>
      {data.policy.tierRewards.length === 0 && <div className="empty-state">{t("noTierReferralRewards")}</div>}
    </section>

    <section className="transaction-panel referral-directs" data-testid="referral-directs">
      <div className="section-title"><h2><UserRound />{t("directReferralContributions")}</h2><span>{t("records", { count: directReferrals.total })}</span></div>
      {directReferrals.list.length === 0 ? <div className="empty-state">{t("noDirectReferrals")}</div> : <div className="referral-direct-list">
        {directReferrals.list.map((item) => <article className="referral-direct-row" data-testid={`referral-direct-${item.id}`} key={item.id}>
          <div className="referral-direct-identity"><span><UserRound /></span><div>
            <strong>{item.maskedEmail ?? item.displayName ?? `#${item.id}`}</strong>
            <small>{i18n.language === "en" ? item.tierNameEn : item.tierNameZh} · {t("referralJoinedAt", { date: new Date(item.createdAt).toLocaleDateString(locale) })}</small>
          </div></div>
          <dl>
            <div><dt>{t("referralContributionTotal")}</dt><dd>${formatDecimal(item.earned)}</dd></div>
            <div><dt>{t("referralContributionOpen")}</dt><dd>${formatDecimal(item.openCardEarned)}</dd></div>
            <div><dt>{t("referralContributionRecharge")}</dt><dd>${formatDecimal(item.rechargeEarned)}</dd></div>
          </dl>
        </article>)}
      </div>}
    </section>

    <section className="referral-policy-panel" data-testid="referral-policy">
      <div className="section-title"><h2><ShieldCheck />{t("referralRewardRules")}</h2><span>{data.policy.directOnly ? t("directReferralOnly") : ""}</span></div>
      <div className="referral-policy-summary" data-testid="referral-policy-summary">
        <span>{t("referralPolicyHeadline")}</span><strong>{formatRateAsPercent(data.policy.profitShareRate)}</strong>
        <p>{t("referralProfitShareIntro", { rate: formatRateAsPercent(data.policy.profitShareRate) })}</p>
      </div>
      {data.policy.displayMode === "equivalent" && <div className="referral-policy-grid">
        {data.policy.tierRewards.map((tier) => <div key={tier.code} data-testid={`referral-tier-${tier.code}`}>
          <span>{i18n.language === "en" ? tier.nameEn : tier.nameZh}</span>
          <strong>{t("referralOpeningEstimate", { value: formatEstimate(tier.openingBaseReward) ?? t("referralEstimateUsesShare", { rate: formatRateAsPercent(data.policy.profitShareRate) }) })}</strong>
          <small>{t("referralRechargeEstimate", { value: formatEstimate(tier.rechargeRewardRate, true) ?? t("referralEstimateUsesShare", { rate: formatRateAsPercent(data.policy.profitShareRate) }) })}</small>
        </div>)}
      </div>}
      {data.policy.displayMode === "equivalent" && data.policy.tierRewards.length === 0 && <div className="empty-state">{t("referralEstimateUsesShare", { rate: formatRateAsPercent(data.policy.profitShareRate) })}</div>}
      <p className="referral-policy-note">{t("referralSettlementHint")}</p>
      {data.policy.directOnly && <p className="referral-policy-note is-muted">{t("directReferralOnlyHint")}</p>}
    </section>

    <section className="transaction-panel referral-transactions" data-testid="referral-transactions">
      <div className="section-title"><h2><ReceiptText />{t("referralRewardHistory")}</h2><span>{t("records", { count: data.txList.length })}</span></div>
      {data.txList.length === 0 ? <div className="empty-state">{t("noReferralRewards")}</div> : data.txList.map((item) => <article className="transaction-row" key={item.id}>
        <div className="transaction-icon"><CircleDollarSign /></div>
        <div>
          <strong>{item.remark ?? t(`promoTransaction.${item.type}`, { defaultValue: item.type })}</strong>
          <small>{new Date(item.createdAt).toLocaleString(locale)}{item.refUserEmail ? ` · ${item.refUserEmail}` : item.refUserId === null ? "" : ` · ${t("referredUserNumber", { id: item.refUserId })}`}</small>
          <small>{t("promoBalanceMovement", { before: item.balanceBefore, after: item.balanceAfter })}</small>
        </div>
        <span className={Number(item.amount) >= 0 ? "positive" : "negative"}>{Number(item.amount) >= 0 ? "+" : ""}${formatDecimal(item.amount)}</span>
      </article>)}
    </section>
  </PageShell>;
}
