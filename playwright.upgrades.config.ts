import { defineConfig } from "@playwright/test";
import frontend from "./playwright.frontend.config";

export default defineConfig({
  ...frontend,
  grep: /GPT direct upgrade matrix|GPT direct preflight treats 202/,
});
