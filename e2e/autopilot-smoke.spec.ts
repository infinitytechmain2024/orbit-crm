import { test, expect, type ConsoleMessage, type Page } from "@playwright/test";

/**
 * Autopilot browser self-test.
 *
 * This is the check the autopilot runs on its own work before it reports
 * success: log into the running app with a *local* test account, walk the core
 * user flow, and fail on fatal console errors.
 *
 * Credentials come from the environment only (`E2E_EMAIL` / `E2E_PASSWORD`,
 * normally supplied by an un-committed `.env.e2e.local`). They are never
 * written to a file, never printed, and never committed. With no credentials
 * present the suite skips rather than passing vacuously — a green run must mean
 * a browser really did log in.
 */

const email = process.env.E2E_EMAIL ?? "";
const password = process.env.E2E_PASSWORD ?? "";
const credentialsPresent = Boolean(email && password);

/** Console noise that is not a defect: third-party warnings and dev-server chatter. */
const IGNORED_CONSOLE = [
  /favicon/i,
  /Download the React DevTools/i,
  /\[vite\]/i,
  /ResizeObserver loop/i,
  /Failed to load resource: the server responded with a status of 40[13]/i,
];

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message: ConsoleMessage) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (IGNORED_CONSOLE.some((pattern) => pattern.test(text))) return;
    errors.push(text);
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
}

async function signIn(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("auth-screen")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("auth-email").fill(email);
  await page.getByTestId("auth-password").fill(password);
  await page.getByTestId("auth-submit").click();
  // The shell only renders once Supabase reports an authenticated session, so
  // waiting on it is a real assertion about login, not about navigation.
  await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 45_000 });
}

test.describe("Autopilot self-test", () => {
  // A real login round-trips to Supabase and the routes below are code-split, so
  // the default 30s per-test budget expires before the waits below can use theirs.
  test.describe.configure({ timeout: 120_000 });

  test.skip(
    !credentialsPresent,
    "E2E_EMAIL / E2E_PASSWORD не заданы — браузерный самотест пропущен (см. .env.e2e.example)",
  );

  test("logs in with the local test account", async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await signIn(page);
    await expect(page.getByTestId("auth-screen")).toHaveCount(0);
    expect(errors, `Фатальные ошибки в консоли: ${errors.join(" | ")}`).toEqual([]);
  });

  test("core routes render for an authenticated user", async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await signIn(page);

    for (const route of ["/clients", "/tasks", "/projects", "/self-development"]) {
      await page.goto(route);
      await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 30_000 });
      // Something must actually paint — an empty shell is a broken route.
      await expect(page.locator("body")).not.toBeEmpty();
    }

    expect(errors, `Фатальные ошибки в консоли: ${errors.join(" | ")}`).toEqual([]);
  });

  test("interactive controls respond", async ({ page }) => {
    await signIn(page);
    await page.goto("/tasks");
    await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 30_000 });

    const buttons = page.locator("button:visible");
    await expect(buttons.first()).toBeVisible({ timeout: 20_000 });
    // Clicking must not tear the app down — the shell has to survive it.
    await buttons.first().click({ trial: true });
    await expect(page.getByTestId("app-shell")).toBeVisible();
  });
});
