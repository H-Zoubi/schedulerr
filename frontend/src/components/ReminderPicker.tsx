import { useEffect, useState } from "react";
import { api, put } from "../api";

type Kind = "event" | "task_block" | "time_block";
type Reminder = { kind: Kind; target_id: number; minutes_before: number };

const OPTIONS: { value: string; label: string }[] = [
  { value: "none", label: "No reminder" },
  { value: "0", label: "At start" },
  { value: "5", label: "5 minutes before" },
  { value: "10", label: "10 minutes before" },
  { value: "15", label: "15 minutes before" },
  { value: "30", label: "30 minutes before" },
  { value: "60", label: "1 hour before" },
  { value: "1440", label: "1 day before" },
];

// Sets a push reminder for one item. Saved as soon as the choice changes.
export function ReminderPicker({ kind, targetId }: { kind: Kind; targetId: number }) {
  const [value, setValue] = useState("none");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Reminder[]>("/api/reminders")
      .then((all) => {
        const found = all.find((r) => r.kind === kind && r.target_id === targetId);
        setValue(found ? String(found.minutes_before) : "none");
      })
      .catch(() => setValue("none"));
  }, [kind, targetId]);

  async function change(next: string) {
    setValue(next);
    setError(null);
    try {
      await put(`/api/reminders/${kind}/${targetId}`, { minutes_before: next === "none" ? null : Number(next) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the reminder");
    }
  }

  return (
    <label className="reminder">
      Reminder
      <select value={value} onChange={(e) => change(e.target.value)}>
        {OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {error && <span className="error small">{error}</span>}
    </label>
  );
}
