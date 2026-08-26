from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate, Frame, PageTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, KeepTogether, ListFlowable, ListItem,
)
from reportlab.pdfgen.canvas import Canvas

OUT = "output/pdf/orbit-crm-technical-audit.pdf"

pdfmetrics.registerFont(TTFont("Arial", "/System/Library/Fonts/Supplemental/Arial.ttf"))
pdfmetrics.registerFont(TTFont("Arial-Bold", "/System/Library/Fonts/Supplemental/Arial Bold.ttf"))

NAVY = colors.HexColor("#12213A")
BLUE = colors.HexColor("#246BCE")
TEAL = colors.HexColor("#0F8B8D")
RED = colors.HexColor("#B42318")
AMBER = colors.HexColor("#B25E09")
GREEN = colors.HexColor("#16794A")
PALE = colors.HexColor("#F2F6FA")
GRID = colors.HexColor("#D7E0EA")
TEXT = colors.HexColor("#263445")
MUTED = colors.HexColor("#64748B")

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name="TitleRu", fontName="Arial-Bold", fontSize=25, leading=30, textColor=NAVY, alignment=TA_LEFT, spaceAfter=12))
styles.add(ParagraphStyle(name="SubtitleRu", fontName="Arial", fontSize=11, leading=16, textColor=MUTED, spaceAfter=18))
styles.add(ParagraphStyle(name="H1Ru", fontName="Arial-Bold", fontSize=16, leading=20, textColor=NAVY, spaceBefore=10, spaceAfter=8, keepWithNext=True))
styles.add(ParagraphStyle(name="H2Ru", fontName="Arial-Bold", fontSize=12, leading=15, textColor=BLUE, spaceBefore=8, spaceAfter=5, keepWithNext=True))
styles.add(ParagraphStyle(name="BodyRu", fontName="Arial", fontSize=9.2, leading=13.2, textColor=TEXT, spaceAfter=5))
styles.add(ParagraphStyle(name="SmallRu", fontName="Arial", fontSize=7.4, leading=9.5, textColor=TEXT))
styles.add(ParagraphStyle(name="TinyRu", fontName="Arial", fontSize=6.6, leading=8.1, textColor=TEXT))
styles.add(ParagraphStyle(name="TableHeadRu", fontName="Arial-Bold", fontSize=7.2, leading=9, textColor=colors.white, alignment=TA_LEFT))
styles.add(ParagraphStyle(name="CalloutRu", fontName="Arial-Bold", fontSize=10, leading=14, textColor=RED, leftIndent=8, rightIndent=8, spaceBefore=5, spaceAfter=5))
styles.add(ParagraphStyle(name="CodeRu", fontName="Courier", fontSize=7.5, leading=10, textColor=NAVY, backColor=PALE, borderPadding=6, spaceAfter=6))


def p(text, style="BodyRu"):
    return Paragraph(text, styles[style])


def bullets(items, level=0):
    return ListFlowable(
        [ListItem(p(x), leftIndent=11) for x in items],
        bulletType="bullet", start="circle", leftIndent=15 + level * 8,
        bulletFontName="Arial", bulletFontSize=6, bulletColor=BLUE, spaceAfter=5,
    )


def table(headers, rows, widths, font="SmallRu"):
    data = [[p(h, "TableHeadRu") for h in headers]]
    for row in rows:
        data.append([p(str(cell), font) for cell in row])
    t = Table(data, colWidths=widths, repeatRows=1, hAlign="LEFT")
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("GRID", (0, 0), (-1, -1), 0.35, GRID),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, PALE]),
    ]))
    return t


