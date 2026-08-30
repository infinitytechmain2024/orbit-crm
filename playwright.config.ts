import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration for Orbit CRM E2E tests.
 *
 * The autopilot's verification run drives a freshly cloned working copy on its
 * own port, so both the base URL and the dev server it boots come from
 * `E2E_BASE_URL`. Unset, this is the plain `npm run dev` setup on 8080.
 */
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:8080";
const port = new URL(baseURL).port || "8080";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // --strictPort: fail loudly on a port clash instead of drifting to another
    // port that `baseURL` would then not point at.
    command: `npm run dev -- --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
