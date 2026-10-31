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

export const smsStatuses: Record<string, string> = { buying: '正在取号', waiting: '等待验证码', received: '已收到验证码', cancel_requested: '取消处理中', finish_requested: '正在结束', finished: '已结束', refunded: '退款完成', failed: '取号失败，已退回预扣金额', needs_review: '待核对，请勿重复购买' };
const finalStatuses = ['finished', 'refunded', 'failed'];
export function SmsOrderDetail({ order, serviceName, countryName, children }: { order: SmsOrder; serviceName?: string; countryName?: string; children?: React.ReactNode }) {
  const phone = order.phone ? smsPhoneParts(order.phone) : null;
  const emptyMessage = ({ cancel_requested: '取消申请已提交，正在确认结果；退款尚未完成。', refunded: '退款已退回钱包，不再等待短信。', finished: '订单已结束，不再等待短信。', failed: '取号失败，预扣金额已退回钱包。', finish_requested: '正在结束订单，请等待处理结果。', needs_review: '订单正在核对，请勿重复购买。', buying: '正在分配号码，分配成功后即可等待短信。' } as Record<string, string>)[order.status] ?? '尚未收到短信，订单会自动更新。';
  const [copyState, setCopyState] = useState('');
  async function copy(value: string, label: string) {
    try { await navigator.clipboard.writeText(value); setCopyState(`${label}已复制`); }
    catch { setCopyState('复制失败，请手动复制号码'); }
  }
  return <section className="gpt-direct-panel sms-detail" data-testid="sms-order-detail" aria-label="订单详情">
    <div className="sms-detail-heading"><div><span className="sms-quote-label">订单详情</span><h2>{serviceName ?? order.service} · {countryName ?? order.country}</h2></div><span className={`sms-status sms-status-${order.status}`} role="status">{smsStatuses[order.status] ?? '订单处理中'}</span></div>
    <div className="sms-phone-card"><span className="sms-quote-label">接收短信号码</span>{phone ? <><div className="sms-phone-parts">{phone.callingCode && <div><span>国家区号</span><strong aria-label="国家区号">{phone.callingCode}</strong></div>}<div><span>{phone.callingCode ? '本地号码' : '手机号码'}</span><strong aria-label={phone.callingCode ? '本地号码' : '手机号码'}>{phone.local}</strong></div></div><div className="sms-phone-tools"><span className="sms-full-phone">{phone.full}</span><Button variant="outline" size="sm" onClick={() => void copy(phone.full, '完整号码')}>复制完整号码</Button>{phone.callingCode && <Button variant="outline" size="sm" onClick={() => void copy(phone.local, '本地号码')}>复制本地号码</Button>}</div><span className="sms-note" role="status">{copyState}</span></> : <p>正在分配号码</p>}</div>
    <div className="sms-message-heading"><h3>短信与验证码</h3><span>{order.messages.length} 条短信</span></div>
    {order.messages.length ? <ul className="sms-messages">{order.messages.map(message => <li key={message.id}>{message.code && <div><span className="sms-quote-label">验证码</span><strong className="sms-code">{message.code}</strong></div>}{message.text && <p>{message.text}</p>}<small>{new Date(message.receivedAt).toLocaleString()}</small></li>)}</ul> : <div className="sms-waiting"><MessageSquare aria-hidden="true" /><p>{emptyMessage}</p></div>}
    <dl className="sms-order-facts"><div><dt>订单金额</dt><dd>USD {order.originalPrice ?? order.price}</dd></div>{Number(order.refundedAmount) > 0 && <div><dt>已退金额</dt><dd>USD {order.refundedAmount}</dd></div>}{order.durationHours && <div><dt>租期</dt><dd>{order.durationHours / 24} 天</dd></div>}{order.cancellationDeadline && <div><dt>取消退款截止</dt><dd>{new Date(order.cancellationDeadline).toLocaleString()}</dd></div>}{order.expiresAt && <div><dt>号码有效期至</dt><dd>{new Date(order.expiresAt).toLocaleString()}</dd></div>}</dl>
    {children}
    <details className="sms-order-metadata"><summary>订单信息</summary><dl><div><dt>订单号</dt><dd>{order.id}</dd></div><div><dt>创建时间</dt><dd>{new Date(order.createdAt).toLocaleString()}</dd></div></dl></details>
  </section>;
}
function savedIntent(key: string): { quoteId: string; key: string } | null {
  try { const value = JSON.parse(sessionStorage.getItem(key) ?? 'null'); return value && typeof value.quoteId === 'string' && typeof value.key === 'string' ? value : null; } catch { return null; }
}
export function SmsPage() {
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
  const servicePrices = new Map(serviceOffers.data?.data.services?.map(o => [o.service, o]));
  const fullRent = service === 'full';
  const durations = [...new Set(countryOffers.data?.data.countries?.flatMap(o => o.durationHours && o.count > 0 ? [o.durationHours] : []) ?? [])].sort((a, b) => a - b);
  const selectedDuration = durationHours !== null && durations.includes(durationHours) ? durationHours : durations[0];
  const countryPrices = new Map(countryOffers.data?.data.countries?.filter(o => !fullRent || o.durationHours === selectedDuration).map(o => [o.country, o]));
  const rankField = countrySort === 'popularity' ? 'popularityRank' : 'qualityRank';
  const noRanks = ['quality', 'popularity'].includes(countrySort) && ![...countryPrices.values()].some(offer => offer[rankField] != null);
  const pricesUnavailable = countryOffers.isError || countryOffers.data?.data.unavailableServices?.includes(service);
  return <PageShell className="sms-page" title="收取验证码服务" eyebrow="SMS" description="选择服务和国家，购买号码并接收短信验证码。按号码订单收费，同一订单多条短信不重复扣费。">
    <div className="sms-layout">
      <section className="sms-browse-surface"><h2 className="sr-only">浏览服务与价格</h2>
        {catalog.isLoading && <p>正在加载服务…</p>}
        {catalog.isError && <p role="alert">服务加载失败。<Button onClick={() => void catalog.refetch()}>重试</Button></p>}
        {catalog.data && !catalog.data.data.enabled && <p role="status">服务暂未开放，已有订单仍会继续处理。</p>}
        <div className="sms-browser">
          <section className="gpt-direct-panel sms-services" aria-label="选择服务">
            <div className="section-title"><div><h2><MessageSquare aria-hidden="true" />选择服务</h2><p>浏览起价，选择需要接收验证码的平台</p></div><span>{catalog.data?.data.services.length ?? 0} 项</span></div>
            <label className="sms-search"><span className="sr-only">搜索服务</span><Search aria-hidden="true" /><input type="search" aria-label="搜索服务" placeholder="搜索 Telegram、OpenAI…" value={serviceSearch} onChange={e => setServiceSearch(e.target.value)} disabled={buy.isPending || quote.isPending || uncertain} /></label>
            {serviceOffers.isPending && catalog.data?.data.enabled && <p role="status">正在加载价格与库存…</p>}
            {serviceOffers.isError && <p role="alert">价格加载失败。<Button onClick={() => void serviceOffers.refetch()}>重试价格</Button></p>}
            <div className="sms-service-list">{catalog.data?.data.services.filter(s => `${s.name} ${s.code}`.toLowerCase().includes(serviceSearch.trim().toLowerCase())).sort((a, b) => (servicePrices.get(a.code)?.popularityRank ?? Infinity) - (servicePrices.get(b.code)?.popularityRank ?? Infinity)).map(s => {
              const offer = servicePrices.get(s.code);
              return <button type="button" key={s.code} className={`sms-service-option${service === s.code ? ' is-selected' : ''}`} aria-label={`选择服务 ${s.name}`} aria-pressed={service === s.code} disabled={buy.isPending || quote.isPending || uncertain} onClick={() => { setService(s.code); setDurationHours(null); setCountry(''); setCountrySearch(''); resetQuote(); }}><span className="sms-service-mark" aria-hidden="true">{s.name.slice(0, 2).toUpperCase()}</span><span className="sms-service-info"><span className="sms-service-name">{s.name}{s.code === 'full' && <small className="sms-rent-badge">全租</small>}</span><span className="sms-note">{serviceOffers.isError || serviceOffers.data?.data.unavailableServices?.includes(s.code) ? '价格暂不可获取' : offer ? `${offer.count.toLocaleString()} 个号码` : serviceOffers.data ? '暂无库存' : '价格加载中'}</span></span><span className="sms-service-price">{offer ? <><strong><small>USD</small> {offer.price}</strong><small>起</small></> : '—'}</span></button>;
            })}</div>
            {catalog.data && !catalog.data.data.services.some(s => `${s.name} ${s.code}`.toLowerCase().includes(serviceSearch.trim().toLowerCase())) && <p>未找到匹配的服务</p>}
          </section>
          <section className="gpt-direct-panel sms-countries" aria-label="国家价格与库存">
            <div className="section-title"><div><h2><Globe2 aria-hidden="true" />{catalog.data?.data.services.find(s => s.code === service)?.name ?? '请选择服务'}</h2><p>选择国家或地区，获取最新收码报价</p></div><span>USD 结算</span></div>
            <label className="sms-search"><span className="sr-only">搜索国家或地区</span><Search aria-hidden="true" /><input type="search" aria-label="搜索国家或地区" placeholder="搜索国家或地区" value={countrySearch} onChange={e => setCountrySearch(e.target.value)} disabled={buy.isPending || quote.isPending || uncertain} /></label>
            {fullRent && <label className="sms-duration">租期<select aria-label="租期" value={selectedDuration ?? ''} disabled={!durations.length || buy.isPending || quote.isPending || uncertain} onChange={e => { setDurationHours(Number(e.target.value)); setCountry(''); resetQuote(); }}>{durations.map(hours => <option key={hours} value={hours}>{hours / 24} 天</option>)}</select><span>跨平台接收多条短信</span></label>}
            <div className="sms-sort"><label>排序方式<select aria-label="排序方式" value={countrySort} onChange={e => setCountrySort(e.target.value)}><option value="quality">按质量排序</option><option value="popularity">按受欢迎度</option><option value="cheap">便宜一点</option><option value="expensive">贵一点</option><option value="quantity">按数量</option></select></label>{noRanks && countryOffers.data && <span className="sms-note">暂无质量/热度数据，按库存数量展示</span>}</div>
            <div className="sms-list-heading" aria-hidden="true"><span>国家 / 地区</span><span>可用号码</span><span>收码价格</span><span /></div>
            {countryOffers.isLoading && <p role="status">正在加载国家价格与库存…</p>}
            {pricesUnavailable && <p role="alert">国家价格暂不可获取。<Button onClick={() => void countryOffers.refetch()}>重试国家价格</Button></p>}
            {countryOffers.data && !pricesUnavailable && <div className="sms-country-list">{catalog.data?.data.countries.filter(c => `${c.name} ${c.id}`.toLowerCase().includes(countrySearch.trim().toLowerCase())).sort((a, b) => {
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
              return difference || a.name.localeCompare(b.name, 'zh-CN');
            }).map(c => {
              const offer = countryPrices.get(c.id);
              return <article key={c.id} data-testid={`sms-country-${c.id}`} className={country === String(c.id) ? 'is-selected' : ''}><div className="sms-country-name"><span className="sms-country-mark" aria-hidden="true"><Globe2 /></span><strong>{c.name}</strong></div><span className={`sms-stock${offer ? ' is-available' : ''}`}>{offer ? <><i aria-hidden="true" />{offer.count.toLocaleString()}<span className="sr-only"> 个号码</span></> : fullRent ? '此租期暂无库存' : '暂无库存'}</span><div className="sms-country-price">{offer ? <strong><small>USD</small> {offer.price}</strong> : <span>—</span>}</div><Button variant="outline" size="sm" aria-label={`获取报价 ${c.name}`} disabled={!offer || !catalog.data?.data.enabled || buy.isPending || quote.isPending || uncertain} onClick={() => { setCountry(String(c.id)); resetQuote(); quote.mutate({ service, country: c.id, ...(fullRent ? { durationHours: selectedDuration } : {}) }); }}>{quote.isPending && country === String(c.id) ? '正在获取报价…' : offer ? <>获取报价<ArrowRight aria-hidden="true" /></> : '暂无库存'}</Button></article>;
            })}</div>}
            {countryOffers.data && catalog.data && !catalog.data.data.countries.some(c => `${c.name} ${c.id}`.toLowerCase().includes(countrySearch.trim().toLowerCase())) && <p>未找到匹配的国家或地区</p>}
          </section>
        </div>
        {quote.data && <div className="gpt-direct-panel sms-quote" data-testid="sms-quote"><div><span className="sms-quote-label">本次收码总价</span><strong className="sms-quote-total"><small>USD</small> {quote.data.data.price}</strong></div><div className="sms-quote-context"><strong>{catalog.data?.data.services.find(s => s.code === service)?.name ?? service} · {catalog.data?.data.countries.find(c => String(c.id) === country)?.name ?? country}{quote.data.data.durationHours && ` · ${quote.data.data.durationHours / 24} 天`}</strong><p>{fresh ? '报价有效期 60 秒，确认后从钱包预扣。' : '报价已过期，请重新获取报价。'}</p></div><Button disabled={!fresh || !intent || buy.isPending} onClick={() => buy.mutate()}>{buy.isPending ? '正在提交…' : '确认购买'}<ArrowRight aria-hidden="true" /></Button></div>}
        {quote.error && <p role="alert">{quote.error.message}</p>}
        {buy.error && !uncertain && <p role="alert">{buy.error.message}</p>}
        {uncertain && <div role="alert"><p>提交结果暂未确认。请先刷新订单；重试提交会使用同一请求，不重复购买。</p><Button onClick={() => void refresh()}>刷新订单列表</Button>{intent && <Button disabled={buy.isPending} onClick={() => buy.mutate()}>重试同一订单</Button>}</div>}
        <p className="sms-note sms-policy"><ShieldCheck aria-hidden="true" /><span>{fullRent ? '全租支持跨平台接收多条短信，持续收码直至租期结束。购买满2分钟后、20分钟内且未收短信可申请退款，确认退款后退回钱包；超过窗口不会因无短信自动退款，已收码或主动结束不退款。' : '按号码订单收费，同一订单多条短信不重复扣费。购买满2分钟且未收短信可申请取消，确认退款后退回钱包；已收码或主动结束不退款。'}</span></p>
      </section>
      {order && <SmsOrderDetail order={order} serviceName={catalog.data?.data.services.find(s => s.code === order.service)?.name} countryName={catalog.data?.data.countries.find(c => c.id === order.country)?.name}>{cooldown > 0 && order.messages.length === 0 && ['waiting', 'buying'].includes(order.status) && <p className="sms-cooldown" role="status">{Math.floor(cooldown / 60)}:{String(cooldown % 60).padStart(2, '0')} 后可申请取消，仅限未收到短信</p>}<div className="sms-actions"><Button variant="outline" onClick={() => void detail.refetch()}>刷新订单</Button><Button variant="outline" disabled={action.isPending || !order.canCancel || cooldown > 0 || order.messages.length > 0 || !['waiting', 'buying'].includes(order.status)} onClick={() => action.mutate('cancel')}>取消并申请退款</Button><Button disabled={action.isPending || !['waiting', 'received'].includes(order.status)} onClick={() => action.mutate('finish')}>结束订单</Button></div>{action.error && <p role="alert">{action.error.message}</p>}{detail.isError && <p role="alert">订单更新失败，请刷新重试。</p>}</SmsOrderDetail>}
    </div>
    <section className="transaction-panel sms-history"><div className="section-title"><div><h2><History aria-hidden="true" />订单历史</h2><p>查看已购买的号码、验证码及退款进度</p></div><span>第 {page} 页</span></div>{orders.isError && <p role="alert">订单加载失败。<Button onClick={() => void orders.refetch()}>重试</Button></p>}{orders.isLoading && <p>正在加载订单…</p>}{orders.data?.data.list.length === 0 && <div className="sms-empty"><MessageSquare aria-hidden="true" /><strong>暂无收码订单</strong><p>选择服务和国家，确认购买后将在这里显示。</p></div>}
      <div className="sms-order-list">{orders.data?.data.list.map(o => { const phone = o.phone ? smsPhoneParts(o.phone) : null; return <article key={o.id}><div className="sms-history-main"><strong>{catalog.data?.data.services.find(s => s.code === o.service)?.name ?? o.service} · {catalog.data?.data.countries.find(c => c.id === o.country)?.name ?? o.country}</strong><p className="sms-history-phone">{phone ? <>{phone.callingCode && <small className="sms-history-calling-code">{phone.callingCode} </small>}<span>{phone.local}</span></> : '正在取号'}{o.durationHours && <span className="sms-note"> · {o.durationHours / 24} 天</span>}</p><div className="sms-history-meta"><span className={`sms-status sms-status-${o.status}`}>{smsStatuses[o.status] ?? '处理中'}</span><span>USD {o.originalPrice ?? o.price}</span>{o.messages.some(m => m.code) && <span className="sms-history-code">验证码 {o.messages.filter(m => m.code).map(m => m.code).join(' · ')}</span>}</div>{o.cancellationDeadline && <p className="sms-note">取消退款截止：{new Date(o.cancellationDeadline).toLocaleString()}</p>}</div><Button variant="outline" size="sm" onClick={() => { setSelected(o.id); action.reset(); }}>查看订单</Button></article>; })}</div>
      <div className="sms-actions sms-pagination"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>上一页</Button><span>第 {page} 页</span><Button variant="outline" disabled={!orders.data?.data.hasMore} onClick={() => setPage(p => p + 1)}>下一页</Button></div>
    </section>
  </PageShell>;
}
