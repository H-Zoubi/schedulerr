import { FormEvent, useEffect, useState } from "react";
import { api, Habit, patch, post } from "../api";
import { addDays, isoDate, weekStartOf } from "../dates";

// Progress window: the current week (Sunday to Saturday) or today, depending on the habit's period.
function windowFor(habit: Habit): { start: string; end: string } {
  const today = new Date();
  if (habit.target_period === "day") return { start: isoDate(today), end: isoDate(today) };
  const weekStart = weekStartOf(today);
  return { start: isoDate(weekStart), end: isoDate(addDays(weekStart, 6)) };
}

export function Habits() {
  const [habits, setHabits] = useState<Habit[]>([]);
  const [title, setTitle] = useState("");
  const [target, setTarget] = useState(3);
  const [period, setPeriod] = useState<"day" | "week">("week");
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Each habit is counted in its own window: today for daily habits, this week otherwise.
  async function load() {
    try {
      const today = isoDate(new Date());
      const weekStart = weekStartOf(new Date());
      const week = `start=${isoDate(weekStart)}&end=${isoDate(addDays(weekStart, 6))}`;
      const day = `start=${today}&end=${today}`;
      const [weekly, daily] = await Promise.all([
        api<Habit[]>(`/api/habits?${week}`),
        api<Habit[]>(`/api/habits?${day}`),
      ]);
      setHabits(weekly.map((h) => (h.target_period === "day" ? daily.find((d) => d.id === h.id)! : h)));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load habits");
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    await post("/api/habits", { title: title.trim(), target_count: target, target_period: period });
    setTitle("");
    setShowForm(false);
    load();
  }

  async function log(habit: Habit, delta: 1 | -1) {
    if (delta === -1 && habit.done === 0) return;
    const { start, end } = windowFor(habit);
    await post(`/api/habits/${habit.id}/log?start=${start}&end=${end}`, {
      logged_on: isoDate(new Date()),
      delta,
    });
    load();
  }

  async function archive(habit: Habit) {
    if (!confirm(`Archive "${habit.title}"? It will stop showing here.`)) return;
    await patch(`/api/habits/${habit.id}`, { archived: true });
    load();
  }

  const active = habits.filter((h) => !h.archived);
  const metCount = active.filter((h) => h.done >= h.target_count).length;

  return (
    <section>
      <div className="page-head">
        <div className="titles">
          <h1>Habits</h1>
          <div className="subtitle">
            {loaded ? `${metCount} of ${active.length} on target` : "Loading…"}
          </div>
        </div>
        <button className={showForm ? "" : "primary"} onClick={() => setShowForm(!showForm)}>
          {showForm ? "Cancel" : "+ New habit"}
        </button>
      </div>

      {error && <div className="banner" role="alert">{error}</div>}

      {showForm && (
        <form className="card form habit-form" style={{ marginBottom: 16 }} onSubmit={add}>
          <label>Habit
            <input placeholder="Walk, read, stretch…" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus required />
          </label>
          <label>Target
            <input type="number" min={1} value={target} onChange={(e) => setTarget(Number(e.target.value))} />
          </label>
          <label>Per
            <select value={period} onChange={(e) => setPeriod(e.target.value as "day" | "week")}>
              <option value="week">week</option>
              <option value="day">day</option>
            </select>
          </label>
          <button className="primary">Add habit</button>
        </form>
      )}

      {loaded && active.length === 0 && (
        <div className="empty">
          <strong>No habits yet</strong>
          Start with one small thing you want to do each week.
        </div>
      )}

      <div className="habit-grid">
        {active.map((h) => {
          const met = h.done >= h.target_count;
          const pct = Math.min(100, Math.round((h.done / h.target_count) * 100));
          return (
            <div key={h.id} className="card habit-card">
              <div className="habit-top">
                <div className="grow">
                  <div className="name">{h.title}</div>
                  <div className="meta">
                    {h.target_period === "day" ? "Daily" : "Weekly"} · target {h.target_count}
                    {met && " · met"}
                  </div>
                </div>
                <button className="icon" onClick={() => archive(h)} aria-label={`Archive ${h.title}`}>✕</button>
              </div>
              <div className="habit-bottom">
                <div className={"progress" + (met ? " met" : "")} role="progressbar"
                  aria-valuemin={0} aria-valuemax={h.target_count} aria-valuenow={h.done}>
                  <span style={{ width: `${pct}%` }} />
                </div>
                <span className="progress-count">{h.done} / {h.target_count}</span>
              </div>
              <div className="row">
                <button onClick={() => log(h, -1)} disabled={h.done === 0} aria-label={`Undo ${h.title}`}>Undo</button>
                <button className="primary btn-log grow" onClick={() => log(h, 1)} aria-label={`Log ${h.title}`}>+1</button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
