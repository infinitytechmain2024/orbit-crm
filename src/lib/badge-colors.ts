import { cn } from "@/lib/utils";

type BadgeColor = "red" | "green" | "yellow" | "blue" | "purple" | "orange" | "gray";

const colorClasses: Record<BadgeColor, { text: string; bg: string }> = {
  red: { text: "text-badge-red", bg: "bg-badge-red-bg" },
  green: { text: "text-badge-green", bg: "bg-badge-green-bg" },
  yellow: { text: "text-badge-yellow", bg: "bg-badge-yellow-bg" },
  blue: { text: "text-badge-blue", bg: "bg-badge-blue-bg" },
  purple: { text: "text-badge-purple", bg: "bg-badge-purple-bg" },
  orange: { text: "text-badge-orange", bg: "bg-badge-orange-bg" },
  gray: { text: "text-badge-gray", bg: "bg-badge-gray-bg" },
};

export function statusBadgeClasses(status: string): string {
  const map: Record<string, BadgeColor> = {
    Lead: "blue",
    New: "purple",
    "In Progress": "yellow",
    Rejected: "red",
    Archived: "gray",
    Verified: "green",
    "Not Available": "red",
    Pending: "yellow",
    Active: "green",
    Inactive: "gray",
    High: "red",
    Middle: "yellow",
    Low: "green",
  };
  const color = map[status] ?? "gray";
  return cn(colorClasses[color].text, colorClasses[color].bg);
}

export function priorityBadgeClasses(priority: string): string {
  const map: Record<string, BadgeColor> = {
    high: "red",
    med: "yellow",
    low: "green",
    High: "red",
    Middle: "yellow",
    Low: "green",
  };
  const color = map[priority] ?? "gray";
  return cn(colorClasses[color].text, colorClasses[color].bg);
}

export { colorClasses, type BadgeColor };
