const inviteCodePattern = /^[a-zA-Z0-9-]{3,32}$/;
const queryKeys = ["ref", "invite", "inviteCode"] as const;

export function normalizeInviteCode(value: string | null | undefined) {
  const normalized = value?.trim().toUpperCase() ?? "";
  return inviteCodePattern.test(normalized) ? normalized : null;
}

export function referralCodeFromUrl(url: URL) {
  const segments = url.pathname.split("/").filter(Boolean);
  const pathCode = segments.length === 2 && ["invite", "r"].includes(segments[0])
    ? segments[1]
    : segments.length === 3 && segments[0] === "register" && segments[1] === "invite"
      ? segments[2]
      : null;
  const normalizedPathCode = normalizeInviteCode(pathCode);
  if (normalizedPathCode) return normalizedPathCode;
  for (const key of queryKeys) {
    const code = normalizeInviteCode(url.searchParams.get(key));
    if (code) return code;
  }
  return null;
}

export function removeReferralQuery(url: URL) {
  queryKeys.forEach((key) => url.searchParams.delete(key));
  return `${url.pathname}${url.search}${url.hash}`;
}
