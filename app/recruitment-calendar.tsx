"use client";

import { useMemo, useState } from "react";
import type { Application, RecruitmentEventType } from "@/db/schema";

export type CalendarItemKind = "interview" | RecruitmentEventType;
export type RecruitmentCalendarItem = {
  source: "interview" | "event";
  id: string;
  applicationId: string;
  kind: CalendarItemKind;
  title: string;
  company: string;
  position: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  mode: string;
  location: string;
  eventUrl: string;
  status: string;
};

type CalendarMode = "month" | "week" | "agenda";

const WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const FILTERS: Array<{ value: "all" | CalendarItemKind; label: string }> = [
  { value: "all", label: "全部" },
  { value: "interview", label: "面试" },
  { value: "written_test", label: "笔试" },
  { value: "assessment", label: "测评" },
  { value: "deadline", label: "截止事项" },
  { value: "hr_contact", label: "HR 沟通" },
  { value: "other", label: "其他" },
];

export function calendarKindLabel(kind: CalendarItemKind) {
  return FILTERS.find((item) => item.value === kind)?.label ?? "其他";
}

export function localDateKey(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function startOfWeek(value: Date) {
  const date = new Date(value.getFullYear(), value.getMonth(), value.getDate());
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date;
}

function addDays(value: Date, amount: number) {
  const date = new Date(value);
  date.setDate(date.getDate() + amount);
  return date;
}

function monthDays(cursor: Date) {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const start = startOfWeek(first);
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

function formatEventTime(item: RecruitmentCalendarItem) {
  if (item.allDay) return "全天";
  const date = new Date(item.startsAt);
  if (Number.isNaN(date.getTime())) return "时间待定";
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function formatAgendaDate(key: string) {
  const date = new Date(`${key}T00:00:00`);
  return new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(date);
}

export function RecruitmentCalendar({
  items,
  applications,
  busy,
  onCreate,
  onEdit,
}: {
  items: RecruitmentCalendarItem[];
  applications: Application[];
  busy: boolean;
  onCreate: (date: Date) => void;
  onEdit: (item: RecruitmentCalendarItem) => void;
}) {
  const [cursor, setCursor] = useState(() => new Date());
  const [mode, setMode] = useState<CalendarMode>("month");
  const [kindFilter, setKindFilter] = useState<"all" | CalendarItemKind>("all");
  const [query, setQuery] = useState("");
  const todayKey = localDateKey(new Date());
  const applicationIds = useMemo(() => new Set(applications.map((item) => item.id)), [applications]);
  const filteredItems = useMemo(() => items
    .filter((item) => applicationIds.has(item.applicationId))
    .filter((item) => kindFilter === "all" || item.kind === kindFilter)
    .filter((item) => !query.trim() || [item.company, item.position, item.title, item.location].join(" ").toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt)), [applicationIds, items, kindFilter, query]);

  const days = useMemo(() => mode === "week"
    ? Array.from({ length: 7 }, (_, index) => addDays(startOfWeek(cursor), index))
    : monthDays(cursor), [cursor, mode]);
  const visibleStart = mode === "week" ? days[0] : new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const visibleEnd = mode === "week" ? addDays(days[6], 1) : new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  const visibleItems = useMemo(() => filteredItems.filter((item) => {
    const timestamp = new Date(item.startsAt).getTime();
    return timestamp >= visibleStart.getTime() && timestamp < visibleEnd.getTime();
  }), [filteredItems, visibleStart, visibleEnd]);
  const itemsByDay = useMemo(() => {
    const map = new Map<string, RecruitmentCalendarItem[]>();
    for (const item of visibleItems) {
      const key = localDateKey(item.startsAt);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return map;
  }, [visibleItems]);
  const agendaGroups = useMemo(() => [...itemsByDay.entries()].sort(([a], [b]) => a.localeCompare(b)), [itemsByDay]);
  const upcomingCount = useMemo(() => {
    const now = Date.now();
    const nextWeek = now + 7 * 86_400_000;
    return items.filter((item) => item.status !== "已取消").filter((item) => {
      const timestamp = new Date(item.startsAt).getTime();
      return timestamp >= now && timestamp <= nextWeek;
    }).length;
  }, [items]);
  const title = mode === "week"
    ? `${days[0].getMonth() + 1}月${days[0].getDate()}日 – ${days[6].getMonth() + 1}月${days[6].getDate()}日`
    : `${cursor.getFullYear()}年 ${cursor.getMonth() + 1}月`;

  const move = (direction: number) => setCursor((current) => {
    if (mode === "week") return addDays(current, direction * 7);
    return new Date(current.getFullYear(), current.getMonth() + direction, 1);
  });

  return (
    <section className="calendar-workspace" aria-label="招聘日程日历">
      <header className="calendar-hero">
        <div>
          <p className="section-kicker">RECRUITMENT CALENDAR</p>
          <h2>日程日历</h2>
          <p>把笔试、测评和每一轮面试放在同一条时间线上，点击日期即可安排。</p>
        </div>
        <div className="calendar-hero-actions">
          <span><strong>{upcomingCount}</strong> 项未来 7 天日程</span>
          <button type="button" className="primary-button" onClick={() => onCreate(new Date())} disabled={busy}>＋ 新增日程</button>
        </div>
      </header>

      <div className="calendar-toolbar">
        <div className="calendar-navigation">
          <button type="button" onClick={() => move(-1)} aria-label="上一段时间">←</button>
          <button type="button" onClick={() => setCursor(new Date())}>今天</button>
          <button type="button" onClick={() => move(1)} aria-label="下一段时间">→</button>
          <strong>{title}</strong>
        </div>
        <div className="calendar-view-switch" aria-label="日历显示方式">
          {(["month", "week", "agenda"] as CalendarMode[]).map((value) => (
            <button type="button" key={value} className={mode === value ? "active" : ""} onClick={() => setMode(value)} aria-pressed={mode === value}>
              {value === "month" ? "月" : value === "week" ? "周" : "日程"}
            </button>
          ))}
        </div>
      </div>

      <div className="calendar-filters">
        <label>
          <span className="sr-only">搜索日程</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索公司、岗位或日程" />
        </label>
        <div aria-label="按类型筛选日程">
          {FILTERS.map((filter) => (
            <button type="button" key={filter.value} className={kindFilter === filter.value ? "active" : ""} onClick={() => setKindFilter(filter.value)} aria-pressed={kindFilter === filter.value}>{filter.label}</button>
          ))}
        </div>
      </div>

      {mode === "agenda" ? (
        <div className="calendar-agenda">
          {agendaGroups.length ? agendaGroups.map(([key, dayItems]) => (
            <section key={key}>
              <header><strong>{formatAgendaDate(key)}</strong><button type="button" onClick={() => onCreate(new Date(`${key}T09:00:00`))}>＋ 添加</button></header>
              <div>
                {dayItems.map((item) => (
                  <button type="button" className={`agenda-event event-${item.kind} ${item.status === "已取消" ? "cancelled" : ""}`} key={`${item.source}-${item.id}`} onClick={() => onEdit(item)}>
                    <time>{formatEventTime(item)}</time><span><strong>{item.title}</strong><small>{item.company} · {item.position}</small></span><i>{item.status}</i>
                  </button>
                ))}
              </div>
            </section>
          )) : <div className="calendar-empty"><strong>这个月还没有日程</strong><span>点击“新增日程”或任意日期开始安排。</span></div>}
        </div>
      ) : (
        <div className="calendar-grid-scroll">
          <div className={`calendar-grid calendar-grid-${mode}`} role="grid" aria-label={title}>
            {WEEKDAYS.map((weekday) => <div className="calendar-weekday" role="columnheader" key={weekday}>{weekday}</div>)}
            {days.map((day) => {
              const key = localDateKey(day);
              const dayItems = itemsByDay.get(key) ?? [];
              const outside = mode === "month" && day.getMonth() !== cursor.getMonth();
              const visibleLimit = mode === "week" ? 8 : 3;
              return (
                <article className={`calendar-day ${outside ? "outside" : ""} ${key === todayKey ? "today" : ""}`} role="gridcell" key={key}>
                  <button type="button" className="calendar-day-add" onClick={() => onCreate(day)} aria-label={`${key} 新增日程`}>
                    <span>{day.getDate()}</span><i aria-hidden="true">＋</i>
                  </button>
                  <div className="calendar-day-events">
                    {dayItems.slice(0, visibleLimit).map((item) => (
                      <button type="button" className={`calendar-event event-${item.kind} ${item.status === "已取消" ? "cancelled" : ""}`} key={`${item.source}-${item.id}`} onClick={() => onEdit(item)} title={`${item.company} · ${item.position}`}>
                        <time>{formatEventTime(item)}</time><span>{item.title}</span>
                      </button>
                    ))}
                    {dayItems.length > visibleLimit && <button type="button" className="calendar-more" onClick={() => { setCursor(day); setMode("agenda"); }}>还有 {dayItems.length - visibleLimit} 项</button>}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

export function UpcomingScheduleCard({ items, onOpenCalendar, onEdit }: { items: RecruitmentCalendarItem[]; onOpenCalendar: () => void; onEdit: (item: RecruitmentCalendarItem) => void }) {
  const upcoming = useMemo(() => {
    const now = Date.now();
    const deadline = now + 7 * 86_400_000;
    return items.filter((item) => item.status !== "已取消" && new Date(item.startsAt).getTime() >= now && new Date(item.startsAt).getTime() <= deadline).sort((a, b) => a.startsAt.localeCompare(b.startsAt)).slice(0, 4);
  }, [items]);
  if (!upcoming.length) return null;
  return (
    <section className="upcoming-schedule-card" aria-label="未来七天日程">
      <header><div><span>未来 7 天</span><strong>近期日程</strong></div><button type="button" onClick={onOpenCalendar}>查看日历 →</button></header>
      <div>
        {upcoming.map((item) => (
          <button type="button" key={`${item.source}-${item.id}`} onClick={() => onEdit(item)}>
            <time>{new Date(item.startsAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: item.allDay ? undefined : "2-digit", minute: item.allDay ? undefined : "2-digit", hour12: false })}</time>
            <span><strong>{item.title}</strong><small>{item.company} · {item.position}</small></span>
            <i className={`event-dot event-${item.kind}`} aria-label={calendarKindLabel(item.kind)} />
          </button>
        ))}
      </div>
    </section>
  );
}
