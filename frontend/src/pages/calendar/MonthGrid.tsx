import { CSSProperties, memo, PointerEvent as RPointerEvent, useCallback, useRef, useState } from "react";
import { Anchor, anchorOf } from "../../components/primitives";
import { Icon } from "../../components/Icon";
import { CalItem } from "../../lib/derive";
import { Task } from "../../api";
import { addDaysIso, backendWeekday, daysBetween, fmtTime, parseDate, todayIso, timeString, atMinutes } from "../../dates";
import { store, updateEvent, updateTaskBlock, updateTimeBlock } from "../../store";
import { toast } from "../../lib/toast";
import { openTask } from "../../lib/ui";

const MAX_VISIBLE = 3;

type Drag = { item: CalItem; startX: number; startY: number; active: boolean };

// Six weeks. Drag an item to another day to move it (its time of day is kept).
export function MonthGrid({ days, month, items, dueByDay, selectedKey, onSelect, onDayOpen, onDayCreate }: {
  days: string[];
  month: number;
  items: Map<string, CalItem[]>;
  dueByDay: Map<string, Task[]>;
  selectedKey: string | null;
  onSelect: (item: CalItem, anchor: Anchor) => void;
  onDayOpen: (date: string) => void;
  onDayCreate: (date: string) => void;
}) {
  const drag = useRef<Drag | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const today = todayIso();
  const names = days.slice(0, 7).map((d) => parseDate(d).toLocaleDateString(undefined, { weekday: "short" }));

  const onItemDown = useCallback((e: RPointerEvent, item: CalItem) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.stopPropagation();
    if (e.pointerType === "mouse") e.preventDefault();
    drag.current = { item, startX: e.clientX, startY: e.clientY, active: false };
    const target = e.currentTarget as HTMLElement;

    const onMove = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      if (!d.active) {
        if (ev.pointerType === "touch" || Math.hypot(ev.clientX - d.startX, ev.clientY - d.startY) < 5) return;
        d.active = true;
        setDragKey(d.item.key);
        document.body.classList.add("is-dragging");
      }
      const cell = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>("[data-date]");
      setOver(cell?.dataset.date ?? null);
    };
    const done = (commit: boolean) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      const d = drag.current;
      drag.current = null;
      document.body.classList.remove("is-dragging");
      setDragKey(null);
      setOver((date) => {
        if (d && commit) {
          if (!d.active) requestAnimationFrame(() => onSelect(d.item, anchorOf(target)));
          else if (date && date !== d.item.date) requestAnimationFrame(() => moveToDay(d.item, date));
        }
        return null;
      });
    };
    const onUp = () => done(true);
    const onCancel = () => done(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  }, [onSelect]);

  return (
    <div className="month">
      <div className="month-dow">{names.map((n) => <span key={n}>{n}</span>)}</div>
      <div className="month-grid">
        {days.map((d) => (
          <MonthCell key={d} date={d} inMonth={parseDate(d).getMonth() === month} today={today}
            items={items.get(d)} due={dueByDay.get(d)} over={over === d} dragKey={dragKey} selectedKey={selectedKey}
            onItemDown={onItemDown} onDayOpen={onDayOpen} onDayCreate={onDayCreate} />
        ))}
      </div>
    </div>
  );
}

function moveToDay(it: CalItem, date: string) {
  const s = store.get();
  if (it.kind === "event") {
    const ev = s.events.find((e) => e.id === it.id);
    if (!ev) return;
    const shift = daysBetween(ev.start_at.slice(0, 10), date);
    updateEvent(ev.id, {
      start_at: date + ev.start_at.slice(10),
      end_at: addDaysIso(ev.end_at.slice(0, 10), shift) + ev.end_at.slice(10),
    });
  } else if (it.kind === "task_block") {
    updateTaskBlock(it.id, atMinutes(date, it.start), atMinutes(date, Math.min(it.end, 1439)));
  } else {
    const tb = s.timeBlocks.find((b) => b.id === it.id);
    if (!tb) return;
    const before = tb.weekday;
    updateTimeBlock(tb.id, { weekday: backendWeekday(parseDate(date)), start_time: timeString(it.start) + ":00" });
    toast(`Moved every “${tb.title}”`, { action: { label: "Undo", run: () => updateTimeBlock(tb.id, { weekday: before }) } });
  }
}

const MonthCell = memo(function MonthCell({
  date, inMonth, today, items = [], due = [], over, dragKey, selectedKey, onItemDown, onDayOpen, onDayCreate,
}: {
  date: string; inMonth: boolean; today: string; items?: CalItem[]; due?: Task[]; over: boolean;
  dragKey: string | null; selectedKey: string | null;
  onItemDown: (e: RPointerEvent, item: CalItem) => void;
  onDayOpen: (d: string) => void;
  onDayCreate: (d: string) => void;
}) {
  const d = parseDate(date);
  const entries = items.length + due.length;
  const visible = items.slice(0, Math.max(0, MAX_VISIBLE - (due.length ? 1 : 0)));
  const hidden = entries - visible.length - (due.length ? 1 : 0);
  return (
    <div className={"m-cell" + (inMonth ? "" : " out") + (date === today ? " today" : "") + (over ? " over" : "") + (date < today ? " past" : "")}
      data-date={date} onClick={(e) => { if (e.target === e.currentTarget) onDayCreate(date); }}>
      <button className="m-date" onClick={() => onDayOpen(date)} aria-label={`Open ${d.toDateString()}`}>
        {d.getDate() === 1 ? d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : d.getDate()}
      </button>
      <div className="m-items">
        {due.length > 0 && (
          <button className="m-due" onClick={() => (due.length === 1 ? openTask(due[0].id) : onDayOpen(date))}>
            <Icon name="flag" size={11} /> {due.length === 1 ? due[0].title : `${due.length} due`}
          </button>
        )}
        {visible.map((it) => (
          <div key={it.key} data-key={it.key} role="button" tabIndex={0}
            className={`m-item kind-${it.kind}` + (dragKey === it.key ? " dragging" : "") + (selectedKey === it.key ? " selected" : "") + (it.done ? " done" : "")}
            style={{ "--c": it.color } as CSSProperties}
            onPointerDown={(e) => onItemDown(e, it)}>
            <span className="m-dot" />
            <span className="m-time">{fmtTime(it.start, true)}</span>
            <span className="m-title">{it.title}</span>
          </div>
        ))}
        {hidden > 0 && <button className="m-more" onClick={() => onDayOpen(date)}>+{hidden} more</button>}
      </div>
    </div>
  );
});
