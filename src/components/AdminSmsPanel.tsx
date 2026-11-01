import { Notice } from "./ui/notice";
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { getAdminSmsSettings, updateAdminSmsSettings, getAdminSmsOrders, getAdminSmsOrder, resolveAdminSmsOrder } from '../api';
import { SmsOrderDetail, smsStatuses } from '../views/SmsPage';
import '../views/sms.css';

export function AdminSmsPanel({ token }: { token: string }) {
  const client = useQueryClient();
  const [draft, setDraft] = useState<{ enabled: boolean; markupPercent: string } | null>(null);
  const [filter, setFilter] = useState({ page: 1, status: '', userId: undefined as number | undefined });
  const [selected, setSelected] = useState<string | null>(null);
  const settings = useQuery({ queryKey: ['admin-sms-settings'], queryFn: () => getAdminSmsSettings(token), retry: false });
  const orders = useQuery({ queryKey: ['admin-sms-orders', filter], queryFn: () => getAdminSmsOrders(token, filter), retry: false, refetchInterval: 10000 });
  const detail = useQuery({ queryKey: ['admin-sms-order', selected], queryFn: () => getAdminSmsOrder(token, selected!), enabled: !!selected, retry: false });
  const save = useMutation({ mutationFn: () => updateAdminSmsSettings(token, { ...current!, version: settings.data!.data.version }), onSuccess: data => { client.setQueryData(['admin-sms-settings'], data); setDraft(null); } });
  const resolve = useMutation({ mutationFn: (input: { activationId?: string; note: string; confirmNoPurchase?: boolean }) => resolveAdminSmsOrder(token, selected!, input), onSuccess: data => { client.setQueryData(['admin-sms-order', selected], data); void client.invalidateQueries({ queryKey: ['admin-sms-orders'] }); } });
  const current = draft ?? settings.data?.data;
  const order = detail.data?.data;
  const validPercent = current && /^(0|[1-9]\d{0,7})(\.\d{1,2})?$/.test(current.markupPercent);
  return <div className="admin-panel-stack" data-testid="admin-panel-sms">
    <div className="admin-panel-heading"><div><span className="admin-kicker">SMS</span><h2>收取验证码服务</h2><p>管理全站收码售价、服务开关及异常订单。费率修改仅影响新订单。</p></div></div>
    <section className="sms-surface"><h3>服务设置</h3>{settings.isError && <Notice role="alert">设置加载失败。<Button onClick={() => void settings.refetch()}>重试</Button></Notice>}
      {current && <form className="sms-form" onSubmit={event => { event.preventDefault(); save.mutate(); }}>
        <label><span>开放收码购买</span><input type="checkbox" checked={current.enabled} onChange={e => { setDraft({ enabled: e.target.checked, markupPercent: current.markupPercent }); save.reset(); }} /></label>
        <label>加价比例（%）<input type="number" min="0" max="99999999" step="0.01" value={current.markupPercent} onChange={e => { setDraft({ enabled: current.enabled, markupPercent: e.target.value }); save.reset(); }} required /></label>
        <p className="sms-note">售价＝成本 ×（1＋加价比例）。成本 $1、比例 10% 时，客户支付 $1.10。按四位小数向上取整。</p>
        <p>密钥：{settings.data?.data.configured ? '已配置' : '未配置'}；真实购买：{settings.data?.data.purchasesReady ? '运行环境已就绪' : '运行环境未启用'}</p>
        <Button type="submit" disabled={!validPercent || !draft || save.isPending}>保存收码设置</Button>
      </form>}
      {save.isSuccess && <Notice role="status">设置已保存</Notice>}{save.error && <Notice role="alert">{save.error.message} <Button variant="outline" onClick={() => { setDraft(null); save.reset(); void settings.refetch(); }}>重新加载设置</Button></Notice>}
    </section>
    <section className="sms-surface"><h3>Webhook 通知</h3><p>将以下地址添加到账户的 Webhook 设置。通知会加速同步，漏发时仍由后台轮询补齐。</p><label className="sms-form">通知地址<input readOnly value={new URL('/api/webhooks/sms', window.location.origin).href} /></label></section>
    <section className="sms-surface"><h3>订单管理</h3><form className="sms-form" onSubmit={event => { event.preventDefault(); const f = new FormData(event.currentTarget); setFilter({ page: 1, status: String(f.get('status') ?? ''), userId: f.get('userId') ? Number(f.get('userId')) : undefined }); }}>
      <label>订单状态<select name="status"><option value="">全部</option><option value="queued">等待取号</option>{Object.entries(smsStatuses).map(([status, label]) => <option value={status} key={status}>{label}</option>)}</select></label><label>用户 ID<input type="number" name="userId" min="1" /></label><Button type="submit">查询订单</Button>
    </form>{orders.isError && <Notice role="alert">订单加载失败。<Button onClick={() => void orders.refetch()}>重试</Button></Notice>}
      <div className="sms-order-list">{orders.data?.data.list.map(o => <article key={o.id}><div><strong>用户 #{o.ownerUserId} · {o.phone ?? '未分配号码'}</strong><p>{smsStatuses[o.status] ?? o.status} · USD {o.price}</p><small>{o.id}</small></div><Button variant="outline" onClick={() => { setSelected(o.id); resolve.reset(); }}>查看订单</Button></article>)}</div>
      <div className="sms-actions"><Button variant="outline" disabled={filter.page <= 1} onClick={() => setFilter(f => ({ ...f, page: f.page - 1 }))}>上一页</Button><span>第 {filter.page} 页</span><Button variant="outline" disabled={!orders.data?.data.hasMore} onClick={() => setFilter(f => ({ ...f, page: f.page + 1 }))}>下一页</Button></div>
    </section>
    {detail.isError && <Notice role="alert">订单详情加载失败。</Notice>}
    {order && <SmsOrderDetail order={order}><p>用户 #{order.ownerUserId}；成本 {order.actualCost ?? order.costLimit ?? '待核对'} USD；加价比例 {order.markupPercent}%</p><p>关联记录：{order.activationId ?? '无'}</p>{order.status === 'needs_review' && <form className="sms-form" onSubmit={event => { event.preventDefault(); const f = new FormData(event.currentTarget); resolve.mutate({ ...(String(f.get('activationId') ?? '').trim() ? { activationId: String(f.get('activationId')).trim() } : {}), note: String(f.get('note') ?? ''), ...(f.get('confirmNoPurchase') === 'on' ? { confirmNoPurchase: true } : {}) }); }}>
      <label>已核实的激活编号<input name="activationId" inputMode="numeric" defaultValue={order.activationId ?? ''} /></label><label>核对说明<textarea name="note" minLength={5} maxLength={500} required /></label>
      {!order.activationId && <label><span>已人工核实未购买成功，退回预扣金额</span><input type="checkbox" name="confirmNoPurchase" /></label>}
      <Button type="submit" disabled={resolve.isPending}>提交核对结果</Button>
    </form>}{resolve.error && <Notice role="alert">{resolve.error.message}</Notice>}{resolve.isSuccess && <Notice role="status">核对结果已保存</Notice>}</SmsOrderDetail>}
  </div>;
}
