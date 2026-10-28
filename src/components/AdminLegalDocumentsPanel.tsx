import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Save } from "lucide-react";
import { getLegalDocuments, updateAdminLegalDocuments, type LegalDocuments } from "../api";
import { Button } from "./ui/button";
import { StableSwap } from "./StableSwap";

export function AdminLegalDocumentsPanel({ token }: { token: string }) {
  const documents = useQuery({ queryKey: ["legal-documents"], queryFn: getLegalDocuments, retry: false });
  if (documents.isLoading) return <section className="admin-surface legal-editor" aria-busy="true">正在加载服务条款与用户协议…</section>;
  if (documents.isError || !documents.data) return <section className="admin-surface legal-editor"><p role="alert">协议内容加载失败。</p><Button size="sm" variant="outline" onClick={() => void documents.refetch()}>重试</Button></section>;
  return <LegalDocumentsForm token={token} initial={documents.data.data} />;
}

function LegalDocumentsForm({ token, initial }: { token: string; initial: LegalDocuments }) {
  const client = useQueryClient();
  const [terms, setTerms] = useState(initial.terms);
  const [userAgreement, setUserAgreement] = useState(initial.userAgreement);
  const [version, setVersion] = useState(initial.version);
  const [notice, setNotice] = useState("");
  const save = useMutation({
    mutationFn: () => updateAdminLegalDocuments(token, { terms, userAgreement, version }),
    onSuccess: (response) => {
      setVersion(response.data.version);
      setTerms(response.data.terms);
      setUserAgreement(response.data.userAgreement);
      client.setQueryData(["legal-documents"], response);
      setNotice("服务条款与用户协议已更新");
    },
    onError: (error) => setNotice(error instanceof Error ? error.message : "保存失败"),
  });
  function submit(event: FormEvent) { event.preventDefault(); save.mutate(); }

  return <section className="admin-surface legal-editor" data-testid="admin-legal-documents">
    <div className="admin-section-heading"><div><span className="admin-kicker">LEGAL</span><h2><FileText />服务条款与用户协议</h2><p>修改后会立即展示在公开页面；内容以纯文本安全呈现。</p></div></div>
    <form onSubmit={submit}>
      <label>服务条款<textarea value={terms} onChange={(event) => setTerms(event.target.value)} rows={20} minLength={100} required /></label>
      <label>用户协议<textarea value={userAgreement} onChange={(event) => setUserAgreement(event.target.value)} rows={16} minLength={100} required /></label>
      <div className="admin-form-actions"><Button disabled={save.isPending || terms.trim().length < 100 || userAgreement.trim().length < 100}><Save /><StableSwap state={save.isPending ? "busy" : "idle"} labels={{ idle: "保存协议", busy: "保存中…" }} /></Button><span>版本 {version}</span></div>
      {notice && <p className={`admin-alert ${save.isError ? "is-error" : "is-success"}`} role={save.isError ? "alert" : "status"}>{notice}</p>}
    </form>
  </section>;
}
