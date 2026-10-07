import { createStore } from "./createStore";

// Global overlays: the task drawer, quick add, the command palette and the shortcuts sheet.

export type QuickAddMode = "task" | "event" | "routine";

export type QuickAddPrefill = {
  mode?: QuickAddMode;
  text?: string;
  date?: string;
  start?: number;
  end?: number;
  projectId?: number | null;
  columnId?: number | null;
};

// Which occurrences of a routine a change applies to.
export type Scope = "one" | "following" | "all";

export type ScopeRequest = {
  title: string;              // e.g. "Move “Gym”?"
  verb: string;               // e.g. "Move"
  resolve: (scope: Scope | null) => void;
};

export type UI = {
  taskId: number | null;
  quickAdd: QuickAddPrefill | null;
  palette: boolean;
  shortcuts: boolean;
  scope: ScopeRequest | null;
};

export const ui = createStore<UI>({ taskId: null, quickAdd: null, palette: false, shortcuts: false, scope: null });
export const useUI = ui.use;

export const openTask = (taskId: number) => ui.set((s) => ({ ...s, taskId, palette: false }));
export const closeTask = () => ui.set((s) => ({ ...s, taskId: null }));
export const openQuickAdd = (prefill: QuickAddPrefill = {}) =>
  ui.set((s) => ({ ...s, quickAdd: prefill, palette: false }));
export const closeQuickAdd = () => ui.set((s) => ({ ...s, quickAdd: null }));
export const setPalette = (palette: boolean) => ui.set((s) => ({ ...s, palette }));
export const setShortcuts = (shortcuts: boolean) => ui.set((s) => ({ ...s, shortcuts }));

// Asks whether a change to a routine is for this occurrence, this and following, or all.
// Resolves to null when dismissed.
export function askScope(title: string, verb: string): Promise<Scope | null> {
  ui.get().scope?.resolve(null);
  return new Promise((resolve) => {
    ui.set((s) => ({
      ...s,
      scope: {
        title, verb,
        resolve: (scope) => {
          ui.set((x) => ({ ...x, scope: null }));
          resolve(scope);
        },
      },
    }));
  });
}

// True while the user is typing somewhere, so single-key shortcuts stay out of the way.
export function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

export function anyOverlayOpen(): boolean {
  const s = ui.get();
  return s.taskId !== null || s.quickAdd !== null || s.palette || s.shortcuts || s.scope !== null
    || document.querySelector("[data-overlay]") !== null;
}
