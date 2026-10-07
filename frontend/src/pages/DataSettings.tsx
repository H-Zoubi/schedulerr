import { ChangeEvent, ReactNode, useEffect, useRef, useState } from "react";
import { api, del, post } from "../api";
import { Dialog, SheetHeader } from "../components/primitives";
import { Icon } from "../components/Icon";
import { loadAll } from "../store";
import { toast, toastError } from "../lib/toast";

type Export = { app: string; format: number; exported_at?: string; tables: Record<string, unknown[]> };
type FeedStatus = { enabled: boolean; created_at: string | null; path: string | null };

const LABELS: Record<string, [string, string]> = {
  tasks: ["task", "tasks"],
  events: ["event", "events"],
  time_blocks: ["routine", "routines"],
  task_blocks: ["scheduled block", "scheduled blocks"],
  projects: ["board", "boards"],
  habits: ["habit", "habits"],
  habit_logs: ["habit check-in", "habit check-ins"],
  reminders: ["reminder", "reminders"],
};

function summary(tables: Record<string, unknown[]>) {
  return Object.entries(LABELS)
    .map(([key, [one, many]]) => {
      const n = tables[key]?.length ?? 0;
      return n ? `${n} ${n === 1 ? one : many}` : null;
    })
    .filter(Boolean)
    .join(", ") || "nothing";
}

// Settings → Backup and Calendar feed.
export function DataSettings() {
  return (
    <>
      <Backup />
      <CalendarFeed />
    </>
  );
}

function Backup() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ name: string; data: Export } | null>(null);
  const [busy, setBusy] = useState(false);

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const data = JSON.parse(await file.text()) as Export;
      if (data?.app !== "schedulerr" || typeof data.tables !== "object") throw new Error();
      setPending({ name: file.name, data });
    } catch {
      toast("That file isn’t a Schedulerr backup.", { tone: "error" });
    }
  }

  async function restore() {
    if (!pending) return;
    setBusy(true);
    try {
      await post("/api/import", pending.data);
      await loadAll();
      toast("Backup restored", { tone: "success" });
      setPending(null);
    } catch (e) {
      toastError(e, "Could not restore the backup");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-section">
      <h2>Backup</h2>
      <Row label="Download a backup" hint="Everything in your planner as one file: tasks, boards, calendar, habits and reminders.">
        <a className="btn sm" href="/api/export" download><Icon name="download" size={14} /> Download</a>
      </Row>
      <Row label="Restore from a backup" hint="Replaces everything in your planner with the contents of the file.">
        <button className="btn sm" onClick={() => fileRef.current?.click()}>Choose file…</button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={pick} />
      </Row>

      {pending && (
        <Dialog onClose={() => !busy && setPending(null)} label="Restore backup">
          <SheetHeader title="Restore backup?" onClose={() => !busy && setPending(null)} />
          <div className="form">
            <p>
              <strong>{pending.name}</strong>
              {pending.data.exported_at && <span className="muted"> · saved {new Date(pending.data.exported_at).toLocaleString()}</span>}
            </p>
            <p>It contains {summary(pending.data.tables)}.</p>
            <p className="restore-warning">
              Everything currently in your planner will be replaced. Download a backup first if you might want it back.
            </p>
            <div className="form-actions">
              <a className="btn ghost" href="/api/export" download>Download current first</a>
              <span className="grow" />
              <button className="btn ghost" disabled={busy} onClick={() => setPending(null)}>Cancel</button>
              <button className="btn danger-solid" disabled={busy} onClick={restore}>{busy ? "Restoring…" : "Replace and restore"}</button>
            </div>
          </div>
        </Dialog>
      )}
    </section>
  );
}

function CalendarFeed() {
  const [status, setStatus] = useState<FeedStatus | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api<FeedStatus>("/auth/calendar-feed").then(setStatus).catch(() => setStatus({ enabled: false, created_at: null, path: null }));
  }, []);

  async function create() {
    if (status?.enabled && !confirm("Create a new link? The current link stops working, so calendars using it must be re-added.")) return;
    setBusy(true);
    try {
      const res = await post<FeedStatus>("/auth/calendar-feed", {});
      setStatus(res);
      setUrl(window.location.origin + res.path);
      setCopied(false);
    } catch (e) {
      toastError(e, "Could not create the link");
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    if (!confirm("Turn off the calendar feed? Calendars subscribed to it will stop updating.")) return;
    setBusy(true);
    try {
      await del("/auth/calendar-feed");
      setStatus({ enabled: false, created_at: null, path: null });
      setUrl(null);
    } catch (e) {
      toastError(e, "Could not turn off the feed");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      toast("Copy isn’t available here. Select the link and copy it.");
    }
  }

  return (
    <section className="settings-section">
      <h2>Calendar feed</h2>
      <Row label="Subscribe from another calendar"
        hint="Shows your events, routines and scheduled tasks in Apple Calendar, Google Calendar or Outlook. Read-only; they refresh it every few hours.">
        <div className="row-gap">
          <span className={"status-pill" + (status?.enabled ? " ok" : "")}>
            {status === null ? "Checking…" : status.enabled ? "On" : "Off"}
          </span>
          <button className="btn sm" disabled={busy || status === null} onClick={create}>
            {status?.enabled ? "New link" : "Create link"}
          </button>
          {status?.enabled && <button className="btn sm ghost danger" disabled={busy} onClick={turnOff}>Turn off</button>}
        </div>
      </Row>
      {url && (
        <div className="keys-block feed-reveal" role="region" aria-label="Your calendar feed link">
          <p>Anyone with this link can see your schedule, so keep it private. It’s shown only now.</p>
          <input className="keys-secret" readOnly value={url} onFocus={(e) => e.currentTarget.select()} spellCheck={false} aria-label="Feed link" />
          <div className="keys-actions">
            <button className="btn primary sm" onClick={copy}>{copied ? "Copied" : "Copy link"}</button>
            <a className="btn sm" href={url.replace(/^https?:/, "webcal:")}>Open in Calendar</a>
            <button className="btn sm ghost" onClick={() => setUrl(null)}>Done</button>
          </div>
          <small className="muted">In Google Calendar: Other calendars → + → From URL, then paste the link.</small>
        </div>
      )}
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
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
