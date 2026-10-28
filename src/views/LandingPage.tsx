import { Link } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import {
  ArrowRight,
  Check,
  ChevronRight,
  CircleDollarSign,
  CreditCard,
  ReceiptText,
  ShieldCheck,
  Sparkles,
  WalletCards,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { BrandIcon } from "@/components/BrandIcon";
import { LanguageButton } from "@/components/LanguageButton";
import { Button } from "@/components/ui/button";
import { sessionAtom } from "../state";

const featureIcons = [CreditCard, Sparkles, CircleDollarSign];
const featureKeys = ["cards", "payments", "finance"] as const;
const stepKeys = ["account", "choose", "track"] as const;

export function LandingPage() {
  const { t } = useTranslation();
  const session = useAtomValue(sessionAtom);

  return <main className="landing-page" id="top">
    <header className="landing-nav">
      <Link className="landing-brand" to="/" aria-label="Avanfinity">
        <span><BrandIcon /></span>
        <strong>AVANFINITY</strong>
      </Link>
      <nav aria-label={t("landing.navigation")}>
        <a href="#capabilities">{t("landing.navCapabilities")}</a>
        <a href="#workflow">{t("landing.navWorkflow")}</a>
        <a href="#security">{t("landing.navSecurity")}</a>
      </nav>
      <div className="landing-nav-actions">
        <LanguageButton />
        {!session && <Button asChild variant="ghost"><Link to="/login">{t("login")}</Link></Button>}
        <Button asChild className="landing-nav-primary">
          <Link to={session ? "/dashboard" : "/register"}>
            {session ? t("landing.dashboard") : t("landing.startNow")}<ArrowRight />
          </Link>
        </Button>
      </div>
    </header>

    <section className="landing-hero">
      <div className="landing-hero-copy">
        <span className="landing-kicker"><Sparkles />{t("landing.kicker")}</span>
        <h1>{t("landing.heroTitle")}<em>{t("landing.heroAccent")}</em></h1>
        <p>{t("landing.heroDescription")}</p>
        <div className="landing-hero-actions">
          <Button asChild size="lg"><Link to={session ? "/dashboard" : "/register"}>{session ? t("landing.dashboard") : t("landing.createAccount")}<ArrowRight /></Link></Button>
          <Button asChild size="lg" variant="outline"><a href="#capabilities">{t("landing.exploreCapabilities")}<ArrowRight /></a></Button>
        </div>
        <ul className="landing-trust-list" aria-label={t("landing.trustLabel")}>
          <li><Check />{t("landing.trustProgress")}</li>
          <li><Check />{t("landing.trustBilling")}</li>
          <li><Check />{t("landing.trustControl")}</li>
        </ul>
      </div>

      <div className="landing-product-stage" aria-label={t("landing.productPreview")}>
        <div className="landing-orbit landing-orbit-one" />
        <div className="landing-orbit landing-orbit-two" />
        <article className="landing-bank-card">
          <div className="landing-bank-card-top"><BrandIcon /><span>VIRTUAL</span></div>
          <strong>5378&nbsp; 72••&nbsp; ••••&nbsp; 9287</strong>
          <div><span>AVANFINITY MEMBER</span><span>08 / 28</span></div>
        </article>
        <article className="landing-progress-card">
          <header>
            <span><Sparkles />{t("landing.previewOrder")}</span>
            <b>88%</b>
          </header>
          <strong>{t("landing.previewPlan")}</strong>
          <p>{t("landing.previewStage")}</p>
          <div className="landing-progress-track"><i /></div>
          <footer><span><Check />{t("landing.previewVerified")}</span><span>{t("landing.previewInvoices")}</span></footer>
        </article>
        <article className="landing-balance-card">
          <span>{t("landing.previewBalance")}</span>
          <strong>$1,280.40</strong>
          <small><ShieldCheck />{t("landing.previewProtected")}</small>
        </article>
      </div>
    </section>

    <div className="landing-capability-strip" aria-label={t("landing.capabilityStripLabel")}>
      <span>VIRTUAL CARDS</span><i />
      <span>GLOBAL PAYMENTS</span><i />
      <span>ORDER TRACKING</span><i />
      <span>FINANCE LEDGER</span><i />
      <span>AGENT NETWORK</span>
    </div>

    <section className="landing-section" id="capabilities">
      <div className="landing-section-heading">
        <span>{t("landing.capabilitiesEyebrow")}</span>
        <h2>{t("landing.capabilitiesTitle")}</h2>
        <p>{t("landing.capabilitiesDescription")}</p>
      </div>
      <div className="landing-feature-grid">
        {featureKeys.map((key, index) => {
          const Icon = featureIcons[index];
          return <article className={`landing-feature-card landing-feature-${key}`} key={key}>
            <span className="landing-feature-icon"><Icon /></span>
            <small>0{index + 1}</small>
            <h3>{t(`landing.features.${key}.title`)}</h3>
            <p>{t(`landing.features.${key}.description`)}</p>
            <div className="landing-feature-link">{t(`landing.features.${key}.label`)}<ChevronRight /></div>
          </article>;
        })}
      </div>
    </section>

    <section className="landing-workflow" id="workflow">
      <div className="landing-workflow-intro">
        <span>{t("landing.workflowEyebrow")}</span>
        <h2>{t("landing.workflowTitle")}</h2>
        <p>{t("landing.workflowDescription")}</p>
        <Button asChild variant="outline"><Link to={session ? "/dashboard" : "/register"}>{session ? t("landing.dashboard") : t("landing.createAccount")}<ArrowRight /></Link></Button>
      </div>
      <ol>
        {stepKeys.map((key, index) => <li key={key}>
          <span>0{index + 1}</span>
          <div><h3>{t(`landing.steps.${key}.title`)}</h3><p>{t(`landing.steps.${key}.description`)}</p></div>
        </li>)}
      </ol>
    </section>

    <section className="landing-security" id="security">
      <div>
        <span className="landing-kicker"><ShieldCheck />{t("landing.securityEyebrow")}</span>
        <h2>{t("landing.securityTitle")}</h2>
        <p>{t("landing.securityDescription")}</p>
      </div>
      <ul>
        <li><span><ReceiptText /></span><div><strong>{t("landing.securityLedgerTitle")}</strong><p>{t("landing.securityLedgerDescription")}</p></div></li>
        <li><span><WalletCards /></span><div><strong>{t("landing.securityAccessTitle")}</strong><p>{t("landing.securityAccessDescription")}</p></div></li>
        <li><span><ShieldCheck /></span><div><strong>{t("landing.securityPrivacyTitle")}</strong><p>{t("landing.securityPrivacyDescription")}</p></div></li>
      </ul>
    </section>

    <section className="landing-final-cta">
      <div><span>{t("landing.finalEyebrow")}</span><h2>{t("landing.finalTitle")}</h2><p>{t("landing.finalDescription")}</p></div>
      <Button asChild size="lg"><Link to={session ? "/dashboard" : "/register"}>{session ? t("landing.dashboard") : t("landing.startNow")}<ArrowRight /></Link></Button>
    </section>

    <footer className="landing-footer">
      <div className="landing-brand"><span><BrandIcon /></span><strong>AVANFINITY</strong></div>
      <p>{t("landing.footer")}</p>
      <div><Link to="/terms">服务条款</Link><Link to="/user-agreement">用户协议</Link>{session ? <Link to="/dashboard">{t("landing.dashboard")}</Link> : <><Link to="/login">{t("login")}</Link><Link to="/register">{t("landing.startNow")}</Link></>}</div>
    </footer>
  </main>;
}
