import { FormEvent, memo, useMemo, useState } from "react";
import { Habit } from "../api";
import { Anchor, anchorOf, Dialog, Empty, IconButton, Menu, Segmented, SheetHeader } from "../components/primitives";
import { Icon } from "../components/Icon";
import { Ring } from "./Today";
import { archiveHabit, createHabit, logHabit, updateHabit, useData } from "../store";
import { countIn, habitWindow, logIndex, streak } from "../lib/derive";
import { addDays, addDaysIso, isoDate, parseDate, todayIso, weekStartOf } from "../dates";
import { usePrefs } from "../lib/prefs";

const HEAT_WEEKS = 18;

export function Habits() {
  const habits = useData((s) => s.habits);
  const logs = useData((s) => s.habitLogs);
  const idx = useMemo(() => logIndex(logs), [logs]);
  const [editing, setEditing] = useState<Habit | "new" | null>(null);

  const onTrack = habits.filter((h) => {
    const w = habitWindow(h);
    return countIn(idx.get(h.id), w.start, w.end) >= h.target_count;
  }).length;

  return (
    <div className="page habits-page">
      <header className="page-head">
        <div>
          <h1>Habits</h1>
          <p className="page-sub">{habits.length ? `${onTrack} of ${habits.length} on target` : "Small things, done often"}</p>
        </div>
        <button className="btn primary sm" onClick={() => setEditing("new")}><Icon name="plus" size={15} /> New habit</button>
      </header>

      {habits.length === 0 ? (
        <Empty icon="habits" title="No habits yet">
          Start with one small thing — “Walk 3× a week” or “Read daily”.
          <div><button className="btn primary sm" onClick={() => setEditing("new")}>Create a habit</button></div>
        </Empty>
      ) : (
        <div className="habit-grid">
          {habits.map((h) => <HabitCard key={h.id} habit={h} days={idx.get(h.id)} onEdit={() => setEditing(h)} />)}
        </div>
      )}

      {editing && <HabitDialog habit={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

const HabitCard = memo(function HabitCard({ habit, days, onEdit }: {
  habit: Habit; days?: Map<string, number>; onEdit: () => void;
}) {
  const { weekStart } = usePrefs();
  const [menu, setMenu] = useState<Anchor | null>(null);
  const today = todayIso();
  const w = habitWindow(habit);
  const done = countIn(days, w.start, w.end);
  const met = done >= habit.target_count;
  const s = streak(habit, days);
  const week = Array.from({ length: 7 }, (_, i) => isoDate(addDays(weekStartOf(new Date(), weekStart), i)));
  const todayCount = days?.get(today) ?? 0;

  return (
    <article className={"habit-card card" + (met ? " met" : "")}>
      <div className="habit-top">
        <div className="habit-info">
          <h2>{habit.title}</h2>
          <p className="muted small">
            {habit.target_count}× {habit.target_period === "day" ? "a day" : "a week"}
            {s > 0 && <span className="streak"><Icon name="flame" size={13} /> {s} {habit.target_period === "day" ? "day" : "week"}{s === 1 ? "" : "s"}</span>}
          </p>
        </div>
        <IconButton icon="more" label="Habit options" onClick={(e) => setMenu(anchorOf(e.currentTarget))} />
      </div>

      <div className="habit-mid">
        <button className="habit-log" onClick={() => logHabit(habit.id, today, 1)} aria-label={`Log ${habit.title}`}>
          <Ring value={Math.min(100, (done / habit.target_count) * 100)} size={64} done={met} />
          <span className="habit-log-count">{met ? "" : `${done}/${habit.target_count}`}</span>
        </button>
        <div className="habit-week">
          {week.map((d) => {
            const n = days?.get(d) ?? 0;
            const future = d > today;
            return (
              <button key={d} disabled={future}
                className={"wk-day" + (n > 0 ? " on" : "") + (d === today ? " today" : "")}
                title={`${parseDate(d).toDateString()}: ${n} — click to log, right-click to remove`}
                onClick={() => logHabit(habit.id, d, 1)}
                onContextMenu={(e) => { e.preventDefault(); logHabit(habit.id, d, -1); }}>
                <span className="wk-name">{parseDate(d).toLocaleDateString(undefined, { weekday: "narrow" })}</span>
                <span className="wk-dot">{n > 1 ? n : n === 1 ? <Icon name="check" size={12} strokeWidth={3} /> : ""}</span>
              </button>
            );
          })}
        </div>
      </div>

      <Heatmap days={days} weekStart={weekStart} />

      <div className="habit-actions">
        <button className="btn sm ghost" disabled={todayCount === 0} onClick={() => logHabit(habit.id, today, -1)}>
          <Icon name="undo" size={14} /> Undo today
        </button>
        <button className="btn sm primary" onClick={() => logHabit(habit.id, today, 1)}>
          <Icon name="plus" size={14} /> Log
        </button>
      </div>

      {menu && (
        <Menu anchor={menu} onClose={() => setMenu(null)} items={[
          { label: "Edit", icon: "edit", onSelect: onEdit },
          { label: "Archive", icon: "trash", danger: true, onSelect: () => archiveHabit(habit) },
        ]} />
      )}
    </article>
  );
});

function Heatmap({ days, weekStart }: { days?: Map<string, number>; weekStart: 0 | 1 }) {
  const today = todayIso();
  const start = isoDate(addDays(weekStartOf(new Date(), weekStart), -7 * (HEAT_WEEKS - 1)));
  const cols = Array.from({ length: HEAT_WEEKS }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => addDaysIso(start, w * 7 + d)));
  return (
    <div className="heatmap" aria-label="Last weeks of activity">
      {cols.map((col, i) => (
        <div key={i} className="heat-col">
          {col.map((d) => {
            const n = days?.get(d) ?? 0;
            return <span key={d} className={"heat-cell l" + Math.min(n, 3) + (d > today ? " future" : "")} title={`${d}: ${n}`} />;
          })}
        </div>
      ))}
    </div>
  );
}

function HabitDialog({ habit, onClose }: { habit?: Habit; onClose: () => void }) {
  const [title, setTitle] = useState(habit?.title ?? "");
  const [count, setCount] = useState(habit?.target_count ?? 3);
  const [period, setPeriod] = useState<"day" | "week">(habit?.target_period ?? "week");

  function submit(e: FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    if (habit) updateHabit(habit.id, { title: t, target_count: count, target_period: period });
    else createHabit(t, count, period);
    onClose();
  }

  return (
    <Dialog onClose={onClose} label={habit ? "Edit habit" : "New habit"}>
      <SheetHeader title={habit ? "Edit habit" : "New habit"} onClose={onClose} />
      <form className="form" onSubmit={submit}>
        <label className="field">
          <span>Habit</span>
          <input autoFocus value={title} placeholder="Walk, read, stretch…" onChange={(e) => setTitle(e.target.value)} />
        </label>
        <div className="field">
          <span>Target</span>
          <div className="row-gap">
            <div className="stepper">
              <button type="button" onClick={() => setCount(Math.max(1, count - 1))} aria-label="Fewer">−</button>
              <span>{count}×</span>
              <button type="button" onClick={() => setCount(Math.min(50, count + 1))} aria-label="More">+</button>
            </div>
            <Segmented label="Period" value={period} onChange={setPeriod}
              options={[{ value: "day", label: "per day" }, { value: "week", label: "per week" }]} />
          </div>
        </div>
        <div className="form-actions">
          <span className="grow" />
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!title.trim()}>{habit ? "Save" : "Create habit"}</button>
        </div>
      </form>
    </Dialog>
  );
}
