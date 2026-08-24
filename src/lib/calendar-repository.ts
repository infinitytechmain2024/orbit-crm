import { getSupabaseClient } from "@/lib/supabase/client";
import type { Tables, TablesUpdate } from "@/lib/supabase/database.types";

export type CalendarEventRow = Tables<"calendar_events">;
export type CalendarEventStatus = CalendarEventRow["status"];

export async function fetchCalendarEvents(
  organizationId: string,
  rangeStart: Date,
  rangeEnd: Date,
): Promise<CalendarEventRow[]> {
  const { data, error } = await getSupabaseClient()
    .from("calendar_events")
    .select("*")
    .eq("organization_id", organizationId)
    .gte("starts_at", rangeStart.toISOString())
    .lt("starts_at", rangeEnd.toISOString())
    .order("starts_at");
  if (error) throw new Error(`Не удалось загрузить календарь: ${error.message}`);
  return data ?? [];
}

export async function updateCalendarEvent(
  organizationId: string,
  eventId: string,
  patch: TablesUpdate<"calendar_events">,
): Promise<CalendarEventRow> {
  const { data, error } = await getSupabaseClient()
    .from("calendar_events")
    .update(patch)
    .eq("organization_id", organizationId)
    .eq("id", eventId)
    .select()
    .single();
  if (error) throw new Error(`Не удалось обновить событие: ${error.message}`);
  return data;
}
