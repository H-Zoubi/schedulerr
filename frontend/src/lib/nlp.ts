// Natural-language quick add. Pulls dates, times, durations, projects, priorities and
// weekly recurrence out of a line of text; whatever is left is the title.
//
//   "Dentist fri 3pm for 45m"            -> event Friday 15:00-15:45
//   "Write report #thesis !1 due tomorrow" -> task, project Thesis, high priority, deadline tomorrow
//   "Gym every mon, wed 7-8am"            -> routine on Mondays and Wednesdays, 07:00-08:00
import { addDays, isoDate, weekStartOf } from "../dates";

export type Parsed = {
  title: string;
  date?: string;
  start?: number;      // minutes after midnight
  end?: number;
  duration?: number;   // minutes
  deadline?: string;
  project?: string;    // raw name after '#'
  priority?: number;   // 1 low, 2 medium, 3 high
  weekdays?: number[]; // backend weekdays (0 = Monday) for "every ..."
};

const WD = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const WD_RE = "(?:sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)";
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MON_RE = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const DATE_RE =
  `(?:today|tonight|tomorrow|tmrw?|tom|next\\s+week|in\\s+\\d+\\s+(?:days?|weeks?)|(?:next\\s+|this\\s+)?${WD_RE}` +
  `|\\d{4}-\\d{2}-\\d{2}|${MON_RE}\\s+\\d{1,2}(?:st|nd|rd|th)?|\\d{1,2}(?:st|nd|rd|th)?\\s+${MON_RE}|\\d{1,2}/\\d{1,2}(?:/\\d{2,4})?)`;
const TIME_RE = "(?:noon|midnight|\\d{1,2}(?::\\d{2})?\\s*(?:am|pm|a|p)?)";

// Does the locale write day before month (31/12)?
const DAY_FIRST = (() => {
  try {
    return new Date(2020, 11, 31).toLocaleDateString().startsWith("31");
  } catch {
    return false;
  }
})();

function weekdayIndex(word: string): number {
  return WD.indexOf(word.slice(0, 3).toLowerCase());
}

export function parseDatePhrase(phrase: string, now = new Date()): string | undefined {
  const p = phrase.toLowerCase().trim().replace(/\s+/g, " ");
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (p === "today" || p === "tonight") return isoDate(today);
  if (/^(tomorrow|tmrw?|tom)$/.test(p)) return isoDate(addDays(today, 1));
  if (p === "next week") return isoDate(addDays(weekStartOf(today), 7));
  let m = p.match(/^in (\d+) (day|week)s?$/);
  if (m) return isoDate(addDays(today, Number(m[1]) * (m[2] === "week" ? 7 : 1)));
  m = p.match(/^(next |this )?([a-z]+)$/);
  if (m && weekdayIndex(m[2]) >= 0) {
    const target = weekdayIndex(m[2]);
    let diff = (target - today.getDay() + 7) % 7;
    if (m[1] === "next ") {
      if (diff === 0) diff = 7;
      // "next fri" on a Monday means the Friday of next week.
      const sameWeek = isoDate(weekStartOf(addDays(today, diff))) === isoDate(weekStartOf(today));
      if (sameWeek) diff += 7;
    }
    return isoDate(addDays(today, diff));
  }
  m = p.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const fromParts = (month: number, day: number, year?: number) => {
    if (month < 0 || month > 11 || day < 1 || day > 31) return undefined;
    let d = new Date(year ?? today.getFullYear(), month, day);
    // No year given and the date has passed: assume next year.
    if (year === undefined && d < today) d = new Date(today.getFullYear() + 1, month, day);
    return isoDate(d);
  };
  m = p.match(/^([a-z]+) (\d{1,2})(?:st|nd|rd|th)?$/);
  if (m && MONTHS.indexOf(m[1].slice(0, 3)) >= 0) return fromParts(MONTHS.indexOf(m[1].slice(0, 3)), Number(m[2]));
  m = p.match(/^(\d{1,2})(?:st|nd|rd|th)? ([a-z]+)$/);
  if (m && MONTHS.indexOf(m[2].slice(0, 3)) >= 0) return fromParts(MONTHS.indexOf(m[2].slice(0, 3)), Number(m[1]));
  m = p.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    const year = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : undefined;
    return DAY_FIRST ? fromParts(b - 1, a, year) : fromParts(a - 1, b, year);
  }
  return undefined;
}

type T = { h: number; m: number; mer: "am" | "pm" | null };

function readTime(s: string): T | undefined {
  const t = s.toLowerCase().replace(/\s+/g, "");
  if (t === "noon") return { h: 12, m: 0, mer: "pm" };
  if (t === "midnight") return { h: 0, m: 0, mer: "am" };
  const m = t.match(/^(\d{1,2})(?::(\d{2}))?(am|pm|a|p)?$/);
  if (!m) return undefined;
  const h = Number(m[1]);
  const mi = Number(m[2] ?? 0);
  if (h > 23 || mi > 59) return undefined;
  const mer = m[3] ? (m[3][0] === "a" ? "am" : "pm") : null;
  if (mer && (h < 1 || h > 12)) return undefined;
  return { h, m: mi, mer };
}

function toMinutes(t: T, guessPm: boolean): number {
  let h = t.h;
  if (t.mer === "am") h = h % 12;
  else if (t.mer === "pm") h = (h % 12) + 12;
  else if (guessPm && h >= 1 && h <= 7) h += 12; // "at 3" means 3pm
  return h * 60 + t.m;
}

