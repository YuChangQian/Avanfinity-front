import { defineConfig } from '@playwright/test';
import base from './playwright.frontend.config';
export default defineConfig({ ...base, grep: /unified CDK docs|announcement strip|ledger filters/ });
