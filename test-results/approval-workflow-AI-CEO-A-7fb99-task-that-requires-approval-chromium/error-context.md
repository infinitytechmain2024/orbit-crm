# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: approval-workflow.spec.ts >> AI-CEO Approval Workflow >> should create a high-risk task that requires approval
- Location: e2e/approval-workflow.spec.ts:23:3

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: page.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for locator('button:has-text("Создать задачу")')

```

# Page snapshot

```yaml
- main [ref=e2]:
  - generic [ref=e3]:
    - generic [ref=e9]:
      - paragraph [ref=e10]: Orbit CRM
      - paragraph [ref=e11]: защищённый вход
    - generic [ref=e12]:
      - generic [ref=e13]:
        - button "Вход" [ref=e14]
        - button "Регистрация" [ref=e15]
      - generic [ref=e16]:
        - generic [ref=e17]: Email
        - textbox "Email" [ref=e18]
      - generic [ref=e19]:
        - generic [ref=e20]: Пароль
        - textbox "Пароль" [ref=e21]
      - button "Войти" [ref=e22]
```

# Test source

```ts
  1   | import { test, expect } from "@playwright/test";
  2   | 
  3   | /**
  4   |  * E2E Tests for AI-CEO Approval Workflow
  5   |  * Tests the complete flow from task creation to approval/rejection
  6   |  */
  7   | 
  8   | test.describe("AI-CEO Approval Workflow", () => {
  9   |   test.beforeEach(async ({ page }) => {
  10  |     // Navigate to AI Workflow page
  11  |     await page.goto("/ai-workflow");
  12  |     await page.waitForLoadState("networkidle");
  13  |   });
  14  | 
  15  |   test("should display CEO Dashboard and Approval Gateway", async ({ page }) => {
  16  |     // Check CEO Dashboard is visible
  17  |     await expect(page.locator("text=CEO Dashboard")).toBeVisible();
  18  |     
  19  |     // Check Approval Gateway is visible
  20  |     await expect(page.locator("text=Approval Gateway")).toBeVisible();
  21  |   });
  22  | 
  23  |   test("should create a high-risk task that requires approval", async ({ page }) => {
  24  |     // Click create task button
> 25  |     await page.click('button:has-text("Создать задачу")');
      |                ^ Error: page.click: Test timeout of 30000ms exceeded.
  26  |     
  27  |     // Fill in task details with high-risk content
  28  |     await page.fill('input[name="title"]', "Деплой в продакшн: обновление API");
  29  |     await page.fill('textarea[name="description"]', "Обновить API эндпоинты и задеплоить в продакшн среду");
  30  |     
  31  |     // Select project
  32  |     await page.click('button:has-text("Orbit CRM")');
  33  |     
  34  |     // Set priority to critical
  35  |     await page.click('button:has-text("critical")');
  36  |     
  37  |     // Submit task
  38  |     await page.click('button:has-text("Создать")');
  39  |     
  40  |     // Wait for task to be created
  41  |     await page.waitForTimeout(1000);
  42  |     
  43  |     // Verify task appears in the table
  44  |     await expect(page.locator("text=Деплой в продакшн")).toBeVisible();
  45  |   });
  46  | 
  47  |   test("should show approval request for high-risk task", async ({ page }) => {
  48  |     // Create a high-risk task first
  49  |     await page.click('button:has-text("Создать задачу")');
  50  |     await page.fill('input[name="title"]', "Удаление таблицы users");
  51  |     await page.fill('textarea[name="description"]', "Удалить таблицу users из базы данных");
  52  |     await page.click('button:has-text("Создать")');
  53  |     
  54  |     await page.waitForTimeout(1000);
  55  |     
  56  |     // Check if approval request was created
  57  |     // The task should be in approval_required status
  58  |     await expect(page.locator("text=approval_required")).toBeVisible();
  59  |   });
  60  | 
  61  |   test("should approve a pending approval request", async ({ page }) => {
  62  |     // Check if there are pending approvals
  63  |     const pendingApprovals = page.locator('[data-testid="approval-card"]');
  64  |     const count = await pendingApprovals.count();
  65  |     
  66  |     if (count > 0) {
  67  |       // Click approve button on first approval
  68  |       await pendingApprovals.first().locator('button:has-text("Approve")').click();
  69  |       
  70  |       // Wait for approval to be processed
  71  |       await page.waitForTimeout(1000);
  72  |       
  73  |       // Verify approval was processed (card should disappear or status change)
  74  |       await expect(pendingApprovals.first()).not.toBeVisible();
  75  |     }
  76  |   });
  77  | 
  78  |   test("should reject a pending approval request", async ({ page }) => {
  79  |     // Check if there are pending approvals
  80  |     const pendingApprovals = page.locator('[data-testid="approval-card"]');
  81  |     const count = await pendingApprovals.count();
  82  |     
  83  |     if (count > 0) {
  84  |       // Click reject button on first approval
  85  |       await pendingApprovals.first().locator('button:has-text("Reject")').click();
  86  |       
  87  |       // Wait for rejection to be processed
  88  |       await page.waitForTimeout(1000);
  89  |       
  90  |       // Verify rejection was processed
  91  |       await expect(pendingApprovals.first()).not.toBeVisible();
  92  |     }
  93  |   });
  94  | 
  95  |   test("should request changes for a pending approval", async ({ page }) => {
  96  |     // Check if there are pending approvals
  97  |     const pendingApprovals = page.locator('[data-testid="approval-card"]');
  98  |     const count = await pendingApprovals.count();
  99  |     
  100 |     if (count > 0) {
  101 |       // Click changes button on first approval
  102 |       await pendingApprovals.first().locator('button:has-text("Changes")').click();
  103 |       
  104 |       // Wait for changes request to be processed
  105 |       await page.waitForTimeout(1000);
  106 |       
  107 |       // Verify changes were requested
  108 |       await expect(pendingApprovals.first()).not.toBeVisible();
  109 |     }
  110 |   });
  111 | 
  112 |   test("should filter tasks by action type", async ({ page }) => {
  113 |     // Check if action type filter exists
  114 |     const runFilter = page.locator('button:has-text("Run")');
  115 |     const changeFilter = page.locator('button:has-text("Change")');
  116 |     
  117 |     if (await runFilter.isVisible()) {
  118 |       await runFilter.click();
  119 |       await page.waitForTimeout(500);
  120 |     }
  121 |     
  122 |     if (await changeFilter.isVisible()) {
  123 |       await changeFilter.click();
  124 |       await page.waitForTimeout(500);
  125 |     }
```