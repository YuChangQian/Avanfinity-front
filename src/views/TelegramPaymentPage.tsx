import { formatDecimal } from "../decimal";
import { useEffect, useLayoutEffect, useState } from "react";
import { useAtomValue } from "jotai";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { CheckCircle2, Clock3, ShieldCheck, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { DataSkeleton } from "../components/PageShell";
import { ApiError, confirmTelegramCardRecharge, resolveTelegramPayment } from "../api";
import { sessionAtom } from "../state";

const storageKey = "telegramPaymentToken";

function captureToken() {
  const value = new URLSearchParams(window.location.hash.slice(1)).get("token")?.trim() ?? "";
  return value || sessionStorage.getItem(storageKey) || "";
}

export function TelegramPaymentPage() {
  const session = useAtomValue(sessionAtom);
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [token] = useState(captureToken);
  const query = useQuery({
    queryKey: ["telegram-payment", token],
    queryFn: () => resolveTelegramPayment(session!.token, token),
    enabled: Boolean(session && token),
    retry: false,
  });
  const confirm = useMutation({
    mutationFn: () => confirmTelegramCardRecharge(token),
    onSuccess: ({ data }) => {
      if (data.state === "succeeded") sessionStorage.removeItem(storageKey);
    },
    onError: (error) => {
      if (error instanceof ApiError && ["RECENT_AUTH_REQUIRED", "PASSWORD_SESSION_REQUIRED"].includes(error.errorCode ?? "")) {
        sessionStorage.setItem("recentAuthReturnPath", "/telegram-payment");
        window.location.assign("/login");
      }
    },
  });

  useLayoutEffect(() => {
    if (/^[0-9a-f]{64}$/.test(token)) sessionStorage.setItem(storageKey, token);
    if (window.location.hash) window.history.replaceState(window.history.state, "", window.location.pathname);
  }, [token]);

  useEffect(() => {
    if (session || !token) return;
    sessionStorage.setItem("recentAuthReturnPath", "/telegram-payment");
    void navigate({ to: "/login", replace: true });
  }, [navigate, session, token]);

  useEffect(() => {
    const intent = query.data?.data;
    if (!intent || intent.kind !== "gpt_direct" || intent.state !== "awaiting_web") return;
    sessionStorage.setItem("telegramGptIntent", JSON.stringify({
      id: intent.id,
      cardId: intent.cardId,
      plan: intent.plan,
    }));
    sessionStorage.removeItem(storageKey);
    void navigate({ to: "/gpt-direct" });
  }, [navigate, query.data]);

  useEffect(() => {
    const state = query.data?.data.state;
    if (state && ["succeeded", "failed", "cancelled"].includes(state)) sessionStorage.removeItem(storageKey);
  }, [query.data]);

  if (!token) return <main className="center"><div role="alert" className="error">{t("telegramPaymentInvalid")}</div></main>;
  const loadingCard = <main className="center"><section className="security-card telegram-payment-confirm" aria-busy="true"><ShieldCheck /><h1>{t("telegramPaymentConfirmTitle")}</h1><p>{t("telegramPaymentConfirmDesc")}</p><dl>{["cards", "recharge", "fee", "totalDebit"].map((label) => <div key={label}><dt>{t(label)}</dt><dd><DataSkeleton /></dd></div>)}</dl><Button disabled>{t("telegramPaymentConfirm")}</Button><p className="muted">{t("telegramPaymentSensitiveGuard")}</p></section></main>;
  if (!session) return loadingCard;
  if (query.isPending) return loadingCard;
  if (query.isError) return <main className="center"><div role="alert" className="error">{query.error instanceof Error ? query.error.message : t("telegramPaymentInvalid")}</div></main>;
  const intent = query.data?.data;
  if (!intent) return <main className="center"><div role="alert" className="error">{t("telegramPaymentInvalid")}</div></main>;
  const state = confirm.data?.data.state ?? intent.state;
  const status = state === "processing"
    ? { icon: <Clock3 />, title: t("telegramPaymentProcessing"), description: t("telegramPaymentProcessingDesc") }
    : state === "succeeded"
      ? { icon: <CheckCircle2 />, title: t("telegramPaymentSuccess"), description: t("telegramPaymentBotNotice") }
      : state === "failed"
        ? { icon: <XCircle />, title: t("telegramPaymentFailedTitle"), description: t("telegramPaymentFailedDesc") }
        : state === "cancelled"
          ? { icon: <XCircle />, title: t("telegramPaymentCancelled"), description: t("telegramPaymentCancelledDesc") }
          : null;
  if (status) return <main className="center"><section className="security-card telegram-payment-confirm">{status.icon}<h1>{status.title}</h1><p>{status.description}</p></section></main>;
  if (intent.kind === "gpt_direct" && state === "awaiting_web") return loadingCard;
  if (intent.kind !== "card_recharge" || state !== "awaiting_web") return <main className="center"><div role="alert" className="error">{t("telegramPaymentInvalid")}</div></main>;

  return <main className="center"><section className="security-card telegram-payment-confirm">
    <ShieldCheck />
    <h1>{t("telegramPaymentConfirmTitle")}</h1>
    <p>{t("telegramPaymentConfirmDesc")}</p>
    <dl>
      <div><dt>{t("cards")}</dt><dd>{intent.network} · {intent.card}</dd></div>
      <div><dt>{t("recharge")}</dt><dd>${formatDecimal(intent.amount)}</dd></div>
      <div><dt>{t("fee")}</dt><dd>${formatDecimal(intent.fee)}</dd></div>
      <div><dt>{t("totalDebit")}</dt><dd>${formatDecimal(intent.totalAmount)}</dd></div>
    </dl>
    {confirm.error ? <p role="alert" className="error">{confirm.error instanceof Error ? confirm.error.message : t("telegramPaymentFailed")}</p> : null}
    <Button type="button" onClick={() => confirm.mutate()} disabled={confirm.isPending || intent.state !== "awaiting_web"}>
      {confirm.isPending ? t("processing") : t("telegramPaymentConfirm")}
    </Button>
    <p className="muted">{t("telegramPaymentSensitiveGuard")}</p>
  </section></main>;
}
