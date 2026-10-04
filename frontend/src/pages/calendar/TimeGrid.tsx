import {
  CSSProperties, memo, MutableRefObject, PointerEvent as RPointerEvent, useCallback, useEffect,
  useLayoutEffect, useMemo, useRef, useState,
} from "react";
import { Anchor, anchorOf, TaskCheck } from "../../components/primitives";
import { Icon } from "../../components/Icon";
import { CalItem, layoutDay } from "../../lib/derive";
import { Task } from "../../api";
import {
  atMinutes, backendWeekday, fmtHour, fmtRange, fmtTime, nowMinutes, parseDate, timeString, todayIso,
} from "../../dates";
import {
  scheduleTask, store, toggleTaskDone, updateEvent, updateTaskBlock, updateTimeBlock,
} from "../../store";
import { prefs, setPref, usePrefs } from "../../lib/prefs";
import { toast } from "../../lib/toast";
import { openTask } from "../../lib/ui";

const SNAP = 15;
const DAY_MIN = 24 * 60;
const MOVE_THRESHOLD = 4;
const LONG_PRESS_MS = 320;

export type Range = { date: string; start: number; end: number };

type Ghost = Range & { title: string; color: string; kind: CalItem["kind"] | "new"; key?: string };

type Gesture = {
  mode: "move" | "resize" | "create" | "task";
  item?: CalItem;
  task?: Task;
  pointerType: string;
  startX: number;
  startY: number;
  active: boolean;
  grab: number;       // minutes between the pointer and the item's start
  duration: number;
  anchorMin: number;  // create: where the drag started
  anchorDate: string;
  last: Ghost | null;
  lastX: number;
  lastY: number;
  timer?: number;
  downAt: number;
  locked?: boolean;   // a routine that can be opened but not dragged
};

export type DragApi = { startTask: (task: Task, e: RPointerEvent) => void };

