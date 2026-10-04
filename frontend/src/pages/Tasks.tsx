import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Task } from "../api";
import { TaskRow } from "../components/TaskRow";
import { Empty, IconButton } from "../components/primitives";
import { Icon, IconName } from "../components/Icon";
import { blocksByTask, compareTasks, nextBlock } from "../lib/derive";
import { navigate } from "../lib/router";
import { anyOverlayOpen, isTyping, openTask } from "../lib/ui";
import { matchProject, parseQuickAdd } from "../lib/nlp";
import { boardColumns, createTask, deleteTasks, scheduleTask, toggleTaskDone, updateTask, useData } from "../store";
import { addDaysIso, atMinutes, fmtDayLong, relDay, todayIso } from "../dates";
import { usePrefs, setPref } from "../lib/prefs";

type Group = { key: string; title: string; tone?: string; date?: string; tasks: Task[] };

const LISTS: { id: string; label: string; icon: IconName }[] = [
  { id: "inbox", label: "Inbox", icon: "inbox" },
  { id: "today", label: "Today", icon: "today" },
  { id: "upcoming", label: "Upcoming", icon: "upcoming" },
  { id: "anytime", label: "All open", icon: "anytime" },
  { id: "done", label: "Completed", icon: "done" },
];

export function Tasks({ list }: { list: string }) {
  const data = useData();
  const { showCompleted } = usePrefs();
  const today = todayIso();
  const projectId = list.startsWith("project:") ? Number(list.slice(8)) : null;
  const project = projectId !== null ? data.projects.find((p) => p.id === projectId) : undefined;
  const blocks = useMemo(() => blocksByTask(data.taskBlocks), [data.taskBlocks]);
  const projects = useMemo(() => new Map(data.projects.map((p) => [p.id, p])), [data.projects]);

  const groups = useMemo<Group[]>(() => {
    const visible = (t: Task) => showCompleted || !t.done;
    const open = data.tasks.filter((t) => !t.done);
    const sort = (ts: Task[]) => ts.sort(compareTasks);
    const blockDay = (t: Task) => blocks.get(t.id)?.find((b) => b.start_at.slice(0, 10) >= today)?.start_at.slice(0, 10);

    if (list === "inbox") {
      return [{ key: "inbox", title: "", tasks: sort(data.tasks.filter((t) => t.project_id === null && (t.column_key === "inbox" || (t.done && showCompleted && !blocks.has(t.id))) && visible(t))) }];
    }
    if (list === "today") {
      const overdue = sort(open.filter((t) => t.deadline && t.deadline < today));
      const todays = sort(data.tasks.filter((t) => visible(t) && !overdue.includes(t) &&
        (t.deadline === today || blocks.get(t.id)?.some((b) => b.start_at.slice(0, 10) === today))));
      return [
        { key: "overdue", title: "Overdue", tone: "danger", tasks: overdue },
        { key: "today", title: "Today", date: today, tasks: todays },
      ].filter((g) => g.tasks.length);
    }
    if (list === "upcoming") {
      const out: Group[] = [];
      const overdue = sort(open.filter((t) => t.deadline && t.deadline < today));
      if (overdue.length) out.push({ key: "overdue", title: "Overdue", tone: "danger", tasks: overdue });
      const seen = new Set(overdue.map((t) => t.id));
      for (let i = 0; i < 14; i++) {
        const day = addDaysIso(today, i);
        const ts = sort(data.tasks.filter((t) => visible(t) && !seen.has(t.id) && (t.deadline === day || blockDay(t) === day)));
        ts.forEach((t) => seen.add(t.id));
        out.push({ key: day, title: i < 2 ? relDay(day) : fmtDayLong(day), date: day, tasks: ts });
      }
      const later = sort(open.filter((t) => !seen.has(t.id) && t.deadline && t.deadline > addDaysIso(today, 13)));
      if (later.length) out.push({ key: "later", title: "Later", tasks: later });
      return out;
    }
    if (list === "done") {
      return [{ key: "done", title: "", tasks: data.tasks.filter((t) => t.done).sort((a, b) => b.id - a.id) }];
    }
    if (projectId !== null) {
      return boardColumns(data.columns, projectId)
        .filter((c) => showCompleted || !c.is_done)
        .map((c) => ({ key: `col-${c.id}`, title: c.name, tasks: sort(data.tasks.filter((t) => t.column_id === c.id)) }))
        .filter((g) => g.tasks.length);
    }
    // anytime: all open tasks, grouped by board
    const boards = [{ id: null as number | null, name: "General" }, ...data.projects];
    return boards
      .map((b) => ({ key: `b-${b.id}`, title: b.name, tasks: sort(data.tasks.filter((t) => t.project_id === b.id && visible(t))) }))
      .filter((g) => g.tasks.length);
  }, [data.tasks, data.projects, data.columns, blocks, list, projectId, showCompleted, today]);

  const flat = useMemo(() => groups.flatMap((g) => g.tasks), [groups]);
  const [focus, setFocus] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const anchorRef = useRef<number | null>(null);

  useEffect(() => { setSelected(new Set()); setFocus(null); }, [list]);

  const onSelect = useCallback((task: Task, e: React.MouseEvent) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (e.shiftKey && anchorRef.current !== null) {
        const a = flat.findIndex((t) => t.id === anchorRef.current);
        const b = flat.findIndex((t) => t.id === task.id);
        if (a >= 0 && b >= 0) for (let i = Math.min(a, b); i <= Math.max(a, b); i++) next.add(flat[i].id);
      } else if (next.has(task.id)) next.delete(task.id);
      else next.add(task.id);
      anchorRef.current = task.id;
      return next;
    });
  }, [flat]);

  // j/k or arrows move focus; x completes; Enter opens; Backspace deletes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping() || anyOverlayOpen()) return;
      const idx = flat.findIndex((t) => t.id === focus);
      const k = e.key;
      if (k === "j" || k === "ArrowDown") { e.preventDefault(); setFocus(flat[Math.min(idx + 1, flat.length - 1)]?.id ?? null); }
      else if (k === "k" || k === "ArrowUp") { e.preventDefault(); setFocus(flat[Math.max(idx - 1, 0)]?.id ?? null); }
      else if (k === "Escape" && selected.size) setSelected(new Set());
      else if (idx >= 0 && (k === "x" || k === " ")) { e.preventDefault(); toggleTaskDone(flat[idx]); }
      else if (idx >= 0 && k === "Enter") { e.preventDefault(); openTask(flat[idx].id); }
      else if (k === "Backspace" || k === "Delete") {
        const targets = selected.size ? flat.filter((t) => selected.has(t.id)) : idx >= 0 ? [flat[idx]] : [];
        if (!targets.length) return;
        e.preventDefault();
        deleteTasks(targets);
        setSelected(new Set());
        setFocus(flat[idx + 1]?.id ?? flat[idx - 1]?.id ?? null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flat, focus, selected]);

  useEffect(() => {
    if (focus !== null) document.querySelector(`[data-task-row="${focus}"]`)?.scrollIntoView({ block: "nearest" });
  }, [focus]);

  const meta = LISTS.find((l) => l.id === list);
  const heading = project ? project.name : meta?.label ?? "Tasks";
  const openCount = flat.filter((t) => !t.done).length;
  const selectedTasks = flat.filter((t) => selected.has(t.id));
  const isEmpty = flat.length === 0;

  return (
    <div className="page tasks-page">
      <header className="page-head">
        <div>
          <h1>
            {project && <span className="board-dot lg" style={{ background: project.color }} />}
            {heading}
          </h1>
          <p className="page-sub">{list === "done" ? `${flat.length} completed` : `${openCount} open`}</p>
        </div>
        <div className="row-gap">
          {list !== "done" && (
            <button className={"btn sm ghost" + (showCompleted ? " on" : "")} onClick={() => setPref("showCompleted", !showCompleted)}>
              <Icon name="done" size={15} /> {showCompleted ? "Hide completed" : "Show completed"}
            </button>
          )}
          {project && <button className="btn sm" onClick={() => navigate({ name: "board", id: project.id })}><Icon name="board" size={15} /> Board</button>}
        </div>
      </header>

      <nav className="list-tabs" aria-label="Task lists">
        {LISTS.map((l) => (
          <button key={l.id} className={"list-tab" + (list === l.id ? " on" : "")} onClick={() => navigate({ name: "tasks", list: l.id })}>
            <Icon name={l.icon} size={15} /> {l.label}
          </button>
        ))}
        {data.projects.map((p) => (
          <button key={p.id} className={"list-tab" + (projectId === p.id ? " on" : "")} onClick={() => navigate({ name: "tasks", list: `project:${p.id}` })}>
            <span className="board-dot" style={{ background: p.color }} /> {p.name}
          </button>
        ))}
      </nav>

      {list !== "done" && <InlineAdd list={list} projectId={projectId} />}

      {isEmpty ? (
        <EmptyState list={list} />
      ) : (
        <div className="task-groups" role="list">
          {groups.map((g) => (
            <section key={g.key} className={"task-group" + (g.tasks.length === 0 ? " empty-group" : "")}>
              {g.title && (
                <h2 className={"group-title" + (g.tone ? " " + g.tone : "")}>
                  {g.title}
                  <span className="count">{g.tasks.length || ""}</span>
                  {g.key === "overdue" && g.tasks.length > 1 && (
                    <button className="link-btn" onClick={() => g.tasks.forEach((t) => updateTask(t.id, { deadline: today }))}>
                      Move all to today
                    </button>
                  )}
                </h2>
              )}
              {g.tasks.map((t) => (
                <TaskRow key={t.id} task={t} project={t.project_id ? projects.get(t.project_id) : undefined}
                  block={nextBlock(blocks.get(t.id))} showProject={projectId === null}
                  hideDate={g.date} selected={selected.has(t.id)} focused={focus === t.id}
                  onOpen={(task) => { setFocus(task.id); openTask(task.id); }} onSelect={onSelect} />
              ))}
            </section>
          ))}
        </div>
      )}

      {selected.size > 0 && (
        <BulkBar tasks={selectedTasks} onClear={() => setSelected(new Set())} />
      )}
    </div>
  );
}

