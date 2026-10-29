import { defineConfig } from '@playwright/test';
import base from './playwright.frontend.config';
export default defineConfig({ ...base, use: { ...base.use, timezoneId: "Asia/Shanghai" }, grep: /ledger filters/ });