const snap = (m: number) => Math.round(m / SNAP) * SNAP;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function TimeGrid({
  days, items, dueByDay, hourHeight, selectedKey, creating, onSelect, onCreate, onDayClick, dragApi, onSwipe,
}: {
  days: string[];
  items: Map<string, CalItem[]>;
  dueByDay: Map<string, Task[]>;
  hourHeight: number;
  selectedKey: string | null;
  creating: Range | null;
  onSelect: (item: CalItem, anchor: Anchor) => void;
  onCreate: (range: Range, anchor: Anchor) => void;
  onDayClick: (date: string) => void;
  dragApi: MutableRefObject<DragApi | null>;
  onSwipe: (dir: 1 | -1) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const colRefs = useRef(new Map<string, HTMLDivElement>());
  const gesture = useRef<Gesture | null>(null);
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const [now, setNow] = useState(nowMinutes);
  const [today, setToday] = useState(todayIso);
  const scrollVel = useRef(0);
  const raf = useRef(0);

  useEffect(() => {
    const t = window.setInterval(() => { setNow(nowMinutes()); setToday(todayIso()); }, 30_000);
    return () => window.clearInterval(t);
  }, []);

  // Start near the current time (or the start of the working day).
  const firstDay = days[0];
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const showsToday = days.includes(todayIso());
    const target = showsToday ? nowMinutes() - 90 : prefs.get().workStart - 45;
    el.scrollTop = Math.max(0, (target / 60) * hourHeight);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstDay, days.length]);

  // Ctrl/⌘ + wheel zooms the hour height, keeping the time under the pointer in place.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const hh = prefs.get().hourHeight;
      const next = clamp(Math.round(hh * (e.deltaY > 0 ? 0.9 : 1.1)), 28, 140);
      if (next === hh) return;
      const rect = el.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const minuteAtPointer = ((el.scrollTop + y - 52) / hh) * 60;
      setPref("hourHeight", next);
      requestAnimationFrame(() => { el.scrollTop = (minuteAtPointer / 60) * next - y + 52; });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // ---------- Hit testing ----------

  const hit = useCallback((x: number, y: number): { date: string; minutes: number } | null => {
    let best: { date: string; rect: DOMRect } | null = null;
    let bestDist = Infinity;
    for (const [date, el] of colRefs.current) {
      const r = el.getBoundingClientRect();
      const dist = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
      if (dist < bestDist) { bestDist = dist; best = { date, rect: r }; }
    }
    if (!best) return null;
    return { date: best.date, minutes: ((y - best.rect.top) / prefs.get().hourHeight) * 60 };
  }, []);

  // ---------- Gestures ----------

  const computeGhost = useCallback((g: Gesture, x: number, y: number): Ghost | null => {
    const h = hit(x, y);
    if (!h) return null;
    const title = g.item?.title ?? g.task?.title ?? "New event";
    const color = g.item?.color ?? "var(--accent)";
    const kind = g.item?.kind ?? "new";
    if (g.mode === "move" || g.mode === "task") {
      const start = clamp(snap(h.minutes - g.grab), 0, DAY_MIN - g.duration);
      return { date: h.date, start, end: start + g.duration, title, color, kind, key: g.item?.key };
    }
    if (g.mode === "resize") {
      const it = g.item!;
      const end = clamp(snap(h.minutes), it.start + SNAP, DAY_MIN);
      return { date: it.date, start: it.start, end, title, color, kind, key: it.key };
    }
    // create: a range on the day where the drag began
    const m = clamp(snap(h.minutes), 0, DAY_MIN);
    let start = Math.min(g.anchorMin, m);
    let end = Math.max(g.anchorMin, m);
    if (end - start < SNAP) { start = g.anchorMin; end = g.anchorMin + SNAP; }
    return { date: g.anchorDate, start, end, title: "", color: "var(--accent)", kind: "new" };
  }, [hit]);

  const stopAutoScroll = () => {
    scrollVel.current = 0;
    cancelAnimationFrame(raf.current);
    raf.current = 0;
  };

  const autoScroll = useCallback(() => {
    const el = scrollRef.current;
    const g = gesture.current;
    if (!el || !g || !scrollVel.current) { raf.current = 0; return; }
    el.scrollTop += scrollVel.current;
    const next = computeGhost(g, g.lastX, g.lastY);
    if (next) { g.last = next; setGhost(next); }
    raf.current = requestAnimationFrame(autoScroll);
  }, [computeGhost]);

  const preventTouchScroll = useCallback((e: TouchEvent) => {
    if (gesture.current?.active) e.preventDefault();
  }, []);

  const finish = useCallback((commit: boolean) => {
    const g = gesture.current;
    gesture.current = null;
    stopAutoScroll();
    window.clearTimeout(g?.timer);
    document.body.classList.remove("is-dragging");
    window.removeEventListener("touchmove", preventTouchScroll);
    if (!g) return;

    if (!g.active) {
      setGhost(null);
      if (!commit) return;
      // A tap or click without dragging.
      if (g.item) {
        const el = document.querySelector(`[data-key="${g.item.key}"]`);
        if (el) onSelect(g.item, anchorOf(el));
      } else if (g.mode === "create") {
        const start = clamp(Math.floor(g.anchorMin / 30) * 30, 0, DAY_MIN - 60);
        const range = { date: g.anchorDate, start, end: start + 60 };
        setGhost({ ...range, title: "", color: "var(--accent)", kind: "new" });
        requestAnimationFrame(() => {
          const el = document.querySelector("[data-ghost]");
          onCreate(range, el ? anchorOf(el) : { x: g.startX, y: g.startY });
          setGhost(null);
        });
      } else if (g.task) {
        openTask(g.task.id);
      }
      return;
    }

    const last = g.last;
    if (!commit || !last) { setGhost(null); return; }

    if (g.mode === "create") {
      requestAnimationFrame(() => {
        const el = document.querySelector("[data-ghost]");
        onCreate({ date: last.date, start: last.start, end: last.end }, el ? anchorOf(el) : { x: g.lastX, y: g.lastY });
        setGhost(null);
      });
      return;
    }
    setGhost(null);
    if (g.mode === "task" && g.task) {
      scheduleTask(g.task, atMinutes(last.date, last.start), atMinutes(last.date, last.end));
      return;
    }
    const it = g.item!;
    if (last.date === it.date && last.start === it.start && last.end === it.end) return;
    commitMove(it, last);
  }, [onCreate, onSelect, preventTouchScroll]);

  const begin = useCallback((g: Gesture) => {
    g.active = true;
    document.body.classList.add("is-dragging");
    if (g.pointerType === "touch") navigator.vibrate?.(8);
    const next = computeGhost(g, g.lastX, g.lastY);
    g.last = next;
    setGhost(next);
  }, [computeGhost]);

  const startGesture = useCallback((e: RPointerEvent, g: Omit<Gesture, "startX" | "startY" | "active" | "last" | "lastX" | "lastY" | "pointerType" | "downAt">, immediate = false) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (gesture.current) return;
    const state: Gesture = {
      ...g, pointerType: e.pointerType, startX: e.clientX, startY: e.clientY, active: false,
      last: null, lastX: e.clientX, lastY: e.clientY, downAt: Date.now(),
    };
    gesture.current = state;
    if (e.pointerType !== "touch") e.preventDefault();
    if (state.locked) { /* click or tap only */ }
    else if (immediate) begin(state);
    else if (e.pointerType === "touch") {
      window.addEventListener("touchmove", preventTouchScroll, { passive: false });
      state.timer = window.setTimeout(() => { if (gesture.current === state) begin(state); }, LONG_PRESS_MS);
    }

    const onMove = (ev: PointerEvent) => {
      const cur = gesture.current;
      if (!cur) return;
      cur.lastX = ev.clientX;
      cur.lastY = ev.clientY;
      const dist = Math.hypot(ev.clientX - cur.startX, ev.clientY - cur.startY);
      if (!cur.active) {
        if (cur.locked) {
          // Locked routines never drag; a real move means the pointer went elsewhere.
          if (dist > 10) cleanup(false);
          return;
        }
        if (cur.pointerType === "touch") {
          // Finger moved before the long press: it's a scroll, not a drag.
          if (dist > 8) cleanup(false);
          return;
        }
        if (dist < MOVE_THRESHOLD) return;
        begin(cur);
      }
      const next = computeGhost(cur, ev.clientX, ev.clientY);
      if (next) { cur.last = next; setGhost(next); }
      const el = scrollRef.current;
      if (el) {
        const r = el.getBoundingClientRect();
        const edge = 48;
        const v = ev.clientY < r.top + edge + 40 ? -Math.ceil((r.top + edge + 40 - ev.clientY) / 4)
          : ev.clientY > r.bottom - edge ? Math.ceil((ev.clientY - (r.bottom - edge)) / 4) : 0;
        scrollVel.current = v;
        if (v && !raf.current) raf.current = requestAnimationFrame(autoScroll);
      }
    };
    const onUp = () => cleanup(true);
    const onCancel = () => cleanup(false);
    const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape") cleanup(false); };
    const cleanup = (commit: boolean) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey, true);
      finish(commit);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey, true);
  }, [autoScroll, begin, computeGhost, finish, preventTouchScroll]);

  // Lets the task tray (outside the grid) drag tasks in.
  useEffect(() => {
    dragApi.current = {
      startTask: (task, e) => {
        const duration = task.duration_minutes ?? 60;
        startGesture(e, {
          mode: "task", task, grab: Math.min(15, duration / 4), duration, anchorMin: 0, anchorDate: days[0],
        }, e.pointerType === "mouse");
      },
    };
  }, [dragApi, startGesture, days]);

  const onItemDown = useCallback((e: RPointerEvent, item: CalItem, resize: boolean) => {
    e.stopPropagation();
    const locked = item.kind === "time" && !prefs.get().routinesDraggable;
    if (locked && resize) return;
    const h = hit(e.clientX, e.clientY);
    startGesture(e, {
      mode: resize ? "resize" : "move", item, duration: item.end - item.start, locked,
      grab: h ? h.minutes - item.start : 0, anchorMin: item.start, anchorDate: item.date,
    }, resize && e.pointerType !== "touch");
  }, [hit, startGesture]);

  const onBodyDown = useCallback((e: RPointerEvent<HTMLDivElement>, date: string) => {
    if ((e.target as HTMLElement).closest("[data-key]")) return;
    const h = hit(e.clientX, e.clientY);
    if (!h) return;
    startGesture(e, { mode: "create", grab: 0, duration: 60, anchorMin: clamp(Math.floor(h.minutes / SNAP) * SNAP, 0, DAY_MIN - SNAP), anchorDate: date });
  }, [hit, startGesture]);

  const onDueDown = useCallback((e: RPointerEvent, task: Task) => {
    e.stopPropagation();
    const duration = task.duration_minutes ?? 60;
    startGesture(e, { mode: "task", task, grab: Math.min(15, duration / 4), duration, anchorMin: 0, anchorDate: days[0] });
  }, [startGesture, days]);

  // ---------- Swipe between periods on touch screens ----------
  const swipe = useRef<{ x: number; y: number; t: number } | null>(null);

  const layouts = useMemo(() => {
    const m = new Map<string, Map<string, { lane: number; lanes: number }>>();
    for (const d of days) m.set(d, layoutDay(items.get(d) ?? []));
    return m;
  }, [days, items]);

  const dragKey = ghost?.key && gesture.current?.active ? ghost.key : null;
  const routinesLocked = !usePrefs((p) => p.routinesDraggable);
  const totalHeight = 24 * hourHeight;
  const hours = useMemo(() => Array.from({ length: 24 }, (_, h) => h), []);

  return (
    <div className="tg" style={{ "--hh": `${hourHeight}px`, "--cols": days.length } as CSSProperties}>
      <div className="tg-scroll" ref={scrollRef}
        onTouchStart={(e) => { if (e.touches.length === 1) swipe.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() }; }}
        onTouchEnd={(e) => {
          const s = swipe.current;
          swipe.current = null;
          if (!s || gesture.current?.active) return;
          const t = e.changedTouches[0];
          const dx = t.clientX - s.x;
          const dy = t.clientY - s.y;
          if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 2 && Date.now() - s.t < 600) onSwipe(dx < 0 ? 1 : -1);
        }}>
        <div className="tg-head">
          <div className="tg-gutter-head" />
          {days.map((d) => (
            <DayHeader key={d} date={d} today={today} due={dueByDay.get(d)} onDayClick={onDayClick} onDueDown={onDueDown} />
          ))}
        </div>
        <div className="tg-body" style={{ height: totalHeight }}>
          <div className="tg-gutter">
            {hours.map((h) => h > 0 && (
              <span key={h} className="tg-hour" style={{ top: h * hourHeight }}>{fmtHour(h)}</span>
            ))}
            {days.includes(today) && (
              <span className="tg-now-label" style={{ top: (now / 60) * hourHeight }}>{fmtTime(now, true)}</span>
            )}
          </div>
          {days.map((d) => (
            <DayColumn key={d} date={d} items={items.get(d)} layout={layouts.get(d)!} hourHeight={hourHeight}
              isToday={d === today} now={d === today ? now : -1}
              ghost={ghost && ghost.date === d ? ghost : creating && creating.date === d ? { ...creating, title: "", color: "var(--accent)", kind: "new" } : null}
              dragKey={dragKey} selectedKey={selectedKey} routinesLocked={routinesLocked}
              colRef={(el) => { if (el) colRefs.current.set(d, el); else colRefs.current.delete(d); }}
              onBodyDown={onBodyDown} onItemDown={onItemDown} />
          ))}
        </div>
      </div>
    </div>
  );
}