class AuditDoc(BaseDocTemplate):
    def __init__(self, filename):
        super().__init__(filename, pagesize=A4, rightMargin=14*mm, leftMargin=14*mm, topMargin=18*mm, bottomMargin=21*mm,
                         title="Orbit CRM - технический аудит готовности", author="Codex")
        frame = Frame(self.leftMargin, self.bottomMargin, self.width, self.height, id="main")
        self.addPageTemplates(PageTemplate(id="audit", frames=frame, onPageEnd=self.header_footer))

    def header_footer(self, canvas: Canvas, doc):
        canvas.saveState()
        w, h = A4
        canvas.setStrokeColor(GRID)
        canvas.setLineWidth(0.5)
        canvas.line(14*mm, h-11*mm, w-14*mm, h-11*mm)
        canvas.setFont("Arial", 7.5)
        canvas.setFillColor(MUTED)
        canvas.drawString(14*mm, h-8.5*mm, "ORBIT CRM / OPENCLAW - ТЕХНИЧЕСКИЙ АУДИТ")
        canvas.drawString(14*mm, 8.5*mm, f"Страница {doc.page}")
        canvas.restoreState()


story = []
story += [Spacer(1, 18*mm), p("Orbit CRM и OpenClaw", "TitleRu"), p("Технический аудит фактической готовности и инструкция по ручной настройке Vercel / Render", "SubtitleRu")]
summary = Table([
    [p("РЕШЕНИЕ", "TableHeadRu"), p("ФАКТИЧЕСКИЙ СТАТУС", "TableHeadRu")],
    [p("Orbit CRM", "SmallRu"), p("Частично готова. Основные проекты и задачи существуют, но строгая проверка типов не проходит.", "SmallRu")],
    [p("OpenClaw", "SmallRu"), p("Не готов. Runtime на Render и сквозное выполнение не подтверждены.", "SmallRu")],
    [p("Production", "SmallRu"), p("NOT READY. Основной домен и production deployment переключать нельзя.", "SmallRu")],
], colWidths=[45*mm, 122*mm])
summary.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,0),NAVY),("GRID",(0,0),(-1,-1),0.5,GRID),("VALIGN",(0,0),(-1,-1),"TOP"),("LEFTPADDING",(0,0),(-1,-1),6),("RIGHTPADDING",(0,0),(-1,-1),6),("TOPPADDING",(0,0),(-1,-1),6),("BOTTOMPADDING",(0,0),(-1,-1),6),("ROWBACKGROUNDS",(0,1),(-1,-1),[colors.white,PALE])]))
story += [summary, Spacer(1, 8*mm), p("Дата проверки: 25 августа 2026", "BodyRu"), p("Основание: код репозитория, локальные тесты, Vercel CLI, публичные deployment probes, Supabase MCP и фактическая production-схема.", "BodyRu"), PageBreak()]

story += [p("1. Краткий вывод", "H1Ru"), p("Orbit CRM имеет рабочую основу: Supabase Auth, основную CRM-схему, проекты, задачи, закрытое файловое хранилище, календарную очередь, RLS и Vercel Preview.")]
story += [p("Система не готова к полноценному production-запуску", "CalloutRu")]
story += [bullets([
    "строгая TypeScript-проверка завершается большим количеством ошибок;",
    "production Vercel не подключён к FastAPI backend;",
    "фактический Render-деплой не подтверждён;",
    "OpenClaw end-to-end (сквозной сценарий) не работает;",
    "в Supabase отсутствуют ai_tasks, workflow_runs и workflow_jobs;",
    "память, база знаний и саморазвитие реализованы, но таблицы пусты;",
    "клиенты, сделки, календарь и коммуникации не прошли сквозную проверку.",
])]

