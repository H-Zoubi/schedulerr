import { useMemo, useState } from "react";
import { Dialog, Kbd, Segmented } from "./primitives";
import { Icon } from "./Icon";
import { closeQuickAdd, openTask, QuickAddMode, QuickAddPrefill } from "../lib/ui";
import { matchProject, parseQuickAdd, parseSpending } from "../lib/nlp";
import { repeatLabel } from "../lib/derive";
import { createEvent, createSpending, createTask, createTimeBlock, currentId, money, scheduleTask, useData } from "../store";
import { atMinutes, backendWeekday, fmtDuration, fmtRange, parseDate, relDay, todayIso, timeString } from "../dates";
import { navigate } from "../lib/router";
import { toast } from "../lib/toast";

const MODES: { value: QuickAddMode; label: string }[] = [
  { value: "task", label: "Task" },
  { value: "event", label: "Event" },
  { value: "routine", label: "Routine" },
  { value: "spend", label: "Spend" },
];

const WEEKDAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const PRIORITY_NAMES = ["", "Low", "Medium", "High"];

function nextHour(): number {
  const d = new Date();
  return Math.min(23 * 60, (d.getHours() + 1) * 60);
}

export function QuickAdd({ prefill }: { prefill: QuickAddPrefill }) {
  const projects = useData((s) => s.projects);
  const [text, setText] = useState(prefill.text ?? "");
  const [mode, setMode] = useState<QuickAddMode>(prefill.mode ?? "task");
  const [manualMode, setManualMode] = useState(Boolean(prefill.mode));
  const [projectId, setProjectId] = useState<number | null | undefined>(prefill.projectId);
  const [added, setAdded] = useState(0);

  const parsed = useMemo(() => parseQuickAdd(text), [text]);
  const effectiveMode: QuickAddMode = !manualMode && parsed.weekdays ? "routine" : mode;
  const spend = useMemo(() => effectiveMode === "spend" ? parseSpending(text) : null, [text, effectiveMode]);
  const matched = matchProject(parsed.project, projects);
  const project = matched ?? projects.find((p) => p.id === projectId) ?? null;
  const projectMissing = parsed.project && !matched;

  // What will be created, with sensible defaults filled in.
  const date = parsed.date ?? prefill.date ?? todayIso();
  const start = parsed.start ?? prefill.start;
  const duration = parsed.duration ?? (prefill.start !== undefined && prefill.end !== undefined ? prefill.end - prefill.start : undefined);
  const evStart = start ?? nextHour();
  const evEnd = parsed.end ?? (duration ? evStart + duration : (prefill.end ?? evStart + 60));
  const weekdays = parsed.weekdays ?? [backendWeekday(parseDate(date))];
  const title = parsed.title.trim();
  // A routine can repeat every N weeks; a task can repeat on any interval.
  const intervalWeeks = parsed.repeat?.unit === "week" ? parsed.repeat.every : 1;
  const taskDeadline = parsed.deadline ?? (start === undefined && parsed.date ? parsed.date : null)
    ?? (parsed.repeat ? todayIso() : null);

  function submit(keepOpen: boolean) {
    if (effectiveMode === "spend") {
      if (!spend?.amount_cents) return;
      const sday = spend.date ?? prefill.date ?? todayIso();
      createSpending({ amount_cents: spend.amount_cents, note: spend.note, tag: spend.tag, spent_on: sday });
      if (!keepOpen) toast(`Logged ${money(spend.amount_cents)}${spend.note ? ` — ${spend.note}` : ""}`, {
        action: { label: "View", run: () => navigate({ name: "money" }) },
      });
      if (keepOpen) {
        setText("");
        setAdded((n) => n + 1);
      } else {
        closeQuickAdd();
      }
      return;
    }
    if (!title) return;
    if (effectiveMode === "task") {
      const sameBoardColumn = prefill.columnId && (project?.id ?? null) === (prefill.projectId ?? null) ? prefill.columnId : null;
      const task = createTask({
        title,
        project_id: project?.id ?? null,
        column_id: sameBoardColumn ?? null,
        deadline: taskDeadline,
        duration_minutes: duration ?? null,
        priority: parsed.priority ?? 0,
        repeat_every: parsed.repeat?.every ?? null,
        repeat_unit: parsed.repeat?.unit ?? null,
        position: sameBoardColumn ? 10_000 + Date.now() % 10_000 : 0,
      });
      if (start !== undefined) {
        const end = start + (duration ?? 60);
        scheduleTask(task, atMinutes(date, start), atMinutes(date, Math.min(end, 24 * 60 - 1)));
      }
      if (!keepOpen) toast(`Added “${title}”`, { action: { label: "Open", run: () => openTask(currentId(task.id)) } });
    } else if (effectiveMode === "event") {
      createEvent({ title, start_at: atMinutes(date, evStart), end_at: atMinutes(date, Math.min(evEnd, 24 * 60 - 1)), color: project?.color ?? "#2f7ff0" });
      if (!keepOpen) toast(`Added “${title}” on ${relDay(date)}`, { action: { label: "View", run: () => navigate({ name: "calendar", date }) } });
    } else {
      const s = start ?? 9 * 60;
      const e = parsed.end ?? s + (duration ?? 60);
      for (const wd of weekdays) {
        createTimeBlock({
          title, weekday: wd, start_time: timeString(s) + ":00", end_time: timeString(Math.min(e, 24 * 60 - 1)) + ":00",
          start_date: date, until_date: null, color: project?.color ?? "#8e4ec6", interval_weeks: intervalWeeks,
        });
      }
      if (!keepOpen) toast(`Added routine “${title}”`);
    }
    if (keepOpen) {
      setText("");
      setAdded((n) => n + 1);
    } else {
      closeQuickAdd();
    }
  }

  const chips: { icon: Parameters<typeof Icon>[0]["name"]; label: string; tone?: string }[] = [];
  if (effectiveMode === "spend") {
    if (spend?.amount_cents) chips.push({ icon: "wallet", label: money(spend.amount_cents) });
    else chips.push({ icon: "wallet", label: "Add an amount like 4.5", tone: "warn" });
    if (spend?.tag) chips.push({ icon: "hash", label: spend.tag });
    if (spend?.date) chips.push({ icon: "calendar", label: relDay(spend.date) });
  } else if (effectiveMode === "task") {
    if (project) chips.push({ icon: "hash", label: project.name });
    if (start !== undefined) chips.push({ icon: "calendar", label: `${relDay(date)} · ${fmtRange(start, start + (duration ?? 60))}` });
    const deadline = taskDeadline;
    if (parsed.repeat) chips.push({ icon: "repeat", label: repeatLabel(parsed.repeat.every, parsed.repeat.unit) });
    if (deadline) chips.push({ icon: "flag", label: `Due ${relDay(deadline)}`, tone: deadline < todayIso() ? "danger" : undefined });
    if (duration && start === undefined) chips.push({ icon: "clock", label: fmtDuration(duration) });
    if (parsed.priority) chips.push({ icon: "flag", label: `${PRIORITY_NAMES[parsed.priority]} priority`, tone: `p${parsed.priority}` });
  } else if (effectiveMode === "event") {
    chips.push({ icon: "calendar", label: relDay(date) });
    chips.push({ icon: "clock", label: `${fmtRange(evStart, evEnd)} · ${fmtDuration(evEnd - evStart)}` });
  } else {
    const every = intervalWeeks > 1 ? `Every ${intervalWeeks} weeks on` : "Every";
    chips.push({ icon: "repeat", label: weekdays.length === 7 && intervalWeeks === 1 ? "Every day" : `${every} ${weekdays.map((w) => WEEKDAY_NAMES[w]).join(", ")}` });
    const s = start ?? 9 * 60;
    chips.push({ icon: "clock", label: fmtRange(s, parsed.end ?? s + (duration ?? 60)) });
  }

  const placeholder = effectiveMode === "task"
    ? "Write report #thesis !1 due fri"
    : effectiveMode === "event" ? "Dentist tomorrow 3pm for 45m"
    : effectiveMode === "spend" ? "Coffee 4.5 #cafe" : "Gym every mon, wed 7-8am";

  return (
    <Dialog onClose={closeQuickAdd} label="Quick add" className="quick-add">
      <form onSubmit={(e) => { e.preventDefault(); submit(false); }}>
        <div className="qa-top">
          <Segmented label="Type" value={effectiveMode} options={MODES} size="sm"
            onChange={(m) => { setMode(m); setManualMode(true); }} />
          {added > 0 && <span className="qa-added">{added} added</span>}
        </div>
        <input className="qa-input" autoFocus value={text} placeholder={placeholder} aria-label="What do you want to add?"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.shiftKey || e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(true); }
          }} />
        <div className="qa-preview" aria-live="polite">
          {chips.map((c, i) => (
            <span key={i} className={"chip-static" + (c.tone ? " " + c.tone : "")}>
              <Icon name={c.icon} size={13} /> {c.label}
            </span>
          ))}
          {projectMissing && <span className="chip-static warn">No board named “{parsed.project}”</span>}
        </div>
        <div className="qa-foot">
          {effectiveMode !== "routine" && effectiveMode !== "spend" && (
            <label className="qa-board">
              <Icon name="board" size={14} />
              <select value={project?.id ?? ""} disabled={Boolean(matched)}
                onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : null)} aria-label="Board">
                <option value="">General</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
          )}
          <span className="qa-hint muted">
            <Kbd>↵</Kbd> add · <Kbd>⇧↵</Kbd> add another
          </span>
          <button className="btn primary" disabled={effectiveMode === "spend" ? !spend?.amount_cents : !title}>Add {effectiveMode}</button>
        </div>
      </form>
    </Dialog>
  );
}
