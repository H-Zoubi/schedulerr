import { useEffect, useState } from "react";
import { api, post } from "./api";
import { Login } from "./pages/Login";
import { Today } from "./pages/Today";
import { Week } from "./pages/Week";
import { Inbox } from "./pages/Inbox";
import { Kanban } from "./pages/Kanban";
import { Habits } from "./pages/Habits";

type Tab = "today" | "week" | "inbox" | "kanban" | "habits";
type Theme = "system" | "light" | "dark";
type Sidebar = "open" | "collapsed";
type User = { id: number; email: string };

const TAB_KEY = "scheduler.tab";
const THEME_KEY = "scheduler.theme";
const SIDEBAR_KEY = "scheduler.sidebar";

// Local preferences only. Storage can be blocked (private mode), so every access is guarded.
function readStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return allowed.find((a) => a === v) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore: the preference just won't persist */
  }
}

const ICON_PROPS = {
  width: 22,
  height: 22,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  className: "tab-icon",
  "aria-hidden": true,
};

const TABS: { id: Tab; label: string; icon: JSX.Element }[] = [
  {
    id: "today",
    label: "Today",
    icon: (
      <svg {...ICON_PROPS}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    ),
  },
  {
    id: "week",
    label: "Week",
    icon: (
      <svg {...ICON_PROPS}>
        <rect x="4" y="5" width="16" height="15" rx="2" />
        <path d="M4 10h16M9 3v4M15 3v4" />
      </svg>
    ),
  },
  {
    id: "inbox",
    label: "Inbox",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M4 13l2-7h12l2 7v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />
        <path d="M4 13h5l1 2h4l1-2h5" />
      </svg>
    ),
  },
  {
    id: "kanban",
    label: "Board",
    icon: (
      <svg {...ICON_PROPS}>
        <rect x="4" y="5" width="4" height="14" rx="1" />
        <rect x="10" y="5" width="4" height="9" rx="1" />
        <rect x="16" y="5" width="4" height="11" rx="1" />
      </svg>
    ),
  },
  {
    id: "habits",
    label: "Habits",
    icon: (
      <svg {...ICON_PROPS}>
        <circle cx="12" cy="12" r="8" />
        <path d="M8.5 12.5l2.5 2.5 4.5-5" />
      </svg>
    ),
  },
];

const THEMES: { id: Theme; label: string }[] = [
  { id: "system", label: "Auto" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

const TAB_IDS: Tab[] = TABS.map((t) => t.id);
const THEME_IDS: Theme[] = THEMES.map((t) => t.id);
const SIDEBAR_IDS: Sidebar[] = ["open", "collapsed"];

export function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>(() => readStored(TAB_KEY, TAB_IDS, "today"));
  const [theme, setTheme] = useState<Theme>(() => readStored(THEME_KEY, THEME_IDS, "system"));
  const [sidebar, setSidebar] = useState<Sidebar>(() => readStored(SIDEBAR_KEY, SIDEBAR_IDS, "open"));

  useEffect(() => {
    api<User>("/auth/me")
      .then(setUser)
      .catch(() => setUser(null));
  }, []);

  // "system" removes the attribute so the OS preference decides.
  useEffect(() => {
    if (theme === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme);
    writeStored(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    writeStored(TAB_KEY, tab);
  }, [tab]);

  useEffect(() => {
    writeStored(SIDEBAR_KEY, sidebar);
  }, [sidebar]);

  if (user === undefined) return <div className="center muted">Loading…</div>;
  if (user === null) return <Login onLogin={setUser} />;

  async function logout() {
    await post("/auth/logout", {}).catch(() => undefined);
    setUser(null);
  }

  return (
    <div className="shell">
      <aside className={"sidebar" + (sidebar === "collapsed" ? " collapsed" : "")} aria-label="Main">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">S</span>
          <span className="brand-text">Scheduler</span>
          <button className="icon sidebar-toggle"
            aria-label={sidebar === "open" ? "Collapse sidebar" : "Expand sidebar"}
            aria-expanded={sidebar === "open"}
            onClick={() => setSidebar(sidebar === "open" ? "collapsed" : "open")}>
            {sidebar === "open" ? "‹" : "›"}
          </button>
        </div>
        <nav className="nav">
          {TABS.map((t) => (
            <button key={t.id} className={"nav-link" + (tab === t.id ? " active" : "")}
              aria-current={tab === t.id ? "page" : undefined}
              title={t.label}
              onClick={() => setTab(t.id)}>
              {t.icon}
              <span className="nav-label">{t.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <ThemePicker theme={theme} onChange={setTheme} />
          <div className="user-email" title={user.email}>{user.email}</div>
          <button className="ghost logout" title="Log out" onClick={logout}>
            <span className="nav-label">Log out</span>
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">S</span>
          </div>
          <div className="topbar-actions">
            <button className="ghost" onClick={logout}>Log out</button>
          </div>
        </header>

        <main className={"content" + (tab === "kanban" ? " content-wide" : "")}>
          {tab === "today" && <Today />}
          {tab === "week" && <Week />}
          {tab === "inbox" && <Inbox />}
          {tab === "kanban" && <Kanban />}
          {tab === "habits" && <Habits />}
        </main>
      </div>

      <nav className="bottom-nav mobile-only" aria-label="Main">
        {TABS.map((t) => (
          <button key={t.id} className={"nav-link" + (tab === t.id ? " active" : "")}
            aria-current={tab === t.id ? "page" : undefined}
            onClick={() => setTab(t.id)}>
            {t.icon}
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

function ThemePicker({ theme, onChange }: { theme: Theme; onChange: (t: Theme) => void }) {
  return (
    <div className="theme-switch" role="group" aria-label="Theme">
      {THEMES.map((t) => (
        <button key={t.id} className={theme === t.id ? "active" : ""}
          aria-pressed={theme === t.id} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}