story += [p("2. Статус этапов", "H1Ru")]
stage_rows = [
    ("1. Запуск", "Установка, Vite/Nitro build, Auth, backend tests", "Частично", "Исправить TypeScript errors"),
    ("2. Core CRM", "Проекты, задачи, клиенты, финансы, файлы", "Частично проверено", "Проверить CRUD клиентов/сделок"),
    ("3. Gateway", "Dockerfile, entrypoint, private service config", "Не проверено после deploy", "Подтвердить Render health"),
    ("4. Интеграция", "FastAPI client, proxy, токены, webhooks", "Не работает после deploy", "Исправить backend URL"),
    ("5. Entities", "Контекст клиентов, задач, календаря", "Частично", "Deal assistance не завершён"),
    ("6. Календарь", "События, очередь, pg_cron", "Схема работает", "Проверить реальную доставку"),
    ("7. Email", "AgentMail routes, webhook, audit", "Требует настройки", "Добавить AgentMail env"),
    ("8. Память", "Memory, knowledge, versions", "Подключено, но пусто", "Провести реальный сценарий"),
    ("9. Self-improvement", "Outcomes, proposals, approval, rollback", "Не проверено", "Нет outcomes/proposals"),
    ("10. Security", "RLS, RBAC, audit, webhook security", "Частично готово", "Leaked-password protection"),
    ("11. Infra", "Preview, Blueprint, rollback docs", "Ручная настройка", "Render и production env"),
    ("12. Readiness", "CI config, schema gate, formal report", "NOT READY", "Закрыть P0"),
]
story += [table(["Этап", "Реализовано", "Статус", "Осталось"], stage_rows, [27*mm, 67*mm, 34*mm, 39*mm], "TinyRu"), PageBreak()]

story += [p("3. Готовность Orbit CRM", "H1Ru")]
crm_rows = [
    ("Зависимости", "Да", "Да", "Нет блокера"), ("Vite/Nitro build", "Да", "Да", "Preview работает"),
    ("Type check", "Нет", "Проверен", "tsc возвращает ошибки"), ("Авторизация", "Да", "Частично", "Нет полного login journey"),
    ("База данных", "Да", "Да", "Migration drift"), ("Проекты", "Да", "15 записей", "Работают на уровне данных"),
    ("Задачи", "Да", "14 записей", "Работают на уровне данных"), ("Клиенты", "Да", "0 записей", "CRUD после deploy не проверен"),
    ("Лиды", "Частично", "Нет", "leads отсутствует, есть lead_clients"), ("Сделки", "Таблица", "0 записей", "Нет полного UI journey"),
    ("Календарь", "Да", "0 событий", "Доставка не проверена"), ("Напоминания", "Да", "Cron активен", "0 доставок"),
    ("Email", "Да", "Нет", "Не хватает AgentMail env"), ("Файлы", "Да", "RLS проверен", "UI upload не проверен"),
    ("Финансы", "Да", "0 операций", "Нет сквозного теста"), ("Права", "Да", "RLS partial", "Нужны 2 реальные учётные записи"),
]
story += [table(["Функция", "Реализована", "Проверка", "Что мешает"], crm_rows, [38*mm, 34*mm, 34*mm, 61*mm], "TinyRu")]
story += [Spacer(1,4*mm), p("Без OpenClaw должны работать: авторизация, проекты, задачи, клиенты, файлы, календарь, финансы и базовые CRM-данные.")]
story += [p("Риск потери данных", "H2Ru"), p("Основные данные находятся в Supabase, а Storage закрыт RLS. Прямых признаков потери данных нет, но политика backup/PITR не подтверждена владельцем.")]

story += [p("4. Готовность OpenClaw", "H1Ru")]
oc_rows = [
    ("CRM отправляет запрос", "Код готов", "Исправить Render backend URL"),
    ("OpenClaw отвечает", "Не проверено", "Запустить private service и модель"),
    ("Ответ в CRM", "UI существует", "Нужен реальный ответ"),
    ("Контекст клиента", "Код готов", "Создать клиента и протестировать"),
    ("Следующее действие", "Код готов", "Проверить next_action"),
    ("Черновик сообщения", "Код готов", "Проверить draft_message"),
    ("Human approval", "Реализовано", "Проверить после deploy"),
    ("История", "Таблицы/API", "Нет реальных записей"),
    ("Graceful failure", "Подтверждено", "CRM возвращает 502/503 без падения"),
]
story += [table(["Сценарий", "Статус", "Что требуется"], oc_rows, [59*mm, 43*mm, 65*mm])]
story += [Spacer(1,5*mm), p("OpenClaw расположен в services/openclaw. Подтверждённая команда контейнера:", "BodyRu"), p("node openclaw.mjs gateway --bind lan", "CodeRu"), p("OpenClaw должен работать как Render private service. Он не должен иметь публичный URL: связь выполняется через private network Render.")]

