import { defineConfig, devices } from "@playwright/test";

const dashboardPort = Number(process.env.E2E_DASHBOARD_PORT ?? 5199);

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  use: {
    baseURL: `http://127.0.0.1:${dashboardPort}`,
    channel: process.env.E2E_BROWSER_CHANNEL ?? "chrome",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chrome", use: { ...devices["Desktop Chrome"], channel: process.env.E2E_BROWSER_CHANNEL ?? "chrome" } }],
});
