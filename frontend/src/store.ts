// The app's data, held in memory and kept in sync with the API.
//
// Everything loads once at start. Every change is applied locally first (so the UI reacts on
// the same frame), then sent to the server; if the server rejects it, the change is reverted
// and an error toast explains why. Deletes wait a few seconds behind an "Undo" toast before
// they are sent, so undo never has to re-create anything.
//
// New items get a temporary negative id until the server answers. Requests that mention a
// temporary id wait for the real one, so you can edit or drag an item the moment it appears.

import {
  api, CalEvent, Column, del, Habit, HabitLog, patch, post, Project, put,
  Reminder, ReminderKind, Task, TaskBlock, TimeBlock,
} from "./api";
import { createStore } from "./lib/createStore";
import { toast, toastError } from "./lib/toast";
import { addDays, isoDate } from "./dates";

export type Data = {
  ready: boolean;
  tasks: Task[];
  projects: Project[];
  columns: Column[];
  events: CalEvent[];
  timeBlocks: TimeBlock[];
  taskBlocks: TaskBlock[];
  habits: Habit[];
  habitLogs: HabitLog[];
  reminders: Reminder[];
  pending: number; // requests in flight
};

type ListKey = "tasks" | "projects" | "columns" | "events" | "timeBlocks" | "taskBlocks" | "habits";
type Item = { id: number };

const EMPTY: Data = {
  ready: false, tasks: [], projects: [], columns: [], events: [], timeBlocks: [],
  taskBlocks: [], habits: [], habitLogs: [], reminders: [], pending: 0,
};

export const store = createStore<Data>(EMPTY);
export const useData = store.use;

// ---------- Low-level helpers ----------

function setList<K extends ListKey>(key: K, fn: (list: Data[K]) => Data[K]) {
  store.set((s) => ({ ...s, [key]: fn(s[key]) }));
}

function updateItem<K extends ListKey>(key: K, id: number, fn: (item: Data[K][number]) => Data[K][number]) {
  setList(key, (list) => list.map((x) => (x.id === id ? fn(x as never) : x)) as Data[K]);
}

function getItem<K extends ListKey>(key: K, id: number): Data[K][number] | undefined {
  return (store.get()[key] as Item[]).find((x) => x.id === id) as Data[K][number] | undefined;
}

// Temporary ids for optimistic creates.
let tempSeq = -1;
const realIds = new Map<number, Promise<number>>();
const touched = new Set<number>(); // temp ids changed locally before the server answered
const resolved = new Map<number, number>(); // temp id -> real id, once known

// The id an item has now: a temporary id is swapped for the real one after saving.
export function currentId(id: number): number {
  return resolved.get(id) ?? id;
}

async function realId(id: number): Promise<number> {
  if (id >= 0) return id;
  const p = realIds.get(id);
  if (!p) throw new Error("This item was not saved");
  return p;
}

// Per-item change counter, so a slow response never overwrites a newer local change.
const versions = new Map<string, number>();
function bump(key: string): number {
  const v = (versions.get(key) ?? 0) + 1;
  versions.set(key, v);
  return v;
}

async function tracked<T>(p: Promise<T>): Promise<T> {
  store.set((s) => ({ ...s, pending: s.pending + 1 }));
  try {
    return await p;
  } finally {
    store.set((s) => ({ ...s, pending: s.pending - 1 }));
  }
}

// Optimistic update of one existing item. `send` gets the real id.
async function mutate<K extends ListKey>(
  key: K, id: number, change: Partial<Data[K][number]>,
  send: (realId: number) => Promise<Data[K][number] | void>,
  opts: { apply?: (server: Data[K][number]) => Data[K][number] } = {},
) {
  const before = getItem(key, id);
  if (!before) return;
  const vkey = `${key}:${id}`;
  const v = bump(vkey);
  if (id < 0) touched.add(id);
  updateItem(key, id, (x) => ({ ...x, ...change }));
  try {
    const rid = await realId(id);
    const server = await tracked(send(rid));
    const currentId = id < 0 ? rid : id;
    if (server && versions.get(vkey) === v) {
      updateItem(key, currentId, () => (opts.apply ? opts.apply(server) : server));
    }
  } catch (e) {
    if (versions.get(vkey) === v) {
      const currentId = getItem(key, id) ? id : (await realId(id).catch(() => id));
      updateItem(key, currentId, (x) => ({ ...x, ...pick(before, Object.keys(change)) }));
    }
    toastError(e, "Could not save the change");
    throw e;
  }
}

