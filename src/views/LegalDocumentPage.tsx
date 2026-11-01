import { t as ledgerT } from "i18next";
import { useTranslation } from "react-i18next";
import { Notice } from "../components/ui/notice";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { BrandIcon } from "../components/BrandIcon";
import { Button } from "../components/ui/button";
import { getLegalDocuments } from "../api";

function LegalDocumentPage({ kind }: { kind: "terms" | "userAgreement" }) {
  useTranslation();
  const documents = useQuery({ queryKey: ["legal-documents"], queryFn: getLegalDocuments, retry: false });
  const title = kind === "terms" ? ledgerT("ledgerText.termsOfService") : ledgerT("userAgreementLabel");
  const content = documents.data?.data[kind] ?? "";

  return <main className="legal-page">
    <header className="legal-header">
      <Link className="landing-brand" to="/" aria-label={ledgerT("ledgerText.avanfinityHome")}><span><BrandIcon /></span><strong>AVANFINITY</strong></Link>
      <Button asChild variant="ghost"><Link to="/"><ArrowLeft />{ledgerT("backToHome")}</Link></Button>
    </header>
    <article className="legal-document">
      <div className="legal-title"><span><ShieldCheck /> LEGAL</span><h1>{title}</h1><p>{ledgerT("ledgerText.pleaseReadTheFollowingCarefullyAndConfirm")}</p></div>
      <nav aria-label={ledgerT("ledgerText.legalDocuments")}><Link to="/terms" aria-current={kind === "terms" ? "page" : undefined}>{ledgerT("ledgerText.termsOfService")}</Link><Link to="/user-agreement" aria-current={kind === "userAgreement" ? "page" : undefined}>{ledgerT("userAgreementLabel")}</Link></nav>
      {documents.isLoading && <p className="legal-status" aria-busy="true">{ledgerT("loading")}</p>}
      {documents.isError && <Notice className="legal-status is-error" role="alert"><p>{ledgerT("ledgerText.legalDocumentsAreTemporarilyUnavailable")}</p><Button size="sm" variant="outline" onClick={() => void documents.refetch()}>{ledgerT("retry")}</Button></Notice>}
      {content && <div className="legal-content">{content.split(/\n\s*\n/).map((paragraph, index) => {
        const heading = /^(重要提示|[一二三四五六七八九十]+、)/.test(paragraph);
        return heading ? <h2 key={index}>{paragraph}</h2> : <p key={index}>{paragraph}</p>;
      })}</div>}
    </article>
  </main>;
}

export function TermsPage() { return <LegalDocumentPage kind="terms" />; }
export function UserAgreementPage() { return <LegalDocumentPage kind="userAgreement" />; }
