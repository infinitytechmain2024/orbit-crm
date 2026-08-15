---
name: self-development
description: "Analyze code, suggest improvements, and apply changes for self-development goals."
user-invocable: false
---

# Self-Development Skill

Analyzes codebase against goals, generates improvement suggestions, and applies approved changes.

## Workflow

1. Receive goal registration from CRM via webhook.
2. Scan codebase for issues related to the goal.
3. Generate improvement suggestions with before/after code.
4. Send suggestions to CRM via webhook.
5. Apply approved improvements when triggered.

## Tools

- `goal_register` — Register a new self-development goal.
- `goal_assess` — Analyze code and generate suggestions.
- `apply_improvement` — Apply an approved improvement.

## Webhook Format

```json
{
  "action": "improvement_suggestion|goal_progress|goal_completed|analysis_result",
  "goal_id": "uuid",
  "data": {}
}
```
