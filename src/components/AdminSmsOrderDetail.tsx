import adminI18n, { t as adminT } from "i18next";
import { useTranslation } from "react-i18next";
import type { ReactNode } from 'react';
import { Dialog } from 'radix-ui';
import { ArrowRight, MessageSquare, X } from 'lucide-react';
import type { AdminSmsOrder } from '../api';
import { smsStatuses } from '../views/SmsPage';
import { smsPhoneParts } from '../views/smsPhone';
import { Button } from './ui/button';
import { NoticeScope } from './ui/notice';

const walletLabels: Record<string, string> = { get sms_purchase() { return adminT("adminText.numberPurchaseCharge"); }, get sms_refund() { return adminT("adminText.orderRefund"); }, get sms_price_adjustment() { return adminT("adminText.priceDifferenceRefund"); } };

export function AdminSmsOrderDetail({ selectedId, order, serviceName, countryName, isLoading, isError, onRetry, onClose, onOpenCustomer, children }: {
  selectedId: string | null; order?: AdminSmsOrder; serviceName: string; countryName: string;
  isLoading: boolean; isError: boolean; onRetry: () => unknown; onClose: () => void;
  onOpenCustomer: (id: number, email: string | null) => void; children?: ReactNode;
}) {
  useTranslation();
  const phone = order?.phone ? smsPhoneParts(order.phone) : null;
  return <Dialog.Root open={!!selectedId} onOpenChange={open => !open && onClose()}><Dialog.Portal>
    <div className="dialog-overlay" data-state="open" aria-hidden="true" onClick={onClose} onWheel={e => e.preventDefault()} onTouchMove={e => e.preventDefault()} />
    <Dialog.Content className="dialog-content admin-gpt-order-drawer admin-sms-drawer">
      <NoticeScope />
      <div className="card-transaction-drawer-head"><div><span><MessageSquare /></span><div><Dialog.Title>{adminT("adminText.smsOrderDetails")}</Dialog.Title><Dialog.Description>{selectedId}</Dialog.Description></div></div><Dialog.Close asChild><Button size="icon" variant="ghost" aria-label={adminT("adminText.close")}><X /></Button></Dialog.Close></div>
      {isLoading && <p className="admin-state loading-skeleton loading-skeleton-block">{adminT("adminText.loadingOrderDetails")}</p>}
      {isError && <div className="admin-state is-error" role="alert">{adminT("adminText.unableToLoadOrderDetails")}<Button size="xs" variant="outline" onClick={() => void onRetry()}>{adminT("adminText.retry")}</Button></div>}
      {order && <div className="admin-gpt-order-detail-body">
        <div className="admin-drawer-hero"><div><span className="admin-drawer-hero-kicker">SMS ORDER</span><div className="admin-drawer-hero-status"><span className={`sms-status sms-status-${order.status}`}>{smsStatuses[order.status] ?? order.status}</span></div><p className="admin-drawer-hero-amount">USD {order.price}<small>{adminT("adminText.netChargeOriginalAmountUsd")}{order.originalPrice ?? order.price}</small></p></div><div className="admin-drawer-hero-side"><span className="admin-drawer-hero-kicker">SERVICE</span><dl><div><dt>{adminT("adminText.service")}</dt><dd>{serviceName}</dd></div><div><dt>{adminT("adminText.countryRegion")}</dt><dd>{countryName}</dd></div><div><dt>{adminT("adminText.rentalPeriod")}</dt><dd>{order.durationHours ? adminT("adminText.hoursDays", { hours: order.durationHours, days: order.durationHours / 24 }) : adminT("adminText.singleSmsActivation")}</dd></div></dl></div></div>
        <section className="admin-drawer-section"><header><span>CUSTOMER</span><h3>{adminT("adminText.customerAndOrder")}</h3></header><dl className="admin-drawer-facts">
          <div className="is-wide"><dt>{adminT("adminText.customer")}</dt><dd><button className="admin-customer-inviter" type="button" onClick={() => { onClose(); onOpenCustomer(order.ownerUserId, order.ownerEmail); }}>{order.ownerDisplayName || order.ownerEmail || adminT("adminText.userLabel", { userId: order.ownerUserId })} · #{order.ownerUserId}<ArrowRight /></button></dd></div>
          <div><dt>{adminT("adminText.email")}</dt><dd>{order.ownerEmail ?? adminT("adminText.noEmailLinked")}</dd></div><div><dt>{adminT("adminText.orderSource")}</dt><dd>{order.creatorApiKeyId != null ? adminT("adminText.apiKey", { keyId: order.creatorApiKeyId }) : adminT("adminText.website")}</dd></div>
          <div className="is-wide"><dt>{adminT("adminText.phoneNumber")}</dt><dd>{phone ? <>{phone.callingCode && <span aria-label={adminT("adminText.countryCallingCode")}>{phone.callingCode} </span>}<span aria-label={phone.callingCode ? adminT("adminText.localNumber") : adminT("adminText.mobileNumber")}>{phone.local}</span></> : adminT("adminText.noNumberAssigned")}</dd></div>
          <div className="is-wide"><dt>{adminT("adminText.orderId")}</dt><dd>{order.id}</dd></div><div><dt>{adminT("adminText.activationId")}</dt><dd>{order.activationId ?? adminT("adminText.notRecorded")}</dd></div><div><dt>{adminT("adminText.serviceCountryCode")}</dt><dd>{order.service} / #{order.country}</dd></div>
        </dl></section>
        <section className="admin-drawer-section"><header><span>PRICING</span><h3>{adminT("adminText.amountsAndPricingSnapshot")}</h3></header><dl className="admin-drawer-facts">
          <div><dt>{adminT("adminText.originalOrderAmount")}</dt><dd>USD {order.originalPrice ?? order.price}</dd></div><div><dt>{adminT("adminText.netCharge")}</dt><dd>USD {order.price}</dd></div><div><dt>{adminT("adminText.refundedAmount")}</dt><dd>USD {order.refundedAmount}</dd></div><div><dt>{adminT("adminText.actualCostSnapshot")}</dt><dd>{order.actualCost != null ? `USD ${order.actualCost}` : adminT("adminText.pendingReview")}</dd></div><div><dt>{adminT("adminText.costLimitSnapshot")}</dt><dd>{order.costLimit != null ? `USD ${order.costLimit}` : adminT("adminText.notRecorded")}</dd></div><div><dt>{adminT("adminText.markupPricingVersion")}</dt><dd>{order.markupPercent}% / v{order.pricingVersion ?? '—'}</dd></div>
        </dl><p className="sms-note">{adminT("adminText.costsReflectTheSnapshotAtPurchaseFinal")}</p></section>
        <section className="admin-drawer-section"><header><span>MESSAGES</span><h3>{adminT("adminText.smsHistory")}</h3></header>{!order.messages.length && <p>{adminT("adminText.noMessagesReceivedYet")}</p>}<div className="admin-sms-messages">{order.messages.map(m => <article key={m.id}><strong>{m.code ?? adminT("adminText.noVerificationCode")}</strong><p>{m.text ?? adminT("adminText.noMessageText")}</p><small>{date(m.receivedAt)}</small></article>)}</div></section>
        <section className="admin-drawer-section"><header><span>WALLET</span><h3>{adminT("adminText.linkedWalletEntries")}</h3></header>{order.walletEntries?.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>{adminT("adminText.timeId")}</th><th>{adminT("adminText.type")}</th><th>{adminT("adminText.changeUsd")}</th><th>{adminT("adminText.balanceBeforeAfter")}</th><th>{adminT("adminText.note")}</th></tr></thead><tbody>{order.walletEntries.map(entry => <tr key={entry.id}><td>{date(entry.createdAt)}<small>#{entry.id}</small></td><td>{walletLabels[entry.type] ?? entry.type}<small>{entry.type}</small></td><td>{entry.amount}</td><td>{entry.balanceBefore}<small>→ {entry.balanceAfter}</small></td><td>{entry.remark ?? '—'}</td></tr>)}</tbody></table></div> : <p>{adminT("adminText.noLinkedWalletEntries")}</p>}</section>
        <section className="admin-drawer-section"><header><span>TIMELINE</span><h3>{adminT("adminText.orderTimeline")}</h3></header><dl className="admin-drawer-facts">{[[adminT("adminText.created"), order.createdAt], [adminT("adminText.purchaseStarted"), order.purchaseStartedAt], [adminT("adminText.updated"), order.updatedAt], [adminT("adminText.cancellationAvailable"), order.cancelAvailableAt], [adminT("adminText.cancellationRefundDeadline"), order.cancellationDeadline], [adminT("adminText.cancellationConfirmed"), order.cancellationConfirmedAt], [adminT("adminText.numberExpires"), order.expiresAt]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{date(value)}</dd></div>)}</dl></section>
        {children}
      </div>}
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}
function date(value?: string | null) { return value ? new Date(value).toLocaleString(adminI18n.language === "en" ? "en-US" : "zh-CN") : '—'; }
