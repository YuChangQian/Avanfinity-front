import { formatDecimal, formatRateAsPercent } from "../decimal";
import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CreditCard, Pencil, Power, SlidersHorizontal, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  deleteAdminPricingOverride,
  getAdminProducts,
  getAdminPricing,
  upsertAdminPricingOverride,
  updateAdminProduct,
  updateAdminProductPresentation,
  type AdminProduct,
  type PricingOverride,
} from "../api";
import { Button } from "./ui/button";
import { StableSwap } from "./StableSwap";

function productFields(product: AdminProduct, active = product.active) {
  const { issuer, network, issuingArea, cardType, openFee, rechargeRate, minAmount, maxAmount } = product;
  return { issuer, network, issuingArea, cardType, openFee, rechargeRate, minAmount, maxAmount, active };
}

function rate(value: string | null) {
  return formatRateAsPercent(value ?? "");
}

function PricingOverrideEditor({ token, product, onClose }: { token: string; product: AdminProduct; onClose: () => void }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [tierCode, setTierCode] = useState("");
  const [notice, setNotice] = useState("");
  const pricing = useQuery({ queryKey: ["admin-pricing"], queryFn: () => getAdminPricing(token), retry: false });
  const selectedTier = tierCode || pricing.data?.data.tiers[0]?.code || "";
  const current = pricing.data?.data.overrides.find((item) => item.productCode === product.productCode && item.tierCode === selectedTier);
  const save = useMutation({
    mutationFn: (input: PricingOverride) => upsertAdminPricingOverride(token, input),
    onSuccess: async () => { setNotice(t("overrideSaved")); await client.invalidateQueries({ queryKey: ["admin-pricing"] }); },
  });
  const remove = useMutation({
    mutationFn: (input: PricingOverride) => deleteAdminPricingOverride(token, input),
    onSuccess: async () => { setNotice(t("overrideRemoved")); await client.invalidateQueries({ queryKey: ["admin-pricing"] }); },
  });
  const error = save.error ?? remove.error;

  return <section className="admin-override-editor" aria-labelledby="override-title">
    <div className="admin-section-heading"><div><span className="admin-kicker">OVERRIDE</span><h3 id="override-title"><SlidersHorizontal /> {t("singleProductOverride")}</h3><p>{product.productCode} · {t("overrideGuardrail")}</p></div><Button size="icon-sm" variant="ghost" onClick={onClose} aria-label={t("cancel")}><X /></Button></div>
    {pricing.isLoading && <div className="admin-state loading-skeleton loading-skeleton-block" aria-label={t("loading")}>{t("loading")}</div>}
    {pricing.isError && <div className="admin-state is-error" role="alert">{t("adminLoadFailed")}</div>}
    {pricing.data && pricing.data.data.tiers.length > 0 && <form key={`${product.productCode}-${selectedTier}-${current?.version ?? 0}`} className="admin-override-form" onSubmit={(event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      save.mutate({ productCode: product.productCode, tierCode: selectedTier, version: current?.version ?? 0, saleOpenFee: String(data.get("saleOpenFee")).trim() || null, saleRechargeRate: String(data.get("saleRechargeRate")).trim() || null });
    }}>
      <label>{t("customerTier")}<select value={selectedTier} onChange={(event) => { setTierCode(event.target.value); setNotice(""); }}>{pricing.data.data.tiers.map((tier) => <option key={tier.code} value={tier.code}>{tier.nameZh} / {tier.nameEn}</option>)}</select></label>
      <label>{t("saleOpenFee")}<input name="saleOpenFee" type="number" min={product.costOpenFee ?? "0"} step="0.0001" defaultValue={formatDecimal(current?.saleOpenFee ?? "")} placeholder={t("useTierDefault")} /></label>
      <label>{t("saleRechargeRate")}<input name="saleRechargeRate" type="number" min={product.costRechargeRate ?? "0"} max="1" step="0.000001" defaultValue={current?.saleRechargeRate ?? ""} placeholder={t("useTierDefault")} /></label>
      <div className="admin-card-actions"><Button type="submit" disabled={save.isPending}><StableSwap state={save.isPending ? "busy" : "idle"} labels={{ idle: t("saveOverride"), busy: t("processing") }} /></Button>{current && <Button type="button" variant="outline" onClick={() => remove.mutate(current)} disabled={remove.isPending}><Trash2 />{t("removeOverride")}</Button>}</div>
    </form>}
    {pricing.data?.data.tiers.length === 0 && <div className="admin-state">{t("noMembershipTiers")}</div>}
    {error && <p className="admin-alert is-error" role="alert">{error instanceof Error ? error.message : t("updateFailed")}</p>}
    {notice && <p className="admin-alert is-success" role="status">{notice}</p>}
  </section>;
}

