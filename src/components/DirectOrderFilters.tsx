import { t as ledgerT } from "i18next";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { Button } from "./ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

export type DirectOrderQuery = { recipient: string; status: string; page: number };

export function DirectOrderFilters({ query, statuses, maxUsername, total, busy, onChange }: {
  query: DirectOrderQuery; statuses: Record<string, string>; maxUsername: number;
  total?: number; busy: boolean; onChange: (query: DirectOrderQuery) => void;
}) {
  useTranslation();
  const [recipient, setRecipient] = useState("");
  const [status, setStatus] = useState("all");
  return <>
    <form className="admin-filter-bar p-5" onSubmit={event => { event.preventDefault(); onChange({ recipient: recipient.trim().replace(/^@/, ""), status: status === "all" ? "" : status, page: 1 }); }}>
      <label>{ledgerT("ledgerText.orderUsername")}<input aria-label={ledgerT("ledgerText.orderUsername")} value={recipient} maxLength={maxUsername + 1} pattern={`@?[A-Za-z0-9_]{0,${maxUsername}}`} placeholder="@username" onChange={event => setRecipient(event.target.value)} /></label>
      <label>{ledgerT("ledgerText.orderStatus")}<Select value={status} onValueChange={setStatus}><SelectTrigger aria-label={ledgerT("ledgerText.orderStatus")}><SelectValue /></SelectTrigger><SelectContent>
        <SelectItem value="all">{ledgerT("allStatuses")}</SelectItem>{Object.entries(statuses).filter(([value]) => !["preparing", "prepared"].includes(value)).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
      </SelectContent></Select></label>
      <Button type="submit" size="sm" disabled={busy}>{ledgerT("filter")}</Button>
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => { setRecipient(""); setStatus("all"); onChange({ recipient: "", status: "", page: 1 }); }}>{ledgerT("ledgerText.reset")}</Button>
    </form>
    {total !== undefined && <div className="admin-pagination"><span>{ledgerT("ledgerText.orderCount", { count: total })}</span><div>
      <Button type="button" size="sm" variant="outline" disabled={busy || query.page <= 1} onClick={() => onChange({ ...query, page: query.page - 1 })}>{ledgerT("previousPage")}</Button>
      <span>{ledgerT("ledgerText.pageNumber", { page: query.page })}</span>
      <Button type="button" size="sm" variant="outline" disabled={busy || query.page * 50 >= total} onClick={() => onChange({ ...query, page: query.page + 1 })}>{ledgerT("nextPage")}</Button>
    </div></div>}
  </>;
}
