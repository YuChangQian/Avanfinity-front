import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useAtomValue } from "jotai";
import { Link } from "@tanstack/react-router";
import { KeyRound, ShieldCheck } from "lucide-react";
import { publicTgCdkPreflight, publicTgCdkPreview, publicTgCdkRedeem, publicTgCdkResult, type PublicTgCdkResult } from "../api";
import { sessionAtom } from "../state";
import { Button } from "../components/ui/button";
import { StableSwap } from "../components/StableSwap";
import { BrandIcon } from "../components/BrandIcon";

const planLabels: Record<string, string> = { premium_3m: "Premium · 3 个月", premium_6m: "Premium · 6 个月", premium_12m: "Premium · 1 年", };
const statusLabels: Record<string, string> = { unused: "尚未兑换", preparing: "正在检查资格和报价", prepared: "报价已就绪，请确认兑换", funding: "正在准备发行者支付卡", funded: "支付卡已准备完成，可继续兑换", paying: "正在兑换，请勿重复提交", review_required: "结果待核对，请查询原兑换状态", completed: "兑换完成", paid_pending_delivery: "已付款，等待到账", failed_precharge: "兑换未完成，请联系发行者", ineligible: "账号暂不符合充值条件", revoked: "兑换码已撤销" };
type Intent = { clientRequestId: string; recipient: string; plan: string; submitted: boolean };
function readIntent(): Intent | null {
  try { const value = JSON.parse(sessionStorage.getItem("tgCdkIntent") ?? "null"); return value && typeof value.clientRequestId === "string" && /^[0-9a-f-]{36}$/i.test(value.clientRequestId) && typeof value.recipient === "string" && typeof value.plan === "string" ? value : null; }
  catch { return null; }
}
function deviceToken() {
  const existing = localStorage.getItem("tgCdkDevice");
  if (existing && /^[0-9a-f]{64}$/.test(existing)) return existing;
  const value = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("");
  localStorage.setItem("tgCdkDevice", value);
  return value;
}

