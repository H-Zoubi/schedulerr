import {
  FormEvent, Fragment, memo, PointerEvent as RPointerEvent, useCallback, useEffect, useMemo, useRef, useState,
} from "react";
import { Column, Project, Task, TaskBlock } from "../api";
import { anchorOf, Anchor, IconButton, Menu, TaskCheck } from "../components/primitives";
import { Icon } from "../components/Icon";
import { BoardDialog } from "../components/BoardDialog";
import {
  boardColumns, createColumn, createTask, deleteColumn, deleteTask, moveTasks, reorderColumns, toggleTaskDone,
  updateColumn, useData,
} from "../store";
import { openTask } from "../lib/ui";
import { navigate } from "../lib/router";
import { blocksByTask, nextBlock } from "../lib/derive";
import { parseQuickAdd } from "../lib/nlp";
import { fmtDuration, fmtTime, minutesOfIso, relDay, todayIso } from "../dates";

type CardDrag = { kind: "card"; task: Task; height: number; width: number };
type ColDrag = { kind: "column"; column: Column; width: number };
type Drop = { columnId: number; index: number } | { colIndex: number };

// A drop ends with a click on whatever is under the pointer; ignore that click.
let lastDragEnd = 0;

const GENERAL: Pick<Project, "name" | "color"> = { name: "General", color: "#7c8597" };

