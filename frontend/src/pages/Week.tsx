import { CSSProperties, PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import { api, del, patch, post, Project, Task, WeekDay, WeekItem } from "../api";
import { Modal } from "../components/Modal";
import { ReminderPicker } from "../components/ReminderPicker";
import { EventEditor, EventValue, TaskEditor, TimeBlockEditor } from "../components/Editors";
import { addDays, isoDate, localIso, weekStartOf, timeLabel } from "../dates";

const FIRST_HOUR = 6;
const LAST_HOUR = 23;
const HOUR_PX = 56;
const SNAP_MINUTES = 15;
const DEFAULT_MINUTES = 60;
const HOURS = Array.from({ length: LAST_HOUR - FIRST_HOUR }, (_, i) => FIRST_HOUR + i);

// Minutes from the top of the grid for a time such as "08:30:00" or a Date.
function offsetPx(minutes: number): number {
  return ((minutes - FIRST_HOUR * 60) / 60) * HOUR_PX;
}

function minutesOf(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function minutesOfDate(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

function itemSpan(item: WeekItem): { top: number; height: number } {
  const startMin = item.kind === "time" ? minutesOf(item.start_time!) : minutesOfDate(item.start!);
  const endMin = item.kind === "time" ? minutesOf(item.end_time!) : minutesOfDate(item.end!);
  const top = Math.max(0, offsetPx(startMin));
  const height = Math.max(20, offsetPx(endMin) - offsetPx(startMin));
  return { top, height };
}

// What is being dragged. "new" comes from the task tray; "move" is an existing task block.
type DragState =
  | { kind: "new"; task: Task; minutes: number }
  | { kind: "move"; blockId: number; taskId: number; title: string; color: string; minutes: number; grabY: number };

type Hover = { day: string; minutes: number };

export function Week() {
  const [weekStart, setWeekStart] = useState(() => weekStartOf(new Date()));
  const now = new Date();
  const todayIso = isoDate(now);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const [days, setDays] = useState<WeekDay[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  // "all", "general" (no project), or a project id.
  const [trayFilter, setTrayFilter] = useState<"all" | "general" | number>("all");
  const [selected, setSelected] = useState(() => isoDate(new Date()));
  const [creating, setCreating] = useState<"event" | "time" | null>(null);
  const [editing, setEditing] = useState<WeekItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Drag state lives in refs as well so the window listeners always see the latest values.
  const [drag, setDrag] = useState<DragState | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const hoverRef = useRef<Hover | null>(null);

  async function load() {
    try {
      setDays(await api<WeekDay[]>(`/api/week?start=${isoDate(weekStart)}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the week");
    }
  }

  async function sendTest() {
    setError(null);
    try {
      const res = await post<{ sent_to: string[] }>("/api/notifications/test", {});
      setNotice(`Test sent via ${res.sent_to.join(", ")}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send the test");
    }
  }

  async function loadProjects() {
    try {
      setProjects(await api<Project[]>("/api/projects"));
    } catch {
      /* the tray still works without the project list */
    }
  }

  async function loadTasks() {
    try {
      setTasks(await api<Task[]>("/api/tasks"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load tasks");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart]);

  useEffect(() => {
    loadTasks();
    loadProjects();
  }, []);

  // Keep the selected day inside the visible week.
  useEffect(() => {
    const first = isoDate(weekStart);
    const last = isoDate(addDays(weekStart, 6));
    if (selected < first || selected > last) setSelected(first);
  }, [weekStart, selected]);

  function refresh() {
    load();
    loadTasks();
  }

  async function remove(item: WeekItem) {
    if (!confirm(`Delete "${item.title}"?`)) return;
    if (item.kind === "time") await del(`/api/time-blocks/${item.id}`);
    else if (item.kind === "event") await del(`/api/events/${item.id}`);
    else await del(`/api/task-blocks/${item.id}`);
    refresh();
  }

  // ---------- Drag and drop (pointer events: works with mouse and touch) ----------

  function findDropTarget(x: number, y: number, minutes: number, grabY: number): Hover | null {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-day]");
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const raw = FIRST_HOUR * 60 + ((y - rect.top - grabY) / HOUR_PX) * 60;
    const snapped = Math.round(raw / SNAP_MINUTES) * SNAP_MINUTES;
    const clamped = Math.min(Math.max(snapped, FIRST_HOUR * 60), LAST_HOUR * 60 - minutes);
    return { day: el.dataset.day!, minutes: clamped };
  }

  function startDrag(e: ReactPointerEvent, state: DragState) {
    e.preventDefault();
    dragRef.current = state;
    setDrag(state);
    setPointer({ x: e.clientX, y: e.clientY });

    const onMove = (ev: PointerEvent) => {
      const grabY = dragRef.current?.kind === "move" ? dragRef.current.grabY : 0;
      const minutes = dragRef.current!.minutes;
      setPointer({ x: ev.clientX, y: ev.clientY });
      const h = findDropTarget(ev.clientX, ev.clientY, minutes, grabY);
      hoverRef.current = h;
      setHover(h);
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      const current = dragRef.current;
      const target = hoverRef.current;
      dragRef.current = null;
      hoverRef.current = null;
      setDrag(null);
      setPointer(null);
      setHover(null);
      if (current && target) commitDrop(current, target);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  async function commitDrop(d: DragState, target: Hover) {
    const start = new Date(`${target.day}T00:00`);
    start.setMinutes(target.minutes);
    const end = new Date(start.getTime() + d.minutes * 60_000);
    try {
      if (d.kind === "new") {
        await post("/api/task-blocks", {
          task_id: d.task.id,
          start_at: localIso(start),
          end_at: localIso(end),
        });
      } else {
        await patch(`/api/task-blocks/${d.blockId}`, {
          start_at: localIso(start),
          end_at: localIso(end),
        });
      }
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not place the block");
    }
  }

  function startFromTray(e: ReactPointerEvent, task: Task) {
    startDrag(e, { kind: "new", task, minutes: task.duration_minutes ?? DEFAULT_MINUTES });
  }

  function startMove(e: ReactPointerEvent<HTMLDivElement>, item: WeekItem) {
    const rect = e.currentTarget.getBoundingClientRect();
    const minutes = Math.round(
      (new Date(item.end!).getTime() - new Date(item.start!).getTime()) / 60_000,
    );
    startDrag(e, {
      kind: "move",
      blockId: item.id,
      taskId: item.task_id!,
      title: item.title,
      color: item.color,
      minutes,
      grabY: e.clientY - rect.top,
    });
  }

  // Ghost preview that follows the pointer.
  const ghostLabel = drag ? (drag.kind === "new" ? drag.task.title : drag.title) : "";
  const hoverLabel = hover
    ? `${String(Math.floor(hover.minutes / 60)).padStart(2, "0")}:${String(hover.minutes % 60).padStart(2, "0")}`
    : "";

  const trayTasks = tasks.filter((t) => {
    if (t.done) return false;
    if (trayFilter === "all") return true;
    if (trayFilter === "general") return t.project_id === null;
    return t.project_id === trayFilter;
  });

  function editingTitle(item: WeekItem): string {
    if (item.kind === "event") return "Edit event";
    if (item.kind === "time") return "Edit time block";
    return "Edit task";
  }

  return (
    <section className="week-layout">
      <aside className="tray">
        <div className="tray-head">
          <h2>Tasks</h2>
          <select aria-label="Filter tasks by board" value={String(trayFilter)} onChange={(e) => {
            const v = e.target.value;
            setTrayFilter(v === "all" || v === "general" ? v : Number(v));
          }}>
            <option value="all">All boards</option>
            <option value="general">General</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        {trayTasks.length === 0 && <p className="muted small">No open tasks.</p>}
        <div className="tray-list">
          {trayTasks.map((t) => (
            <div key={t.id} className="tray-task draggable"
              onPointerDown={(e) => startFromTray(e, t)}>
              <span className="grow">{t.title}</span>
              <span className="muted small">{t.duration_minutes ?? DEFAULT_MINUTES}m</span>
            </div>
          ))}
        </div>
      </aside>

      <div className="week-main">
        <div className="week-header">
          <button className="icon" onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Previous week">‹</button>
          <strong className="week-title">
            {weekStart.toLocaleDateString(undefined, { month: "short", day: "numeric" })} –{" "}
            {addDays(weekStart, 6).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          </strong>
          <button className="icon" onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Next week">›</button>
          <button className="chip" onClick={() => setWeekStart(weekStartOf(new Date()))}>Today</button>
          <div className="actions">
            <button onClick={() => setCreating("event")}>+ Event</button>
            <button onClick={() => setCreating("time")}>+ Time block</button>
            <button className="ghost" onClick={sendTest}>Test alerts</button>
          </div>
        </div>

        {error && <div className="banner" role="alert">{error}</div>}
        {notice && <p className="notice">{notice}</p>}

        {creating && (
          <Modal title={creating === "event" ? "New event" : "New time block"} onClose={() => setCreating(null)}>
            {creating === "event" ? (
              <EventEditor defaultDay={selected} onDone={() => { setCreating(null); refresh(); }} />
            ) : (
              <TimeBlockEditor defaultDay={selected} onDone={() => { setCreating(null); refresh(); }} />
            )}
          </Modal>
        )}

        {editing && (
          <Modal title={editingTitle(editing)} onClose={() => setEditing(null)}>
            {editing.kind === "event" && (
              <>
                <EventEditor
                  event={{ id: editing.id, title: editing.title, start: editing.start!, end: editing.end!, color: editing.color } as EventValue}
                  defaultDay={selected}
                  onDone={() => { setEditing(null); refresh(); }}
                />
                <ReminderPicker kind="event" targetId={editing.id} />
              </>
            )}
            {editing.kind === "time" && (
              <>
                <TimeBlockEditor timeBlockId={editing.id} defaultDay={selected}
                  onDone={() => { setEditing(null); refresh(); }} />
                <ReminderPicker kind="time_block" targetId={editing.id} />
              </>
            )}
            {editing.kind === "task_block" && tasks.find((t) => t.id === editing.task_id) && (
              <>
                <TaskEditor task={tasks.find((t) => t.id === editing.task_id)!}
                  onDone={() => { setEditing(null); refresh(); }} />
                <ReminderPicker kind="task_block" targetId={editing.id} />
              </>
            )}
          </Modal>
        )}

        <div className="day-picker mobile-only">
          {days.map((d) => {
            const date = new Date(d.date + "T00:00");
            const classes = ["day-chip"];
            if (d.date === selected) classes.push("active");
            if (d.date === todayIso) classes.push("today");
            return (
              <button key={d.date} className={classes.join(" ")}
                aria-pressed={d.date === selected}
                onClick={() => setSelected(d.date)}>
                <span>{date.toLocaleDateString(undefined, { weekday: "short" })}</span>
                <span className="day-num">{date.getDate()}</span>
              </button>
            );
          })}
        </div>

        <div className="week-grid">
          <div className="hour-col">
            {HOURS.map((h) => (
              <div key={h} className="hour-label" style={{ top: offsetPx(h * 60) }}>
                {String(h).padStart(2, "0")}:00
              </div>
            ))}
          </div>

          {days.map((day) => (
            <div key={day.date}
              className={"day-col" + (day.date === selected ? " selected" : "")}>
              <div className="day-head">
                {new Date(day.date + "T00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric" })}
              </div>
              <div className={"day-body" + (hover?.day === day.date ? " drop-target" : "")}
                data-day={day.date}
                style={{ height: HOURS.length * HOUR_PX }}>
                {HOURS.map((h) => (
                  <div key={h} className="hour-line" style={{ top: offsetPx(h * 60) }} />
                ))}

                {hover?.day === day.date && (
                  <div className="drop-preview"
                    style={{
                      top: offsetPx(hover.minutes),
                      height: offsetPx(hover.minutes + (drag?.minutes ?? DEFAULT_MINUTES)) - offsetPx(hover.minutes),
                    }}>
                    {hoverLabel}
                  </div>
                )}

                {day.date === todayIso && nowMinutes >= FIRST_HOUR * 60 && nowMinutes <= LAST_HOUR * 60 && (
                  <div className="now-line" style={{ top: offsetPx(nowMinutes) }} />
                )}

                {day.items.map((item) => {
                  const { top, height } = itemSpan(item);
                  const time = item.kind === "time"
                    ? `${item.start_time!.slice(0, 5)}–${item.end_time!.slice(0, 5)}`
                    : `${timeLabel(item.start!)}–${timeLabel(item.end!)}`;
                  const movable = item.kind === "task_block";
                  // Inset by 1px top and bottom so stacked blocks have a visible gap.
                  const style = { top: top + 1, height: height - 2, "--c": item.color } as CSSProperties;
                  return (
                    <div key={`${item.kind}-${item.id}`}
                      className={`block ${item.kind}` + (movable ? " draggable" : "")}
                      style={style}
                      onPointerDown={movable ? (e) => startMove(e, item) : undefined}
                      onClick={() => setEditing(item)}>
                      <span className="block-body">
                      <span className="block-title">{item.title}</span>
                      <span className="block-time">{time}</span>
                      </span>
                      <button className="block-x" aria-label={`Delete ${item.title}`}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); remove(item); }}>×</button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {drag && pointer && (
        <div className="drag-ghost" style={{ left: pointer.x + 12, top: pointer.y + 12 }}>
          {ghostLabel}
        </div>
      )}
    </section>
  );
}
