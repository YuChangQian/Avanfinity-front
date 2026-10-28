import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Save, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ApiError, getAdminXDirectSession, updateAdminXDirectSession } from "../api";
import { Button } from "./ui/button";

export function AdminXDirectSessionPanel({ token }: { token: string }) {
  const { i18n } = useTranslation();
  const en = i18n.language === "en";
  const client = useQueryClient();
  const queryKey = ["admin-x-direct-session", token];
  const session = useQuery({ queryKey, queryFn: () => getAdminXDirectSession(token), retry: false });
  const [cookie, setCookie] = useState("");
  const [pending, setPending] = useState<"check" | "save" | null>(null);
  const [notice, setNotice] = useState("");
  const [failed, setFailed] = useState(false);
  const [recentAuthRequired, setRecentAuthRequired] = useState(false);
  const updatedAt = session.data?.data.updatedAt;
  const updatedDate = updatedAt ? new Date(updatedAt) : null;

  async function submit(action: "check" | "save") {
    if (pending || !cookie.trim()) return;
    setPending(action);
    setNotice("");
    setFailed(false);
    setRecentAuthRequired(false);
    try {
      const result = await updateAdminXDirectSession(token, { cookie: cookie.trim(), action });
      if (result.data.valid === false) {
        setFailed(true);
        setNotice(en ? "Session expired or invalid. Log in to X again and paste a fresh Cookie." : "会话已过期或无效，请重新登录 X 后粘贴新的 Cookie。");
      } else if (action === "save") {
        setCookie("");
        client.setQueryData(queryKey, result);
        setNotice(en ? "Session saved. Obtain a fresh quote before paying." : "会话已保存，支付前请重新获取报价。");
      } else {
        setNotice(en ? "Session check passed. It has not been saved." : "会话检查通过，尚未保存。");
      }
    } catch (cause) {
      setFailed(true);
      if (cause instanceof ApiError && cause.errorCode === "RECENT_AUTH_REQUIRED") {
        setRecentAuthRequired(true);
        setNotice(en ? "Verify your administrator account again, then paste the Cookie again." : "请重新认证管理员身份，返回后需重新粘贴 Cookie。");
      } else if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) {
        setNotice(en ? "Administrator authentication is required. Sign in again and retry." : "管理员认证失效或权限不足，请重新登录后重试。");
      } else {
        setNotice(action === "save"
          ? (en ? "Session save failed. Retry later." : "会话保存失败，请稍后重试。")
          : (en ? "Session check failed. Log in to X again or retry later." : "会话检查失败，请重新登录 X 或稍后重试。"));
      }
    } finally {
      setPending(null);
    }
  }

  return <section className="admin-surface admin-system-section" aria-labelledby="x-direct-session-title" data-testid="admin-x-direct-session" aria-busy={session.isLoading || Boolean(pending)}>
    <div className="admin-section-heading"><div>
      <span className="admin-kicker">X DIRECT</span>
      <h2 id="x-direct-session-title"><ShieldCheck />{en ? "X sender session" : "X 直充发送方会话"}</h2>
      <p>{en ? "Paste a fresh Cookie from the sender's logged-in X browser to check or replace its session." : "粘贴发送方已登录 X 浏览器中的 Cookie，检查或替换直充会话。"}</p>
    </div></div>
    <form className="admin-system-form" autoComplete="off" onSubmit={event => { event.preventDefault(); void submit("save"); }}>
      {session.isLoading ? <p>{en ? "Loading session status…" : "正在加载会话状态…"}</p> : session.isError ? <div className="admin-alert is-error" role="alert">
        <span>{en ? "Unable to load session status. Check administrator access and retry." : "会话状态加载失败，请确认管理员权限后重试。"}</span>
        <Button type="button" size="sm" variant="outline" onClick={() => void session.refetch()}>{en ? "Retry" : "重试"}</Button>
      </div> : <p className="admin-settings-note">
        {session.data?.data.configured ? (en ? "Configured" : "已配置") : (en ? "Not configured" : "未配置")}
        {updatedDate && !Number.isNaN(updatedDate.getTime()) && ` · ${en ? "Updated" : "更新时间"} ${updatedDate.toLocaleString(en ? "en-US" : "zh-CN")}`}
      </p>}
      <label>{en ? "X session Cookie" : "X 会话 Cookie"}
        <textarea rows={4} value={cookie} onChange={event => { setCookie(event.target.value); setNotice(""); }} autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={Boolean(pending) || session.isLoading || session.isError} required />
      </label>
      <p className="admin-settings-note">{en ? "The saved Cookie is never displayed. Sessions do not refresh automatically; log in to X again when expired. Replacing the session invalidates unpaid quotes: obtain a fresh quote. Submitted orders remain available for status and receipt checks." : "已保存的 Cookie 不会回显。会话不会自动刷新，过期后需重新登录 X。替换会话会使旧的未支付报价失效，请重新获取报价；已提交订单仍可查询状态和账单。"}</p>
      {notice && <p className={`admin-alert ${failed ? "is-error" : "is-success"}`} role={failed ? "alert" : "status"}>{notice}
        {recentAuthRequired && <Button type="button" size="sm" variant="outline" onClick={() => { setCookie(""); sessionStorage.setItem("recentAuthReturnPath", "/admin?panel=xDirect"); window.location.assign("/login"); }}>{en ? "Verify again" : "重新认证"}</Button>}
      </p>}
      <div className="admin-form-actions">
        <Button type="button" variant="outline" disabled={!cookie.trim() || Boolean(pending) || session.isLoading || session.isError} onClick={() => void submit("check")}><ShieldCheck />{pending === "check" ? (en ? "Checking…" : "正在检查…") : (en ? "Check session" : "检查会话")}</Button>
        <Button type="submit" disabled={!cookie.trim() || Boolean(pending) || session.isLoading || session.isError}><Save />{pending === "save" ? (en ? "Saving…" : "正在保存…") : (en ? "Save session" : "保存会话")}</Button>
      </div>
    </form>
  </section>;
}