story += [p("5. Память и контролируемое саморазвитие", "H1Ru")]
story += [bullets(["ai_user_memory и revisions;", "company_knowledge и versions;", "ai_outcomes;", "ai_improvement_proposals;", "журнал решений;", "approve/reject;", "rollback новой версией;", "RLS/RBAC;", "интерфейсы /memory и /self-development."])]
story += [p("Фактическое состояние", "H2Ru"), table(["Механизм", "Записей"], [("Память", "0"),("База знаний", "0"),("Outcomes", "0"),("Proposals", "0"),("AI audit", "0")], [85*mm,35*mm])]
story += [p("Вывод: механизм существует технически, но фактически не обучается на реальных данных. Самостоятельного изменения кода или значимых правил без человека нет.", "CalloutRu"), PageBreak()]

story += [p("6. Критические ошибки и ограничения", "H1Ru")]
story += [bullets([
    "npx tsc --noEmit не проходит;",
    "в Supabase отсутствуют ai_tasks, workflow_runs и workflow_jobs;",
    "production Vercel: главная 200, backend health 503, OpenClaw health 404;",
    "AI_WORKFLOW_BACKEND_URL неверен либо не применён к production deployment;",
    "OpenClaw end-to-end не подтверждён;",
    "Render services не подтверждены через аккаунт;",
    "Leaked-password protection отключена;",
    "alerts и backup/PITR не подтверждены.",
])]
story += [p("7. Карта размещения", "H1Ru")]
place_rows = [
    ("TanStack frontend", "Vercel", "Да", "Не продвигать новый production"),
    ("Server routes", "Vercel", "Preview", "Исправить env"),
    ("Auth/Postgres/Storage", "Supabase", "Да", "Repair migration"),
    ("FastAPI", "Render web service", "Не подтверждено", "Создать/проверить"),
    ("OpenClaw", "Render private service", "Не подтверждено", "Создать/проверить"),
    ("OpenClaw state", "Persistent disk", "Только config", "Подтвердить 1 GB"),
    ("Workflow worker", "Внутри FastAPI", "Код есть", "Не масштабировать"),
    ("Calendar Cron", "Supabase pg_cron", "Да", "Render Cron не нужен"),
    ("Email", "Vercel + AgentMail", "Частично", "Добавить env"),
]
story += [table(["Компонент", "Платформа", "Факт", "Действие"], place_rows, [42*mm, 44*mm, 34*mm, 47*mm], "TinyRu")]

story += [p("8. API и внешние сервисы", "H1Ru")]
api_rows = [
    ("Supabase", "БД/Auth/Storage", "Обязателен", "Подключён", "Repair + Auth security"),
    ("FastAPI internal", "AI workflow", "Для AI", "Не работает после deploy", "Render URL"),
    ("NVIDIA", "Основная модель", "Для OpenClaw", "Runtime не проверен", "Проверить ключ"),
    ("AgentMail", "Email", "Нет", "Частично", "Inbox + webhook"),
    ("Groq", "Whisper/fallback", "Нет", "Не подтверждён", "Позже"),
    ("OpenAI", "Fallback", "Нет", "Нет", "Позже"),
    ("Gmail/Google Calendar", "Внешние интеграции", "Нет", "Не реализованы", "Не подключать"),
    ("Monitoring", "Alerts", "P1", "Нет", "Настроить"),
]
story += [table(["API", "Назначение", "Нужен", "Статус", "Действие"], api_rows, [32*mm, 42*mm, 27*mm, 36*mm, 30*mm], "TinyRu"), PageBreak()]

