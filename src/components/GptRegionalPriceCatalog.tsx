import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getGptPriceCatalog, type GptCatalogPrice } from "../api";
import { Button } from "./ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

const planLabels: Record<string, string> = { go: "Go", plus: "Plus", pro_5x: "Pro 5x", pro_20x: "Pro 20x", pro_25x: "Pro 25x" };
const planOrder = Object.keys(planLabels);

export function GptRegionalPriceCatalog({ token, regions, enabledPlans, disabled, onSelect }: {
  token: string;
  regions: ReadonlyArray<{ country: string; currency: string }>;
  enabledPlans: string[];
  disabled: boolean;
  onSelect: (plan: string, country: string, currency: string) => void;
}) {
  const { i18n } = useTranslation();
  const en = i18n.language === "en";
  const locale = en ? "en-US" : "zh-CN";
  const names = new Intl.DisplayNames([locale], { type: "region" });
  const [plan, setPlan] = useState("plus");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("price_asc");
  const [open, setOpen] = useState(false);
  const query = useQuery({ queryKey: ["gpt-price-catalog"], queryFn: () => getGptPriceCatalog(token), retry: false, staleTime: 60_000, refetchInterval: 60_000 });
  const countries = query.data?.data.countries ?? [];
  const primaryPrice = (price: GptCatalogPrice) => price.pspTax === "exclusive" && price.pspAmountMajor ? price.pspAmountMajor : price.amountMajor;
  const amount = (price?: GptCatalogPrice) => {
    // Reuse the catalog FX rate for the same local amount shown as the primary price.
    const n = price ? Number(price.amountUsd) * Number(primaryPrice(price)) / Number(price.amountMajor) : NaN;
    return price?.amountUsd != null && Number.isFinite(n) && n > 0 ? n : null;
  };
  const label = (country: string) => names.of(country) ?? country;
  const rows = countries.flatMap(country => {
    const prices = country.rows.filter(price => plan === "all" || price.plan === plan);
    return (prices.length ? prices : country.rows.length === 0 ? [undefined] : []).map(price => ({ country, price }));
  }).filter(({ country }) => `${country.country} ${label(country.country)}`.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => {
      if (sort === "type") {
        const types = (a.price ? planOrder.indexOf(a.price.plan) : 99) - (b.price ? planOrder.indexOf(b.price.plan) : 99);
        if (types) return types;
      }
      const left = amount(a.price), right = amount(b.price);
      if (left === null || right === null) return left === right ? a.country.country.localeCompare(b.country.country) : left === null ? 1 : -1;
      return (sort === "price_desc" ? right - left : left - right) || a.country.country.localeCompare(b.country.country);
    });
  const money = (value: string, currency: string) => new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 3 }).format(Number(value));

  return <section className="gpt-price-catalog" aria-labelledby="gpt-catalog-title">
    <div className="gpt-catalog-heading"><div><span className="eyebrow">REGIONAL PRICES</span><h2 id="gpt-catalog-title">{en ? "Prices by country and region" : "各国家地区价格"}</h2></div><span>{en ? `${countries.length} regions collected` : `已采集 ${countries.length} 个地区`}</span><Button size="sm" variant="outline" aria-expanded={open} aria-controls="gpt-catalog-content" aria-label={en ? `${open ? "Collapse" : "Expand"} regional prices` : `${open ? "收起" : "展开"}各国家地区价格`} onClick={() => setOpen(value => !value)}>{en ? (open ? "Collapse" : "Expand") : (open ? "收起" : "展开")}</Button></div>
    <div id="gpt-catalog-content" className="gpt-price-disclosure" data-open={open} aria-hidden={!open} inert={!open}><div>
    <p className="gpt-catalog-note">{en ? "Browse without a Session or preflight. The main price and sorting use the tax-exclusive price when returned, otherwise the returned final price. Tax-inclusive prices appear below in small text. USD conversions are estimates; final amounts and eligibility depend on checkout." : "无需填写 Session 或预检即可查看。主价格及排序优先使用返回的未税价，没有未税价则使用返回的最终价；含税价以小字展示。美元为汇率估算，最终金额及购买资格以账户结账为准。"}</p>
    <div className="gpt-catalog-filters">
      <label>{en ? "Plan filter" : "套餐筛选"}<Select value={plan} onValueChange={setPlan}>
        <SelectTrigger aria-label={en ? "Plan filter" : "套餐筛选"}><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="all">{en ? "All plans" : "全部套餐"}</SelectItem>{planOrder.map(key => <SelectItem key={key} value={key}>{planLabels[key]}</SelectItem>)}</SelectContent>
      </Select></label>
      <label>{en ? "Sort prices" : "价格排序"}<Select value={sort} onValueChange={setSort}>
        <SelectTrigger aria-label={en ? "Sort prices" : "价格排序"}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="price_asc">{en ? "USD estimate: low to high" : "美元估算：从低到高"}</SelectItem>
          <SelectItem value="price_desc">{en ? "USD estimate: high to low" : "美元估算：从高到低"}</SelectItem>
          <SelectItem value="type">{en ? "Plan type, then price" : "套餐类型，再按价格"}</SelectItem>
        </SelectContent>
      </Select></label>
      <label>{en ? "Search countries or regions" : "搜索国家或地区"}<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder={en ? "Country name or code" : "国家名称或代码，例如 JP"} /></label>
    </div>
    {query.isError && <p className="gpt-catalog-error" role="alert">{en ? "Prices could not be loaded." : "价格暂时无法加载。"}<Button size="sm" variant="outline" onClick={() => void query.refetch()}>{en ? "Retry" : "重试"}</Button></p>}
    {query.isLoading ? <p role="status">{en ? "Loading prices…" : "正在加载地区价格…"}</p> : <div className="gpt-catalog-scroll" tabIndex={0} role="region" aria-label={en ? "Regional price table" : "地区价格表"}>
      <table><thead><tr>{[en ? "Country / region" : "国家 / 地区", en ? "Plan" : "套餐", en ? "Monthly reference price" : "月度参考价", en ? "USD estimate" : "美元估算", en ? "Updated / status" : "更新时间 / 状态", en ? "Checkout" : "充值"].map(title => <th key={title} scope="col">{title}</th>)}</tr></thead>
        <tbody>{rows.map(({ country, price }) => {
          const available = price && enabledPlans.includes(price.plan) && regions.some(region => region.country === price.country && region.currency === price.currency);
          const untaxed = price?.tax === "exclusive" || (price?.pspTax === "exclusive" && !!price.pspAmountMajor);
          const inclusive = price?.tax === "inclusive" ? price.amountMajor : price?.pspTax === "inclusive" ? price.pspAmountMajor : null;
          const tax = untaxed ? (en ? "Tax excluded" : "未含税") : price?.tax === "inclusive" ? (en ? "Final price · tax included" : "最终价 · 含税") : (en ? "Tax unspecified" : "税费待确认");
          return <tr key={`${country.country}:${price?.plan ?? "unavailable"}`}>
            <th scope="row"><strong>{label(country.country)}</strong><small>{country.country}{price?.pricingScope === "usd_reference" ? (en ? " · USD reference" : " · 美元参考价") : ""}</small></th>
            <td>{price ? planLabels[price.plan] ?? price.plan : "—"}</td>
            <td>{price ? <><strong>{money(primaryPrice(price), price.currency)}</strong><small>{price.currency} · {tax}</small>{inclusive && <small>{en ? "Tax-inclusive reference: " : "含税参考价："}{money(inclusive, price.currency)}</small>}</> : "—"}</td>
            <td>{amount(price) !== null ? <strong>≈ ${amount(price)!.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong> : <span>{en ? "No FX estimate" : "暂无汇率估算"}</span>}{price?.fxDate && <small>{en ? "FX " : "汇率 "}{price.fxDate}</small>}</td>
            <td>{price ? <><time dateTime={new Date(price.fetchedAt).toISOString()}>{new Date(price.fetchedAt).toLocaleString(locale)}</time>{country.stale && <small className="gpt-catalog-stale">{en ? "Reference price is stale" : "参考价已过期"}</small>}</> : <span>{en ? "Unavailable" : "暂不可用"}</span>}</td>
            <td>{price ? <><Button size="sm" variant="outline" disabled={disabled || !available || country.stale} aria-label={`${en ? "Select" : "选择"} ${label(country.country)} ${planLabels[price.plan] ?? price.plan}`} onClick={() => onSelect(price.plan, price.country, price.currency)}>{en ? "Select" : "选择"}</Button>{!available && <small>{en ? "Checkout not offered here" : "本站暂未开放"}</small>}</> : "—"}</td>
          </tr>;
        })}</tbody>
      </table>
      {!rows.length && !query.isError && <p className="gpt-catalog-empty">{en ? "No matching prices yet. The administrator can configure automatic collection." : "暂无匹配报价，管理员配置自动采集后会陆续显示。"}</p>}
    </div>}
    </div></div>
  </section>;
}
