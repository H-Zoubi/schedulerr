import { memo, useEffect, useState } from "react";
import { IconButton } from "../../components/primitives";
import { addDays, isoDate, monthTitle, parseDate, todayIso, weekStartOf } from "../../dates";
import { usePrefs } from "../../lib/prefs";

// Compact month for jumping around. Highlights the visible range and days that have something on.
export const MiniMonth = memo(function MiniMonth({ selected, rangeStart, rangeEnd, busy, onPick }: {
  selected: string;
  rangeStart: string;
  rangeEnd: string;
  busy: Set<string>;
  onPick: (date: string) => void;
}) {
  const { weekStart } = usePrefs();
  const [month, setMonth] = useState(() => {
    const d = parseDate(selected);
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  // Follow the main calendar when it moves to another month.
  useEffect(() => {
    const d = parseDate(selected);
    setMonth((m) => (m.getFullYear() === d.getFullYear() && m.getMonth() === d.getMonth() ? m : new Date(d.getFullYear(), d.getMonth(), 1)));
  }, [selected]);

  const start = weekStartOf(month, weekStart);
  const today = todayIso();
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const names = Array.from({ length: 7 }, (_, i) => addDays(start, i).toLocaleDateString(undefined, { weekday: "narrow" }));

  return (
    <div className="mini-month">
      <div className="mini-head">
        <strong>{monthTitle(month)}</strong>
        <div className="row-gap tight">
          <IconButton icon="chevronLeft" size={16} label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} />
          <IconButton icon="chevronRight" size={16} label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} />
        </div>
      </div>
      <div className="mini-grid" role="grid">
        {names.map((n, i) => <span key={i} className="mini-dow">{n}</span>)}
        {days.map((d) => {
          const iso = isoDate(d);
          const cls = ["mini-day"];
          if (d.getMonth() !== month.getMonth()) cls.push("out");
          if (iso === today) cls.push("today");
          if (iso >= rangeStart && iso <= rangeEnd) cls.push("in-range");
          if (iso === selected) cls.push("selected");
          return (
            <button key={iso} className={cls.join(" ")} onClick={() => onPick(iso)} aria-label={d.toDateString()}>
              {d.getDate()}
              {busy.has(iso) && <span className="mini-dot" />}
            </button>
          );
        })}
      </div>
    </div>
  );
});
