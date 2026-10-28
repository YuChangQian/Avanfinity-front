import { useEffect, useRef, useState } from "react";
import { useSetAtom } from "jotai";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { resumeTelegramSession, type Session } from "../api";
import { referralStorageKey, sessionAtom } from "../state";
import { BrandIcon } from "../components/BrandIcon";
import { Button } from "../components/ui/button";

const allowedNext = new Set(["/dashboard", "/cards", "/cards/owned", "/cdk/redeem", "/deposit", "/finance", "/gpt-direct", "/rewards"]);

export function TelegramLoginPage() {
  const { t } = useTranslation();
  const setSession = useSetAtom(sessionAtom);
  const started = useRef(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const requested = new URLSearchParams(window.location.search).get("next") ?? "/dashboard";
    const next = allowedNext.has(requested) ? requested : "/dashboard";
    void resumeTelegramSession().then((profile) => {
      const session: Session = { token: "", userId: profile.userId, email: profile.email, displayName: profile.displayName, mfaLevel: "telegram" };
      localStorage.removeItem(referralStorageKey);
      localStorage.setItem("session", JSON.stringify(session));
      setSession(session);
      window.location.replace(next);
    }).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "Telegram login failed");
    });
  }, [setSession]);

  return <main className="center">
    <div className="auth-card">
      <div className="mobile-brand"><div className="logo"><BrandIcon /></div><strong>AVANFINITY</strong></div>
      {!error && <p>{t("loggingIn")}</p>}
      {error && <><p className="error" role="alert">{error}</p><Button asChild><Link to="/login">{t("backToLogin")}</Link></Button></>}
    </div>
  </main>;
}
