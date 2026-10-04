import { FormEvent, useEffect, useState } from "react";
import { api, Column, del, patch, post, Project, Task } from "../api";
import { localIso } from "../dates";

// Shared "Save / Delete" footer for the editors.
function Footer({ saving, onDelete }: { saving: boolean; onDelete?: () => void }) {
  return (
    <div className="row">
      {onDelete && (
        <button type="button" className="ghost" onClick={onDelete} disabled={saving}>Delete</button>
      )}
      <button className="primary grow" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
    </div>
  );
}

// ---------- Events ----------

export type EventValue = { id: number; title: string; start: string; end: string; color: string };

// `start` and `end` are the naive local strings the backend returns, e.g. "2026-10-01T10:30:00".
export function EventEditor({
  event,
  defaultDay,
  onDone,
}: {
  event?: EventValue;
  defaultDay: string;
  onDone: () => void;
}) {
  const [title, setTitle] = useState(event?.title ?? "");
  const [start, setStart] = useState(event?.start.slice(0, 16) ?? `${defaultDay}T09:00`);
  const [end, setEnd] = useState(event?.end.slice(0, 16) ?? `${defaultDay}T10:00`);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const body = {
      title,
      start_at: localIso(new Date(start)),
      end_at: localIso(new Date(end)),
      color: event?.color ?? "#0891b2",
    };
    try {
      if (event) await patch(`/api/events/${event.id}`, body);
      else await post("/api/events", body);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
      setSaving(false);
    }
  }

  async function remove() {
    if (!event || !confirm(`Delete "${event.title}"?`)) return;
    await del(`/api/events/${event.id}`);
    onDone();
  }

  return (
    <form className="form" onSubmit={submit}>
      <input placeholder="Meeting with Sam" value={title} onChange={(e) => setTitle(e.target.value)} required />
      <label>Start<input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required /></label>
      <label>End<input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} required /></label>
      {error && <p className="error">{error}</p>}
      <Footer saving={saving} onDelete={event ? remove : undefined} />
    </form>
  );
}

// ---------- Time blocks ----------

type TimeBlockValue = {
  id: number;
  title: string;
  weekday: number;
  start_time: string;
  end_time: string;
  start_date: string;
  until_date: string | null;
  color: string;
};

// Stored weekday is 0 = Monday ... 6 = Sunday; listed Sunday-first for display.
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const WEEKDAY_ORDER = [6, 0, 1, 2, 3, 4, 5];

export function TimeBlockEditor({
  timeBlockId,
  defaultDay,
  onDone,
}: {
  timeBlockId?: number;
  defaultDay: string;
  onDone: () => void;
}) {
  const [loaded, setLoaded] = useState<TimeBlockValue | null>(null);
  const [title, setTitle] = useState("");
  const [weekday, setWeekday] = useState((new Date(defaultDay + "T00:00").getDay() + 6) % 7);
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("09:00");
  const [startDate, setStartDate] = useState(defaultDay);
  const [untilDate, setUntilDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Editing an existing block: load it once and fill the form.
  useEffect(() => {
    if (timeBlockId === undefined) return;
    api<TimeBlockValue[]>("/api/time-blocks").then((all) => {
      const b = all.find((x) => x.id === timeBlockId);
      if (!b) return;
      setLoaded(b);
      setTitle(b.title);
      setWeekday(b.weekday);
      setStartTime(b.start_time.slice(0, 5));
      setEndTime(b.end_time.slice(0, 5));
      setStartDate(b.start_date);
      setUntilDate(b.until_date ?? "");
    });
  }, [timeBlockId]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const body = {
      title,
      weekday,
      start_time: startTime,
      end_time: endTime,
      start_date: startDate,
      until_date: untilDate || null,
      color: loaded?.color ?? "#4f46e5",
    };
    try {
      if (loaded) await patch(`/api/time-blocks/${loaded.id}`, body);
      else await post("/api/time-blocks", body);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
      setSaving(false);
    }
  }

  async function remove() {
    if (!loaded || !confirm(`Delete "${loaded.title}"?`)) return;
    await del(`/api/time-blocks/${loaded.id}`);
    onDone();
  }

  return (
    <form className="form" onSubmit={submit}>
      <input placeholder="Algorithms lecture" value={title} onChange={(e) => setTitle(e.target.value)} required />
      <label>Day
        <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
          {WEEKDAY_ORDER.map((i) => <option key={i} value={i}>{WEEKDAYS[i]}</option>)}
        </select>
      </label>
      <label>From<input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required /></label>
      <label>To<input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} required /></label>
      <label>Starts<input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required /></label>
      <label>Ends (optional)<input type="date" value={untilDate} onChange={(e) => setUntilDate(e.target.value)} /></label>
      {error && <p className="error">{error}</p>}
      <Footer saving={saving} onDelete={loaded ? remove : undefined} />
    </form>
  );
}

// ---------- Tasks ----------

// Choose a board (project or the general one) and a column on it.
export function TaskEditor({ task, onDone }: { task: Task; onDone: () => void }) {
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes);
  const [projectId, setProjectId] = useState<number | null>(task.project_id);
  const [columnId, setColumnId] = useState<number | null>(task.column_id);
  const [projects, setProjects] = useState<Project[]>([]);
  const [columns, setColumns] = useState<Column[]>([]);
  const [minutes, setMinutes] = useState(task.duration_minutes ?? 60);
  const [deadline, setDeadline] = useState(task.deadline ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Project[]>("/api/projects").then(setProjects);
  }, []);

  // Load the columns of the chosen board; if the current column isn't on it, use its first column.
  useEffect(() => {
    const query = projectId === null ? "" : `?project_id=${projectId}`;
    api<Column[]>(`/api/columns${query}`).then((cols) => {
      setColumns(cols);
      if (!cols.some((c) => c.id === columnId)) setColumnId(cols[0]?.id ?? null);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await patch(`/api/tasks/${task.id}`, {
        title,
        notes,
        project_id: projectId,
        column_id: columnId,
        duration_minutes: minutes,
        deadline: deadline || null,
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete "${task.title}"?`)) return;
    await del(`/api/tasks/${task.id}`);
    onDone();
  }

  return (
    <form className="form" onSubmit={submit}>
      <input value={title} onChange={(e) => setTitle(e.target.value)} required />
      <textarea placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
      <div className="row">
        <label className="grow">Board
          <select value={projectId ?? ""} onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">General</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="grow">Column
          <select value={columnId ?? ""} onChange={(e) => setColumnId(Number(e.target.value))}>
            {columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      </div>
      <div className="row">
        <label className="grow">Minutes
          <input type="number" min={15} step={15} value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))} />
        </label>
        <label className="grow">Deadline
          <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      <Footer saving={saving} onDelete={remove} />
    </form>
  );
}
