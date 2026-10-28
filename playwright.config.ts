import { defineConfig, devices } from "@playwright/test";

const apiPort = process.env.E2E_API_PORT ?? "18080";
const webPort = process.env.E2E_WEB_PORT ?? "15173";
const databaseUrl = process.env.E2E_DATABASE_URL ?? "postgresql://danew_app:local-dev-only@127.0.0.1:55432/danewcard_e2e";

export default defineConfig({
  testDir: "./tests",
  use: { baseURL: `http://127.0.0.1:${webPort}`, trace: "retain-on-failure" },
  webServer: [
    {
      command: "cargo run --manifest-path ../backend/Cargo.toml --bin danew-card-api",
      env: {
        DATABASE_URL: databaseUrl,
        BIND_ADDR: `127.0.0.1:${apiPort}`,
        APP_ENV: "test",
        RUN_MIGRATIONS: "false",
        TRUST_PROXY: "true",
        TRUSTED_PROXY_CIDRS: "127.0.0.1/32",
        REGISTER_IP_HOURLY_LIMIT: "100",
        JWT_SECRET: "playwright-secret-at-least-32-characters",
        CDK_ENCRYPTION_KEY: "playwright-independent-cdk-key-v2-at-least-32-bytes",
        IDEMPOTENCY_HMAC_KEY: "playwright-independent-idempotency-key-v2-minimum",
        DEV_SEED_ADMIN: "true",
        DEV_RESET_DATA: "true",
        ADMIN_EMAIL: "admin@danewcard.local",
        ADMIN_PASSWORD: "Admin123!Secure",
        DEPOSIT_MODE: "mock",
        DEPOSIT_WEBHOOK_SECRET: "playwright-deposit-secret-at-least-32",
        SPACEX_MODE: "mock",
        SPACEX_WRITE_ENABLED: "false",
        SPACEX_API_KEY: "",
        SPACEX_APP_ID: "",
        SPACEX_MOCK_RESULT: "",
        SPACEX_WEBHOOK_SECRET: "playwright-spacex-webhook-secret-32",
        INTERNAL_CRON_SECRET: "playwright-cron-secret-at-least-32",
        TELEGRAM_WEBHOOK_SECRET: "playwright-telegram-secret-at-least-32",
        TELEGRAM_BOT_TOKEN: "playwright-local-noop-bot-token",
        TELEGRAM_BOT_NAME: "playwright_local_bot",
        PUBLIC_ORIGIN: "https://telegram-e2e.example.test",
        PUBLIC_ORIGIN_ALIASES: `http://127.0.0.1:${webPort},http://127.0.0.1:${apiPort}`,
        TELEGRAM_LOGIN_CLIENT_ID: "12345",
        TELEGRAM_LOGIN_CLIENT_SECRET: "playwright-telegram-login-client-secret",
        TELEGRAM_NOOP_SENDER: "true",
        ACCEPTANCE_ISOLATED: "1",
      },
      url: `http://127.0.0.1:${apiPort}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    { command: `npm run dev -- --host 127.0.0.1 --port ${webPort}`, env: { VITE_API_TARGET: `http://127.0.0.1:${apiPort}` }, url: `http://127.0.0.1:${webPort}/login`, reuseExistingServer: false },
  ],
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], channel: "chrome" } },
  ],
});
