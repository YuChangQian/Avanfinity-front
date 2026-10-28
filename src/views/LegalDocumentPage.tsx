import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { BrandIcon } from "../components/BrandIcon";
import { Button } from "../components/ui/button";
import { getLegalDocuments } from "../api";

function LegalDocumentPage({ kind }: { kind: "terms" | "userAgreement" }) {
  const documents = useQuery({ queryKey: ["legal-documents"], queryFn: getLegalDocuments, retry: false });
  const title = kind === "terms" ? "服务条款" : "用户协议";
  const content = documents.data?.data[kind] ?? "";

  return <main className="legal-page">
    <header className="legal-header">
      <Link className="landing-brand" to="/" aria-label="Avanfinity 首页"><span><BrandIcon /></span><strong>AVANFINITY</strong></Link>
      <Button asChild variant="ghost"><Link to="/"><ArrowLeft />返回首页</Link></Button>
    </header>
    <article className="legal-document">
      <div className="legal-title"><span><ShieldCheck /> LEGAL</span><h1>{title}</h1><p>使用本服务前，请仔细阅读并确认您理解以下内容。</p></div>
      <nav aria-label="法律文件"><Link to="/terms" aria-current={kind === "terms" ? "page" : undefined}>服务条款</Link><Link to="/user-agreement" aria-current={kind === "userAgreement" ? "page" : undefined}>用户协议</Link></nav>
      {documents.isLoading && <p className="legal-status" aria-busy="true">正在加载…</p>}
      {documents.isError && <div className="legal-status is-error" role="alert"><p>暂时无法加载协议内容。</p><Button size="sm" variant="outline" onClick={() => void documents.refetch()}>重试</Button></div>}
      {content && <div className="legal-content">{content.split(/\n\s*\n/).map((paragraph, index) => {
        const heading = /^(重要提示|[一二三四五六七八九十]+、)/.test(paragraph);
        return heading ? <h2 key={index}>{paragraph}</h2> : <p key={index}>{paragraph}</p>;
      })}</div>}
    </article>
  </main>;
}

export function TermsPage() { return <LegalDocumentPage kind="terms" />; }
export function UserAgreementPage() { return <LegalDocumentPage kind="userAgreement" />; }
