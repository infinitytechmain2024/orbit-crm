# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: approval-workflow.spec.ts >> AI-CEO Command System >> should create task with /change: prefix
- Location: e2e/approval-workflow.spec.ts:220:3

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
  140 |     await expect(page.locator("text=Pending Approvals")).toBeVisible();
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
> 222 |     await page.click('button:has-text("Создать задачу")');
      |                ^ Error: page.click: Test timeout of 30000ms exceeded.
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