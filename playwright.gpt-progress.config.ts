import { defineConfig, devices } from "@playwright/test";
const preview = process.env.E2E_GPT_PREVIEW === "1";
export default defineConfig({
  testDir: "./tests",
  outputDir: "../artifacts/gpt-smart-pool-20261019/workspace-gpt-progress-results",
  testMatch: "gpt-direct-progress-reload.spec.ts",
  use: { baseURL: "http://127.0.0.1:5189", trace: "retain-on-failure" },
  webServer: { command: preview ? "./node_modules/.bin/vite preview --host 127.0.0.1 --port 5189" : "npm run dev -- --host 127.0.0.1 --port 5189", url: "http://127.0.0.1:5189", reuseExistingServer: false },
  projects: [{ name: "gpt-progress", use: { ...devices["Desktop Chrome"], channel: "chrome" } }],
});