export function TgCdkRedeemPage() {
  const session = useAtomValue(sessionAtom);
  const [device] = useState(deviceToken);
  const [intent, setIntent] = useState<Intent | null>(readIntent);
  const [recovering, setRecovering] = useState(Boolean(intent));
  const [code, setCode] = useState("");
  const [recipient, setRecipient] = useState(intent?.recipient ?? "");
  const [result, setResult] = useState<PublicTgCdkResult | null>(null);
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const [error, setError] = useState("");
  const [recoveryChecked, setRecoveryChecked] = useState(false);
  const run = useCallback(async (action: "preview" | "preflight" | "redeem" | "result") => {
    if (working.current || !code.trim()) return;
    working.current = true; setBusy(true); setError("");
    const credential = { code: code.trim(), deviceToken: device };
    function remember(next: Intent) { sessionStorage.setItem("tgCdkIntent", JSON.stringify(next)); setIntent(next); }
    try {
      let data: PublicTgCdkResult;
      if (action === "preview") data = (await publicTgCdkPreview(credential)).data;
      else if (action === "preflight") {
        const next = intent ?? { clientRequestId: crypto.randomUUID(), recipient: recipient.trim().replace(/^@/, ""), plan: result?.plan ?? "", submitted: false };
        remember(next);
        data = (await publicTgCdkPreflight({ ...credential, recipient: next.recipient, clientRequestId: next.clientRequestId })).data;
      } else {
        if (!intent) throw new Error("Missing request");
        if (action === "redeem") {
          if (result?.amountMinor == null || !result.currency) throw new Error("Missing quote");
          remember({ ...intent, submitted: true }); setRecoveryChecked(false);
          data = (await publicTgCdkRedeem({ ...credential, clientRequestId: intent.clientRequestId, expectedAmountMinor: result.amountMinor, currency: result.currency })).data;
        } else {
          data = (await publicTgCdkResult({ ...credential, clientRequestId: intent.clientRequestId })).data;
          setRecoveryChecked(true); setRecovering(false);
        }
      }
      setResult(data);
    } catch {
      setError(action === "redeem" ? "提交结果暂不明确，请查询原兑换状态，勿创建新的支付请求。" : action === "preflight" ? "预检暂未完成，请重试预检或查询原兑换状态。" : action === "result" ? "无法查询原兑换状态，请确认输入原兑换码后重试。" : "兑换码暂不可用，请核对后重试。");
    } finally { working.current = false; setBusy(false); }
  }, [code, device, intent, recipient, result]);
  useEffect(() => {
    if (recovering || !code || !intent || !["preparing", "funding", "paying", "paid_pending_delivery"].includes(result?.status ?? "")) return;
    const timer = window.setInterval(() => { void run("result"); }, 5000);
    return () => window.clearInterval(timer);
  }, [recovering, code, intent, result?.status, run]); // Polls only the bound request; never submits a payment.
  function reset() {
    sessionStorage.removeItem("tgCdkIntent"); setIntent(null); setRecovering(false); setCode(""); setRecipient(""); setResult(null); setError(""); setRecoveryChecked(false);
  }
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void run(recovering ? "result" : "preview"); }
  const canConfirm = intent && result && (result.status === "funded" || (result.status === "prepared" && (!intent.submitted || recoveryChecked))) && result.amountMinor != null && Boolean(result.currency);
  return <main className={`cdk-page${session ? " is-embedded" : ""}`}>
    {!session && <header className="cdk-nav"><Link to="/login" className="cdk-brand"><span><BrandIcon /></span><strong>AVANFINITY</strong></Link><Button asChild variant="outline" size="sm"><Link to="/cdk/redeem">GPT CDK 兑换</Link></Button></header>}
    <section className="cdk-hero"><div><span className="eyebrow"><KeyRound />TG CDK</span><h1>TG CDK 兑换</h1><p>无需登录，输入兑换码和 TG 用户名，先核对套餐与官方报价，再确认兑换。服务费由发行者承担。</p><ol className="cdk-howto"><li>检查兑换码</li><li>检查 TG 账号资格与官方报价</li><li>确认兑换后查询状态与到账</li></ol></div><div className="cdk-trust"><ShieldCheck /><span><strong>兑换者无需提供支付卡或 Session</strong><small>同一兑换只绑定一个 TG 账号，请确认用户名后提交预检。</small></span></div></section>
    <section className="cdk-workspace" style={{ gridTemplateColumns: "minmax(0, 1fr)" }}><div className="cdk-card"><div className="cdk-form">
      {(!result || recovering) && <form className="grid gap-6" onSubmit={submit}>
        {recovering && <p>检测到之前的兑换请求。请重新输入原兑换码查询；不会自动重新提交支付。</p>}
        <label>TG CDK 兑换码<input value={code} onChange={event => setCode(event.target.value)} autoComplete="off" spellCheck={false} maxLength={256} disabled={busy} required /></label>
        <Button disabled={busy || !code.trim()}><StableSwap state={busy ? "busy" : recovering ? "alt" : "idle"} labels={{ idle: "检查兑换码", alt: "查询原兑换状态", busy: "正在处理…" }} /></Button>
      </form>}
      {result && !recovering && <>
        <h2>{planLabels[result.plan] ?? "Telegram Premium"}</h2>
        <p role="status">{statusLabels[result.status] ?? "结果待核对，请查询原兑换状态"}</p>
        {result.status === "ineligible" && <p role="alert" className="error">该 Telegram 账号暂不能接收此套餐，请核对用户名或联系管理员。</p>}
        {result.status === "unused" && <form className="grid gap-6" onSubmit={event => { event.preventDefault(); void run("preflight"); }}>
          <label>TG 用户名<input value={recipient} onChange={event => setRecipient(event.target.value)} readOnly={Boolean(intent)} disabled={busy} maxLength={33} pattern="@?[A-Za-z0-9_]{1,32}" autoComplete="off" required /></label>
          <Button disabled={busy}><StableSwap state={busy ? "busy" : intent ? "alt" : "idle"} labels={{ idle: "检查资格并获取报价", alt: "重试预检", busy: "正在预检…" }} /></Button>
        </form>}
        {(result.recipient || intent?.recipient) && <p>TG 账号：@{result.recipient ?? intent?.recipient}</p>}
        {result.amountMinor != null && result.currency && <div className="cdk-confirm"><ShieldCheck /><div><strong>官方金额</strong><p>{result.currency.toUpperCase()} {(result.amountMinor / 100).toFixed(2)}</p><p>服务费由发行者承担，兑换者无需付款。</p></div></div>}
        {canConfirm && <Button disabled={busy} onClick={() => void run("redeem")}><StableSwap state={busy ? "busy" : intent?.submitted || result.status === "funded" ? "alt" : "idle"} labels={{ idle: "确认兑换", alt: "继续兑换", busy: "正在提交…" }} /></Button>}
        {["prepared", "funded"].includes(result.status) && intent && <Button variant="outline" disabled={busy} onClick={() => void run("preflight")}>刷新官方报价</Button>}
        {intent && <Button variant="outline" disabled={busy} onClick={() => void run("result")}>查询原兑换状态</Button>}
        {["ineligible", "failed_precharge"].includes(result.status) && intent && result.canRetryPreflight === true && <Button variant="outline" disabled={busy} onClick={() => { sessionStorage.removeItem("tgCdkIntent"); setIntent(null); setResult({ ...result, status: "unused" }); setError(""); setRecoveryChecked(false); }}>重新核对账号并预检</Button>}
        {result.deliveryStatus === "delivered" && <p>已核验赠送记录 #{result.giftMessageId} · {result.giftDays} 天</p>}
        {((!intent && result.status !== "unused") || ["completed", "revoked", "ineligible", "failed_precharge"].includes(result.status)) && <Button variant="outline" disabled={busy} onClick={reset}>兑换另一张 CDK</Button>}
      </>}
      {error && <p className="error" role="alert">{error}</p>}
    </div></div></section>
    <footer className="cdk-footer"><ShieldCheck />只查询原兑换记录即可恢复状态；请勿向他人提供兑换码。</footer>
  </main>;
}