function pick<T extends object>(obj: T, keys: string[]): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = (obj as Record<string, unknown>)[k];
  return out as Partial<T>;
}

// Optimistic create. Returns the temporary item immediately.
function create<K extends ListKey>(
  key: K, draft: Omit<Data[K][number], "id">, send: () => Promise<Data[K][number]>,
  opts: { after?: (server: Data[K][number], tempId: number) => void } = {},
): Data[K][number] {
  const tempId = tempSeq--;
  const item = { ...draft, id: tempId } as Data[K][number];
  setList(key, (list) => [...list, item] as Data[K]);
  const promise = tracked(send()).then(
    (server) => {
      const local = getItem(key, tempId);
      // If it was edited while saving, keep the local fields and adopt only the real id.
      updateItem(key, tempId, () => (touched.has(tempId) && local ? { ...local, id: server.id } : server));
      touched.delete(tempId);
      resolved.set(tempId, server.id);
      remapReminders(tempId, server.id);
      opts.after?.(server, tempId);
      return server.id;
    },
    (e) => {
      setList(key, (list) => (list as Item[]).filter((x) => x.id !== tempId) as Data[K]);
      toastError(e, "Could not save");
      throw e;
    },
  );
  promise.catch(() => undefined);
  realIds.set(tempId, promise);
  return item;
}

function remapReminders(from: number, to: number) {
  store.set((s) => ({ ...s, reminders: s.reminders.map((r) => (r.target_id === from ? { ...r, target_id: to } : r)) }));
}

// ---------- Deletes with undo ----------

type PendingDelete = { timer: number; commit: () => Promise<void> };
const pendingDeletes = new Map<string, PendingDelete>();

function deleteWithUndo(label: string, opts: {
  key: string;
  remove: () => () => void; // applies the local removal, returns a restore function
  commit: () => Promise<void>;
}) {
  const restore = opts.remove();
  let done = false;
  const commit = async () => {
    if (done) return;
    done = true;
    pendingDeletes.delete(opts.key);
    try {
      await tracked(opts.commit());
    } catch (e) {
      restore();
      toastError(e, "Could not delete");
    }
  };
  const timer = window.setTimeout(commit, 5500);
  pendingDeletes.set(opts.key, { timer, commit });
  toast(label, {
    action: {
      label: "Undo",
      run: () => {
        if (done) return;
        done = true;
        window.clearTimeout(timer);
        pendingDeletes.delete(opts.key);
        restore();
      },
    },
    duration: 5500,
  });
}

// Send any deletes still waiting on their undo window, e.g. when the page is closing.
export function flushDeletes() {
  for (const p of [...pendingDeletes.values()]) {
    window.clearTimeout(p.timer);
    p.commit();
  }
}

function removeLocal<K extends ListKey>(key: K, pred: (x: Data[K][number]) => boolean): () => void {
  const removed = (store.get()[key] as Item[]).filter((x) => pred(x as never));
  setList(key, (list) => (list as Item[]).filter((x) => !pred(x as never)) as Data[K]);
  return () => setList(key, (list) => {
    const ids = new Set((list as Item[]).map((x) => x.id));
    return [...list, ...removed.filter((x) => !ids.has(x.id))] as Data[K];
  });
}

// ---------- Loading ----------

let lastSync = 0;

