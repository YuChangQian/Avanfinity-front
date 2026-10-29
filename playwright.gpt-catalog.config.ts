import { defineConfig, devices } from '@playwright/test';
import base from './playwright.frontend.config';
export default defineConfig({ ...base, testMatch: ['gpt-catalog.spec.ts', 'app.spec.ts'], grep: /GPT regional catalog|admin configures automatic CDK quote refresh/, projects: [
  { name: 'frontend-mock', use: { ...devices['Desktop Chrome'], channel: 'chrome' } },
  { name: 'mobile', grep: /GPT regional catalog/, use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium', channel: 'chrome' } },
] });