story += [p("9. Переменные Vercel", "H1Ru")]
vercel_req = [
    ("VITE_SUPABASE_URL", "Публичный Supabase URL", "Supabase Connect/API", "Production + Preview"),
    ("VITE_SUPABASE_PUBLISHABLE_KEY", "Публичный browser key", "Supabase API Keys", "Production + Preview"),
    ("SUPABASE_URL", "Server session validation", "Тот же Supabase URL", "Production + Preview"),
    ("SUPABASE_PUBLISHABLE_KEY", "Server JWT validation", "Supabase API Keys", "Production + Preview"),
    ("AI_WORKFLOW_BACKEND_URL", "Публичный FastAPI URL", "Render backend", "Production + Preview"),
    ("INTERNAL_API_TOKEN", "Vercel - FastAPI auth", "Случайный секрет", "Должен совпадать с Render"),
]
story += [p("Обязательные", "H2Ru"), table(["Название", "Назначение", "Источник", "Среды/совпадение"], vercel_req, [48*mm, 45*mm, 37*mm, 37*mm], "TinyRu")]
vercel_opt = [
    ("AGENTMAIL_API_KEY", "Email API", "Только email"), ("AGENTMAIL_INBOX", "Inbox", "Только email"),
    ("AGENTMAIL_WEBHOOK_SECRET", "Webhook signature", "Только email"), ("AGENTMAIL_ORGANIZATION_ID", "Organization mapping", "Только email"),
    ("SUPABASE_SERVICE_ROLE_KEY", "Privileged mail webhook", "Только AgentMail route"),
    ("NVIDIA_API_KEY / MODEL", "Vercel AI routes", "Необязательно"), ("GROQ_API_KEY", "Whisper/fallback", "Необязательно"),
    ("OPENAI_API_KEY / MODEL", "Fallback", "Необязательно"), ("VITE_LEAD_GEN_URL", "Lead generator", "Необязательно"),
]
story += [p("Для отдельных функций", "H2Ru"), table(["Название", "Назначение", "Обязательность"], vercel_opt, [66*mm, 61*mm, 40*mm], "TinyRu")]
story += [p("Вероятно устаревшие на Vercel", "H2Ru"), bullets(["OPENCLAW_URL", "OPENCLAW_INTERNAL_TOKEN", "OPENCLAW_GATEWAY_TOKEN", "CRM_WEBHOOK_URL"]), p("DATABASE_URL и Google OAuth Client ID/Secret текущему Orbit CRM не требуются. Существующий AGENTMAIL_API_KEY следует хранить как Sensitive secret.")]

story += [p("10. Переменные Render backend", "H1Ru")]
render_backend = [
    ("PYTHON_VERSION", "Runtime", "Да", "Нет"), ("SUPABASE_URL", "Supabase API", "Да", "Да"),
    ("SUPABASE_SERVICE_ROLE_KEY", "Privileged server access", "Да", "Нет"), ("SUPABASE_PUBLISHABLE_KEY", "JWT validation", "Да", "Да"),
    ("EXPECTED_SUPABASE_PROJECT_REF", "Project guard", "Да", "Нет"), ("INTERNAL_API_TOKEN", "Vercel auth", "Да", "Да"),
    ("OPENCLAW_URL", "Private gateway URL", "Да", "Нет"), ("OPENCLAW_GATEWAY_TOKEN", "Gateway auth", "Да", "Нет"),
    ("OPENCLAW_WEBHOOK_TOKEN", "Callback auth", "Да", "Нет"), ("NVIDIA_API_KEY", "AI provider", "Для AI", "Не обязан"),
    ("OPENCLAW_DAILY_ACTION_LIMIT", "Расходный лимит", "Рекомендуется", "Нет"), ("CORS_ORIGINS", "Allowed origins", "Условно", "Нет"),
]
story += [table(["Название", "Назначение", "Обязательная", "Совпадает с Vercel"], render_backend, [48*mm, 55*mm, 30*mm, 34*mm], "TinyRu")]
story += [p("Render OpenClaw", "H2Ru")]
story += [bullets(["HOME / OPENCLAW_HOME", "OPENCLAW_STATE_DIR / CONFIG_PATH / WORKSPACE_DIR", "OPENCLAW_GATEWAY_TOKEN", "PORT / GATEWAY_PORT / GATEWAY_BIND", "OPENCLAW_DISABLE_BONJOUR", "NVIDIA_API_KEY", "OPENCLAW_DEFAULT_MODEL"])]
story += [p("Отдельные переменные памяти, knowledge base и очереди не нужны: состояние CRM хранится в Supabase.")]