export function Board({ id }: { id: number | null }) {
  const data = useData();
  const project = id === null ? null : data.projects.find((p) => p.id === id) ?? null;
  const columns = useMemo(() => boardColumns(data.columns, id), [data.columns, id]);
  const tasks = useMemo(() => data.tasks.filter((t) => t.project_id === id), [data.tasks, id]);
  const blocks = useMemo(() => blocksByTask(data.taskBlocks), [data.taskBlocks]);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(false);
  const [drag, setDrag] = useState<CardDrag | ColDrag | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number; dx: number; dy: number } | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const dropRef = useRef<Drop | null>(null);

  // Unknown board id (deleted elsewhere): fall back to General.
  useEffect(() => {
    if (id !== null && data.ready && !project) navigate({ name: "board", id: null }, { replace: true });
  }, [id, project, data.ready]);

  const q = query.trim().toLowerCase();
  const cardsIn = useCallback((colId: number) => tasks
    .filter((t) => t.column_id === colId && (!q || t.title.toLowerCase().includes(q)))
    .sort((a, b) => a.position - b.position || a.id - b.id), [tasks, q]);

  // ---------- Drag and drop ----------

  const findDrop = useCallback((d: CardDrag | ColDrag, x: number, y: number): Drop | null => {
    const cols = [...(boardRef.current?.querySelectorAll<HTMLElement>("[data-col]") ?? [])];
    if (d.kind === "column") {
      const others = cols.filter((el) => Number(el.dataset.col) !== d.column.id);
      let colIndex = others.length;
      for (let i = 0; i < others.length; i++) {
        const r = others[i].getBoundingClientRect();
        if (x < r.left + r.width / 2) { colIndex = i; break; }
      }
      return { colIndex };
    }
    let target: HTMLElement | null = null;
    let best = Infinity;
    for (const el of cols) {
      const r = el.getBoundingClientRect();
      const dist = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
      if (dist < best) { best = dist; target = el; }
    }
    if (!target || best > 80) return null;
    const cards = [...target.querySelectorAll<HTMLElement>("[data-card]")].filter((el) => Number(el.dataset.card) !== d.task.id);
    let index = cards.length;
    for (let i = 0; i < cards.length; i++) {
      const r = cards[i].getBoundingClientRect();
      if (y < r.top + r.height / 2) { index = i; break; }
    }
    return { columnId: Number(target.dataset.col), index };
  }, []);

  const startDrag = useCallback((e: RPointerEvent<HTMLElement>, make: () => CardDrag | ColDrag, immediate = false) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button, input, textarea, select, .task-check")) return;
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    const sx = e.clientX;
    const sy = e.clientY;
    const touch = e.pointerType === "touch";
    if (!touch) e.preventDefault();
    let active = false;
    let current: CardDrag | ColDrag | null = null;
    let lastX = sx;
    let lastY = sy;
    let timer = 0;
    let scrollRaf = 0;

    const activate = () => {
      active = true;
      current = make();
      setDrag(current);
      document.body.classList.add("is-dragging");
      if (touch) navigator.vibrate?.(8);
      update(lastX, lastY);
    };
    const update = (x: number, y: number) => {
      if (!current) return;
      setGhost({ x, y, dx: sx - rect.left, dy: sy - rect.top });
      const found = findDrop(current, x, y);
      dropRef.current = found;
      setDrop(found);
    };
    const edgeScroll = () => {
      const board = boardRef.current;
      if (!board || !active) return;
      const r = board.getBoundingClientRect();
      const edge = 60;
      const vx = lastX < r.left + edge ? -12 : lastX > r.right - edge ? 12 : 0;
      if (vx) { board.scrollLeft += vx; update(lastX, lastY); }
      // Scroll the column list under the pointer vertically.
      const list = document.elementFromPoint(lastX, lastY)?.closest<HTMLElement>(".col-cards");
      if (list) {
        const lr = list.getBoundingClientRect();
        const vy = lastY < lr.top + 40 ? -10 : lastY > lr.bottom - 40 ? 10 : 0;
        if (vy) { list.scrollTop += vy; update(lastX, lastY); }
      }
      scrollRaf = requestAnimationFrame(edgeScroll);
    };
    const preventScroll = (ev: TouchEvent) => { if (active) ev.preventDefault(); };

    const onMove = (ev: PointerEvent) => {
      lastX = ev.clientX;
      lastY = ev.clientY;
      if (!active) {
        const dist = Math.hypot(ev.clientX - sx, ev.clientY - sy);
        if (touch) { if (dist > 8) cleanup(); return; }
        if (dist < 5) return;
        activate();
        scrollRaf = requestAnimationFrame(edgeScroll);
        return;
      }
      update(ev.clientX, ev.clientY);
    };
    const cleanup = (commit = false) => {
      window.clearTimeout(timer);
      cancelAnimationFrame(scrollRaf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("touchmove", preventScroll);
      document.body.classList.remove("is-dragging");
      if (active) lastDragEnd = Date.now();
      const target = dropRef.current;
      dropRef.current = null;
      setDrag(null);
      setDrop(null);
      setGhost(null);
      if (commit && active && current && target) commitDrop(current, target);
    };
    const onUp = () => cleanup(true);
    const onCancel = () => cleanup(false);
    const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape") cleanup(false); };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey, true);
    if (touch) {
      window.addEventListener("touchmove", preventScroll, { passive: false });
      timer = window.setTimeout(() => { activate(); scrollRaf = requestAnimationFrame(edgeScroll); }, 260);
    } else if (immediate) {
      activate();
      scrollRaf = requestAnimationFrame(edgeScroll);
    }

    function commitDrop(d: CardDrag | ColDrag, t: Drop) {
      if (d.kind === "column" && "colIndex" in t) {
        const order = columns.filter((c) => c.id !== d.column.id).map((c) => c.id);
        order.splice(t.colIndex, 0, d.column.id);
        reorderColumns(id, order);
      } else if (d.kind === "card" && "columnId" in t) {
        // Renumber using all cards in the column (not just the filtered ones).
        const ordered = tasks.filter((x) => x.column_id === t.columnId && x.id !== d.task.id)
          .sort((a, b) => a.position - b.position || a.id - b.id);
        const visible = q ? ordered.filter((x) => x.title.toLowerCase().includes(q)) : ordered;
        const before = visible[t.index];
        const at = before ? ordered.indexOf(before) : ordered.length;
        ordered.splice(at, 0, d.task);
        moveTasks(ordered.map((x, position) => ({ id: x.id, column_id: t.columnId, position })));
      }
    }
  }, [columns, findDrop, id, q, tasks]);

  const onCardDown = useCallback((e: RPointerEvent<HTMLElement>, task: Task) => {
    const r = e.currentTarget.getBoundingClientRect();
    startDrag(e, () => ({ kind: "card", task, height: r.height, width: r.width }));
  }, [startDrag]);

  const onColDown = useCallback((e: RPointerEvent<HTMLElement>, column: Column) => {
    const colEl = e.currentTarget.closest<HTMLElement>("[data-col]");
    const width = colEl?.getBoundingClientRect().width ?? 280;
    startDrag(e, () => ({ kind: "column", column, width }), true);
  }, [startDrag]);

  const meta = project ?? GENERAL;
  const openTotal = tasks.filter((t) => !t.done).length;
  const draggedCol = drag?.kind === "column" ? drag.column.id : null;
  const draggedCard = drag?.kind === "card" ? drag.task.id : null;
  const visibleCols = columns.filter((c) => c.id !== draggedCol);

  return (
    <div className="page board-page">
      <header className="page-head board-head">
        <div className="board-title">
          <span className="board-dot lg" style={{ background: meta.color }} />
          <div>
            <h1>{meta.name}</h1>
            <p className="page-sub">
              {openTotal} open {openTotal === 1 ? "task" : "tasks"}
              {project?.deadline && <> · due {relDay(project.deadline)}</>}
            </p>
          </div>
          {project && <IconButton icon="settings" label="Board settings" onClick={() => setEditing(true)} />}
        </div>
        <div className="row-gap">
          <label className="search-field">
            <Icon name="search" size={15} />
            <input type="search" placeholder="Filter cards" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Filter cards" />
          </label>
          <button className="btn sm" onClick={() => createColumn(id, "New column")}><Icon name="plus" size={15} /> Column</button>
        </div>
      </header>

      <BoardSwitcher current={id} />

      <div className="board" ref={boardRef}>
        {visibleCols.map((col, i) => (
          <Fragment key={col.id}>
            {drop && "colIndex" in drop && drop.colIndex === i && drag?.kind === "column" && (
              <div className="col-placeholder" style={{ width: drag.width }} />
            )}
            <BoardColumn column={col} cards={cardsIn(col.id)} projectId={id} blocks={blocks}
              dropIndex={drop && "columnId" in drop && drop.columnId === col.id ? drop.index : null}
              placeholderHeight={drag?.kind === "card" ? drag.height : 0}
              draggedCard={draggedCard}
              onCardDown={onCardDown} onColDown={onColDown} />
          </Fragment>
        ))}
        {drop && "colIndex" in drop && drop.colIndex === visibleCols.length && drag?.kind === "column" && (
          <div className="col-placeholder" style={{ width: drag.width }} />
        )}
        <button className="add-col" onClick={() => createColumn(id, "New column")}>
          <Icon name="plus" size={16} /> Add column
        </button>
      </div>

      {drag && ghost && (
        <div className={"drag-ghost " + drag.kind} style={{
          left: ghost.x - ghost.dx, top: ghost.y - ghost.dy, width: drag.kind === "card" ? drag.width : drag.width,
        }}>
          {drag.kind === "card"
            ? <CardBody task={drag.task} block={nextBlock(blocks.get(drag.task.id))} />
            : <div className="col-ghost"><strong>{drag.column.name}</strong></div>}
        </div>
      )}
      {editing && project && <BoardDialog project={project} onClose={() => setEditing(false)} />}
    </div>
  );
}

