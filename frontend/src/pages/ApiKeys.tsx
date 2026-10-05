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
    if (!confirm(`Revoke "${key.name}"? Any AI using this key will lose access immediately.`)) return;
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

  return <section className="api-access">
    <div className="page-head"><div className="titles">
      <h1>AI access</h1>
      <div className="subtitle">Give your AI its own key to access your planner.</div>
    </div></div>
    {error && <div className="banner" role="alert">{error}</div>}
    <div className="card access-connection">
      <h2>Connect your AI</h2>
      <p>Use this planner address in your AI integration:</p>
      <code>{window.location.origin}</code>
      <p>Send the key as <code>Authorization: Bearer YOUR_KEY</code>. Read your calendar with <code>GET /api/week?start=YYYY-MM-DD</code>.</p>
      <p className="muted">Keys cover calendar items, tasks, habits, projects, and reminders. Keep each key in your AI client's credential storage.</p>
    </div>
    {created && <div className="card access-reveal" role="region" aria-label="Your new API key">
      <h2>Save your key</h2>
      <p>This secret is shown only now. You cannot retrieve it after leaving this page or dismissing it.</p>
      <label htmlFor="new-api-key">{created.name}</label>
      <input id="new-api-key" className="access-secret" readOnly value={created.key} onFocus={(e) => e.currentTarget.select()} autoComplete="off" spellCheck={false} />
      <div className="access-actions">
        <button className="primary" onClick={copy}>{copied ? "Copied" : "Copy key"}</button>
        <button onClick={() => setCreated(null)}>I've saved it</button>
        <span role="status" className="muted">{copied ? "Key copied to clipboard" : ""}</span>
      </div>
    </div>}
    <form className="card access-form" onSubmit={create}>
      <h2>Create a key</h2>
      <label htmlFor="key-name">Name</label>
      <input id="key-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. My scheduling assistant" maxLength={100} required />
      <label htmlFor="key-scope">Permissions</label>
      <select id="key-scope" value={scope} onChange={(e) => setScope(e.target.value as "read" | "write")}>
        <option value="read">Read only</option><option value="write">Read and write</option>
      </select>
      <p className="muted">{scope === "read" ? "Can view your planner." : "Can view, create, edit, and delete planner items."}</p>
      <label htmlFor="key-expiry">Expires after</label>
      <select id="key-expiry" value={days} onChange={(e) => setDays(e.target.value)}>
        <option value="30">30 days</option><option value="90">90 days</option><option value="365">1 year</option><option value="never">Never</option>
      </select>
      <button className="primary" disabled={busy || loading || !name.trim() || created !== null} type="submit">{busy ? "Working…" : "Create key"}</button>
      {created && <p className="muted">Save and dismiss your new key before creating another.</p>}
    </form>
    <div className="access-list">
      <h2>Your keys</h2>
      {loading ? <p className="muted">Loading keys…</p> : keys.length === 0 ? <p className="muted">No keys yet. Create one above to connect your AI.</p> : keys.map((key) =>
        <div className="card access-key" key={key.id}>
          <div className="access-key-info"><h3>{key.name}</h3>
            <code>{key.prefix}…</code>
            <p className="muted">{key.scope === "read" ? "Read only" : "Read and write"} · Created {dateLabel(key.created_at)} · {key.expires_at ? `${expired(key.expires_at) ? "Expired" : "Expires"} ${dateLabel(key.expires_at)}` : "Never expires"}</p>
          </div>
          <button className="danger" disabled={busy} onClick={() => revoke(key)} aria-label={`Revoke ${key.name}`}>Revoke</button>
        </div>)}
    </div>
  </section>;
}
