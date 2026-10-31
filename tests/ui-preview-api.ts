import type { Page } from "@playwright/test";

export async function useStylePreviewApi(page: Page) {
  await page.addInitScript(() => localStorage.setItem("session", JSON.stringify({ token: "preview", userId: 9, email: "preview@local", role: "admin" })));
  if (process.env.E2E_FRONTEND_PREVIEW !== "1") return;
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    const response = await page.request.fetch(`http://127.0.0.1:15188${url.pathname}${url.search}`, {
      method: route.request().method(), data: route.request().postData() ?? undefined,
    });
    await route.fulfill({ response });
  });
}