export async function loadAll(): Promise<void> {
  const today = new Date();
  const histStart = isoDate(addDays(today, -7 * 26));
  const histEnd = isoDate(addDays(today, 7));
  const [tasks, projects, events, timeBlocks, taskBlocks, habits, habitLogs, reminders, general] =
    await Promise.all([
      api<Task[]>("/api/tasks"),
      api<Project[]>("/api/projects"),
      api<CalEvent[]>("/api/events"),
      api<TimeBlock[]>("/api/time-blocks"),
      api<TaskBlock[]>("/api/task-blocks"),
      api<Habit[]>(`/api/habits?start=${isoDate(today)}&end=${isoDate(today)}`),
      api<HabitLog[]>(`/api/habits/history?start=${histStart}&end=${histEnd}`),
      api<Reminder[]>("/api/reminders").catch(() => [] as Reminder[]),
      api<Column[]>("/api/columns"),
    ]);
  const projectCols = await Promise.all(projects.map((p) => api<Column[]>(`/api/columns?project_id=${p.id}`)));
  lastSync = Date.now();
  // Don't clobber local changes that are still on their way to the server.
  if (store.get().pending > 0 || pendingDeletes.size > 0) return;
  store.set((s) => ({
    ...s, ready: true, tasks, projects, events, timeBlocks, taskBlocks, habits, habitLogs, reminders,
    columns: [...general, ...projectCols.flat()],
  }));
}

// Quietly refresh when the app comes back to the foreground (another device may have changed things).
export function refreshIfStale(maxAgeMs = 60_000) {
  if (!store.get().ready || Date.now() - lastSync < maxAgeMs) return;
  loadAll().catch(() => undefined);
}

export function resetStore() {
  store.set(EMPTY);
}

// ---------- Boards and columns ----------

export function boardColumns(columns: Column[], projectId: number | null): Column[] {
  return columns
    .filter((c) => c.project_id === projectId)
    .sort((a, b) => a.position - b.position || a.id - b.id);
}

function columnFields(columnId: number | null): Pick<Task, "column_id" | "column_key" | "done"> {
  const col = store.get().columns.find((c) => c.id === columnId);
  return { column_id: columnId, column_key: col?.key ?? null, done: !!col?.is_done };
}

export function createColumn(projectId: number | null, name: string) {
  const cols = boardColumns(store.get().columns, projectId);
  const position = (cols[cols.length - 1]?.position ?? 0) + 1;
  return create("columns", { project_id: projectId, name, key: null, position, is_done: false },
    () => post<Column>("/api/columns", { name, project_id: projectId }));
}

export function updateColumn(id: number, change: Partial<Pick<Column, "name" | "position" | "is_done">>) {
  return mutate("columns", id, change, (rid) => patch<Column>(`/api/columns/${rid}`, change)).then(() => {
    if ("is_done" in change) {
      setList("tasks", (list) => list.map((t) => (t.column_id === id ? { ...t, ...columnFields(id) } : t)));
    }
  });
}

export function reorderColumns(projectId: number | null, orderedIds: number[]) {
  const cols = boardColumns(store.get().columns, projectId);
  orderedIds.forEach((id, position) => {
    const c = cols.find((x) => x.id === id);
    if (c && c.position !== position) updateColumn(id, { position }).catch(() => undefined);
  });
}

export async function deleteColumn(col: Column) {
  const others = boardColumns(store.get().columns, col.project_id).filter((c) => c.id !== col.id);
  if (!others.length) {
    toast("A board needs at least one column", { tone: "error" });
    return;
  }
  const moved = store.get().tasks.filter((t) => t.column_id === col.id).map((t) => t.id);
  const target = others[0];
  deleteWithUndo(`Deleted column “${col.name}”`, {
    key: `column:${col.id}`,
    remove: () => {
      const restoreCol = removeLocal("columns", (c) => c.id === col.id);
      setList("tasks", (list) => list.map((t) => (moved.includes(t.id) ? { ...t, ...columnFields(target.id) } : t)));
      return () => {
        restoreCol();
        setList("tasks", (list) => list.map((t) => (moved.includes(t.id) ? { ...t, ...columnFields(col.id) } : t)));
      };
    },
    commit: async () => del(`/api/columns/${await realId(col.id)}`),
  });
}

