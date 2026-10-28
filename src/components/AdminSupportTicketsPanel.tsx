import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LifeBuoy, Search, Send } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  getAdminSupportTicket,
  getAdminSupportTickets,
  replyAdminSupportTicket,
  updateAdminSupportTicketStatus,
  type SupportTicketStatus,
} from "../api";

const statuses: Array<"" | SupportTicketStatus> = ["", "open", "in_progress", "resolved", "closed"];

export function AdminSupportTicketsPanel({ token }: { token: string }) {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const [status, setStatus] = useState<"" | SupportTicketStatus>("");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [reply, setReply] = useState("");
  const locale = i18n.language === "en" ? "en-US" : "zh-CN";
  const tickets = useQuery({
    queryKey: ["admin-support-tickets", status, search],
    queryFn: () => getAdminSupportTickets(token, status, search),
  });
  const selectedList = tickets.data?.data ?? [];
  const activeId = selectedList.some((item) => item.id === selectedId)
    ? selectedId
    : selectedList[0]?.id ?? null;
  const detail = useQuery({
    queryKey: ["admin-support-ticket", activeId],
    queryFn: () => getAdminSupportTicket(token, activeId!),
    enabled: activeId !== null,
  });
  useEffect(() => {
    if (!detail.data || !activeId) return;
    client.setQueriesData<{ code: number; data: Array<{ id: number; unreadCount: number }> }>({ queryKey: ["admin-support-tickets"] }, (current) => current ? ({ ...current, data: current.data.map((ticket) => ticket.id === activeId ? { ...ticket, unreadCount: 0 } : ticket) }) : current);
  }, [activeId, client, detail.data]);
  const refresh = async (data: Awaited<ReturnType<typeof getAdminSupportTicket>>["data"]) => {
    client.setQueryData(["admin-support-ticket", data.ticket.id], { code: 0, data });
    await client.invalidateQueries({ queryKey: ["admin-support-tickets"] });
  };
  const sendReply = useMutation({
    mutationFn: () => replyAdminSupportTicket(token, activeId!, reply),
    onSuccess: async ({ data }) => { setReply(""); await refresh(data); },
  });
  const updateStatus = useMutation({
    mutationFn: (next: SupportTicketStatus) => updateAdminSupportTicketStatus(token, activeId!, next),
    onSuccess: async ({ data }) => refresh(data),
  });
  const selected = detail.data?.data;

  return <div className="admin-panel-stack" data-testid="admin-panel-support">
    <div className="admin-panel-heading"><div><span className="admin-kicker">SUPPORT</span><h2>{t("adminSupportTickets")}</h2><p>{t("adminSupportTicketsDesc")}</p></div></div>
    <section className="admin-surface support-admin-filters">
      <div className="support-status-filters">{statuses.map((value) => <Button key={value || "all"} size="sm" variant={status === value ? "default" : "outline"} onClick={() => setStatus(value)}>{value ? t(`supportStatus.${value}`) : t("allSupportTickets")}</Button>)}</div>
      <form onSubmit={(event) => { event.preventDefault(); setSearch(query.trim()); }}><input value={query} onChange={(event) => setQuery(event.target.value)} maxLength={120} placeholder={t("searchSupportTickets")} /><Button type="submit" variant="outline"><Search />{t("search")}</Button></form>
    </section>
    <section className="support-workspace is-admin">
      <aside className="support-ticket-list">
        <div className="section-title"><h2><LifeBuoy />{t("supportQueue")}</h2><span>{tickets.data?.data.length ?? 0}</span></div>
        {tickets.isLoading && <div className="empty-state loading-skeleton loading-skeleton-block" aria-label={t("loading")}>{t("loading")}</div>}
        {tickets.isError && <div className="empty-state query-error" role="alert">{t("supportLoadFailed")}</div>}
        {tickets.data?.data.length === 0 && <div className="empty-state">{t("noSupportTickets")}</div>}
        {tickets.data?.data.map((ticket) => <button type="button" className="support-ticket-row" aria-current={activeId === ticket.id ? "true" : undefined} key={ticket.id} onClick={() => setSelectedId(ticket.id)}>
          <span><strong>{ticket.subject}</strong><small>#{ticket.id} · {t(`supportCategory.${ticket.category}`)} · {ticket.email ?? `#${ticket.userId}`} · {new Date(ticket.lastMessageAt).toLocaleString(locale)}</small></span>
          <span className="support-ticket-row-status"><span className={`status-pill support-status-${ticket.status}`}>{t(`supportStatus.${ticket.status}`)}</span>{ticket.unreadCount > 0 && <b className="sidebar-badge">{ticket.unreadCount > 99 ? "99+" : ticket.unreadCount}</b>}</span>
        </button>)}
      </aside>
      <article className="support-thread">
        {!activeId && <div className="empty-state">{t("selectSupportTicket")}</div>}
        {detail.isLoading && <div className="empty-state loading-skeleton loading-skeleton-block" aria-label={t("loading")}>{t("loading")}</div>}
        {detail.isError && <div className="empty-state query-error" role="alert">{t("supportLoadFailed")}</div>}
        {selected && <>
          <header className="support-thread-header"><div><small>#{selected.ticket.id} · {t(`supportCategory.${selected.ticket.category}`)} · {selected.ticket.email ?? `#${selected.ticket.userId}`}{selected.ticket.cardNumberMasked ? ` · ${selected.ticket.cardNumberMasked}` : ""}</small><h2>{selected.ticket.subject}</h2></div><Select value={selected.ticket.status} onValueChange={(value) => updateStatus.mutate(value as SupportTicketStatus)} disabled={updateStatus.isPending}>
            <SelectTrigger className="support-status-trigger" aria-label={t("supportStatusLabel")}><SelectValue /></SelectTrigger>
            <SelectContent>{statuses.slice(1).map((value) => <SelectItem value={value} key={value}>{t(`supportStatus.${value}`)}</SelectItem>)}</SelectContent>
          </Select></header>
          <div className="support-messages">{selected.messages.map((item) => <div className={`support-message is-${item.senderRole}`} key={item.id}>
            <div><strong>{item.senderRole === "admin" ? t("supportTeam") : selected.ticket.email ?? t("customer")}</strong><time>{new Date(item.createdAt).toLocaleString(locale)}</time></div>
            <p>{item.body}</p>
          </div>)}</div>
          {selected.ticket.status === "closed" ? <p className="support-closed-notice">{t("supportTicketClosedAdmin")}</p> : <form className="support-reply-form" onSubmit={(event) => { event.preventDefault(); sendReply.mutate(); }}>
            <label>{t("supportAdminReply")}<textarea value={reply} onChange={(event) => setReply(event.target.value)} maxLength={5000} rows={3} required /></label>
            <Button type="submit" disabled={sendReply.isPending}><Send />{sendReply.isPending ? t("processing") : t("sendReply")}</Button>
            {sendReply.isError && <p className="error" role="alert">{sendReply.error instanceof Error ? sendReply.error.message : t("supportActionFailed")}</p>}
          </form>}
        </>}
      </article>
    </section>
  </div>;
}
