import { formatDecimal, formatRateAsPercent } from "../decimal";
import { useRef, useState, type FormEvent } from "react";
import { useAtomValue } from "jotai";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, useLocation, useNavigate, useSearch } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, CreditCard, Plus } from "lucide-react";
import { Dialog } from "radix-ui";
import { Button } from "@/components/ui/button";
import { StableSwap } from "../components/StableSwap";
import { CardClosurePanel } from "../components/CardClosurePanel";
import { CardNetworkBrand } from "../components/CardNetworkBrand";
import { CardRechargeQuoteSummary, rechargeDebitExceedsSpendable, useCardRechargeQuote } from "../components/CardRechargeQuote";
import { PaymentPerformance, formatRateBps } from "../components/PaymentPerformance";
import { ProductFeeDetails } from "../components/ProductFeeDetails";
import { DataSkeleton } from "../components/PageShell";
import { ApiError, PendingOperationError, getCardDetail, getCards, getDashboard, getGptCardSuccesses, getOpenAiPrices, getProducts, runCardAction, runCardRechargeAction, type Card, type Product } from "../api";
import { sessionAtom, sessionIdentity } from "../state";
import { useTranslation } from "react-i18next";
import { useFeatures } from "../features";
import { interactiveCardMotion } from "../interactiveCardMotion";

type IntentKey = { fingerprint: string; key: string };

function keyForIntent(ref: { current: IntentKey | null }, fingerprint: string) {
  if (ref.current?.fingerprint !== fingerprint) {
    ref.current = { fingerprint, key: crypto.randomUUID() };
  }
  return ref.current.key;
}

function categoryChips(category: string | null) {
  return category?.split(/[/,，、]/).map((value) => value.trim()).filter(Boolean) ?? [];
}

function rate(value: string) {
  return formatRateAsPercent(value ?? "");
}

function productBins(product: Pick<Product, "displayBin" | "displayBins">) {
  return product.displayBins?.length ? product.displayBins : product.displayBin ? [product.displayBin] : [];
}

