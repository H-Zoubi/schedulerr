import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, IconButton, Segmented, TaskCheck } from "./primitives";
import { Icon } from "./Icon";
import { closeTask } from "../lib/ui";
import {
  boardColumns, currentId, deleteTask, deleteTaskBlock, scheduleTask, toggleTaskDone, updateTask, useData,
} from "../store";
import { Task } from "../api";
import {
  addDaysIso, atMinutes, fmtDayLong, fmtDuration, fmtRange, isoDate, minutesOfIso, nowMinutes,
  parseDate, relDay, todayIso, weekStartOf, addDays,
} from "../dates";
import { expandRange, freeGaps } from "../lib/derive";
import { navigate } from "../lib/router";
import { usePrefs } from "../lib/prefs";

const ESTIMATES = [15, 30, 45, 60, 90, 120];
const PRIORITIES = [
  { value: "0", label: "None" },
  { value: "1", label: "Low" },
  { value: "2", label: "Med" },
  { value: "3", label: "High" },
];

export function TaskDrawer({ taskId }: { taskId: number }) {
  const id = currentId(taskId);
  const task = useData((s) => s.tasks.find((t) => t.id === id || t.id === taskId));
  useEffect(() => {
    if (!task) closeTask();
  }, [task]);
  if (!task) return null;
  return (
    <Dialog onClose={closeTask} label={`Task: ${task.title}`} variant="drawer" initialFocus={false}>
      <TaskDetail key={task.id < 0 ? taskId : task.id} task={task} />
    </Dialog>
  );
}

function TaskDetail({ task }: { task: Task }) {
  const data = useData();
  const { workStart, workEnd, bufferMinutes } = usePrefs();
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes);
  const [customEstimate, setCustomEstimate] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const notesTimer = useRef<number>();

  const columns = boardColumns(data.columns, task.project_id);
  const blocks = data.taskBlocks
    .filter((b) => b.task_id === task.id)
    .sort((a, b) => a.start_at.localeCompare(b.start_at));
  const project = data.projects.find((p) => p.id === task.project_id);

  // Keep local fields in step with outside changes (e.g. an edit from the board).
  useEffect(() => setTitle(task.title), [task.title]);

  useEffect(() => autosize(titleRef.current), [title]);

  // Flush unsaved notes when the drawer closes.
  const latestNotes = useRef(notes);
  latestNotes.current = notes;
  useEffect(() => () => {
    window.clearTimeout(notesTimer.current);
    if (latestNotes.current !== task.notes) updateTask(task.id, { notes: latestNotes.current });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function saveTitle() {
    const t = title.trim();
    if (!t) setTitle(task.title);
    else if (t !== task.title) updateTask(task.id, { title: t });
  }

  function onNotes(v: string) {
    setNotes(v);
    window.clearTimeout(notesTimer.current);
    notesTimer.current = window.setTimeout(() => updateTask(task.id, { notes: v }), 700);
  }

  const today = todayIso();
  const duration = task.duration_minutes ?? 60;

  // Earliest free slot that fits, today (from now) then the next few days, within working hours.
  const nextSlot = useMemo(() => {
    const items = expandRange(today, addDaysIso(today, 6), data);
    for (let i = 0; i < 7; i++) {
      const day = addDaysIso(today, i);
      const from = i === 0 ? Math.max(workStart, Math.ceil((nowMinutes() + 5) / 15) * 15) : workStart;
      const gap = freeGaps(items.get(day) ?? [], from, workEnd, duration, bufferMinutes)[0];
      if (gap) return { day, start: gap.start };
    }
    return null;
  }, [data, today, duration, workStart, workEnd, bufferMinutes]);

  function schedule(day: string, start: number) {
    scheduleTask(task, atMinutes(day, start), atMinutes(day, Math.min(start + duration, 24 * 60 - 1)));
    setScheduling(false);
  }

  return (
    <div className="drawer">
      <div className="drawer-top">
        <span className="drawer-crumb">
          <span className="dot" style={{ background: project?.color ?? "var(--text-3)" }} />
          {project?.name ?? "General"}
          <Icon name="chevronRight" size={12} />
          {columns.find((c) => c.id === task.column_id)?.name ?? "—"}
        </span>
        <div className="row-gap">
          <IconButton icon="trash" label="Delete task" onClick={() => { deleteTask(task); closeTask(); }} />
          <IconButton icon="close" label="Close" onClick={closeTask} />
        </div>
      </div>

      <div className="drawer-title">
        <TaskCheck done={task.done} priority={task.priority} onToggle={() => toggleTaskDone(task)}
          label={task.done ? "Mark as not done" : "Mark as done"} />
        <textarea ref={titleRef} className={"title-input" + (task.done ? " is-done" : "")} rows={1} value={title}
          aria-label="Title" onChange={(e) => setTitle(e.target.value)} onBlur={saveTitle}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); } }} />
      </div>

      <div className="props">
        <div className="prop">
          <span className="prop-label"><Icon name="board" size={15} />Board</span>
          <select className="prop-select" value={task.project_id ?? ""} aria-label="Board"
            onChange={(e) => updateTask(task.id, { project_id: e.target.value ? Number(e.target.value) : null })}>
            <option value="">General</option>
            {data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="prop">
          <span className="prop-label"><Icon name="layers" size={15} />Status</span>
          <select className="prop-select" value={task.column_id ?? ""} aria-label="Status"
            onChange={(e) => updateTask(task.id, { column_id: Number(e.target.value) })}>
            {columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="prop">
          <span className="prop-label"><Icon name="flag" size={15} />Priority</span>
          <Segmented size="sm" label="Priority" value={String(task.priority)} options={PRIORITIES}
            onChange={(v) => updateTask(task.id, { priority: Number(v) })} />
        </div>
        <div className="prop">
          <span className="prop-label"><Icon name="calendar" size={15} />Deadline</span>
          <div className="prop-value wrap">
            <input type="date" className="prop-date" value={task.deadline ?? ""} aria-label="Deadline"
              onChange={(e) => updateTask(task.id, { deadline: e.target.value || null })} />
            {[
              { label: "Today", value: today },
              { label: "Tomorrow", value: addDaysIso(today, 1) },
              { label: "Next week", value: isoDate(addDays(weekStartOf(new Date()), 7)) },
            ].map((o) => (
              <button key={o.label} type="button" className={"pill" + (task.deadline === o.value ? " on" : "")}
                onClick={() => updateTask(task.id, { deadline: o.value })}>{o.label}</button>
            ))}
            {task.deadline && (
              <button type="button" className="pill ghost" onClick={() => updateTask(task.id, { deadline: null })}>Clear</button>
            )}
          </div>
        </div>
        <div className="prop">
          <span className="prop-label"><Icon name="clock" size={15} />Estimate</span>
          <div className="prop-value wrap">
            {ESTIMATES.map((m) => (
              <button key={m} type="button" className={"pill" + (task.duration_minutes === m ? " on" : "")}
                onClick={() => updateTask(task.id, { duration_minutes: task.duration_minutes === m ? null : m })}>
                {fmtDuration(m)}
              </button>
            ))}
            {customEstimate || (task.duration_minutes && !ESTIMATES.includes(task.duration_minutes)) ? (
              <input type="number" className="prop-num" min={5} step={5} defaultValue={task.duration_minutes ?? ""}
                aria-label="Minutes" autoFocus={customEstimate}
                onBlur={(e) => { const n = Number(e.target.value); updateTask(task.id, { duration_minutes: n > 0 ? n : null }); setCustomEstimate(false); }} />
            ) : (
              <button type="button" className="pill ghost" onClick={() => setCustomEstimate(true)}>Custom</button>
            )}
          </div>
        </div>
      </div>

      <section className="drawer-section">
        <div className="section-head">
          <h3>Scheduled</h3>
          {!scheduling && (
            <button type="button" className="btn sm" onClick={() => setScheduling(true)}>
              <Icon name="plus" size={14} /> Add time
            </button>
          )}
        </div>
        {blocks.length === 0 && !scheduling && <p className="muted small">Not on the calendar yet.</p>}
        <ul className="block-list">
          {blocks.map((b) => {
            const day = b.start_at.slice(0, 10);
            const past = day < today;
            return (
              <li key={b.id} className={"block-row" + (past ? " past" : "")}>
                <button type="button" className="block-link" onClick={() => { closeTask(); navigate({ name: "calendar", date: day }); }}>
                  <Icon name="calendar" size={14} />
                  <span>{relDay(day)}</span>
                  <span className="muted">{fmtRange(minutesOfIso(b.start_at), minutesOfIso(b.end_at))}</span>
                </button>
                <IconButton icon="close" size={14} label="Remove from calendar" onClick={() => deleteTaskBlock(b, task.title)} />
              </li>
            );
          })}
        </ul>
        {scheduling && (
          <ScheduleBox duration={duration} nextSlot={nextSlot} onPick={schedule} onCancel={() => setScheduling(false)} />
        )}
      </section>

      <section className="drawer-section grow-section">
        <h3>Notes</h3>
        <textarea className="notes" placeholder="Add details, links, a checklist…" value={notes}
          onChange={(e) => onNotes(e.target.value)} onBlur={() => {
            window.clearTimeout(notesTimer.current);
            if (notes !== task.notes) updateTask(task.id, { notes });
          }} />
      </section>
    </div>
  );
}

