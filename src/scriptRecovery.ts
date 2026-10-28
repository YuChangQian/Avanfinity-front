/// <reference types="vite/client" />
const recoveryKey = "avanfinity:script-recovery";

async function recoverScripts() {
  // This route keeps its one-use token only in memory after stripping the URL.
  if (window.location.pathname === "/verify-email") return;
  // A module parse failure is cached for this document. Refresh the HTTP cache
  // before reloading; a plain reload can reuse the same truncated script.
  try {
    if (sessionStorage.getItem(recoveryKey) === import.meta.url) return;
    sessionStorage.setItem(recoveryKey, import.meta.url);
  } catch {
    return; // Without a persistent guard, a reload could loop.
  }
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(import.meta.env.BASE_URL + "asset-manifest.json", {
      cache: "no-store", credentials: "omit", redirect: "error", signal: controller.signal,
    });
    if (!response.ok) return;
    const manifest = await response.json() as Record<string, { file: string }>;
    const scripts = [...new Set(Object.values(manifest).map(entry => entry.file)
      .filter(file => /^assets\/[\w.-]+\.js$/.test(file)))];
    if (!scripts.length) return;
    await Promise.all(scripts.map(async file => {
      const asset = await fetch(import.meta.env.BASE_URL + file, {
        cache: "reload", credentials: "omit", redirect: "error", signal: controller.signal,
      });
      if (!asset.ok || !asset.headers.get("content-type")?.includes("javascript")) {
        throw new Error("Script refresh failed");
      }
      await asset.arrayBuffer();
    }));
    window.location.reload();
  } finally {
    controller.abort();
    window.clearTimeout(timeout);
  }
}

if (import.meta.env.PROD) window.addEventListener("vite:preloadError", event => {
  const error = (event as Event & { payload: unknown }).payload;
  if (error instanceof SyntaxError && /Unexpected end of (?:script|input)/i.test(error.message)) {
    void recoverScripts().catch(() => { /* Keep the original error visible if the network is unavailable. */ });
  }
});