// ---------- Projects ----------

export function createProject(name: string, color: string, deadline: string | null = null) {
  return create("projects", { name, color, deadline },
    () => post<Project>("/api/projects", { name, color, deadline }),
    {
      after: async (server) => {
        const cols = await api<Column[]>(`/api/columns?project_id=${server.id}`);
        store.set((s) => ({ ...s, columns: [...s.columns.filter((c) => c.project_id !== server.id), ...cols] }));
      },
    });
}

export function updateProject(id: number, change: Partial<Omit<Project, "id">>) {
  return mutate("projects", id, change, (rid) => patch<Project>(`/api/projects/${rid}`, change));
}

// Not undoable: the server moves the project's tasks to the general board.
export async function deleteProject(id: number) {
  try {
    await tracked(del(`/api/projects/${await realId(id)}`));
    const [tasks, general] = await Promise.all([api<Task[]>("/api/tasks"), api<Column[]>("/api/columns")]);
    store.set((s) => ({
      ...s, tasks,
      projects: s.projects.filter((p) => p.id !== id),
      columns: [...s.columns.filter((c) => c.project_id !== id && c.project_id !== null), ...general],
    }));
    toast("Board deleted. Its tasks moved to General.");
  } catch (e) {
    toastError(e, "Could not delete the board");
  }
}

// ---------- Tasks ----------

export type TaskDraft = {
  title: string;
  notes?: string;
  project_id?: number | null;
  column_id?: number | null;
  duration_minutes?: number | null;
  deadline?: string | null;
  priority?: number;
  position?: number;
};

export function createTask(draft: TaskDraft): Task {
  const projectId = draft.project_id ?? null;
  const columnId = draft.column_id ?? boardColumns(store.get().columns, projectId)[0]?.id ?? null;
  const body = {
    title: draft.title,
    notes: draft.notes ?? "",
    project_id: projectId,
    column_id: columnId,
    duration_minutes: draft.duration_minutes ?? null,
    deadline: draft.deadline ?? null,
    priority: draft.priority ?? 0,
    position: draft.position ?? 0,
  };
  return create("tasks", { ...body, ...columnFields(columnId) },
    async () => post<Task>("/api/tasks", { ...body, column_id: columnId === null ? null : await realId(columnId) }));
}

export function updateTask(id: number, change: Partial<Omit<Task, "id" | "column_key" | "done">>) {
  let local: Partial<Task> = change;
  const task = getItem("tasks", id);
  if (task && "project_id" in change && change.project_id !== task.project_id && !("column_id" in change)) {
    // Moving to another board starts at that board's first column.
    const first = boardColumns(store.get().columns, change.project_id ?? null)[0];
    local = { ...change, column_id: first?.id ?? null };
  }
  if ("column_id" in local) local = { ...local, ...columnFields(local.column_id ?? null) };
  return mutate("tasks", id, local, async (rid) => {
    const body: Record<string, unknown> = { ...change };
    if (typeof body.column_id === "number") body.column_id = await realId(body.column_id);
    return patch<Task>(`/api/tasks/${rid}`, body);
  }).catch(() => undefined);
}

const previousColumn = new Map<number, number | null>();

export function toggleTaskDone(task: Task) {
  const cols = boardColumns(store.get().columns, task.project_id);
  if (!task.done) {
    const doneCol = cols.find((c) => c.is_done);
    if (!doneCol) {
      toast("This board has no Done column. Mark one as done from its menu.", { tone: "error" });
      return;
    }
    previousColumn.set(task.id, task.column_id);
    mutate("tasks", task.id, columnFields(doneCol.id),
      (rid) => post<Task>(`/api/tasks/${rid}/complete`, {})).catch(() => undefined);
    toast(`Completed “${task.title}”`, {
      tone: "success",
      action: { label: "Undo", run: () => toggleTaskDone({ ...task, ...columnFields(doneCol.id) }) },
    });
  } else {
    const prev = previousColumn.get(task.id);
    const back = cols.find((c) => c.id === prev && !c.is_done) ?? cols.find((c) => !c.is_done);
    if (back) updateTask(task.id, { column_id: back.id });
  }
}