function commitMove(it: CalItem, to: Range) {
  const s = store.get();
  if (it.kind === "event") {
    updateEvent(it.id, { start_at: atMinutes(to.date, to.start), end_at: atMinutes(to.date, Math.min(to.end, DAY_MIN - 1)) });
  } else if (it.kind === "task_block") {
    updateTaskBlock(it.id, atMinutes(to.date, to.start), atMinutes(to.date, Math.min(to.end, DAY_MIN - 1)));
  } else {
    const tb = s.timeBlocks.find((b) => b.id === it.id);
    if (!tb) return;
    const before = { weekday: tb.weekday, start_time: tb.start_time, end_time: tb.end_time };
    const weekday = backendWeekday(parseDate(to.date));
    updateTimeBlock(it.id, {
      weekday, start_time: timeString(to.start) + ":00", end_time: timeString(Math.min(to.end, DAY_MIN - 1)) + ":00",
    });
    toast(`Moved every “${tb.title}”`, { action: { label: "Undo", run: () => updateTimeBlock(it.id, before) } });
  }
}

const DayHeader = memo(function DayHeader({ date, today, due, onDayClick, onDueDown }: {
  date: string; today: string; due?: Task[];
  onDayClick: (d: string) => void;
  onDueDown: (e: RPointerEvent, t: Task) => void;
}) {
  const d = parseDate(date);
  const weekend = d.getDay() === 0 || d.getDay() === 6;
  return (
    <div className={"tg-day-head" + (date === today ? " today" : "") + (weekend ? " weekend" : "") + (date < today ? " past" : "")}>
      <button className="tg-day-btn" onClick={() => onDayClick(date)} title="Open day">
        <span className="dow">{d.toLocaleDateString(undefined, { weekday: "short" })}</span>
        <span className="dom">{d.getDate()}</span>
      </button>
      {due && due.length > 0 && (
        <div className="tg-due">
          {due.slice(0, 2).map((t) => (
            <button key={t.id} className={"due-chip" + (t.priority === 3 ? " high" : "")} title={`Due: ${t.title} — drag to schedule`}
              onPointerDown={(e) => onDueDown(e, t)}>
              <Icon name="flag" size={11} />
              <span className="truncate">{t.title}</span>
            </button>
          ))}
          {due.length > 2 && <span className="due-more">+{due.length - 2}</span>}
        </div>
      )}
    </div>
  );
});

