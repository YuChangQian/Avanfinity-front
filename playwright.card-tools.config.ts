import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests", testMatch: ["card-tools.spec.ts", "admin-checkout-branch.spec.ts"], workers: 1,
  use: { baseURL: "http://127.0.0.1:15187", trace: "retain-on-failure" },
  webServer: { command: "npm run build && ./node_modules/.bin/vite preview --host 127.0.0.1 --port 15187", url: "http://127.0.0.1:15187", reuseExistingServer: false },
  projects: [{ name: "card-tools", use: { ...devices["Desktop Chrome"], channel: "chrome" } }],
});
