import { defineConfig, devices } from "@playwright/test";
const preview = process.env.E2E_GPT_PREVIEW === "1";
export default defineConfig({
  testDir: "./tests",
  testMatch: "gpt-batch-preview.spec.ts",
  outputDir: "../artifacts/gpt-smart-pool-20261019/workspace-gpt-batch-preview-results",
  use: { baseURL: "http://127.0.0.1:5190", trace: "retain-on-failure" },
  webServer: { command: preview ? "./node_modules/.bin/vite preview --host 127.0.0.1 --port 5190" : "npm run dev -- --host 127.0.0.1 --port 5190", url: "http://127.0.0.1:5190", reuseExistingServer: false },
  projects: [{ name: "gpt-batch-preview", use: { ...devices["Desktop Chrome"], channel: "chrome" } }],
});
