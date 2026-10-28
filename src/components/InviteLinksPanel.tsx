import { useState } from "react";
import { Copy, Network } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Referral } from "../api";
import { Button } from "./ui/button";

type InviteLinkKind = "path" | "query" | "bot";

export function InviteLinksPanel({ referral }: { referral: Referral }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState<InviteLinkKind | null>(null);
  const [selectedKind, setSelectedKind] = useState<InviteLinkKind>("path");
  const fallbackQuery = new URL(referral.inviteUrl, window.location.origin).toString();
  const absolute = (value: string) => new URL(value, window.location.origin).toString();
  const links: Array<{ kind: InviteLinkKind; label: string; value: string | null }> = [
    { kind: "path", label: t("inviteLinkPath"), value: absolute(referral.inviteLinks?.path ?? `/invite/${referral.inviteCode}`) },
    { kind: "query", label: t("inviteLinkQuery"), value: absolute(referral.inviteLinks?.query ?? fallbackQuery) },
    { kind: "bot", label: t("inviteLinkBot"), value: referral.inviteLinks?.bot ?? null },
  ];
  const selected = links.find((link) => link.kind === selectedKind)!;

  return <section className="invite-link-panel" data-testid="referral-link">
    <div className="section-title"><h2><Network />{t("inviteLink")}</h2><span>{t("inviteCode")}: {referral.inviteCode}</span></div>
    <div className="invite-link-switch" role="group" aria-label={t("inviteLink")} data-selected={selectedKind}>
      {links.map(({ kind, label }) => <button type="button" aria-pressed={selectedKind === kind} onClick={() => setSelectedKind(kind)} key={kind}>{label}</button>)}
    </div>
    <div className="invite-link-list">
      <article className="referral-hero" data-testid={`referral-link-${selected.kind}`} key={selected.kind}>
        <div><span>{selected.label}</span><strong className="referral-link-value">{selected.value ?? t("inviteLinkUnavailable")}</strong></div>
        <Button variant="outline" disabled={!selected.value} aria-label={t("copyInviteLinkKind", { kind: selected.label })} onClick={async () => {
          if (!selected.value) return;
          await navigator.clipboard.writeText(selected.value);
          setCopied(selected.kind);
          window.setTimeout(() => setCopied((current) => current === selected.kind ? null : current), 1500);
        }}><Copy />{copied === selected.kind ? t("copied") : t("copyInviteLink")}</Button>
      </article>
    </div>
    <span className="sr-only" aria-live="polite">{copied ? t("copied") : ""}</span>
  </section>;
}
