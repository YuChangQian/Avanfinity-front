import { useTranslation } from 'react-i18next';
import { Notice } from "../components/ui/notice";
import { useEffect, useRef, useState } from 'react';
import { cdkRequest } from '../cdkV2';
import { ArrowRight, Check, KeyRound, ShieldCheck } from 'lucide-react';
import { productLabel, statusLabel, reasonLabel, quoteLabel, dateLabel } from '../cdkV2Display';
import { StableSwap } from '../components/StableSwap';
import type { Preview, Redemption } from '../generated/cdk-v2';
import './cdkV2.css';
export function CdkV2RedeemPage() {
  const { t } = useTranslation();
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
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : t('cdkText.requestFailed')); } finally { setBusy(false); }
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
      } catch (e) { if (active) setError(e instanceof Error ? e.message : t('cdkText.lookupFailed')); }
      finally { if (active) timer = window.setTimeout(() => void poll(), 3000); }
    }
    timer = window.setTimeout(() => void poll(), 3000);
    return () => { active = false; clearTimeout(timer); };
  }, [nextAction, t]);
  const retiredProduct = preview?.productId?.startsWith('x.') || preview?.redeemPath === '/x-cdk/redeem';
  const step = !preview ? 0 : !result || ['prepare','refresh_quote'].includes(result.nextAction) ? 1 : result.nextAction === 'confirm' ? 2 : 3;
  const waitingMessage = result?.status === 'review_required' || result?.paymentStatus === 'unknown'
    ? t('cdkText.thePaymentResultNeedsReviewKeep')
    : result?.paymentStatus === 'paid' ? t('cdkText.paymentIsCompleteSubscriptionDeliveryIs') : t('cdkText.thePlatformIsExecutingTheIssuance');
  return <main className="cdk-v2 cdkv2-redeem">
    <header className="cdkv2-header"><div><span className="cdkv2-eyebrow">AVANFINITY / CDK</span><h1>{t('cdkText.redeemYourSubscription')}</h1><p>{t('cdkText.enterYourCodeVerifyTheAccount')}</p></div><span className="cdkv2-badge"><ShieldCheck size={15} />{t('cdkText.secureRedemption')}</span></header>
    <ol className="cdkv2-redeem-steps" aria-label={t('cdkText.redemptionSteps')}>{[t('cdkText.enterCode'),t('cdkText.verifyAccount'),t('cdkText.confirmRedemption'),t('cdkText.viewResult')].map((label,index) => <li key={label} aria-current={step === index ? 'step' : undefined} className={step > index ? 'done' : ''}><span>{step > index ? <Check size={15} /> : index + 1}</span>{label}</li>)}</ol>
    {error && <Notice className="cdkv2-alert" role="alert">{error}</Notice>}
    <section className="cdkv2-panel">
      {!preview && <><div className="cdkv2-section-heading"><div><span className="cdkv2-eyebrow">{t('cdkText.step1')}</span><h2>{t('cdkText.enterCode')}</h2><p>{t('cdkText.supportsChatgptAndTelegramSubscriptionRedemption')}</p></div><KeyRound size={28} /></div><form onSubmit={e => { e.preventDefault(); void run(async () => setPreview(await cdkRequest<Preview>('preview', { code }))); }}><label><span>{t('cdkText.redemptionCode')}</span><input required placeholder={t('cdkText.pasteTheFullRedemptionCodeYou')} value={code} onChange={e => setCode(e.target.value)} autoComplete="off" spellCheck={false} /></label><button className="cdkv2-button" disabled={busy}><StableSwap state={busy ? "busy" : "idle"} labels={{ idle: t('cdkText.identifyCode'), busy: t('cdkText.checking') }} /><ArrowRight size={16} /></button></form><p className="cdkv2-hint">{t('cdkText.identificationAndPreflightChecksDoNot')}</p></>}
      {retiredProduct && <Notice className="cdkv2-warning" role="status">{t('cdkText.xSubscriptionRedemptionHasBeenDiscontinued')}</Notice>}
      {preview?.legacy && !retiredProduct && <div className="cdkv2-empty"><KeyRound size={32} /><h2>{t('cdkText.thisCodeUsesTheOriginalChannel')}</h2><p>{t('cdkText.yourCodeHasBeenIdentifiedContinue')}</p><a className="cdkv2-button" href={['/cdk/redeem','/tg-cdk/redeem'].includes(preview.redeemPath ?? '') ? preview.redeemPath : '/cdk/redeem'}>{t('cdkText.continueToOriginalChannel')}<ArrowRight size={16} /></a></div>}
      {preview && !preview.legacy && !retiredProduct && <><div className="cdkv2-product-heading"><span className="cdkv2-eyebrow">{t('cdkText.productToRedeem')}</span><h2>{productLabel(preview.productId)}</h2></div>
        {!preview.authorizeEnabled && <Notice className="cdkv2-warning">{savedSecret ? t('cdkText.savedRedemptionRestoredEnterTheOriginal') : t('cdkText.newRedemptionAuthorizationIsTemporarilyUnavailable')}</Notice>}
        {(!result || ['prepare','refresh_quote'].includes(result.nextAction)) && <form onSubmit={e => { e.preventDefault(); void run(async () => {
          let input;
          if (preview.inputType === 'gpt_credential') {
            if (credentialMode === 'access_token') input = { credential: { mode: 'access_token', accessToken: target.trim() } };
            else { try { input = { credential: JSON.parse(target) }; } catch { throw new Error(t('cdkText.theLoginCredentialsAreNotValid')); } }
          } else { input = { recipient: target }; }
          const data = await cdkRequest<Redemption>('prepare', { code, deviceToken: device.current, clientRequestId: intent.current, ...input });
          if (data.redemptionToken) { secret.current = data.redemptionToken; sessionStorage.setItem('cdk-v2-proof', data.redemptionToken); }
          setResult(data); setTarget('');
        }); }}>
          {result?.nextAction === 'refresh_quote' && <Notice className="cdkv2-warning">{t('cdkText.theQuoteOrRecipientDetailsHave')}</Notice>}
          {result && <label><span>{t('cdkText.originalRedemptionCode')}</span><input required value={code} onChange={e => setCode(e.target.value)} autoComplete="off" /></label>}
          {preview.inputType === 'gpt_credential' && <label><span>{t('cdkText.loginCredentialMethod')}</span><select value={credentialMode} onChange={e => { setCredentialMode(e.target.value as 'access_token' | 'json'); setTarget(''); }}><option value="access_token">{t('cdkText.pasteAccessTokenRecommended')}</option><option value="json">{t('cdkText.fullCredentialJsonAdvanced')}</option></select></label>}
          <label><span>{preview.inputType === 'gpt_credential' ? credentialMode === 'access_token' ? 'ChatGPT Access Token' : t('cdkText.gptLoginCredentialJson') : t('cdkText.recipientAccount')}</span>{preview.inputType === 'gpt_credential' ? <textarea required value={target} onChange={e => setTarget(e.target.value)} autoComplete="off" spellCheck={false} placeholder={credentialMode === 'access_token' ? t('cdkText.pasteYourOwnAccesstokenValue') : t('cdkText.modeAccessTokenAccesstokenYourAccess')} /> : <input required placeholder={t('cdkText.exampleUsername')} value={target} onChange={e => setTarget(e.target.value)} autoComplete="off" spellCheck={false} />}</label>
          <p className="cdkv2-hint">{preview.inputType === 'gpt_credential' ? t('cdkText.credentialsAreUsedOnlyForThis') : t('cdkText.recipientHint', { platform: preview.productId?.startsWith('tg.') ? 'Telegram' : 'X' })}</p>
          {preview.inputType === 'gpt_credential' && <details className="cdkv2-details"><summary>{t('cdkText.howDoIProvideLoginCredentials')}</summary><p>{t('cdkText.signInToYourOwnChatgpt')}</p><a href="https://chatgpt.com/api/auth/session" target="_blank" rel="noopener noreferrer">{t('cdkText.openChatgptLoginSession')}</a><p>{t('cdkText.ifYouAlreadyHaveFullCredentials')}</p><pre>{t('cdkText.modeAccessTokenAccesstokenYourAccess')}</pre><p>{t('cdkText.existingSessionMailboxAndPasswordCredential')}</p></details>}
          <button className="cdkv2-button" disabled={busy}><StableSwap state={busy ? "busy" : "idle"} labels={{ idle: t('cdkText.checkAccountAndQuote'), busy: t('cdkText.runningPreflightCheck') }} /><ArrowRight size={16} /></button>
        </form>}
        {savedSecret && !preview.authorizeEnabled && result?.nextAction === 'confirm' && <form onSubmit={e => { e.preventDefault(); void run(async () => setPreview(await cdkRequest<Preview>('preview', { code }))); }}><p className="cdkv2-hint">{t('cdkText.previousRedemptionRestoredEnterTheOriginal')}</p><label><span>{t('cdkText.originalRedemptionCode')}</span><input required value={code} onChange={e => setCode(e.target.value)} autoComplete="off" /></label><button className="cdkv2-button secondary" disabled={busy}>{t('cdkText.checkAuthorizationAgain')}</button></form>}
        {result && <div className="cdkv2-result" aria-live="polite">
          {result.nextAction === 'confirm' ? <><span className="cdkv2-eyebrow">{t('cdkText.step3ConfirmDetails')}</span><dl className="cdkv2-summary-list"><div><dt>{t('cdkText.recipientAccount')}</dt><dd>{result.recipient ? `@${result.recipient.replace(/^@/, '')}` : t('cdkText.verifiedChatgptAccount')}</dd></div><div><dt>{t('cdkText.officialSubscriptionAmount')}</dt><dd className="cdkv2-price">{quoteLabel(result.quote)}</dd></div><div><dt>{t('cdkText.quoteExpiry')}</dt><dd>{dateLabel(result.quote.expiresAt)}</dd></div></dl><Notice className="cdkv2-warning">{t('cdkText.afterConfirmationThePlatformSelectsCards')}</Notice><button className="cdkv2-button" disabled={busy || !preview.authorizeEnabled} onClick={() => void run(async () => setResult(await cdkRequest<Redemption>('confirm', { ...credentials(), quoteId: result.quoteId })))}><StableSwap state={busy ? "busy" : "idle"} labels={{ idle: t('cdkText.confirmRedemption'), busy: t('cdkText.submitting') }} /><ArrowRight size={16} /></button></> : <><div className={`cdkv2-result-title ${result.status === 'completed' ? 'success' : ''}`}><ShieldCheck size={28} /><h3>{statusLabel(result.status)}</h3></div>{result.nextAction === 'wait' && <p className="cdkv2-hint">{waitingMessage}</p>}<dl className="cdkv2-summary-list"><div><dt>{t('cdkText.paymentStatus')}</dt><dd>{statusLabel(result.paymentStatus)}</dd></div><div><dt>{t('cdkText.subscriptionDelivery')}</dt><dd>{statusLabel(result.deliveryStatus)}</dd></div><div><dt>{t('cdkText.paymentAttempts')}</dt><dd>{t('cdkText.paymentAttemptCount', { count: result.attemptCount })}</dd></div></dl>{result.nextAction === 'contact_issuer' && <Notice className="cdkv2-warning">{t('cdkText.sendTheRedemptionIdBelowTo')}</Notice>}{result.stopReason && <p className="cdkv2-hint">{t('cdkText.reason')}{reasonLabel(result.stopReason)}</p>}</>}
          <div className="cdkv2-receipt-id"><span>{t('cdkText.redemptionId')}</span><code>{result.id}</code><small>{t('cdkText.provideThisIdWhenContactingThe')}</small></div>
          <button className="cdkv2-button secondary" disabled={busy} onClick={() => void run(async () => setResult(await cdkRequest<Redemption>('result', credentials())))}>{t('cdkText.checkOriginalTransaction')}</button>
        </div>}
      </>}
    </section>
    <footer className="cdkv2-redeem-footer"><p><ShieldCheck size={16} />{t('cdkText.redemptionProgressIsSavedInThis')}</p><button className="cdkv2-text-button" disabled={busy || result?.nextAction === 'wait'} onClick={() => { sessionStorage.removeItem('cdk-v2-proof'); sessionStorage.removeItem('cdk-v2-intent'); window.location.reload(); }}>{t('cdkText.startAnotherRedemptionClearThisPage')}</button></footer>
  </main>;
}
