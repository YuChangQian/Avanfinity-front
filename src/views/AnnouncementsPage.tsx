import { useState } from "react";
import { useAtomValue } from "jotai";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate } from "@tanstack/react-router";
import { Check, Megaphone, Pin } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { DataSkeleton, PageShell } from "../components/PageShell";
import { getAnnouncementHistory, markAnnouncementRead } from "../api";
import { sessionAtom } from "../state";

export function AnnouncementsPage() {
  const session = useAtomValue(sessionAtom);
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ["announcement-history", page],
    queryFn: () => getAnnouncementHistory(session!.token, page),
    enabled: Boolean(session),
  });
  const markRead = useMutation({
    mutationFn: (id: number) => markAnnouncementRead(session!.token, id),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["announcements"] }),
        client.invalidateQueries({ queryKey: ["announcement-history"] }),
      ]);
    },
  });
  if (!session) return <Navigate to="/login" />;
  const data = query.data?.data;
  const locale = i18n.language === "en" ? "en-US" : "zh-CN";

  return <PageShell eyebrow="MESSAGES" title={t("announcementHistory")} description={t("announcementHistoryDesc")} className="announcements-page">
    <section className="transaction-panel announcement-history-panel">
      <div className="section-title"><h2><Megaphone />{t("systemAnnouncement")}</h2><span>{query.isLoading ? <DataSkeleton /> : t("unreadAnnouncements", { count: data?.unreadCount ?? 0 })}</span></div>
      {query.isLoading && <div className="announcement-history-list" aria-busy="true">{[0, 1, 2].map((item) => <article className="announcement-history-row" key={item}><div className="announcement-history-icon"><Megaphone /></div><div className="announcement-history-copy"><div><strong><DataSkeleton /></strong><DataSkeleton /></div><p><DataSkeleton /></p><small><DataSkeleton /></small></div><div className="announcement-history-actions"><Button size="sm" variant="outline" disabled>{t("details")}</Button></div></article>)}</div>}
      {query.isError && <div className="empty-state query-error" role="alert"><span>{t("announcementHistoryLoadFailed")}</span><Button variant="outline" onClick={() => void query.refetch()}>{t("retry")}</Button></div>}
      {data?.list.length === 0 && <div className="empty-state">{t("noAnnouncements")}</div>}
      {data && <div className="announcement-history-list">{data.list.map((item) => <article className={`announcement-history-row ${item.isRead ? "" : "is-unread"}`} key={item.id}>
        <div className="announcement-history-icon">{item.isPinned ? <Pin /> : <Megaphone />}</div>
        <div className="announcement-history-copy">
          <div><strong>{item.title}</strong><span className={`status-pill ${item.isRead ? "" : "is-active"}`}>{item.isRead ? t("read") : t("unread")}</span></div>
          <p>{item.content}</p>
          <small>{new Date(item.createdAt).toLocaleString(locale)}</small>
        </div>
        <div className="announcement-history-actions">{item.metadata?.targetPath && <Button asChild size="sm" variant="outline"><a href={item.metadata.targetPath}>{t("details")}</a></Button>}{!item.isRead && <Button size="sm" variant="outline" onClick={() => markRead.mutate(item.id)} disabled={markRead.isPending}><Check />{t("markAsRead")}</Button>}</div>
      </article>)}</div>}
      {data && data.total > data.pageSize && <div className="admin-pagination"><span>{t("totalItems", { count: data.total })}</span><div><Button size="xs" variant="outline" onClick={() => setPage((value) => value - 1)} disabled={page <= 1}>{t("previousPage")}</Button><span>{page}</span><Button size="xs" variant="outline" onClick={() => setPage((value) => value + 1)} disabled={page * data.pageSize >= data.total}>{t("nextPage")}</Button></div></div>}
    </section>
  </PageShell>;
}
