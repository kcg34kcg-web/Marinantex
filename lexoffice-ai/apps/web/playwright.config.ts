import { defineConfig, devices } from "@playwright/test";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/lexoffice_ai";
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.AUTH_COOKIE_SECURE ??= "false";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 45_000,
  expect: {
    timeout: 10_000
  },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { outputFolder: "playwright-report" }]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3100",
    trace: "retain-on-failure"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ],
  webServer: {
    command: "corepack pnpm exec next dev -p 3100",
    port: 3100,
    reuseExistingServer: false,
    cwd: __dirname,
    env: {
      ...process.env,
      DATABASE_URL: process.env.DATABASE_URL,
      REDIS_URL: process.env.REDIS_URL,
      AUTH_COOKIE_SECURE: process.env.AUTH_COOKIE_SECURE
    }
  }
});