function BoardSwitcher({ current }: { current: number | null }) {
  const projects = useData((s) => s.projects);
  const [creating, setCreating] = useState(false);
  return (
    <nav className="board-switch" aria-label="Boards">
      {[{ id: null as number | null, name: "General", color: GENERAL.color }, ...projects].map((p) => (
        <button key={p.id ?? "g"} className={"list-tab" + (current === p.id ? " on" : "")} onClick={() => navigate({ name: "board", id: p.id })}>
          <span className="board-dot" style={{ background: p.color }} /> {p.name}
        </button>
      ))}
      <button className="list-tab ghost" onClick={() => setCreating(true)}><Icon name="plus" size={14} /> Board</button>
      {creating && <BoardDialog onClose={() => setCreating(false)} />}
    </nav>
  );
}

const BoardColumn = memo(function BoardColumn({
  column, cards, projectId, blocks, dropIndex, placeholderHeight, draggedCard, onCardDown, onColDown,
}: {
  column: Column; cards: Task[]; projectId: number | null; blocks: Map<number, TaskBlock[]>;
  dropIndex: number | null; placeholderHeight: number; draggedCard: number | null;
  onCardDown: (e: RPointerEvent<HTMLElement>, t: Task) => void;
  onColDown: (e: RPointerEvent<HTMLElement>, c: Column) => void;
}) {
  const [menu, setMenu] = useState<Anchor | null>(null);
  const [renaming, setRenaming] = useState(column.name === "New column" && column.id < 0);
  const [name, setName] = useState(column.name);
  const [adding, setAdding] = useState<"top" | "bottom" | null>(null);
  const visible = cards.filter((c) => c.id !== draggedCard);

  useEffect(() => setName(column.name), [column.name]);

  function rename() {
    setRenaming(false);
    const n = name.trim();
    if (n && n !== column.name) updateColumn(column.id, { name: n }).catch(() => undefined);
    else setName(column.name);
  }

  const placeholder = <div className="card-placeholder" style={{ height: placeholderHeight }} />;

  return (
    <section className={"col" + (column.is_done ? " is-done" : "") + (dropIndex !== null ? " drop-on" : "")} data-col={column.id}
      aria-label={column.name}>
      <header className="col-head" onPointerDown={(e) => { if (!renaming) onColDown(e, column); }}>
        {renaming ? (
          <input className="col-rename" autoFocus value={name} onChange={(e) => setName(e.target.value)}
            onFocus={(e) => e.target.select()} onBlur={rename} aria-label="Column name"
            onKeyDown={(e) => { if (e.key === "Enter") rename(); if (e.key === "Escape") { setName(column.name); setRenaming(false); } }} />
        ) : (
          <h2 onDoubleClick={() => setRenaming(true)} title="Double-click to rename · drag to reorder">
            {column.is_done && <Icon name="done" size={15} />}
            {column.name}
            <span className="count">{cards.length}</span>
          </h2>
        )}
        <IconButton icon="plus" size={16} label={`Add card to ${column.name}`} onClick={() => setAdding("top")} />
        <IconButton icon="more" size={16} label="Column menu" onClick={(e) => setMenu(anchorOf(e.currentTarget))} />
      </header>

      <div className="col-cards">
        {adding === "top" && <AddCard column={column} projectId={projectId} where="top" cards={cards} onClose={() => setAdding(null)} />}
        {visible.map((t, i) => (
          <Fragment key={t.id}>
            {dropIndex === i && placeholder}
            <Card task={t} block={nextBlock(blocks.get(t.id))} onDown={onCardDown} />
          </Fragment>
        ))}
        {dropIndex !== null && dropIndex >= visible.length && placeholder}
        {visible.length === 0 && dropIndex === null && adding === null && <div className="col-empty">No cards</div>}
        {adding === "bottom" && <AddCard column={column} projectId={projectId} where="bottom" cards={cards} onClose={() => setAdding(null)} />}
      </div>

      {adding !== "bottom" && (
        <button className="add-card" onClick={() => setAdding("bottom")}><Icon name="plus" size={15} /> Add card</button>
      )}

      {menu && (
        <Menu anchor={menu} onClose={() => setMenu(null)} items={[
          { label: "Rename", icon: "edit", onSelect: () => setRenaming(true) },
          { label: "Add card", icon: "plus", onSelect: () => setAdding("top") },
          { label: column.is_done ? "Unmark as Done column" : "Mark as Done column", icon: "done", checked: column.is_done,
            onSelect: () => updateColumn(column.id, { is_done: !column.is_done }).catch(() => undefined) },
          "divider",
          { label: "Delete column", icon: "trash", danger: true, onSelect: () => deleteColumn(column) },
        ]} />
      )}
    </section>
  );
});

