import assert from "node:assert/strict";
import test from "node:test";
import { addDays, calendarDays, itemsInRange, localDateKey, scheduleLink } from "../lib/calendar.ts";

test("month grids cover complete Monday-to-Sunday weeks, including adjacent months", () => {
  const days = calendarDays(new Date(2026, 8, 5), "month");
  assert.equal(localDateKey(days[0]), "2026-08-31");
  assert.equal(localDateKey(days.at(-1)), "2026-10-04");
  assert.equal(days.length, 35);
  const events = [
    { id: "previous", startsAt: "2026-08-31T09:00:00" },
    { id: "current", startsAt: "2026-09-01T14:00:00" },
    { id: "next", startsAt: "2026-10-04T23:59:00" },
    { id: "outside", startsAt: "2026-10-05T00:00:00" },
  ];
  assert.deepEqual(itemsInRange(events, days[0], addDays(days.at(-1), 1)).map((item) => item.id), ["previous", "current", "next"]);
});

test("month grids handle four, five, and six weeks and leap day", () => {
  assert.equal(calendarDays(new Date(2021, 1, 1), "month").length, 28);
  assert.equal(calendarDays(new Date(2026, 7, 1), "month").length, 42);
  assert.ok(calendarDays(new Date(2024, 1, 1), "month").some((day) => localDateKey(day) === "2024-02-29"));
  for (let month = 0; month < 12; month++) {
    const days = calendarDays(new Date(2026, month, 15), "month");
    assert.equal(days[0].getDay(), 1);
    assert.equal(days.at(-1).getDay(), 0);
    assert.equal(days.filter((day) => day.getMonth() === month).length, new Date(2026, month + 1, 0).getDate());
  }
});

test("week navigation crosses years without dropping dates", () => {
  const days = calendarDays(new Date(2027, 0, 1), "week");
  assert.equal(localDateKey(days[0]), "2026-12-28");
  assert.equal(localDateKey(days.at(-1)), "2027-01-03");
  assert.equal(days.length, 7);
});

test("range end is exclusive and sorting uses actual instants across offsets", () => {
  const events = [
    { id: "later", startsAt: "2026-09-05T01:00:00Z" },
    { id: "earlier", startsAt: "2026-09-05T08:00:00+08:00" },
    { id: "end", startsAt: "2026-09-06T00:00:00Z" },
    { id: "invalid", startsAt: "invalid" },
  ];
  assert.deepEqual(itemsInRange(events, new Date("2026-09-05T00:00:00Z"), new Date("2026-09-06T00:00:00Z")).map((item) => item.id), ["earlier", "later"]);
  assert.equal(localDateKey("invalid"), "");
});

test("day arithmetic preserves local date and hour", () => {
  const date = new Date(2026, 2, 7, 9);
  const next = addDays(date, 2);
  assert.equal(localDateKey(next), "2026-03-09");
  assert.equal(next.getHours(), 9);
  assert.equal(localDateKey(date), "2026-03-07");
});

test("calendar detail links allow only web URLs", () => {
  assert.equal(scheduleLink("https://example.com/meeting"), "https://example.com/meeting");
  for (const value of ["javascript:alert(1)", "data:text/html,hello", "file:///C:/private", "", "not a url"]) assert.equal(scheduleLink(value), "");
});
