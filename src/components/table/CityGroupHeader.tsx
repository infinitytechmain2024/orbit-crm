import { ChevronDown, ChevronRight, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";

interface CityGroupHeaderProps {
  city: string;
  count: number;
  isExpanded: boolean;
  onToggle: () => void;
}

export function CityGroupHeader({ city, count, isExpanded, onToggle }: CityGroupHeaderProps) {
  return (
    <button
      onClick={onToggle}
      className={cn(
        "flex w-full items-center gap-3 rounded-t-xl border border-border px-4 py-3 text-left transition",
        isExpanded
          ? "rounded-b-none border-b-0 bg-surface-2/80"
          : "bg-surface-2/40 hover:bg-surface-2/60",
      )}
    >
      {isExpanded ? (
        <ChevronDown className="size-4 text-muted-foreground" />
      ) : (
        <ChevronRight className="size-4 text-muted-foreground" />
      )}
      <MapPin className="size-4 text-primary" />
      <span className="text-sm font-semibold">{city}</span>
      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
        {count}
      </span>
    </button>
  );
}
