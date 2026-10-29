import { useEffect, useState } from "react";
import type { TgDirectOrder } from "../api";

export const tgStatuses: Record<string, string> = {
  preparing: "正在检查资格和报价", prepared: "待确认付款", processing: "正在充值",
  completed: "充值完成", paid_pending_delivery: "已付款，等待到账", review_required: "结果待核对，请勿重复付款",
  requires_action: "支付验证待处理", ineligible: "账号暂不符合充值条件",
  failed_precharge: "未扣款，充值未完成", cancelled: "已取消",
};

export function tgOrderStatus(order: TgDirectOrder) {
  if (order.status === "completed") return tgStatuses.completed;
  if (order.errorCode === "execution_timeout" && order.status === "cancelled") return "已超时取消（未提交付款）";
  if (order.errorCode === "delivery_timeout") return "已付款，到账核对超时";
  if (order.errorCode === "payment_execution_timeout") return "已超时，付款结果待核对";
  if (order.errorCode === "authentication_unsupported") return "支付认证暂无法继续";
  return tgStatuses[order.status] ?? "结果待核对";
}

export function tgOrderExplanation(order: TgDirectOrder) {
  if (order.errorCode === "payment_execution_timeout") return "充值处理超过 8 分钟，已停止自动操作。系统继续核对原付款结果，请勿重新充值。";
  if (order.errorCode === "delivery_timeout") return "付款已确认，到账核对超过 8 分钟。系统继续查询 Telegram 赠送记录，请勿重复支付。";
  if (order.errorCode === "execution_timeout" && order.status === "cancelled") return "超过 8 分钟未提交付款，订单已自动取消。服务费及卡片占用按订单结算结果处理。";
  if (order.errorCode === "authentication_unsupported") return "支付方返回了当前服务无法继续处理的认证页面。系统会继续核对原订单；若长时间没有结果，请联系客服，请勿重复付款。";
  if (order.status === "requires_action") return "支付方要求进一步验证，付款结果尚未确认。系统继续核对原订单；需要人工处理时请联系客服，请勿重复付款。";
  if (order.status === "review_required" && !order.paymentAttempted && !order.paymentSubmitted) return "报价结果暂未确认，尚未开始充值。请核对账号或稍后刷新。";
  if (order.status === "review_required") return "尚未收到明确支付结果，系统正在核对原订单。此状态不代表支付失败，请勿重复付款。";
  return "";
}

export function TgOrderTiming({ order }: { order: TgDirectOrder }) {
  const [now, setNow] = useState(() => Date.now());
  const finished = ["completed", "cancelled", "failed_precharge", "ineligible"].includes(order.status);
  useEffect(() => {
    if (!order.deadlineAt || finished || order.executionTimedOut) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [order.deadlineAt, order.executionTimedOut, finished]);
  const seconds = order.deadlineAt ? Math.max(0, Math.ceil((Date.parse(order.deadlineAt) - now) / 1000)) : null;
  const updated = order.updatedAt ? new Date(order.updatedAt) : null;
  return <div className="tg-order-timing" aria-live="off">
    {!finished && seconds !== null && !order.executionTimedOut && <p>{seconds > 0 ? `剩余处理时间 ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} · 最长 8 分钟` : "已到 8 分钟处理期限，正在核对最终结果。"}</p>}
    {updated && !Number.isNaN(updated.getTime()) && <p>最近更新：{updated.toLocaleString("zh-CN")}</p>}
    <p>{finished ? "订单已结束。" : "状态自动更新；关闭窗口后仍可在订单记录查看。"}已绑定 Telegram 的用户会在充值成功后收到通知。</p>
  </div>;
}
