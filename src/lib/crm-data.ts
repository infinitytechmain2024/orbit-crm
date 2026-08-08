export type TaskStatus = "inbox" | "todo" | "doing" | "done";
export type Priority = "low" | "med" | "high";

export type Task = {
  id: string;
  title: string;
  note?: string | null;
  status: TaskStatus;
  priority: Priority;
  projectId: string | null;
  due?: string;
  dueDate?: string;
  tags: string[];
};

export type TaskInput = Partial<Omit<Task, "id">> & { title: string };
export type TaskPatch = Partial<Omit<Task, "id">>;

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
  dateIso: string;
};

export type Organization = {
  id: string;
  name: string;
  slug: string;
};

export const STATUS_LABEL: Record<TaskStatus, string> = {
  inbox: "Входящие",
  todo: "К работе",
  doing: "В работе",
  done: "Готово",
};

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