const Card = memo(function Card({ task, block, onDown }: {
  task: Task; block?: TaskBlock; onDown: (e: RPointerEvent<HTMLElement>, t: Task) => void;
}) {
  return (
    <article className={"card-item" + (task.done ? " is-done" : "") + (task.id < 0 ? " saving" : "")} data-card={task.id}
      tabIndex={0} onPointerDown={(e) => onDown(e, task)}
      onClick={() => { if (Date.now() - lastDragEnd > 250) openTask(task.id); }}
      onKeyDown={(e) => {
        if (e.key === "Enter") openTask(task.id);
        if (e.key === "x") toggleTaskDone(task);
        if (e.key === "Backspace" || e.key === "Delete") deleteTask(task);
      }}>
      <CardBody task={task} block={block} />
    </article>
  );
});

function CardBody({ task, block }: { task: Task; block?: TaskBlock }) {
  const today = todayIso();
  const overdue = task.deadline && task.deadline < today && !task.done;
  const hasMeta = task.deadline || task.duration_minutes || block || task.notes || task.priority;
  return (
    <>
      <div className="card-top">
        <TaskCheck done={task.done} priority={task.priority} onToggle={() => toggleTaskDone(task)} label={`Complete ${task.title}`} />
        <span className="card-title">{task.title}</span>
      </div>
      {hasMeta ? (
        <div className="card-meta">
          {task.priority > 0 && <span className={`prio p${task.priority}`}>{["", "Low", "Med", "High"][task.priority]}</span>}
          {task.deadline && (
            <span className={"meta" + (overdue ? " danger" : task.deadline === today ? " warn" : "")}>
              <Icon name="flag" size={12} />{relDay(task.deadline)}
            </span>
          )}
          {block && (
            <span className="meta scheduled"><Icon name="calendar" size={12} />{relDay(block.start_at.slice(0, 10))} {fmtTime(minutesOfIso(block.start_at), true)}</span>
          )}
          {task.duration_minutes && <span className="meta"><Icon name="clock" size={12} />{fmtDuration(task.duration_minutes)}</span>}
          {task.notes && <span className="meta"><Icon name="list" size={12} /></span>}
        </div>
      ) : null}
    </>
  );
}

