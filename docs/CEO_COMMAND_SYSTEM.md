# AI-CEO Command System - User Guide

## Overview

The AI-CEO (Chief Architect) system manages multi-project portfolios, classifies tasks, and routes them to appropriate team members. This guide explains how to use the command system effectively.

## Command Prefixes

Use these prefixes at the beginning of your messages to control task behavior:

### `/run:` - Operational Tasks
Execute operational tasks (launch agents, process voice, run workflows).

**Examples:**
```
/run: Запустить SEO-анализ для всех задач в очереди
/run: Выполнить обработку заявок клиентов
/run: Process voice commands for lead generation
```

**When to use:**
- Launching AI agents
- Processing existing data
- Running automated workflows
- Executing operational tasks

### `/change:` - Development Tasks
Create/modify code, add features, fix bugs, refactor.

**Examples:**
```
/change: Добавить поле action_type в тип WorkflowTask
/change: Исправить баг с отображением дат
/change: Create new component for client segmentation
```

**When to use:**
- Creating new features
- Modifying existing code
- Fixing bugs
- Refactoring

### `/ask:` - Questions & Clarifications
Ask questions, request explanations, or get information.

**Examples:**
```
/ask: Как правильно настроить RLS политики для таблицы bookings?
/ask: What is the current status of the deployment pipeline?
/ask: Объясни архитектуру системы аутентификации
```

**When to use:**
- Asking for information
- Requesting explanations
- Clarifying requirements

### `/check:` - Code Review & QA
Review code quality, run tests, check for issues.

**Examples:**
```
/check: Проверить типы ошибок в ai-workflow.tsx
/check: Run linting on the backend code
/check: Verify that all tests pass
```

**When to use:**
- Code review
- Quality assurance
- Running tests
- Checking for issues

### `/deploy:` - Deployment Requests
Request deployment to production environments.

**Examples:**
```
/deploy: Выложить изменения в продакшн
/deploy: Deploy frontend to Vercel
/deploy: Update backend on Render
```

**When to use:**
- Deploying to production
- Updating environments
- Releasing changes

### `/approve:` - Approve Changes
Approve pending changes or deployments.

**Examples:**
```
/approve: Подтвердить деплой фронтенда
/approve: Утвердить изменения в базе данных
```

### `/reject:` - Reject Changes
Reject pending changes or deployments.

**Examples:**
```
/reject: Отклонить изменения в API
/reject: Cancel the deployment request
```

### `/status` - Get Status
Get current system status.

**Examples:**
```
/status
/status проекта Orbit CRM
```

## Task Classification

When you create a task without a prefix, the system automatically classifies it based on:

1. **Keywords in title/description** - Russian and English keywords
2. **Risk level** - Critical, high, medium, low
3. **Project association** - Which project it belongs to

### Automatic Classification Examples

| User Input | Classified As | Action |
|------------|--------------|--------|
| "Запустить SEO-аудит сайта" | `action_type: "run"` | Auto-starts agent execution |
| "Создать задачу в проекте CRM" | `action_type: "change"` | Adds to backlog |
| "Обновить логику авторизации" | `action_type: "change"` | Goes to development |
| "Обработать заявки клиентов" | `action_type: "run"` | Triggers AI processing |

## Risk Assessment

The system automatically assesses risk based on content:

### Critical Risk (Requires CEO Approval)
- Production deploy/deployment
- Data deletion
- Payment/billing changes
- Security/auth modifications

### High Risk (Requires CEO Approval)
- Database changes
- Schema migrations
- RLS policy changes
- Backup operations

### Medium Risk
- API changes
- Backend/frontend modifications
- Component updates

### Low Risk
- Documentation
- Typo fixes
- Style/formatting changes

## Approval Workflow

### 1. Task Creation
When you create a high-risk task:
- System creates an approval request
- Task status: `approval_required`
- CEO Dashboard shows pending approval

### 2. CEO Review
- CEO reviews the task details
- Checks risk assessment
- Reviews change summary

### 3. Decision
CEO can:
- **Approve** - Task proceeds to execution
- **Reject** - Task is cancelled
- **Request Changes** - Task returns for modifications

### 4. Execution
After approval:
- Task moves to `queued` status
- Agent execution begins
- Progress tracked in real-time

## Multi-Project Support

### Project Association
Tasks are automatically associated with projects based on:
- Keywords in task description
- Manual selection during creation
- Project context from previous tasks

### Available Projects
- **Orbit CRM** - Main CRM system
- **OSNOVA** - Base platform
- **BERRDO** - Future project

### Project Filtering
Use the project filter in the toolbar to view tasks for specific projects.

## Best Practices

### 1. Be Specific
**Good:**
```
/change: Добавить компонент ClientSegmentationCard с фильтрацией по статусу
```

**Bad:**
```
/change: Сделай что-то с клиентами
```

### 2. Include Context
**Good:**
```
/run: Запустить анализ продаж за Q2 2026 для проекта Orbit CRM
```

**Bad:**
```
/run: Анализ
```

### 3. Use Appropriate Prefixes
- Use `/run:` for operational tasks
- Use `/change:` for development tasks
- Use `/ask:` for questions
- Use `/check:` for quality checks
- Use `/deploy:` for deployments

### 4. Specify Project When Unclear
```
/change: [Orbit CRM] Добавить экспорт данных в CSV
```

### 5. Review Risk Levels
- High-risk tasks require approval
- Plan ahead for critical changes
- Use `/check:` before `/deploy:`

## Troubleshooting

### Task Not Classified Correctly
- Add more specific keywords
- Use explicit prefix (`/run:`, `/change:`)
- Check project association

### Approval Stuck
- Check CEO Dashboard for pending approvals
- Verify risk level assessment
- Contact CEO for manual review

### Deployment Failed
- Check deployment queue status
- Review error messages
- Verify configuration

## API Reference

### Backend Endpoints
- `POST /api/ceo/approvals` - Create approval request
- `GET /api/ceo/approvals` - Get pending approvals
- `POST /api/ceo/approvals/{id}/decision` - Decide on approval
- `POST /api/ceo/deployments` - Create deployment request
- `GET /api/ceo/deployments` - Get pending deployments
- `POST /api/ceo/deployments/{id}/decision` - Decide on deployment
- `GET /api/ceo/dashboard` - Get CEO dashboard overview
- `GET /api/ceo/tasks` - Get CEO tasks
- `PATCH /api/ceo/tasks/{id}` - Update CEO task