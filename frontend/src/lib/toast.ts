import { createStore } from "./createStore";

export type Toast = {
  id: number;
  message: string;
  tone: "default" | "error" | "success";
  action?: { label: string; run: () => void };
  duration: number;
};

export const toasts = createStore<Toast[]>([]);
let nextId = 1;
const timers = new Map<number, number>();

export function dismissToast(id: number) {
  const t = timers.get(id);
  if (t) window.clearTimeout(t);
  timers.delete(id);
  toasts.set((list) => list.filter((x) => x.id !== id));
}

export function toast(
  message: string,
  opts: { tone?: Toast["tone"]; action?: Toast["action"]; duration?: number } = {},
): number {
  const id = nextId++;
  const item: Toast = {
    id,
    message,
    tone: opts.tone ?? "default",
    action: opts.action,
    duration: opts.duration ?? (opts.action ? 6000 : 3200),
  };
  // Keep at most three on screen; the oldest goes first.
  toasts.set((list) => [...list.slice(-2), item]);
  timers.set(id, window.setTimeout(() => dismissToast(id), item.duration));
  return id;
}

export function toastError(e: unknown, fallback = "Something went wrong") {
  toast(e instanceof Error && e.message ? e.message : fallback, { tone: "error", duration: 5000 });
}
