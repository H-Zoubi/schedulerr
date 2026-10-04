import { PointerEvent as RPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Anchor, IconButton, Popover, Segmented, TaskCheck } from "../components/primitives";
import { Icon } from "../components/Icon";
import { TimeGrid, DragApi, Range } from "./calendar/TimeGrid";
import { MonthGrid } from "./calendar/MonthGrid";
import { ItemPopover } from "./calendar/ItemPopover";
import { MiniMonth } from "./calendar/MiniMonth";
import { CalItem, compareTasks, expandRange } from "../lib/derive";
import { navigate, Route } from "../lib/router";
import { CalView, setPref, usePrefs } from "../lib/prefs";
import {
  createEvent, createTask, createTimeBlock, deleteEvent, deleteTaskBlock, deleteTimeBlock, scheduleTask, store,
  toggleTaskDone, useData,
} from "../store";
import {
  addDays, addDaysIso, atMinutes, backendWeekday, fmtDuration, fmtRange, isoDate, monthTitle, parseDate,
  relDay, timeString, todayIso, weekStartOf,
} from "../dates";
import { anyOverlayOpen, isTyping, openQuickAdd, openTask } from "../lib/ui";
import { Task } from "../api";

const VIEWS: { value: CalView; label: string; hint: string }[] = [
  { value: "day", label: "Day", hint: "D" },
  { value: "3day", label: "3 days", hint: "X" },
  { value: "week", label: "Week", hint: "W" },
  { value: "month", label: "Month", hint: "M" },
];

function rangeFor(view: CalView, date: string, weekStart: 0 | 1): string[] {
  const d = parseDate(date);
  let start: Date;
  let n: number;
  if (view === "day") { start = d; n = 1; }
  else if (view === "3day") { start = d; n = 3; }
  else if (view === "week") { start = weekStartOf(d, weekStart); n = 7; }
  else { start = weekStartOf(new Date(d.getFullYear(), d.getMonth(), 1), weekStart); n = 42; }
  return Array.from({ length: n }, (_, i) => isoDate(addDays(start, i)));
}

function step(view: CalView, date: string, dir: 1 | -1): string {
  const d = parseDate(date);
  if (view === "month") return isoDate(new Date(d.getFullYear(), d.getMonth() + dir, 1));
  return addDaysIso(date, dir * (view === "day" ? 1 : view === "3day" ? 3 : 7));
}

