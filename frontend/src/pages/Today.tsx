import { FormEvent, useEffect, useState } from "react";
import { api, del, Habit, post, Task, WeekDay, WeekItem } from "../api";
import { addDays, isoDate, localIso, weekStartOf, timeLabel } from "../dates";

// Today: what is on the timetable, what is due, what habits still need doing,
// and which open tasks have no time yet.
export function Today() {
  const [today, setToday] = useState<WeekDay | null>(null);
  const [week, setWeek] = useState<WeekDay[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [planning, setPlanning] = useState<Task | null>(null);
  const [loaded, setLoaded] = useState(false);

  const todayIso = isoDate(new Date());

  async function load() {
    try {
      const [days, allTasks, weekly, daily] = await Promise.all([
        api<WeekDay[]>(`/api/week?start=${todayIso}`),
        api<Task[]>("/api/tasks"),
        api<Habit[]>(`/api/habits?start=${isoDate(weekStartOf(new Date()))}&end=${isoDate(addDays(weekStartOf(new Date()), 6))}`),
        api<Habit[]>(`/api/habits?start=${todayIso}&end=${todayIso}`),
      ]);
      setWeek(days);
      setToday(days[0]);
      setTasks(allTasks);
      setHabits(weekly.map((h) => (h.target_period === "day" ? daily.find((d) => d.id === h.id)! : h)));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load today");
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- Derived lists ----------

  const items = (today?.items ?? []).slice().sort((a, b) => startMinutes(a) - startMinutes(b));

  const scheduledIds = new Set(
    week.flatMap((d) => d.items.filter((i) => i.kind === "task_block").map((i) => i.task_id)),
  );
  const open = tasks.filter((t) => !t.done);
  const due = open.filter((t) => t.deadline !== null && t.deadline <= todayIso);
  const unscheduled = open.filter((t) => !scheduledIds.has(t.id) && !due.includes(t));
  const habitsDue = habits.filter((h) => !h.archived && h.done < h.target_count);

  // ---------- Actions ----------

  async function complete(task: Task) {
    await post(`/api/tasks/${task.id}/complete`, {});
    load();
  }

  async function logHabit(habit: Habit) {
    const { start, end } = windowFor(habit);
    await post(`/api/habits/${habit.id}/log?start=${start}&end=${end}`, { logged_on: todayIso, delta: 1 });
    load();
  }

  async function removeItem(item: WeekItem) {
    if (!confirm(`Remove "${item.title}" from today?`)) return;
    if (item.kind === "task_block") await del(`/api/task-blocks/${item.id}`);
    else if (item.kind === "event") await del(`/api/events/${item.id}`);
    else await del(`/api/time-blocks/${item.id}`);
    load();
  }

  const dateLabel = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <section className="today">
      <div className="page-head">
        <div className="titles">
          <h1>{greeting}</h1>
          <div className="subtitle">{dateLabel}</div>
        </div>
      </div>

      {error && <div className="banner" role="alert">{error}</div>}

      <div className="stats">
        <Stat value={items.length} label="Blocks today" />
        <Stat value={due.length} label={due.length === 1 ? "Due task" : "Due tasks"} tone={due.some((t) => t.deadline! < todayIso) ? "warn" : undefined} />
        <Stat value={habitsDue.length} label="Habits left" />
      </div>

      <div className="today-grid">
        <div className="card">
          <div className="card-head">
            <h3>Timetable</h3>
            <span className="count">{items.length}</span>
          </div>
          {loaded && items.length === 0 && (
            <div className="empty"><strong>Nothing scheduled</strong>Add a block from the Week tab, or plan a task below.</div>
          )}
          <ul className="list">
            {items.map((item) => (
              <li key={`${item.kind}-${item.id}`} className="today-row">
                <span className="today-time">{timeRange(item)}</span>
                <span className="swatch" style={{ background: item.color }} />
                <span className="title grow">{item.title}</span>
                {item.kind === "task_block" && (
                  <button className="chip" onClick={() => complete(tasks.find((t) => t.id === item.task_id)!)}>Done</button>
                )}
                {item.kind !== "time" && (
                  <button className="icon" onClick={() => removeItem(item)} aria-label={`Remove ${item.title}`}>✕</button>
                )}
              </li>
            ))}
          </ul>
        </div>

        <div className="stack">
          <div className="card">
            <div className="card-head">
              <h3>Due</h3>
              <span className="count">{due.length}</span>
            </div>
            {loaded && due.length === 0 && <p className="muted small">No deadlines today.</p>}
            <ul className="list">
              {due.map((t) => (
                <li key={t.id} className="today-row">
                  <button className="check" onClick={() => complete(t)} aria-label={`Complete ${t.title}`} />
                  <span className="grow">
                    <span className="title">{t.title}</span>
                    {t.deadline && t.deadline < todayIso && <span className="error small"> · overdue</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="card">
            <div className="card-head">
              <h3>Habits still due</h3>
              <span className="count">{habitsDue.length}</span>
            </div>
            {loaded && habitsDue.length === 0 && <p className="muted small">All habits on track.</p>}
            <ul className="list">
              {habitsDue.map((h) => (
                <li key={h.id} className="today-row">
                  <span className="grow">
                    <span className="title">{h.title}</span>
                    <div className="meta">{h.done}/{h.target_count} per {h.target_period}</div>
                  </span>
                  <button className="primary" onClick={() => logHabit(h)}>+1</button>
                </li>
              ))}
            </ul>
          </div>

          <div className="card">
            <div className="card-head">
              <h3>Plan from here</h3>
              <span className="count">{unscheduled.length}</span>
            </div>
            {loaded && unscheduled.length === 0 && <p className="muted small">Every open task has a time this week.</p>}
            <ul className="list">
              {unscheduled.map((t) => (
                <li key={t.id} className="today-row">
                  <span className="grow title">{t.title}</span>
                  <button className="chip" onClick={() => setPlanning(planning?.id === t.id ? null : t)}>
                    {planning?.id === t.id ? "Cancel" : "Schedule"}
                  </button>
                </li>
              ))}
            </ul>
            {planning && (
              <PlanForm task={planning} day={todayIso} onDone={() => { setPlanning(null); load(); }} />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function Stat({ value, label, tone }: { value: number; label: string; tone?: "warn" }) {
  return (
    <div className="stat">
      <div className="num" style={tone === "warn" && value > 0 ? { color: "var(--danger)" } : undefined}>{value}</div>
      <div className="label">{label}</div>
    </div>
  );
}

function PlanForm({ task, day, onDone }: { task: Task; day: string; onDone: () => void }) {
  const [start, setStart] = useState(`${day}T09:00`);
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
    <form className="form plan-form" onSubmit={submit}>
      <strong className="small">“{task.title}”</strong>
      <div className="row">
        <label className="grow">Start<input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required /></label>
        <label className="grow">Minutes<input type="number" min={15} step={15} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} /></label>
      </div>
      {error && <p className="error small">{error}</p>}
      <button className="primary" disabled={saving}>{saving ? "Adding…" : "Add to today"}</button>
    </form>
  );
}

// ---------- Helpers ----------

function startMinutes(item: WeekItem): number {
  if (item.kind === "time") {
    const [h, m] = item.start_time!.split(":").map(Number);
    return h * 60 + m;
  }
  const d = new Date(item.start!);
  return d.getHours() * 60 + d.getMinutes();
}

function timeRange(item: WeekItem): string {
  if (item.kind === "time") return `${item.start_time!.slice(0, 5)}–${item.end_time!.slice(0, 5)}`;
  return `${timeLabel(item.start!)}–${timeLabel(item.end!)}`;
}

function windowFor(habit: Habit): { start: string; end: string } {
  const today = new Date();
  if (habit.target_period === "day") return { start: isoDate(today), end: isoDate(today) };
  const weekStart = weekStartOf(today);
  return { start: isoDate(weekStart), end: isoDate(addDays(weekStart, 6)) };
}
