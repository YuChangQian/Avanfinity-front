import { useEffect, useState } from "react";
import { useAtomValue } from "jotai";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate } from "@tanstack/react-router";
import { LifeBuoy, MessageSquarePlus, Send } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { StableSwap } from "../components/StableSwap";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataSkeleton, PageShell } from "../components/PageShell";
import { createSupportTicket, getCards, getSupportTicket, getSupportTickets, replySupportTicket, type SupportTicket, type SupportTicketCategory } from "../api";
import { sessionAtom } from "../state";

export function SupportTicketsPage() {
  const session = useAtomValue(sessionAtom);
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [category, setCategory] = useState<SupportTicketCategory>("other");
  const [cardId, setCardId] = useState("");
  const [reply, setReply] = useState("");
  const locale = i18n.language === "en" ? "en-US" : "zh-CN";
  const tickets = useQuery({
    queryKey: ["support-tickets"],
    queryFn: () => getSupportTickets(session!.token),
    enabled: Boolean(session),
  });
  const cards = useQuery({ queryKey: ["cards"], queryFn: () => getCards(session!.token), enabled: Boolean(session) });
  const activeId = selectedId ?? tickets.data?.data[0]?.id ?? null;
  const detail = useQuery({
    queryKey: ["support-ticket", activeId],
    queryFn: () => getSupportTicket(session!.token, activeId!),
    enabled: Boolean(session && activeId),
  });
  const createTicket = useMutation({
    mutationFn: () => createSupportTicket(session!.token, subject, message, category, cardId ? Number(cardId) : null),
    onSuccess: async ({ data }) => {
      setSubject("");
      setMessage("");
      setCategory("other");
      setCardId("");
      setSelectedId(data.ticket.id);
      client.setQueryData(["support-ticket", data.ticket.id], { code: 0, data });
      await client.invalidateQueries({ queryKey: ["support-tickets"] });
    },
  });
  useEffect(() => {
    if (!detail.data || !activeId) return;
    client.setQueryData<{ code: number; data: SupportTicket[] }>(["support-tickets"], (current) => current ? ({ ...current, data: current.data.map((ticket) => ticket.id === activeId ? { ...ticket, unreadCount: 0 } : ticket) }) : current);
  }, [activeId, client, detail.data]);
  const sendReply = useMutation({
    mutationFn: () => replySupportTicket(session!.token, activeId!, reply),
    onSuccess: async ({ data }) => {
      setReply("");
      client.setQueryData(["support-ticket", activeId], { code: 0, data });
      await client.invalidateQueries({ queryKey: ["support-tickets"] });
    },
  });
  if (!session) return <Navigate to="/login" />;
  const selected = detail.data?.data;

  return <PageShell eyebrow="SUPPORT" title={t("supportTickets")} description={t("supportTicketsDesc")} className="support-page">
    <section className="transaction-panel support-create-panel">
      <div className="section-title"><div><h2><MessageSquarePlus />{t("createSupportTicket")}</h2><p>{t("createSupportTicketHint")}</p></div></div>
      <form className="support-create-form" onSubmit={(event) => { event.preventDefault(); createTicket.mutate(); }}>
        <label>{t("supportCategoryLabel")}<Select value={category} onValueChange={(value) => setCategory(value as SupportTicketCategory)}>
          <SelectTrigger aria-label={t("supportCategoryLabel")}><SelectValue /></SelectTrigger>
          <SelectContent>{["card", "card_payment", "card_recharge", "gpt_direct", "wallet_transfer", "account", "other"].map((value) => <SelectItem value={value} key={value}>{t(`supportCategory.${value}`)}</SelectItem>)}</SelectContent>
        </Select></label>
        <label>{t("supportRelatedCard")}<Select value={cardId || "none"} onValueChange={(value) => setCardId(value === "none" ? "" : value)}>
          <SelectTrigger aria-label={t("supportRelatedCard")}><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="none">{t("supportNoRelatedCard")}</SelectItem>{cards.data?.data.list.map((card) => <SelectItem value={String(card.id)} key={card.id}>{card.cardNumberMasked} · {card.productCode}</SelectItem>)}</SelectContent>
        </Select></label>
        <label>{t("supportSubject")}<input value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={120} required /></label>
        <label>{t("supportProblemDescription")}<textarea value={message} onChange={(event) => setMessage(event.target.value)} maxLength={5000} rows={4} required /></label>
        <Button type="submit" disabled={createTicket.isPending}><StableSwap state={createTicket.isPending ? "busy" : "idle"} labels={{ idle: t("submitSupportTicket"), busy: t("processing") }} /></Button>
        {createTicket.isError && <p className="error" role="alert">{createTicket.error instanceof Error ? createTicket.error.message : t("supportActionFailed")}</p>}
      </form>
    </section>

    <section className="support-workspace">
      <aside className="support-ticket-list" aria-label={t("mySupportTickets")}>
        <div className="section-title"><h2><LifeBuoy />{t("mySupportTickets")}</h2><span>{tickets.isLoading ? <DataSkeleton /> : tickets.data?.data.length ?? 0}</span></div>
        {tickets.isLoading && <div aria-busy="true">{[0, 1, 2].map((item) => <button type="button" className="support-ticket-row" disabled key={item}><span><strong><DataSkeleton /></strong><small><DataSkeleton /></small></span><DataSkeleton /></button>)}</div>}
        {tickets.isError && <div className="empty-state query-error" role="alert"><span>{t("supportLoadFailed")}</span><Button size="sm" variant="outline" onClick={() => void tickets.refetch()}>{t("retry")}</Button></div>}
        {tickets.data?.data.length === 0 && <div className="empty-state">{t("noSupportTickets")}</div>}
        {tickets.data?.data.map((ticket) => <button type="button" className="support-ticket-row" aria-current={activeId === ticket.id ? "true" : undefined} key={ticket.id} onClick={() => setSelectedId(ticket.id)}>
          <span><strong>{ticket.subject}</strong><small>#{ticket.id} · {t(`supportCategory.${ticket.category}`)} · {new Date(ticket.lastMessageAt).toLocaleString(locale)}</small></span>
          <span className="support-ticket-row-status"><span className={`status-pill support-status-${ticket.status}`}>{t(`supportStatus.${ticket.status}`)}</span>{ticket.unreadCount > 0 && <b className="sidebar-badge">{ticket.unreadCount > 99 ? "99+" : ticket.unreadCount}</b>}</span>
        </button>)}
      </aside>

      <article className="support-thread">
        {!activeId && <div className="empty-state">{t("selectSupportTicket")}</div>}
        {detail.isLoading && <div aria-busy="true"><header className="support-thread-header"><div><small><DataSkeleton /></small><h2><DataSkeleton /></h2></div><DataSkeleton /></header><div className="support-messages">{[0, 1, 2].map((item) => <div className={`support-message ${item % 2 ? "is-user" : "is-admin"}`} key={item}><div><strong><DataSkeleton /></strong><time><DataSkeleton /></time></div><p><DataSkeleton /></p></div>)}</div><form className="support-reply-form"><label>{t("supportReply")}<textarea rows={3} disabled /></label><Button disabled><Send />{t("sendReply")}</Button></form></div>}
        {detail.isError && <div className="empty-state query-error" role="alert"><span>{t("supportLoadFailed")}</span><Button size="sm" variant="outline" onClick={() => void detail.refetch()}>{t("retry")}</Button></div>}
        {selected && <>
          <header className="support-thread-header"><div><small>#{selected.ticket.id} · {t(`supportCategory.${selected.ticket.category}`)}{selected.ticket.cardNumberMasked ? ` · ${selected.ticket.cardNumberMasked}` : ""}</small><h2>{selected.ticket.subject}</h2></div><span className={`status-pill support-status-${selected.ticket.status}`}>{t(`supportStatus.${selected.ticket.status}`)}</span></header>
          <div className="support-messages">{selected.messages.map((item) => <div className={`support-message is-${item.senderRole}`} key={item.id}>
            <div><strong>{item.senderRole === "admin" ? t("supportTeam") : t("me")}</strong><time>{new Date(item.createdAt).toLocaleString(locale)}</time></div>
            <p>{item.body}</p>
          </div>)}</div>
          {selected.ticket.status === "closed" ? <p className="support-closed-notice">{t("supportTicketClosed")}</p> : <form className="support-reply-form" onSubmit={(event) => { event.preventDefault(); sendReply.mutate(); }}>
            <label>{t("supportReply")}<textarea value={reply} onChange={(event) => setReply(event.target.value)} maxLength={5000} rows={3} required /></label>
            <Button type="submit" disabled={sendReply.isPending}><Send /><StableSwap state={sendReply.isPending ? "busy" : "idle"} labels={{ idle: t("sendReply"), busy: t("processing") }} /></Button>
            {selected.ticket.status === "resolved" && <small>{t("supportReplyReopens")}</small>}
            {sendReply.isError && <p className="error" role="alert">{sendReply.error instanceof Error ? sendReply.error.message : t("supportActionFailed")}</p>}
          </form>}
        </>}
      </article>
    </section>
  </PageShell>;
}
