import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { api, post, User } from "./api";
import { Login } from "./pages/Login";
import { Today } from "./pages/Today";
import { Calendar } from "./pages/Calendar";
import { Tasks } from "./pages/Tasks";
import { Board } from "./pages/Board";
import { Habits } from "./pages/Habits";
import { ApiKeys } from "./pages/ApiKeys";
import { APP_VERSION } from "./version";
import { Icon, IconName } from "./components/Icon";
import { IconButton, Kbd, Toaster } from "./components/primitives";
import { QuickAdd } from "./components/QuickAdd";
import { TaskDrawer } from "./components/TaskDrawer";
import { CommandPalette } from "./components/CommandPalette";
import { ShortcutsSheet, useGlobalShortcuts } from "./components/Shortcuts";
import { BoardDialog } from "./components/BoardDialog";
import { flushDeletes, loadAll, refreshIfStale, resetStore, useData } from "./store";
import { navigate, Route, useRoute } from "./lib/router";
import { applyAppearance, prefs, setPref, usePrefs } from "./lib/prefs";
import { openQuickAdd, setPalette, useUI } from "./lib/ui";
import { todayIso } from "./dates";
import { countIn, habitWindow, logIndex } from "./lib/derive";

const Settings = lazy(() => import("./pages/Settings").then((m) => ({ default: m.Settings })));

type NavItem = { route: Route; label: string; icon: IconName; match: (r: Route) => boolean; badge?: number; tone?: string };

export function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    applyAppearance();
    const unsub = prefs.subscribe(applyAppearance);
    const mq = matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", applyAppearance);
    return () => { unsub(); mq.removeEventListener("change", applyAppearance); };
  }, []);

  useEffect(() => {
    api<User>("/auth/me").then(setUser).catch(() => setUser(null));
  }, []);

  useEffect(() => {
    if (!user) return;
    setLoadError(null);
    loadAll().catch((e) => setLoadError(e instanceof Error ? e.message : "Could not load your data"));
    const onVisible = () => { if (document.visibilityState === "visible") refreshIfStale(); };
    const onFocus = () => refreshIfStale();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pagehide", flushDeletes);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pagehide", flushDeletes);
    };
  }, [user]);

  if (user === undefined) return <Splash />;
  if (user === null) return <Login onLogin={setUser} />;

  async function logout() {
    flushDeletes();
    await post("/auth/logout", {}).catch(() => undefined);
    resetStore();
    setUser(null);
  }

  return <Shell user={user} onLogout={logout} loadError={loadError} />;
}

function Splash() {
  return (
    <div className="splash" aria-busy="true">
      <span className="brand-mark lg">S</span>
    </div>
  );
}

function Shell({ user, onLogout, loadError }: { user: User; onLogout: () => void; loadError: string | null }) {
  const route = useRoute();
  const ready = useData((s) => s.ready);
  const { sidebarCollapsed } = usePrefs();
  const overlays = useUI();
  useGlobalShortcuts();

  return (
    <div className={"shell" + (sidebarCollapsed ? " collapsed" : "")}>
      <Sidebar user={user} onLogout={onLogout} />
      <main className={"main route-" + route.name}>
        {loadError ? (
          <div className="load-error">
            <strong>Couldn’t load your planner</strong>
            <p className="muted">{loadError}</p>
            <button className="btn primary" onClick={() => location.reload()}>Try again</button>
          </div>
        ) : !ready ? (
          <PageSkeleton />
        ) : (
          <div className="page-fade" key={route.name}>
            <Page route={route} onLogout={onLogout} user={user} />
          </div>
        )}
      </main>
      <MobileNav />
      {overlays.quickAdd && <QuickAdd prefill={overlays.quickAdd} />}
      {overlays.taskId !== null && <TaskDrawer taskId={overlays.taskId} />}
      {overlays.palette && <CommandPalette />}
      {overlays.shortcuts && <ShortcutsSheet />}
      <Toaster />
    </div>
  );
}

function Page({ route, user, onLogout }: { route: Route; user: User; onLogout: () => void }) {
  switch (route.name) {
    case "calendar": return <Calendar route={route} />;
    case "tasks": return <Tasks list={route.list} />;
    case "board": return <Board id={route.id} />;
    case "habits": return <Habits />;
    case "access": return <ApiKeys />;
    case "settings": return <Suspense fallback={null}><Settings user={user} onLogout={onLogout} /></Suspense>;
    default: return <Today />;
  }
}

function PageSkeleton() {
  return (
    <div className="skeleton-page" aria-busy="true" aria-label="Loading">
      <div className="sk sk-title" />
      <div className="sk sk-line" />
      <div className="sk-grid">
        <div className="sk sk-card" />
        <div className="sk sk-card" />
      </div>
    </div>
  );
}

