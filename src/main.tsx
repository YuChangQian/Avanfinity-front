import "./scriptRecovery";
import "./emailVerificationToken";
import { StrictMode, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { Provider, useAtom } from "jotai";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import "./i18n";
import "./styles.css";
import { ApiError, captureReferralAttribution } from "./api";
import { normalizeInviteCode, referralCodeFromUrl, removeReferralQuery } from "./referralAttribution";
import { router } from "./router";
import { referralAttributionAtom, referralStorageKey } from "./state";

const queryClient = new QueryClient();
document.documentElement.classList.add("dark");
const referralCode = referralCodeFromUrl(new URL(window.location.href));
const storedReferralCode = normalizeInviteCode(localStorage.getItem(referralStorageKey));
const hadStoredReferralCode = storedReferralCode !== null;
if (storedReferralCode) {
  localStorage.setItem(referralStorageKey, storedReferralCode);
} else if (referralCode) {
  localStorage.setItem(referralStorageKey, referralCode);
} else {
  localStorage.removeItem(referralStorageKey);
}

function ReferralAttributionTracker() {
  const [attributedCode, setAttributedCode] = useAtom(referralAttributionAtom);
  const started = useRef(false);
  useEffect(() => {
    if (!referralCode || started.current) return;
    started.current = true;
    const candidate = attributedCode ?? referralCode;
    if (!attributedCode) setAttributedCode(candidate);
    const clearQuery = () => {
      const url = new URL(window.location.href);
      window.history.replaceState(window.history.state, "", removeReferralQuery(url));
    };
    void captureReferralAttribution(candidate)
      .then((response) => setAttributedCode(response.data.inviteCode))
      .catch((cause: unknown) => {
        if (!hadStoredReferralCode && cause instanceof ApiError && cause.status >= 400 && cause.status < 500) {
          setAttributedCode(null);
        }
      })
      .finally(clearQuery);
  }, [attributedCode, setAttributedCode]);
  return null;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode><Provider><ReferralAttributionTracker /><QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider></Provider></StrictMode>,
);
