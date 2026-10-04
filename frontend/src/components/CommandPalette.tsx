import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, Kbd } from "./primitives";
import { Icon, IconName } from "./Icon";
import { openQuickAdd, openTask, setPalette, setShortcuts } from "../lib/ui";
import { navigate } from "../lib/router";
import { setPref } from "../lib/prefs";
import { useData } from "../store";
import { fmtRange, minutesOfIso, relDay } from "../dates";

type Cmd = {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: IconName;
  color?: string;
  keywords?: string;
  run: () => void;
};

// Simple fuzzy score: contiguous match beats word-start beats scattered letters.
function score(text: string, q: string): number {
  const t = text.toLowerCase();
  if (!q) return 1;
  const i = t.indexOf(q);
  if (i === 0) return 100;
  if (i > 0) return (/\s|[-_/#]/.test(t[i - 1]) ? 80 : 60) - Math.min(i, 30) / 10;
  let ti = 0;
  for (const ch of q) {
    ti = t.indexOf(ch, ti);
    if (ti === -1) return 0;
    ti++;
  }
  return 20;
}

export function CommandPalette() {
  const data = useData();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const close = () => setPalette(false);

  const commands = useMemo<Cmd[]>(() => {
    const go: Cmd[] = [
      { id: "go-today", group: "Go to", label: "Today", icon: "today", hint: "G T", run: () => navigate({ name: "today" }) },
      { id: "go-cal", group: "Go to", label: "Calendar", icon: "calendar", hint: "G C", run: () => navigate({ name: "calendar" }) },
      { id: "go-inbox", group: "Go to", label: "Inbox", icon: "inbox", hint: "G I", run: () => navigate({ name: "tasks", list: "inbox" }) },
      { id: "go-upcoming", group: "Go to", label: "Upcoming tasks", icon: "upcoming", hint: "G U", run: () => navigate({ name: "tasks", list: "upcoming" }) },
      { id: "go-board", group: "Go to", label: "Board", icon: "board", hint: "G B", run: () => navigate({ name: "board", id: null }) },
      { id: "go-habits", group: "Go to", label: "Habits", icon: "habits", hint: "G H", run: () => navigate({ name: "habits" }) },
      { id: "go-settings", group: "Go to", label: "Settings", icon: "settings", hint: "G S", run: () => navigate({ name: "settings" }) },
    ];
    const create: Cmd[] = [
      { id: "new-task", group: "Create", label: "New task", icon: "plus", hint: "C", run: () => openQuickAdd({ mode: "task" }) },
      { id: "new-event", group: "Create", label: "New event", icon: "calendar", hint: "E", run: () => openQuickAdd({ mode: "event" }) },
      { id: "new-routine", group: "Create", label: "New routine", icon: "repeat", run: () => openQuickAdd({ mode: "routine" }) },
    ];
    const prefsCmds: Cmd[] = [
      { id: "theme-light", group: "Preferences", label: "Theme: Light", icon: "sun", keywords: "appearance", run: () => setPref("theme", "light") },
      { id: "theme-dark", group: "Preferences", label: "Theme: Dark", icon: "moon", keywords: "appearance", run: () => setPref("theme", "dark") },
      { id: "theme-auto", group: "Preferences", label: "Theme: Match system", icon: "settings", keywords: "appearance auto", run: () => setPref("theme", "system") },
      { id: "view-day", group: "Preferences", label: "Calendar: Day view", icon: "calendar", run: () => { setPref("calView", "day"); navigate({ name: "calendar" }); } },
      { id: "view-week", group: "Preferences", label: "Calendar: Week view", icon: "calendar", run: () => { setPref("calView", "week"); navigate({ name: "calendar" }); } },
      { id: "view-month", group: "Preferences", label: "Calendar: Month view", icon: "calendar", run: () => { setPref("calView", "month"); navigate({ name: "calendar" }); } },
      { id: "shortcuts", group: "Preferences", label: "Keyboard shortcuts", icon: "keyboard", hint: "?", run: () => setShortcuts(true) },
    ];
    const boards: Cmd[] = [
      { id: "board-general", group: "Boards", label: "General", icon: "board", run: () => navigate({ name: "board", id: null }) },
      ...data.projects.map((p) => ({
        id: `board-${p.id}`, group: "Boards", label: p.name, icon: "board" as IconName, color: p.color,
        run: () => navigate({ name: "board", id: p.id }),
      })),
    ];
    const projects = new Map(data.projects.map((p) => [p.id, p]));
    const tasks: Cmd[] = data.tasks.map((t) => ({
      id: `task-${t.id}`, group: "Tasks", label: t.title, icon: t.done ? "done" : "circle",
      color: t.project_id ? projects.get(t.project_id)?.color : undefined,
      hint: [t.project_id ? projects.get(t.project_id)?.name : null, t.deadline ? `due ${relDay(t.deadline)}` : null].filter(Boolean).join(" · "),
      run: () => openTask(t.id),
    }));
    const events: Cmd[] = data.events.map((e) => ({
      id: `event-${e.id}`, group: "Events", label: e.title, icon: "calendar", color: e.color,
      hint: `${relDay(e.start_at.slice(0, 10))} ${fmtRange(minutesOfIso(e.start_at), minutesOfIso(e.end_at))}`,
      run: () => navigate({ name: "calendar", date: e.start_at.slice(0, 10) }),
    }));
    const habits: Cmd[] = data.habits.map((h) => ({
      id: `habit-${h.id}`, group: "Habits", label: h.title, icon: "habits", run: () => navigate({ name: "habits" }),
    }));
    return [...create, ...go, ...boards, ...tasks, ...events, ...habits, ...prefsCmds];
  }, [data]);

  const q = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!q) {
      return commands.filter((c) => c.group === "Create" || c.group === "Go to");
    }
    const scored = commands
      .map((c) => ({ c, s: Math.max(score(c.label, q), c.keywords ? score(c.keywords, q) * 0.8 : 0) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || (a.c.group === "Tasks" && a.c.icon === "done" ? 1 : 0) - (b.c.group === "Tasks" && b.c.icon === "done" ? 1 : 0))
      .slice(0, 40)
      .map((x) => x.c);
    const add: Cmd = {
      id: "create-from-query", group: "Create", label: `Create task “${query.trim()}”`, icon: "plus",
      run: () => openQuickAdd({ mode: "task", text: query.trim() }),
    };
    return [...scored, add];
  }, [commands, q, query]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function run(c: Cmd) {
    close();
    // Let the palette unmount first so focus returns cleanly.
    requestAnimationFrame(() => c.run());
  }

  // Group while preserving order.
  const groups: { name: string; items: { c: Cmd; i: number }[] }[] = [];
  results.forEach((c, i) => {
    const g = groups.find((x) => x.name === c.group) ?? (groups.push({ name: c.group, items: [] }), groups[groups.length - 1]);
    g.items.push({ c, i });
  });

  return (
    <Dialog onClose={close} label="Command palette" variant="palette">
      <div className="palette-input">
        <Icon name="search" size={18} />
        <input autoFocus value={query} placeholder="Search tasks, events, boards… or type a command"
          aria-label="Search" aria-controls="palette-list" aria-activedescendant={`pal-${active}`}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            if (e.key === "Enter" && results[active]) { e.preventDefault(); run(results[active]); }
          }} />
        <Kbd>esc</Kbd>
      </div>
      <div className="palette-list" id="palette-list" role="listbox" ref={listRef}>
        {groups.map((g) => (
          <div key={g.name} className="palette-group">
            <div className="palette-group-label">{g.name}</div>
            {g.items.map(({ c, i }) => (
              <div key={c.id} id={`pal-${i}`} data-index={i} role="option" aria-selected={i === active}
                className={"palette-item" + (i === active ? " active" : "")}
                onPointerMove={() => setActive(i)} onClick={() => run(c)}>
                <span className="palette-icon" style={c.color ? { color: c.color } : undefined}>
                  <Icon name={c.icon} size={16} />
                </span>
                <span className="palette-label">{c.label}</span>
                {c.hint && <span className="palette-hint">{c.hint}</span>}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="palette-foot">
        <span><Kbd>↑</Kbd><Kbd>↓</Kbd> navigate</span>
        <span><Kbd>↵</Kbd> open</span>
      </div>
    </Dialog>
  );
}
