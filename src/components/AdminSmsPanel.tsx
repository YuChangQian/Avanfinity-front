import adminI18n, { t as adminT } from "i18next";
import { useTranslation } from "react-i18next";
import { Notice } from "./ui/notice";
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { getAdminSmsSettings, updateAdminSmsSettings, getAdminSmsOrders, getAdminSmsOrder, resolveAdminSmsOrder, getSmsCatalog } from '../api';
import { smsStatuses } from '../views/SmsPage';
import '../views/sms.css';
import './admin-sms.css';
import { ArrowRight } from 'lucide-react';
import { smsPhoneParts } from '../views/smsPhone';
import { AdminSmsOrderDetail } from './AdminSmsOrderDetail';

export function AdminSmsPanel({ token, onOpenCustomer }: { token: string; onOpenCustomer: (id: number, email: string | null) => void }) {
  useTranslation();
  const client = useQueryClient();
  const [draft, setDraft] = useState<{ enabled: boolean; markupPercent: string } | null>(null);
  const [filter, setFilter] = useState({ page: 1, status: '', q: '', userId: undefined as number | undefined });
  const [selected, setSelected] = useState<string | null>(null);
  const settings = useQuery({ queryKey: ['admin-sms-settings'], queryFn: () => getAdminSmsSettings(token), retry: false });
  const orders = useQuery({ queryKey: ['admin-sms-orders', filter], queryFn: () => getAdminSmsOrders(token, filter), retry: false, refetchInterval: 10000 });
  const catalog = useQuery({ queryKey: ['sms-catalog', token], queryFn: () => getSmsCatalog(token), retry: false, staleTime: Infinity });
  const serviceName = (code: string) => code === "full" ? adminT("serviceText.fullRental") : catalog.data?.data.services.find(s => s.code === code)?.name ?? adminT("adminText.serviceCode", { code: code });
  const countryName = (id: number) => {
    const country = catalog.data?.data.countries.find(c => c.id === id);
    if (!country) return adminT("adminText.countryRegionLabel", { countryId: id });
    return adminI18n.resolvedLanguage?.startsWith("zh") ? country.name : country.nameEn?.trim() || (/^[\x20-\x7E]+$/.test(country.name) ? country.name : String(id));
  };
  const detail = useQuery({ queryKey: ['admin-sms-order', selected], queryFn: () => getAdminSmsOrder(token, selected!), enabled: !!selected, retry: false, refetchInterval: query => { const o = query.state.data?.data; return o && !['finished', 'refunded', 'failed'].includes(o.status) ? 5000 : false; } });
  const save = useMutation({ mutationFn: () => updateAdminSmsSettings(token, { ...current!, version: settings.data!.data.version }), onSuccess: data => { client.setQueryData(['admin-sms-settings'], data); setDraft(null); } });
  const resolve = useMutation({ mutationFn: (input: { activationId?: string; note: string; confirmNoPurchase?: boolean }) => resolveAdminSmsOrder(token, selected!, input), onSuccess: data => { client.setQueryData(['admin-sms-order', data.data.id], data); void client.invalidateQueries({ queryKey: ['admin-sms-orders'] }); } });
  const current = draft ?? settings.data?.data;
  const order = detail.data?.data;
  const validPercent = current && /^(0|[1-9]\d{0,7})(\.\d{1,2})?$/.test(current.markupPercent);
  return <div className="admin-panel-stack" data-testid="admin-panel-sms">
    <div className="admin-panel-heading"><div><span className="admin-kicker">SMS</span><h2>{adminT("adminText.smsVerificationService")}</h2><p>{adminT("adminText.manageSmsPricingServiceAvailabilityAndExceptional")}</p></div></div>
    <section className="sms-surface"><h3>{adminT("adminText.serviceSettings")}</h3>{settings.isError && <Notice role="alert">{adminT("adminText.unableToLoadSettings")}<Button onClick={() => void settings.refetch()}>{adminT("adminText.retry")}</Button></Notice>}
      {current && <form className="sms-form" onSubmit={event => { event.preventDefault(); save.mutate(); }}>
        <label><span>{adminT("adminText.enableSmsPurchases")}</span><input type="checkbox" checked={current.enabled} onChange={e => { setDraft({ enabled: e.target.checked, markupPercent: current.markupPercent }); save.reset(); }} /></label>
        <label>{adminT("adminText.markup")}<input type="number" min="0" max="99999999" step="0.01" value={current.markupPercent} onChange={e => { setDraft({ enabled: current.enabled, markupPercent: e.target.value }); save.reset(); }} required /></label>
        <p className="sms-note">{adminT("adminText.priceCost1MarkupWithA1")}</p>
        <p>{adminT("adminText.apiKeyLabel")}{settings.data?.data.configured ? adminT("adminText.configured") : adminT("adminText.notConfigured")}{adminT("adminText.livePurchases")}{settings.data?.data.purchasesReady ? adminT("adminText.runtimeReady") : adminT("adminText.runtimeNotEnabled")}</p>
        <Button type="submit" disabled={!validPercent || !draft || save.isPending}>{adminT("adminText.saveSmsSettings")}</Button>
      </form>}
      {save.isSuccess && <Notice role="status">{adminT("adminText.settingsSaved")}</Notice>}{save.error && <Notice role="alert">{save.error.message} <Button variant="outline" onClick={() => { setDraft(null); save.reset(); void settings.refetch(); }}>{adminT("adminText.reloadSettings")}</Button></Notice>}
    </section>
    <section className="sms-surface"><h3>{adminT("adminText.webhookNotifications")}</h3><p>{adminT("adminText.addTheFollowingUrlToYourAccount")}</p><label className="sms-form">{adminT("adminText.notificationUrl")}<input readOnly value={new URL('/api/webhooks/sms', window.location.origin).href} /></label></section>
    <section className="sms-surface"><h3>{adminT("adminText.orderManagement")}</h3><form className="admin-filter-bar" onSubmit={event => { event.preventDefault(); const f = new FormData(event.currentTarget); setFilter({ page: 1, q: String(f.get('q') ?? '').trim(), status: String(f.get('status') ?? ''), userId: f.get('userId') ? Number(f.get('userId')) : undefined }); }}>
      <label>{adminT("adminText.searchLabel")}<input name="q" placeholder={adminT("adminText.emailTelegramUsernameOrderIdOrPhone")} /></label><label>{adminT("adminText.orderStatus")}<select name="status" aria-label={adminT("adminText.orderStatus")}><option value="">{adminT("adminText.all")}</option><option value="queued">{adminT("adminText.waitingForANumber")}</option>{Object.entries(smsStatuses).map(([status, label]) => <option value={status} key={status}>{label}</option>)}</select></label><label>{adminT("adminText.userId")}<input type="number" name="userId" min="1" /></label><Button type="submit">{adminT("adminText.searchOrders")}</Button>
    </form>{orders.isError && <Notice role="alert">{adminT("adminText.unableToLoadOrders")}<Button onClick={() => void orders.refetch()}>{adminT("adminText.retry")}</Button></Notice>}
      {orders.isLoading && <p className="admin-state loading-skeleton loading-skeleton-table">{adminT("adminText.loadingOrders")}</p>}
      {orders.data?.data.list.length === 0 && <p className="admin-state">{adminT("adminText.noMatchingOrders")}</p>}
      {!!orders.data?.data.list.length && <div className="admin-table-wrap"><table className="admin-table admin-sms-table" data-testid="admin-sms-table"><thead><tr><th>{adminT("adminText.customer")}</th><th>{adminT("adminText.serviceCountry")}</th><th>{adminT("adminText.phoneNumber")}</th><th>{adminT("adminText.status")}</th><th>{adminT("adminText.amountUsd")}</th><th>{adminT("adminText.created")}</th><th>{adminT("adminText.details")}</th></tr></thead><tbody>{orders.data.data.list.map(o => { const phone = o.phone ? smsPhoneParts(o.phone) : null; return <tr key={o.id}>
        <td><button type="button" className="admin-customer-inviter" onClick={() => onOpenCustomer(o.ownerUserId, o.ownerEmail)}><span>{o.ownerDisplayName || o.ownerEmail || adminT("adminText.userLabel", { userId: o.ownerUserId })}</span><ArrowRight /></button><small>#{o.ownerUserId}</small></td>
        <td><strong>{serviceName(o.service)}</strong><small>{countryName(o.country)}{o.durationHours ? adminT("adminText.days", { days: o.durationHours / 24 }) : ''}</small><small title={o.id}>{o.id.slice(0, 8)}</small></td>
        <td>{phone ? <>{phone.callingCode && <small>{phone.callingCode}</small>}<strong>{phone.local}</strong></> : adminT("adminText.noNumberAssigned")}</td><td><span className={`sms-status sms-status-${o.status}`}>{smsStatuses[o.status] ?? o.status}</span></td><td><strong>{adminT("adminText.original")}{o.originalPrice ?? o.price}</strong><small>{adminT("adminText.netCharge")}{o.price}</small><small>{adminT("adminText.refunded")}{o.refundedAmount}</small></td><td>{new Date(o.createdAt).toLocaleString(adminI18n.language === "en" ? "en-US" : "zh-CN")}</td><td><Button size="xs" variant="outline" onClick={() => { setSelected(o.id); resolve.reset(); }}>{adminT("adminText.viewOrder")}</Button></td>
      </tr>; })}</tbody></table></div>}
      <div className="sms-actions"><Button variant="outline" disabled={filter.page <= 1} onClick={() => setFilter(f => ({ ...f, page: f.page - 1 }))}>{adminT("adminText.previousPage")}</Button><span>{adminT("adminText.pageNumber", { page: filter.page })}</span><Button variant="outline" disabled={!orders.data?.data.hasMore} onClick={() => setFilter(f => ({ ...f, page: f.page + 1 }))}>{adminT("adminText.nextPage")}</Button></div>
    </section>
    <AdminSmsOrderDetail selectedId={selected} order={order} serviceName={order ? serviceName(order.service) : ''} countryName={order ? countryName(order.country) : ''} isLoading={detail.isLoading} isError={detail.isError} onRetry={() => detail.refetch()} onClose={() => { setSelected(null); resolve.reset(); }} onOpenCustomer={onOpenCustomer}>
    {order && (order.status === 'needs_review' || resolve.error || resolve.isSuccess) && <section className="admin-drawer-section">{order.status === 'needs_review' && <><header><span>REVIEW</span><h3>{adminT("adminText.exceptionalOrderReview")}</h3></header><form className="sms-form" onSubmit={event => { event.preventDefault(); const f = new FormData(event.currentTarget); resolve.mutate({ ...(String(f.get('activationId') ?? '').trim() ? { activationId: String(f.get('activationId')).trim() } : {}), note: String(f.get('note') ?? ''), ...(f.get('confirmNoPurchase') === 'on' ? { confirmNoPurchase: true } : {}) }); }}>
      <label>{adminT("adminText.verifiedActivationId")}<input name="activationId" inputMode="numeric" defaultValue={order.activationId ?? ''} /></label><label>{adminT("adminText.reviewNotes")}<textarea name="note" minLength={5} maxLength={500} required /></label>
      {!order.activationId && <label><span>{adminT("adminText.manuallyVerifiedThatNoPurchaseSucceededRefund")}</span><input type="checkbox" name="confirmNoPurchase" /></label>}
      <Button type="submit" disabled={resolve.isPending}>{adminT("adminText.submitReview")}</Button>
    </form></>}{resolve.error && <Notice role="alert">{resolve.error.message}</Notice>}{resolve.isSuccess && <Notice role="status">{adminT("adminText.reviewSaved")}</Notice>}</section>}
    </AdminSmsOrderDetail>
  </div>;
}