export function moveTasks(moves: { id: number; column_id: number; position: number }[]) {
  for (const m of moves) {
    const t = getItem("tasks", m.id);
    if (!t || (t.column_id === m.column_id && t.position === m.position)) continue;
    const change: Partial<Task> = { position: m.position };
    if (t.column_id !== m.column_id) change.column_id = m.column_id;
    updateTask(m.id, change);
  }
}

export function deleteTask(task: Task) {
  deleteWithUndo(`Deleted “${task.title}”`, {
    key: `task:${task.id}`,
    remove: () => {
      const a = removeLocal("tasks", (t) => t.id === task.id);
      const b = removeLocal("taskBlocks", (b) => b.task_id === task.id);
      return () => { a(); b(); };
    },
    commit: async () => del(`/api/tasks/${await realId(task.id)}`),
  });
}

export function deleteTasks(tasks: Task[]) {
  if (tasks.length === 1) return deleteTask(tasks[0]);
  const ids = new Set(tasks.map((t) => t.id));
  deleteWithUndo(`Deleted ${tasks.length} tasks`, {
    key: `tasks:${[...ids].join(",")}`,
    remove: () => {
      const a = removeLocal("tasks", (t) => ids.has(t.id));
      const b = removeLocal("taskBlocks", (b) => ids.has(b.task_id));
      return () => { a(); b(); };
    },
    commit: async () => {
      await Promise.all(tasks.map(async (t) => del(`/api/tasks/${await realId(t.id)}`)));
    },
  });
}

// ---------- Task blocks ----------

export function scheduleTask(task: Task, start_at: string, end_at: string): TaskBlock {
  // The server moves an Inbox task to Planned when it gets a time; mirror that locally.
  if (task.column_key === "inbox") {
    const planned = boardColumns(store.get().columns, task.project_id).find((c) => c.key === "planned");
    if (planned) {
      updateItem("tasks", task.id, (t) => ({ ...t, ...columnFields(planned.id) }));
      if (task.id < 0) touched.add(task.id);
    }
  }
  return create("taskBlocks", { task_id: task.id, start_at, end_at },
    async () => post<TaskBlock>("/api/task-blocks", { task_id: await realId(task.id), start_at, end_at }));
}

export function updateTaskBlock(id: number, start_at: string, end_at: string) {
  return mutate("taskBlocks", id, { start_at, end_at },
    (rid) => patch<TaskBlock>(`/api/task-blocks/${rid}`, { start_at, end_at })).catch(() => undefined);
}

export function deleteTaskBlock(block: TaskBlock, title: string) {
  deleteWithUndo(`Unscheduled “${title}”`, {
    key: `taskBlock:${block.id}`,
    remove: () => removeLocal("taskBlocks", (b) => b.id === block.id),
    commit: async () => del(`/api/task-blocks/${await realId(block.id)}`),
  });
}

// ---------- Events ----------

export type EventDraft = Omit<CalEvent, "id" | "location" | "notes"> & Partial<Pick<CalEvent, "location" | "notes">>;

export function createEvent(draft: EventDraft): CalEvent {
  const body = { location: "", notes: "", ...draft };
  return create("events", body, () => post<CalEvent>("/api/events", body));
}

export function updateEvent(id: number, change: Partial<EventDraft>) {
  const current = getItem("events", id);
  if (!current) return Promise.resolve();
  const body = { ...current, ...change };
  return mutate("events", id, change, (rid) => patch<CalEvent>(`/api/events/${rid}`, {
    title: body.title, start_at: body.start_at, end_at: body.end_at, color: body.color,
    location: body.location ?? "", notes: body.notes ?? "",
  })).catch(() => undefined);
}

export function deleteEvent(ev: CalEvent) {
  deleteWithUndo(`Deleted “${ev.title}”`, {
    key: `event:${ev.id}`,
    remove: () => removeLocal("events", (e) => e.id === ev.id),
    commit: async () => del(`/api/events/${await realId(ev.id)}`),
  });
}