function EmptyState({ list }: { list: string }) {
  if (list === "inbox") return <Empty icon="inbox" title="Inbox zero">Capture anything with <kbd className="kbd">C</kbd>. It lands here until you plan it.</Empty>;
  if (list === "today") return <Empty icon="sun" title="Nothing due today">Enjoy the space, or pull something forward from Upcoming.</Empty>;
  if (list === "done") return <Empty icon="done" title="No completed tasks yet" />;
  return <Empty icon="tasks" title="No tasks here">Add one above.</Empty>;
}

// A one-line capture that understands dates, #boards and !priority.
function InlineAdd({ list, projectId }: { list: string; projectId: number | null }) {
  const projects = useData((s) => s.projects);
  const [text, setText] = useState("");
  const parsed = useMemo(() => parseQuickAdd(text), [text]);
  const matched = matchProject(parsed.project, projects);

  function submit(e: FormEvent) {
    e.preventDefault();
    const title = parsed.title.trim();
    if (!title) return;
    const today = todayIso();
    const deadline = parsed.deadline ?? (parsed.start === undefined ? parsed.date : undefined) ?? (list === "today" ? today : null);
    const task = createTask({
      title,
      project_id: matched?.id ?? projectId,
      deadline,
      duration_minutes: parsed.duration ?? null,
      priority: parsed.priority ?? 0,
    });
    if (parsed.start !== undefined) {
      const day = parsed.date ?? today;
      scheduleTask(task, atMinutes(day, parsed.start), atMinutes(day, Math.min(parsed.start + (parsed.duration ?? 60), 1439)));
    }
    setText("");
  }

  const hints: string[] = [];
  if (matched) hints.push(`# ${matched.name}`);
  if (parsed.deadline) hints.push(`due ${relDay(parsed.deadline)}`);
  else if (parsed.date && parsed.start === undefined) hints.push(`due ${relDay(parsed.date)}`);
  if (parsed.start !== undefined) hints.push(`scheduled ${relDay(parsed.date ?? todayIso())}`);
  if (parsed.priority) hints.push(["", "low", "medium", "high"][parsed.priority] + " priority");
  if (parsed.duration) hints.push(`${parsed.duration}m`);

  return (
    <form className="inline-add" onSubmit={submit}>
      <Icon name="plus" size={18} />
      <input value={text} onChange={(e) => setText(e.target.value)} aria-label="Add a task"
        placeholder={list === "today" ? "Add a task for today…" : "Add a task… try “Call Sam tomorrow !1 #work”"}
        onKeyDown={(e) => { if (e.key === "Escape") (e.target as HTMLInputElement).blur(); }} />
      {hints.length > 0 && <span className="inline-hints">{hints.map((h) => <span key={h} className="chip-static">{h}</span>)}</span>}
    </form>
  );
}

