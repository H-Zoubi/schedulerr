import { FormEvent, useEffect, useRef, useState } from "react";
import { api, Column, del, patch, post, Task } from "../api";
import { isoDate, localIso } from "../dates";
import { Modal } from "../components/Modal";
import { TaskEditor } from "../components/Editors";

export function Inbox() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState("");
  const [scheduling, setScheduling] = useState<Task | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [loaded, setLoaded] = useState(false);
  const captureRef = useRef<HTMLInputElement>(null);

  async function load() {
    try {
      setTasks(await api<Task[]>("/api/tasks"));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load tasks");
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // "n" focuses quick capture from anywhere on the page, unless the user is already typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "n" || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      e.preventDefault();
      captureRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    try {
      await post("/api/tasks", { title: title.trim() });
      setTitle("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the task");
    }
  }

  async function complete(task: Task) {
    await post(`/api/tasks/${task.id}/complete`, {});
    load();
  }

  // "Plan" moves a task into the general board's Planned column.
  async function plan(task: Task) {
    const columns = await api<Column[]>("/api/columns");
    const planned = columns.find((c) => c.key === "planned");
    if (planned) await patch(`/api/tasks/${task.id}`, { column_id: planned.id });
    load();
  }

  async function remove(task: Task) {
    if (!confirm(`Delete "${task.title}"?`)) return;
    await del(`/api/tasks/${task.id}`);
    load();
  }

  // The Inbox screen shows tasks not yet planned.
  const inbox = tasks.filter((t) => t.project_id === null && t.column_key === "inbox");

  return (
    <section>
      <div className="page-head">
        <div className="titles">
          <h1>Inbox</h1>
          <div className="subtitle">
            {inbox.length} unscheduled {inbox.length === 1 ? "task" : "tasks"}
          </div>
        </div>
      </div>

      <form className="card capture" onSubmit={add}>
        <input ref={captureRef} className="grow" placeholder="Capture a task…" value={title}
          onChange={(e) => setTitle(e.target.value)} aria-label="Capture a task" />
        <button className="primary" disabled={!title.trim()}>Add</button>
      </form>
      <div className="capture-hint">
        Press <span className="kbd">n</span> anywhere to capture. Enter to save.
      </div>

      {error && <div className="banner" role="alert">{error}</div>}

      {loaded && inbox.length === 0 && (
        <div className="empty">
          <strong>Inbox zero</strong>
          Nothing waiting. Captured tasks show up here until you schedule or plan them.
        </div>
      )}

      <ul className="list">
        {inbox.map((t) => (
          <li key={t.id} className="task-row">
            <button className="check" onClick={() => complete(t)} aria-label={`Complete ${t.title}`} />
            <button className="title-btn" onClick={() => setEditingTask(t)}>{t.title}</button>
            {t.duration_minutes && <span className="tag">{t.duration_minutes}m</span>}
            {t.deadline && <span className="tag">due {t.deadline}</span>}
            <div className="actions">
              <button className="chip" onClick={() => setScheduling(scheduling?.id === t.id ? null : t)}>
                {scheduling?.id === t.id ? "Close" : "Schedule"}
              </button>
              <button className="chip" onClick={() => plan(t)}>Plan</button>
              <button className="icon" onClick={() => remove(t)} aria-label={`Delete ${t.title}`}>✕</button>
            </div>
          </li>
        ))}
      </ul>

      {scheduling && (
        <ScheduleForm
          key={scheduling.id}
          task={scheduling}
          onDone={() => { setScheduling(null); load(); }}
          onCancel={() => setScheduling(null)}
        />
      )}

      {editingTask && (
        <Modal title="Edit task" onClose={() => setEditingTask(null)}>
          <TaskEditor task={editingTask} onDone={() => { setEditingTask(null); load(); }} />
        </Modal>
      )}

      <p className="muted small" style={{ marginTop: 18 }}>
        Tasks move through Planned, Doing and Done on the <strong>Board</strong> tab.
      </p>
    </section>
  );
}

// Quick slots relative to now, so most tasks take one tap.
function quickSlots(): { label: string; value: string }[] {
  const now = new Date();
  const nextHour = new Date(now);
  nextHour.setMinutes(0, 0, 0);
  nextHour.setHours(nextHour.getHours() + 1);

  const tomorrow9 = new Date(now);
  tomorrow9.setDate(tomorrow9.getDate() + 1);
  tomorrow9.setHours(9, 0, 0, 0);

  const evening = new Date(now);
  evening.setHours(18, 0, 0, 0);

  const toInput = (d: Date) => `${isoDate(d)}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

  const slots = [{ label: "Next hour", value: toInput(nextHour) }];
  if (now.getHours() < 18) slots.push({ label: "This evening", value: toInput(evening) });
  slots.push({ label: "Tomorrow 9:00", value: toInput(tomorrow9) });
  return slots;
}

function ScheduleForm({
  task,
  onDone,
  onCancel,
}: {
  task: Task;
  onDone: () => void;
  onCancel: () => void;
}) {
  const slots = quickSlots();
  const [start, setStart] = useState(slots[0].value);
  const [minutes, setMinutes] = useState(task.duration_minutes ?? 60);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const startDate = new Date(start);
      const endDate = new Date(startDate.getTime() + minutes * 60_000);
      await post("/api/task-blocks", {
        task_id: task.id,
        start_at: localIso(startDate),
        end_at: localIso(endDate),
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not schedule");
      setSaving(false);
    }
  }

  return (
    <form className="schedule-panel form" onSubmit={submit}>
      <strong>Schedule “{task.title}”</strong>

      <div className="quick-times" role="group" aria-label="Quick start times">
        {slots.map((s) => (
          <button key={s.value} type="button" className={"chip" + (start === s.value ? " active" : "")}
            onClick={() => setStart(s.value)}>{s.label}</button>
        ))}
      </div>

      <div className="row">
        <label className="grow">Start<input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required /></label>
        <label className="grow">Length (min)
          <input type="number" min={15} step={15} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} required />
        </label>
      </div>

      <div className="quick-times" role="group" aria-label="Quick lengths">
        {[30, 60, 90].map((m) => (
          <button key={m} type="button" className={"chip" + (minutes === m ? " active" : "")}
            onClick={() => setMinutes(m)}>{m}m</button>
        ))}
      </div>

      {error && <p className="error small">{error}</p>}
      <div className="row">
        <button type="button" className="ghost" onClick={onCancel}>Cancel</button>
        <button className="primary grow" disabled={saving}>{saving ? "Adding…" : "Add to week"}</button>
      </div>
    </form>
  );
}
