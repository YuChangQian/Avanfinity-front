import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "open-card-wait.spec.ts",
  use: { baseURL: "http://127.0.0.1:15179", trace: "retain-on-failure" },
  webServer: {
    command: process.env.E2E_FRONTEND_PREVIEW === "1" ? "npm exec -- vite preview --host 127.0.0.1 --port 15179" : "npm run dev -- --host 127.0.0.1 --port 15179",
    url: "http://127.0.0.1:15179",
    reuseExistingServer: false,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], channel: "chrome" } },
    { name: "mobile", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium", channel: "chrome" } },
  ],
});
