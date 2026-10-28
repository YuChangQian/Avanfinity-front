import { useRef, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Copy, Download, KeyRound } from "lucide-react";
import { ApiError, exportTgDirectCdk, generateTgDirectCdks, getProducts, getTgDirectCdks, revokeTgDirectCdk, type Card, type TgDirectCdk, type TgDirectPlan } from "../api";
import { formatDecimal, shiftDecimal } from "../decimal";
import { Button } from "./ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

const statuses: Record<string, string> = { unused: "未使用", preparing: "正在预检", prepared: "等待确认", funding: "正在准备支付卡", funded: "支付卡已就绪", paying: "正在付款", review_required: "待核对", completed: "已完成", failed_precharge: "兑换未完成", ineligible: "账号不符合条件", revoked: "已撤销", paid_pending_delivery: "已付款，等待到账" };

export function TgDirectCdkPanel({ token, plans, cards }: { token: string; plans: TgDirectPlan[]; cards: Card[] }) {
  const tier = "premium";
  const [duration, setDuration] = useState("3m");
  const plan = `${tier}_${duration}`;
  const [mode, setMode] = useState("existing");
  const [cardId, setCardId] = useState("");
  const [productCode, setProductCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [issued, setIssued] = useState<TgDirectCdk[]>([]);
  const intent = useRef<{ fingerprint: string; key: string } | null>(null);
  const cdks = useQuery({ queryKey: ["tg-direct-cdks", token], queryFn: () => getTgDirectCdks(token), retry: false });
  const products = useQuery({ queryKey: ["tg-cdk-products", token], queryFn: () => getProducts(token), enabled: mode === "new", retry: false });
  const product = products.data?.data.find(item => item.productCode === productCode);
  const unused = (cdks.data?.data.list ?? []).filter(item => item.status === "unused");
  function fail(cause: unknown, fallback: string) {
    if (cause instanceof ApiError && cause.errorCode === "RECENT_AUTH_REQUIRED") {
      sessionStorage.setItem("recentAuthReturnPath", "/tg-direct?tab=cdk");
      window.location.assign("/login");
    } else setError(fallback);
  }
  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    const officialMinor = shiftDecimal(String(data.get("officialAmount")), 2, 0);
    if (!officialMinor || !Number.isSafeInteger(Number(officialMinor)) || Number(officialMinor) <= 0) { setError("官方金额上限需大于 0，最多两位小数。"); return; }
    const input = {
      plan, quantity: Number(data.get("quantity")), fundingAmountUsd: String(data.get("fundingAmountUsd")),
      maxWalletDebitUsd: String(data.get("maxWalletDebitUsd")), maxOfficialAmountMinor: Number(officialMinor), currency: "USD",
      ...(mode === "existing" ? { cardId: Number(cardId) } : { autoCard: { productCode, firstName: String(data.get("firstName")).trim(), lastName: String(data.get("lastName")).trim() } }),
    };
    const fingerprint = JSON.stringify(input);
    if (intent.current?.fingerprint !== fingerprint) intent.current = { fingerprint, key: crypto.randomUUID() };
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await generateTgDirectCdks(token, input, intent.current.key);
      setIssued(response.data.list); intent.current = null;
      setNotice(`已免费生成 ${response.data.list.length} 张 CDK，请妥善保存兑换码。`);
      await cdks.refetch();
    } catch (cause) { fail(cause, "生成失败，请核对授权金额和卡片后重试；同一内容重试不会重复生成。"); }
    finally { setBusy(false); }
  }
  async function copy(id: string) {
    setBusy(true); setError("");
    try { const response = await exportTgDirectCdk(token, id); await navigator.clipboard.writeText(response.data.code); setNotice("兑换码已复制。"); }
    catch (cause) { fail(cause, "复制失败，请重试或导出兑换码。"); }
    finally { setBusy(false); }
  }
  async function exportUnused() {
    setBusy(true); setError("");
    try {
      const codes = await Promise.all(unused.map(async item => (await exportTgDirectCdk(token, item.id)).data.code));
      const url = URL.createObjectURL(new Blob([codes.join("\n")], { type: "text/plain;charset=utf-8" }));
      const link = document.createElement("a"); link.href = url; link.download = "tg-cdks.txt"; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { fail(cause, "导出失败，请刷新列表后重试。"); }
    finally { setBusy(false); }
  }
  async function revoke(id: string) {
    setBusy(true); setError("");
    try { await revokeTgDirectCdk(token, id); setIssued(current => current.filter(item => item.id !== id)); await cdks.refetch(); setNotice("未使用的 CDK 已撤销。"); }
    catch (cause) { fail(cause, "撤销失败；已开始兑换的 CDK 无法撤销，请刷新状态。"); }
    finally { setBusy(false); }
  }
  return <section className="transaction-panel gpt-cdk-market mt-5" data-testid="tg-cdk-issuer">
    <div className="section-title"><div><span className="eyebrow">TG CDK ISSUE</span><h2><KeyRound />免费生成 TG CDK</h2></div><Button asChild variant="outline" size="sm"><Link to="/tg-cdk/redeem">打开 TG CDK 兑换页</Link></Button></div>
    <p className="gpt-cdk-market-intro">生成免费。兑换时由发行者的钱包承担授权范围内的开卡费、固定充值本金、充值费及 TG 服务费。官方款项从发行者所选卡扣除，兑换者无需登录或提供支付卡。</p>
    <form className="admin-system-form" onSubmit={generate}>
      <div className="admin-system-form-grid">
        <p>Telegram Premium</p>
        <label>充值时长<Select value={duration} onValueChange={setDuration} disabled={busy}><SelectTrigger aria-label="充值时长"><SelectValue /></SelectTrigger><SelectContent>{[["3m", "3 个月"], ["6m", "6 个月"], ["12m", "1 年"]].map(([value, label]) => <SelectItem value={value} key={value} disabled={!plans.find(item => item.key === `${tier}_${value}`)?.enabled}>{label}</SelectItem>)}</SelectContent></Select></label>
        <label>数量<input name="quantity" type="number" min="1" max="50" step="1" defaultValue="1" required disabled={busy} /></label>
        <label>支付卡模式<Select value={mode} onValueChange={setMode} disabled={busy}><SelectTrigger aria-label="支付卡模式"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="existing">使用现有卡</SelectItem><SelectItem value="new">每张 CDK 新开一张卡</SelectItem></SelectContent></Select></label>
        {mode === "existing" ? <label>支付卡<Select value={cardId} onValueChange={setCardId} disabled={busy}><SelectTrigger aria-label="支付卡"><SelectValue placeholder="选择发行者卡片" /></SelectTrigger><SelectContent>{cards.filter(card => card.status === "ACTIVE" && !card.pendingOperationId).map(card => <SelectItem key={card.id} value={String(card.id)}>{card.cardNumberMasked} · USD {card.balance}</SelectItem>)}</SelectContent></Select></label> : <>
          <label>开卡产品<Select value={productCode} onValueChange={setProductCode} disabled={busy || products.isLoading}><SelectTrigger aria-label="开卡产品"><SelectValue placeholder="选择开卡产品" /></SelectTrigger><SelectContent>{products.data?.data.map(item => <SelectItem value={item.productCode} key={item.productCode}>{item.network} · {item.productCode}</SelectItem>)}</SelectContent></Select></label>
          <label>持卡人名<input name="firstName" required maxLength={64} disabled={busy} /></label><label>持卡人姓<input name="lastName" required maxLength={64} disabled={busy} /></label>
        </>}
        <label>每张卡固定充值金额（USD）<input name="fundingAmountUsd" type="number" min={mode === "new" ? product?.minAmount ?? "0.0001" : "0"} max={mode === "new" ? product?.maxAmount : undefined} step="0.0001" defaultValue="0" required disabled={busy} /></label>
        <label>每张 CDK 钱包扣款上限（USD）<input name="maxWalletDebitUsd" type="number" min="0" max="10000" step="0.0001" required disabled={busy} /></label>
        <label>官方金额上限（USD）<input name="officialAmount" type="number" min="0.01" step="0.01" required disabled={busy} /></label>
      </div>
      {product && mode === "new" && <p>当前开卡费 USD {formatDecimal(product.openFee)}；充值费率 {formatDecimal(shiftDecimal(product.rechargeRate, 2))}%。执行前以后台核验的实际费用为准，超出授权上限即停止。</p>}
      {products.isError && mode === "new" && <p role="alert">开卡产品加载失败，请稍后重试。</p>}
      <p className="admin-settings-note">固定充值金额在兑换时执行，不自动追加充值。新开卡或充值后的剩余余额留在发行者卡内。钱包上限需覆盖全部钱包扣款；官方金额上限单独以 USD 授权，不把美元汇率估算当作扣款授权。</p>
      <Button type="submit" disabled={busy || !plans.find(item => item.key === plan)?.enabled || (mode === "existing" ? !cardId : !productCode || products.isError)}>{busy ? "处理中…" : "免费生成 CDK"}</Button>
    </form>
    {error && <p className="admin-alert is-error" role="alert">{error}</p>}{notice && <p className="admin-alert is-success" role="status">{notice}</p>}
    {issued.length > 0 && <div className="gpt-cdk-purchase-result"><div className="gpt-cdk-code-list">{issued.map(item => <div key={item.id}><code>{item.code ?? item.codePrefix}</code><Button size="xs" variant="outline" disabled={busy} onClick={() => void copy(item.id)}><Copy />复制</Button></div>)}</div></div>}
    <div className="section-title gpt-cdk-history-title"><h2>我的 TG CDK</h2><Button size="sm" variant="outline" disabled={busy || !unused.length} onClick={() => void exportUnused()}><Download />导出未用 CDK</Button></div>
    {cdks.isLoading ? <p className="gpt-list-state">正在加载 CDK…</p> : cdks.isError ? <p className="gpt-list-state" role="alert">CDK 加载失败。<Button variant="outline" size="sm" onClick={() => void cdks.refetch()}>重试</Button></p> : !cdks.data?.data.list.length ? <p className="gpt-list-state">暂无 TG CDK</p> : cdks.data.data.list.map(item => <div className="gpt-order-history-row" key={item.id}><div className="gpt-order-row"><div className="gpt-order-row-main is-static"><span><strong>{item.codePrefix}</strong><small>{plans.find(p => p.key === item.plan)?.label ?? item.plan} · {statuses[item.status] ?? "待核对"}{item.recipient ? ` · @${item.recipient}` : ""}</small><small>兑换钱包预算 USD {formatDecimal(item.totalWalletDebitUsd)} / 授权上限 USD {formatDecimal(item.maxWalletDebitUsd)} · 服务费 USD {formatDecimal(item.serviceFee)}</small><small>{item.cardId != null ? `支付卡 #${item.cardId} · ` : ""}开卡费 USD {item.openFeeUsd == null ? "待查询" : formatDecimal(item.openFeeUsd)} · 充值费 USD {item.fundingFeeUsd == null ? "待查询" : formatDecimal(item.fundingFeeUsd)}{item.fundingDispatched ? " · 开卡/充值已发起" : ""}{item.paymentDispatched ? " · 官方付款已发起" : ""}</small><small>固定充值 USD {formatDecimal(item.fundingAmountUsd)} · 官方上限 {item.currency.toUpperCase()} {(item.maxOfficialAmountMinor / 100).toFixed(2)}</small></span><span className="gpt-cdk-history-actions">{item.status === "unused" && <><Button size="xs" variant="outline" disabled={busy} onClick={() => void copy(item.id)}>复制兑换码</Button><Button size="xs" variant="outline" disabled={busy} onClick={() => void revoke(item.id)}>撤销未用 CDK</Button></>}</span></div></div></div>)}
  </section>;
}