function ProductPresentationEditor({ token, product, onClose }: { token: string; product: AdminProduct; onClose: () => void }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: (input: { descriptionOverride: string | null; categoryOverride: string | null }) =>
      updateAdminProductPresentation(token, product.productCode, { version: product.version, ...input }),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["admin-products"] }),
        client.invalidateQueries({ queryKey: ["products"] }),
      ]);
      onClose();
    },
  });
  const savePresentation = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    save.mutate({ descriptionOverride: String(data.get("descriptionOverride")).trim(), categoryOverride: String(data.get("categoryOverride")).trim() });
  };

  return <section className="admin-override-editor product-presentation-editor" aria-labelledby="presentation-title">
    <div className="admin-section-heading"><div><span className="admin-kicker">PRESENTATION</span><h3 id="presentation-title"><Pencil /> {t("productPresentation")}</h3><p>{product.productCode} · {product.descriptionOverride !== null || product.categoryOverride !== null ? t("presentationLocalOverride") : product.providerCode ? t("presentationFollowsUpstream") : t("presentationUsesDefault")}</p></div><Button size="icon-sm" variant="ghost" onClick={onClose} aria-label={t("cancel")}><X /></Button></div>
    <form key={`${product.productCode}-${product.version}`} className="admin-presentation-form" onSubmit={savePresentation}>
      <label>{t("upstreamDescription")}<textarea readOnly value={product.upstreamDescription ?? t("noUpstreamDescription")} /></label>
      <label>{t("upstreamCategory")}<input readOnly value={product.upstreamCategory ?? t("noUpstreamCategory")} /></label>
      <label>{t("localDescriptionOverride")}<textarea name="descriptionOverride" defaultValue={product.descriptionOverride ?? ""} maxLength={2000} placeholder={t("productDescriptionFallback")} /></label>
      <label>{t("localCategoryOverride")}<input name="categoryOverride" defaultValue={product.categoryOverride ?? ""} maxLength={128} placeholder={t("categoryPlaceholder")} /></label>
      <div className="admin-card-actions"><Button type="submit" disabled={save.isPending}><StableSwap state={save.isPending ? "busy" : "idle"} labels={{ idle: t("savePresentation"), busy: t("processing") }} /></Button><Button type="button" variant="outline" disabled={save.isPending || (product.descriptionOverride === null && product.categoryOverride === null)} onClick={() => save.mutate({ descriptionOverride: null, categoryOverride: null })}>{t("restoreUpstreamPresentation")}</Button></div>
    </form>
    {save.error && <p className="admin-alert is-error" role="alert">{save.error instanceof Error ? save.error.message : t("updateFailed")}</p>}
  </section>;
}

