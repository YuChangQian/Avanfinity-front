import { useEffect } from "react";
import { useLocation } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

declare const __PUBLIC_ORIGIN__: string;

type Copy = { title: string; description: string };

const PUBLIC_COPY: Record<string, { zh: Copy; en: Copy }> = {
  "/": {
    zh: {
      title: "Avanfinity | 虚拟卡与全球数字支付",
      description: "使用 Avanfinity 管理虚拟卡、全球数字支付、账户资金与业务账单，每一步进度清晰可追溯。",
    },
    en: {
      title: "Avanfinity | Virtual Cards & Global Digital Payments",
      description: "Manage virtual cards, global digital payments, account funds, and business billing with clear, traceable progress.",
    },
  },
  "/register": {
    zh: {
      title: "注册 Avanfinity | 安全数字支付账户",
      description: "注册 Avanfinity，安全管理虚拟卡、数字支付与账户资金。支持中文和 English 界面。",
    },
    en: {
      title: "Create an Avanfinity Account | Secure Digital Payments",
      description: "Create an Avanfinity account to securely manage virtual cards, digital payments, and account funds.",
    },
  },
  "/cdk/redeem": {
    zh: {
      title: "兑换 GPT 直充 CDK | Avanfinity",
      description: "在 Avanfinity 安全兑换 GPT 直充 CDK，并查看兑换状态与处理进度。",
    },
    en: {
      title: "Redeem a GPT Direct CDK | Avanfinity",
      description: "Securely redeem a GPT Direct CDK with Avanfinity and follow its processing status.",
    },
  },
};

function upsertMeta(selector: string, attribute: "name" | "property", key: string, content: string) {
  let element = document.head.querySelector<HTMLMetaElement>(selector);
  if (!element) {
    element = document.createElement("meta");
    element.setAttribute(attribute, key);
    document.head.append(element);
  }
  element.content = content;
}

function upsertAlternate(language: string, href: string) {
  let element = document.head.querySelector<HTMLLinkElement>(`link[rel="alternate"][data-seo-language="${language}"]`);
  if (!element) {
    element = document.createElement("link");
    element.rel = "alternate";
    element.dataset.seoLanguage = language;
    document.head.append(element);
  }
  element.hreflang = language;
  element.href = href;
}

export function SeoMetadata() {
  const pathname = useLocation({ select: (location) => location.pathname.replace(/\/$/, "") || "/" });
  const { i18n } = useTranslation();

  useEffect(() => {
    const language = i18n.resolvedLanguage?.startsWith("en") ? "en" : "zh";
    const copy = PUBLIC_COPY[pathname]?.[language];
    const origin = __PUBLIC_ORIGIN__ || window.location.origin;
    const title = copy?.title ?? (language === "en" ? "Avanfinity | Secure Digital Payments" : "Avanfinity | 安全数字支付");
    const description = copy?.description ?? (language === "en"
      ? "Secure digital payments, virtual cards, and GPT Direct services."
      : "安全的数字支付、虚拟卡与 GPT 直充服务。");

    document.documentElement.lang = language === "en" ? "en" : "zh-CN";
    document.title = title;
    upsertMeta('meta[name="description"]', "name", "description", description);
    upsertMeta('meta[name="robots"]', "name", "robots", copy ? "index, follow, max-image-preview:large" : "noindex, nofollow, noarchive");
    upsertMeta('meta[property="og:title"]', "property", "og:title", title);
    upsertMeta('meta[property="og:description"]', "property", "og:description", description);
    upsertMeta('meta[property="og:locale"]', "property", "og:locale", language === "en" ? "en_US" : "zh_CN");
    upsertMeta('meta[property="og:locale:alternate"]', "property", "og:locale:alternate", language === "en" ? "zh_CN" : "en_US");
    upsertMeta('meta[name="twitter:title"]', "name", "twitter:title", title);
    upsertMeta('meta[name="twitter:description"]', "name", "twitter:description", description);

    const canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    const structuredData = document.head.querySelector<HTMLScriptElement>("#avanfinity-structured-data");
    if (!copy) {
      canonical?.remove();
      structuredData?.remove();
      document.head.querySelector('meta[property="og:url"]')?.remove();
      document.head.querySelectorAll('link[rel="alternate"][data-seo-language]').forEach((element) => element.remove());
      return;
    }

    const defaultUrl = `${origin}${pathname}`;
    const englishUrl = `${defaultUrl}?lang=en`;
    const canonicalUrl = language === "en" ? englishUrl : defaultUrl;
    const canonicalLink = canonical ?? document.createElement("link");
    canonicalLink.rel = "canonical";
    canonicalLink.href = canonicalUrl;
    if (!canonical) document.head.append(canonicalLink);
    upsertMeta('meta[property="og:url"]', "property", "og:url", canonicalUrl);
    upsertAlternate("zh-CN", defaultUrl);
    upsertAlternate("en", englishUrl);
    upsertAlternate("x-default", defaultUrl);

    const schema = structuredData ?? document.createElement("script");
    schema.id = "avanfinity-structured-data";
    schema.type = "application/ld+json";
    schema.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "Avanfinity",
      url: `${origin}/`,
      inLanguage: ["zh-CN", "en"],
    });
    if (!structuredData) document.head.append(schema);
  }, [i18n.resolvedLanguage, pathname]);

  return null;
}
