export function parseTgSession(source: string): { userId: number; dcId: number; authKey: string } {
  const invalid = () => { throw new SyntaxError("Invalid Telegram session"); };
  let value: unknown;
  try { value = JSON.parse(source); }
  catch {
    const accounts = source.split(/\r?\n/).filter(line => /^account\d+\s/.test(line));
    if (accounts.length !== 1) return invalid();
    value = JSON.parse(accounts[0].replace(/^account\d+\s+/, ""));
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const account = value as Record<string, unknown>;
  const userId = typeof account.userId === "string" && /^\d+$/.test(account.userId) ? Number(account.userId) : account.userId;
  const dcId = account.dcId;
  const authKey = account.authKey ?? account[`dc${dcId}_auth_key`];
  if (typeof userId !== "number" || !Number.isSafeInteger(userId) || userId <= 0 || typeof dcId !== "number" || !Number.isInteger(dcId) || dcId < 1 || dcId > 5 || typeof authKey !== "string" || !/^[a-f\d]{512}$/i.test(authKey)) return invalid();
  return { userId, dcId, authKey: authKey.toLowerCase() };
}
