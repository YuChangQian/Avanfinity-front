import { useState } from "react";
import { Button } from "./ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

export type DirectOrderQuery = { recipient: string; status: string; page: number };

export function DirectOrderFilters({ query, statuses, maxUsername, total, busy, onChange }: {
  query: DirectOrderQuery; statuses: Record<string, string>; maxUsername: number;
  total?: number; busy: boolean; onChange: (query: DirectOrderQuery) => void;
}) {
  const [recipient, setRecipient] = useState("");
  const [status, setStatus] = useState("all");
  return <>
    <form className="admin-filter-bar p-5" onSubmit={event => { event.preventDefault(); onChange({ recipient: recipient.trim().replace(/^@/, ""), status: status === "all" ? "" : status, page: 1 }); }}>
      <label>订单用户名<input aria-label="订单用户名" value={recipient} maxLength={maxUsername + 1} pattern={`@?[A-Za-z0-9_]{0,${maxUsername}}`} placeholder="@username" onChange={event => setRecipient(event.target.value)} /></label>
      <label>订单状态<Select value={status} onValueChange={setStatus}><SelectTrigger aria-label="订单状态"><SelectValue /></SelectTrigger><SelectContent>
        <SelectItem value="all">全部状态</SelectItem>{Object.entries(statuses).filter(([value]) => !["preparing", "prepared"].includes(value)).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
      </SelectContent></Select></label>
      <Button type="submit" size="sm" disabled={busy}>筛选</Button>
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => { setRecipient(""); setStatus("all"); onChange({ recipient: "", status: "", page: 1 }); }}>重置</Button>
    </form>
    {total !== undefined && <div className="admin-pagination"><span>共 {total} 笔订单</span><div>
      <Button type="button" size="sm" variant="outline" disabled={busy || query.page <= 1} onClick={() => onChange({ ...query, page: query.page - 1 })}>上一页</Button>
      <span>第 {query.page} 页</span>
      <Button type="button" size="sm" variant="outline" disabled={busy || query.page * 50 >= total} onClick={() => onChange({ ...query, page: query.page + 1 })}>下一页</Button>
    </div></div>}
  </>;
}