function useNavItems(): NavItem[] {
  const tasks = useData((s) => s.tasks);
  const habits = useData((s) => s.habits);
  const logs = useData((s) => s.habitLogs);
  return useMemo(() => {
    const today = todayIso();
    const open = tasks.filter((t) => !t.done);
    const inbox = open.filter((t) => t.project_id === null && t.column_key === "inbox").length;
    const overdue = open.filter((t) => t.deadline && t.deadline < today).length;
    const dueToday = open.filter((t) => t.deadline === today).length;
    const idx = logIndex(logs);
    const habitsLeft = habits.filter((h) => {
      const w = habitWindow(h);
      return countIn(idx.get(h.id), w.start, w.end) < h.target_count;
    }).length;
    return [
      { route: { name: "today" }, label: "Today", icon: "today", match: (r) => r.name === "today", badge: overdue + dueToday || undefined, tone: overdue ? "danger" : undefined },
      { route: { name: "calendar" }, label: "Calendar", icon: "calendar", match: (r) => r.name === "calendar" },
      { route: { name: "tasks", list: "inbox" }, label: "Inbox", icon: "inbox", match: (r) => r.name === "tasks" && r.list === "inbox", badge: inbox || undefined },
      { route: { name: "tasks", list: "upcoming" }, label: "Tasks", icon: "tasks", match: (r) => r.name === "tasks" && r.list !== "inbox" },
      { route: { name: "board", id: null }, label: "Board", icon: "board", match: (r) => r.name === "board" },
      { route: { name: "habits" }, label: "Habits", icon: "habits", match: (r) => r.name === "habits", badge: habitsLeft || undefined },
      { route: { name: "access" }, label: "AI access", icon: "settings", match: (r) => r.name === "access" },
    ] as NavItem[];
  }, [tasks, habits, logs]);
}

function Sidebar({ user, onLogout }: { user: User; onLogout: () => void }) {
  const route = useRoute();
  const items = useNavItems();
  const projects = useData((s) => s.projects);
  const tasks = useData((s) => s.tasks);
  const pending = useData((s) => s.pending);
  const { sidebarCollapsed, theme } = usePrefs();
  const [newBoard, setNewBoard] = useState(false);
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

  const openCount = (pid: number | null) => tasks.filter((t) => t.project_id === pid && !t.done).length;

  return (
    <aside className="sidebar" aria-label="Main">
      <div className="sidebar-head">
        <button className="brand" onClick={() => navigate({ name: "today" })} aria-label="Schedulerr home">
          <span className="brand-mark">S</span>
          <span className="brand-text">Schedulerr</span>
          <span className="app-version">v{APP_VERSION}</span>
        </button>
        <IconButton icon="sidebar" label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} shortcut="["
          className="collapse-btn" onClick={() => setPref("sidebarCollapsed", !sidebarCollapsed)} />
      </div>

      <div className="sidebar-actions">
        <button className="btn primary new-btn" onClick={() => openQuickAdd()} title="New (C)">
          <Icon name="plus" size={16} strokeWidth={2.2} />
          <span className="label">New</span>
          <Kbd>C</Kbd>
        </button>
        <button className="search-btn" onClick={() => setPalette(true)} title="Search (⌘K)">
          <Icon name="search" size={16} />
          <span className="label">Search</span>
          <span className="kbd-group"><Kbd>{isMac ? "⌘" : "Ctrl"}</Kbd><Kbd>K</Kbd></span>
        </button>
      </div>

      <nav className="nav">
        {items.map((it) => {
          const active = it.match(route);
          return (
            <button key={it.label} className={"nav-item" + (active ? " active" : "")} aria-current={active ? "page" : undefined}
              title={it.label} onClick={() => navigate(it.route)}>
              <Icon name={it.icon} size={18} />
              <span className="label">{it.label}</span>
              {it.badge !== undefined && <span className={"badge" + (it.tone ? " " + it.tone : "")}>{it.badge}</span>}
            </button>
          );
        })}
      </nav>

      <div className="nav-section">
        <div className="nav-section-head">
          <span className="label">Boards</span>
          <IconButton icon="plus" size={15} label="New board" onClick={() => setNewBoard(true)} />
        </div>
        <div className="nav-boards">
          {[{ id: null as number | null, name: "General", color: "var(--text-3)" }, ...projects].map((p) => {
            const active = route.name === "board" && route.id === p.id;
            return (
              <button key={p.id ?? "general"} className={"nav-item board-link" + (active ? " active" : "")}
                title={p.name} onClick={() => navigate({ name: "board", id: p.id })}>
                <span className="board-dot" style={{ background: p.color }} />
                <span className="label">{p.name}</span>
                <span className="count">{openCount(p.id) || ""}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="sidebar-foot">
        <span className={"sync-dot" + (pending ? " busy" : "")} title={pending ? "Saving…" : "All changes saved"} />
        <button className={"nav-item" + (route.name === "settings" ? " active" : "")} onClick={() => navigate({ name: "settings" })} title="Settings">
          <Icon name="settings" size={18} />
          <span className="label truncate">{user.email}</span>
        </button>
        <IconButton icon={theme === "dark" ? "sun" : "moon"} label="Toggle theme" className="theme-btn"
          onClick={() => {
            const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
            setPref("theme", dark ? "light" : "dark");
          }} />
        <IconButton icon="logout" label="Log out" className="logout-btn" onClick={onLogout} />
      </div>
      {newBoard && <BoardDialog onClose={() => setNewBoard(false)} />}
    </aside>
  );
}

function MobileNav() {
  const route = useRoute();
  const items = useNavItems().filter((i) => i.label !== "Inbox");
  return (
    <>
      <nav className="tabbar" aria-label="Main">
        {items.map((it) => {
          const active = it.match(route) || (it.label === "Tasks" && route.name === "tasks");
          return (
            <button key={it.label} className={"tab" + (active ? " active" : "")} aria-current={active ? "page" : undefined}
              onClick={() => navigate(it.label === "Tasks" ? { name: "tasks", list: "inbox" } : it.route)}>
              <span className="tab-icon">
                <Icon name={it.icon} size={22} />
                {it.badge !== undefined && <span className={"tab-badge" + (it.tone ? " " + it.tone : "")} />}
              </span>
              <span>{it.label}</span>
            </button>
          );
        })}
      </nav>
      <button className="fab" aria-label="New" onClick={() => openQuickAdd()}>
        <Icon name="plus" size={24} strokeWidth={2.2} />
      </button>
    </>
  );
}
