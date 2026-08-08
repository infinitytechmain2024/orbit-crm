import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { CalendarClock, Check, Clock, Send, User } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/book")({
  head: () => ({
    meta: [
      { title: "Запись на приём — Orbit CRM" },
      {
        name: "description",
        content: "Запишитесь на приём онлайн. Быстро, удобно, без звонков.",
      },
      { property: "og:title", content: "Запись на приём — Orbit CRM" },
      {
        property: "og:description",
        content: "Запишитесь на приём онлайн. Быстро, удобно, без звонков.",
      },
      { property: "og:image", content: "/og-image.png" },
    ],
  }),
  component: BookingPage,
});

const services = [
  { id: "massage", name: "Массаж", duration: "60 мин", price: "3 500 ₽" },
  { id: "facial", name: "Уход за лицом", duration: "45 мин", price: "2 800 ₽" },
  { id: "body", name: "Body-терапия", duration: "90 мин", price: "4 500 ₽" },
  { id: "consult", name: "Консультация", duration: "30 мин", price: "1 500 ₽" },
];

const timeSlots = ["09:00", "10:00", "11:00", "12:00", "14:00", "15:00", "16:00", "17:00", "18:00"];

function BookingPage() {
  const [step, setStep] = useState<"service" | "time" | "contact" | "done">("service");
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  const today = new Date();
  const dates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    return d;
  });

  const handleSubmit = () => {
    if (!selectedService || !selectedDate || !selectedTime || !name || !phone) return;
    setStep("done");
  };

  if (step === "done") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="max-w-md text-center">
          <div className="mx-auto grid size-16 place-items-center rounded-full bg-primary/15">
            <Check className="size-8 text-primary" />
          </div>
          <h1 className="mt-6 text-2xl font-semibold">Запись подтверждена!</h1>
          <p className="mt-2 text-muted-foreground">
            Мы ждём вас {selectedDate} в {selectedTime}. Отправим напоминание за час до визита.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold sm:text-3xl">Запись на приём</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Выберите услугу, дату и удобное время
          </p>
        </div>

        <div className="mb-8 flex items-center justify-center gap-2">
          {(["service", "time", "contact"] as const).map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div
                className={cn(
                  "grid size-7 place-items-center rounded-full text-xs font-semibold",
                  step === s || i < ["service", "time", "contact"].indexOf(step)
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {i + 1}
              </div>
              <span className="hidden text-xs text-muted-foreground sm:inline">
                {s === "service" ? "Услуга" : s === "time" ? "Время" : "Данные"}
              </span>
            </div>
          ))}
        </div>

        {step === "service" && (
          <div className="space-y-3">
            {services.map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  setSelectedService(s.id);
                  setStep("time");
                }}
                className={cn(
                  "flex w-full items-center gap-4 rounded-xl border p-4 text-left transition",
                  selectedService === s.id
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50",
                )}
              >
                <div className="grid size-10 place-items-center rounded-lg bg-primary/12 text-primary">
                  <CalendarClock className="size-5" />
                </div>
                <div className="flex-1">
                  <p className="font-medium">{s.name}</p>
                  <p className="text-xs text-muted-foreground">{s.duration}</p>
                </div>
                <span className="text-sm font-semibold">{s.price}</span>
              </button>
            ))}
          </div>
        )}

        {step === "time" && (
          <div className="space-y-6">
            <div>
              <p className="mb-3 text-sm font-medium">Выберите дату</p>
              <div className="flex gap-2 overflow-x-auto pb-2">
                {dates.map((d) => {
                  const val = d.toISOString().slice(0, 10);
                  const dayName = d.toLocaleDateString("ru-RU", { weekday: "short" });
                  const dayNum = d.getDate();
                  return (
                    <button
                      key={val}
                      onClick={() => setSelectedDate(val)}
                      className={cn(
                        "flex flex-col items-center rounded-xl border px-3 py-2 transition",
                        selectedDate === val
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/50",
                      )}
                    >
                      <span className="text-[11px] text-muted-foreground">{dayName}</span>
                      <span className="text-sm font-semibold">{dayNum}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {selectedDate && (
              <div>
                <p className="mb-3 text-sm font-medium">Выберите время</p>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                  {timeSlots.map((t) => (
                    <button
                      key={t}
                      onClick={() => setSelectedTime(t)}
                      className={cn(
                        "rounded-lg border px-3 py-2 text-sm transition",
                        selectedTime === t
                          ? "border-primary bg-primary/5 font-semibold"
                          : "border-border hover:border-primary/50",
                      )}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {selectedTime && (
              <button
                onClick={() => setStep("contact")}
                className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground"
              >
                Далее
              </button>
            )}
          </div>
        )}

        {step === "contact" && (
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Ваше имя</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Как к вам обращаться?"
                  className="w-full rounded-xl border border-border bg-surface-2/60 py-2.5 pl-10 pr-4 text-sm outline-none transition focus:border-primary/60"
                />
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Телефон</label>
              <div className="relative">
                <Clock className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+7 (___) ___-__-__"
                  className="w-full rounded-xl border border-border bg-surface-2/60 py-2.5 pl-10 pr-4 text-sm outline-none transition focus:border-primary/60"
                />
              </div>
            </div>

            <div className="rounded-xl border border-border bg-surface-2/40 p-4">
              <p className="text-xs text-muted-foreground">Ваша запись</p>
              <p className="mt-1 font-medium">
                {services.find((s) => s.id === selectedService)?.name}
              </p>
              <p className="text-sm text-muted-foreground">
                {selectedDate} в {selectedTime}
              </p>
            </div>

            <button
              onClick={handleSubmit}
              disabled={!name || !phone}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              <Send className="size-4" />
              Записаться
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
