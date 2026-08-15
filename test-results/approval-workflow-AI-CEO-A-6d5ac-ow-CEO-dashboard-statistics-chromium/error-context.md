# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: approval-workflow.spec.ts >> AI-CEO Approval Workflow >> should show CEO dashboard statistics
- Location: e2e/approval-workflow.spec.ts:138:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('text=Pending Approvals')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for locator('text=Pending Approvals')

```

```yaml
- main:
  - paragraph: Orbit CRM
  - paragraph: защищённый вход
  - button "Вход"
  - button "Регистрация"
  - text: Email
  - textbox "Email"
  - text: Пароль
  - textbox "Пароль"
  - button "Войти"
```

# Test source

```ts
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
  126 |   });
  127 | 
  128 |   test("should display task risk level badges", async ({ page }) => {
  129 |     // Check for risk level badges in the task table
  130 |     const riskBadges = page.locator('[data-testid="risk-badge"]');
  131 |     
  132 |     // Verify that risk badges are displayed
  133 |     if (await riskBadges.count() > 0) {
  134 |       await expect(riskBadges.first()).toBeVisible();
  135 |     }
  136 |   });
  137 | 
  138 |   test("should show CEO dashboard statistics", async ({ page }) => {
  139 |     // Check CEO dashboard statistics
> 140 |     await expect(page.locator("text=Pending Approvals")).toBeVisible();
      |                                                          ^ Error: expect(locator).toBeVisible() failed
  141 |     await expect(page.locator("text=Pending Deployments")).toBeVisible();
  142 |     await expect(page.locator("text=Tasks by Action Type")).toBeVisible();
  143 |     await expect(page.locator("text=Tasks by Project")).toBeVisible();
  144 |   });
  145 | 
  146 |   test("should navigate to task details from approval", async ({ page }) => {
  147 |     // Check if there are pending approvals
  148 |     const pendingApprovals = page.locator('[data-testid="approval-card"]');
  149 |     const count = await pendingApprovals.count();
  150 |     
  151 |     if (count > 0) {
  152 |       // Click on task ID link
  153 |       await pendingApprovals.first().locator('a:has-text("Task:")').click();
  154 |       
  155 |       // Wait for navigation
  156 |       await page.waitForTimeout(1000);
  157 |       
  158 |       // Verify task details dialog or page is shown
  159 |       await expect(page.locator("text=Task Details")).toBeVisible();
  160 |     }
  161 |   });
  162 | });
  163 | 
  164 | test.describe("AI-CEO Deployment Workflow", () => {
  165 |   test.beforeEach(async ({ page }) => {
  166 |     await page.goto("/ai-workflow");
  167 |     await page.waitForLoadState("networkidle");
  168 |   });
  169 | 
  170 |   test("should create a deployment request", async ({ page }) => {
  171 |     // Click create task button
  172 |     await page.click('button:has-text("Создать задачу")');
  173 |     
  174 |     // Fill in deployment-related task
  175 |     await page.fill('input[name="title"]', "Деплой фронтенда на Vercel");
  176 |     await page.fill('textarea[name="description"]', "Обновить и задеплоить фронтенд приложение");
  177 |     
  178 |     // Submit task
  179 |     await page.click('button:has-text("Создать")');
  180 |     
  181 |     await page.waitForTimeout(1000);
  182 |     
  183 |     // Verify task was created
  184 |     await expect(page.locator("text=Деплой фронтенда")).toBeVisible();
  185 |   });
  186 | 
  187 |   test("should show deployment queue in sidebar", async ({ page }) => {
  188 |     // Check if deployment queue is visible
  189 |     const deploymentQueue = page.locator('[data-testid="deployment-queue"]');
  190 |     
  191 |     if (await deploymentQueue.isVisible()) {
  192 |       await expect(deploymentQueue).toBeVisible();
  193 |     }
  194 |   });
  195 | });
  196 | 
  197 | test.describe("AI-CEO Command System", () => {
  198 |   test.beforeEach(async ({ page }) => {
  199 |     await page.goto("/ai-workflow");
  200 |     await page.waitForLoadState("networkidle");
  201 |   });
  202 | 
  203 |   test("should create task with /run: prefix", async ({ page }) => {
  204 |     // Click create task button
  205 |     await page.click('button:has-text("Создать задачу")');
  206 |     
  207 |     // Fill in task with run prefix
  208 |     await page.fill('input[name="title"]', "/run: Запустить анализ данных");
  209 |     await page.fill('textarea[name="description"]', "Выполнить анализ продаж за последний месяц");
  210 |     
  211 |     // Submit task
  212 |     await page.click('button:has-text("Создать")');
  213 |     
  214 |     await page.waitForTimeout(1000);
  215 |     
  216 |     // Verify task was created with run action type
  217 |     await expect(page.locator("text=Запустить анализ данных")).toBeVisible();
  218 |   });
  219 | 
  220 |   test("should create task with /change: prefix", async ({ page }) => {
  221 |     // Click create task button
  222 |     await page.click('button:has-text("Создать задачу")');
  223 |     
  224 |     // Fill in task with change prefix
  225 |     await page.fill('input[name="title"]', "/change: Добавить форму регистрации");
  226 |     await page.fill('textarea[name="description"]', "Создать новую форму регистрации пользователей");
  227 |     
  228 |     // Submit task
  229 |     await page.click('button:has-text("Создать")');
  230 |     
  231 |     await page.waitForTimeout(1000);
  232 |     
  233 |     // Verify task was created with change action type
  234 |     await expect(page.locator("text=Добавить форму регистрации")).toBeVisible();
  235 |   });
  236 | });
```