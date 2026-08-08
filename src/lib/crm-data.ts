export type TaskStatus = "inbox" | "todo" | "doing" | "done";
export type Priority = "low" | "med" | "high";

export type Task = {
  id: string;
  title: string;
  note?: string;
  status: TaskStatus;
  priority: Priority;
  projectId: string;
  due?: string;
  tags: string[];
};

export type Project = {
  id: string;
  name: string;
  color: string;
  x: number;
  y: number;
  links: string[];
};

export type Email = {
  id: string;
  from: string;
  subject: string;
  preview: string;
  body: string;
  date: string;
  unread: boolean;
};

export type Tx = {
  id: string;
  label: string;
  amount: number;
  type: "income" | "expense";
  category: string;
  date: string;
};

export const STATUS_LABEL: Record<TaskStatus, string> = {
  inbox: "Входящие",
  todo: "К работе",
  doing: "В работе",
  done: "Готово",
};

export const projects: Project[] = [
  { id: "p1", name: "Личная CRM", color: "var(--acc-1)", x: 50, y: 28, links: ["p2", "p3"] },
  { id: "p2", name: "Клиент: Nordwind", color: "var(--acc-2)", x: 18, y: 62, links: ["p4"] },
  { id: "p3", name: "Контент и бренд", color: "var(--acc-3)", x: 82, y: 60, links: ["p4"] },
  { id: "p4", name: "Финансы 2026", color: "var(--acc-4)", x: 50, y: 86, links: [] },
];

export const initialTasks: Task[] = [
  { id: "t1", title: "Собрать требования по интеграции почты", status: "doing", priority: "high", projectId: "p1", due: "12 авг", tags: ["ИИ", "почта"], note: "Нужны IMAP и webhook-сценарии." },
  { id: "t2", title: "Дизайн-ревью канбан-доски", status: "todo", priority: "med", projectId: "p1", due: "14 авг", tags: ["UI"] },
  { id: "t3", title: "Счёт для Nordwind за июль", status: "todo", priority: "high", projectId: "p2", due: "10 авг", tags: ["деньги"] },
  { id: "t4", title: "Сценарий видео про рабочие процессы", status: "inbox", priority: "low", projectId: "p3", tags: ["контент"] },
  { id: "t5", title: "Сверка расходов за квартал", status: "done", priority: "med", projectId: "p4", tags: ["отчёт"] },
  { id: "t6", title: "Прототип карты связей проектов", status: "doing", priority: "med", projectId: "p1", due: "16 авг", tags: ["граф"] },
  { id: "t7", title: "Ответить по договору подряда", status: "inbox", priority: "high", projectId: "p2", tags: ["юр"] },
];

export const initialEmails: Email[] = [
  {
    id: "e1",
    from: "anna@nordwind.co",
    subject: "Правки по договору и сроки",
    preview: "Привет! Посмотрели смету, есть два пункта…",
    body: "Привет!\n\nПосмотрели смету, есть два пункта по срокам: перенос этапа интеграции на 20 августа и фиксация стоимости поддержки.\n\nСможешь прислать обновлённый вариант до пятницы?\n\nАнна",
    date: "09:12",
    unread: true,
  },
  {
    id: "e2",
    from: "billing@stripe.com",
    subject: "Выплата 2 480 € отправлена",
    preview: "Ваша выплата в размере 2 480 € отправлена…",
    body: "Выплата 2 480 € отправлена на счёт ****4021. Ожидаемое зачисление — 2 рабочих дня.",
    date: "Вчера",
    unread: true,
  },
  {
    id: "e3",
    from: "team@figma.com",
    subject: "Комментарии в файле CRM / Dashboard",
    preview: "3 новых комментария ждут ответа…",
    body: "3 новых комментария в файле «CRM / Dashboard»: сетка виджетов, контраст тёмной темы, состояние загрузки.",
    date: "Пн",
    unread: false,
  },
  {
    id: "e4",
    from: "hello@indiehackers.dev",
    subject: "Приглашение выступить с докладом",
    preview: "Хотим позвать вас на онлайн-митап…",
    body: "Хотим позвать вас на онлайн-митап 5 сентября с докладом про личные системы продуктивности. 30 минут + Q&A.",
    date: "Пн",
    unread: false,
  },
];

export const initialTx: Tx[] = [
  { id: "x1", label: "Nordwind — этап 2", amount: 3200, type: "income", category: "Услуги", date: "01 авг" },
  { id: "x2", label: "Подписки и софт", amount: 240, type: "expense", category: "Софт", date: "02 авг" },
  { id: "x3", label: "Консультация", amount: 700, type: "income", category: "Услуги", date: "04 авг" },
  { id: "x4", label: "Аренда студии", amount: 560, type: "expense", category: "Офис", date: "05 авг" },
  { id: "x5", label: "Реклама", amount: 320, type: "expense", category: "Маркетинг", date: "06 авг" },
  { id: "x6", label: "Продажа шаблона", amount: 480, type: "income", category: "Продукты", date: "07 авг" },
];

export const monthly = [
  { m: "Мар", income: 4200, expense: 2100 },
  { m: "Апр", income: 5100, expense: 2400 },
  { m: "Май", income: 4700, expense: 1900 },
  { m: "Июн", income: 6300, expense: 2800 },
  { m: "Июл", income: 5900, expense: 2200 },
  { m: "Авг", income: 4380, expense: 1120 },
];