// ---------- Time blocks (recurring) ----------

export type TimeBlockDraft = Omit<TimeBlock, "id">;

export function createTimeBlock(draft: TimeBlockDraft): TimeBlock {
  return create("timeBlocks", draft, () => post<TimeBlock>("/api/time-blocks", draft));
}

export function updateTimeBlock(id: number, change: Partial<TimeBlockDraft>) {
  const current = getItem("timeBlocks", id);
  if (!current) return Promise.resolve();
  const { id: _omit, ...body } = { ...current, ...change };
  void _omit;
  return mutate("timeBlocks", id, change, (rid) => patch<TimeBlock>(`/api/time-blocks/${rid}`, body))
    .catch(() => undefined);
}

export function deleteTimeBlock(tb: TimeBlock) {
  deleteWithUndo(`Deleted routine “${tb.title}”`, {
    key: `timeBlock:${tb.id}`,
    remove: () => removeLocal("timeBlocks", (b) => b.id === tb.id),
    commit: async () => del(`/api/time-blocks/${await realId(tb.id)}`),
  });
}

// ---------- Habits ----------

export function createHabit(title: string, target_count: number, target_period: "day" | "week") {
  return create("habits", { title, target_count, target_period, archived: false, done: 0 },
    () => post<Habit>("/api/habits", { title, target_count, target_period }));
}

export function updateHabit(id: number, change: Partial<Pick<Habit, "title" | "target_count" | "target_period">>) {
  return mutate("habits", id, change, (rid) => patch<Habit>(`/api/habits/${rid}`, change),
    { apply: (server) => ({ ...server }) }).catch(() => undefined);
}

export function archiveHabit(habit: Habit) {
  deleteWithUndo(`Archived “${habit.title}”`, {
    key: `habit:${habit.id}`,
    remove: () => removeLocal("habits", (h) => h.id === habit.id),
    commit: async () => {
      await patch(`/api/habits/${await realId(habit.id)}`, { archived: true });
    },
  });
}

export function logHabit(habitId: number, day: string, delta: 1 | -1) {
  const logs = store.get().habitLogs;
  const existing = logs.find((l) => l.habit_id === habitId && l.logged_on === day);
  const count = Math.max(0, (existing?.count ?? 0) + delta);
  if (!existing && delta < 0) return;
  const apply = (n: number) => store.set((s) => {
    const rest = s.habitLogs.filter((l) => !(l.habit_id === habitId && l.logged_on === day));
    return { ...s, habitLogs: n > 0 ? [...rest, { habit_id: habitId, logged_on: day, count: n }] : rest };
  });
  apply(count);
  (async () => {
    try {
      await tracked(post(`/api/habits/${await realId(habitId)}/log?start=${day}&end=${day}`, { logged_on: day, delta }));
    } catch (e) {
      const now = store.get().habitLogs.find((l) => l.habit_id === habitId && l.logged_on === day)?.count ?? 0;
      apply(Math.max(0, now - delta));
      toastError(e, "Could not log the habit");
    }
  })();
}

// ---------- Reminders ----------

export function reminderFor(reminders: Reminder[], kind: ReminderKind, id: number): number | null {
  return reminders.find((r) => r.kind === kind && r.target_id === id)?.minutes_before ?? null;
}

export async function setReminder(kind: ReminderKind, id: number, minutes: number | null) {
  const before = store.get().reminders;
  store.set((s) => {
    const rest = s.reminders.filter((r) => !(r.kind === kind && r.target_id === id));
    return { ...s, reminders: minutes === null ? rest : [...rest, { kind, target_id: id, minutes_before: minutes }] };
  });
  try {
    await tracked(put(`/api/reminders/${kind}/${await realId(id)}`, { minutes_before: minutes }));
  } catch (e) {
    store.set((s) => ({ ...s, reminders: before }));
    toastError(e, "Could not save the reminder");
  }
}
