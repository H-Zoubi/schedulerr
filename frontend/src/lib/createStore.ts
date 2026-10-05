import { useSyncExternalStore } from "react";

// A tiny external store. Components subscribe with a selector and only re-render when
// the selected value changes (compared with Object.is), so updates stay cheap.
export function createStore<S>(initial: S) {
  let state = initial;
  const listeners = new Set<() => void>();

  const get = () => state;
  const set = (next: S | ((prev: S) => S)) => {
    const value = typeof next === "function" ? (next as (p: S) => S)(state) : next;
    if (value === state) return;
    state = value;
    listeners.forEach((l) => l());
  };
  const subscribe = (l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  };
  function use(): S;
  function use<T>(selector: (s: S) => T): T;
  function use<T>(selector?: (s: S) => T) {
    const pick = selector ?? ((s: S) => s as unknown as T);
    return useSyncExternalStore(subscribe, () => pick(state), () => pick(state));
  }
  return { get, set, subscribe, use };
}
