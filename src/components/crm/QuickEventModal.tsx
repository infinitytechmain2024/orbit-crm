"use client";

import { useState, useEffect } from "react";
import { User, Bell, Calendar, Clock } from "lucide-react";
import { useCrm } from "@/lib/crm-store";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createCalendarEvent, type CalendarEventInput } from "@/lib/calendar-repository";

interface QuickEventModalProps {
  open: boolean;
  onClose: () => void;
  initialDate: string;
  initialHour?: number;
  onSaved: () => void;
}

const STATUS_OPTIONS = [
  { value: "new", label: "Новая" },
  { value: "pending", label: "Ожидает" },
  { value: "confirmed", label: "Подтверждена" },
  { value: "completed", label: "Завершена" },
  { value: "cancelled", label: "Отменена" },
] as const;

export function QuickEventModal({
  open,
  onClose,
  initialDate,
  initialHour = 9,
  onSaved,
}: QuickEventModalProps) {
  const { organization } = useCrm();
  const [title, setTitle] = useState("");
  const [clientName, setClientName] = useState("");
  const [status, setStatus] = useState<"new" | "pending" | "confirmed" | "completed" | "cancelled">(
    "new",
  );
  const [startDate, setStartDate] = useState(initialDate);
  const [endDate, setEndDate] = useState(initialDate);
  const [startTime, setStartTime] = useState(`${String(initialHour).padStart(2, "0")}:00`);
  const [endTime, setEndTime] = useState(`${String(initialHour + 1).padStart(2, "0")}:00`);
  const [notes, setNotes] = useState("");
  const [reminder, setReminder] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTitle("");
      setClientName("");
      setStatus("new");
      setStartDate(initialDate);
      setEndDate(initialDate);
      setStartTime(`${String(initialHour).padStart(2, "0")}:00`);
      setEndTime(`${String(initialHour + 1).padStart(2, "0")}:00`);
      setNotes("");
      setReminder(false);
      setError(null);
    }
  }, [open, initialDate, initialHour]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !clientName.trim()) {
      setError("Название и клиент обязательны");
      return;
    }
    if (!organization) {
      setError("Организация не найдена");
      return;
    }

    const startsAt = new Date(`${startDate}T${startTime}:00`);
    const endsAt = new Date(`${endDate}T${endTime}:00`);
    const reminderAt = reminder ? new Date(startsAt.getTime() - 30 * 60_000).toISOString() : null;

    const eventInput: CalendarEventInput = {
      organization_id: organization.id,
      title: title.trim(),
      client_name: clientName.trim(),
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      status,
      reminder_at: reminderAt,
      notes: notes.trim() || null,
    };

    try {
      await createCalendarEvent(eventInput);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось создать запись");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Новая запись</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="title">
              Название <span className="text-destructive">*</span>
            </Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Например: Встреча с клиентом"
              className="text-base"
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="clientName">
              Клиент <span className="text-destructive">*</span>
            </Label>
            <Input
              id="clientName"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="Имя клиента или компании"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="status">Статус</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger id="status">
                <SelectValue placeholder="Статус" />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="startDate">Дата начала</Label>
              <Input
                id="startDate"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="endDate">Дата окончания</Label>
              <Input
                id="endDate"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="startTime">Время начала</Label>
              <Input
                id="startTime"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="endTime">Время окончания</Label>
              <Input
                id="endTime"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Заметки</Label>
            <Input
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Дополнительная информация..."
            />
          </div>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={reminder}
              onChange={(e) => setReminder(e.target.checked)}
              className="size-4 accent-primary"
            />
            <span className="text-sm">Напомнить за 30 минут</span>
          </label>

          <DialogFooter className="flex-row gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Отмена
            </Button>
            <Button type="submit" disabled={!title.trim() || !clientName.trim()}>
              Создать
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
