export const GPT_SESSION_MAX_BYTES = 64 * 1024;

type SessionJson = Record<string, unknown> & { accessToken: string; sessionToken: string };

export function extractGptSession(raw: string): SessionJson | null {
  const value = raw.trim();
  if (new TextEncoder().encode(value).length > GPT_SESSION_MAX_BYTES || value.includes("\0")) return null;
  const complete = (data: unknown): data is SessionJson => Boolean(data && typeof data === "object"
    && ["accessToken", "sessionToken"].every((key) => typeof (data as Record<string, unknown>)[key] === "string"
      && ((data as Record<string, unknown>)[key] as string).trim()));
  if (value.startsWith("{")) {
    try { const data: unknown = JSON.parse(value); return complete(data) ? data : null; } catch { return null; }
  }
  if (!value.startsWith("rt.") && !value.includes("----")) return null;
  let start = value.indexOf("{");
  for (let attempt = 0; start >= 0 && attempt < 64; attempt += 1) {
    const prefix = value.slice(0, start);
    if (/[\r\n]/.test(prefix) || prefix.includes('"accessToken"') || prefix.includes('"sessionToken"')) return null;
    try { const data: unknown = JSON.parse(value.slice(start)); if (complete(data)) return data; } catch { /* Try a brace after an optional password field. */ }
    start = value.indexOf("{", start + 1);
  }
  return null;
}

export function normalizeGptSession(raw: string): string {
  const value = raw.trim();
  if (value.startsWith("{") || value.startsWith("eyJ") || (!value.startsWith("rt.") && !value.includes("----"))) return value;
  const session = extractGptSession(value);
  return session ? JSON.stringify(session) : value;
}
