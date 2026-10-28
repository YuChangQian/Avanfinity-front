import { useAtomValue } from "jotai";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate } from "@tanstack/react-router";
import { Network } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataSkeleton, PageShell } from "../components/PageShell";
import { getAgent, updateAgentRate } from "../api";
import { sessionAtom } from "../state";
import { useTranslation } from "react-i18next";
import { useFeatures } from "../features";

export function AgentPage() {
  const session = useAtomValue(sessionAtom);
  const { t } = useTranslation();
  const client = useQueryClient();
  const { flags } = useFeatures();
  const query = useQuery({ queryKey: ["agent"], queryFn: () => getAgent(session!.token), enabled: Boolean(session), retry: false });
  const update = useMutation({ mutationFn: (input: { id: number; customer: string; cost: string }) => updateAgentRate(session!.token, input.id, input.customer, input.cost), onSuccess: () => client.invalidateQueries({ queryKey: ["agent"] }) });
  if (!session) return <Navigate to="/login" />;
  if (query.isError) return <Navigate to="/dashboard" />;
  if (!query.data) return <PageShell eyebrow="AGENT" title={t("agentTitle")} description={t("agentDesc")}>
    <section className="transaction-panel" aria-busy="true">{[0, 1, 2].map((item) => <form className="transaction-row" key={item}><div className="transaction-icon"><Network /></div><div><strong><DataSkeleton /></strong><label>{t("cost")}<input disabled /></label><label>{t("customer")}<input disabled /></label></div><div><span className="positive"><DataSkeleton /></span>{flags.agent && <Button size="xs" disabled>{t("save")}</Button>}</div></form>)}</section>
  </PageShell>;
  return <PageShell eyebrow="AGENT" title={t("agentTitle")} description={t("agentDesc")}>
    {!flags.agent && <p className="admin-alert" role="status">{t("featureUnavailable")}</p>}
    {!query.data.data.pricingEffective && <p className="admin-alert" role="status">{t("agentPricingPaused")}</p>}
    {update.isError && <p className="error" role="alert">{update.error instanceof Error ? update.error.message : t("updateFailed")}</p>}
    <section className="transaction-panel">{query.data.data.subUsers.length === 0 ? <div className="empty-state">{t("noSubUsers")}</div> : query.data.data.subUsers.map((user) => <form className="transaction-row" key={user.id} onSubmit={(event) => { event.preventDefault(); if (!flags.agent) return; const data = new FormData(event.currentTarget); update.mutate({ id: user.id, cost: String(data.get("cost")), customer: String(data.get("customer")) }); }}><div className="transaction-icon"><Network /></div><div><strong>{user.email ?? `#${user.id}`}</strong><label>{t("cost")}<input name="cost" inputMode="decimal" defaultValue={user.agentRechargeRate} readOnly={!flags.agent} required /></label><label>{t("customer")}<input name="customer" inputMode="decimal" defaultValue={user.subRechargeRate} readOnly={!flags.agent} required /></label></div><div><span className="positive">spread {user.spreadRate}</span>{flags.agent && <Button size="xs">{t("save")}</Button>}</div></form>)}</section>
  </PageShell>;
}
