import { type ReactNode } from "react";
import { ArrowRight, ExternalLink, ReceiptText, Sparkles, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useTranslation } from "react-i18next";
import { type GptDirectOrder, type AdminGptOrderContext, type GptDirectEvent } from "../api";
import { formatDecimal } from "../decimal";
import { Button } from "./ui/button";
import { needsRenewalSession, stripeInvoiceUrls } from "./GptOrderProgress";

export function AdminGptOrderDetail({ selectedId, order, events = [], isLoading, isError, onRetry, onClose, onOpenCustomer, onOpenCard, title, actions, children }: {
  selectedId: string | null; order?: GptDirectOrder & AdminGptOrderContext; events?: GptDirectEvent[];
  isLoading: boolean; isError: boolean; onRetry: () => unknown; onClose: () => void;
  onOpenCustomer: (userId: number, email: string | null) => void;
  onOpenCard: (userId: number, cardId: number) => void;
  title?: string; actions?: ReactNode; children?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "en" ? "en-US" : "zh-CN";
  const statusLabel = (status: string) => t(`gptOrderStatus.${status}`, { defaultValue: status });
  const planLabel = (plan?: string | null) => plan === "free" ? "Free" : plan ? t(`gptPlan.${plan}`, { defaultValue: plan }) : t("adminGptNotRecorded");
  const renewalRecovery = order && needsRenewalSession(order, events);
  const invoiceUrls = stripeInvoiceUrls(order?.invoiceUrls, order?.invoiceUrl);
  return (
    <Dialog.Root open={Boolean(selectedId)} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal><div className="dialog-overlay" data-state={selectedId ? "open" : "closed"} aria-hidden="true" onClick={() => onClose()} onWheel={(event) => event.preventDefault()} onTouchMove={(event) => event.preventDefault()} /><Dialog.Content className="dialog-content admin-gpt-order-drawer">
        <div className="card-transaction-drawer-head"><div><span><Sparkles /></span><div><Dialog.Title>{title ?? "GPT 直充订单详情"}</Dialog.Title><Dialog.Description>{selectedId}</Dialog.Description></div></div><Dialog.Close asChild><Button type="button" size="icon" variant="ghost" aria-label="关闭"><X /></Button></Dialog.Close></div>
        {isLoading && <p className="admin-state loading-skeleton loading-skeleton-block" aria-label={t("loading")}>{t("loading")}</p>}
        {isError && <div className="admin-state is-error" role="alert"><span>{t("adminLoadFailed")}</span><Button size="xs" variant="outline" onClick={() => void onRetry()}>{t("retry")}</Button></div>}
        {order && <div className="admin-gpt-order-detail-body">
          {actions}
          <dl className="transaction-detail-grid">
            <div><dt>{t("customer")}</dt><dd>{order?.userId ? <button type="button" className="admin-customer-inviter" onClick={() => { onClose(); onOpenCustomer(order.userId!, order.customerEmail ?? null); }}>{order.customerEmail || `#${order.userId}`} · #{order.userId}<ArrowRight /></button> : t("adminGptNotRecorded")}</dd></div>
            <div><dt>{t("adminGptAccountEmail")}</dt><dd>{order?.accountEmail || order?.email || order?.maskedEmail || t("adminGptNotRecorded")}</dd></div>
            <div><dt>{t("adminGptCheckoutBranch")}</dt><dd>{order.checkoutBranch || t("adminGptNotRecorded")}</dd></div>
            <div><dt>{t("adminGptOriginalPlan")}</dt><dd>{planLabel(order?.originalPlan)}</dd></div>
            <div><dt>{t("adminGptObservedPlan")}</dt><dd>{planLabel(order?.observedPlan)}</dd></div>
            <div><dt>{t("adminGptCardRecord")}</dt><dd>{order?.linkedCardId && order.userId ? <button type="button" className="admin-customer-inviter" onClick={() => { onClose(); onOpenCard(order.userId!, order.linkedCardId!); }}>{order.cardNumberMasked || `#${order.cardId}`} · #{order.cardId}<ArrowRight /></button> : order?.cardNumberMasked || t("adminGptNotRecorded")}<small>{order?.cardProductCode} {order?.cardStatus}</small><small>{order?.paymentCardSource === "external" ? t("adminGptExternalCard") : order?.autoOpenedCard ? t("adminGptAutoCard") : t("adminGptSelectedCard")}</small></dd></div>
            <div><dt>套餐</dt><dd>{t(`gptPlan.${order.plan}`, { defaultValue: order.plan })}</dd></div><div><dt>订单状态</dt><dd>{statusLabel(order.status)} · {order.operationStatus}</dd></div>
            <div><dt>报价</dt><dd>{formatMinorAmount(order.quotedAmountMinor, order.currency, locale)}</dd></div><div><dt>最终扣款</dt><dd>{formatMinorAmount(order.finalAmountMinor, order.currency, locale)}</dd></div>
            <div><dt>客户服务费</dt><dd>${formatDecimal(order.customerServiceFee ?? order.serviceFee ?? "0")}</dd></div><div><dt>服务费状态</dt><dd>{order.serviceFeeStatus || "—"}</dd></div>
            <div><dt>支付卡</dt><dd>{order.cardNumberMasked || "—"}</dd></div><div><dt>自动续费</dt><dd>{order.willRenew === false ? "已取消" : renewalRecovery ? t("gptRenewalUnknown") : order.needsRenewalCancel ? "等待取消" : "—"}</dd></div>
          </dl>
          <section className="admin-gpt-invoices"><h3><ReceiptText />Stripe 账单</h3>{invoiceUrls.length === 0 ? <p>暂未保存账单</p> : invoiceUrls.map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer"><span>账单 {index + 1}</span><code>{url}</code><ExternalLink /></a>)}</section>
          {children}
          <section className="transaction-lifecycle admin-gpt-order-timeline"><h3>Plus → Pro 多阶段与安全时间线</h3>{events.map((event) => <article key={event.eventId}><i /><div><strong>{renewalRecovery && event.publicCode === "session_refresh_required" ? t("gptRenewalSessionMessage") : event.publicMessage || event.message || event.type}</strong><span>{displayEventTime(event.occurredAt || event.createdAt, locale)}</span><p>{[event.stage, event.step, event.status, event.fromStatus && event.toStatus ? `${event.fromStatus} → ${event.toStatus}` : null].filter(Boolean).join(" · ")}</p>{event.publicCode && <small>{event.publicCode}</small>}{event.safePayload && Object.keys(event.safePayload).length > 0 && <details className="admin-gpt-safe-payload"><summary>安全事件字段</summary><pre>{JSON.stringify(event.safePayload, null, 2)}</pre></details>}</div></article>)}</section>
        </div>}
      </Dialog.Content></Dialog.Portal>
    </Dialog.Root>
  );
}

function displayEventTime(value: string, locale: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(locale);
}

function formatMinorAmount(value: number | null | undefined, currency: string | null | undefined, locale: string) {
  if (value == null) return "—";
  if (!currency) return String(value);
  try { return new Intl.NumberFormat(locale, { style: "currency", currency , minimumFractionDigits: 0, maximumFractionDigits: 20 }).format(value / 100); }
  catch { return `${formatDecimal((value / 100).toFixed(2))} ${currency}`; }
}
