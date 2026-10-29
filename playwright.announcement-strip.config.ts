import { defineConfig } from '@playwright/test';
import base from './playwright.frontend.config';
export default defineConfig({ ...base, grep: /announcement strip|ledger filters/ });
