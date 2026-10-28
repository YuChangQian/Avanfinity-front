import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import type { Session } from "./api";

export const sessionAtom = atomWithStorage<Session | null>("session", null, undefined, { getOnInit: true });
export const referralStorageKey = "referralInviteCode";
export const referralAttributionAtom = atomWithStorage<string | null>(referralStorageKey, null, {
  getItem: (key, initialValue) => typeof window === "undefined" ? initialValue : localStorage.getItem(key) ?? initialValue,
  setItem: (key, value) => {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  },
  removeItem: (key) => localStorage.removeItem(key),
}, { getOnInit: true });

export function sessionIdentity(session: Session | null) {
  return session?.userId ?? session?.email ?? null;
}

export type GptDirectDraft = {
  mode: "session" | "batch" | "session_batch" | "mailbox";
  sessionValue: string;
  batchValue: string;
  mailboxEmail: string;
  mailboxPassword: string;
  paymentRegionKey: string;
  planKey: string;
};

export const emptyGptDirectDraft = (): GptDirectDraft => ({
  mode: "session",
  sessionValue: "",
  batchValue: "",
  mailboxEmail: "",
  mailboxPassword: "",
  paymentRegionKey: "PH:PHP",
  planKey: "",
});

// Deliberately memory-only: route changes preserve the draft, reloads and tab closes erase it.
export const gptDirectDraftAtom = atom<GptDirectDraft>(emptyGptDirectDraft());