function ScheduleBox({ duration, nextSlot, onPick, onCancel }: {
  duration: number;
  nextSlot: { day: string; start: number } | null;
  onPick: (day: string, start: number) => void;
  onCancel: () => void;
}) {
  const today = todayIso();
  const [day, setDay] = useState(nextSlot?.day ?? today);
  const [time, setTime] = useState(() => {
    const m = nextSlot?.start ?? 9 * 60;
    return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  });
  const tomorrow = addDaysIso(today, 1);
  return (
    <div className="schedule-box">
      <div className="quick-slots">
        {nextSlot && (
          <button type="button" className="slot primary-soft" onClick={() => onPick(nextSlot.day, nextSlot.start)}>
            <Icon name="sparkle" size={14} />
            <span>Next free slot</span>
            <span className="muted">{relDay(nextSlot.day)} {fmtRange(nextSlot.start, nextSlot.start + duration)}</span>
          </button>
        )}
        <button type="button" className="slot" onClick={() => onPick(tomorrow, 9 * 60)}>
          <span>Tomorrow morning</span>
          <span className="muted">{fmtDayLong(tomorrow).split(",")[0]} {fmtRange(9 * 60, 9 * 60 + duration)}</span>
        </button>
      </div>
      <div className="row-gap">
        <input type="date" value={day} onChange={(e) => setDay(e.target.value)} aria-label="Day" />
        <input type="time" value={time} step={900} onChange={(e) => setTime(e.target.value)} aria-label="Start time" />
        <button type="button" className="btn primary sm" onClick={() => {
          const [h, m] = time.split(":").map(Number);
          if (day && !Number.isNaN(h)) onPick(day, h * 60 + m);
        }}>Add</button>
        <button type="button" className="btn ghost sm" onClick={onCancel}>Cancel</button>
      </div>
      <p className="muted small">{fmtDuration(duration)} block · {parseDate(day) < parseDate(today) ? "in the past" : relDay(day)}</p>
    </div>
  );
}

function autosize(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = el.scrollHeight + "px";
}