const DayColumn = memo(function DayColumn({
  date, items, layout, hourHeight, isToday, now, ghost, dragKey, selectedKey, routinesLocked, colRef, onBodyDown, onItemDown,
}: {
  date: string;
  items?: CalItem[];
  layout: Map<string, { lane: number; lanes: number }>;
  hourHeight: number;
  isToday: boolean;
  now: number;
  ghost: Ghost | null;
  dragKey: string | null;
  selectedKey: string | null;
  routinesLocked: boolean;
  colRef: (el: HTMLDivElement | null) => void;
  onBodyDown: (e: RPointerEvent<HTMLDivElement>, date: string) => void;
  onItemDown: (e: RPointerEvent, item: CalItem, resize: boolean) => void;
}) {
  const d = parseDate(date);
  const weekend = d.getDay() === 0 || d.getDay() === 6;
  const { workStart, workEnd } = prefs.get();
  return (
    <div ref={colRef} className={"tg-col" + (isToday ? " today" : "") + (weekend ? " weekend" : "")} data-date={date}
      onPointerDown={(e) => onBodyDown(e, date)}>
      <div className="tg-off" style={{ top: 0, height: (workStart / 60) * hourHeight }} />
      <div className="tg-off" style={{ top: (workEnd / 60) * hourHeight, bottom: 0 }} />
      {items?.map((it) => {
        const l = layout.get(it.key) ?? { lane: 0, lanes: 1 };
        return (
          <EventBlock key={it.key} item={it} lane={l.lane} lanes={l.lanes} hourHeight={hourHeight}
            dragging={dragKey === it.key} selected={selectedKey === it.key}
            locked={routinesLocked && it.kind === "time"} onDown={onItemDown} />
        );
      })}
      {ghost && (
        <div className={"ev ghost kind-" + ghost.kind} data-ghost
          style={{
            top: (ghost.start / 60) * hourHeight, height: Math.max(((ghost.end - ghost.start) / 60) * hourHeight - 2, 14),
            "--c": ghost.color,
          } as CSSProperties}>
          {ghost.title && <span className="ev-title">{ghost.title}</span>}
          <span className="ev-time">{fmtRange(ghost.start, ghost.end)}</span>
        </div>
      )}
      {now >= 0 && <div className="tg-now" style={{ top: (now / 60) * hourHeight }} />}
    </div>
  );
});

