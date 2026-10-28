import type { ExecutionPolicy, Quote } from './generated/cdk-v2';

export const cardLabels: Record<ExecutionPolicy['cardStrategy'], string> = {
  existing_first: '优先已有卡，不够时开新卡', new_first: '优先新卡，可回退已有卡',
  existing_only: '只用已有卡', dedicated_new: '每码一张专用新卡',
};
export const fundingLabels: Record<ExecutionPolicy['fundingStrategy'], string> = {
  auto_topup: '自动补足余额', none: '不自动充值', fixed: '固定金额充值',
};
export function productLabel(id = '') {
  if (id === 'gpt.plus') return 'ChatGPT Plus';
  if (id === 'gpt.pro_5x') return 'ChatGPT Pro · 5x';
  if (id === 'gpt.pro_20x') return 'ChatGPT Pro · 20x';
  const match = /^(tg|x)\.premium(_plus)?_(3|6|12)m$/.exec(id);
  return match ? `${match[1] === 'tg' ? 'Telegram' : 'X'} Premium${match[2] ? '+' : ''} · ${match[3]} 个月` : id;
}
const statusLabels: Record<string, string> = {
  available: '可兑换', locked: '兑换中', consumed: '已使用', revoked: '已撤销',
  prepared: '待确认', authorized: '已授权，等待执行', selecting: '正在选卡', opening: '正在开卡', funding: '正在充值',
  paying: '正在付款', processing: '处理中', completed: '兑换成功', failed: '失败', declined: '卡片拒付',
  payment_unknown: '付款结果待核查', review_required: '等待核查', waiting_delivery: '已付款，等待交付',
  unpaid: '未付款', not_started: '未开始', unknown: '待核查', paid: '已付款', pending: '等待交付', delivered: '已交付',
};
export function statusLabel(status: string) { return statusLabels[status] ?? `处理中（${status}）`; }
export function dateLabel(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
}
export function quoteLabel(quote: Quote) {
  if (quote.amountMinor === null || !quote.currency) return '等待有效报价';
  try {
    const digits = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: quote.currency }).resolvedOptions().maximumFractionDigits ?? 2;
    return `${quote.currency} ${(quote.amountMinor / 10 ** digits).toFixed(digits)}`;
  } catch { return '报价币种待核查'; }
}
const reasonLabels: Record<string, string> = {
  ATTEMPTS_EXHAUSTED: '已达到模板允许的付款次数', AUTHORITY_REVOKED: '发行授权已停用，请联系发行者',
  BALANCE_INSUFFICIENT: '卡片余额不足', BALANCE_SYNC_PENDING: '正在同步卡片余额', BALANCE_SYNC_TIMEOUT: '余额同步未完成，等待核查',
  BUDGET_EXCEEDED: '已达到每码累计钱包预算', CARD_DECLINED: '卡片付款被拒绝', CHANNEL_REQUIRES_ACTION: '渠道要求进一步处理',
  DEDICATED_CARD_UNAVAILABLE: '专用卡暂不可用', FIXED_FUNDING_INSUFFICIENT: '固定充值金额不足以完成付款',
  FUNDING_FAILED: '充值准备失败', FUNDING_PENDING: '资金操作仍在处理中', FUNDING_PREPARATION_PENDING: '正在准备资金操作',
  FUNDING_PREPARATION_REJECTED: '资金准备被拒绝', NO_ELIGIBLE_CARD: '发行者没有符合条件的可用卡', NO_FUNDED_CARD: '没有余额足够的可用卡',
  PAYMENT_RESULT_UNKNOWN: '付款结果尚未确认，请等待核查', PREPARATION_FAILED: '渠道预检失败', QUOTE_EXPIRED: '报价已过期，请重新预检',
  TERMINAL_DECLINE: '渠道拒绝继续付款，请联系发行者',
};
export function reasonLabel(reason: string) { return reasonLabels[reason] ?? `需要核查（${reason}）`; }
