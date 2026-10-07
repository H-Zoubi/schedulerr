import { CSSProperties, useEffect, useState } from "react";
import { api, post, User } from "../api";
import { Segmented } from "../components/primitives";
import { Icon } from "../components/Icon";
import { ACCENTS, CalView, setPref, Theme, usePrefs } from "../lib/prefs";
import { setShortcuts } from "../lib/ui";
import { toast, toastError } from "../lib/toast";
import { timeString } from "../dates";
import { ApiKeys } from "./ApiKeys";
import { DataSettings } from "./DataSettings";

const HOURS = Array.from({ length: 25 }, (_, h) => h * 60);

export function Settings({ user, onLogout }: { user: User; onLogout: () => void }) {
  const p = usePrefs();
  const [providers, setProviders] = useState<Record<string, boolean> | null>(null);

  useEffect(() => {
    api<Record<string, boolean>>("/api/notifications/status").then(setProviders).catch(() => setProviders({}));
  }, []);

  async function testNotification() {
    try {
      const res = await post<{ sent_to: string[] }>("/api/notifications/test", {});
      toast(`Test sent via ${res.sent_to.join(", ")}`, { tone: "success" });
    } catch (e) {
      toastError(e, "Could not send the test");
    }
  }

  const configured = providers ? Object.entries(providers).filter(([, v]) => v).map(([k]) => k) : [];

  return (
    <div className="page settings-page">
      <header className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="page-sub">Preferences are saved on this device.</p>
        </div>
      </header>

      <section className="settings-section">
        <h2>Appearance</h2>
        <Row label="Theme">
          <Segmented label="Theme" value={p.theme} onChange={(v: Theme) => setPref("theme", v)}
            options={[{ value: "system", label: "Auto" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} />
        </Row>
        <Row label="Accent colour">
          <div className="color-picker">
            {ACCENTS.map((a) => (
              <button key={a.id} className={"swatch-btn" + (p.accent === a.value ? " on" : "")} aria-label={a.id}
                style={{ "--c": a.value } as CSSProperties} onClick={() => setPref("accent", a.value)} />
            ))}
          </div>
        </Row>
      </section>

      <section className="settings-section">
        <h2>Calendar</h2>
        <Row label="Week starts on">
          <Segmented label="Week starts on" value={String(p.weekStart) as "0" | "1"} onChange={(v) => setPref("weekStart", Number(v) as 0 | 1)}
            options={[{ value: "0", label: "Sunday" }, { value: "1", label: "Monday" }]} />
        </Row>
        <Row label="Time format">
          <Segmented label="Time format" value={p.clock} onChange={(v) => setPref("clock", v)}
            options={[{ value: "12", label: "1:00 PM" }, { value: "24", label: "13:00" }]} />
        </Row>
        <Row label="Default view">
          <Segmented label="Default view" value={p.calView} onChange={(v: CalView) => setPref("calView", v)}
            options={[{ value: "day", label: "Day" }, { value: "3day", label: "3 days" }, { value: "week", label: "Week" }, { value: "month", label: "Month" }]} />
        </Row>
        <Row label="Working hours" hint="Shaded outside these hours; used by “Plan my day” and “Next free slot”.">
          <div className="row-gap">
            <select value={p.workStart} onChange={(e) => setPref("workStart", Number(e.target.value))} aria-label="Start">
              {HOURS.slice(0, 24).map((m) => <option key={m} value={m}>{timeString(m)}</option>)}
            </select>
            <span className="muted">to</span>
            <select value={p.workEnd} onChange={(e) => setPref("workEnd", Number(e.target.value))} aria-label="End">
              {HOURS.slice(1).filter((m) => m > p.workStart).map((m) => <option key={m} value={m}>{m === 1440 ? "24:00" : timeString(m)}</option>)}
            </select>
          </div>
        </Row>
        <Row label="Buffer between blocks" hint="Free time kept around existing items when “Plan my day” and “Next free slot” pick a time.">
          <Segmented label="Buffer between blocks" value={String(p.bufferMinutes) as "0" | "5" | "10" | "15"}
            onChange={(v) => setPref("bufferMinutes", Number(v))}
            options={[{ value: "0", label: "None" }, { value: "5", label: "5 min" }, { value: "10", label: "10 min" }, { value: "15", label: "15 min" }]} />
        </Row>
        <Row label="Drag routines" hint="Routines repeat every week, so they stay put unless you allow dragging. You can always change their time from the item’s details.">
          <Segmented label="Drag routines" value={p.routinesDraggable ? "on" : "off"}
            onChange={(v) => setPref("routinesDraggable", v === "on")}
            options={[{ value: "off", label: "Locked" }, { value: "on", label: "Draggable" }]} />
        </Row>
        <Row label="Grid density" hint="Tip: hold Ctrl or ⌘ and scroll over the calendar to zoom.">
          <Segmented label="Density" value={p.hourHeight <= 40 ? "compact" : p.hourHeight >= 72 ? "roomy" : "normal"}
            onChange={(v) => setPref("hourHeight", v === "compact" ? 36 : v === "roomy" ? 80 : 52)}
            options={[{ value: "compact", label: "Compact" }, { value: "normal", label: "Normal" }, { value: "roomy", label: "Roomy" }]} />
        </Row>
      </section>

      <section className="settings-section">
        <h2>Reminders</h2>
        <Row label="Push services" hint="Configured on the server with NTFY_TOPIC or GOTIFY_URL. Set a reminder from any calendar item.">
          <div className="row-gap">
            <span className={"status-pill" + (configured.length ? " ok" : "")}>
              {providers === null ? "Checking…" : configured.length ? configured.join(", ") : "Not configured"}
            </span>
            <button className="btn sm" onClick={testNotification} disabled={!configured.length}><Icon name="bell" size={14} /> Send test</button>
          </div>
        </Row>
      </section>

      <DataSettings />

      <ApiKeys />

      <section className="settings-section">
        <h2>Account</h2>
        <Row label="Signed in as"><span>{user.email}</span></Row>
        <Row label="Keyboard shortcuts"><button className="btn sm" onClick={() => setShortcuts(true)}><Icon name="keyboard" size={14} /> Show</button></Row>
        <Row label=""><button className="btn ghost danger" onClick={onLogout}><Icon name="logout" size={15} /> Log out</button></Row>
      </section>
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="settings-row">
      <div className="settings-label">
        <span>{label}</span>
        {hint && <small className="muted">{hint}</small>}
      </div>
      <div className="settings-control">{children}</div>
    </div>
  );
}