export function CardsPage() {
  const session = useAtomValue(sessionAtom);
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { flags } = useFeatures();
  const showingOwnedCards = useLocation({ select: (location) => location.pathname }) === "/cards/owned";
  const search = useSearch({ strict: false }) as { gptRetry?: boolean };
  const [selectedCategory, setSelectedCategory] = useState("");
  const [cardPage, setCardPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [cardSearch, setCardSearch] = useState("");
  const [cardAction, setCardAction] = useState<{ card: Card; action: "recharge" | "refund" } | null>(null);
  const [actionAmount, setActionAmount] = useState("");
  const [error, setError] = useState("");
  const actionIntent = useRef<IntentKey | null>(null);
  const products = useQuery({ queryKey: ["products"], queryFn: () => getProducts(session!.token), enabled: Boolean(session) });
  const cards = useQuery({
    queryKey: ["cards", "owned", sessionIdentity(session), cardPage, cardSearch],
    queryFn: () => getCards(session!.token, cardPage, 20, cardSearch),
    enabled: Boolean(session && showingOwnedCards),
    refetchInterval: 10_000,
    placeholderData: (previous, query) => query?.queryKey[2] === sessionIdentity(session) ? keepPreviousData(previous) : undefined,
  });
  const cardSuccesses = useQuery({ queryKey: ["gpt-card-successes"], queryFn: () => getGptCardSuccesses(session!.token), enabled: Boolean(session && showingOwnedCards && flags.gptDirect), retry: false });
  const paymentReferences = useQuery({ queryKey: ["openai-prices"], queryFn: () => getOpenAiPrices(session!.token), enabled: Boolean(session && !showingOwnedCards && flags.market), retry: false });
  const dashboard = useQuery({
    queryKey: ["dashboard", sessionIdentity(session)],
    queryFn: () => getDashboard(session!.token),
    enabled: Boolean(session),
  });
  const actionDetails = useQuery({
    queryKey: ["card", cardAction?.card.id],
    queryFn: () => getCardDetail(session!.token, cardAction!.card.id),
    enabled: Boolean(session && cardAction?.action === "recharge"),
  });
  const actionMaximum = cardAction?.action === "recharge"
    ? actionDetails.data?.data.maxAmount
    : cardAction ? Math.max(0, Number(cardAction.card.balance) - Number(cardAction.card.refundKeepMinimum)).toFixed(4) : undefined;
  const actionMinimum = cardAction?.action === "recharge" ? actionDetails.data?.data.minAmount : "1";
  const rechargeQuote = useCardRechargeQuote(
    session?.token,
    cardAction?.card.id,
    actionAmount,
    actionMinimum,
    actionMaximum,
    cardAction?.action === "recharge",
  );
  const actionMutation = useMutation({
    mutationFn: ({ card, action, amount, expectedFee, idempotencyKey }: { card: Card; action: string; amount?: string; expectedFee?: string; idempotencyKey: string }) =>
      action === "recharge"
        ? runCardRechargeAction(session!.token, card.id, idempotencyKey, amount, expectedFee)
        : runCardAction(session!.token, card.id, action, idempotencyKey, amount, expectedFee),
    onSuccess: async () => {
      actionIntent.current = null;
      setError("");
      setCardAction(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["cards"] }),
        queryClient.invalidateQueries({ queryKey: ["wallet"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
    },
    onError: async (cause, variables) => {
      if (variables.action === "refund" && cause instanceof ApiError && cause.errorCode === "REFUND_BALANCE_UNAVAILABLE") {
        setError(t("refundBalanceUnavailable"));
        return;
      }
      if (variables.action === "refund" && cause instanceof ApiError && ["REFUND_BALANCE_CHANGED", "REFUND_BALANCE_REJECTED"].includes(cause.errorCode ?? "")) {
        actionIntent.current = null;
        setActionAmount("");
        const [refreshed] = await Promise.all([
          cards.refetch(),
          queryClient.invalidateQueries({ queryKey: ["card", variables.card.id] }),
          queryClient.invalidateQueries({ queryKey: ["card-transactions", variables.card.id] }),
          queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
        ]);
        const updatedCard = refreshed.data?.data.list.find((card) => card.id === variables.card.id);
        if (updatedCard) setCardAction((current) => current?.card.id === updatedCard.id ? { ...current, card: updatedCard } : current);
        setError(t("refundBalanceChanged"));
        return;
      }
      if (variables.action === "recharge" && cause instanceof ApiError && cause.status === 409 && cause.errorCode === "PRICE_CHANGED") {
        actionIntent.current = null;
        setError(t("rechargePriceChanged"));
        void rechargeQuote.refetch();
        return;
      }
      if (["refund", "freeze", "unfreeze"].includes(variables.action) && cause instanceof PendingOperationError && cause.operationId) {
        setCardAction(null);
        setError("");
        await navigate({ to: "/cards/$cardId", params: { cardId: String(variables.card.id) } });
        return;
      }
      setError(cause instanceof PendingOperationError ? t("operationPendingDoNotRetry")
        : `${t(`cardActionFailedByType.${variables.action.toUpperCase()}`, { defaultValue: t("cardActionFailed") })}${cause instanceof Error ? `: ${cause.message}` : ""}`);
      await queryClient.invalidateQueries({ queryKey: ["cards"] });
    },
  });

  if (!session) return <Navigate to="/login" />;
  if ((!showingOwnedCards && !products.data) || (showingOwnedCards && !cards.data && !cards.isError)) return <main className="cards-page" aria-busy="true">
    <header><div><span className="eyebrow">VIRTUAL CARDS</span><h1>{t(showingOwnedCards ? "ownedCards" : "cardsTitle")}</h1><p>{t(showingOwnedCards ? "ownedCardsDesc" : "cardsDesc")}</p></div>
      <Button asChild variant={showingOwnedCards ? "default" : "outline"}><Link to={showingOwnedCards ? "/cards" : "/cards/owned"}>{showingOwnedCards ? <Plus /> : <CreditCard />}{t(showingOwnedCards ? "openCardCenter" : "ownedCards")}</Link></Button>
    </header>
    {!showingOwnedCards ? <section className="product-grid">
      {[0, 1, 2].map((item) => <article className="product-card" key={item}>
        <div className="product-card-hero">
          <div className="product-card-art interactive-card is-loading" aria-hidden="true" {...interactiveCardMotion}><div><span>AVANFINITY</span><DataSkeleton /></div><strong>{t("virtualStoredValueCard")}</strong><b><DataSkeleton /></b><div><small><DataSkeleton /></small><small>VIRTUAL</small></div></div>
          <div className="product-card-intro">
            <div className="product-card-copy"><span>{t("virtualStoredValueCard")}</span><h2><DataSkeleton /></h2><p><DataSkeleton /></p></div>
            <p className="product-purpose"><DataSkeleton /></p>
            <div className="product-categories"><DataSkeleton /><DataSkeleton /></div>
          </div>
        </div>
        <div className="product-card-decision">
          <dl className="product-card-facts">{["cardType", "openFee", "rechargeRate", "initialAmount"].map((label) => <div key={label}><dt>{t(label)}</dt><dd><DataSkeleton /></dd></div>)}</dl>
          <Button disabled><Plus /> {t("viewAndOpen")}</Button>
        </div>
      </article>)}
    </section> : <section className="owned-cards">
      <div className="section-title"><h2>{t("cardList")}</h2><DataSkeleton /></div>
      <div className="owned-grid">{[0, 1, 2].map((item) => <article className="bank-card interactive-card is-loading" key={item} {...interactiveCardMotion}>
        <div><span><DataSkeleton /></span><DataSkeleton /></div><strong><DataSkeleton /></strong><div><small><DataSkeleton /></small><span className="card-status-badge"><DataSkeleton /></span><b><DataSkeleton /></b></div>
        <div className="card-actions"><Button size="xs" variant="outline" disabled>{t("details")}</Button><Button size="xs" variant="secondary" disabled>{t("recharge")}</Button><Button size="xs" variant="ghost" disabled>{t("refund")}</Button></div>
      </article>)}</div>
    </section>}
  </main>;

  const availableProducts = products.data?.data ?? [];
  const categoryOptions = [...new Set(availableProducts.flatMap((product) => categoryChips(product.category)))];
  const activeCategory = categoryOptions.includes(selectedCategory) ? selectedCategory : "";
  const visibleProducts = activeCategory
    ? availableProducts.filter((product) => categoryChips(product.category).includes(activeCategory))
    : availableProducts;
  const performanceByCard = new Map(cardSuccesses.data?.data.list.map((item) => [item.cardId, item]) ?? []);
  const ownedPageSize = cards.data?.data.pageSize ?? 20;
  const ownedTotalPages = cards.data ? Math.max(1, Math.ceil(cards.data.data.total / ownedPageSize)) : 1;
  const spendableBalance = dashboard.data?.spendableBalance ?? dashboard.data?.walletBalance;
  function submitAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!cardAction) return;
    if (cardAction.action === "recharge" && !flags.cardRecharge) return;
    if (cardAction.action === "refund" && !flags.cardManagement) return;
    if (cardAction.action === "recharge") {
      if (!rechargeQuote.currentQuote || rechargeQuote.isFetching || rechargeQuote.isError) return;
      if (rechargeDebitExceedsSpendable(rechargeQuote.currentQuote.totalDebit, spendableBalance)) return;
      runAction(cardAction.card, cardAction.action, actionAmount, rechargeQuote.currentQuote.fee);
      return;
    }
    runAction(cardAction.card, cardAction.action, actionAmount);
  }

  function runAction(card: Card, action: string, amount?: string, expectedFee?: string) {
    if (action === "recharge" && !flags.cardRecharge) return;
    if (["refund", "freeze", "unfreeze"].includes(action) && !flags.cardManagement) return;
    const fingerprint = JSON.stringify({ cardId: card.id, action, amount: amount ?? null, expectedFee: expectedFee ?? null });
    actionMutation.mutate({ card, action, amount, expectedFee, idempotencyKey: keyForIntent(actionIntent, fingerprint) });
  }

  return <main className="cards-page">
    <header><div><span className="eyebrow">VIRTUAL CARDS</span><h1>{t(showingOwnedCards ? "ownedCards" : "cardsTitle")}</h1><p>{t(showingOwnedCards ? "ownedCardsDesc" : "cardsDesc")}</p></div>
      <Button asChild variant={showingOwnedCards ? "default" : "outline"}><Link to={showingOwnedCards ? "/cards" : "/cards/owned"}>{showingOwnedCards ? <Plus /> : <CreditCard />}{t(showingOwnedCards ? "openCardCenter" : "ownedCards")}</Link></Button>
    </header>
    {!showingOwnedCards && categoryOptions.length > 0 && <div className="product-category-filter" role="group" aria-label={t("filterByCategory")}>
      <span>{t("filterByCategory")}</span>
      <Button size="sm" variant={activeCategory === "" ? "default" : "outline"} aria-pressed={activeCategory === ""} onClick={() => setSelectedCategory("")}>{t("allCategories")}</Button>
      {categoryOptions.map((category) => <Button size="sm" variant={activeCategory === category ? "default" : "outline"} aria-pressed={activeCategory === category} onClick={() => setSelectedCategory(category)} key={category}>{category}</Button>)}
    </div>}
    {!showingOwnedCards && <section className="product-grid">
      {visibleProducts.map((product) => {
        const bins = productBins(product);
        const binPerformance = new Map((paymentReferences.data?.data.binStats ?? []).map((item) => [item.bin6, item]));
        return <article className="product-card" data-testid={`product-${product.productCode}`} key={product.productCode}>
        <div className="product-card-hero">
          <div className="product-card-art interactive-card" aria-hidden="true" {...interactiveCardMotion}>
            <div><span>AVANFINITY</span><CardNetworkBrand network={product.network} /></div>
            <strong>{product.cardType.toLowerCase() === "save" ? t("virtualStoredValueCard") : product.cardType}</strong>
            <b className={bins.length > 1 ? "is-multiple" : undefined}>{bins.length === 1 ? `${bins[0]} •••• •••• ••••` : bins.length > 1 ? bins.join(" / ") : t("cardBinUnavailable")}</b>
            <div><small>{product.issuingArea}</small><small>VIRTUAL</small></div>
          </div>
          <div className="product-card-intro">
            <div className="product-card-copy"><span>{t("virtualStoredValueCard")}</span><h2>{product.network}</h2><p>{product.issuer} · <code>{product.productCode}</code></p></div>
            <details className="product-purpose-more">
              <summary>
                <span className="product-purpose-toggle"><span className="is-more">{t("purposeExpand")}</span><span className="is-less">{t("purposeCollapse")}</span></span>
                <span className="product-purpose">{product.description ?? t("productDescriptionFallback")}</span>
              </summary>
            </details>
            <div className="product-categories" aria-label={t("productCategory")}>{categoryChips(product.category).length ? categoryChips(product.category).map((category) => <span key={category}>{category}</span>) : <span>{t("noProductCategory")}</span>}</div>
          </div>
        </div>
        <div className="product-card-decision">
          <dl className="product-card-facts"><div><dt>{t("cardType")}</dt><dd>{product.cardType.toLowerCase() === "save" ? t("virtualStoredValueCard") : product.cardType}</dd></div><div><dt>{t("openFee")}</dt><dd>${formatDecimal(product.openFee)}</dd></div><div><dt>{t("rechargeRate")}</dt><dd>{rate(product.rechargeRate)}</dd></div><div className="product-fact-amount"><dt>{t("initialAmount")}</dt><dd>${formatDecimal(product.minAmount)}–${formatDecimal(product.maxAmount)}</dd></div></dl>
          {flags.cardOpening && <Button asChild><Link to="/cards/open/$productCode" params={{ productCode: product.productCode }} search={{ gptRetry: search.gptRetry }}><Plus /> {t("viewAndOpen")}</Link></Button>}
        </div>
        <div className="product-card-reference">
          {bins.map((bin) => {
            const item = binPerformance.get(bin);
            return <div className="product-payment-performance" data-testid="product-openai-success" key={bin}><strong>{t("paymentBinLabel", { bin })}</strong>{item ? <PaymentPerformance overall={item.overall} plans={item.plans} /> : <span className="payment-performance-empty">{t("paymentNoSample")}</span>}</div>;
          })}
          <ProductFeeDetails product={product} />
        </div>
      </article>;
      })}
    </section>}
    {showingOwnedCards && <div className="owned-card-tools">
      <form className="card-tools-search" onSubmit={event => { event.preventDefault(); setCardPage(1); setCardSearch(searchInput.trim()); }}>
        <label htmlFor="owned-card-search">{t("cardTools.searchLabel")}</label>
        <input id="owned-card-search" type="text" inputMode="numeric" pattern="[0-9]{0,6}" maxLength={6} placeholder={t("cardTools.searchPlaceholder")} value={searchInput} onChange={event => setSearchInput(event.target.value)} />
        <div className="card-tools-actions">
          <Button type="submit">{t("cardTools.search")}</Button>
          {(searchInput || cardSearch) && <Button type="button" variant="outline" onClick={() => { setSearchInput(""); setCardSearch(""); setCardPage(1); }}>{t("cardTools.clearSearch")}</Button>}
        </div>
        <p>{t("cardTools.searchHint")}</p>
      </form>
      <CardClosurePanel key={String(sessionIdentity(session))} owner={String(sessionIdentity(session))} token={session.token} enabled={flags.cardDelete} />
      {cards.isError && <p role="alert">{t("cardTools.searchError")} <Button variant="outline" onClick={() => void cards.refetch()}>{t("cardTools.refresh")}</Button></p>}
    </div>}
    {showingOwnedCards && cards.data && <section className="owned-cards">
      <div className="section-title"><h2>{t("cardList")}</h2><span>{t("cardCountLabel", { count: cards.data.data.total })}</span></div>
      {cards.data.data.list.length === 0 ? <div className="empty-state">{t(cardSearch ? "cardTools.noMatches" : "noCards")}</div> :
        <div className="owned-grid">{cards.data.data.list.map((card) => {
          const closing = card.pendingOperationType === "DELETE";
          const closed = card.status === "DELETED";
          const upstreamClosed = (card.accountingStatus ?? card.status) !== "DELETED" && ["DELETED", "CANCELLED", "CANCELED"].includes(card.upstreamStatus?.toUpperCase() ?? "");
          const busy = Boolean(card.pendingOperationId) || upstreamClosed;
          const performance = performanceByCard.get(card.id);
          const pendingStatus = card.pendingOperationId && card.pendingOperationType !== "GPT_DIRECT"
            ? t(`cardActionPending.${card.pendingOperationType}`, { defaultValue: t("operationPendingTitle") }) : null;
          const statusLabel = upstreamClosed ? t("cardUpstreamClosed") : closing ? t("cardClosing") : closed ? t("cardClosed") : pendingStatus ?? card.status;
          const statusClass = closing || pendingStatus ? "closing" : closed ? "deleted" : card.status.toLowerCase();
          const successRate = formatRateBps(performance?.overall.successRateBps);
          const declineRate = formatRateBps(performance?.overall.declineRateBps);
          const cardRate = performance?.overall.attempts && successRate && declineRate
            ? t("paymentOverallSummary", { successRate, declineRate, attempts: performance.overall.attempts })
            : null;
          return <article className={`bank-card interactive-card${closed ? " is-closed" : ""}`} key={card.id} {...interactiveCardMotion}>
          <div><span>{card.productCode}</span><CardNetworkBrand network={card.network} /></div>
          <strong>{card.cardNumberMasked}</strong>
          {card.note?.trim() ? <p className="owned-card-note" data-testid="owned-card-note" title={card.note}>{card.note}</p> : null}
          {cardRate && <p className="owned-card-rate">{cardRate}</p>}
          {pendingStatus && <p role="status">{card.pendingOperationError || t(["FREEZE", "UNFREEZE"].includes(card.pendingOperationType ?? "") ? "cardStatusPendingHint" : "operationPendingDoNotRetry")}</p>}
          {card.pendingOperationType === "GPT_DIRECT" && card.pendingOperationId && <p role="status">直充订单占用此卡 · <Link to="/gpt-direct/orders/$orderId" params={{ orderId: card.pendingOperationId }}>查看直充订单</Link></p>}
          <div><small>{card.firstName} {card.lastName}</small><span className={`card-status-badge is-${statusClass}`}>{statusLabel}</span><b>${formatDecimal(card.balance)}</b></div>
          <div className="card-actions">
            <Button asChild size="xs" variant="outline"><Link to="/cards/$cardId" params={{ cardId: String(card.id) }}>{t("details")}</Link></Button>
            {flags.cardRecharge && card.status === "ACTIVE" && !busy && <Button size="xs" variant="secondary" onClick={() => { setError(""); setActionAmount(""); setCardAction({ card, action: "recharge" }); }}>{t("recharge")}</Button>}
            {flags.cardManagement && card.status === "ACTIVE" && !busy && <Button size="xs" variant="ghost" title={t("refundMinimumAmountHint")} disabled={Number((Number(card.balance) - Number(card.refundKeepMinimum)).toFixed(4)) < 1} onClick={() => { setError(""); setActionAmount(""); setCardAction({ card, action: "refund" }); }}>{t("refund")}</Button>}
            {flags.cardManagement && !busy && (card.status === "ACTIVE" || card.status === "FROZEN") && <Button size="xs" variant="ghost" onClick={() => runAction(card, card.status === "ACTIVE" ? "freeze" : "unfreeze")}>
              {card.status === "ACTIVE" ? t("freeze") : t("unfreeze")}
            </Button>}
          </div>
        </article>})}</div>}
      {cards.data.data.total > ownedPageSize && <div className="owned-cards-pagination" data-testid="owned-cards-pagination">
        <Button variant="outline" disabled={cardPage <= 1} onClick={() => setCardPage((value) => value - 1)}><ChevronLeft />{t("previousPage")}</Button>
        <span>{t("pageOf", { page: cardPage, total: ownedTotalPages })}</span>
        <Button variant="outline" disabled={cardPage >= ownedTotalPages} onClick={() => setCardPage((value) => value + 1)}>{t("nextPage")}<ChevronRight /></Button>
      </div>}
    </section>}
    {error && !cardAction && <p role="alert" className="error">{error}</p>}
    <Dialog.Root open={Boolean(cardAction && (cardAction.action === "recharge" ? flags.cardRecharge : flags.cardManagement))} onOpenChange={(open) => {
      if (!open && !actionMutation.isPending) {
        setCardAction(null);
        setActionAmount("");
      }
    }}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content">
          <Dialog.Title>{cardAction?.action === "recharge" ? t("recharge") : t("refund")}</Dialog.Title>
          <Dialog.Description>{cardAction?.card.cardNumberMasked} · {t("currentBalance")} ${formatDecimal(cardAction?.card.balance)}</Dialog.Description>
          <form onSubmit={submitAction}>
            {cardAction?.action === "refund" && <p>{t("refundBalanceSyncHint")}</p>}
            <label>{t("amountUsd")}<input name="amount" type="number" inputMode="decimal" step="0.0001" min={actionMinimum} max={actionMaximum} placeholder={actionMinimum ?? "10.00"} value={actionAmount} onChange={(event) => { setActionAmount(event.target.value); setError(""); }} disabled={actionMutation.isPending} required /><small>{cardAction?.action === "recharge" ? t("rechargeAmountRange", { min: formatDecimal(actionMinimum), max: formatDecimal(actionMaximum) }) : t("refundAmountRange", { max: formatDecimal(actionMaximum), minimum: formatDecimal(cardAction?.card.refundKeepMinimum) })}</small></label>
            {cardAction?.action === "recharge" && <CardRechargeQuoteSummary amount={actionAmount} amountIsValid={rechargeQuote.amountIsValid} isFetching={rechargeQuote.isFetching} isError={rechargeQuote.isError} quote={rechargeQuote.currentQuote} error={rechargeQuote.error} spendableBalance={spendableBalance} onRetry={() => { void rechargeQuote.refetch(); }} />}
            {error && <p role="alert" className="error">{error}</p>}
            <Button type="submit" size="lg" disabled={actionMutation.isPending || (cardAction?.action === "recharge" && (!rechargeQuote.currentQuote || rechargeQuote.isFetching || rechargeQuote.isError || rechargeDebitExceedsSpendable(rechargeQuote.currentQuote.totalDebit, spendableBalance)))}>
              <StableSwap state={actionMutation.isPending ? "busy" : "idle"} labels={{ idle: t("confirmAction"), busy: t("processing") }} />
            </Button>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </main>;
}
