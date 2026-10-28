import { formatDecimal, formatRateAsPercent } from "../decimal";
import { useRef, useState, type FormEvent } from "react";
import { useAtomValue } from "jotai";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Globe2, LockKeyhole, RefreshCw, ShieldCheck } from "lucide-react";
import { Link, Navigate, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { CardNetworkBrand } from "../components/CardNetworkBrand";
import { DataSkeleton, PageShell } from "../components/PageShell";
import { PaymentPerformance } from "../components/PaymentPerformance";
import { ProductFeeDetails } from "../components/ProductFeeDetails";
import { ApiError, PendingOperationError, getOpenAiPrices, getProducts, openCards, waitForOpenedCards, type Product } from "../api";
import { sessionAtom } from "../state";
import { useFeatures } from "../features";
import { interactiveCardMotion } from "../interactiveCardMotion";

type IntentKey = { fingerprint: string; key: string };

const cardholderNames = [
  ["Avery", "Morgan"],
  ["Jordan", "Ellis"],
  ["Taylor", "Brooks"],
  ["Cameron", "Reed"],
  ["Riley", "Parker"],
  ["Morgan", "Hayes"],
  ["Casey", "Bennett"],
  ["Alex", "Carter"],
] as const;

function categoryChips(category: string | null) {
  return category?.split(/[/,，、]/).map((value) => value.trim()).filter(Boolean) ?? [];
}

function money4Units(value: string) {
  const match = /^(\d+)(?:\.(\d{1,4}))?$/.exec(value);
  if (!match) return null;
  return BigInt(match[1]) * 10_000n + BigInt((match[2] ?? "").padEnd(4, "0"));
}

function formatMoney4(total: bigint) {
  return `${total / 10_000n}.${(total % 10_000n).toString().padStart(4, "0")}`;
}

function addMoney4(...values: string[]) {
  const units = values.map(money4Units);
  if (units.some((value) => value === null)) return "—";
  return formatMoney4(units.reduce<bigint>((total, value) => total + value!, 0n));
}

function initialRechargeFee4(amount: string, rechargeRate: string) {
  const amountUnits = money4Units(amount);
  const rateMatch = /^(\d+)(?:\.(\d{1,6}))?$/.exec(rechargeRate);
  if (amountUnits === null || !rateMatch) return null;
  const rateUnits = BigInt(rateMatch[1]) * 1_000_000n + BigInt((rateMatch[2] ?? "").padEnd(6, "0"));
  return formatMoney4((amountUnits * rateUnits + 999_999n) / 1_000_000n);
}

function rate(value: string) {
  return formatRateAsPercent(value ?? "");
}

function productBins(product: Pick<Product, "displayBin" | "displayBins">) {
  return product.displayBins?.length ? product.displayBins : product.displayBin ? [product.displayBin] : [];
}

export function OpenCardPage() {
  const session = useAtomValue(sessionAtom);
  const { t } = useTranslation();
  const { productCode } = useParams({ strict: false });
  const search = useSearch({ strict: false }) as { gptRetry?: boolean };
  const navigate = useNavigate();
  const client = useQueryClient();
  const intent = useRef<IntentKey | null>(null);
  const firstNameRef = useRef<HTMLInputElement>(null);
  const lastNameRef = useRef<HTMLInputElement>(null);
  const [amount, setAmount] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [pendingOperation, setPendingOperation] = useState<PendingOperationError | null>(null);
  const features = useFeatures();
  const products = useQuery({ queryKey: ["products"], queryFn: () => getProducts(session!.token), enabled: Boolean(session && !features.isPending && features.flags.cardOpening) });
  const paymentReferences = useQuery({ queryKey: ["openai-prices"], queryFn: () => getOpenAiPrices(session!.token), enabled: Boolean(session && !features.isPending && features.flags.market), retry: false });
  const product = products.data?.data.find((item) => item.productCode === productCode);
  const bins = product ? productBins(product) : [];
  const binPerformance = new Map((paymentReferences.data?.data.binStats ?? []).map((item) => [item.bin6, item]));
  const mutation = useMutation({
    mutationFn: ({ idempotencyKey, operationId, ...input }: { productCode: string; firstName: string; lastName: string; initAmount: string; count: number; expectedOpenFee: string; expectedInitialRechargeFee: string; openQuoteVersion: string; idempotencyKey: string; operationId?: string }) =>
      operationId ? waitForOpenedCards(session!.token, operationId) : openCards(session!.token, input, idempotencyKey),
    onMutate: () => { setError(""); },
    onSuccess: async ({ data }) => {
      setPendingOperation(null);
      const cardId = data.cardIds[0];
      if (!cardId) {
        setError(t("openCardResultMissing"));
        return;
      }
      intent.current = null;
      setError("");
      await Promise.all([
        client.invalidateQueries({ queryKey: ["cards"] }),
        client.invalidateQueries({ queryKey: ["dashboard"] }),
        client.invalidateQueries({ queryKey: ["wallet"] }),
      ]);
      if (search.gptRetry) {
        await navigate({ to: "/gpt-direct", search: { cardId } });
      } else {
        await navigate({ to: "/cards/$cardId", params: { cardId: String(cardId) } });
      }
    },
    onError: async (cause) => {
      setPendingOperation(cause instanceof PendingOperationError ? cause : null);
      if (cause instanceof ApiError && cause.errorCode === "PRICE_CHANGED") {
        intent.current = null;
        setError(t("openPriceChanged"));
        await client.refetchQueries({ queryKey: ["products"], type: "active" });
        return;
      }
      setError(cause instanceof PendingOperationError ? "" : cause instanceof Error ? cause.message : t("openCardFailed"));
    },
  });

  const loadingPage = <PageShell className="open-card-page" eyebrow="NEW VIRTUAL CARD" title={t("cardsTitle")} description={t("cardsDesc")}>
    <Button asChild variant="ghost" size="sm"><Link to="/cards" search={{ gptRetry: search.gptRetry }}><ArrowLeft /> {t("backToCards")}</Link></Button>
    <div className="open-card-layout" aria-busy="true">
      <section className="open-card-product">
        <div className="open-card-art" aria-hidden="true"><div><span>AVANFINITY</span><DataSkeleton /></div><small><DataSkeleton /></small><strong>{t("cardNumberAfterOpen")}</strong><div><DataSkeleton /><span>VIRTUAL</span></div></div>
        <div className="open-card-explainer"><span className="eyebrow">{t("cardUseTitle")}</span><h2>{t("virtualStoredValueCard")}</h2><p><DataSkeleton /></p><div className="product-categories"><DataSkeleton /><DataSkeleton /></div><dl className="product-specs">{["network", "cardType", "issuingArea", "rechargeRate", "transactionRefundRate"].map((label) => <div key={label}><dt>{t(label)}</dt><dd><DataSkeleton /></dd></div>)}</dl><div className="open-card-benefits"><div><Globe2 /><span><strong>{t("onlinePayment")}</strong><small>{t("onlinePaymentDesc")}</small></span></div><div><RefreshCw /><span><strong>{t("balanceControl")}</strong><small>{t("balanceControlDesc")}</small></span></div><div><LockKeyhole /><span><strong>{t("privacyControl")}</strong><small>{t("privacyControlDesc")}</small></span></div></div><small className="acceptance-note">{t("cardAcceptanceNote")}</small></div>
      </section>
      <section className="open-card-checkout"><div className="section-title"><div><span className="eyebrow"><DataSkeleton /></span><h2>{t("openCardReview")}</h2></div></div><form><div className="name-grid"><label>{t("firstName")}<input placeholder="Ada" disabled /></label><label>{t("lastName")}<input placeholder="Lovelace" disabled /></label></div><Button type="button" variant="outline" size="sm" disabled><RefreshCw /> {t("randomCardholderName")}</Button><label>{t("initialAmount")}<input placeholder="0.00" disabled /><small><DataSkeleton /></small></label><dl className="open-card-summary">{["openFee", "initialAmount", "initialRechargeFee", "estimatedDebit"].map((label) => <div key={label}><dt>{t(label)}</dt><dd>$<DataSkeleton /></dd></div>)}</dl><Button type="button" size="lg" disabled>{t("confirmOpen")}</Button><p className="open-card-next"><ShieldCheck /><span>{t("openCardNext")}</span></p></form></section>
    </div>
  </PageShell>;

  if (!session) return <Navigate to="/login" />;
  if (features.isPending) return loadingPage;
  if (!features.flags.cardOpening) return <PageShell className="open-card-page" eyebrow="NEW VIRTUAL CARD" title={t("cardOpeningUnavailable")} description={t("featureUnavailable")}>
    <div className="feature-disabled"><ShieldCheck /><p>{t("featureUnavailable")}</p><Button asChild variant="outline"><Link to="/cards" search={{ gptRetry: search.gptRetry }}><ArrowLeft />{t("backToCards")}</Link></Button></div>
  </PageShell>;
  if (!products.data) return loadingPage;
  if (!product) return <Navigate to="/cards" />;

  const displayedAmount = amount ?? product.minAmount;
  const initialRechargeFee = initialRechargeFee4(displayedAmount, product.rechargeRate);
  const estimatedTotal = initialRechargeFee === null
    ? "—"
    : addMoney4(displayedAmount, product.openFee, initialRechargeFee);
  function fillRandomCardholderName() {
    const randomValue = new Uint32Array(1);
    crypto.getRandomValues(randomValue);
    const [firstName, lastName] = cardholderNames[randomValue[0] % cardholderNames.length];
    if (firstNameRef.current) firstNameRef.current.value = firstName;
    if (lastNameRef.current) lastNameRef.current.value = lastName;
    setError("");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!features.flags.cardOpening || mutation.isPending || pendingOperation) return;
    const data = new FormData(event.currentTarget);
    const initAmount = String(data.get("amount"));
    const expectedInitialRechargeFee = initialRechargeFee4(initAmount, product!.rechargeRate);
    if (expectedInitialRechargeFee === null) {
      setError(t("openAmountInvalid"));
      return;
    }
    const input = {
      productCode: product!.productCode,
      firstName: String(data.get("firstName")).trim(),
      lastName: String(data.get("lastName")).trim(),
      initAmount,
      count: 1,
      expectedOpenFee: product!.openFee,
      expectedInitialRechargeFee,
      openQuoteVersion: product!.openQuoteVersion,
    };
    const fingerprint = JSON.stringify(input);
    if (intent.current?.fingerprint !== fingerprint) intent.current = { fingerprint, key: crypto.randomUUID() };
    mutation.mutate({ ...input, idempotencyKey: intent.current.key });
  }

  return <PageShell className="open-card-page" eyebrow="NEW VIRTUAL CARD" title={t("openCardTitle", { network: product.network })} description={t("openCardPageDesc")}>
    <Button asChild variant="ghost" size="sm"><Link to="/cards" search={{ gptRetry: search.gptRetry }}><ArrowLeft /> {t("backToCards")}</Link></Button>
    <div className="open-card-layout">
      <section className="open-card-product">
        <div className="open-card-art interactive-card" aria-label={`${product.network} ${t("virtualStoredValueCard")}`} {...interactiveCardMotion}>
          <div><span>AVANFINITY</span><CardNetworkBrand network={product.network} /></div>
          <small>{product.issuer} · {product.issuingArea}</small>
          <strong>{t("cardNumberAfterOpen")}</strong>
          <div><span>{bins.length === 1 ? `${bins[0]} •••• •••• ••••` : bins.length > 1 ? bins.join(" / ") : t("cardBinUnavailable")}</span><span>VIRTUAL</span></div>
        </div>
        <div className="open-card-explainer">
          <span className="eyebrow">{t("cardUseTitle")}</span>
          <h2>{t("virtualStoredValueCard")}</h2>
          <p>{product.description ?? t("productDescriptionFallback")}</p>
          {bins.map((bin) => {
            const item = binPerformance.get(bin);
            return <div className="product-payment-performance" data-testid="product-openai-success" key={bin}><strong>{t("paymentBinLabel", { bin })}</strong>{item ? <PaymentPerformance overall={item.overall} plans={item.plans} /> : <span className="payment-performance-empty">{t("paymentNoSample")}</span>}</div>;
          })}
          <div className="product-categories" aria-label={t("productCategory")}>{categoryChips(product.category).length ? categoryChips(product.category).map((category) => <span key={category}>{category}</span>) : <span>{t("noProductCategory")}</span>}</div>
          <dl className="product-specs">
            <div><dt>{t("network")}</dt><dd>{product.network}</dd></div>
            <div><dt>{t("cardType")}</dt><dd>{product.cardType.toLowerCase() === "save" ? t("virtualStoredValueCard") : product.cardType}</dd></div>
            <div><dt>{t("issuingArea")}</dt><dd>{product.issuingArea}</dd></div>
            <div><dt>{t("rechargeRate")}</dt><dd>{rate(product.rechargeRate)}</dd></div>
            <div><dt>{t("transactionRefundRate")}</dt><dd>{rate(product.refundRate)}</dd></div>
          </dl>
          <div className="open-card-benefits">
            <div><Globe2 /><span><strong>{t("onlinePayment")}</strong><small>{t("onlinePaymentDesc")}</small></span></div>
            <div><RefreshCw /><span><strong>{t("balanceControl")}</strong><small>{t("balanceControlDesc")}</small></span></div>
            <div><LockKeyhole /><span><strong>{t("privacyControl")}</strong><small>{t("privacyControlDesc")}</small></span></div>
          </div>
          {(Boolean(product.restrictedMerchants?.length) || product.googleChatgptBlocked) && <div className="card-restriction-note">
            <ShieldCheck />
            <div><strong>{t("usageRestrictions")}</strong>
              {Boolean(product.restrictedMerchants?.length) && <p>{t("restrictedMerchant")}: {product.restrictedMerchants!.join(", ")}</p>}
              {product.googleChatgptBlocked && <p>{t("googlePaymentDeletionWarning")}</p>}
            </div>
          </div>}
          <small className="acceptance-note">{t("cardAcceptanceNote")}</small>
        </div>
      </section>

      <section className="open-card-checkout">
        <div className="section-title"><div><span className="eyebrow">{product.productCode}</span><h2>{t("openCardReview")}</h2></div></div>
        <form data-testid="open-card-form" onSubmit={submit}>
          <div className="name-grid">
            <label>{t("firstName")}<input ref={firstNameRef} name="firstName" placeholder="Ada" maxLength={64} autoComplete="given-name" required /></label>
            <label>{t("lastName")}<input ref={lastNameRef} name="lastName" placeholder="Lovelace" maxLength={64} autoComplete="family-name" required /></label>
          </div>
          <Button data-testid="random-cardholder-name" type="button" variant="outline" size="sm" onClick={fillRandomCardholderName}><RefreshCw /> {t("randomCardholderName")}</Button>
          <label>{t("initialAmount")}<input aria-label={t("initialAmount")} aria-describedby="open-card-amount-range" name="amount" type="number" inputMode="decimal" min={product.minAmount} max={product.maxAmount} step="0.0001" value={displayedAmount} onChange={(event) => { setAmount(event.target.value); setError(""); }} required /><small id="open-card-amount-range">{t("amountRangeHint", { min: product.minAmount, max: product.maxAmount })}</small></label>
          <dl className="open-card-summary">
            <div><dt>{t("openFee")}</dt><dd data-testid="open-summary-fee">${formatDecimal(product.openFee)}</dd></div>
            <div><dt>{t("initialAmount")}</dt><dd data-testid="open-summary-amount">${formatDecimal(displayedAmount || "—")}</dd></div>
            <div><dt>{t("initialRechargeFee", { rate: rate(product.rechargeRate) })}</dt><dd data-testid="open-summary-recharge-fee">${formatDecimal(initialRechargeFee ?? "—")}</dd></div>
            <div><dt>{t("estimatedDebit")}</dt><dd data-testid="open-summary-total">${formatDecimal(estimatedTotal)}</dd></div>
          </dl>
          <ProductFeeDetails product={product} />
          {error && <p role="alert" className="error">{error}</p>}
          {mutation.isPending && <p role="status">{t("openCardWaiting")}</p>}
          {pendingOperation && !mutation.isPending && <div role="status">
            <p>{t("openCardStillProcessing")}</p>
            {pendingOperation.operationId && <><p>{t("openCardOperationReference", { id: pendingOperation.operationId })}</p><Button type="button" variant="outline" onClick={() => mutation.mutate({ ...mutation.variables!, operationId: pendingOperation.operationId })}>{t("openCardCheckAgain")}</Button></>}
            <Button asChild variant="ghost"><Link to="/cards/owned">{t("openCardViewOwned")}</Link></Button>
          </div>}
          <Button type="submit" size="lg" disabled={mutation.isPending || Boolean(pendingOperation)}>{mutation.isPending ? t("opening") : t("confirmOpen")}</Button>
          <p className="open-card-next"><ShieldCheck aria-hidden="true" /><span>{t("openCardNext")}</span></p>
        </form>
      </section>
    </div>
  </PageShell>;
}
