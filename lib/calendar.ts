export function localDateKey(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function addDays(value: Date, amount: number) {
  const date = new Date(value);
  date.setDate(date.getDate() + amount);
  return date;
}

export function startOfWeek(value: Date) {
  const date = new Date(value.getFullYear(), value.getMonth(), value.getDate());
  return addDays(date, -((date.getDay() + 6) % 7));
}

export function calendarDays(cursor: Date, mode: "month" | "week" | "agenda") {
  if (mode === "week") return Array.from({ length: 7 }, (_, index) => addDays(startOfWeek(cursor), index));
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const start = startOfWeek(first);
  const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
  const count = Math.round((startOfWeek(last).getTime() - start.getTime()) / 604_800_000) * 7 + 7;
  return Array.from({ length: count }, (_, index) => addDays(start, index));
}

export function itemsInRange<T extends { startsAt: string }>(items: T[], start: Date, end: Date) {
  return items.filter((item) => {
    const time = new Date(item.startsAt).getTime();
    return time >= start.getTime() && time < end.getTime();
  }).sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
}

export function scheduleLink(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
  } catch {
    return "";
  }
}

export type CalendarTimingType = "scheduled" | "deadline";

export function supportsCalendarTimingChoice(kind: string) {
  return kind === "written_test" || kind === "assessment";
}

export function calendarTimingDefaults(kind: string): { timingType: CalendarTimingType; allDay: boolean } {
  if (kind === "assessment") return { timingType: "deadline", allDay: true };
  if (kind === "deadline") return { timingType: "scheduled", allDay: true };
  return { timingType: "scheduled", allDay: false };
}
