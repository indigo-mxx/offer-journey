"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Application, RecruitmentEventType } from "@/db/schema";
import { addDays, calendarDays, itemsInRange, localDateKey, scheduleLink } from "@/lib/calendar";
export { localDateKey } from "@/lib/calendar";

export type CalendarItemKind = "interview" | RecruitmentEventType;
export type RecruitmentCalendarItem = {
  source: "interview" | "event";
  id: string;
  applicationId: string;
  kind: CalendarItemKind;
  timingType: "scheduled" | "deadline";
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
  ownerName: string;
  ownerEmail: string;
  isOwner: boolean;
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

function formatEventTime(item: RecruitmentCalendarItem) {
  if (item.allDay) return item.timingType === "deadline" ? "截止" : "全天";
  const date = new Date(item.startsAt);
  if (Number.isNaN(date.getTime())) return "时间待定";
  const time = date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  return item.timingType === "deadline" ? `截止 ${time}` : time;
}

function formatAgendaDate(key: string) {
  const date = new Date(`${key}T00:00:00`);
  return new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(date);
}

function subscribeToCompactView(listener: () => void) {
  const media = window.matchMedia("(max-width: 720px)");
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}
const compactViewSnapshot = () => window.matchMedia("(max-width: 720px)").matches;
const serverCompactSnapshot = () => false;

function useCalendarClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

export function RecruitmentCalendar({
  items, applications, busy, scope, friendCount, onScopeChange, onCreate, onEdit,
}: {
  items: RecruitmentCalendarItem[];
  applications: Application[];
  busy: boolean;
  scope: "mine" | "friends";
  friendCount: number;
  onScopeChange: (scope: "mine" | "friends") => void;
  onCreate?: (date: Date) => void;
  onEdit: (item: RecruitmentCalendarItem) => void;
}) {
  const [cursor, setCursor] = useState(() => new Date());
  const [preferredMode, setMode] = useState<CalendarMode | null>(null);
  const compact = useSyncExternalStore(subscribeToCompactView, compactViewSnapshot, serverCompactSnapshot);
  const mode = preferredMode ?? (compact ? "agenda" : "month");
  const [selectedDay, setSelectedDay] = useState(() => localDateKey(new Date()));
  const [selectedEventKey, setSelectedEventKey] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<"all" | CalendarItemKind>("all");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [query, setQuery] = useState("");
  const now = useCalendarClock();
  const panelRef = useRef<HTMLElement>(null);
  const detailTitleRef = useRef<HTMLHeadingElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const pendingDateFocus = useRef<string | null>(null);
  const todayKey = localDateKey(new Date(now));
  const canCreate = scope === "mine" && !!onCreate;
  const itemKey = (item: RecruitmentCalendarItem) => item.source + "-" + item.id;

  useEffect(() => {
    if (selectedEventKey) detailTitleRef.current?.focus({ preventScroll: true });
  }, [selectedEventKey]);
  useEffect(() => {
    if (pendingDateFocus.current) {
      gridRef.current?.querySelector<HTMLButtonElement>('[data-date="' + pendingDateFocus.current + '"]')?.focus();
      pendingDateFocus.current = null;
    }
  }, [cursor, selectedDay]);

  const applicationIds = useMemo(() => new Set(applications.map((item) => item.id)), [applications]);
  const ownerOptions = useMemo(() => [...new Map(items.filter((item) => applicationIds.has(item.applicationId)).map((item) => [
    item.ownerEmail || item.ownerName,
    { value: item.ownerEmail || item.ownerName, label: item.ownerName || "好友" },
  ])).values()], [items, applicationIds]);
  const activeOwner = ownerOptions.some((owner) => owner.value === ownerFilter) ? ownerFilter : "all";
  const hasFilters = !!query.trim() || kindFilter !== "all" || activeOwner !== "all";
  const filteredItems = useMemo(() => items
    .filter((item) => applicationIds.has(item.applicationId))
    .filter((item) => kindFilter === "all" || item.kind === kindFilter)
    .filter((item) => activeOwner === "all" || (item.ownerEmail || item.ownerName) === activeOwner)
    .filter((item) => !query.trim() || [item.company, item.position, item.title, item.location, item.ownerName].join(" ").toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()),
  [applicationIds, items, kindFilter, activeOwner, query]);
  const days = useMemo(() => calendarDays(cursor, mode), [cursor, mode]);
  const visibleItems = useMemo(() => itemsInRange(filteredItems,
    mode === "agenda" ? new Date(cursor.getFullYear(), cursor.getMonth(), 1) : days[0],
    mode === "agenda" ? new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1) : addDays(days[days.length - 1], 1)),
  [filteredItems, cursor, days, mode]);
  const itemsByDay = useMemo(() => {
    const map = new Map<string, RecruitmentCalendarItem[]>();
    for (const item of visibleItems) {
      const key = localDateKey(item.startsAt);
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return map;
  }, [visibleItems]);
  const selectedItems = filteredItems.filter((item) => localDateKey(item.startsAt) === selectedDay);
  const selectedEvent = filteredItems.find((item) => itemKey(item) === selectedEventKey);
  const upcomingCount = filteredItems.filter((item) => item.status !== "已取消" && item.status !== "已完成")
    .filter((item) => new Date(item.startsAt).getTime() >= now && new Date(item.startsAt).getTime() < now + 7 * 86_400_000).length;
  const title = mode === "week"
    ? days[0].getFullYear() + "年 " + (days[0].getMonth() + 1) + "月" + days[0].getDate() + "日 – " +
      (days[6].getFullYear() !== days[0].getFullYear() ? days[6].getFullYear() + "年 " : "") +
      (days[6].getMonth() + 1) + "月" + days[6].getDate() + "日"
    : cursor.getFullYear() + "年 " + (cursor.getMonth() + 1) + "月";

  const clearFilters = () => { setQuery(""); setKindFilter("all"); setOwnerFilter("all"); setSelectedEventKey(null); };
  const revealPanel = () => {
    if (window.matchMedia("(max-width: 1100px)").matches) {
      panelRef.current?.scrollIntoView({ behavior: "instant", block: "nearest" });
    }
  };
  const selectDay = (day: Date) => {
    setSelectedDay(localDateKey(day));
    setSelectedEventKey(null);
    revealPanel();
  };
  const openDetails = (item: RecruitmentCalendarItem, trigger: HTMLElement) => {
    returnFocusRef.current = trigger;
    setSelectedDay(localDateKey(item.startsAt));
    setSelectedEventKey(itemKey(item));
    revealPanel();
  };
  const closeDetails = () => {
    setSelectedEventKey(null);
    const target = returnFocusRef.current?.isConnected ? returnFocusRef.current : panelRef.current;
    target?.focus({ preventScroll: true });
  };
  const move = (direction: number) => {
    const next = mode === "week" ? addDays(cursor, direction * 7) : new Date(cursor.getFullYear(), cursor.getMonth() + direction, 1);
    setCursor(next);
    setSelectedDay(localDateKey(next));
    setSelectedEventKey(null);
  };
  const goToday = () => { const today = new Date(); setCursor(today); selectDay(today); };
  const eventClass = (item: RecruitmentCalendarItem) => " event-" + item.kind +
    (item.status === "已取消" ? " cancelled" : item.status === "已完成" ? " completed" : "");
  const createOnDay = (key: string) => onCreate?.(new Date(key + "T09:00:00"));
  const emptyTitle = hasFilters ? "没有符合条件的日程" : scope === "friends" ? "这个月暂无共享日程" : "这个月还没有安排";
  const renderAgendaEvent = (item: RecruitmentCalendarItem) => (
    <button type="button" className={"agenda-event" + eventClass(item)} key={itemKey(item)}
      onClick={(event) => openDetails(item, event.currentTarget)}>
      <time dateTime={item.startsAt}>{formatEventTime(item)}</time>
      <span><strong>{item.company} · {item.title}</strong><small>{scope === "friends" ? item.ownerName + " · " : ""}{calendarKindLabel(item.kind)} · {item.position}</small></span>
      <i>{item.status}</i>
    </button>
  );

  return (
    <section className="calendar-workspace" aria-label="招聘日程日历">
      <header className="calendar-hero">
        <div className="calendar-heading"><h2>日程</h2><span>{upcomingCount} 项安排在未来 7 天</span></div>
        <div className="calendar-hero-actions">
          <div className="calendar-scope-switch" aria-label="日历范围">
            <button type="button" aria-pressed={scope === "mine"} className={scope === "mine" ? "active" : ""}
              onClick={() => { setOwnerFilter("all"); setSelectedEventKey(null); onScopeChange("mine"); }} disabled={busy}>我的</button>
            <button type="button" aria-pressed={scope === "friends"} className={scope === "friends" ? "active" : ""}
              onClick={() => { setOwnerFilter("all"); setSelectedEventKey(null); onScopeChange("friends"); }} disabled={busy}>好友{friendCount > 0 ? " · " + friendCount : ""}</button>
          </div>
          {canCreate && <button type="button" className="primary-button" onClick={() => createOnDay(selectedDay)} disabled={busy}>＋ 新增日程</button>}
        </div>
      </header>
      <div className="calendar-toolbar">
        <div className="calendar-navigation">
          <strong aria-live="polite">{title}</strong>
          <div>
            <button type="button" onClick={() => move(-1)} aria-label={mode === "week" ? "上一周" : "上个月"}>‹</button>
            <button type="button" onClick={goToday}>今天</button>
            <button type="button" onClick={() => move(1)} aria-label={mode === "week" ? "下一周" : "下个月"}>›</button>
          </div>
        </div>
        <div className="calendar-view-switch" aria-label="日历显示方式">
          {(["month", "week", "agenda"] as CalendarMode[]).map((value) => (
            <button type="button" key={value} className={mode === value ? "active" : ""} aria-pressed={mode === value}
              onClick={() => { setMode(value); setCursor(new Date(selectedDay + "T12:00:00")); }}>
              {value === "month" ? "月" : value === "week" ? "周" : "日程"}
            </button>
          ))}
        </div>
      </div>
      <div className="calendar-filters">
        <label className="calendar-search">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></svg>
          <span className="sr-only">搜索日程</span>
          <input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setSelectedEventKey(null); }} placeholder="搜索公司、岗位、日程" />
        </label>
        <div aria-label="按类型筛选日程">
          {FILTERS.map((filter) => <button type="button" key={filter.value} className={kindFilter === filter.value ? "active" : ""}
            aria-pressed={kindFilter === filter.value} onClick={() => { setKindFilter(filter.value); setSelectedEventKey(null); }}>
            {filter.value !== "all" && <i className={"event-dot event-" + filter.value} aria-hidden="true" />}{filter.label}
          </button>)}
        </div>
      </div>
      {scope === "friends" && <div className="calendar-owner-filters">
        <span>只读{ownerOptions.length ? " · 查看成员" : " · 暂无好友共享日程"}</span>
        {ownerOptions.length > 1 && <><button type="button" aria-pressed={activeOwner === "all"} className={activeOwner === "all" ? "active" : ""} onClick={() => { setOwnerFilter("all"); setSelectedEventKey(null); }}>全部好友</button>
          {ownerOptions.map((owner) => <button type="button" aria-pressed={activeOwner === owner.value} className={activeOwner === owner.value ? "active" : ""} key={owner.value} onClick={() => { setOwnerFilter(owner.value); setSelectedEventKey(null); }}>{owner.label}</button>)}</>}
      </div>}
      {hasFilters && <div className="calendar-filter-summary" role="status"><span>当前范围找到 {visibleItems.length} 项日程</span><button type="button" onClick={clearFilters}>清除筛选</button></div>}
      <div className="calendar-layout">
        <div className="calendar-main">
          {mode === "agenda" ? (
            <div className="calendar-agenda">
              {[...itemsByDay.entries()].map(([key, dayItems]) => (
                <section key={key}>
                  <header><button type="button" className="agenda-date" onClick={() => selectDay(new Date(key + "T12:00:00"))}>{formatAgendaDate(key)}{key === todayKey && <em>今天</em>}</button>
                    {canCreate && <button type="button" disabled={busy} onClick={() => createOnDay(key)}>＋ 添加</button>}</header>
                  <div>{dayItems.map(renderAgendaEvent)}</div>
                </section>
              ))}
              {!visibleItems.length && <div className="calendar-empty"><span className="calendar-empty-mark" aria-hidden="true">▦</span><strong>{emptyTitle}</strong>
                <span>{hasFilters ? "试试其他关键词，或清除筛选。" : scope === "friends" ? "好友完整共享的安排会显示在这里。" : "面试、笔试和截止时间，都可以记在这里。"}</span>
                {hasFilters ? <button type="button" className="secondary-button" onClick={clearFilters}>清除筛选</button> : canCreate && <button type="button" className="secondary-button" disabled={busy} onClick={() => createOnDay(selectedDay)}>新增日程</button>}
              </div>}
            </div>
          ) : (
            <div className="calendar-grid-scroll">
              <div ref={gridRef} className={"calendar-grid calendar-grid-" + mode} role="grid" aria-label={title}>
                <div role="row" className="calendar-grid-row">{WEEKDAYS.map((weekday, index) => <div className={"calendar-weekday" + (index > 4 ? " weekend" : "")} role="columnheader" key={weekday}>{weekday}</div>)}</div>
                {Array.from({ length: days.length / 7 }, (_, week) => (
                  <div role="row" className="calendar-grid-row" key={week}>
                    {days.slice(week * 7, week * 7 + 7).map((day) => {
                      const key = localDateKey(day);
                      const dayItems = itemsByDay.get(key) ?? [];
                      const selected = key === selectedDay;
                      const outside = mode === "month" && day.getMonth() !== cursor.getMonth();
                      const limit = mode === "week" ? 6 : 3;
                      const tabStop = selected || (!days.some((date) => localDateKey(date) === selectedDay) && key === localDateKey(days[0]));
                      return (
                        <article className={"calendar-day" + (outside ? " outside" : "") + (key === todayKey ? " today" : "") + (selected ? " selected" : "")}
                          role="gridcell" aria-selected={selected} key={key}>
                          <div className="calendar-day-head">
                            <button type="button" className="calendar-day-select" data-date={key} tabIndex={tabStop ? 0 : -1}
                              aria-current={key === todayKey ? "date" : undefined} aria-label={formatAgendaDate(key) + "，" + dayItems.length + "项日程"}
                              onClick={() => selectDay(day)} onKeyDown={(event) => {
                                const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
                                if (offset === undefined) return;
                                event.preventDefault();
                                const next = addDays(day, offset);
                                pendingDateFocus.current = localDateKey(next);
                                setSelectedDay(localDateKey(next)); setSelectedEventKey(null);
                                if (next < days[0] || next > days[days.length - 1]) setCursor(next);
                              }}>
                              <span>{day.getDate()}</span><small className="calendar-mobile-count">{dayItems.length ? dayItems.length + "项" : ""}</small>
                            </button>
                            {canCreate && <button type="button" className="calendar-day-create" aria-label={key + " 新增日程"} disabled={busy} onClick={() => createOnDay(key)}>＋</button>}
                          </div>
                          <div className="calendar-day-events">
                            {dayItems.slice(0, limit).map((item) => <button type="button" className={"calendar-event" + eventClass(item)} key={itemKey(item)}
                              onClick={(event) => openDetails(item, event.currentTarget)} title={item.company + " · " + item.title + " · " + item.status}>
                              <time dateTime={item.startsAt}>{formatEventTime(item)}</time><span>{item.company} · {item.title}</span>
                              <small>{scope === "friends" ? item.ownerName + " · " : ""}{calendarKindLabel(item.kind)}{item.status === "已完成" ? " · 已完成" : item.status === "已取消" ? " · 已取消" : ""}</small>
                            </button>)}
                            {dayItems.length > limit && <button type="button" className="calendar-more" onClick={() => { selectDay(day); panelRef.current?.focus({ preventScroll: true }); }}>还有 {dayItems.length - limit} 项 →</button>}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <aside ref={panelRef} className="calendar-day-panel" tabIndex={-1} aria-label="所选日期的日程" onKeyDown={(event) => {
          if (event.key === "Escape" && selectedEvent) { event.stopPropagation(); closeDetails(); }
        }}>
          <header className="calendar-panel-head"><div><span>{selectedDay === todayKey ? "今天" : "当日安排"}</span><h3>{formatAgendaDate(selectedDay)}</h3></div>
            {canCreate && <button type="button" className="calendar-panel-add" disabled={busy} onClick={() => createOnDay(selectedDay)} aria-label="为所选日期新增日程">＋</button>}
          </header>
          {selectedEvent ? <div className="calendar-detail">
            <button type="button" className="calendar-detail-back" onClick={closeDetails}>← 当日全部日程</button>
            <div className="calendar-detail-tags"><span className={"calendar-kind-tag event-" + selectedEvent.kind}>{calendarKindLabel(selectedEvent.kind)}</span><span>{selectedEvent.status}</span></div>
            <h4 ref={detailTitleRef} tabIndex={-1}>{selectedEvent.title}</h4>
            <p>{selectedEvent.company} · {selectedEvent.position}</p>
            <dl>
              <div><dt>{selectedEvent.timingType === "deadline" ? "截止时间" : "时间"}</dt><dd>{formatEventTime(selectedEvent)}{selectedEvent.endsAt && !selectedEvent.allDay && selectedEvent.timingType !== "deadline" ? " – " + new Date(selectedEvent.endsAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) : ""}</dd></div>
              {selectedEvent.mode && <div><dt>形式</dt><dd>{selectedEvent.mode}</dd></div>}
              {selectedEvent.location && <div><dt>地点</dt><dd>{selectedEvent.location}</dd></div>}
              {scope === "friends" && <div><dt>来自</dt><dd>{selectedEvent.ownerName} · 只读</dd></div>}
            </dl>
            <div className="calendar-detail-actions">
              {scheduleLink(selectedEvent.eventUrl) && <a className="secondary-button button-link" href={scheduleLink(selectedEvent.eventUrl)} target="_blank" rel="noopener noreferrer">打开日程链接 ↗</a>}
              {scope === "mine" && selectedEvent.isOwner && <button type="button" className="primary-button" disabled={busy} onClick={() => onEdit(selectedEvent)}>编辑日程</button>}
            </div>
          </div> : selectedItems.length ? <div className="calendar-panel-list">{selectedItems.map((item) => (
            <button type="button" key={itemKey(item)} className={"calendar-panel-event" + eventClass(item)} onClick={(event) => openDetails(item, event.currentTarget)}>
              <div><time dateTime={item.startsAt}>{formatEventTime(item)}</time><span>{item.status}</span></div>
              <strong>{item.company}</strong><span>{item.title}</span><small>{scope === "friends" ? item.ownerName + " · " : ""}{calendarKindLabel(item.kind)} · {item.position}</small>
            </button>
          ))}</div> : <div className="calendar-panel-empty"><span aria-hidden="true">—</span><strong>{hasFilters ? "当天没有匹配的日程" : "这天没有安排"}</strong><p>{scope === "friends" ? "选择其他日期查看好友安排。" : "选一个日期，安排下一场面试或笔试。"}</p>{canCreate && <button type="button" className="secondary-button" disabled={busy} onClick={() => createOnDay(selectedDay)}>＋ 添加安排</button>}</div>}
        </aside>
      </div>
    </section>
  );
}

export function UpcomingScheduleCard({ items, onOpenCalendar, onEdit }: { items: RecruitmentCalendarItem[]; onOpenCalendar: () => void; onEdit: (item: RecruitmentCalendarItem) => void }) {
  const now = useCalendarClock();
  const upcoming = useMemo(() => {
    const deadline = now + 7 * 86_400_000;
    return items.filter((item) => item.status !== "已取消" && item.status !== "已完成" && new Date(item.startsAt).getTime() >= now && new Date(item.startsAt).getTime() <= deadline).sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()).slice(0, 4);
  }, [items, now]);
  if (!upcoming.length) return null;
  return (
    <section className="upcoming-schedule-card" aria-label="未来七天日程">
      <header><div><span>未来 7 天</span><strong>近期日程</strong></div><button type="button" onClick={onOpenCalendar}>查看日历 →</button></header>
      <div>
        {upcoming.map((item) => (
          <button type="button" key={`${item.source}-${item.id}`} onClick={() => onEdit(item)}>
            <time>{item.timingType === "deadline" ? "截止 " : ""}{new Date(item.startsAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: item.allDay ? undefined : "2-digit", minute: item.allDay ? undefined : "2-digit", hour12: false })}</time>
            <span><strong>{item.title}</strong><small>{item.company} · {item.position}</small></span>
            <i className={`event-dot event-${item.kind}`} aria-label={calendarKindLabel(item.kind)} />
          </button>
        ))}
      </div>
    </section>
  );
}
