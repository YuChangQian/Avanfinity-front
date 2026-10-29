import { defineConfig, devices } from '@playwright/test';
import base from './playwright.frontend.config';
export default defineConfig({ ...base, testMatch: 'cdk-credits.spec.ts', grep: /credits CDK/, projects: [
  { name: 'desktop', use: { ...devices['Desktop Chrome'], channel: 'chrome' } },
  { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium', channel: 'chrome' } },
] });
