// Thin fetch wrapper. The session cookie is HttpOnly, so every call sends credentials.

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function describe(detail: unknown, fallback: string): string {
  if (typeof detail === "string") return detail;
  // FastAPI validation errors: [{ msg: "..." }, ...]
  if (Array.isArray(detail) && detail[0]?.msg) return String(detail[0].msg).replace(/^Value error, /, "");
  return fallback;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  if (!res.ok) {
    let detail = res.statusText || "Request failed";
    try {
      detail = describe((await res.json()).detail, detail);
    } catch {
      /* no JSON body */
    }
    throw new ApiError(res.status, detail);
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

export type User = { id: number; email: string };

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
  priority: number;          // 0 none, 1 low, 2 medium, 3 high
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

export type CalEvent = {
  id: number;
  title: string;
  start_at: string; // naive local "YYYY-MM-DDTHH:MM:SS"
  end_at: string;
  color: string;
};

// Recurring weekly slot. weekday: 0 = Monday ... 6 = Sunday.
export type TimeBlock = {
  id: number;
  title: string;
  weekday: number;
  start_time: string; // "HH:MM:SS"
  end_time: string;
  start_date: string;
  until_date: string | null;
  color: string;
};

export type TaskBlock = {
  id: number;
  task_id: number;
  start_at: string;
  end_at: string;
};

export type Habit = {
  id: number;
  title: string;
  target_count: number;
  target_period: "day" | "week";
  archived: boolean;
  done: number;
};

export type HabitLog = { habit_id: number; logged_on: string; count: number };

export type ReminderKind = "event" | "task_block" | "time_block";
export type Reminder = { kind: ReminderKind; target_id: number; minutes_before: number };