story += [PageBreak(), p("11. Ручная инструкция для Vercel", "H1Ru")]
vercel_steps = [
    "Открыть Vercel, выбрать team infinitytechmain2024s-projects и проект aura-crm.",
    "Открыть Settings - Environment Variables.",
    "Для Production и Preview проверить шесть обязательных переменных из раздела 9.",
    "В AI_WORKFLOW_BACKEND_URL указать публичный URL orbit-crm-backend без суффикса /api.",
    "Убедиться, что INTERNAL_API_TOKEN совпадает с Render backend.",
    "Для email добавить четыре AGENTMAIL_* переменные; API key хранить как Sensitive.",
    "В Build and Deployment проверить Root Directory = корень, npm ci, npm run build, без Output Directory override, Node 24.x.",
    "В Git проверить репозиторий aura-crm и production branch main.",
    "Не переключать домен и не выполнять production promotion.",
    "После env changes выполнить Preview Redeploy.",
    "Проверить login, /api/backend/api/health, /api/openclaw/health и Runtime Logs.",
]
story += [ListFlowable([ListItem(p(x), value=i+1, leftIndent=15) for i,x in enumerate(vercel_steps)], bulletType="1", leftIndent=20, bulletFontName="Arial-Bold", bulletFontSize=8, spaceAfter=8)]
story += [p("OAuth callback в Vercel сейчас не требуется. В Supabase Auth URL Configuration нужно добавить production и используемый Preview URL.")]

story += [p("12. Ручная инструкция для Render", "H1Ru")]
render_steps = [
    "Проверить сервисы orbit-crm-backend и orbit-openclaw-private.",
    "Если их нет: New - Blueprint, репозиторий aura-crm, branch main, корневой render.yaml.",
    "Backend build: pip install -r backend/requirements.txt.",
    "Backend start: uvicorn backend.main:app --host 0.0.0.0 --port $PORT.",
    "Health check: /api/health.",
    "OpenClaw: Docker context ./services/openclaw, постоянный диск /home/node/.openclaw, 1 GB.",
    "Заполнить sync:false secrets: NVIDIA, Supabase, internal token и webhook token.",
    "Убедиться, что OPENCLAW_URL и GATEWAY_TOKEN поступают из private service.",
    "Выполнить deploy и проверить Events/Logs.",
    "GET /api/health публичного backend должен вернуть 200.",
    "Скопировать публичный backend URL в Vercel.",
    "Проверять private OpenClaw через авторизованный /api/openclaw/health.",
    "Не создавать отдельные Render Cron и Redis. Не масштабировать backend до исправления очереди.",
]
story += [ListFlowable([ListItem(p(x), value=i+1, leftIndent=15) for i,x in enumerate(render_steps)], bulletType="1", leftIndent=20, bulletFontName="Arial-Bold", bulletFontSize=8, spaceAfter=8)]

story += [p("13. Внешние сервисы", "H1Ru")]
story += [p("Supabase", "H2Ru"), bullets([
    "не применять старую Orbit Commander migration целиком;",
    "подготовить repair migration для ai_tasks, workflow_runs и workflow_jobs;",
    "включить Leaked Password Protection;",
    "добавить production/Preview URLs в Authentication - URL Configuration;",
    "проверить Backups/PITR;",
    "выполнить read-only schema gate после repair migration.",
])]
story += [KeepTogether([
    p("AgentMail - только если нужен email", "H2Ru"),
    bullets(["создать inbox;", "получить API key;", "создать webhook https://ваш-домен/api/mail/webhook;", "сохранить webhook secret;", "связать inbox с UUID организации."])
])]