function AddCard({ column, projectId, where, cards, onClose }: {
  column: Column; projectId: number | null; where: "top" | "bottom"; cards: Task[]; onClose: () => void;
}) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  function submit(e?: FormEvent) {
    e?.preventDefault();
    const p = parseQuickAdd(text);
    const title = p.title.trim();
    if (!title) return;
    const positions = cards.map((c) => c.position);
    const position = where === "top" ? Math.min(0, ...positions) - 1 : Math.max(0, ...positions) + 1;
    createTask({
      title, project_id: projectId, column_id: column.id, position,
      deadline: p.deadline ?? p.date ?? null, priority: p.priority ?? 0, duration_minutes: p.duration ?? null,
    });
    setText("");
    ref.current?.focus();
  }

  return (
    <form className="add-card-form" onSubmit={submit}>
      <textarea ref={ref} autoFocus rows={2} value={text} placeholder="Card title… (!1 for priority, “fri” for a deadline)"
        aria-label={`New card in ${column.name}`} onChange={(e) => setText(e.target.value)}
        onBlur={() => { if (!text.trim()) onClose(); }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
          if (e.key === "Escape") onClose();
        }} />
      <div className="row-gap">
        <button className="btn primary sm" disabled={!text.trim()} onMouseDown={(e) => e.preventDefault()}>Add</button>
        <button type="button" className="btn ghost sm" onClick={onClose}>Done</button>
      </div>
    </form>
  );
}

