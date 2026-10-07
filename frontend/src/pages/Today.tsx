import { CSSProperties, useEffect, useMemo, useState } from "react";
import { Task } from "../api";
import { Anchor, anchorOf, Empty, Popover, TaskCheck } from "../components/primitives";
import { Icon } from "../components/Icon";
import { TaskRow } from "../components/TaskRow";
import { blocksByTask, CalItem, compareTasks, conflicts, countIn, expandRange, freeGaps, habitWindow, logIndex, nextBlock } from "../lib/derive";
import { navigate } from "../lib/router";
import { openQuickAdd, openTask } from "../lib/ui";
import { usePrefs } from "../lib/prefs";
import { logHabit, scheduleTask, store, toggleTaskDone, updateTask, useData } from "../store";
import { atMinutes, fmtDayLong, fmtDuration, fmtRange, fmtTime, nowMinutes, todayIso } from "../dates";
import { toast } from "../lib/toast";

type Suggestion = { task: Task; start: number; end: number };

export function Today() {
  const data = useData();
  const { workStart, workEnd, bufferMinutes } = usePrefs();
  const [now, setNow] = useState(nowMinutes);
  const [plan, setPlan] = useState<Suggestion[] | null>(null);
  const [gapPicker, setGapPicker] = useState<{ gap: { start: number; end: number }; anchor: Anchor } | null>(null);
  const today = todayIso();

  useEffect(() => {
    const t = window.setInterval(() => setNow(nowMinutes()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const items = useMemo(() => expandRange(today, today, data).get(today) ?? [],
    [data.events, data.timeBlocks, data.taskBlocks, data.tasks, data.projects, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const blocks = useMemo(() => blocksByTask(data.taskBlocks), [data.taskBlocks]);
  const projects = useMemo(() => new Map(data.projects.map((p) => [p.id, p])), [data.projects]);

  const current = items.find((i) => i.start <= now && i.end > now);
  const next = items.find((i) => i.start > now);

  const open = data.tasks.filter((t) => !t.done);
  const overdue = open.filter((t) => t.deadline && t.deadline < today).sort(compareTasks);
  const dueToday = data.tasks.filter((t) => t.deadline === today).sort(compareTasks);
  const scheduledIds = new Set(data.taskBlocks.filter((b) => b.end_at.slice(0, 10) >= today).map((b) => b.task_id));
  const unscheduled = open.filter((t) => !scheduledIds.has(t.id)).sort((a, b) => {
    // Deadlines soonest first, then priority.
    const da = a.deadline ?? "9999";
    const db = b.deadline ?? "9999";
    return da.localeCompare(db) || b.priority - a.priority || a.position - b.position;
  });

  const dayTasks = items.filter((i) => i.kind === "task_block");
  const doneBlocks = dayTasks.filter((i) => i.done).length;
  const dueDone = dueToday.filter((t) => t.done).length;
  const totalToday = dayTasks.length + dueToday.filter((t) => !dayTasks.some((i) => i.taskId === t.id)).length;
  const doneToday = doneBlocks + dueToday.filter((t) => t.done && !dayTasks.some((i) => i.taskId === t.id)).length;
  void dueDone;

  // Free gaps from now (rounded up to 15 minutes) until the end of the working day.
  const from = Math.max(workStart, Math.ceil(now / 15) * 15);
  const gaps = freeGaps(items, from, Math.max(workEnd, from), 20);
  const freeTotal = gaps.reduce((s, g) => s + g.end - g.start, 0);

  function planDay() {
    const out: Suggestion[] = [];
    // Plan into gaps that keep the buffer clear around what's already scheduled.
    const free = freeGaps(items, from, Math.max(workEnd, from), 20, bufferMinutes);
    for (const task of unscheduled) {
      const need = task.duration_minutes ?? 30;
      const gap = free.find((g) => g.end - g.start >= need);
      if (!gap) continue;
      out.push({ task, start: gap.start, end: gap.start + need });
      gap.start += need + bufferMinutes;
      if (out.length >= 6) break;
    }
    if (!out.length) toast(unscheduled.length ? "No free gap is long enough today." : "No unscheduled tasks to plan.");
    setPlan(out.length ? out : null);
  }

  function acceptPlan(list: Suggestion[]) {
    for (const s of list) scheduleTask(s.task, atMinutes(today, s.start), atMinutes(today, s.end));
    toast(`Planned ${list.length} ${list.length === 1 ? "task" : "tasks"} into today`, { tone: "success" });
    setPlan(null);
  }

  const hour = new Date().getHours();
  const greeting = hour < 5 ? "Good night" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const pct = totalToday ? Math.round((doneToday / totalToday) * 100) : 0;

  // Agenda: items interleaved with free gaps.
  const clashes = conflicts(items);
  const agenda: ({ type: "item"; item: CalItem } | { type: "gap"; start: number; end: number })[] = [];
  const gapList = [...gaps];
  for (const item of items) {
    while (gapList.length && gapList[0].end <= item.start) agenda.push({ type: "gap", ...gapList.shift()! });
    agenda.push({ type: "item", item });
  }
  for (const g of gapList) agenda.push({ type: "gap", ...g });

  return (
    <div className="page today-page">
      <header className="page-head today-head">
        <div>
          <p className="eyebrow">{fmtDayLong(today)}</p>
          <h1>{greeting}</h1>
        </div>
        {totalToday > 0 && (
          <div className="ring-stat" title={`${doneToday} of ${totalToday} done`}>
            <Ring value={pct} size={44} />
            <div>
              <strong>{doneToday}/{totalToday}</strong>
              <span className="muted small">done today</span>
            </div>
          </div>
        )}
      </header>

      <NowCard current={current} next={next} now={now} />

      <div className="today-grid">
        <section className="card agenda-card">
          <div className="card-head">
            <h2>Schedule</h2>
            <span className="muted small">{freeTotal > 0 ? `${fmtDuration(freeTotal)} free` : ""}</span>
            <button className="btn sm ghost" onClick={() => navigate({ name: "calendar", view: "day", date: today })}>
              Open day <Icon name="arrowRight" size={14} />
            </button>
          </div>

          {gaps.length > 0 && unscheduled.length > 0 && !plan && (
            <button className="plan-cta" onClick={planDay}>
              <Icon name="wand" size={18} />
              <span>
                <strong>Plan my day</strong>
                <span className="muted small">Fit {Math.min(unscheduled.length, 6)} unscheduled {unscheduled.length === 1 ? "task" : "tasks"} into your free time</span>
              </span>
            </button>
          )}

          {plan && (
            <div className="plan-box">
              <div className="plan-head">
                <strong><Icon name="sparkle" size={15} /> Suggested plan</strong>
                <span className="grow" />
                <button className="btn sm ghost" onClick={() => setPlan(null)}>Dismiss</button>
                <button className="btn sm primary" onClick={() => acceptPlan(plan)}>Add all</button>
              </div>
              {plan.map((s) => (
                <div key={s.task.id} className="plan-row">
                  <span className="plan-time">{fmtRange(s.start, s.end)}</span>
                  <span className="grow truncate">{s.task.title}</span>
                  <button className="btn sm ghost" onClick={() => setPlan(plan.filter((x) => x !== s))} aria-label="Skip">Skip</button>
                </div>
              ))}
            </div>
          )}

          {items.length === 0 && gaps.length === 0 && (
            <Empty icon="calendar" title="Nothing scheduled">Drag a task onto the calendar, or press <kbd className="kbd">E</kbd> for an event.</Empty>
          )}

          <ol className="agenda">
            {agenda.map((a) => a.type === "gap" ? (
              <li key={`gap-${a.start}`} className="agenda-gap">
                <span className="agenda-time">{fmtTime(a.start, true)}</span>
                <button className="gap-btn" onClick={(e) => setGapPicker({ gap: a, anchor: anchorOf(e.currentTarget) })}>
                  <span>Free · {fmtDuration(a.end - a.start)}</span>
                  <span className="gap-add"><Icon name="plus" size={14} /> Plan</span>
                </button>
              </li>
            ) : (
              <AgendaItem key={a.item.key} item={a.item} now={now} conflict={clashes.has(a.item.key)} />
            ))}
          </ol>
        </section>

        <div className="today-side">
          {(overdue.length > 0 || dueToday.length > 0) && (
            <section className="card">
              <div className="card-head">
                <h2>Due</h2>
                {overdue.length > 0 && (
                  <button className="link-btn" onClick={() => overdue.forEach((t) => updateTask(t.id, { deadline: today }))}>
                    Reschedule overdue to today
                  </button>
                )}
              </div>
              <div className="task-list">
                {[...overdue, ...dueToday].map((t) => (
                  <TaskRow key={t.id} task={t} project={t.project_id ? projects.get(t.project_id) : undefined}
                    block={nextBlock(blocks.get(t.id))} hideDate={today} onOpen={(x) => openTask(x.id)} />
                ))}
              </div>
            </section>
          )}

          <HabitsCard />

          <section className="card">
            <div className="card-head">
              <h2>Up next</h2>
              <span className="count">{unscheduled.length}</span>
              <button className="btn sm ghost" onClick={() => navigate({ name: "tasks", list: "anytime" })}>All <Icon name="arrowRight" size={14} /></button>
            </div>
            {unscheduled.length === 0 ? (
              <p className="muted small pad">Every open task has a time. </p>
            ) : (
              <div className="task-list">
                {unscheduled.filter((t) => !t.deadline || t.deadline > today).slice(0, 6).map((t) => (
                  <TaskRow key={t.id} task={t} project={t.project_id ? projects.get(t.project_id) : undefined}
                    onOpen={(x) => openTask(x.id)} />
                ))}
              </div>
            )}
            <button className="add-row" onClick={() => openQuickAdd({ mode: "task" })}><Icon name="plus" size={15} /> Add task</button>
          </section>
        </div>
      </div>

      {gapPicker && (
        <GapPicker gap={gapPicker.gap} anchor={gapPicker.anchor} tasks={unscheduled}
          onClose={() => setGapPicker(null)}
          onPick={(task) => {
            const end = Math.min(gapPicker.gap.start + (task.duration_minutes ?? 30), gapPicker.gap.end);
            scheduleTask(task, atMinutes(today, gapPicker.gap.start), atMinutes(today, end));
            setGapPicker(null);
          }}
          onEvent={() => {
            openQuickAdd({ mode: "event", date: today, start: gapPicker.gap.start, end: Math.min(gapPicker.gap.start + 60, gapPicker.gap.end) });
            setGapPicker(null);
          }} />
      )}
    </div>
  );
}

function NowCard({ current, next, now }: { current?: CalItem; next?: CalItem; now: number }) {
  if (!current && !next) return null;
  return (
    <div className="now-card">
      {current ? (
        <div className="now-main" style={{ "--c": current.color } as CSSProperties}>
          <span className="now-label"><span className="pulse" /> Now</span>
          <strong className="now-title">{current.title}</strong>
          <div className="now-progress"><span style={{ width: `${((now - current.start) / (current.end - current.start)) * 100}%` }} /></div>
          <span className="muted small">{fmtDuration(current.end - now)} left · until {fmtTime(current.end, true)}</span>
        </div>
      ) : (
        <div className="now-main free">
          <span className="now-label">Now</span>
          <strong className="now-title">Free time</strong>
          <span className="muted small">{next ? `${fmtDuration(next.start - now)} until ${next.title}` : ""}</span>
        </div>
      )}
      {next && (
        <div className="now-next" style={{ "--c": next.color } as CSSProperties}>
          <span className="now-label">Next · in {fmtDuration(next.start - now)}</span>
          <strong className="truncate">{next.title}</strong>
          <span className="muted small">{fmtRange(next.start, next.end)}</span>
        </div>
      )}
    </div>
  );
}

function AgendaItem({ item, now, conflict }: { item: CalItem; now: number; conflict: boolean }) {
  const past = item.end <= now;
  const live = item.start <= now && item.end > now;
  const task = item.taskId !== undefined ? store.get().tasks.find((t) => t.id === item.taskId) : undefined;
  return (
    <li className={"agenda-item" + (past ? " past" : "") + (live ? " live" : "") + (item.done ? " done" : "")}
      style={{ "--c": item.color } as CSSProperties}>
      <span className="agenda-time">{fmtTime(item.start, true)}</span>
      <button className="agenda-body" onClick={() => task ? openTask(task.id) : navigate({ name: "calendar", view: "day", date: item.date })}>
        <span className="agenda-bar" />
        <span className="agenda-text">
          <span className="agenda-title">
            {item.kind === "time" && <Icon name="repeat" size={12} />} {item.title}
          </span>
          <span className="muted small">
            {fmtRange(item.start, item.end)} · {fmtDuration(item.end - item.start)}
            {item.location && <> · {item.location}</>}
          </span>
          {conflict && <span className="agenda-conflict">Overlaps another item</span>}
        </span>
      </button>
      {task && <TaskCheck done={task.done} priority={task.priority} onToggle={() => toggleTaskDone(task)} label="Complete" />}
    </li>
  );
}

function GapPicker({ gap, anchor, tasks, onPick, onEvent, onClose }: {
  gap: { start: number; end: number }; anchor: Anchor; tasks: Task[];
  onPick: (t: Task) => void; onEvent: () => void; onClose: () => void;
}) {
  const len = gap.end - gap.start;
  const fits = tasks.filter((t) => (t.duration_minutes ?? 30) <= len);
  const rest = tasks.filter((t) => (t.duration_minutes ?? 30) > len);
  return (
    <Popover anchor={anchor} onClose={onClose} width={300} className="gap-pop">
      <div className="pop-head"><strong>{fmtRange(gap.start, gap.end)}</strong><span className="muted small">{fmtDuration(len)} free</span></div>
      <div className="gap-list">
        {[...fits, ...rest].slice(0, 8).map((t) => (
          <button key={t.id} className={"gap-task" + (fits.includes(t) ? "" : " too-long")} onClick={() => onPick(t)}>
            <span className="truncate grow">{t.title}</span>
            <span className="muted small">{fmtDuration(t.duration_minutes ?? 30)}</span>
          </button>
        ))}
        {tasks.length === 0 && <p className="muted small">No unscheduled tasks.</p>}
      </div>
      <button className="btn sm ghost full" onClick={onEvent}><Icon name="calendar" size={14} /> New event here</button>
    </Popover>
  );
}

function HabitsCard() {
  const habits = useData((s) => s.habits);
  const logs = useData((s) => s.habitLogs);
  const today = todayIso();
  const idx = useMemo(() => logIndex(logs), [logs]);
  if (!habits.length) return null;
  return (
    <section className="card">
      <div className="card-head">
        <h2>Habits</h2>
        <button className="btn sm ghost" onClick={() => navigate({ name: "habits" })}>All <Icon name="arrowRight" size={14} /></button>
      </div>
      <div className="habit-chips">
        {habits.map((h) => {
          const w = habitWindow(h);
          const done = countIn(idx.get(h.id), w.start, w.end);
          const met = done >= h.target_count;
          return (
            <button key={h.id} className={"habit-chip" + (met ? " met" : "")}
              onClick={() => {
                logHabit(h.id, today, 1);
                toast(`Logged “${h.title}”`, { action: { label: "Undo", run: () => logHabit(h.id, today, -1) } });
              }}
              onContextMenu={(e) => { e.preventDefault(); logHabit(h.id, today, -1); }}
              title={`${done}/${h.target_count} this ${h.target_period} — click to log, right-click to undo`}>
              <Ring value={Math.min(100, (done / h.target_count) * 100)} size={30} done={met} />
              <span className="habit-chip-text">
                <span className="truncate">{h.title}</span>
                <span className="muted small">{done}/{h.target_count} {h.target_period === "day" ? "today" : "this week"}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function Ring({ value, size = 40, done }: { value: number; size?: number; done?: boolean }) {
  const r = (size - 5) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg className={"ring" + (done || value >= 100 ? " full" : "")} width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} className="ring-track" />
      <circle cx={size / 2} cy={size / 2} r={r} className="ring-fill"
        strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(100, value) / 100)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      {(done || value >= 100) && (
        <path d={`M${size * 0.34} ${size * 0.52} l${size * 0.11} ${size * 0.11} l${size * 0.22} -${size * 0.24}`} className="ring-check" />
      )}
    </svg>
  );
}