export function Calendar({ route }: { route: Extract<Route, { name: "calendar" }> }) {
  const prefs = usePrefs();
  const data = useData();
  const view = (VIEWS.some((v) => v.value === route.view) ? route.view : prefs.calView) as CalView;
  const date = route.date ?? todayIso();
  const days = useMemo(() => rangeFor(view, date, prefs.weekStart), [view, date, prefs.weekStart]);
  const [popover, setPopover] = useState<{ item: CalItem; anchor: Anchor } | null>(null);
  const [creating, setCreating] = useState<{ range: Range; anchor: Anchor } | null>(null);
  const dragApi = useRef<DragApi | null>(null);

  const go = useCallback((next: { view?: CalView; date?: string }) => {
    const v = next.view ?? view;
    if (next.view) setPref("calView", next.view);
    navigate({ name: "calendar", view: v, date: next.date ?? date }, { replace: true });
    setPopover(null);
    setCreating(null);
  }, [view, date]);

  const items = useMemo(() => expandRange(days[0], days[days.length - 1], data),
    [days, data.events, data.timeBlocks, data.taskBlocks, data.tasks, data.projects]); // eslint-disable-line react-hooks/exhaustive-deps

  const dueByDay = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const t of data.tasks) {
      if (t.done || !t.deadline || t.deadline < days[0] || t.deadline > days[days.length - 1]) continue;
      const list = m.get(t.deadline) ?? [];
      list.push(t);
      m.set(t.deadline, list);
    }
    for (const list of m.values()) list.sort(compareTasks);
    return m;
  }, [data.tasks, days]);

  const busy = useMemo(() => {
    const s = new Set<string>();
    for (const e of data.events) s.add(e.start_at.slice(0, 10));
    for (const b of data.taskBlocks) s.add(b.start_at.slice(0, 10));
    return s;
  }, [data.events, data.taskBlocks]);

  // Keep the open popover's item fresh as data changes (e.g. after editing its time).
  const liveItem = popover ? items.get(popover.item.date)?.find((i) => i.key === popover.item.key)
    ?? [...items.values()].flat().find((i) => i.kind === popover.item.kind && i.id === popover.item.id) : undefined;
  useEffect(() => {
    if (popover && !liveItem) setPopover(null);
  }, [popover, liveItem]);

  // ---------- Keyboard ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping()) return;
      if ((e.key === "Delete" || e.key === "Backspace") && popover && liveItem) {
        e.preventDefault();
        removeItem(liveItem);
        setPopover(null);
        return;
      }
      if (anyOverlayOpen()) return;
      const k = e.key.toLowerCase();
      if (k === "t") go({ date: todayIso() });
      else if (k === "arrowleft" || k === "j") go({ date: step(view, date, -1) });
      else if (k === "arrowright" || k === "k") go({ date: step(view, date, 1) });
      else if (k === "d") go({ view: "day" });
      else if (k === "x") go({ view: "3day" });
      else if (k === "w") go({ view: "week" });
      else if (k === "m") go({ view: "month" });
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, view, date, popover, liveItem]);

  // Enter on a focused block opens it (dispatched by the block).
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onOpen = (e: Event) => {
      const key = (e as CustomEvent<string>).detail;
      const item = [...items.values()].flat().find((i) => i.key === key);
      const target = e.target as HTMLElement;
      if (item) {
        const r = target.getBoundingClientRect();
        setPopover({ item, anchor: { x: r.left, y: r.top, w: r.width, h: r.height } });
      }
    };
    el.addEventListener("cal-open", onOpen);
    return () => el.removeEventListener("cal-open", onOpen);
  }, [items]);

  const title = view === "day"
    ? parseDate(date).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })
    : view === "month" ? monthTitle(parseDate(date)) : rangeTitle(days[0], days[days.length - 1]);
  const showsToday = days.includes(todayIso()) && (view !== "month" || parseDate(date).getMonth() === new Date().getMonth());
  const plannedMinutes = useMemo(() => {
    if (view === "month") return 0;
    let total = 0;
    for (const d of days) for (const it of items.get(d) ?? []) if (it.kind === "task_block") total += it.end - it.start;
    return total;
  }, [items, days, view]);

  return (
    <div className={"cal" + (prefs.calSidebar ? "" : " no-side")} ref={rootRef}>
      <aside className="cal-side">
        <MiniMonth selected={date} rangeStart={days[0]} rangeEnd={days[days.length - 1]} busy={busy}
          onPick={(d) => go({ date: d })} />
        <TaskTray onDragStart={(t, e) => dragApi.current?.startTask(t, e)} canDrag={view !== "month"} />
      </aside>

      <div className="cal-main">
        <header className="cal-head">
          <div className="cal-title">
            <IconButton icon="sidebar" label={prefs.calSidebar ? "Hide side panel" : "Show side panel"} className="side-toggle"
              onClick={() => setPref("calSidebar", !prefs.calSidebar)} />
            <h1>{title}</h1>
            {plannedMinutes > 0 && <span className="cal-sub muted">{fmtDuration(plannedMinutes)} of tasks planned</span>}
          </div>
          <div className="cal-controls">
            <button className="btn sm" onClick={() => go({ date: todayIso() })} disabled={showsToday} title="Today (T)">Today</button>
            <div className="nav-arrows">
              <IconButton icon="chevronLeft" label="Previous" shortcut="←" onClick={() => go({ date: step(view, date, -1) })} />
              <IconButton icon="chevronRight" label="Next" shortcut="→" onClick={() => go({ date: step(view, date, 1) })} />
            </div>
            <Segmented label="View" value={view} options={VIEWS} onChange={(v) => go({ view: v })} size="sm" />
            <button className="btn primary sm add-event" onClick={() => openQuickAdd({ mode: "event", date })}>
              <Icon name="plus" size={15} /> <span className="label">Event</span>
            </button>
          </div>
        </header>

        {view === "month" ? (
          <MonthGrid days={days} month={parseDate(date).getMonth()} items={items} dueByDay={dueByDay}
            selectedKey={popover?.item.key ?? null}
            onSelect={(item, anchor) => setPopover({ item, anchor })}
            onDayOpen={(d) => go({ view: "day", date: d })}
            onDayCreate={(d) => openQuickAdd({ mode: "event", date: d })} />
        ) : (
          <TimeGrid days={days} items={items} dueByDay={dueByDay} hourHeight={prefs.hourHeight}
            selectedKey={popover?.item.key ?? null} creating={creating?.range ?? null}
            onSelect={(item, anchor) => { setCreating(null); setPopover({ item, anchor }); }}
            onCreate={(range, anchor) => { setPopover(null); setCreating({ range, anchor }); }}
            onDayClick={(d) => go({ view: "day", date: d })}
            dragApi={dragApi}
            onSwipe={(dir) => go({ date: step(view, date, dir) })} />
        )}
      </div>

      {popover && liveItem && (
        <ItemPopover item={liveItem} anchor={popover.anchor} onClose={() => setPopover(null)} />
      )}
      {creating && (
        <CreatePopover range={creating.range} anchor={creating.anchor} onClose={() => setCreating(null)} />
      )}
    </div>
  );
}

function rangeTitle(a: string, b: string): string {
  const da = parseDate(a);
  const db = parseDate(b);
  if (da.getMonth() === db.getMonth()) return monthTitle(da);
  const sameYear = da.getFullYear() === db.getFullYear();
  const left = da.toLocaleDateString(undefined, { month: "short", ...(sameYear ? {} : { year: "numeric" }) });
  const right = db.toLocaleDateString(undefined, { month: "short", year: "numeric" });
  return `${left} – ${right}`;
}