function BulkBar({ tasks, onClear }: { tasks: Task[]; onClear: () => void }) {
  const projects = useData((s) => s.projects);
  const today = todayIso();
  const allDone = tasks.every((t) => t.done);
  return (
    <div className="bulk-bar" role="toolbar" aria-label="Selected tasks">
      <span className="bulk-count">{tasks.length} selected</span>
      <button className="btn sm" onClick={() => { tasks.forEach((t) => { if (t.done === allDone) toggleTaskDone(t); }); onClear(); }}>
        <Icon name="check" size={15} /> {allDone ? "Reopen" : "Complete"}
      </button>
      <button className="btn sm" onClick={() => tasks.forEach((t) => updateTask(t.id, { deadline: today }))}>Due today</button>
      <button className="btn sm" onClick={() => tasks.forEach((t) => updateTask(t.id, { deadline: addDaysIso(today, 1) }))}>Tomorrow</button>
      <select className="btn sm" value="" aria-label="Move to board" onChange={(e) => {
        const v = e.target.value;
        if (!v) return;
        tasks.forEach((t) => updateTask(t.id, { project_id: v === "general" ? null : Number(v) }));
        onClear();
      }}>
        <option value="">Move to…</option>
        <option value="general">General</option>
        {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <select className="btn sm" value="" aria-label="Priority" onChange={(e) => {
        if (e.target.value) tasks.forEach((t) => updateTask(t.id, { priority: Number(e.target.value) }));
      }}>
        <option value="">Priority…</option>
        <option value="3">High</option>
        <option value="2">Medium</option>
        <option value="1">Low</option>
        <option value="0">None</option>
      </select>
      <IconButton icon="trash" label="Delete selected" onClick={() => { deleteTasks(tasks); onClear(); }} />
      <IconButton icon="close" label="Clear selection" onClick={onClear} />
    </div>
  );
}