export function parseQuickAdd(input: string, now = new Date()): Parsed {
  let text = ` ${input} `;
  const out: Parsed = { title: "" };
  // Replace a match with spaces so later patterns can't reuse it.
  const take = (re: RegExp, fn: (m: RegExpExecArray) => boolean | void) => {
    const m = re.exec(text);
    if (!m) return;
    if (fn(m) === false) return;
    text = text.slice(0, m.index) + " ".repeat(m[0].length) + text.slice(m.index + m[0].length);
  };

  // Priority: !1 / p1 / !high (high) ... !3 / p3 / !low (low).
  take(/\s(!!!|!!|!(?:[123]|high|hi|med(?:ium)?|low|lo)|p[123])(?=\s)/i, (m) => {
    const v = m[1].toLowerCase();
    out.priority = /^(!!!|!1|p1|!high|!hi)$/.test(v) ? 3 : /^(!!|!2|p2|!med|!medium)$/.test(v) ? 2 : 1;
  });

  // Project: #name (letters, digits, - and _).
  take(/\s#([\p{L}\p{N}_-]+)(?=\s)/iu, (m) => {
    out.project = m[1];
  });

  // Weekly recurrence: "every mon", "every mon, wed and fri", "every weekday".
  take(new RegExp(`\\severy\\s+(weekdays?|weekends?|day|${WD_RE}(?:\\s*(?:,|and|&|\\+)\\s*${WD_RE})*)(?=\\s)`, "i"), (m) => {
    const v = m[1].toLowerCase();
    if (v.startsWith("weekday")) out.weekdays = [0, 1, 2, 3, 4];
    else if (v.startsWith("weekend")) out.weekdays = [5, 6];
    else if (v === "day") out.weekdays = [0, 1, 2, 3, 4, 5, 6];
    else {
      const days = v.split(/\s*(?:,|and|&|\+)\s*/).map((w) => (weekdayIndex(w) + 6) % 7);
      out.weekdays = [...new Set(days)].sort();
    }
  });

  // Deadline: "due fri", "by tomorrow".
  take(new RegExp(`\\s(?:due|by)\\s+(?:on\\s+)?(${DATE_RE})(?=\\s)`, "i"), (m) => {
    const d = parseDatePhrase(m[1], now);
    if (!d) return false;
    out.deadline = d;
  });

  // Time range: "3-4pm", "9:30 - 10:15", "from 2pm to 4pm".
  take(new RegExp(`\\s(?:from\\s+|at\\s+)?(${TIME_RE})\\s*(?:-|–|to|until)\\s*(${TIME_RE})(?=\\s)`, "i"), (m) => {
    const a = readTime(m[1]);
    const b = readTime(m[2]);
    if (!a || !b) return false;
    const explicit = /^(from|at)/i.test(m[0].trim()) || a.mer || b.mer || /:/.test(m[1] + m[2]);
    if (!explicit) return false;
    if (!a.mer && b.mer) {
      // "3-4pm": the start shares the end's meridiem unless that would put it after the end.
      const shared = toMinutes({ ...a, mer: b.mer }, false);
      a.mer = shared < toMinutes(b, false) ? b.mer : "am";
    }
    const start = toMinutes(a, !b.mer && !a.mer);
    let end = toMinutes(b, !b.mer);
    if (end <= start && !b.mer && end + 12 * 60 > start) end += 12 * 60;
    if (end <= start) return false;
    out.start = start;
    out.end = end;
  });

  // Single time: "at 3", "3pm", "15:30", "noon".
  if (out.start === undefined) {
    take(new RegExp(`\\s(?:at\\s+(${TIME_RE})|(\\d{1,2}(?::\\d{2})?\\s*(?:am|pm))|(\\d{1,2}:\\d{2})|(noon|midnight))(?=\\s)`, "i"), (m) => {
      const raw = m[1] ?? m[2] ?? m[3] ?? m[4];
      const t = readTime(raw);
      if (!t) return false;
      out.start = toMinutes(t, Boolean(m[1]) && !t.mer);
    });
  }

  // Duration: "45m", "1h", "1.5h", "1h30m", "for 2 hours".
  take(/\s(?:for\s+)?(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hours?)(?:\s*(\d+)\s*(?:m|min|mins|minutes?))?(?=\s)/i, (m) => {
    out.duration = Math.round(Number(m[1]) * 60 + Number(m[2] ?? 0));
  });
  if (out.duration === undefined) {
    take(/\s(?:for\s+)?(\d+)\s*(?:m|min|mins|minutes?)(?=\s)/i, (m) => {
      out.duration = Number(m[1]);
    });
  }

  // Date: "tomorrow", "fri", "next tue", "oct 12", "12/10", "in 3 days".
  take(new RegExp(`\\s(?:on\\s+)?(${DATE_RE})(?=\\s)`, "i"), (m) => {
    const d = parseDatePhrase(m[1], now);
    if (!d) return false;
    out.date = d;
    if (/tonight/i.test(m[1]) && out.start === undefined) out.start = 19 * 60;
  });

  if (out.start !== undefined && out.end === undefined && out.duration !== undefined) out.end = out.start + out.duration;
  if (out.start !== undefined && out.end !== undefined && out.duration === undefined) out.duration = out.end - out.start;

  out.title = text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s+(at|on|for|from|by|due)$/i, "")
    .replace(/^(at|on)\s+/i, "");
  return out;
}

// Match a '#name' against project names, ignoring case, spaces and dashes; prefix matches count.
export function matchProject<P extends { name: string }>(raw: string | undefined, projects: P[]): P | undefined {
  if (!raw) return undefined;
  const norm = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, "");
  const q = norm(raw);
  return projects.find((p) => norm(p.name) === q) ?? projects.find((p) => norm(p.name).startsWith(q));
}
