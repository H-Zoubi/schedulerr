import { createStore } from "./createStore";

// History-based routing, so the back button and reloads keep your place.
// nginx and the Vite dev server both fall back to index.html for unknown paths.

export type Route =
  | { name: "today" }
  | { name: "calendar"; view?: string; date?: string }
  | { name: "tasks"; list: string }        // inbox | today | upcoming | anytime | done | project:<id>
  | { name: "board"; id: number | null }   // null = general board
  | { name: "habits" }
  | { name: "access" }
  | { name: "settings" };

export function parseRoute(path: string, search: string): Route {
  const parts = path.split("/").filter(Boolean);
  const q = new URLSearchParams(search);
  switch (parts[0]) {
    case "calendar":
      return { name: "calendar", view: q.get("view") ?? undefined, date: q.get("date") ?? undefined };
    case "tasks":
      if (parts[1] === "project" && parts[2]) return { name: "tasks", list: `project:${parts[2]}` };
      return { name: "tasks", list: parts[1] ?? "inbox" };
    case "board":
      return { name: "board", id: parts[1] && parts[1] !== "general" ? Number(parts[1]) : null };
    case "habits":
      return { name: "habits" };
    case "settings":
      return { name: "settings" };
    case "access":
      return { name: "access" };
    default:
      return { name: "today" };
  }
}

export function routePath(r: Route): string {
  switch (r.name) {
    case "calendar": {
      const q = new URLSearchParams();
      if (r.view) q.set("view", r.view);
      if (r.date) q.set("date", r.date);
      const s = q.toString();
      return `/calendar${s ? `?${s}` : ""}`;
    }
    case "tasks":
      return r.list.startsWith("project:") ? `/tasks/project/${r.list.slice(8)}` : `/tasks/${r.list}`;
    case "board":
      return `/board/${r.id ?? "general"}`;
    default:
      return `/${r.name}`;
  }
}

export const router = createStore<Route>(parseRoute(location.pathname, location.search));
export const useRoute = router.use;

export function navigate(r: Route, opts: { replace?: boolean } = {}) {
  const path = routePath(r);
  if (path === location.pathname + location.search) {
    router.set(r);
    return;
  }
  if (opts.replace) history.replaceState(null, "", path);
  else history.pushState(null, "", path);
  router.set(r);
  if (!opts.replace) window.scrollTo(0, 0);
}

window.addEventListener("popstate", () => router.set(parseRoute(location.pathname, location.search)));
