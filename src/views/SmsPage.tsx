import { t } from "i18next";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import { Notice } from "../components/ui/notice";
import { useEffect, useState } from 'react';
import { ArrowRight, Globe2, History, MessageSquare, Search, ShieldCheck } from 'lucide-react';
import { useAtomValue } from 'jotai';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { PageShell } from '../components/PageShell';
import { ApiError, createSmsOrder, getSmsCatalog, getSmsOrder, getSmsOrders, getSmsOffers, getSmsQuote, smsOrderAction } from '../api';
import type { SmsOrder } from '../api';
import { sessionAtom, sessionIdentity } from '../state';
import './sms.css';
import { smsPhoneParts } from './smsPhone';

export const smsStatuses: Record<string, string> = { get buying() { return t("serviceText.allocatingNumber"); }, get waiting() { return t("serviceText.waitingForVerificationCode"); }, get received() { return t("serviceText.verificationCodeReceived"); }, get cancel_requested() { return t("serviceText.cancellationPending"); }, get finish_requested() { return t("serviceText.finishing"); }, get finished() { return t("serviceText.ended"); }, get refunded() { return t("serviceText.refundCompleted"); }, get failed() { return t("serviceText.numberAllocationFailedReservedFundsReturned"); }, get needs_review() { return t("serviceText.underReviewDoNotPurchaseAgain"); } };
const finalStatuses = ['finished', 'refunded', 'failed'];
export function SmsOrderDetail({ order, serviceName, countryName, children }: { order: SmsOrder; serviceName?: string; countryName?: string; children?: React.ReactNode }) {
  useTranslation();
  const phone = order.phone ? smsPhoneParts(order.phone) : null;
  const emptyMessage = ({ cancel_requested: t("serviceText.cancellationRequestedCheckingTheResultRefundIsNot"), refunded: t("serviceText.refundReturnedToYourWalletNoLongerWaiting"), finished: t("serviceText.orderEndedNoLongerWaitingForMessages"), failed: t("serviceText.numberAllocationFailedReservedFundsReturnedToYour"), finish_requested: t("serviceText.finishingTheOrderPleaseWaitForTheResult"), needs_review: t("serviceText.thisOrderIsUnderReviewDoNotPurchase"), buying: t("serviceText.allocatingANumberYouCanReceiveMessagesOnce") } as Record<string, string>)[order.status] ?? t("serviceText.noMessagesYetThisOrderUpdatesAutomatically");
  const [copyState, setCopyState] = useState('');
  async function copy(value: string, label: string) {
    try { await navigator.clipboard.writeText(value); setCopyState(t("serviceText.copied", { label: label })); }
    catch { setCopyState(t("serviceText.copyFailedPleaseCopyTheNumberManually")); }
  }
  return <section className="gpt-direct-panel sms-detail" data-testid="sms-order-detail" aria-label={t("serviceText.orderDetails")}>
    <div className="sms-detail-heading"><div><span className="sms-quote-label">{t("serviceText.orderDetails")}</span><h2>{serviceName ?? order.service} · {countryName ?? order.country}</h2></div><span className={`sms-status sms-status-${order.status}`} role="status">{smsStatuses[order.status] ?? t("serviceText.processingOrder")}</span></div>
    <div className="sms-phone-card"><span className="sms-quote-label">{t("serviceText.smsReceivingNumber")}</span>{phone ? <><div className="sms-phone-parts">{phone.callingCode && <div><span>{t("serviceText.countryCallingCode")}</span><strong aria-label={t("serviceText.countryCallingCode")}>{phone.callingCode}</strong></div>}<div><span>{phone.callingCode ? t("serviceText.localNumber") : t("serviceText.phoneNumber")}</span><strong aria-label={phone.callingCode ? t("serviceText.localNumber") : t("serviceText.phoneNumber")}>{phone.local}</strong></div></div><div className="sms-phone-tools"><span className="sms-full-phone">{phone.full}</span><Button variant="outline" size="sm" onClick={() => void copy(phone.full, t("serviceText.fullNumber"))}>{t("serviceText.copyFullNumber")}</Button>{phone.callingCode && <Button variant="outline" size="sm" onClick={() => void copy(phone.local, t("serviceText.localNumber"))}>{t("serviceText.copyLocalNumber")}</Button>}</div><Notice className="sms-note" role="status">{copyState}</Notice></> : <p>{t("serviceText.allocatingANumber")}</p>}</div>
    <div className="sms-message-heading"><h3>{t("serviceText.messagesAndVerificationCodes")}</h3><span>{order.messages.length} {t("serviceText.messages")}</span></div>
    {order.messages.length ? <ul className="sms-messages">{order.messages.map(message => <li key={message.id}>{message.code && <div><span className="sms-quote-label">{t("serviceText.verificationCode")}</span><strong className="sms-code">{message.code}</strong></div>}{message.text && <p>{message.text}</p>}<small>{new Date(message.receivedAt).toLocaleString(i18n.resolvedLanguage)}</small></li>)}</ul> : <div className="sms-waiting"><MessageSquare aria-hidden="true" /><p>{emptyMessage}</p></div>}
    <dl className="sms-order-facts"><div><dt>{t("serviceText.orderAmount")}</dt><dd>USD {order.originalPrice ?? order.price}</dd></div>{Number(order.refundedAmount) > 0 && <div><dt>{t("serviceText.refundedAmount")}</dt><dd>USD {order.refundedAmount}</dd></div>}{order.durationHours && <div><dt>{t("serviceText.rentalPeriod")}</dt><dd>{order.durationHours / 24} {t("serviceText.days")}</dd></div>}{order.cancellationDeadline && <div><dt>{t("serviceText.cancellationRefundDeadline")}</dt><dd>{new Date(order.cancellationDeadline).toLocaleString(i18n.resolvedLanguage)}</dd></div>}{order.expiresAt && <div><dt>{t("serviceText.numberValidUntil")}</dt><dd>{new Date(order.expiresAt).toLocaleString(i18n.resolvedLanguage)}</dd></div>}</dl>
    {children}
    <details className="sms-order-metadata"><summary>{t("serviceText.orderInformation")}</summary><dl><div><dt>{t("serviceText.orderId")}</dt><dd>{order.id}</dd></div><div><dt>{t("serviceText.createdAt")}</dt><dd>{new Date(order.createdAt).toLocaleString(i18n.resolvedLanguage)}</dd></div></dl></details>
  </section>;
}
function savedIntent(key: string): { quoteId: string; key: string } | null {
  try { const value = JSON.parse(sessionStorage.getItem(key) ?? 'null'); return value && typeof value.quoteId === 'string' && typeof value.key === 'string' ? value : null; } catch { return null; }
}
export function SmsPage() {
  useTranslation();
  const session = useAtomValue(sessionAtom);
  const token = session?.token ?? '';
  const client = useQueryClient();
  const identity = sessionIdentity(session);
  const key = ['sms', identity];
  const intentStorage = `sms-purchase:${identity}`;
  const [recovered, setRecovered] = useState(() => !!savedIntent(intentStorage));
  const [service, setService] = useState('tg');
  const [serviceSearch, setServiceSearch] = useState('');
  const [countrySearch, setCountrySearch] = useState('');
  const [countrySort, setCountrySort] = useState('quality');
  const [country, setCountry] = useState('');
  const [durationHours, setDurationHours] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [intent, setIntent] = useState<{ quoteId: string; key: string } | null>(() => savedIntent(intentStorage));
  const [now, setNow] = useState(() => Date.now());
  const catalog = useQuery({ queryKey: [...key, 'catalog'], queryFn: () => getSmsCatalog(token), retry: false });
  const serviceOffers = useQuery({ queryKey: [...key, 'offers'], queryFn: () => getSmsOffers(token), enabled: !!catalog.data?.data.enabled, staleTime: 30000, retry: false });
  const countryOffers = useQuery({ queryKey: [...key, 'offers', service], queryFn: () => getSmsOffers(token, service), enabled: !!catalog.data?.data.enabled && !!service, staleTime: 30000, retry: false });
  const orders = useQuery({ queryKey: [...key, 'orders', page], queryFn: () => getSmsOrders(token, page), refetchInterval: 5000 });
  const detail = useQuery({ queryKey: [...key, 'order', selected], queryFn: () => getSmsOrder(token, selected!), enabled: !!selected, refetchInterval: q => finalStatuses.includes(q.state.data?.data.status ?? '') ? false : 5000 });
  const quote = useMutation({ mutationFn: (selection: { service: string; country: number; durationHours?: number }) => getSmsQuote(token, selection.service, selection.country, selection.durationHours), onSuccess: result => { setIntent({ quoteId: result.data.id, key: crypto.randomUUID() }); buy.reset(); } });
  useEffect(() => {
    if (!quote.data) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(0, Date.parse(quote.data.data.expiresAt) - Date.now()));
    return () => clearTimeout(timer);
  }, [quote.data]);
  async function refresh() { await Promise.all([client.invalidateQueries({ queryKey: key }), client.invalidateQueries({ queryKey: ['dashboard'] }), client.invalidateQueries({ queryKey: ['wallet'] })]); }
  const buy = useMutation({ mutationFn: () => createSmsOrder(token, intent!.quoteId, intent!.key), retry: false, onMutate: () => { if (intent) sessionStorage.setItem(intentStorage, JSON.stringify(intent)); }, onSuccess: result => { sessionStorage.removeItem(intentStorage); setRecovered(false); client.setQueryData([...key, 'order', result.data.id], result); setSelected(result.data.id); setIntent(null); quote.reset(); void refresh(); }, onError: error => { if (error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 408) { sessionStorage.removeItem(intentStorage); setRecovered(false); setIntent(null); quote.reset(); } } });
  const action = useMutation({ mutationFn: (value: 'cancel' | 'finish') => smsOrderAction(token, selected!, value), onSuccess: result => { client.setQueryData([...key, 'order', result.data.id], result); void refresh(); } });
  const uncertain = recovered || (!!buy.error && !(buy.error instanceof ApiError && buy.error.status >= 400 && buy.error.status < 500 && buy.error.status !== 408));
  const order = detail.data?.data ?? orders.data?.data.list.find(o => o.id === selected);
  const cooldown = order?.cancelAvailableAt ? Math.max(0, Math.ceil((Date.parse(order.cancelAvailableAt) - now) / 1000)) : 0;
  useEffect(() => {
    if (!order?.cancelAvailableAt || finalStatuses.includes(order.status)) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [order?.id, order?.cancelAvailableAt, order?.status]);
  const fresh = quote.data && Date.parse(quote.data.data.expiresAt) > now;
  function resetQuote() { quote.reset(); setIntent(null); buy.reset(); }
  const services = catalog.data?.data.services.map(item => item.code === 'full' ? { ...item, name: t("serviceText.fullRental") } : item) ?? [];
  const countries = catalog.data?.data.countries.map(item => ({
    ...item,
    name: i18n.resolvedLanguage?.startsWith('zh') ? item.name : item.nameEn?.trim() || (/^[\x20-\x7E]+$/.test(item.name) ? item.name : String(item.id)),
  })) ?? [];
  const servicePrices = new Map(serviceOffers.data?.data.services?.map(o => [o.service, o]));
  const fullRent = service === 'full';
  const durations = [...new Set(countryOffers.data?.data.countries?.flatMap(o => o.durationHours && o.count > 0 ? [o.durationHours] : []) ?? [])].sort((a, b) => a - b);
  const selectedDuration = durationHours !== null && durations.includes(durationHours) ? durationHours : durations[0];
  const countryPrices = new Map(countryOffers.data?.data.countries?.filter(o => !fullRent || o.durationHours === selectedDuration).map(o => [o.country, o]));
  const rankField = countrySort === 'popularity' ? 'popularityRank' : 'qualityRank';
  const noRanks = ['quality', 'popularity'].includes(countrySort) && ![...countryPrices.values()].some(offer => offer[rankField] != null);
  const pricesUnavailable = countryOffers.isError || countryOffers.data?.data.unavailableServices?.includes(service);
  return <PageShell className="sms-page" title={t("serviceText.smsVerificationService")} eyebrow="SMS" description={t("serviceText.chooseAServiceAndCountryPurchaseANumber")}>
    <div className="sms-layout">
      <section className="sms-browse-surface"><h2 className="sr-only">{t("serviceText.browseServicesAndPrices")}</h2>
        {catalog.isLoading && <p>{t("serviceText.loadingServices")}</p>}
        {catalog.isError && <Notice role="alert">{t("serviceText.failedToLoadServices")}<Button onClick={() => void catalog.refetch()}>{t("serviceText.retry")}</Button></Notice>}
        {catalog.data && !catalog.data.data.enabled && <Notice role="status">{t("serviceText.thisServiceIsNotYetAvailableExistingOrders")}</Notice>}
        <div className="sms-browser">
          <section className="gpt-direct-panel sms-services" aria-label={t("serviceText.chooseAService")}>
            <div className="section-title"><div><h2><MessageSquare aria-hidden="true" />{t("serviceText.chooseAService")}</h2><p>{t("serviceText.browseStartingPricesAndChooseThePlatformYou")}</p></div><span>{services.length} {t("serviceText.services")}</span></div>
            <label className="sms-search"><span className="sr-only">{t("serviceText.searchServices")}</span><Search aria-hidden="true" /><input type="search" aria-label={t("serviceText.searchServices")} placeholder={t("serviceText.searchTelegramOpenai")} value={serviceSearch} onChange={e => setServiceSearch(e.target.value)} disabled={buy.isPending || quote.isPending || uncertain} /></label>
            {serviceOffers.isPending && catalog.data?.data.enabled && <p role="status">{t("serviceText.loadingPricesAndAvailability")}</p>}
            {serviceOffers.isError && <Notice role="alert">{t("serviceText.failedToLoadPrices")}<Button onClick={() => void serviceOffers.refetch()}>{t("serviceText.retryPrices")}</Button></Notice>}
            <div className="sms-service-list">{services.filter(s => `${s.name} ${s.code}`.toLowerCase().includes(serviceSearch.trim().toLowerCase())).sort((a, b) => (servicePrices.get(a.code)?.popularityRank ?? Infinity) - (servicePrices.get(b.code)?.popularityRank ?? Infinity)).map(s => {
              const offer = servicePrices.get(s.code);
              return <button type="button" key={s.code} className={`sms-service-option${service === s.code ? ' is-selected' : ''}`} aria-label={t("serviceText.chooseService", { service: s.name })} aria-pressed={service === s.code} disabled={buy.isPending || quote.isPending || uncertain} onClick={() => { setService(s.code); setDurationHours(null); setCountry(''); setCountrySearch(''); resetQuote(); }}><span className="sms-service-mark" aria-hidden="true">{s.name.slice(0, 2).toUpperCase()}</span><span className="sms-service-info"><span className="sms-service-name">{s.name}{s.code === 'full' && <small className="sms-rent-badge">{t("serviceText.fullRental")}</small>}</span><span className="sms-note">{serviceOffers.isError || serviceOffers.data?.data.unavailableServices?.includes(s.code) ? t("serviceText.priceUnavailable") : offer ? t("serviceText.numbers", { count: offer.count.toLocaleString(i18n.resolvedLanguage) }) : serviceOffers.data ? t("serviceText.outOfStock") : t("serviceText.loadingPrices")}</span></span><span className="sms-service-price">{offer ? <><strong><small>USD</small> {offer.price}</strong><small>{t("serviceText.from")}</small></> : '—'}</span></button>;
            })}</div>
            {catalog.data && !services.some(s => `${s.name} ${s.code}`.toLowerCase().includes(serviceSearch.trim().toLowerCase())) && <p>{t("serviceText.noMatchingServices")}</p>}
          </section>
          <section className="gpt-direct-panel sms-countries" aria-label={t("serviceText.countryPricesAndAvailability")}>
            <div className="section-title"><div><h2><Globe2 aria-hidden="true" />{services.find(s => s.code === service)?.name ?? t("serviceText.chooseAServiceFirst")}</h2><p>{t("serviceText.chooseACountryOrRegionForTheLatest")}</p></div><span>{t("serviceText.billedInUsd")}</span></div>
            <label className="sms-search"><span className="sr-only">{t("serviceText.searchCountriesOrRegions")}</span><Search aria-hidden="true" /><input type="search" aria-label={t("serviceText.searchCountriesOrRegions")} placeholder={t("serviceText.searchCountriesOrRegions")} value={countrySearch} onChange={e => setCountrySearch(e.target.value)} disabled={buy.isPending || quote.isPending || uncertain} /></label>
            {fullRent && <label className="sms-duration">{t("serviceText.rentalPeriod")}<select aria-label={t("serviceText.rentalPeriod")} value={selectedDuration ?? ''} disabled={!durations.length || buy.isPending || quote.isPending || uncertain} onChange={e => { setDurationHours(Number(e.target.value)); setCountry(''); resetQuote(); }}>{durations.map(hours => <option key={hours} value={hours}>{hours / 24} {t("serviceText.days")}</option>)}</select><span>{t("serviceText.receiveMultipleMessagesAcrossPlatforms")}</span></label>}
            <div className="sms-sort"><label>{t("serviceText.sortBy")}<select aria-label={t("serviceText.sortBy")} value={countrySort} onChange={e => setCountrySort(e.target.value)}><option value="quality">{t("serviceText.quality")}</option><option value="popularity">{t("serviceText.popularity")}</option><option value="cheap">{t("serviceText.lowestPrice")}</option><option value="expensive">{t("serviceText.highestPrice")}</option><option value="quantity">{t("serviceText.quantity")}</option></select></label>{noRanks && countryOffers.data && <span className="sms-note">{t("serviceText.noQualityOrPopularityDataShowingByAvailable")}</span>}</div>
            <div className="sms-list-heading" aria-hidden="true"><span>{t("serviceText.countryRegion")}</span><span>{t("serviceText.availableNumbers")}</span><span>{t("serviceText.smsPrice")}</span><span /></div>
            {countryOffers.isLoading && <p role="status">{t("serviceText.loadingCountryPricesAndAvailability")}</p>}
            {pricesUnavailable && <Notice role="alert">{t("serviceText.countryPricesAreTemporarilyUnavailable")}<Button onClick={() => void countryOffers.refetch()}>{t("serviceText.retryCountryPrices")}</Button></Notice>}
            {countryOffers.data && !pricesUnavailable && <div className="sms-country-list">{countries.filter(c => `${c.name} ${c.id}`.toLowerCase().includes(countrySearch.trim().toLowerCase())).sort((a, b) => {
              const left = countryPrices.get(a.id);
              const right = countryPrices.get(b.id);
              const availability = Number(!left) - Number(!right);
              if (availability) return availability;
              let difference = 0;
              if (left && right) {
                if (countrySort === 'cheap') difference = Number(left.price) - Number(right.price);
                else if (countrySort === 'expensive') difference = Number(right.price) - Number(left.price);
                else if (countrySort === 'quantity' || noRanks) difference = right.count - left.count;
                else difference = (left[rankField] ?? Infinity) - (right[rankField] ?? Infinity);
              }
              return difference || a.name.localeCompare(b.name, i18n.resolvedLanguage);
            }).map(c => {
              const offer = countryPrices.get(c.id);
              return <article key={c.id} data-testid={`sms-country-${c.id}`} className={country === String(c.id) ? 'is-selected' : ''}><div className="sms-country-name"><span className="sms-country-mark" aria-hidden="true"><Globe2 /></span><strong>{c.name}</strong></div><span className={`sms-stock${offer ? ' is-available' : ''}`}>{offer ? <><i aria-hidden="true" />{offer.count.toLocaleString(i18n.resolvedLanguage)}<span className="sr-only"> {t("serviceText.numbers2")}</span></> : fullRent ? t("serviceText.outOfStockForThisRentalPeriod") : t("serviceText.outOfStock")}</span><div className="sms-country-price">{offer ? <strong><small>USD</small> {offer.price}</strong> : <span>—</span>}</div><Button variant="outline" size="sm" aria-label={t("serviceText.getQuoteFor", { country: c.name })} disabled={!offer || !catalog.data?.data.enabled || buy.isPending || quote.isPending || uncertain} onClick={() => { setCountry(String(c.id)); resetQuote(); quote.mutate({ service, country: c.id, ...(fullRent ? { durationHours: selectedDuration } : {}) }); }}>{quote.isPending && country === String(c.id) ? t("serviceText.gettingQuote") : offer ? <>{t("serviceText.getQuote")}<ArrowRight aria-hidden="true" /></> : t("serviceText.outOfStock")}</Button></article>;
            })}</div>}
            {countryOffers.data && catalog.data && !countries.some(c => `${c.name} ${c.id}`.toLowerCase().includes(countrySearch.trim().toLowerCase())) && <p>{t("serviceText.noMatchingCountriesOrRegions")}</p>}
          </section>
        </div>
        {quote.data && <div className="gpt-direct-panel sms-quote" data-testid="sms-quote"><div><span className="sms-quote-label">{t("serviceText.totalSmsPrice")}</span><strong className="sms-quote-total"><small>USD</small> {quote.data.data.price}</strong></div><div className="sms-quote-context"><strong>{services.find(s => s.code === service)?.name ?? service} · {countries.find(c => String(c.id) === country)?.name ?? country}{quote.data.data.durationHours && t("serviceText.days2", { days: quote.data.data.durationHours / 24 })}</strong><p>{fresh ? t("serviceText.quoteValidFor60SecondsFundsAreReserved") : t("serviceText.quoteExpiredPleaseRequestANewQuote")}</p></div><Button disabled={!fresh || !intent || buy.isPending} onClick={() => buy.mutate()}>{buy.isPending ? t("serviceText.submitting") : t("serviceText.confirmPurchase")}<ArrowRight aria-hidden="true" /></Button></div>}
        {quote.error && <Notice role="alert">{quote.error.message}</Notice>}
        {buy.error && !uncertain && <Notice role="alert">{buy.error.message}</Notice>}
        {uncertain && <Notice role="alert"><p>{t("serviceText.submissionResultIsNotYetConfirmedRefreshYour")}</p><Button onClick={() => void refresh()}>{t("serviceText.refreshOrderList")}</Button>{intent && <Button disabled={buy.isPending} onClick={() => buy.mutate()}>{t("serviceText.retrySameOrder")}</Button>}</Notice>}
        <p className="sms-note sms-policy"><ShieldCheck aria-hidden="true" /><span>{fullRent ? t("serviceText.fullRentalReceivesMultipleMessagesAcrossPlatformsUntil") : t("serviceText.chargedPerNumberOrderAdditionalMessagesIncurNo")}</span></p>
      </section>
      {order && <SmsOrderDetail order={order} serviceName={services.find(s => s.code === order.service)?.name} countryName={countries.find(c => c.id === order.country)?.name}>{cooldown > 0 && order.messages.length === 0 && ['waiting', 'buying'].includes(order.status) && <p className="sms-cooldown" role="status">{Math.floor(cooldown / 60)}:{String(cooldown % 60).padStart(2, '0')} {t("serviceText.untilCancellationIsAvailableOnlyIfNoMessages")}</p>}<div className="sms-actions"><Button variant="outline" onClick={() => void detail.refetch()}>{t("serviceText.refreshOrder")}</Button><Button variant="outline" disabled={action.isPending || !order.canCancel || cooldown > 0 || order.messages.length > 0 || !['waiting', 'buying'].includes(order.status)} onClick={() => action.mutate('cancel')}>{t("serviceText.cancelAndRequestRefund")}</Button><Button disabled={action.isPending || !['waiting', 'received'].includes(order.status)} onClick={() => action.mutate('finish')}>{t("serviceText.endOrder")}</Button></div>{action.error && <Notice role="alert">{action.error.message}</Notice>}{detail.isError && <Notice role="alert">{t("serviceText.orderUpdateFailedRefreshToRetry")}</Notice>}</SmsOrderDetail>}
    </div>
    <section className="transaction-panel sms-history"><div className="section-title"><div><h2><History aria-hidden="true" />{t("serviceText.orderHistory")}</h2><p>{t("serviceText.viewPurchasedNumbersVerificationCodesAndRefundProgress")}</p></div><span>{t("serviceText.page")}{page} {t("serviceText.pagesuffix")}</span></div>{orders.isError && <Notice role="alert">{t("serviceText.failedToLoadOrders")}<Button onClick={() => void orders.refetch()}>{t("serviceText.retry")}</Button></Notice>}{orders.isLoading && <p>{t("serviceText.loadingOrders")}</p>}{orders.data?.data.list.length === 0 && <div className="sms-empty"><MessageSquare aria-hidden="true" /><strong>{t("serviceText.noSmsOrdersYet")}</strong><p>{t("serviceText.chooseAServiceAndCountryYourOrderWill")}</p></div>}
      <div className="sms-order-list">{orders.data?.data.list.map(o => { const phone = o.phone ? smsPhoneParts(o.phone) : null; return <article key={o.id}><div className="sms-history-main"><strong>{services.find(s => s.code === o.service)?.name ?? o.service} · {countries.find(c => c.id === o.country)?.name ?? o.country}</strong><p className="sms-history-phone">{phone ? <>{phone.callingCode && <small className="sms-history-calling-code">{phone.callingCode} </small>}<span>{phone.local}</span></> : t("serviceText.allocatingNumber")}{o.durationHours && <span className="sms-note"> · {o.durationHours / 24} {t("serviceText.days")}</span>}</p><div className="sms-history-meta"><span className={`sms-status sms-status-${o.status}`}>{smsStatuses[o.status] ?? t("serviceText.processing")}</span><span>USD {o.originalPrice ?? o.price}</span>{o.messages.some(m => m.code) && <span className="sms-history-code">{t("serviceText.verificationCode")} {o.messages.filter(m => m.code).map(m => m.code).join(' · ')}</span>}</div>{o.cancellationDeadline && <span className="sms-note">{t("serviceText.cancellationRefundDeadline2")}{new Date(o.cancellationDeadline).toLocaleString(i18n.resolvedLanguage)}</span>}</div><Button variant="outline" size="sm" onClick={() => { setSelected(o.id); action.reset(); }}>{t("serviceText.viewOrder")}</Button></article>; })}</div>
      <div className="sms-actions sms-pagination"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>{t("serviceText.previous")}</Button><span>{t("serviceText.page")}{page} {t("serviceText.pagesuffix")}</span><Button variant="outline" disabled={!orders.data?.data.hasMore} onClick={() => setPage(p => p + 1)}>{t("serviceText.next")}</Button></div>
    </section>
  </PageShell>;
}
