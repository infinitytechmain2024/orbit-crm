# ТЕХНИЧЕСКИЙ ПРОМПТ И ПЛАН РАБОТ ДЛЯ ИИ-АГЕНТА И РАЗРАБОТЧИКОВ

## Цель проекта

Перевести интерфейс из статического макета (mockup) в полноценно функционирующую систему управления ИИ-воркфлоу. Обеспечить интерактивность всех элементов управления, интеграцию с реальным бэкендом, мультишлюзом ИИ-моделей и динамическим выполнением задач агентами.

---

## БЛОК 1. Устранение заглушек и демо-режима (Backend & State)

### 1.1 Удаление верхнего баннера о демо-режиме

**Текущее состояние:**

- Плашка "Backend пока недоступен — AI Workflow автоматически переключён на рабочий demo-режим"
- Жестко закодированный статус

**Требуемое поведение:**

- Убрать постоянную плашку
- Заменить на реальный опрос эндпоинта `/api/health`
- При недоступности бэкенда: кастомный тост-модалок с кнопкой "Повторить подключение"

**Реализация:**

```typescript
// src/features/ai-workflow/use-backend-status.ts
export function useBackendStatus() {
  const [status, setStatus] = useState<"checking" | "online" | "offline">("checking");
  const [lastCheck, setLastCheck] = useState<Date | null>(null);

  useEffect(() => {
    const checkHealth = async () => {
      try {
        const response = await fetch("/api/health", {
          method: "GET",
          signal: AbortSignal.timeout(5000),
        });
        setStatus(response.ok ? "online" : "offline");
        setLastCheck(new Date());
      } catch {
        setStatus("offline");
      }
    };

    checkHealth();
    const interval = setInterval(checkHealth, 30000); // каждые 30 сек
    return () => clearInterval(interval);
  }, []);

  return { status, lastCheck, retry: checkHealth };
}
```

**Компонент тоста:**

```typescript
// src/components/BackendStatusToast.tsx
export function BackendStatusToast({ status, onRetry }: Props) {
  if (status === 'online') return null;

  return (
    <div className="fixed top-4 right-4 z-50 animate-in slide-in-from-right">
      <div className="bg-card border border-border rounded-lg p-4 shadow-lg max-w-sm">
        <div className="flex items-center gap-3">
          <AlertCircle className="h-5 w-5 text-amber-500" />
          <div className="flex-1">
            <p className="text-sm font-medium">Backend недоступен</p>
            <p className="text-xs text-muted-foreground">
              Работаем в демо-режиме
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={onRetry}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
```

### 1.2 Интеграция кнопок управления

**Кнопка "Проверить бэкенд":**

- Отправляет `GET /api/health`
- Обновляет индикатор статуса соединения
- Показывает анимацию загрузки во время проверки

**Кнопка "Demo mode":**

- Переключает стейт приложения в режим песочницы
- Сохраняет состояние в `localStorage`
- Визуально подсвечивается при активности

**Реализация:**

```typescript
// src/features/ai-workflow/use-demo-mode.ts
export function useDemoMode() {
  const [isDemo, setIsDemo] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("ai-workflow-demo") === "true";
    }
    return false;
  });

  const toggleDemo = useCallback(() => {
    setIsDemo((prev) => {
      const next = !prev;
      localStorage.setItem("ai-workflow-demo", String(next));
      return next;
    });
  }, []);

  return { isDemo, toggleDemo };
}
```

---

## БЛОК 2. Оживление верхнего блока «План Orbit Commander» и Ленты выполнения

### 2.1 Верхняя панель статуса воркфлоу

**Текущее состояние:**

- Статический прогресс 5%
- Кнопки без привязки к API

**Требуемое поведение:**

- Прогресс: `(Completed Tasks / Total Tasks) * 100`
- Кнопки Pause/Cancel отправляют запросы на бэкенд
- Динамическое обновление статуса

**Реализация прогресса:**

