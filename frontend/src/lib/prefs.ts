import { createStore } from "./createStore";

// Local, per-device preferences. Storage can be blocked (private mode), so access is guarded.

export type Theme = "system" | "light" | "dark";
export type CalView = "day" | "3day" | "week" | "month";

export type Prefs = {
  theme: Theme;
  accent: string;
  weekStart: 0 | 1;           // 0 = Sunday, 1 = Monday
  clock: "12" | "24";
  hourHeight: number;         // px per hour in the calendar grid
  workStart: number;          // minutes after midnight, used for scroll position and auto-planning
  workEnd: number;
  bufferMinutes: number;      // kept free between blocks by "Plan my day" and "Next free slot"
  calView: CalView;
  sidebarCollapsed: boolean;
  calSidebar: boolean;
  showCompleted: boolean;
  routinesDraggable: boolean; // routines (recurring blocks) are locked in place unless this is on
  currency: string;           // symbol or code shown next to amounts, empty = none
  v: number;                  // preferences format version
};

export const ACCENTS = [
  { id: "indigo", value: "#5b5bd6" },
  { id: "blue", value: "#2f7ff0" },
  { id: "teal", value: "#0e9f8e" },
  { id: "green", value: "#2f9e5b" },
  { id: "amber", value: "#d98a1c" },
  { id: "rose", value: "#e5487a" },
  { id: "violet", value: "#8e4ec6" },
  { id: "slate", value: "#5e6a7d" },
];

const KEY = "schedulerr.prefs";

function defaultClock(): "12" | "24" {
  try {
    const s = new Date(2020, 0, 1, 15).toLocaleTimeString(undefined, { hour: "numeric" });
    return /pm/i.test(s) ? "12" : "24";
  } catch {
    return "24";
  }
}

const DEFAULTS: Prefs = {
  theme: "system",
  accent: ACCENTS[0].value,
  weekStart: 0,
  clock: defaultClock(),
  hourHeight: 52,
  workStart: 9 * 60,
  workEnd: 18 * 60,
  bufferMinutes: 5,
  calView: typeof window !== "undefined" && window.innerWidth < 720 ? "day" : "week",
  sidebarCollapsed: false,
  calSidebar: true,
  showCompleted: false,
  routinesDraggable: false,
  currency: "",
  v: 2,
};

function load(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const stored = JSON.parse(raw);
      // Before v2 the week started on Monday by default, and that default was saved with
      // any other change. Drop it so the new Sunday default applies.
      if (stored.v !== 2) delete stored.weekStart;
      return { ...DEFAULTS, ...stored, v: 2 };
    }
  } catch {
    /* fall through */
  }
  return DEFAULTS;
}

export const prefs = createStore<Prefs>(load());

prefs.subscribe(() => {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs.get()));
  } catch {
    /* the preference just won't persist */
  }
});

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
  prefs.set((p) => ({ ...p, [key]: value }));
}

export const usePrefs = prefs.use;

// Apply theme and accent to the document. Called once at start and on every change.
export function applyAppearance() {
  const { theme, accent } = prefs.get();
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
  root.style.setProperty("--accent", accent);
  const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#111216" : "#fbfbfc");
}
