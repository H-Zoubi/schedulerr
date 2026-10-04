import { CSSProperties, FormEvent, PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import { api, Column, del, patch, post, Project, Task } from "../api";
import { Modal } from "../components/Modal";
import { TaskEditor } from "../components/Editors";

// Boards list on the left (on phones, chips above the board). Each board has its own columns,
// which can be added, renamed, marked as done, and deleted from the column's "..." menu.
// Drag cards between columns or within one; drag a column by its grip to reorder it.
// Uses pointer events, so it works with mouse, pen and touch.

type Drag =
  | { kind: "card"; task: Task; label: string }
  | { kind: "column"; column: Column; label: string };

// Card drops: the destination column, the index among its other cards, and the y of the drop line.
// Column drops: the index among the other columns.
type Drop =
  | { kind: "card"; columnId: number; index: number; top: number | null }
  | { kind: "column"; index: number };

const DRAG_THRESHOLD = 6; // px a card must move before it counts as a drag, so a click still opens it
const GENERAL_COLOR = "#8a8ea3";

export function Kanban() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [boardId, setBoardId] = useState<number | null>(null); // null = general board
  const [columns, setColumns] = useState<Column[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [columnDrafts, setColumnDrafts] = useState<Record<number, string>>({});
  const [showNewBoard, setShowNewBoard] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [menuFor, setMenuFor] = useState<number | null>(null); // column whose "..." menu is open
  const [columnDialog, setColumnDialog] = useState<Column | "new" | null>(null);
  const [addingIn, setAddingIn] = useState<number | null>(null); // column showing the "Add a card" form
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  // Refs let the window listeners see the latest drop without re-attaching.
  const dropRef = useRef<Drop | null>(null);

  async function loadBoards() {
    try {
      setProjects(await api<Project[]>("/api/projects"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load boards");
    }
  }

  async function loadBoard() {
    try {
      const query = boardId === null ? "" : `?project_id=${boardId}`;
      const [cols, all] = await Promise.all([
        api<Column[]>(`/api/columns${query}`),
        api<Task[]>("/api/tasks"),
      ]);
      setColumns(cols);
      setTasks(all.filter((t) => t.project_id === boardId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the board");
    }
  }

  useEffect(() => {
    loadBoards();
  }, []);

  useEffect(() => {
    setMenuFor(null);
    loadBoard();
  }, [boardId]);

  const board = projects.find((p) => p.id === boardId) ?? null;
  const boardColor = board?.color ?? GENERAL_COLOR;
  const total = tasks.length;

  // Cards of one column in display order. Matches the server's (position, id) sort.
  function cardsIn(columnId: number): Task[] {
    return tasks
      .filter((t) => t.column_id === columnId)
      .sort((a, b) => a.position - b.position || a.id - b.id);
  }

  // ---------- Tasks ----------

  async function addTaskTo(col: Column) {
    const title = (columnDrafts[col.id] ?? "").trim();
    if (!title) return;
    await post("/api/tasks", { title, project_id: boardId, column_id: col.id });
    setColumnDrafts({ ...columnDrafts, [col.id]: "" });
    loadBoard();
  }

  async function removeTask(task: Task) {
    if (!confirm(`Delete "${task.title}"?`)) return;
    await del(`/api/tasks/${task.id}`);
    loadBoard();
  }

  // ---------- Drag and drop (pointer events) ----------

  // The card or column under the pointer, as a drop target.
  function findCardDrop(task: Task, x: number, y: number): Drop | null {
    const colEl = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-column-id]");
    if (!colEl) return null;
    const columnId = Number(colEl.dataset.columnId);
    const cards = [...colEl.querySelectorAll<HTMLElement>("[data-task-id]")]
      .filter((el) => Number(el.dataset.taskId) !== task.id);
    let index = cards.length;
    for (let i = 0; i < cards.length; i++) {
      const r = cards[i].getBoundingClientRect();
      if (y < r.top + r.height / 2) {
        index = i;
        break;
      }
    }
    // The line sits in the gap above the card it will land before, or below the last card.
    // Measured inside the scrolling card list, so it stays right when the list is scrolled.
    const list = colEl.querySelector<HTMLElement>("[data-card-list]");
    if (!list) return { kind: "card", columnId, index, top: null };
    const listTop = list.getBoundingClientRect().top;
    const toList = (y: number) => y - listTop + list.scrollTop;
    let top: number | null = null;
    if (cards[index]) top = toList(cards[index].getBoundingClientRect().top) - 7;
    else if (cards.length) top = toList(cards[cards.length - 1].getBoundingClientRect().bottom) + 5;
    return { kind: "card", columnId, index, top };
  }

  function findColumnDrop(col: Column, x: number): Drop | null {
    const others = [...document.querySelectorAll<HTMLElement>(".board > [data-column-id]")]
      .filter((el) => Number(el.dataset.columnId) !== col.id);
    let index = others.length;
    for (let i = 0; i < others.length; i++) {
      const r = others[i].getBoundingClientRect();
      if (x < r.left + r.width / 2) {
        index = i;
        break;
      }
    }
    return { kind: "column", index };
  }

  function startDrag(e: ReactPointerEvent, next: Drag, immediate = false) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault(); // no text selection while dragging
    const startX = e.clientX;
    const startY = e.clientY;
    let active = false;

    const begin = () => {
      active = true;
      setDrag(next);
      document.body.classList.add("is-dragging");
    };
    if (immediate) begin();

    const onMove = (ev: PointerEvent) => {
      if (!active) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return;
        begin();
      }
      setPointer({ x: ev.clientX, y: ev.clientY });
      const found = next.kind === "card"
        ? findCardDrop(next.task, ev.clientX, ev.clientY)
        : findColumnDrop(next.column, ev.clientX);
      dropRef.current = found;
      setDrop(found);
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      const target = dropRef.current;
      dropRef.current = null;
      setDrag(null);
      setDrop(null);
      setPointer(null);
      document.body.classList.remove("is-dragging");
      if (!active || !target) return;
      if (next.kind === "card" && target.kind === "card") commitCardDrop(next.task, target);
      if (next.kind === "column" && target.kind === "column") commitColumnDrop(next.column, target);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  // Put the card at its drop index and renumber the destination column. Only changed tasks are sent.
  async function commitCardDrop(task: Task, target: Extract<Drop, { kind: "card" }>) {
    const ordered = cardsIn(target.columnId).filter((t) => t.id !== task.id);
    ordered.splice(target.index, 0, task);
    const moves = ordered
      .map((t, position) => ({ ...t, column_id: target.columnId, position }))
      .filter((m) => {
        const old = tasks.find((t) => t.id === m.id)!;
        return old.column_id !== m.column_id || old.position !== m.position;
      });
    if (moves.length === 0) return;

    setTasks((prev) => prev.map((t) => moves.find((m) => m.id === t.id) ?? t));
    try {
      await Promise.all(moves.map((m) =>
        patch(`/api/tasks/${m.id}`, { column_id: m.column_id, position: m.position })));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not move the task");
    }
    loadBoard();
  }

  async function commitColumnDrop(col: Column, target: Extract<Drop, { kind: "column" }>) {
    const ordered = columns.filter((c) => c.id !== col.id);
    ordered.splice(target.index, 0, col);
    const renumbered = ordered.map((c, position) => ({ ...c, position }));
    const moves = renumbered.filter((c) => columns.find((o) => o.id === c.id)!.position !== c.position);
    if (moves.length === 0) return;

    setColumns(renumbered);
    try {
      await Promise.all(moves.map((c) => patch(`/api/columns/${c.id}`, { position: c.position })));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not move the column");
    }
    loadBoard();
  }

  // ---------- Columns ----------

  // The dialog creates a new column ("new") or renames an existing one.
  async function saveColumn(name: string) {
    if (columnDialog === "new") {
      await post("/api/columns", { name, project_id: boardId });
    } else if (columnDialog && name !== columnDialog.name) {
      await patch(`/api/columns/${columnDialog.id}`, { name });
    }
    setColumnDialog(null);
    loadBoard();
  }

  function renameColumn(col: Column) {
    setMenuFor(null);
    setColumnDialog(col);
  }

  async function toggleDone(col: Column) {
    setMenuFor(null);
    await patch(`/api/columns/${col.id}`, { is_done: !col.is_done });
    loadBoard();
  }

  async function removeColumn(col: Column) {
    setMenuFor(null);
    const count = tasks.filter((t) => t.column_id === col.id).length;
    const note = count ? ` Its ${count} task(s) will move to the first column.` : "";
    if (!confirm(`Delete the column "${col.name}"?${note}`)) return;
    try {
      await del(`/api/columns/${col.id}`);
      loadBoard();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete the column");
    }
  }

  // ---------- Boards ----------

  async function deleteBoard() {
    if (!board) return;
    if (!confirm(`Delete the board "${board.name}"? Its tasks move to the general board.`)) return;
    await del(`/api/projects/${board.id}`);
    setBoardId(null);
    loadBoards();
  }

  // Which column shows the drop marker: the one the dragged column would go before, or the last one.
  const draggedColumnId = drag?.kind === "column" ? drag.column.id : null;
  const otherColumns = columns.filter((c) => c.id !== draggedColumnId);
  function columnMarker(colId: number): string {
    if (drop?.kind !== "column") return "";
    if (otherColumns[drop.index]?.id === colId) return " drop-before";
    if (drop.index === otherColumns.length && otherColumns[otherColumns.length - 1]?.id === colId) return " drop-after";
    return "";
  }

  const boardItems: { id: number | null; name: string; color: string }[] = [
    { id: null, name: "General", color: GENERAL_COLOR },
    ...projects.map((p) => ({ id: p.id, name: p.name, color: p.color })),
  ];

  return (
    <section className={"kb" + (sidebarOpen ? "" : " kb-collapsed")}>
      <aside className="boards-panel" aria-label="Boards">
        <div className="boards-head">
          <span>Boards</span>
          <button className="icon" aria-label="New board" onClick={() => setShowNewBoard(!showNewBoard)}>+</button>
          <button className="icon" aria-label="Hide boards" onClick={() => setSidebarOpen(false)}>‹</button>
        </div>
        <nav className="boards-list">
          {boardItems.map((b) => (
            <button key={b.id ?? "general"}
              className={"board-item" + (boardId === b.id ? " active" : "")}
              onClick={() => setBoardId(b.id)}>
              <span className="board-icon" style={{ background: `color-mix(in srgb, ${b.color} 18%, transparent)` }}>
                <BulbIcon color={b.color} />
              </span>
              <span className="board-name">{b.name}</span>
            </button>
          ))}
        </nav>
      </aside>

      <div className="kb-main">
        <header className="kb-head">
          {!sidebarOpen && (
            <button className="icon" aria-label="Show boards" onClick={() => setSidebarOpen(true)}>›</button>
          )}
          <span className="board-icon big" style={{ background: `color-mix(in srgb, ${boardColor} 18%, transparent)` }}>
            <BulbIcon color={boardColor} />
          </span>
          <div className="titles">
            <h1>{board ? board.name : "General"}</h1>
            <div className="subtitle">
              {total} {total === 1 ? "task" : "tasks"}
              {board?.deadline && <> · due {board.deadline}</>}
            </div>
          </div>
          {board && <button className="ghost danger-ghost" onClick={deleteBoard}>Delete board</button>}
        </header>

        {/* Phones: boards as chips, since the side panel is hidden. */}
        <div className="board-tabs" role="tablist" aria-label="Boards">
          {boardItems.map((b) => (
            <button key={b.id ?? "general"} className={"chip" + (boardId === b.id ? " active" : "")}
              onClick={() => setBoardId(b.id)}>
              <span className="swatch" style={{ background: b.color }} /> {b.name}
            </button>
          ))}
          <button className="chip" onClick={() => setShowNewBoard(!showNewBoard)}>+ Board</button>
        </div>

        {showNewBoard && (
          <div className="board-new">
            <NewBoardForm onCreated={(id) => { setShowNewBoard(false); loadBoards(); setBoardId(id); }} />
          </div>
        )}

        {error && <div className="banner" role="alert">{error}</div>}

        {editingTask && (
          <Modal title="Edit task" onClose={() => setEditingTask(null)}>
            <TaskEditor task={editingTask} onDone={() => { setEditingTask(null); loadBoard(); }} />
          </Modal>
        )}

        {columnDialog && (
          <ColumnDialog column={columnDialog === "new" ? null : columnDialog}
            onSave={saveColumn} onClose={() => setColumnDialog(null)} />
        )}

        {/* One grid track per column, plus the "Add column" tile. */}
        <div className="board" style={{ ["--cols" as string]: columns.length + 1 } as CSSProperties}>
          {columns.map((col) => {
            const cards = cardsIn(col.id);
            const isDropTarget = drop?.kind === "card" && drop.columnId === col.id;
            return (
              <div key={col.id} data-column-id={col.id}
                className={"column" + (isDropTarget ? " drop-active" : "") + columnMarker(col.id)}>
                <div className="column-head">
                  <span className="grip" aria-label="Drag to reorder column" title="Drag to reorder"
                    onPointerDown={(e) => startDrag(e, { kind: "column", column: col, label: col.name }, true)}>⠿</span>
                  <h3>
                    {col.name}
                    <span className="count">{cards.length}</span>
                    {col.is_done && <span className="done-tag">Done</span>}
                  </h3>
                  <button className="icon" aria-label="Column menu" aria-haspopup="menu"
                    aria-expanded={menuFor === col.id}
                    onClick={() => setMenuFor(menuFor === col.id ? null : col.id)}>⋯</button>
                  {menuFor === col.id && (
                    <div className="col-menu" role="menu">
                      <button role="menuitem" onClick={() => renameColumn(col)}>Rename</button>
                      <button role="menuitem" onClick={() => toggleDone(col)}>
                        {col.is_done ? "Unmark as done" : "Mark as done column"}
                      </button>
                      <button role="menuitem" className="danger" onClick={() => removeColumn(col)}>Delete column</button>
                    </div>
                  )}
                </div>

                {/* Only the cards scroll; the header and footer stay put, as in Trello. */}
                <div className="column-cards" data-card-list>
                {cards.length === 0 && <div className="column-empty">Drop tasks here</div>}

                {cards.map((t) => (
                  <div key={t.id} data-task-id={t.id}
                    className={"task-card" + (drag?.kind === "card" && drag.task.id === t.id ? " dragging" : "")}
                    onPointerDown={(e) => startDrag(e, { kind: "card", task: t, label: t.title })}>
                    <button className="title-btn" onClick={() => setEditingTask(t)}>{t.title}</button>
                    <div className="meta">
                      {t.duration_minutes && <span>{t.duration_minutes}m</span>}
                      {t.deadline && <span>due {t.deadline}</span>}
                      <span className="move">
                        <button className="ghost danger-ghost" aria-label="Delete"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={() => removeTask(t)}>✕</button>
                      </span>
                    </div>
                  </div>
                ))}

                {drop?.kind === "card" && drop.columnId === col.id && drop.top !== null && (
                  <div className="drop-line" style={{ top: drop.top }} />
                )}
                </div>

                {addingIn === col.id ? (
                  <form className="column-add" onSubmit={(e) => { e.preventDefault(); addTaskTo(col); }}>
                    <input autoFocus placeholder="Enter a title for this card…" aria-label={`Add a card to ${col.name}`}
                      value={columnDrafts[col.id] ?? ""}
                      onChange={(e) => setColumnDrafts({ ...columnDrafts, [col.id]: e.target.value })}
                      onKeyDown={(e) => { if (e.key === "Escape") setAddingIn(null); }} />
                    <div className="row">
                      <button className="primary" disabled={!(columnDrafts[col.id] ?? "").trim()}>Add card</button>
                      <button type="button" className="ghost" aria-label="Cancel" onClick={() => setAddingIn(null)}>✕</button>
                    </div>
                  </form>
                ) : (
                  <button type="button" className="add-card" onClick={() => setAddingIn(col.id)}>+ Add a card</button>
                )}
              </div>
            );
          })}

          <button className="add-column" onClick={() => setColumnDialog("new")}>
            <span aria-hidden="true">+</span> Add column
          </button>
        </div>
      </div>

      {menuFor !== null && <div className="menu-scrim" onClick={() => setMenuFor(null)} />}

      {drag && pointer && (
        <div className="drag-ghost" style={{ left: pointer.x + 12, top: pointer.y + 12 }}>{drag.label}</div>
      )}
    </section>
  );
}

// Create or rename a column. `column` is null when creating.
function ColumnDialog({ column, onSave, onClose }: {
  column: Column | null;
  onSave: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(column?.name ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(trimmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the column");
      setSaving(false);
    }
  }

  return (
    <Modal title={column ? "Rename column" : "New column"} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <label>Column name
          <input placeholder="e.g. In review" value={name} maxLength={60} autoFocus
            onChange={(e) => setName(e.target.value)} />
        </label>
        {error && <p className="error small">{error}</p>}
        <div className="row modal-actions">
          <button type="button" className="ghost" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!name.trim() || saving}>
            {saving ? "Saving…" : column ? "Save" : "Create column"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function BulbIcon({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke={color} strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z" />
    </svg>
  );
}

function NewBoardForm({ onCreated }: { onCreated: (id: number) => void }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState("#4f46e5");
  const [deadline, setDeadline] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const created = await post<Project>("/api/projects", { name, color, deadline: deadline || null });
      onCreated(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the board");
      setSaving(false);
    }
  }

  return (
    <form className="card form" onSubmit={submit}>
      <label>Board name
        <input placeholder="Thesis, Hula SDK…" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
      </label>
      <div className="row">
        <label>Colour<input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></label>
        <label className="grow">Deadline (optional)<input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} /></label>
      </div>
      {error && <p className="error small">{error}</p>}
      <button className="primary" disabled={saving}>{saving ? "Creating…" : "Create board"}</button>
    </form>
  );
}
