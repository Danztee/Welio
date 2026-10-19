import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  expect: { timeout: 15_000 },
  timeout: 45_000,
  use: { baseURL: "http://127.0.0.1:3101", trace: "retain-on-failure" },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        channel: process.env.PLAYWRIGHT_CHANNEL,
      },
    },
  ],
  webServer: [
    {
      command: "go run ./internal/e2etest",
      cwd: "..",
      url: "http://127.0.0.1:8181/readyz",
      timeout: 120_000,
      reuseExistingServer: false,
    },
    {
      command: "pnpm exec next dev --hostname 127.0.0.1 --port 3101",
      url: "http://127.0.0.1:3101/sign-in",
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        WELIO_E2E: "1",
        APP_URL: "http://127.0.0.1:3101",
        NEXT_PUBLIC_WELIO_API_URL: "http://127.0.0.1:8181",
        WELIO_API_INTERNAL_URL: "http://127.0.0.1:8181",
      },
    },
  ],
});