export function AdminProductsPanel({ token }: { token: string }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [overrideProduct, setOverrideProduct] = useState<AdminProduct | null>(null);
  const [presentationProduct, setPresentationProduct] = useState<AdminProduct | null>(null);
  const [error, setError] = useState("");
  const products = useQuery({
    queryKey: ["admin-products"],
    queryFn: () => getAdminProducts(token),
    retry: false,
  });
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["admin-products"] }),
      client.invalidateQueries({ queryKey: ["products"] }),
    ]);
  };
  const toggle = useMutation({
    mutationFn: (product: AdminProduct) =>
      updateAdminProduct(token, product.productCode, {
        ...productFields(product, !product.active),
        version: product.version,
      }),
    onSuccess: async () => {
      setError("");
      await refresh();
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : t("updateFailed")),
  });

  return <section className="admin-surface admin-products" aria-labelledby="product-catalog-title">
    <div className="admin-section-heading">
      <div>
        <span className="admin-kicker">CATALOG</span>
        <h2 id="product-catalog-title"><CreditCard /> {t("cardProducts")}</h2>
        <p>{t("upstreamProductHint")}</p>
      </div>
    </div>
    {error && <p role="alert" className="admin-alert is-error">{error}</p>}
    {overrideProduct && <PricingOverrideEditor token={token} product={overrideProduct} onClose={() => setOverrideProduct(null)} />}
    {presentationProduct && <ProductPresentationEditor token={token} product={presentationProduct} onClose={() => setPresentationProduct(null)} />}
    {products.isLoading && <div className="admin-state loading-skeleton loading-skeleton-table" aria-live="polite" aria-label={t("loading")}>{t("loading")}</div>}
    {products.isError && <div className="admin-state is-error" role="alert">{t("updateFailed")}</div>}
    {products.data?.data.length === 0 && <div className="admin-state">{t("noCardProducts")}</div>}
    {products.data && products.data.data.length > 0 && <div className="admin-product-list" data-testid="admin-product-list">
      {products.data.data.map((product) => <article key={product.productCode} data-testid={`admin-product-${product.productCode}`}>
        <div className="admin-product-topline">
          <div className="admin-product-icon"><CreditCard /></div>
          <div>
            <div className="admin-product-name"><strong>{product.network}</strong><code>{product.productCode}</code></div>
            <small>{product.issuer} · {product.issuingArea} · {product.cardType}</small>
          </div>
          <span className={`status-pill ${product.active ? "is-active" : ""}`}>{product.active ? t("active") : t("inactive")}</span>
        </div>
        <p className="admin-product-description">{product.description ?? t("productDescriptionFallback")}</p>
        <div className="admin-cost-meta"><span>{product.category ?? t("noProductCategory")}</span><span>{product.descriptionOverride !== null || product.categoryOverride !== null ? t("presentationLocalOverride") : product.providerCode ? t("presentationFollowsUpstream") : t("presentationUsesDefault")}</span></div>
        {product.providerCode ? <dl className="admin-metrics compact product-cost-metrics">
          <div><dt>{t("costOpenFee")}</dt><dd>{product.costOpenFee === null ? "—" : `$${formatDecimal(product.costOpenFee)}`}</dd></div>
          <div><dt>{t("costRechargeRate")}</dt><dd>{rate(product.costRechargeRate)}</dd></div>
          <div><dt>{t("costRefundRate")}</dt><dd>{rate(product.costRtfRate)}</dd></div>
          <div><dt>{t("amountRange")}</dt><dd>${formatDecimal(product.minAmount)}–${formatDecimal(product.maxAmount)}</dd></div>
        </dl> : <dl className="admin-metrics compact product-cost-metrics">
          <div><dt>{t("legacyOpenFee")}</dt><dd>${formatDecimal(product.openFee)}</dd></div>
          <div><dt>{t("legacyRechargeRate")}</dt><dd>{rate(product.rechargeRate)}</dd></div>
          <div><dt>{t("amountRange")}</dt><dd>${formatDecimal(product.minAmount)}–${formatDecimal(product.maxAmount)}</dd></div>
        </dl>}
        <div className="admin-cost-meta"><span>{product.providerCode ?? t("notSynced")}</span><span>{product.costVersion === null ? t("costVersionUnknown") : t("costVersion", { version: product.costVersion })}</span><span>{product.upstreamAvailable === false ? t("upstreamUnavailable") : product.costSyncedAt ?? "—"}</span></div>
        {product.providerCode && <div className="admin-cost-meta">
          <span>{product.upstreamEnabled === false ? t("upstreamDisabled") : t("upstreamEnabled")}</span>
          <span>{product.upstreamCanOpen === false ? t("upstreamCannotOpen") : t("upstreamCanOpen")}</span>
          <span>{t("upstreamSort", { value: product.upstreamSort ?? 0 })}</span>
        </div>}
        {product.providerCode && <div className="admin-cost-meta" data-testid={`product-policy-${product.productCode}`}>
          <span>{product.googleChatgptBlocked ? t("googleChatgptBlocked") : t("googleChatgptAllowed")}</span>
          {product.restrictedMerchants?.length
            ? product.restrictedMerchants.map((merchant) => <span key={merchant}>{t("restrictedMerchant")}: {merchant}</span>)
            : <span>{t("noRestrictedMerchants")}</span>}
        </div>}
        {Object.keys(product.upstreamMetadata ?? {}).length > 0 && <details className="admin-upstream-metadata">
          <summary>{t("upstreamProductMetadata")}</summary>
          <pre>{JSON.stringify(product.upstreamMetadata, null, 2)}</pre>
        </details>}
        <div className="admin-card-actions">
          {product.costOpenFee !== null && product.upstreamAvailable && <Button size="xs" variant="outline" onClick={() => setOverrideProduct(product)}><SlidersHorizontal /> {t("configureOverride")}</Button>}
          <Button size="xs" variant="outline" onClick={() => setPresentationProduct(product)}><Pencil /> {t("editPresentation")}</Button>
          <Button size="xs" variant="ghost" onClick={() => toggle.mutate(product)} disabled={toggle.isPending}>
            <Power /> {product.active ? t("disable") : t("enable")}
          </Button>
        </div>
      </article>)}
    </div>}
  </section>;
}