function removeItem(item: CalItem) {
  const s = store.get();
  if (item.kind === "event") {
    const ev = s.events.find((e) => e.id === item.id);
    if (ev) deleteEvent(ev);
  } else if (item.kind === "time") {
    const tb = s.timeBlocks.find((b) => b.id === item.id);
    if (tb) deleteTimeBlock(tb);
  } else {
    const b = s.taskBlocks.find((x) => x.id === item.id);
    if (b) deleteTaskBlock(b, item.title);
  }
}

// ---------- Create popover (after clicking or dragging on empty time) ----------

type Kind = "event" | "task" | "routine";

function CreatePopover({ range, anchor, onClose }: { range: Range; anchor: Anchor; onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<Kind>("event");
  const wd = parseDate(range.date).toLocaleDateString(undefined, { weekday: "long" });

  function submit() {
    const t = title.trim();
    if (!t) return;
    const start = atMinutes(range.date, range.start);
    const end = atMinutes(range.date, Math.min(range.end, 1439));
    if (kind === "event") createEvent({ title: t, start_at: start, end_at: end, color: "#2f7ff0" });
    else if (kind === "task") {
      const task = createTask({ title: t, duration_minutes: range.end - range.start });
      scheduleTask(task, start, end);
    } else {
      createTimeBlock({
        title: t, weekday: backendWeekday(parseDate(range.date)),
        start_time: timeString(range.start) + ":00", end_time: timeString(Math.min(range.end, 1439)) + ":00",
        start_date: range.date, until_date: null, color: "#8e4ec6",
      });
    }
    onClose();
  }

  return (
    <Popover anchor={anchor} onClose={onClose} placement="right" width={300} className="create-pop">
      <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <input autoFocus className="pop-title" placeholder={kind === "task" ? "Task name" : kind === "routine" ? "Routine name" : "Event name"}
          value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" />
        <Segmented size="sm" label="Type" value={kind} onChange={setKind}
          options={[{ value: "event", label: "Event" }, { value: "task", label: "Task" }, { value: "routine", label: "Routine" }]} />
        <div className="pop-line muted">
          <Icon name={kind === "routine" ? "repeat" : "clock"} size={15} />
          {kind === "routine" ? `Every ${wd}, ` : `${relDay(range.date)}, `}
          {fmtRange(range.start, range.end)} · {fmtDuration(range.end - range.start)}
        </div>
        <div className="pop-actions">
          <button type="button" className="btn ghost sm" onClick={() => {
            onClose();
            openQuickAdd({ mode: kind, text: title, date: range.date, start: range.start, end: range.end });
          }}>More options</button>
          <button className="btn primary sm" disabled={!title.trim()}>Create</button>
        </div>
      </form>
    </Popover>
  );
}

// ---------- Unscheduled tasks you can drag into the calendar ----------

function TaskTray({ onDragStart, canDrag }: { onDragStart: (t: Task, e: RPointerEvent) => void; canDrag: boolean }) {
  const tasks = useData((s) => s.tasks);
  const blocks = useData((s) => s.taskBlocks);
  const projects = useData((s) => s.projects);
  const [filter, setFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const today = todayIso();

  const list = useMemo(() => {
    const upcoming = new Set(blocks.filter((b) => b.end_at.slice(0, 10) >= today).map((b) => b.task_id));
    const q = query.trim().toLowerCase();
    return tasks
      .filter((t) => !t.done && !upcoming.has(t.id))
      .filter((t) => filter === "all" || (filter === "general" ? t.project_id === null : t.project_id === Number(filter)))
      .filter((t) => !q || t.title.toLowerCase().includes(q))
      .sort(compareTasks);
  }, [tasks, blocks, filter, query, today]);

  const colors = new Map(projects.map((p) => [p.id, p.color]));

  return (
    <div className="tray">
      <div className="tray-head">
        <h2>Unscheduled</h2>
        <span className="count">{list.length}</span>
      </div>
      <div className="tray-filters">
        <input type="search" placeholder="Filter…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Filter tasks" />
        <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Board">
          <option value="all">All</option>
          <option value="general">General</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <p className="tray-hint muted">{canDrag ? "Drag onto the calendar to time-block." : "Switch to a day or week view to drag tasks in."}</p>
      <div className="tray-list">
        {list.map((t) => (
          <div key={t.id} className={"tray-task" + (canDrag ? " draggable" : "")}
            onPointerDown={canDrag ? (e) => { if (!(e.target as HTMLElement).closest(".task-check")) onDragStart(t, e); } : undefined}
            onClick={canDrag ? undefined : () => openTask(t.id)}>
            <TaskCheck done={t.done} priority={t.priority} onToggle={() => toggleTaskDone(t)} label={`Complete ${t.title}`} />
            <span className="tray-title">{t.title}</span>
            <span className="tray-meta">
              {t.project_id && <span className="dot" style={{ background: colors.get(t.project_id) }} />}
              {t.deadline && <span className={t.deadline < today ? "danger" : ""}>{relDay(t.deadline)}</span>}
              <span>{fmtDuration(t.duration_minutes ?? 60)}</span>
            </span>
          </div>
        ))}
        {list.length === 0 && <p className="muted small tray-empty">Everything open has a time. Nice.</p>}
      </div>
    </div>
  );
}
