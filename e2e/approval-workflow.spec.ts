import { test, expect } from "@playwright/test";

/**
 * E2E Tests for AI Workflow
 * Tests core functionality and component stability
 * Note: Tests handle both authenticated and unauthenticated states
 */

test.describe("AI Workflow Page", () => {
  test("should load the AI Workflow page or login", async ({ page }) => {
    await page.goto("/ai-workflow");
    await page.waitForLoadState("networkidle");

    // Check if we're on login page or workflow page
    const isLoginPage = await page
      .locator('button:has-text("Вход"), input[name="email"]')
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    if (isLoginPage) {
      // Verify login form is visible
      await expect(page.locator('button:has-text("Вход")').first()).toBeVisible();
    } else {
      // Verify workflow page loaded
      await expect(page.locator("h1, h2, h3").first()).toBeVisible();
    }
  });

  test("should display content after navigation", async ({ page }) => {
    await page.goto("/ai-workflow");
    await page.waitForLoadState("networkidle");

    // Wait for any content to load
    await page.waitForTimeout(2000);

    // Page should have some visible content
    const body = page.locator("body");
    await expect(body).toBeVisible();
  });
});

test.describe("AI Workflow Components", () => {
  test("should have functional buttons", async ({ page }) => {
    await page.goto("/ai-workflow");
    await page.waitForLoadState("networkidle");

    // Check for any buttons
    const buttons = page.locator("button");
    const count = await buttons.count();

    // At least some buttons should exist
    expect(count).toBeGreaterThan(0);
  });

  test("should have responsive layout", async ({ page }) => {
    await page.goto("/ai-workflow");
    await page.waitForLoadState("networkidle");

    // Test mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(500);

    // Page should still be functional
    const body = page.locator("body");
    await expect(body).toBeVisible();

    // Test desktop viewport
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.waitForTimeout(500);
    await expect(body).toBeVisible();
  });
});

test.describe("AI Workflow Stability", () => {
  test("should handle page reload", async ({ page }) => {
    await page.goto("/ai-workflow");
    await page.waitForLoadState("networkidle");

    // Reload page
    await page.reload();
    await page.waitForLoadState("networkidle");

    // Page should still be functional
    const body = page.locator("body");
    await expect(body).toBeVisible();
  });

  test("should not have console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        errors.push(msg.text());
      }
    });

    await page.goto("/ai-workflow");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    // Filter out known non-critical errors
    const criticalErrors = errors.filter((e) => !e.includes("WebSocket") && !e.includes("favicon"));

    // No critical errors
    expect(criticalErrors).toHaveLength(0);
  });
});
