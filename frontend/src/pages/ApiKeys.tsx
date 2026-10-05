import { FormEvent, useEffect, useState } from "react";
import { api, del, post } from "../api";

type Key = {
  id: number; name: string; prefix: string; scope: "read" | "write";
  created_at: string; expires_at: string | null;
};
type CreatedKey = Key & { key: string };

function dateLabel(value: string) {
  // SQLite returns UTC timestamps without an offset.
  return new Date(/Z$|[+-]\d\d:\d\d$/.test(value) ? value : value + "Z").toLocaleDateString();
}

function expired(value: string | null) {
  return value !== null && new Date(/Z$|[+-]\d\d:\d\d$/.test(value) ? value : value + "Z").getTime() <= Date.now();
}

export function ApiKeys() {
  const [keys, setKeys] = useState<Key[]>([]);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"read" | "write">("read");
  const [days, setDays] = useState("90");
  const [created, setCreated] = useState<CreatedKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      setKeys(await api<Key[]>("/auth/api-keys"));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load API keys");
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const result = await post<CreatedKey>("/auth/api-keys", {
        name: name.trim(), scope, expires_in_days: days === "never" ? null : Number(days),
      });
      setCreated(result); setCopied(false); setName("");
      // Keep only public metadata in the list; the secret lives in the reveal panel.
      const { key: _secret, ...metadata } = result;
      setKeys((previous) => [metadata, ...previous]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create API key");
    } finally { setBusy(false); }
  }

  async function revoke(key: Key) {
    if (!confirm(`Revoke "${key.name}"? Anything using this key will lose access immediately.`)) return;
    setBusy(true); setError(null);
    try {
      await del(`/auth/api-keys/${key.id}`);
      setKeys((previous) => previous.filter((item) => item.id !== key.id));
      if (created?.id === key.id) setCreated(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not revoke API key");
    } finally { setBusy(false); }
  }

  async function copy() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.key);
      setCopied(true);
    } catch { setError("Copy unavailable. Select the key below and copy it manually."); }
  }

  return <section className="settings-section api-keys">
    <h2>API keys</h2>
    <div className="keys-block">
      <p>Use an API key to reach your planner from scripts and other apps. Send it as <code>Authorization: Bearer YOUR_KEY</code> to <code>{window.location.origin}</code>, for example <code>GET /api/week?start=YYYY-MM-DD</code>.</p>
      <p className="muted">Keys cover calendar items, tasks, habits, projects, and reminders. Store each key somewhere safe: it can't be shown again.</p>
    </div>
    {error && <div className="form-error keys-block" role="alert">{error}</div>}
    {created && <div className="keys-block keys-reveal" role="region" aria-label="Your new API key">
      <strong>Save your key</strong>
      <p>This secret is shown only now. You cannot retrieve it after dismissing this.</p>
      <label htmlFor="new-api-key">{created.name}</label>
      <input id="new-api-key" className="keys-secret" readOnly value={created.key} onFocus={(e) => e.currentTarget.select()} autoComplete="off" spellCheck={false} />
      <div className="keys-actions">
        <button className="btn primary sm" onClick={copy}>{copied ? "Copied" : "Copy key"}</button>
        <button className="btn sm" onClick={() => setCreated(null)}>I've saved it</button>
        <span role="status" className="muted">{copied ? "Key copied to clipboard" : ""}</span>
      </div>
    </div>}
    <form className="keys-block keys-form" onSubmit={create}>
      <strong>Create a key</strong>
      <label htmlFor="key-name">Name</label>
      <input id="key-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Home script" maxLength={100} required />
      <label htmlFor="key-scope">Permissions</label>
      <select id="key-scope" value={scope} onChange={(e) => setScope(e.target.value as "read" | "write")}>
        <option value="read">Read only</option><option value="write">Read and write</option>
      </select>
      <small className="muted">{scope === "read" ? "Can view your planner." : "Can view, create, edit, and delete planner items."}</small>
      <label htmlFor="key-expiry">Expires after</label>
      <select id="key-expiry" value={days} onChange={(e) => setDays(e.target.value)}>
        <option value="30">30 days</option><option value="90">90 days</option><option value="365">1 year</option><option value="never">Never</option>
      </select>
      <button className="btn primary" disabled={busy || loading || !name.trim() || created !== null} type="submit">{busy ? "Working…" : "Create key"}</button>
      {created && <small className="muted">Save and dismiss your new key before creating another.</small>}
    </form>
    {loading ? <p className="muted keys-block">Loading keys…</p> : keys.length === 0 ? <p className="muted keys-block">No keys yet.</p> : keys.map((key) =>
      <div className="settings-row keys-item" key={key.id}>
        <div className="keys-info">
          <span>{key.name}</span> <code>{key.prefix}…</code>
          <small className="muted">{key.scope === "read" ? "Read only" : "Read and write"} · Created {dateLabel(key.created_at)} · {key.expires_at ? `${expired(key.expires_at) ? "Expired" : "Expires"} ${dateLabel(key.expires_at)}` : "Never expires"}</small>
        </div>
        <button className="btn sm danger" disabled={busy} onClick={() => revoke(key)} aria-label={`Revoke ${key.name}`}>Revoke</button>
      </div>)}
  </section>;
}
