// Date helpers. All calendar maths is in the browser's local timezone.

export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(d: Date, n: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

// Sunday that starts the week containing `d`.
export function weekStartOf(d: Date): Date {
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return addDays(start, -start.getDay());
}

export function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

// Local date and time without a UTC offset, e.g. "2026-10-01T10:30:00".
// The backend stores these as-is, so times are never shifted by the timezone.
export function localIso(d: Date): string {
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${isoDate(d)}T${hh}:${mm}:00`;
}