story += [p("14. Итоговый ручной чек-лист", "H1Ru")]
check_rows = [
    ("VERCEL", "[ ] Исправить AI_WORKFLOW_BACKEND_URL\n[ ] Сверить INTERNAL_API_TOKEN\n[ ] Добавить server-side Supabase vars\n[ ] Preview redeploy\n[ ] Проверить Runtime Logs"),
    ("RENDER", "[ ] Проверить два сервиса\n[ ] Применить render.yaml при отсутствии\n[ ] Заполнить sync:false secrets\n[ ] Проверить диск OpenClaw\n[ ] Проверить /api/health"),
    ("SUPABASE / API", "[ ] Repair migration\n[ ] Leaked-password protection\n[ ] Backups/PITR\n[ ] AgentMail при необходимости\n[ ] Alerts 5xx/401/403/queue"),
]
story += [table(["Зона", "Действия"], check_rows, [42*mm, 125*mm])]

story += [p("15. Условия допуска к production", "H1Ru")]
story += [bullets(["исправить TypeScript errors;", "восстановить отсутствующие AI workflow tables;", "подтвердить OpenClaw health;", "выполнить реальную задачу OpenClaw;", "пройти полный авторизованный CRM journey;", "проверить rollback, backups и monitoring."])]
story += [p("До выполнения всех условий новый Preview нельзя продвигать в production и нельзя переключать основной домен.", "CalloutRu")]

story += [PageBreak(), p("Управленческое решение", "H1Ru")]
decision_rows = [
    ("Что уже сделано", "Supabase/Auth/RLS/Storage, проекты, задачи, CRM repositories, calendar queue, protected proxy, OpenClaw client, memory/knowledge/approval/audit, Vercel Preview и Render Blueprint."),
    ("Готовность Orbit CRM", "Частично готова: core data работает, но type check и сквозные CRM-сценарии не завершены."),
    ("Готовность OpenClaw", "Не готов: Render runtime не подтверждён, proxy не подключён, workflow tables отсутствуют."),
    ("Саморазвитие", "Частично: механизм существует, но memory/outcomes/knowledge/proposals пусты."),
    ("Добавить на Vercel", "SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, правильный AI_WORKFLOW_BACKEND_URL; проверить VITE_SUPABASE_*, INTERNAL_API_TOKEN и AgentMail vars."),
    ("Добавить на Render", "Supabase URL/service role/publishable key, INTERNAL_API_TOKEN, NVIDIA_API_KEY, OPENCLAW_WEBHOOK_TOKEN; OpenClaw NVIDIA key."),
    ("Внешние API", "Обязательные: Supabase и NVIDIA/OpenClaw. Условные: AgentMail и Groq. Google APIs для первого запуска не нужны."),
    ("Первое действие", "Открыть Render и подтвердить успешный deploy orbit-crm-backend и orbit-openclaw-private."),
    ("Второе действие", "Указать публичный FastAPI URL в Vercel и сверить INTERNAL_API_TOKEN."),
    ("Третье действие", "Выполнить Preview redeploy и проверить backend/OpenClaw health."),
    ("Можно ли запускать", "Нет. Только после repair migration, исправления TypeScript, реального OpenClaw task и полного CRM journey."),
]
story += [table(["Решение", "Заключение"], decision_rows, [46*mm, 121*mm], "SmallRu")]
story += [Spacer(1,6*mm), p("Источники проверки", "H2Ru"), bullets([
    "репозиторий Orbit CRM и конфигурации vercel.json / render.yaml;",
    "Vercel CLI и публичные HTTP probes;",
    "Supabase MCP: production schema, counts, buckets, cron, advisors;",
    "локальные npm build, lint, Playwright, backend tests и TypeScript check;",
    "официальная документация Vercel и Render.",
])]

doc = AuditDoc(OUT)
doc.build(story)
print(OUT)