```typescript
// src/features/ai-workflow/use-workflow-progress.ts
export function useWorkflowProgress(tasks: WorkflowTask[]) {
  return useMemo(() => {
    const total = tasks.length;
    const completed = tasks.filter((t) => t.status === "done").length;
    const inProgress = tasks.filter((t) => t.status === "in_progress").length;
    const queued = tasks.filter((t) => t.status === "queued").length;

    const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

    return {
      progress,
      total,
      completed,
      inProgress,
      queued,
      isComplete: progress === 100,
    };
  }, [tasks]);
}
```

**Кнопки управления:**

```typescript
// src/features/ai-workflow/api.ts
export async function pauseWorkflow(
  token: string,
  taskId: string,
  organizationId: string,
): Promise<void> {
  await fetch(`/api/ai-workflow/tasks/${taskId}/pause`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${INTERNAL_API_TOKEN}`,
      "X-Supabase-Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ organization_id: organizationId }),
  });
}

export async function cancelWorkflow(
  token: string,
  taskId: string,
  organizationId: string,
): Promise<void> {
  await fetch(`/api/ai-workflow/tasks/${taskId}/cancel`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${INTERNAL_API_TOKEN}`,
      "X-Supabase-Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ organization_id: organizationId }),
  });
}
```

**Модальное окно подтверждения Cancel:**

```typescript
// src/components/ai-workflow/CancelConfirmDialog.tsx
export function CancelConfirmDialog({
  open,
  onConfirm,
  onCancel
}: CancelConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onCancel}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Отменить выполнение?</AlertDialogTitle>
          <AlertDialogDescription>
            Это остановит все активные процессы агентов.
            Текущий прогресс будет сохранён.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Отмена</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-destructive text-destructive-foreground"
          >
            Да, отменить
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

### 2.2 Лента выполнения (WebSocket)

**Текущее состояние:**

- Статический список событий

**Требуемое поведение:**

- WebSocket-канал `/ws/activity` для логов в реальном времени
- Кликабельность элементов
- Детальный лог по клику

**Реализация WebSocket:**

```typescript
// src/features/ai-workflow/use-activity-stream.ts
export function useActivityStream(organizationId: string) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (!organizationId) return;

    const ws = new WebSocket(`${WS_URL}/ws/activity?org=${organizationId}`);

    ws.onopen = () => setIsConnected(true);
    ws.onclose = () => setIsConnected(false);

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setEvents((prev) => [data, ...prev].slice(0, 100)); // последние 100
    };

    return () => ws.close();
  }, [organizationId]);

  return { events, isConnected };
}
```

**Компонент ленты:**

```typescript
// src/components/ai-workflow/ActivityFeed.tsx
export function ActivityFeed({ events, onEventClick }: ActivityFeedProps) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">Лента выполнения</h3>
      <ScrollArea className="h-[400px]">
        {events.map(event => (
          <div
            key={event.id}
            className="p-2 rounded-lg hover:bg-muted cursor-pointer transition-colors"
            onClick={() => onEventClick(event)}
          >
            <div className="flex items-center gap-2">
              <StatusBadge status={event.status} />
              <span className="text-xs text-muted-foreground">
                {event.agent} · {event.project}
              </span>
            </div>
            <p className="text-sm mt-1">{event.message}</p>
            <time className="text-[10px] text-muted-foreground">
              {formatDistanceToNow(new Date(event.timestamp))}
            </time>
          </div>
        ))}
      </ScrollArea>
    </div>
  );
}
```

---

## БЛОК 3. Архитектура ролей и департаментов

### 3.1 Глобальный узел (CEO)

**Текущее состояние:**

- Статические цифры 5 в очереди, 5 в работе, 4 готово

**Требуемое поведение:**

- Динамические данные из БД
- Кнопка принятия решений CEO
- Подсветка задач, требующих подтверждения

**Реализация агрегации:**

```typescript
// src/features/ai-workflow/use-ceo-stats.ts
export function useCEOStats(tasks: WorkflowTask[]) {
  return useMemo(() => {
    const queued = tasks.filter((t) => ["queued", "planning"].includes(t.status)).length;

    const inProgress = tasks.filter((t) => t.status === "in_progress").length;

    const done = tasks.filter((t) => t.status === "done").length;

    const pendingApproval = tasks.filter((t) => t.status === "approval_required");

    return {
      queued,
      inProgress,
      done,
      pendingApproval,
      total: tasks.length,
    };
  }, [tasks]);
}
```

**Компонент CEO Node:**

```typescript
// src/components/ai-workflow/CEONode.tsx
export function CEONode({ stats, onApprove }: CEONodeProps) {
  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Crown className="h-5 w-5 text-primary" />
        <h3 className="font-medium">CEO</h3>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <StatCard label="В очереди" value={stats.queued} />
        <StatCard label="В работе" value={stats.inProgress} />
        <StatCard label="Готово" value={stats.done} />
      </div>

      {stats.pendingApproval.length > 0 && (
        <div className="mt-3 p-2 bg-amber-500/10 rounded-lg">
          <p className="text-xs text-amber-500 font-medium mb-2">
            Ожидает решения CEO ({stats.pendingApproval.length})
          </p>
          {stats.pendingApproval.map(task => (
            <div
              key={task.id}
              className="flex items-center justify-between p-2 bg-background rounded"
            >
              <span className="text-sm truncate">{task.title}</span>
              <Button
                size="sm"
                onClick={() => onApprove(task)}
              >
                Решить
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

### 3.2 Департаменты

**Текущее состояние:**

- Статические карточки без интерактивности

**Требуемое поведение:**

- Кликабельность карточек
- Открытие канбан-борда департамента
- Статус и счетчик задач

**Реализация:**

```typescript
// src/components/ai-workflow/DepartmentCard.tsx
export function DepartmentCard({
  department,
  tasks,
  onClick
}: DepartmentCardProps) {
  const stats = useMemo(() => ({
    total: tasks.length,
    active: tasks.filter(t => t.status === 'in_progress').length,
    queued: tasks.filter(t => t.status === 'queued').length,
    done: tasks.filter(t => t.status === 'done').length
  }), [tasks]);

  const hasActiveWork = stats.active > 0;

  return (
    <div
      className={cn(
        "rounded-xl border p-4 cursor-pointer transition-all hover:shadow-lg",
        hasActiveWork
          ? "border-green-500/30 bg-green-500/5"
          : "border-border bg-card"
      )}
      onClick={onClick}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div
            className="h-3 w-3 rounded-full"
            style={{ backgroundColor: department.color }}
          />
          <h3 className="font-medium text-sm">{department.name}</h3>
        </div>
        {hasActiveWork && (
          <Badge variant="outline" className="text-[10px]">
            <Loader2 className="h-3 w-3 animate-spin mr-1" />
            Working
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-3 gap-1 text-center text-xs">
        <div>
          <div className="font-medium">{stats.queued}</div>
          <div className="text-muted-foreground">Очередь</div>
        </div>
        <div>
          <div className="font-medium">{stats.active}</div>
          <div className="text-muted-foreground">В работе</div>
        </div>
        <div>
          <div className="font-medium">{stats.done}</div>
          <div className="text-muted-foreground">Готово</div>
        </div>
      </div>
    </div>
  );
}
```

### 3.3 Внутренние модули агентов

**Текущее состояние:**

- Список агентов без статусов

**Требуемое поведение:**

- Статус (idle, working) для каждого агента
- Текущая активная задача
- Переключатель AI/Manual режима

**Реализация:**

```typescript
// src/components/ai-workflow/AgentModule.tsx
export function AgentModule({
  agent,
  currentTask,
  onModeToggle,
  onReassign
}: AgentModuleProps) {
  const isWorking = agent.status === 'working';

  return (
    <div className={cn(
      "p-3 rounded-lg border",
      isWorking
        ? "border-green-500/30 bg-green-500/5"
        : "border-border bg-muted/30"
    )}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={cn(
            "h-2 w-2 rounded-full",
            isWorking ? "bg-green-500" : "bg-muted-foreground"
          )} />
          <span className="text-sm font-medium">{agent.name}</span>
        </div>

        <Switch
          checked={agent.mode === 'ai'}
          onCheckedChange={(checked) => onModeToggle(agent.id, checked)}
        />
      </div>

      {currentTask && (
        <div className="mt-2 p-2 bg-background rounded text-xs">
          <div className="text-muted-foreground">Текущая задача:</div>
          <div className="truncate">{currentTask.title}</div>
        </div>
      )}

      {!currentTask && (
        <p className="mt-2 text-xs text-muted-foreground">
          Нет активных задач
        </p>
      )}
    </div>
  );
}
```

---

## БЛОК 4. Настройка Мультишлюза ИИ-моделей

### 4.1 AI Router (Маршрутизатор)

**Требуемое поведение:**

- Единый сервис маршрутизации задач
- Распределение по моделям в зависимости от типа задачи
- Автоматический выбор лучшей модели

**Реализация:**

```typescript
// backend/services/ai_router.py
class AIRouter:
    """Маршрутизатор задач между ИИ-моделями"""

    MODEL_CAPABILITIES = {
        "openai/gpt-4o": {
            "strengths": ["coding", "reasoning", "complex_analysis"],
            "cost": "high",
            "speed": "medium"
        },
        "anthropic/claude-3.5-sonnet": {
            "strengths": ["coding", "writing", "analysis"],
            "cost": "high",
            "speed": "medium"
        },
        "deepseek/deepseek-coder": {
            "strengths": ["coding", "technical"],
            "cost": "low",
            "speed": "fast"
        },
        "yandex/yandexgpt": {
            "strengths": ["russian_text", "seo", "content"],
            "cost": "low",
            "fast": "fast"
        },
        "nvidia/llama-3.3-70b": {
            "strengths": ["reasoning", "long_context"],
            "cost": "medium",
            "speed": "medium"
        }
    }

    TASK_TYPE_MAPPING = {
        "coding": ["openai/gpt-4o", "anthropic/claude-3.5-sonnet", "deepseek/deepseek-coder"],
        "writing": ["anthropic/claude-3.5-sonnet", "yandex/yandexgpt"],
        "seo": ["yandex/yandexgpt", "openai/gpt-4o"],
        "analysis": ["openai/gpt-4o", "nvidia/llama-3.3-70b"],
        "reasoning": ["nvidia/llama-3.3-70b", "openai/gpt-4o"]
    }

    async def route_task(self, task: WorkflowTask) -> str:
        """Выбор оптимальной модели для задачи"""
        task_type = self._classify_task_type(task)
        available_models = self.TASK_TYPE_MAPPING.get(task_type, [])

        for model in available_models:
            if await self._check_model_availability(model):
                return model

        return "nvidia/llama-3.3-70b"  # fallback

    def _classify_task_type(self, task: WorkflowTask) -> str:
        """Классификация типа задачи"""
        text = f"{task.title} {task.description}".lower()

        if any(kw in text for kw in ["код", "code", "api", "backend", "frontend"]):
            return "coding"
        if any(kw in text for kw in ["текст", "статья", "copywriting"]):
            return "writing"
        if any(kw in text for kw in ["seo", "семантика", "мета"]):
            return "seo"
        if any(kw in text for kw in ["анализ", "отчет", "метрики"]):
            return "analysis"

        return "reasoning"
```

### 4.2 Системные промпты для агентов

**Требуемое поведение:**

- Уникальный промпт для каждого типа агента
- Генерация валидных артефактов
- Автоматическое сохранение результатов

**Реализация:**

```typescript
// backend/services/agent_prompts.ts
export const AGENT_PROMPTS = {
  "Backend Dev": {
    system: `Ты Backend разработчик в компании Orbit.
Твоя задача - писать чистый, безопасный и масштабируемый код на Python/FastAPI.
Всегда добавляй type hints, docstrings и обработку ошибок.
Генерируй код в формате, готовом к деплою.`,
    artifacts: ["python", "sql", "api_endpoint"],
  },

  Frontend: {
    system: `Ты Frontend разработчик в компании Orbit.
Используй React + TypeScript + Tailwind CSS.
Создавай переиспользуемые компоненты с правильной типизацией.
Следуй принципам atomic design.`,
    artifacts: ["tsx", "css", "component"],
  },

  SEO: {
    system: `Ты SEO-специалист в компании Orbit.
Создавай семантические ядра, оптимизируй мета-теги.
Генерируй отчёты с конкретными рекомендациями.
Используй данные из Google Search Console.`,
    artifacts: ["md", "xlsx", "seo_report"],
  },

  CMO: {
    system: `Ты маркетинговый директор в компании Orbit.
Разрабатывай стратегии роста, анализируй воронки.
Создавай планы контента и рекламных кампаний.`,
    artifacts: ["md", "xlsx", "marketing_plan"],
  },

  HR: {
    system: `Ты HR-менеджер в компании Orbit.
Создавай вакансии, проводи оценку кандидатов.
Разрабатывай программы онбординга.`,
    artifacts: ["md", "doc", "hr_process"],
  },
};
```

### 4.3 Генерация артефактов

**Требуемое поведение:**

- Автоматическое сохранение результатов в блок "Последние артефакты"
- Поддержка форматов: .md, .xlsx, .pdf, .py, .tsx

**Реализация:**

````typescript
// backend/services/artifact_generator.ts
export class ArtifactGenerator {
  async generateAndSave(
    task: WorkflowTask,
    result: string,
    agent: WorkflowAgent,
  ): Promise<WorkflowArtifact> {
    const artifactType = this.determineArtifactType(result, agent);
    const filename = this.generateFilename(task.title, artifactType);

    // Сохранение в Supabase Storage
    const { data, error } = await supabase.storage
      .from("artifacts")
      .upload(`${task.id}/${filename}`, result, {
        contentType: this.getContentType(artifactType),
      });

    // Создание записи в БД
    const artifact = await ai_workflow_store.insert("artifacts", {
      task_id: task.id,
      project_id: task.project_id,
      agent_id: agent.id,
      name: filename,
      type: artifactType,
      url: data?.path || "",
      metadata: {
        generated_by: agent.role,
        model_used: task.current_model,
        word_count: result.split(/\s+/).length,
      },
    });

    return artifact;
  }

  private determineArtifactType(content: string, agent: WorkflowAgent): string {
    if (content.includes("```python")) return "python";
    if (content.includes("```tsx") || content.includes("```jsx")) return "tsx";
    if (content.includes("|") && content.includes("---")) return "xlsx";
    if (agent.role === "SEO") return "seo_report";
    return "markdown";
  }
}
````

---

## БЛОК 5. Очистка и оптимизация интерфейса (UI/UX)

### 5.1 Удаление блока "AI-сводка"

**Текущее состояние:**

- Блок с ненужной информацией

**Требуемое поведение:**

- Удалить блок или заменить на критически важные метрики

**Реализация:**

```typescript
// Удалить или закомментировать блок AI-сводки в RightRail.tsx
// Было:
// <AISummary tasks={tasks} />

// Стало:
// (удалено)
```

### 5.2 Расширение блоков маркетинга

**Текущее состояние:**

- Карточки обрезают длинные названия

**Требуемое поведение:**

- Визуально расширить карточки
- Гармоничное отображение длинных тегов

**Реализация:**

```css
/* Добавить в globals.css */
.department-card-marketing {
  min-width: 280px;
  max-width: none;
}

.department-card-marketing .tags-container {
  flex-wrap: wrap;
  gap: 0.5rem;
}

.department-card-marketing .tag {
  white-space: normal;
  word-break: break-word;
}
```

**Компонент:**

```typescript
// src/components/ai-workflow/MarketingDepartment.tsx
export function MarketingDepartment({ department, tasks }: Props) {
  return (
    <div className="min-w-[280px] lg:min-w-[320px]">
      <DepartmentCard
        department={department}
        tasks={tasks}
        className="w-full"
      />
    </div>
  );
}
```

---

## ЧЕК-ЛИСТ ДЛЯ ПРОВЕРКИ РЕАЛИЗАЦИИ

### Блок 1: Демо-режим

- [ ] Убран нерабочий баннер демо-режима
- [ ] Добавлен индикатор живого соединения
- [ ] Тост-модалок при недоступности бэкенда
- [ ] Кнопка "Проверить бэкенд" работает
- [ ] Кнопка "Demo mode" переключает режим

### Блок 2: Orbit Commander

- [ ] Прогресс-бар отражает реальное выполнение
- [ ] Кнопки Pause/Cancel отправляют запросы
- [ ] Лента выполнения обновляется через WebSocket
- [ ] Элементы ленты кликабельны

### Блок 3: Роли и департаменты

- [ ] Цифры CEO динамические
- [ ] Задачи на подтверждении кликабельны
- [ ] Карточки департаментов кликабельны
- [ ] Открывается канaban-борд по клику
- [ ] Агенты показывают статус и текущую задачу
- [ ] Переключатель AI/Manual работает

### Блок 4: Мультишлюз

- [ ] AI Router маршрутизирует по моделям
- [ ] Системные промпты настроены
- [ ] Артефакты генерируются и сохраняются
- [ ] Поддержка .md, .xlsx, .pdf, .py, .tsx

### Блок 5: UI/UX

- [ ] Блок "AI-сводка" удален/оптимизирован
- [ ] Блоки маркетинга расширены
- [ ] Длинные тексты не обрезаются
- [ ] Визуальная harmonия в сетке

---

## API ENDPOINTS ДЛЯ РЕАЛИЗАЦИИ

### Backend (FastAPI)

```
GET  /api/health                    - Health check
GET  /api/ai-workflow/overview      - Dashboard data
POST /api/ai-workflow/tasks         - Create task
POST /api/ai-workflow/tasks/{id}/pause  - Pause task
POST /api/ai-workflow/tasks/{id}/resume - Resume task
POST /api/ai-workflow/tasks/{id}/cancel - Cancel task
WS   /ws/activity                   - Activity stream
```

### Frontend (React)

```
useBackendStatus()      - Hook для проверки бэкенда
useDemoMode()           - Hook для демо-режима
useWorkflowProgress()   - Hook для прогресса
useCEOStats()           - Hook для статистики CEO
useActivityStream()     - Hook для WebSocket ленты
```

---

## ПОРЯДОК РЕАЛИЗАЦИИ

### Фаза 1: Инфраструктура (1-2 дня)

1. Создать хуки для работы с бэкендом
2. Настроить WebSocket подключение
3. Реализовать health check

### Фаза 2: UI компоненты (2-3 дня)

1. Обновить CEO Node
2. Сделать карточки департаментов кликабельными
3. Добавить переключатели агентов

### Фаза 3: Интеграция (2-3 дня)

1. Подключить кнопки Pause/Cancel к API
2. Реализовать ленту активности
3. Настроить генерацию артефактов

### Фаза 4: AI Router (1-2 дня)

1. Создать маршрутизатор моделей
2. Настроить системные промпты
3. Протестировать генерацию

### Фаза 5: Полировка (1 день)

1. Убрать заглушки
2. Оптимизировать UI
3. Финальное тестирование

---

## ТЕХНИЧЕСКИЕ ТРЕБОВАНИЯ

### Стек технологий

- **Frontend:** React 19, TypeScript, Tailwind CSS, TanStack Router
- **Backend:** FastAPI, Python 3.12
- **База данных:** Supabase (PostgreSQL)
- **WebSocket:** Native WebSocket API
- **AI Models:** OpenAI, Anthropic, DeepSeek, YandexGPT, NVIDIA

### Производительность

- Time to Interactive: < 2s
- WebSocket latency: < 100ms
- API response time: < 500ms
- Bundle size: < 500KB

### Безопасность

- JWT аутентификация через Supabase
- RLS политики для всех таблиц
- Валидация входных данных
- Защита от XSS и CSRF
