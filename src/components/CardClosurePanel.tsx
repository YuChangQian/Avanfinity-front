import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Dialog } from "radix-ui";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
import { Button } from "./ui/button";
import { createCardClosureBatch, getCardClosureBatch } from "../api";

type Intent = { key: string; id?: string };
export function CardClosurePanel({ token, owner, enabled }: { token: string; owner: string; enabled: boolean }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const storageKey = `card-closure:${owner}`;
  function readIntent(): Intent | null {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? "null") as Intent | null;
    return value && typeof value.key === "string" && (!value.id || typeof value.id === "string") ? value : null;
  }
  const [intent, setIntent] = useState<Intent | null>(() => { try { return readIntent(); } catch { return null; } });
  const [open, setOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [offset, setOffset] = useState(0);
  const submitting = useRef(false);
  const result = useQuery({
    queryKey: ["card-closure", owner, intent?.id, offset],
    queryFn: () => getCardClosureBatch(token, intent!.id!, offset),
    enabled: Boolean(intent?.id), retry: false,
    refetchInterval: query => query.state.data?.data.pending === 0 ? false : 4000,
  });
  const batch = result.data?.data;
  useEffect(() => {
    if (!batch) return;
    for (const key of ["cards", "wallet", "dashboard"]) void client.invalidateQueries({ queryKey: [key] });
  }, [batch, client]);
  const submit = useMutation({
    mutationFn: async () => {
      if (!enabled || !confirmed) throw new Error(t("cardTools.confirmRequired"));
      const saved = readIntent();
      // Reuse an uncertain submission, including one submitted from another tab.
      const next = saved && !(saved.id === intent?.id && batch?.pending === 0 && result.isSuccess)
        ? saved : { key: crypto.randomUUID() };
      localStorage.setItem(storageKey, JSON.stringify(next));
      setIntent(next);
      const response = next.id ? await getCardClosureBatch(token, next.id) : await createCardClosureBatch(token, next.key);
      const accepted = { ...next, id: response.data.id };
      localStorage.setItem(storageKey, JSON.stringify(accepted));
      return { accepted, response };
    },
    onSuccess: ({ accepted, response }) => {
      client.setQueryData(["card-closure", owner, accepted.id, 0], response);
      setOffset(0); setIntent(accepted); setOpen(false); setConfirmed(false);
    },
    onSettled: () => { submitting.current = false; },
  });
  const active = Boolean(intent?.id && (!batch || batch.pending > 0 || result.isError));
  return <>
    {enabled && <Button variant="destructive" disabled={active || submit.isPending} onClick={() => { setConfirmed(false); setOpen(true); }}>
      <Trash2 />{t(intent && !intent.id ? "cardTools.resume" : "cardTools.closeAll")}
    </Button>}
    {intent?.id && <section className="transaction-panel" data-testid="card-closure-progress" aria-label={t("cardTools.progress")}>
      <h3>{t("cardTools.progress")}</h3>
      <p>{t("cardTools.background")}</p>
      {result.isError && <p role="alert">{t("cardTools.readError")} <Button variant="outline" onClick={() => void result.refetch()}>{t("cardTools.refresh")}</Button></p>}
      {!batch && !result.isError && <p role="status">{t("loading")}</p>}
      {batch && <>
        <p role="status">{t(`cardTools.batchStatus.${batch.status}`)}</p>
        <p>{t("cardTools.counts", batch)}</p>
        {batch.reviewRequired > 0 && <p>{t("cardTools.reviewHint")}</p>}
        <ul>{batch.list.map(item => <li key={item.cardId}>
          <Link to="/cards/$cardId" params={{ cardId: String(item.cardId) }}>#{item.cardId}</Link>
          {" · "}{t(`cardTools.status.${item.status}`)}
          {item.reasonCode && <> · {t(`cardTools.reason.${item.reasonCode}`, { defaultValue: t("cardTools.reasonUnknown") })}</>}
        </li>)}</ul>
        <div className="owned-cards-pagination">
          <Button variant="outline" aria-label={t("cardTools.previous")} disabled={offset === 0 || result.isFetching} onClick={() => setOffset(value => Math.max(0, value - 100))}>{t("cardTools.previous")}</Button>
          <span>{Math.floor(offset / 100) + 1} / {Math.max(1, Math.ceil(batch.total / 100))}</span>
          <Button variant="outline" aria-label={t("cardTools.next")} disabled={!batch.hasMore || result.isFetching} onClick={() => setOffset(value => value + 100)}>{t("cardTools.next")}</Button>
        </div>
      </>}
    </section>}
    <Dialog.Root open={open} onOpenChange={value => { if (!submit.isPending) setOpen(value); }}>
      <Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog-content">
        <Dialog.Title>{t("cardTools.closeAll")}</Dialog.Title>
        <Dialog.Description>{t("cardTools.scope")}</Dialog.Description>
        <p>{t("deleteCardWarning")}</p><p>{t("cardTools.exclusions")}</p>
        <label className="card-closure-confirm"><input type="checkbox" checked={confirmed} disabled={submit.isPending} onChange={e => setConfirmed(e.target.checked)} />{t("cardTools.confirmLabel")}</label>
        {submit.isError && <p role="alert">{t("cardTools.submitError")}</p>}
        <div className="card-actions">
          <Dialog.Close asChild><Button variant="outline" disabled={submit.isPending}>{t("cancel")}</Button></Dialog.Close>
          <Button variant="destructive" disabled={!confirmed || !enabled || submit.isPending} onClick={() => {
            if (submitting.current) return;
            submitting.current = true; submit.mutate();
          }}>{t(submit.isPending ? "processing" : "cardTools.confirm")}</Button>
        </div>
      </Dialog.Content></Dialog.Portal>
    </Dialog.Root>
  </>;
}
