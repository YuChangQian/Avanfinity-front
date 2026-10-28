import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Save, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ApiError, getAdminTgDirectSession, updateAdminTgDirectSession } from "../api";
import { Button } from "./ui/button";
import { parseTgSession } from "../tgSession";

export function AdminTgDirectSessionPanel({ token }: { token: string }) {
  const { i18n } = useTranslation();
  const en = i18n.language === "en";
  const client = useQueryClient();
  const queryKey = ["admin-tg-direct-session", token];
  const session = useQuery({ queryKey, queryFn: () => getAdminTgDirectSession(token), retry: false });
  const [sessionJson, setSessionJson] = useState("");
  const [pending, setPending] = useState<"check" | "save" | null>(null);
  const [notice, setNotice] = useState("");
  const [failed, setFailed] = useState(false);
  const [recentAuthRequired, setRecentAuthRequired] = useState(false);
  const updatedAt = session.data?.data.updatedAt;
  const updatedDate = updatedAt ? new Date(updatedAt) : null;

  async function submit(action: "check" | "save") {
    if (pending || !sessionJson.trim()) return;
    setPending(action);
    setNotice("");
    setFailed(false);
    setRecentAuthRequired(false);
    try {
      const result = await updateAdminTgDirectSession(token, { session: parseTgSession(sessionJson), action });
      if (result.data.valid === false) {
        setFailed(true);
        setNotice(en ? "Session expired or invalid. Log in to Telegram again and paste a fresh Session JSON." : "会话已过期或无效，请重新登录 Telegram 后粘贴新的 Session JSON。");
      } else if (action === "save") {
        setSessionJson("");
        client.setQueryData(queryKey, result);
        setNotice(en ? "Session saved. Obtain a fresh quote before paying." : "会话已保存，支付前请重新获取报价。");
      } else {
        setNotice(en ? "Session check passed. It has not been saved." : "会话检查通过，尚未保存。");
      }
    } catch (cause) {
      setFailed(true);
      if (cause instanceof SyntaxError) {
        setNotice(en ? "Enter valid session JSON." : "请输入有效的 Session JSON。");
      } else if (cause instanceof ApiError && cause.errorCode === "RECENT_AUTH_REQUIRED") {
        setRecentAuthRequired(true);
        setNotice(en ? "Verify your administrator account again, then paste the Session JSON again." : "请重新认证管理员身份，返回后需重新粘贴 Session JSON。");
      } else if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) {
        setNotice(en ? "Administrator authentication is required. Sign in again and retry." : "管理员认证失效或权限不足，请重新登录后重试。");
      } else {
        setNotice(action === "save"
          ? (en ? "Session save failed. Retry later." : "会话保存失败，请稍后重试。")
          : (en ? "Session check failed. Log in to Telegram again or retry later." : "会话检查失败，请重新登录 Telegram 或稍后重试。"));
      }
    } finally {
      setPending(null);
    }
  }

  return <section className="admin-surface admin-system-section" aria-labelledby="tg-direct-session-title" data-testid="admin-tg-direct-session" aria-busy={session.isLoading || Boolean(pending)}>
    <div className="admin-section-heading"><div>
      <span className="admin-kicker">TG DIRECT</span>
      <h2 id="tg-direct-session-title"><ShieldCheck />{en ? "TG sender session" : "TG 直充发送方会话"}</h2>
      <p>{en ? "Paste Session JSON or one Telegram web account export (account1). The active DC key is selected automatically. Close the source web tab before checking; do not log out." : "支持粘贴 TG 会话 JSON 或单个账号的网页导出文本（account1），自动选择当前机房密钥。检查前请关闭导出会话的网页标签，不要退出登录。"}</p>
    </div></div>
    <form className="admin-system-form" autoComplete="off" onSubmit={event => { event.preventDefault(); void submit("save"); }}>
      {session.isLoading ? <p>{en ? "Loading session status…" : "正在加载会话状态…"}</p> : session.isError ? <div className="admin-alert is-error" role="alert">
        <span>{en ? "Unable to load session status. Check administrator access and retry." : "会话状态加载失败，请确认管理员权限后重试。"}</span>
        <Button type="button" size="sm" variant="outline" onClick={() => void session.refetch()}>{en ? "Retry" : "重试"}</Button>
      </div> : <p className="admin-settings-note">
        {session.data?.data.configured ? (en ? "Configured" : "已配置") : (en ? "Not configured" : "未配置")}
        {updatedDate && !Number.isNaN(updatedDate.getTime()) && ` · ${en ? "Updated" : "更新时间"} ${updatedDate.toLocaleString(en ? "en-US" : "zh-CN")}`}
      </p>}
      <label>{en ? "TG Session JSON" : "TG 会话 JSON"}
        <textarea rows={4} value={sessionJson} onChange={event => { setSessionJson(event.target.value); setNotice(""); }} autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={Boolean(pending) || session.isLoading || session.isError} required />
      </label>
      <p className="admin-settings-note">{en ? "The saved Session JSON is never displayed. Sessions do not refresh automatically; log in to Telegram again when expired. Replacing the session invalidates unpaid quotes: obtain a fresh quote. Submitted orders remain available for status and delivery checks." : "已保存的 Session JSON 不会回显。会话不会自动刷新，过期后需重新登录 Telegram。替换会话会使旧的未支付报价失效，请重新获取报价；已提交订单仍可查询状态和到账记录。"}</p>
      {notice && <p className={`admin-alert ${failed ? "is-error" : "is-success"}`} role={failed ? "alert" : "status"}>{notice}
        {recentAuthRequired && <Button type="button" size="sm" variant="outline" onClick={() => { setSessionJson(""); sessionStorage.setItem("recentAuthReturnPath", "/admin?panel=tgDirect"); window.location.assign("/login"); }}>{en ? "Verify again" : "重新认证"}</Button>}
      </p>}
      <div className="admin-form-actions">
        <Button type="button" variant="outline" disabled={!sessionJson.trim() || Boolean(pending) || session.isLoading || session.isError} onClick={() => void submit("check")}><ShieldCheck />{pending === "check" ? (en ? "Checking…" : "正在检查…") : (en ? "Check session" : "检查会话")}</Button>
        <Button type="submit" disabled={!sessionJson.trim() || Boolean(pending) || session.isLoading || session.isError}><Save />{pending === "save" ? (en ? "Saving…" : "正在保存…") : (en ? "Save session" : "保存会话")}</Button>
      </div>
    </form>
  </section>;
}