const EventBlock = memo(function EventBlock({ item, lane, lanes, hourHeight, dragging, selected, locked, onDown }: {
  item: CalItem; lane: number; lanes: number; hourHeight: number; dragging: boolean; selected: boolean; locked: boolean;
  onDown: (e: RPointerEvent, item: CalItem, resize: boolean) => void;
}) {
  const top = (item.start / 60) * hourHeight;
  const height = Math.max(((item.end - item.start) / 60) * hourHeight - 2, 16);
  const compact = height < 34;
  const width = 100 / lanes;
  const style = {
    top, height,
    left: `calc(${lane * width}% + 2px)`,
    width: `calc(${width}% - ${lanes > 1 ? 3 : 6}px)`,
    "--c": item.color,
  } as CSSProperties;
  const task = item.kind === "task_block" && item.taskId !== undefined
    ? store.get().tasks.find((t) => t.id === item.taskId) : undefined;
  return (
    <div className={`ev kind-${item.kind}` + (compact ? " compact" : "") + (dragging ? " dragging" : "") + (selected ? " selected" : "") + (item.done ? " done" : "") + (locked ? " locked" : "")}
      style={style} data-key={item.key} tabIndex={0} role="button"
      aria-label={`${item.title}, ${fmtRange(item.start, item.end)}`}
      onPointerDown={(e) => onDown(e, item, false)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          (e.currentTarget as HTMLElement).dispatchEvent(new CustomEvent("cal-open", { bubbles: true, detail: item.key }));
        }
      }}>
      <div className="ev-inner">
        {task && (
          <TaskCheck done={task.done} priority={task.priority} onToggle={() => toggleTaskDone(task)} label="Complete task" />
        )}
        <div className="ev-text">
          <span className="ev-title">
            {item.kind === "time" && <Icon name="repeat" size={11} className="ev-icon" />}
            {item.title}
          </span>
          {!compact && <span className="ev-time">{fmtRange(item.start, item.end)}</span>}
        </div>
      </div>
      {!locked && <div className="ev-resize" onPointerDown={(e) => onDown(e, item, true)} aria-hidden="true" />}
    </div>
  );
});
