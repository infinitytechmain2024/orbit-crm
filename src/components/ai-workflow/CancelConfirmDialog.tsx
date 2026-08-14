/**
 * Cancel Confirmation Dialog
 * Shows confirmation modal before cancelling a workflow
 */

import { AlertTriangle } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface CancelConfirmDialogProps {
  open: boolean;
  taskTitle?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function CancelConfirmDialog({
  open,
  taskTitle,
  onConfirm,
  onCancel,
}: CancelConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Отменить выполнение?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {taskTitle && (
              <span className="block mb-2 text-foreground font-medium">
                Задача: {taskTitle}
              </span>
            )}
            Это остановит все активные процессы агентов. Текущий прогресс будет
            сохранён, но задача перейдёт в статус «Отменено».
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Нет, оставить</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Да, отменить
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}