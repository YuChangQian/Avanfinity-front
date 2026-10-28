import { useEffect, useRef, useState } from 'react';
import { cdkRequest } from '../cdkV2';
import { ArrowRight, Check, KeyRound, ShieldCheck } from 'lucide-react';
import { productLabel, statusLabel, reasonLabel, quoteLabel, dateLabel } from '../cdkV2Display';
import type { Preview, Redemption } from '../generated/cdk-v2';
import './cdkV2.css';
export function CdkV2RedeemPage() {
  const [code, setCode] = useState('');
  const [preview, setPreview] = useState<Preview>();
  const [target, setTarget] = useState('');
  const [credentialMode, setCredentialMode] = useState<'access_token' | 'json'>('access_token');
  const [result, setResult] = useState<Redemption>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(() => Boolean(sessionStorage.getItem('cdk-v2-proof')));
  const [deviceValue] = useState(() => { const value = sessionStorage.getItem('cdk-v2-device') ?? crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', ''); sessionStorage.setItem('cdk-v2-device', value); return value; });
  const device = useRef(deviceValue);
  const [intentValue] = useState(() => { const value = sessionStorage.getItem('cdk-v2-intent') ?? crypto.randomUUID(); sessionStorage.setItem('cdk-v2-intent', value); return value; });
  const intent = useRef(intentValue);
  const [savedSecret] = useState(() => sessionStorage.getItem('cdk-v2-proof') ?? '');
  const secret = useRef(savedSecret);
  useEffect(() => {
    if (!savedSecret) return;
    let active = true;
    cdkRequest<Redemption>('result', { redemptionToken: savedSecret, deviceToken: deviceValue }).then(data => { if (!active) return; setResult(data); setPreview({ legacy: false, productId: data.productId, inputType: data.productId.startsWith('gpt.') ? 'gpt_credential' : 'recipient', authorizeEnabled: false }); }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [savedSecret, deviceValue]);
  async function run(action: () => Promise<void>) {
    setBusy(true); setError('');
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : '请求失败'); } finally { setBusy(false); }
  }
  const credentials = () => ({ redemptionToken: secret.current, deviceToken: device.current });
  const nextAction = result?.nextAction;
  useEffect(() => {
    if (!secret.current || nextAction !== 'wait') return;
    let active = true;
    let timer: number;
    async function poll() {
      try {
        const data = await cdkRequest<Redemption>('result', { redemptionToken: secret.current, deviceToken: device.current });
        if (active) { setResult(data); setError(''); }
      } catch (e) { if (active) setError(e instanceof Error ? e.message : '查询失败'); }
      finally { if (active) timer = window.setTimeout(() => void poll(), 3000); }
    }
    timer = window.setTimeout(() => void poll(), 3000);
    return () => { active = false; clearTimeout(timer); };
  }, [nextAction]);
  const retiredProduct = preview?.productId?.startsWith('x.') || preview?.redeemPath === '/x-cdk/redeem';
  const step = !preview ? 0 : !result || ['prepare','refresh_quote'].includes(result.nextAction) ? 1 : result.nextAction === 'confirm' ? 2 : 3;
  const waitingMessage = result?.status === 'review_required' || result?.paymentStatus === 'unknown'
    ? '付款结果需要核查，请保留本页。平台会查询原交易，暂时不要重复兑换。'
    : result?.paymentStatus === 'paid' ? '付款已完成，正在核实订阅交付，请等待结果。' : '平台正在按发行模板执行，请稍候。进度会自动更新。';
  return <main className="cdk-v2 cdkv2-redeem">
    <header className="cdkv2-header"><div><span className="cdkv2-eyebrow">AVANFINITY / CDK</span><h1>兑换你的订阅</h1><p>输入兑换码，核对账号与报价，确认后等待到账。</p></div><span className="cdkv2-badge"><ShieldCheck size={15} />安全兑换</span></header>
    <ol className="cdkv2-redeem-steps" aria-label="兑换步骤">{['输入兑换码','核对账号','确认兑换','查看结果'].map((label,index) => <li key={label} aria-current={step === index ? 'step' : undefined} className={step > index ? 'done' : ''}><span>{step > index ? <Check size={15} /> : index + 1}</span>{label}</li>)}</ol>
    {error && <div className="cdkv2-alert" role="alert">{error}</div>}
    <section className="cdkv2-panel">
      {!preview && <><div className="cdkv2-section-heading"><div><span className="cdkv2-eyebrow">第一步</span><h2>输入兑换码</h2><p>支持 ChatGPT 和 Telegram 订阅兑换码。</p></div><KeyRound size={28} /></div><form onSubmit={e => { e.preventDefault(); void run(async () => setPreview(await cdkRequest<Preview>('preview', { code }))); }}><label><span>兑换码</span><input required placeholder="粘贴你收到的完整兑换码" value={code} onChange={e => setCode(e.target.value)} autoComplete="off" spellCheck={false} /></label><button className="cdkv2-button" disabled={busy}>{busy ? '正在查询…' : '识别兑换码'}<ArrowRight size={16} /></button></form><p className="cdkv2-hint">识别和预检不会付款。核对账号后才会请你确认。</p></>}
      {retiredProduct && <p className="cdkv2-warning" role="status">X 订阅兑换已停止提供，请联系发行者处理已有兑换码。</p>}
      {preview?.legacy && !retiredProduct && <div className="cdkv2-empty"><KeyRound size={32} /><h2>此码使用原渠道兑换流程</h2><p>我们已识别你的兑换码，继续前往对应渠道完成兑换。</p><a className="cdkv2-button" href={['/cdk/redeem','/tg-cdk/redeem'].includes(preview.redeemPath ?? '') ? preview.redeemPath : '/cdk/redeem'}>前往原渠道兑换<ArrowRight size={16} /></a></div>}
      {preview && !preview.legacy && !retiredProduct && <><div className="cdkv2-product-heading"><span className="cdkv2-eyebrow">兑换产品</span><h2>{productLabel(preview.productId)}</h2></div>
        {!preview.authorizeEnabled && <p className="cdkv2-warning">{savedSecret ? '已恢复保存的兑换记录；继续确认前，请输入原码核实授权状态。' : '新兑换授权暂未开放，已授权交易可继续查询。'}</p>}
        {(!result || ['prepare','refresh_quote'].includes(result.nextAction)) && <form onSubmit={e => { e.preventDefault(); void run(async () => {
          let input;
          if (preview.inputType === 'gpt_credential') {
            if (credentialMode === 'access_token') input = { credential: { mode: 'access_token', accessToken: target.trim() } };
            else { try { input = { credential: JSON.parse(target) }; } catch { throw new Error('登录凭据不是有效的 JSON，请按示例格式填写。'); } }
          } else { input = { recipient: target }; }
          const data = await cdkRequest<Redemption>('prepare', { code, deviceToken: device.current, clientRequestId: intent.current, ...input });
          if (data.redemptionToken) { secret.current = data.redemptionToken; sessionStorage.setItem('cdk-v2-proof', data.redemptionToken); }
          setResult(data); setTarget('');
        }); }}>
          {result?.nextAction === 'refresh_quote' && <p className="cdkv2-warning">报价或接收信息已变化，请重新预检并确认。</p>}
          {result && <label><span>原兑换码</span><input required value={code} onChange={e => setCode(e.target.value)} autoComplete="off" /></label>}
          {preview.inputType === 'gpt_credential' && <label><span>登录凭据方式</span><select value={credentialMode} onChange={e => { setCredentialMode(e.target.value as 'access_token' | 'json'); setTarget(''); }}><option value="access_token">粘贴 Access Token（推荐）</option><option value="json">完整凭据 JSON（高级）</option></select></label>}
          <label><span>{preview.inputType === 'gpt_credential' ? credentialMode === 'access_token' ? 'ChatGPT Access Token' : 'GPT 登录凭据 JSON' : '接收账号'}</span>{preview.inputType === 'gpt_credential' ? <textarea required value={target} onChange={e => setTarget(e.target.value)} autoComplete="off" spellCheck={false} placeholder={credentialMode === 'access_token' ? '粘贴自己的 accessToken 值' : '{"mode":"access_token","accessToken":"你的 Access Token"}'} /> : <input required placeholder="例如 @username" value={target} onChange={e => setTarget(e.target.value)} autoComplete="off" spellCheck={false} />}</label>
          <p className="cdkv2-hint">{preview.inputType === 'gpt_credential' ? '凭据仅用于本次兑换。请从自己的 ChatGPT 账号取得，按支持的格式填写。' : `填写${preview.productId?.startsWith('tg.') ? ' Telegram' : ' X'} 用户名，不是显示名称。预检通过后请再次核对收款账号。`}</p>
          {preview.inputType === 'gpt_credential' && <details className="cdkv2-details"><summary>如何填写登录凭据？</summary><p>在浏览器登录自己的 ChatGPT 账号，打开登录会话链接，复制 accessToken 对应的值粘贴到输入框。不要复制整段 JSON。</p><a href="https://chatgpt.com/api/auth/session" target="_blank" rel="noopener noreferrer">打开 ChatGPT 登录会话 →</a><p>已有完整凭据时，选择高级方式。示例：</p><pre>{'{"mode":"access_token","accessToken":"你的 Access Token"}'}</pre><p>也支持既有 session、mailbox、password 凭据格式。</p></details>}
          <button className="cdkv2-button" disabled={busy}>{busy ? '正在预检…' : '预检账号与报价'}<ArrowRight size={16} /></button>
        </form>}
        {savedSecret && !preview.authorizeEnabled && result?.nextAction === 'confirm' && <form onSubmit={e => { e.preventDefault(); void run(async () => setPreview(await cdkRequest<Preview>('preview', { code }))); }}><p className="cdkv2-hint">已恢复上次兑换。输入原码后可重新核实授权是否开放。</p><label><span>原兑换码</span><input required value={code} onChange={e => setCode(e.target.value)} autoComplete="off" /></label><button className="cdkv2-button secondary" disabled={busy}>重新识别授权状态</button></form>}
        {result && <div className="cdkv2-result" aria-live="polite">
          {result.nextAction === 'confirm' ? <><span className="cdkv2-eyebrow">第三步 · 确认信息</span><dl className="cdkv2-summary-list"><div><dt>接收账号</dt><dd>{result.recipient ? `@${result.recipient.replace(/^@/, '')}` : '已预检的 ChatGPT 账号'}</dd></div><div><dt>官方订阅金额</dt><dd className="cdkv2-price">{quoteLabel(result.quote)}</dd></div><div><dt>报价有效期</dt><dd>{dateLabel(result.quote.expiresAt)}</dd></div></dl><p className="cdkv2-warning">确认后，平台会按发行者的模板执行选卡、充值、付款及允许的换卡重试。费用由发行者承担；已充值支出不会因拒付自动退还。</p><button className="cdkv2-button" disabled={busy || !preview.authorizeEnabled} onClick={() => void run(async () => setResult(await cdkRequest<Redemption>('confirm', { ...credentials(), quoteId: result.quoteId })))}>{busy ? '正在提交…' : '确认兑换'}<ArrowRight size={16} /></button></> : <><div className={`cdkv2-result-title ${result.status === 'completed' ? 'success' : ''}`}><ShieldCheck size={28} /><h3>{statusLabel(result.status)}</h3></div>{result.nextAction === 'wait' && <p className="cdkv2-hint">{waitingMessage}</p>}<dl className="cdkv2-summary-list"><div><dt>付款状态</dt><dd>{statusLabel(result.paymentStatus)}</dd></div><div><dt>订阅交付</dt><dd>{statusLabel(result.deliveryStatus)}</dd></div><div><dt>付款次数</dt><dd>{result.attemptCount} 次</dd></div></dl>{result.nextAction === 'contact_issuer' && <p className="cdkv2-warning">请将下面的兑换 ID 发给发行者，由发行者核查处理。</p>}{result.stopReason && <p className="cdkv2-hint">处理原因：{reasonLabel(result.stopReason)}</p>}</>}
          <div className="cdkv2-receipt-id"><span>兑换 ID</span><code>{result.id}</code><small>联系发行者时提供此 ID</small></div>
          <button className="cdkv2-button secondary" disabled={busy} onClick={() => void run(async () => setResult(await cdkRequest<Redemption>('result', credentials())))}>查询原交易</button>
        </div>}
      </>}
    </section>
    <footer className="cdkv2-redeem-footer"><p><ShieldCheck size={16} />兑换进度保存在当前浏览器，刷新后可恢复查询。</p><button className="cdkv2-text-button" disabled={busy || result?.nextAction === 'wait'} onClick={() => { sessionStorage.removeItem('cdk-v2-proof'); sessionStorage.removeItem('cdk-v2-intent'); window.location.reload(); }}>开始另一兑换（清除本页查询凭据）</button></footer>
  </main>;
}
