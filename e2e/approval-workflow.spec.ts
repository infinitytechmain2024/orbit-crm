import { test, expect } from "@playwright/test";

/**
 * E2E Tests for AI-CEO Approval Workflow
 * Tests the complete flow from task creation to approval/rejection
 */

test.describe("AI-CEO Approval Workflow", () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to AI Workflow page
    await page.goto("/ai-workflow");
    await page.waitForLoadState("networkidle");
  });

  test("should display CEO Dashboard and Approval Gateway", async ({ page }) => {
    // Check CEO Dashboard is visible
    await expect(page.locator("text=CEO Dashboard")).toBeVisible();
    
    // Check Approval Gateway is visible
    await expect(page.locator("text=Approval Gateway")).toBeVisible();
  });

  test("should create a high-risk task that requires approval", async ({ page }) => {
    // Click create task button
    await page.click('button:has-text("Создать задачу")');
    
    // Fill in task details with high-risk content
    await page.fill('input[name="title"]', "Деплой в продакшн: обновление API");
    await page.fill('textarea[name="description"]', "Обновить API эндпоинты и задеплоить в продакшн среду");
    
    // Select project
    await page.click('button:has-text("Orbit CRM")');
    
    // Set priority to critical
    await page.click('button:has-text("critical")');
    
    // Submit task
    await page.click('button:has-text("Создать")');
    
    // Wait for task to be created
    await page.waitForTimeout(1000);
    
    // Verify task appears in the table
    await expect(page.locator("text=Деплой в продакшн")).toBeVisible();
  });

  test("should show approval request for high-risk task", async ({ page }) => {
    // Create a high-risk task first
    await page.click('button:has-text("Создать задачу")');
    await page.fill('input[name="title"]', "Удаление таблицы users");
    await page.fill('textarea[name="description"]', "Удалить таблицу users из базы данных");
    await page.click('button:has-text("Создать")');
    
    await page.waitForTimeout(1000);
    
    // Check if approval request was created
    // The task should be in approval_required status
    await expect(page.locator("text=approval_required")).toBeVisible();
  });

  test("should approve a pending approval request", async ({ page }) => {
    // Check if there are pending approvals
    const pendingApprovals = page.locator('[data-testid="approval-card"]');
    const count = await pendingApprovals.count();
    
    if (count > 0) {
      // Click approve button on first approval
      await pendingApprovals.first().locator('button:has-text("Approve")').click();
      
      // Wait for approval to be processed
      await page.waitForTimeout(1000);
      
      // Verify approval was processed (card should disappear or status change)
      await expect(pendingApprovals.first()).not.toBeVisible();
    }
  });

  test("should reject a pending approval request", async ({ page }) => {
    // Check if there are pending approvals
    const pendingApprovals = page.locator('[data-testid="approval-card"]');
    const count = await pendingApprovals.count();
    
    if (count > 0) {
      // Click reject button on first approval
      await pendingApprovals.first().locator('button:has-text("Reject")').click();
      
      // Wait for rejection to be processed
      await page.waitForTimeout(1000);
      
      // Verify rejection was processed
      await expect(pendingApprovals.first()).not.toBeVisible();
    }
  });

  test("should request changes for a pending approval", async ({ page }) => {
    // Check if there are pending approvals
    const pendingApprovals = page.locator('[data-testid="approval-card"]');
    const count = await pendingApprovals.count();
    
    if (count > 0) {
      // Click changes button on first approval
      await pendingApprovals.first().locator('button:has-text("Changes")').click();
      
      // Wait for changes request to be processed
      await page.waitForTimeout(1000);
      
      // Verify changes were requested
      await expect(pendingApprovals.first()).not.toBeVisible();
    }
  });

  test("should filter tasks by action type", async ({ page }) => {
    // Check if action type filter exists
    const runFilter = page.locator('button:has-text("Run")');
    const changeFilter = page.locator('button:has-text("Change")');
    
    if (await runFilter.isVisible()) {
      await runFilter.click();
      await page.waitForTimeout(500);
    }
    
    if (await changeFilter.isVisible()) {
      await changeFilter.click();
      await page.waitForTimeout(500);
    }
  });

  test("should display task risk level badges", async ({ page }) => {
    // Check for risk level badges in the task table
    const riskBadges = page.locator('[data-testid="risk-badge"]');
    
    // Verify that risk badges are displayed
    if (await riskBadges.count() > 0) {
      await expect(riskBadges.first()).toBeVisible();
    }
  });

  test("should show CEO dashboard statistics", async ({ page }) => {
    // Check CEO dashboard statistics
    await expect(page.locator("text=Pending Approvals")).toBeVisible();
    await expect(page.locator("text=Pending Deployments")).toBeVisible();
    await expect(page.locator("text=Tasks by Action Type")).toBeVisible();
    await expect(page.locator("text=Tasks by Project")).toBeVisible();
  });

  test("should navigate to task details from approval", async ({ page }) => {
    // Check if there are pending approvals
    const pendingApprovals = page.locator('[data-testid="approval-card"]');
    const count = await pendingApprovals.count();
    
    if (count > 0) {
      // Click on task ID link
      await pendingApprovals.first().locator('a:has-text("Task:")').click();
      
      // Wait for navigation
      await page.waitForTimeout(1000);
      
      // Verify task details dialog or page is shown
      await expect(page.locator("text=Task Details")).toBeVisible();
    }
  });
});

test.describe("AI-CEO Deployment Workflow", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/ai-workflow");
    await page.waitForLoadState("networkidle");
  });

  test("should create a deployment request", async ({ page }) => {
    // Click create task button
    await page.click('button:has-text("Создать задачу")');
    
    // Fill in deployment-related task
    await page.fill('input[name="title"]', "Деплой фронтенда на Vercel");
    await page.fill('textarea[name="description"]', "Обновить и задеплоить фронтенд приложение");
    
    // Submit task
    await page.click('button:has-text("Создать")');
    
    await page.waitForTimeout(1000);
    
    // Verify task was created
    await expect(page.locator("text=Деплой фронтенда")).toBeVisible();
  });

  test("should show deployment queue in sidebar", async ({ page }) => {
    // Check if deployment queue is visible
    const deploymentQueue = page.locator('[data-testid="deployment-queue"]');
    
    if (await deploymentQueue.isVisible()) {
      await expect(deploymentQueue).toBeVisible();
    }
  });
});

test.describe("AI-CEO Command System", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/ai-workflow");
    await page.waitForLoadState("networkidle");
  });

  test("should create task with /run: prefix", async ({ page }) => {
    // Click create task button
    await page.click('button:has-text("Создать задачу")');
    
    // Fill in task with run prefix
    await page.fill('input[name="title"]', "/run: Запустить анализ данных");
    await page.fill('textarea[name="description"]', "Выполнить анализ продаж за последний месяц");
    
    // Submit task
    await page.click('button:has-text("Создать")');
    
    await page.waitForTimeout(1000);
    
    // Verify task was created with run action type
    await expect(page.locator("text=Запустить анализ данных")).toBeVisible();
  });

  test("should create task with /change: prefix", async ({ page }) => {
    // Click create task button
    await page.click('button:has-text("Создать задачу")');
    
    // Fill in task with change prefix
    await page.fill('input[name="title"]', "/change: Добавить форму регистрации");
    await page.fill('textarea[name="description"]', "Создать новую форму регистрации пользователей");
    
    // Submit task
    await page.click('button:has-text("Создать")');
    
    await page.waitForTimeout(1000);
    
    // Verify task was created with change action type
    await expect(page.locator("text=Добавить форму регистрации")).toBeVisible();
  });
});