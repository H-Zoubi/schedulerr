// Pure functions that turn store data into what the screens show.
import { CalEvent, Habit, HabitLog, Project, RepeatUnit, Task, TaskBlock, TimeBlock, TimeBlockException } from "../api";
import {
  addDays, addDaysIso, backendWeekday, isoDate, minutesOfIso, minutesOfTime, parseDate, todayIso, weekStartOf,
} from "../dates";

export type CalKind = "event" | "time" | "task_block";

export type CalItem = {
  key: string;        // unique per occurrence
  kind: CalKind;
  id: number;         // id of the event, time block or task block
  date: string;       // the day this occurrence is shown on
  start: number;      // minutes after midnight
  end: number;
  title: string;
  color: string;
  taskId?: number;
  done?: boolean;
  priority?: number;
  location?: string;
  occurrence?: string; // routines: the date the routine put this occurrence on (before any move)
  moved?: boolean;     // routines: this occurrence was moved or retimed on its own
};

export const TASK_COLOR = "#7c8597";

// ---------- Routines ----------
// These mirror backend/app/recurrence.py.

export function firstOccurrence(tb: TimeBlock): string {
  const start = parseDate(tb.start_date);
  return addDaysIso(tb.start_date, (tb.weekday - backendWeekday(start) + 7) % 7);
}

// True when the routine's rule (ignoring one-off changes) puts an occurrence on `day`.
export function isOccurrence(tb: TimeBlock, day: string): boolean {
  if (backendWeekday(parseDate(day)) !== tb.weekday || day < tb.start_date) return false;
  if (tb.until_date && day > tb.until_date) return false;
  const days = Math.round((parseDate(day).getTime() - parseDate(firstOccurrence(tb)).getTime()) / 86_400_000);
  return Math.floor(days / 7) % Math.max(1, tb.interval_weeks || 1) === 0;
}

export function exceptionsIndex(list: TimeBlockException[]): Map<number, Map<string, TimeBlockException>> {
  const out = new Map<number, Map<string, TimeBlockException>>();
  for (const x of list) {
    const m = out.get(x.time_block_id) ?? new Map<string, TimeBlockException>();
    m.set(x.on_date, x);
    out.set(x.time_block_id, m);
  }
  return out;
}

// ---------- Repeating tasks ----------
// Mirrors next_deadline in backend/app/recurrence.py.

function addUnits(iso: string, unit: RepeatUnit, n: number): string {
  if (unit === "day") return addDaysIso(iso, n);
  if (unit === "week") return addDaysIso(iso, n * 7);
  const d = parseDate(iso);
  const months = unit === "month" ? n : n * 12;
  const target = new Date(d.getFullYear(), d.getMonth() + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d.getDate(), lastDay));
  return isoDate(target);
}

export function nextDeadline(current: string | null, every: number, unit: RepeatUnit, today = todayIso()): string {
  const anchor = current ?? today;
  let n = 1;
  let next = addUnits(anchor, unit, every);
  while (next <= today) next = addUnits(anchor, unit, every * ++n);
  return next;
}

export function repeatLabel(every: number, unit: RepeatUnit): string {
  if (every === 1) return { day: "Daily", week: "Weekly", month: "Monthly", year: "Yearly" }[unit];
  return `Every ${every} ${unit}s`;
}

// Every occurrence on each date in [from, to] (inclusive), keyed by date.
export function expandRange(
  from: string, to: string,
  data: {
    events: CalEvent[]; timeBlocks: TimeBlock[]; timeBlockExceptions?: TimeBlockException[];
    taskBlocks: TaskBlock[]; tasks: Task[]; projects: Project[];
  },
): Map<string, CalItem[]> {
  const out = new Map<string, CalItem[]>();
  const days: string[] = [];
  for (let d = parseDate(from); isoDate(d) <= to; d = addDays(d, 1)) {
    const iso = isoDate(d);
    days.push(iso);
    out.set(iso, []);
  }
  const push = (item: CalItem) => out.get(item.date)?.push(item);

  const changes = exceptionsIndex(data.timeBlockExceptions ?? []);
  for (const tb of data.timeBlocks) {
    const own = changes.get(tb.id);
    for (const day of days) {
      if (own?.has(day) || !isOccurrence(tb, day)) continue;
      push({
        key: `time-${tb.id}-${day}`, kind: "time", id: tb.id, date: day,
        start: minutesOfTime(tb.start_time), end: minutesOfTime(tb.end_time),
        title: tb.title, color: tb.color, occurrence: day,
      });
    }
    // Moved occurrences can land in range even when their original date is outside it.
    for (const x of own?.values() ?? []) {
      const where = x.new_date ?? x.on_date;
      if (x.skipped || where < from || where > to || !isOccurrence(tb, x.on_date)) continue;
      push({
        key: `time-${tb.id}-${x.on_date}`, kind: "time", id: tb.id, date: where,
        start: minutesOfTime(x.start_time ?? tb.start_time), end: minutesOfTime(x.end_time ?? tb.end_time),
        title: tb.title, color: tb.color, occurrence: x.on_date, moved: true,
      });
    }
  }

  for (const ev of data.events) {
    const day = ev.start_at.slice(0, 10);
    if (day < from || day > to) continue;
    const endDay = ev.end_at.slice(0, 10);
    const start = minutesOfIso(ev.start_at);
    const end = endDay > day ? 24 * 60 : minutesOfIso(ev.end_at);
    push({ key: `event-${ev.id}`, kind: "event", id: ev.id, date: day, start, end: Math.max(end, start + 15), title: ev.title, color: ev.color, location: ev.location || undefined });
  }

  const tasks = new Map(data.tasks.map((t) => [t.id, t]));
  const colors = new Map(data.projects.map((p) => [p.id, p.color]));
  for (const b of data.taskBlocks) {
    const day = b.start_at.slice(0, 10);
    if (day < from || day > to) continue;
    const task = tasks.get(b.task_id);
    if (!task) continue;
    const start = minutesOfIso(b.start_at);
    const end = b.end_at.slice(0, 10) > day ? 24 * 60 : minutesOfIso(b.end_at);
    push({
      key: `task_block-${b.id}`, kind: "task_block", id: b.id, date: day, start, end: Math.max(end, start + 15),
      title: task.title, color: (task.project_id && colors.get(task.project_id)) || TASK_COLOR,
      taskId: task.id, done: task.done, priority: task.priority,
    });
  }

  for (const list of out.values()) list.sort((a, b) => a.start - b.start || b.end - a.end);
  return out;
}

