"use client";

import { useState, useEffect } from "react";
import { X, Clock, Calendar, User, Flag, FolderKanban } from "lucide-react";
import { useCrm } from "@/lib/crm-store";
import {
  PRIORITY_LABEL,
  STATUS_LABEL,
  TASK_STATUSES,
  TASK_PRIORITIES,
  type Priority,
  type TaskStatus,
  type Project,
  type OrganizationMember,
  type TaskInput,
} from "@/lib/crm-data";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface QuickTaskModalProps {
  open: boolean;
  onClose: () => void;
  initialDate: string;
  initialHour?: number;
  onSaved: (task: TaskInput) => void;
}

export function QuickTaskModal({ open, onClose, initialDate, initialHour = 9, onSaved }: QuickTaskModalProps) {
  const { projects, members, addTask, isMutating } = useCrm();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<TaskStatus>("backlog");
  const [priority, setPriority] = useState<Priority>("med");
  const [projectId, setProjectId] = useState<string>("");
  const [assigneeId, setAssigneeId] = useState<string>("");
  const [startDate, setStartDate] = useState(initialDate);
  const [dueDate, setDueDate] = useState(initialDate);
  const [startTime, setStartTime] = useState(`${String(initialHour).padStart(2, "0")}:00`);
  const [endTime, setEndTime] = useState(`${String(initialHour + 1).padStart(2, "0")}:00`);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTitle("");
      setDescription("");
      setStatus("backlog");
      setPriority("med");
      setProjectId("");
      setAssigneeId("");
      setStartDate(initialDate);
      setDueDate(initialDate);
      setStartTime(`${String(initialHour).padStart(2, "0")}:00`);
      setEndTime(`${String(initialHour + 1).padStart(2, "0")}:00`);
      setError(null);
    }
  }, [open, initialDate, initialHour]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError("Название задачи обязательно");
      return;
    }

    const taskInput: TaskInput = {
      title: title.trim(),
      description: description.trim() || null,
      status,
      priority,
      projectId: projectId || null,
      assigneeId: assigneeId || null,
      startDate: startDate || null,
      dueDate: dueDate || null,
      estimatedMinutes: calculateDurationMinutes(startTime, endTime),
    };

    try {
      const createdTask = await addTask(taskInput);
      if (createdTask) {
        onSaved(createdTask);
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось создать задачу");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>Новая задача</span>
            <button
              onClick={onClose}
              className="rounded-sm p-1 hover:bg-accent transition"
              aria-label="Закрыть"
            >
              <X className="h-4 w-4" />
            </button>
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="title">Название <span className="text-destructive">*</span></Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Например: Звонок клиенту"
              className="text-base"
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Описание</Label>
            <Input
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Детали задачи..."
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="status">Статус</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger id="status">
                  <SelectValue placeholder="Статус" />
                </SelectTrigger>
                <SelectContent>
                  {TASK_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="priority">Приоритет</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger id="priority">
                  <SelectValue placeholder="Приоритет" />
                </SelectTrigger>
                <SelectContent>
                  {TASK_PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {PRIORITY_LABEL[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="project">Проект</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger id="project">
                  <SelectValue placeholder="Выберите проект" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Без проекта</SelectItem>
                  {projects.filter((p) => !p.archivedAt).map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="assignee">Исполнитель</Label>
              <Select value={assigneeId} onValueChange={setAssigneeId}>
                <SelectTrigger id="assignee">
                  <SelectValue placeholder="Назначьте" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Не назначен</SelectItem>
                  {members.map((member) => (
                    <SelectItem key={member.userId} value={member.userId}>
                      {member.fullName || member.email || member.userId.slice(0, 8)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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
              <Label htmlFor="dueDate">Срок</Label>
              <Input
                id="dueDate"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
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

          <DialogFooter className="flex-row gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={isMutating}>
              Отмена
            </Button>
            <Button type="submit" disabled={isMutating || !title.trim()}>
              Создать
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function calculateDurationMinutes(start: string, end: string): number {
  const [startH, startM] = start.split(":").map(Number);
  const [endH, endM] = end.split(":").map(Number);
  const startTotal = startH * 60 + startM;
  const endTotal = endH * 60 + endM;
  return Math.max(15, endTotal - startTotal);
}