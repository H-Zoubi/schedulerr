import { useEffect } from "react";
import { Dialog, Kbd, SheetHeader } from "./primitives";
import { anyOverlayOpen, isTyping, openQuickAdd, setPalette, setShortcuts, ui } from "../lib/ui";
import { navigate, Route } from "../lib/router";
import { prefs, setPref } from "../lib/prefs";

const SECTIONS: { title: string; items: [string[], string][] }[] = [
  {
    title: "Everywhere",
    items: [
      [["⌘", "K"], "Search and commands"],
      [["C"], "New task"],
      [["E"], "New event"],
      [["S"], "Log spending"],
      [["?"], "Show shortcuts"],
      [["["], "Toggle sidebar"],
    ],
  },
  {
    title: "Go to",
    items: [
      [["G", "T"], "Today"],
      [["G", "C"], "Calendar"],
      [["G", "I"], "Inbox"],
      [["G", "U"], "Upcoming"],
      [["G", "B"], "Board"],
      [["G", "H"], "Habits"],
      [["G", "S"], "Settings"],
    ],
  },
  {
    title: "Calendar",
    items: [
      [["T"], "Jump to today"],
      [["←", "→"], "Previous / next"],
      [["D"], "Day view"],
      [["X"], "3-day view"],
      [["W"], "Week view"],
      [["M"], "Month view"],
      [["Drag"], "Create, move or resize"],
      [["⌫"], "Delete selected item"],
    ],
  },
  {
    title: "Task lists",
    items: [
      [["J", "K"], "Move down / up"],
      [["X"], "Complete"],
      [["↵"], "Open details"],
      [["⌫"], "Delete"],
      [["⇧", "Click"], "Select several"],
    ],
  },
  {
    title: "Quick add",
    items: [
      [["tomorrow 3pm"], "Date and time"],
      [["45m", "2h"], "Duration"],
      [["#board"], "Board"],
      [["!1", "!2", "!3"], "Priority high / med / low"],
      [["due fri"], "Deadline"],
      [["every mon"], "Weekly routine"],
      [["⇧", "↵"], "Add and keep typing"],
    ],
  },
];

export function ShortcutsSheet() {
  const close = () => setShortcuts(false);
  return (
    <Dialog onClose={close} label="Keyboard shortcuts" className="shortcuts">
      <SheetHeader title="Keyboard shortcuts" onClose={close} />
      <div className="shortcut-grid">
        {SECTIONS.map((s) => (
          <section key={s.title}>
            <h3>{s.title}</h3>
            <dl>
              {s.items.map(([keys, label]) => (
                <div key={label} className="shortcut-row">
                  <dt>{label}</dt>
                  <dd>{keys.map((k) => <Kbd key={k}>{k}</Kbd>)}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}

const GOTO: Record<string, Route> = {
  t: { name: "today" },
  c: { name: "calendar" },
  i: { name: "tasks", list: "inbox" },
  u: { name: "tasks", list: "upcoming" },
  b: { name: "board", id: null },
  h: { name: "habits" },
  s: { name: "settings" },
};

// App-wide shortcuts. Page-specific keys are handled by each page.
export function useGlobalShortcuts() {
  useEffect(() => {
    let gPressed = 0;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette(!ui.get().palette);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping() || anyOverlayOpen()) return;
      const key = e.key.toLowerCase();
      if (gPressed && Date.now() - gPressed < 1200 && GOTO[key]) {
        e.preventDefault();
        gPressed = 0;
        navigate(GOTO[key]);
        return;
      }
      gPressed = 0;
      if (key === "g") { gPressed = Date.now(); return; }
      if (key === "c" || key === "n") { e.preventDefault(); openQuickAdd({ mode: "task" }); return; }
      if (key === "e") { e.preventDefault(); openQuickAdd({ mode: "event" }); return; }
      if (key === "s") { e.preventDefault(); openQuickAdd({ mode: "spend" }); return; }
      if (key === "/") { e.preventDefault(); setPalette(true); return; }
      if (e.key === "?") { e.preventDefault(); setShortcuts(true); return; }
      if (key === "[") { e.preventDefault(); setPref("sidebarCollapsed", !prefs.get().sidebarCollapsed); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
