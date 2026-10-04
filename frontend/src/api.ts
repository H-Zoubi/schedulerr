// Thin fetch wrapper. The session cookie is HttpOnly, so every call sends credentials.

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {
      /* no JSON body */
    }
    throw new ApiError(res.status, String(detail));
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const post = <T>(path: string, body: unknown) =>
  api<T>(path, { method: "POST", body: JSON.stringify(body) });
export const patch = <T>(path: string, body: unknown) =>
  api<T>(path, { method: "PATCH", body: JSON.stringify(body) });
export const put = <T>(path: string, body: unknown) =>
  api<T>(path, { method: "PUT", body: JSON.stringify(body) });
export const del = (path: string) => api<void>(path, { method: "DELETE" });

// ---------- Types matching the backend ----------

export type WeekItem = {
  kind: "time" | "event" | "task_block";
  id: number;
  title: string;
  start: string | null;
  end: string | null;
  start_time: string | null; // "HH:MM:SS" for time blocks
  end_time: string | null;
  color: string;
  task_id: number | null;
};

export type WeekDay = { date: string; items: WeekItem[] };

export type Task = {
  id: number;
  title: string;
  notes: string;
  project_id: number | null;
  column_id: number | null;
  column_key: string | null; // inbox | planned | doing | done for the default columns
  done: boolean;             // true when the task is in a column marked as done
  duration_minutes: number | null;
  deadline: string | null;
  position: number;
};

export type Project = {
  id: number;
  name: string;
  color: string;
  deadline: string | null;
};

export type Column = {
  id: number;
  project_id: number | null;
  name: string;
  key: string | null;
  position: number;
  is_done: boolean;
};

export type Habit = {
  id: number;
  title: string;
  target_count: number;
  target_period: "day" | "week";
  archived: boolean;
  done: number;
};