// Side-by-side layout for overlapping items in one day column.
// Returns, per item key, its lane and the number of lanes in its overlap cluster.
export function layoutDay(items: CalItem[]): Map<string, { lane: number; lanes: number }> {
  const result = new Map<string, { lane: number; lanes: number }>();
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  let cluster: CalItem[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -1;

  const flush = () => {
    for (const it of cluster) result.get(it.key)!.lanes = laneEnds.length;
    cluster = [];
    laneEnds = [];
  };

  for (const it of sorted) {
    if (it.start >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= it.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(it.end);
    } else {
      laneEnds[lane] = it.end;
    }
    result.set(it.key, { lane, lanes: 1 });
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.end);
  }
  flush();
  return result;
}

// Keys of items that overlap another item on the same day. Completed task blocks don't count.
export function conflicts(items: CalItem[]): Set<string> {
  const live = items.filter((i) => !i.done).sort((a, b) => a.start - b.start);
  const out = new Set<string>();
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length && live[j].start < live[i].end; j++) {
      out.add(live[i].key);
      out.add(live[j].key);
    }
  }
  return out;
}

// Free gaps between `from` and `to` minutes on one day, ignoring gaps shorter than `min`.
// `buffer` keeps that many minutes clear after and before each busy item.
export function freeGaps(
  items: CalItem[], from: number, to: number, min = 15, buffer = 0,
): { start: number; end: number }[] {
  const busy = items.filter((i) => i.end + buffer > from && i.start - buffer < to).sort((a, b) => a.start - b.start);
  const gaps: { start: number; end: number }[] = [];
  let cursor = from;
  for (const it of busy) {
    const end = Math.min(to, it.start - buffer);
    if (end - cursor >= min) gaps.push({ start: cursor, end });
    cursor = Math.max(cursor, it.end + buffer);
  }
  if (to - cursor >= min) gaps.push({ start: cursor, end: to });
  return gaps;
}

// ---------- Tasks ----------

export function blocksByTask(blocks: TaskBlock[]): Map<number, TaskBlock[]> {
  const map = new Map<number, TaskBlock[]>();
  for (const b of blocks) {
    const list = map.get(b.task_id) ?? [];
    list.push(b);
    map.set(b.task_id, list);
  }
  for (const list of map.values()) list.sort((a, b) => a.start_at.localeCompare(b.start_at));
  return map;
}

// Next upcoming (or most recent) block for a task.
export function nextBlock(blocks: TaskBlock[] | undefined): TaskBlock | undefined {
  if (!blocks?.length) return undefined;
  const now = isoDate(new Date());
  return blocks.find((b) => b.end_at.slice(0, 10) >= now) ?? blocks[blocks.length - 1];
}

// Highest priority first, then earliest deadline, then board order.
export function compareTasks(a: Task, b: Task): number {
  if (a.done !== b.done) return a.done ? 1 : -1;
  if (a.priority !== b.priority) return b.priority - a.priority;
  if (a.deadline !== b.deadline) {
    if (!a.deadline) return 1;
    if (!b.deadline) return -1;
    return a.deadline.localeCompare(b.deadline);
  }
  return a.position - b.position || a.id - b.id;
}

// ---------- Habits ----------

export function habitWindow(habit: Habit, day = todayIso()): { start: string; end: string } {
  if (habit.target_period === "day") return { start: day, end: day };
  const start = isoDate(weekStartOf(parseDate(day)));
  return { start, end: addDaysIso(start, 6) };
}

export function logIndex(logs: HabitLog[]): Map<number, Map<string, number>> {
  const map = new Map<number, Map<string, number>>();
  for (const l of logs) {
    const m = map.get(l.habit_id) ?? new Map<string, number>();
    m.set(l.logged_on, (m.get(l.logged_on) ?? 0) + l.count);
    map.set(l.habit_id, m);
  }
  return map;
}

export function countIn(days: Map<string, number> | undefined, start: string, end: string): number {
  if (!days) return 0;
  let n = 0;
  for (const [d, c] of days) if (d >= start && d <= end) n += c;
  return n;
}

// Consecutive periods (days or weeks) meeting the target. The current period counts
// only once it is met, so an unfinished today never breaks the streak.
export function streak(habit: Habit, days: Map<string, number> | undefined): number {
  let n = 0;
  let { start, end } = habitWindow(habit);
  const step = habit.target_period === "day" ? 1 : 7;
  const met = (s: string, e: string) => countIn(days, s, e) >= habit.target_count;
  if (met(start, end)) n++;
  for (let i = 0; i < 400; i++) {
    start = addDaysIso(start, -step);
    end = addDaysIso(end, -step);
    if (!met(start, end)) break;
    n++;
  }
  return n;
}
