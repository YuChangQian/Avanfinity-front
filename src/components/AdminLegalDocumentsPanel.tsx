import { t as adminT } from "i18next";
import { useTranslation } from "react-i18next";
import { Notice } from "./ui/notice";
import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Save } from "lucide-react";
import { getLegalDocuments, updateAdminLegalDocuments, type LegalDocuments } from "../api";
import { Button } from "./ui/button";
import { StableSwap } from "./StableSwap";

export function AdminLegalDocumentsPanel({ token }: { token: string }) {
  useTranslation();
  const documents = useQuery({ queryKey: ["legal-documents"], queryFn: getLegalDocuments, retry: false });
  if (documents.isLoading) {
    return (
      <section className="admin-surface legal-editor" aria-busy="true">
        <div className="admin-state">{adminT("adminText.loadingTermsOfServiceAndUserAgreement")}</div>
      </section>
    );
  }
  if (documents.isError || !documents.data) {
    return (
      <section className="admin-surface legal-editor">
        <Notice className="admin-state is-error" role="alert">
          <span>{adminT("adminText.unableToLoadLegalDocuments")}</span>
          <Button size="sm" variant="outline" onClick={() => void documents.refetch()}>{adminT("adminText.retry")}</Button>
        </Notice>
      </section>
    );
  }
  return <LegalDocumentsForm token={token} initial={documents.data.data} />;
}

function LegalDocumentsForm({ token, initial }: { token: string; initial: LegalDocuments }) {
  useTranslation();
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
      setNotice(adminT("adminText.termsOfServiceAndUserAgreementUpdated"));
    },
    onError: (error) => setNotice(error instanceof Error ? error.message : adminT("adminText.unableToSave")),
  });
  function submit(event: FormEvent) { event.preventDefault(); save.mutate(); }

  return <section className="admin-surface legal-editor" data-testid="admin-legal-documents">
    <div className="admin-section-heading"><div><span className="admin-kicker">LEGAL</span><h2><FileText />{adminT("adminText.termsOfServiceAndUserAgreement")}</h2><p>{adminT("adminText.changesAppearOnPublicPagesImmediatelyContent")}</p></div></div>
    <form onSubmit={submit}>
      <label>{adminT("adminText.termsOfService")}<textarea value={terms} onChange={(event) => setTerms(event.target.value)} rows={20} minLength={100} required /></label>
      <label>{adminT("adminText.userAgreement")}<textarea value={userAgreement} onChange={(event) => setUserAgreement(event.target.value)} rows={16} minLength={100} required /></label>
      <div className="admin-form-actions"><Button disabled={save.isPending || terms.trim().length < 100 || userAgreement.trim().length < 100}><Save /><StableSwap state={save.isPending ? "busy" : "idle"} labels={{ idle: adminT("adminText.saveLegalDocuments"), busy: adminT("adminText.saving") }} /></Button><span>{adminT("adminText.version")}{version}</span></div>
      {notice && <Notice className={`admin-alert ${save.isError ? "is-error" : "is-success"}`} role={save.isError ? "alert" : "status"}>{notice}</Notice>}
    </form>
  </section>;
}
