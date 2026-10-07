import { useEffect, useRef, useState } from "react";
import { Anchor, ColorPicker, IconButton, Popover, Segmented, TaskCheck } from "../../components/primitives";
import { Icon } from "../../components/Icon";
import { CalItem, expandRange } from "../../lib/derive";
import {
  changeOccurrence, createEvent, deleteEvent, deleteRoutineAt, deleteTaskBlock, reminderFor, restoreOccurrence,
  setReminder, splitRoutine,
  store, toggleTaskDone, updateEvent, updateTaskBlock, updateTimeBlock, useData,
} from "../../store";
import { atMinutes, backendWeekday, fmtDayLong, fmtDuration, parseDate, timeString } from "../../dates";
import { openTask, Scope } from "../../lib/ui";
import { toast } from "../../lib/toast";
import { ReminderKind } from "../../api";

const REMINDERS = [
  { value: "", label: "No reminder" },
  { value: "0", label: "At start" },
  { value: "5", label: "5 min before" },
  { value: "10", label: "10 min before" },
  { value: "15", label: "15 min before" },
  { value: "30", label: "30 min before" },
  { value: "60", label: "1 hour before" },
  { value: "1440", label: "1 day before" },
];

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function saveEventDetails(id: number, typed: { location: string; notes: string }) {
  const current = store.get().events.find((e) => e.id === id);
  if (!current) return;
  const change = { location: typed.location.trim(), notes: typed.notes.trim() };
  if (change.location !== current.location || change.notes !== current.notes) updateEvent(id, change);
}

export function isLink(value: string) {
  return /^https?:\/\/\S+$/i.test(value.trim());
}

function toInput(m: number) {
  return timeString(m);
}
function fromInput(v: string): number | null {
  const [h, m] = v.split(":").map(Number);
  return Number.isNaN(h) ? null : h * 60 + (m || 0);
}

