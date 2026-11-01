import i18n from './i18n';
import type { ExecutionPolicy, Quote } from './generated/cdk-v2';

export const cardLabels: Record<ExecutionPolicy['cardStrategy'], string> = {
  get existing_first() { return i18n.t('cdkText.preferExistingCardsOpenANew'); }, get new_first() { return i18n.t('cdkText.preferNewCardsAllowExistingCard'); },
  get existing_only() { return i18n.t('cdkText.existingCardsOnly243'); }, get dedicated_new() { return i18n.t('cdkText.oneDedicatedNewCardPerCode'); },
};
export const fundingLabels: Record<ExecutionPolicy['fundingStrategy'], string> = {
  get auto_topup() { return i18n.t('cdkText.automaticallyCoverBalanceShortfall'); }, get none() { return i18n.t('cdkText.noAutomaticTopUp'); }, get fixed() { return i18n.t('cdkText.fixedAmountTopUp'); },
};
export function productLabel(id = '') {
  if (id === 'gpt.plus') return 'ChatGPT Plus';
  if (id === 'gpt.pro_5x') return 'ChatGPT Pro · 5x';
  if (id === 'gpt.pro_20x') return 'ChatGPT Pro · 20x';
  const match = /^(tg|x)\.premium(_plus)?_(3|6|12)m$/.exec(id);
  return match ? i18n.t('cdkText.productMonths', { product: `${match[1] === 'tg' ? 'Telegram' : 'X'} Premium${match[2] ? '+' : ''}`, count: Number(match[3]) }) : id;
}
const statusLabels: Record<string, string> = {
  available: 'cdkText.available', locked: 'cdkText.redeeming', consumed: 'cdkText.used', revoked: 'cdkText.revoked',
  prepared: 'cdkText.awaitingConfirmation', authorized: 'cdkText.authorizedAwaitingExecution', selecting: 'cdkText.selectingCard', opening: 'cdkText.openingCard', funding: 'cdkText.addingFunds',
  paying: 'cdkText.paying', processing: 'cdkText.processing258', completed: 'cdkText.redeemedSuccessfully', failed: 'cdkText.failed', declined: 'cdkText.cardDeclined',
  payment_unknown: 'cdkText.paymentResultUnderReview', review_required: 'cdkText.awaitingReview', waiting_delivery: 'cdkText.paidAwaitingDelivery',
  unpaid: 'cdkText.unpaid', not_started: 'cdkText.notStarted', unknown: 'cdkText.underReview', paid: 'cdkText.paid', pending: 'cdkText.awaitingDelivery', delivered: 'cdkText.delivered',
};
export function statusLabel(status: string) { return statusLabels[status] ? i18n.t(statusLabels[status]) : i18n.t('cdkText.unknownStatus', { status }); }
export function dateLabel(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(i18n.resolvedLanguage === 'en' ? 'en-US' : 'zh-CN', { hour12: false });
}
export function quoteLabel(quote: Quote) {
  if (quote.amountMinor === null || !quote.currency) return i18n.t('cdkText.awaitingAValidQuote');
  try {
    const digits = new Intl.NumberFormat(i18n.resolvedLanguage === 'en' ? 'en-US' : 'zh-CN', { style: 'currency', currency: quote.currency }).resolvedOptions().maximumFractionDigits ?? 2;
    return `${quote.currency} ${(quote.amountMinor / 10 ** digits).toFixed(digits)}`;
  } catch { return i18n.t('cdkText.quoteCurrencyNeedsReview'); }
}
const reasonLabels: Record<string, string> = {
  ATTEMPTS_EXHAUSTED: 'cdkText.maximumPaymentAttemptsAllowedByThe', AUTHORITY_REVOKED: 'cdkText.issuanceAuthorizationDisabledContactTheIssuer',
  BALANCE_INSUFFICIENT: 'cdkText.insufficientCardBalance', BALANCE_SYNC_PENDING: 'cdkText.synchronizingCardBalance', BALANCE_SYNC_TIMEOUT: 'cdkText.balanceSynchronizationIncompleteAwaitingReview',
  BUDGET_EXCEEDED: 'cdkText.cumulativeWalletBudgetPerCodeReached', CARD_DECLINED: 'cdkText.cardPaymentDeclined', CHANNEL_REQUIRES_ACTION: 'cdkText.theChannelRequiresFurtherAction',
  DEDICATED_CARD_UNAVAILABLE: 'cdkText.dedicatedCardTemporarilyUnavailable', FIXED_FUNDING_INSUFFICIENT: 'cdkText.fixedTopUpAmountIsInsufficient',
  FUNDING_FAILED: 'cdkText.topUpPreparationFailed', FUNDING_PENDING: 'cdkText.fundingOperationIsStillProcessing', FUNDING_PREPARATION_PENDING: 'cdkText.preparingFundingOperation',
  FUNDING_PREPARATION_REJECTED: 'cdkText.fundingPreparationRejected', NO_ELIGIBLE_CARD: 'cdkText.theIssuerHasNoEligibleAvailable', NO_FUNDED_CARD: 'cdkText.noAvailableCardHasSufficientBalance',
  PAYMENT_RESULT_UNKNOWN: 'cdkText.paymentResultIsUnconfirmedAwaitingReview', PREPARATION_FAILED: 'cdkText.channelPreflightCheckFailed', QUOTE_EXPIRED: 'cdkText.quoteExpiredRunThePreflightCheck',
  TERMINAL_DECLINE: 'cdkText.theChannelRejectedFurtherPaymentContact',
};
export function reasonLabel(reason: string) { return reasonLabels[reason] ? i18n.t(reasonLabels[reason]) : i18n.t('cdkText.unknownReason', { reason }); }
