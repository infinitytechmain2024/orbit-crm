---
name: crm-executor
description: "Execute tasks from Orbit CRM, return results via webhook."
user-invocable: false
---

# CRM Executor

Receives tasks from Orbit CRM, executes them, and returns results via webhook.

## Workflow

1. Receive task with `task_id` and `command` from CRM.
2. Execute the command (create files, run scripts, etc.).
3. Return result to CRM via webhook POST to `/api/openclaw/webhook`.

## Webhook Format

```json
{
  "task_id": "uuid",
  "status": "completed|error",
  "result": {},
  "error": "error message if failed"
}
```

## Execution

- Parse the command from the task context.
- Execute using available tools (bash, file operations, etc.).
- Capture output and errors.
- Send result back to CRM webhook endpoint.
