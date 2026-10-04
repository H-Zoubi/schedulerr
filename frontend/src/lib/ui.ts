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

export type UI = {
  taskId: number | null;
  quickAdd: QuickAddPrefill | null;
  palette: boolean;
  shortcuts: boolean;
};

export const ui = createStore<UI>({ taskId: null, quickAdd: null, palette: false, shortcuts: false });
export const useUI = ui.use;

export const openTask = (taskId: number) => ui.set((s) => ({ ...s, taskId, palette: false }));
export const closeTask = () => ui.set((s) => ({ ...s, taskId: null }));
export const openQuickAdd = (prefill: QuickAddPrefill = {}) =>
  ui.set((s) => ({ ...s, quickAdd: prefill, palette: false }));
export const closeQuickAdd = () => ui.set((s) => ({ ...s, quickAdd: null }));
export const setPalette = (palette: boolean) => ui.set((s) => ({ ...s, palette }));
export const setShortcuts = (shortcuts: boolean) => ui.set((s) => ({ ...s, shortcuts }));

// True while the user is typing somewhere, so single-key shortcuts stay out of the way.
export function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

export function anyOverlayOpen(): boolean {
  const s = ui.get();
  return s.taskId !== null || s.quickAdd !== null || s.palette || s.shortcuts
    || document.querySelector("[data-overlay]") !== null;
}
