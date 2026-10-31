import { defineConfig, devices } from "@playwright/test";

const preview = process.env.E2E_FRONTEND_PREVIEW === "1";
const fixtureServer = {
  command: "npm run dev -- --host 127.0.0.1 --port 15188",
  env: { VITE_STYLE_PREVIEW: "1" }, url: "http://127.0.0.1:15188", reuseExistingServer: false,
};
const targetServer = {
  command: preview ? "./node_modules/.bin/vite preview --host 127.0.0.1 --port 15185" : "npm run dev -- --host 127.0.0.1 --port 15185",
  env: { VITE_STYLE_PREVIEW: "1" }, url: "http://127.0.0.1:15185", reuseExistingServer: false,
};
export default defineConfig({
  testDir: "./tests", testMatch: ["ui-style.spec.ts", "ui-refinement.spec.ts"],
  outputDir: "./test-results/ui-style",
  use: { baseURL: "http://127.0.0.1:15185", trace: "retain-on-failure" },
  webServer: preview ? [fixtureServer, targetServer] : targetServer,
  projects: [{ name: "ui-style", use: { ...devices["Desktop Chrome"], channel: "chrome" } }],
});
