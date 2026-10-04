// Date helpers. All calendar maths is in the browser's local timezone, and the backend
// stores naive local times ("2026-10-01T10:30:00"), so nothing is shifted by a UTC offset.
import { prefs } from "./lib/prefs";

export const DAY_MS = 86_400_000;

export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// "2026-10-04" -> local midnight Date.
export function parseDate(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

// "2026-10-04T10:30:00" -> local Date.
export function parseLocal(iso: string): Date {
  const [date, time = "00:00"] = iso.split("T");
  const [h, mi] = time.split(":").map(Number);
  const d = parseDate(date);
  d.setHours(h, mi, 0, 0);
  return d;
}

export function addDays(d: Date, n: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

export function addDaysIso(iso: string, n: number): string {
  return isoDate(addDays(parseDate(iso), n));
}

export function todayIso(): string {
  return isoDate(new Date());
}

// First day of the week containing `d`, using the user's week-start preference.
export function weekStartOf(d: Date, weekStart: number = prefs.get().weekStart): Date {
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = (start.getDay() - weekStart + 7) % 7;
  return addDays(start, -diff);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / DAY_MS);
}

// Local date and time without a UTC offset, e.g. "2026-10-01T10:30:00".
export function localIso(d: Date): string {
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${isoDate(d)}T${hh}:${mm}:00`;
}

export function atMinutes(day: string, minutes: number): string {
  const d = parseDate(day);
  d.setMinutes(minutes);
  return localIso(d);
}

export function minutesOfTime(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export function minutesOfIso(iso: string): number {
  return minutesOfTime(iso.split("T")[1] ?? "00:00");
}

export function timeString(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function nowMinutes(): number {
  const n = new Date();
  return n.getHours() * 60 + n.getMinutes();
}

// ---------- Formatting ----------

export function fmtTime(minutes: number, compact = false): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  if (prefs.get().clock === "24") return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  const suffix = h < 12 ? "am" : "pm";
  const h12 = h % 12 || 12;
  if (compact && m === 0) return `${h12}${suffix}`;
  return `${h12}:${String(m).padStart(2, "0")}${compact ? suffix : " " + suffix.toUpperCase()}`;
}

export function fmtHour(h: number): string {
  if (prefs.get().clock === "24") return `${String(h).padStart(2, "0")}:00`;
  return `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}`;
}

export function fmtRange(start: number, end: number): string {
  return `${fmtTime(start, true)} – ${fmtTime(end, true)}`;
}

export function fmtDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

// "Today", "Tomorrow", "Yesterday", "Fri", "Oct 12", "Oct 12, 2027".
export function relDay(iso: string, today = todayIso()): string {
  const diff = daysBetween(today, iso);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  const d = parseDate(iso);
  if (diff > 1 && diff < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

export function fmtDayLong(iso: string): string {
  return parseDate(iso).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

export function monthTitle(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export function weekdayShort(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: "short" });
}

// Backend weekday (0 = Monday) for a JS date.
export function backendWeekday(d: Date): number {
  return (d.getDay() + 6) % 7;
}
