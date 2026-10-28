const STORAGE_KEY = "avanfinity.email-verification.v1";

export type EmailVerificationState = { email: string; resendAt: number };

export function loadEmailVerificationState(): EmailVerificationState {
  try {
    const value = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "null") as Partial<EmailVerificationState> | null;
    if (value && typeof value.email === "string" && Number.isFinite(value.resendAt)) {
      return { email: value.email, resendAt: Number(value.resendAt) };
    }
  } catch {
    sessionStorage.removeItem(STORAGE_KEY);
  }
  return { email: "", resendAt: 0 };
}

export function saveEmailVerificationState(email: string, cooldownSeconds: number) {
  const state = { email, resendAt: Date.now() + Math.max(1, cooldownSeconds) * 1_000 };
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  return state;
}

export function clearEmailVerificationState() {
  sessionStorage.removeItem(STORAGE_KEY);
}
