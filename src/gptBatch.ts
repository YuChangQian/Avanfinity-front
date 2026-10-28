import { extractGptSession, GPT_SESSION_MAX_BYTES } from "./gptSession";

export const GPT_BATCH_MAX_ACCOUNTS = 50;
export const GPT_SESSION_BATCH_MAX_ACCOUNTS = 500;
export const GPT_SESSION_FILE_MAX_BYTES = GPT_SESSION_BATCH_MAX_ACCOUNTS * GPT_SESSION_MAX_BYTES;

export type GptMailboxBatchAccount = {
  email: string;
  password: string;
  chatgptPassword?: string;
  totpSecret?: string;
};

export type GptMailboxBatchParseError = {
  code: "empty" | "too_many" | "format" | "email" | "password" | "duplicate" | "session" | "expired";
  line?: number;
};

export function parseGptMailboxBatch(raw: string): {
  accounts: GptMailboxBatchAccount[];
  error?: GptMailboxBatchParseError;
} {
  const lines = raw.split(/\r?\n/)
    .map((value, index) => ({ value: value.trim(), line: index + 1 }))
    .filter(({ value }) => value.length > 0);
  if (!lines.length) return { accounts: [], error: { code: "empty" } };
  if (lines.length > GPT_BATCH_MAX_ACCOUNTS) {
    return { accounts: [], error: { code: "too_many" } };
  }

  const accounts: GptMailboxBatchAccount[] = [];
  const seen = new Set<string>();
  for (const { value, line } of lines) {
    if (value.length > 1_500) return { accounts: [], error: { code: "format", line } };
    const parts = value.split("----");
    if (parts.length < 2) return { accounts: [], error: { code: "format", line } };
    const email = parts[0].trim().replaceAll("\\@", "@").toLowerCase();
    const hasRt = parts.at(-1)!.trim().startsWith("rt.");
    if (hasRt && parts.length !== 5) return { accounts: [], error: { code: "format", line } };
    const chatgptPassword = hasRt ? parts[1].trim() : "";
    const totpSecret = hasRt ? parts[3].trim().replaceAll(" ", "").toUpperCase() : "";
    if (hasRt && (!chatgptPassword || chatgptPassword.length > 1_024 || !/^[A-Z2-7]{16,128}={0,6}$/.test(totpSecret))) {
      return { accounts: [], error: { code: "format", line } };
    }
    const password = (hasRt ? parts[2] : parts.at(-1)!).trim();
    if (email.length > 320 || !/^[^\s@\x00-\x1f\x7f]+@[^\s@.\x00-\x1f\x7f]+(?:\.[^\s@.\x00-\x1f\x7f]+)+$/.test(email)) {
      return { accounts: [], error: { code: "email", line } };
    }
    if (!password || password.length > 1_024 || /[\r\n]/.test(password)) {
      return { accounts: [], error: { code: "password", line } };
    }
    if (seen.has(email)) return { accounts: [], error: { code: "duplicate", line } };
    seen.add(email);
    accounts.push({ email, password, ...(hasRt ? { chatgptPassword, totpSecret } : {}) });
  }
  return { accounts };
}

export function parseGptSessionBatch(raw: string): {
  accounts: Array<{ email: string; session: string }>;
  error?: GptMailboxBatchParseError;
} {
  if (new TextEncoder().encode(raw).length > GPT_SESSION_FILE_MAX_BYTES) {
    return { accounts: [], error: { code: "too_many" } };
  }
  let values = raw;
  if (raw.trim().startsWith("[")) {
    try {
      const entries: unknown = JSON.parse(raw);
      if (!Array.isArray(entries)) return { accounts: [], error: { code: "session", line: 1 } };
      if (entries.length > GPT_SESSION_BATCH_MAX_ACCOUNTS) return { accounts: [], error: { code: "too_many" } };
      values = entries.map((entry) => typeof entry === "string" ? entry : JSON.stringify(entry)).join("\n");
    } catch { return { accounts: [], error: { code: "session", line: 1 } }; }
  }
  const single = extractGptSession(values);
  const lines = single ? [{ value: values, line: 1 }] : values.split(/\r?\n/)
    .map((value, index) => ({ value: value.trim(), line: index + 1 }))
    .filter(({ value }) => value.length > 0);
  if (!lines.length) return { accounts: [], error: { code: "empty" } };
  if (lines.length > GPT_SESSION_BATCH_MAX_ACCOUNTS) return { accounts: [], error: { code: "too_many" } };
  const accounts: Array<{ email: string; session: string }> = [];
  const seen = new Set<string>();
  for (const { value, line } of lines) {
    const session = single ?? extractGptSession(value);
    if (!session) return { accounts: [], error: { code: "session", line } };
    if (session.error === "RefreshAccessTokenError") return { accounts: [], error: { code: "expired", line } };
    const user = session.user as { email?: unknown } | undefined;
    const account = session.account as { id?: unknown } | undefined;
    const email = typeof user?.email === "string" ? user.email.trim().toLowerCase() : "";
    const id = typeof account?.id === "string" ? account.id.trim() : "";
    if (email.length > 320 || /[\r\n\0]/.test(email)) return { accounts: [], error: { code: "session", line } };
    const identities = [`cookie:${session.sessionToken}`, ...(email ? [`email:${email}`] : []), ...(id ? [`account:${id}`] : [])];
    if (identities.some((key) => seen.has(key))) return { accounts: [], error: { code: "duplicate", line } };
    identities.forEach((key) => seen.add(key));
    accounts.push({ email: email || `Session #${line}`, session: JSON.stringify(session) });
  }
  return { accounts };
}

export function gptBatchConcurrency(capacity: Record<string, number> | null | undefined, country: string, customProxy = false): number {
  if (customProxy || capacity == null) return 1; // Older servers / external providers stay serial.
  const count = capacity[country] ?? 0;
  return Number.isSafeInteger(count) && count > 0 ? Math.min(count, GPT_SESSION_BATCH_MAX_ACCOUNTS) : 0;
}

// A slot lasts through order confirmation, not just through POST /orders.
// False / an exception means an outcome is uncertain: drain active work, but do not refill.
// ponytail: per-page concurrency only; cross-page proxy exclusivity needs backend leases.
export async function runGptBatch<T>(items: T[], capacity: () => Promise<number>, work: (item: T, index: number) => Promise<boolean>): Promise<number> {
  let next = 0;
  let stopped = false;
  const active = new Set<Promise<void>>();
  while ((!stopped && next < items.length) || active.size) {
    let limit = 0;
    if (!stopped && next < items.length) {
      try { limit = await capacity(); } catch { stopped = true; }
      if (!Number.isSafeInteger(limit) || limit <= 0) stopped = true;
    }
    while (!stopped && next < items.length && active.size < limit) {
      const index = next++;
      const task = Promise.resolve().then(() => work(items[index], index))
        .then((safe) => { if (!safe) stopped = true; }, () => { stopped = true; })
        .finally(() => { active.delete(task); });
      active.add(task);
    }
    if (active.size) await Promise.race(active);
  }
  return next;
}
