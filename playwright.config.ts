import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  use: { baseURL: "http://127.0.0.1:3210", trace: "retain-on-failure" },
  webServer: {
    command: "npm run build && npm start",
    url: "http://127.0.0.1:3210",
    env: { ...process.env, DOCSHARE_CONFIG: resolve("tests/fixtures/docshare.config.yaml") },
    reuseExistingServer: false,
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } } },
  ],
});
