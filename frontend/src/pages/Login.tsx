import { FormEvent, useState } from "react";
import { ApiError, post } from "../api";
import { APP_VERSION } from "../version";

type User = { id: number; email: string };

export function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onLogin(await post<User>("/auth/login", { email, password }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login card" onSubmit={submit}>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">S</span>
          Schedulerr
        </div>
        <p className="sub">Plan your week, one block at a time.</p>
        <span className="app-version">v{APP_VERSION}</span>

        <label>
          Email
          <input type="email" autoComplete="username" value={email}
            onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </label>
        <label>
          Password
          <input type="password" autoComplete="current-password" value={password}
            onChange={(e) => setPassword(e.target.value)} required />
        </label>

        {error && <div className="banner" role="alert">{error}</div>}
        <button className="primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </div>
  );
}