// Details and quick edits for one calendar item. Changes apply as you make them.
export function ItemPopover({ item, anchor, onClose }: { item: CalItem; anchor: Anchor; onClose: () => void }) {
  const data = useData();
  const reminderKind: ReminderKind = item.kind === "time" ? "time_block" : item.kind;
  const reminder = reminderFor(data.reminders, reminderKind, item.id);
  const [title, setTitle] = useState(item.title);

  const ev = item.kind === "event" ? data.events.find((e) => e.id === item.id) : undefined;
  const [location, setLocation] = useState(ev?.location ?? "");
  const [notes, setNotes] = useState(ev?.notes ?? "");
  const details = useRef({ location, notes });
  details.current = { location, notes };

  // Closing the popover doesn't always blur the field first, so save what was typed on the way out.
  const eventId = ev?.id;
  useEffect(() => () => {
    if (eventId !== undefined) saveEventDetails(eventId, details.current);
  }, [eventId]);
  // Which occurrences a time change to a routine applies to.
  const [scope, setScope] = useState<Scope>("one");
  const tb = item.kind === "time" ? data.timeBlocks.find((b) => b.id === item.id) : undefined;
  const onDate = item.occurrence ?? item.date;
  const block = item.kind === "task_block" ? data.taskBlocks.find((b) => b.id === item.id) : undefined;
  const task = block ? data.tasks.find((t) => t.id === block.task_id) : undefined;
  if (!ev && !tb && !block) return null;

  function setTimes(date: string, start: number, end: number) {
    if (end <= start) return;
    if (ev) updateEvent(ev.id, { start_at: atMinutes(date, start), end_at: atMinutes(date, end) });
    if (block) updateTaskBlock(block.id, atMinutes(date, start), atMinutes(date, end));
    if (tb) {
      const start_time = timeString(start) + ":00";
      const end_time = timeString(end) + ":00";
      const weekday = backendWeekday(parseDate(date));
      if (scope === "one") {
        changeOccurrence(tb, onDate, { skipped: false, new_date: date === onDate ? null : date, start_time, end_time });
      } else if (scope === "following") {
        // Splitting makes a new routine, so this popover (for the old one) closes.
        splitRoutine(tb, onDate, { weekday, start_time, end_time, start_date: date < onDate ? date : onDate });
        toast(`Changed “${tb.title}” from ${fmtDayLong(onDate)} onward`);
      } else {
        updateTimeBlock(tb.id, { weekday, start_time, end_time });
      }
    }
  }

  function saveTitle() {
    const t = title.trim();
    if (!t || t === item.title) return setTitle(item.title);
    if (ev) updateEvent(ev.id, { title: t });
    if (tb) updateTimeBlock(tb.id, { title: t });
  }

  function saveDetails() {
    if (ev) saveEventDetails(ev.id, { location, notes });
  }

  function remove() {
    onClose();
    if (ev) deleteEvent(ev);
    if (tb) deleteRoutineAt(tb, onDate);
    if (block && task) deleteTaskBlock(block, task.title);
  }

  function duplicate() {
    if (!ev) return;
    onClose();
    createEvent({ title: ev.title, start_at: ev.start_at, end_at: ev.end_at, color: ev.color, location: ev.location, notes: ev.notes });
  }

  const color = ev?.color ?? tb?.color ?? item.color;
  const clashing = item.done ? [] : (expandRange(item.date, item.date, data).get(item.date) ?? [])
    .filter((o) => o.key !== item.key && !o.done && o.start < item.end && item.start < o.end);

  return (
    <Popover anchor={anchor} onClose={onClose} placement="right" width={320} className="item-pop">
      <div className="pop-head">
        <span className="pop-kind" style={{ color }}>
          <Icon name={item.kind === "time" ? "repeat" : item.kind === "event" ? "calendar" : "tasks"} size={14} />
          {item.kind === "time" ? "Routine" : item.kind === "event" ? "Event" : "Task block"}
        </span>
        <div className="row-gap tight">
          {ev && <IconButton icon="copy" size={16} label="Duplicate" onClick={duplicate} />}
          <IconButton icon="trash" size={16} label={block ? "Remove from calendar" : "Delete"} onClick={remove} />
          <IconButton icon="close" size={16} label="Close" onClick={onClose} />
        </div>
      </div>

      {task ? (
        <div className="pop-title-row">
          <TaskCheck done={task.done} priority={task.priority} onToggle={() => toggleTaskDone(task)} label="Complete task" />
          <button className={"pop-task-title" + (task.done ? " is-done" : "")} onClick={() => { onClose(); openTask(task.id); }}>
            {task.title}
            <Icon name="arrowRight" size={14} />
          </button>
        </div>
      ) : (
        <input className="pop-title" value={title} aria-label="Title" onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
      )}

      <div className="pop-when">
        {tb && (
          <div className="pop-line">
            <span className="muted small">Change</span>
            <Segmented size="sm" label="Which occurrences a time change applies to" value={scope} onChange={setScope}
              options={[{ value: "one", label: "This one" }, { value: "following", label: "Following" }, { value: "all", label: "All" }]} />
          </div>
        )}
        <div className="pop-line">
          <Icon name="calendar" size={15} />
          <input type="date" value={item.date} aria-label="Date"
            onChange={(e) => e.target.value && setTimes(e.target.value, item.start, item.end)} />
        </div>
        <div className="pop-line">
          <Icon name="clock" size={15} />
          <input type="time" step={300} value={toInput(item.start)} aria-label="Start"
            onChange={(e) => {
              const s = fromInput(e.target.value);
              if (s !== null) setTimes(item.date, s, s + (item.end - item.start));
            }} />
          <span className="muted">–</span>
          <input type="time" step={300} value={toInput(item.end % 1440)} aria-label="End"
            onChange={(e) => {
              const en = fromInput(e.target.value);
              if (en !== null) setTimes(item.date, item.start, en);
            }} />
          <span className="muted small">{fmtDuration(item.end - item.start)}</span>
        </div>
        {tb && item.moved && (
          <div className="pop-line pop-moved">
            <Icon name="undo" size={15} />
            <span className="muted small">
              {item.date !== onDate ? `Moved from ${fmtDayLong(onDate)}` : "Changed for this day only"}
            </span>
            <button className="btn sm ghost" onClick={() => restoreOccurrence(tb, onDate)}>Reset</button>
          </div>
        )}
        {tb && (
          <div className="pop-line">
            <Icon name="repeat" size={15} />
            <select value={tb.interval_weeks} aria-label="Repeat every"
              onChange={(e) => updateTimeBlock(tb.id, { interval_weeks: Number(e.target.value) })}>
              {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n === 1 ? "Every week" : `Every ${n} weeks`}</option>)}
            </select>
            <select value={tb.weekday} aria-label="Day of the week"
              onChange={(e) => updateTimeBlock(tb.id, { weekday: Number(e.target.value) })}>
              {WEEKDAYS.map((d, i) => <option key={d} value={i}>on {d}</option>)}
            </select>
          </div>
        )}
        {tb && (
          <div className="pop-line">
            <Icon name="flag" size={15} />
            <span className="muted small">Until</span>
            <input type="date" value={tb.until_date ?? ""} aria-label="Repeat until"
              onChange={(e) => updateTimeBlock(tb.id, { until_date: e.target.value || null })} />
          </div>
        )}
        <div className="pop-line">
          <Icon name="bell" size={15} />
          <select value={reminder === null ? "" : String(reminder)} aria-label="Reminder"
            onChange={(e) => setReminder(reminderKind, item.id, e.target.value === "" ? null : Number(e.target.value))}>
            {REMINDERS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
        {clashing.length > 0 && (
          <div className="pop-line pop-conflict" role="status">
            <Icon name="flag" size={15} />
            <span>Overlaps {clashing.map((o) => `“${o.title}”`).join(", ")}</span>
          </div>
        )}
      </div>

      {ev && (
        <div className="pop-details">
          <div className="pop-line">
            <Icon name={isLink(location) ? "link" : "pin"} size={15} />
            <input className="pop-location" value={location} placeholder="Add location or link" aria-label="Location"
              maxLength={300} onChange={(e) => setLocation(e.target.value)} onBlur={saveDetails}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
            {isLink(location) && (
              <a className="btn sm ghost" href={location.trim()} target="_blank" rel="noopener noreferrer">Open</a>
            )}
          </div>
          <div className="pop-line pop-notes-line">
            <Icon name="notes" size={15} />
            <textarea className="pop-notes" value={notes} placeholder="Add notes" aria-label="Notes" rows={2}
              maxLength={5000} onChange={(e) => setNotes(e.target.value)} onBlur={saveDetails} />
          </div>
        </div>
      )}

      {(ev || tb) && (
        <ColorPicker value={color} onChange={(c) => {
          if (ev) updateEvent(ev.id, { color: c });
          if (tb) updateTimeBlock(tb.id, { color: c });
        }} />
      )}
      {tb && (
        <p className="pop-note muted small">
          Title, colour, repeat and reminder apply to the whole routine.
        </p>
      )}
    </Popover>
  );
}
