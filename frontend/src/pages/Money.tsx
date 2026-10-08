import { useMemo, useState } from "react";
import { Spending } from "../api";
import { Dialog, Empty, IconButton, SheetHeader } from "../components/primitives";
import { Icon } from "../components/Icon";
import { createSpending, deleteSpending, money, updateSpending, useData } from "../store";
import { openQuickAdd } from "../lib/ui";
import { parseDate, relDay, todayIso } from "../dates";
import { usePrefs } from "../lib/prefs";

type DayGroup = { day: string; items: Spending[]; total: number };

export function Money() {
  const spendings = useData((s) => s.spendings);
  const { currency } = usePrefs();
  const [editing, setEditing] = useState<Spending | null>(null);

  const { groups, monthTotal, dayTotal } = useMemo(() => {
    const today = todayIso();
    const month = today.slice(0, 7);
    const sorted = [...spendings].sort((a, b) =>
      b.spent_on.localeCompare(a.spent_on) || b.created_at.localeCompare(a.created_at) || b.id - a.id);
    const groups: DayGroup[] = [];
    let monthTotal = 0;
    let dayTotal = 0;
    for (const sp of sorted) {
      if (sp.spent_on.slice(0, 7) === month) {
        monthTotal += sp.amount_cents;
        if (sp.spent_on === today) dayTotal += sp.amount_cents;
      }
      const last = groups[groups.length - 1];
      if (last && last.day === sp.spent_on) {
        last.items.push(sp);
        last.total += sp.amount_cents;
      } else {
        groups.push({ day: sp.spent_on, items: [sp], total: sp.amount_cents });
      }
    }
    return { groups, monthTotal, dayTotal };
  }, [spendings]);

  return (
    <div className="page money-page">
      <div className="money-head">
        <div>
          <p className="page-sub">Spent this month</p>
          <h1 className="money-total">{money(monthTotal)}</h1>
          <p className="muted small">Today {money(dayTotal)}</p>
        </div>
        <button className="btn primary sm" onClick={() => openQuickAdd({ mode: "spend" })}>
          <Icon name="plus" size={15} /> Log spending
        </button>
      </div>

      {!currency.trim() && (
        <p className="muted small money-currency-hint">
          No currency set. Pick a symbol in Settings to show one next to amounts.
        </p>
      )}

      {groups.length === 0 ? (
        <Empty icon="wallet" title="Nothing logged yet">
          Press <strong>S</strong> anywhere (or the + button) and type
          <div className="muted"><code>coffee 4.5</code> — that's it.</div>
        </Empty>
      ) : (
        <div className="money-list">
          {groups.map((g) => (
            <section key={g.day} className="money-day">
              <h2 className="money-day-head">
                <span>{relDay(g.day)}</span>
                <span className="money-day-total">{money(g.total)}</span>
              </h2>
              {g.items.map((sp) => (
                <div key={sp.id} className="money-row card">
                  <div className="money-note">
                    <span>{sp.note || "Spending"}</span>
                    {sp.tag && <span className="chip-static"><Icon name="hash" size={12} /> {sp.tag}</span>}
                  </div>
                  <span className="money-amount">{money(sp.amount_cents)}</span>
                  <IconButton icon="edit" label="Edit spending" onClick={() => setEditing(sp)} />
                </div>
              ))}
            </section>
          ))}
        </div>
      )}

      <button className="fab" aria-label="Log spending" onClick={() => openQuickAdd({ mode: "spend" })}>
        <Icon name="plus" size={24} strokeWidth={2.2} />
      </button>

      {editing && <EditSpending spending={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function EditSpending({ spending, onClose }: { spending: Spending; onClose: () => void }) {
  const [amount, setAmount] = useState((spending.amount_cents / 100).toFixed(2).replace(/\.00$/, ""));
  const [note, setNote] = useState(spending.note);
  const [tag, setTag] = useState(spending.tag);
  const [day, setDay] = useState(spending.spent_on);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const cents = Math.round(parseFloat(amount.replace(",", ".")) * 100);
    if (!cents || cents <= 0) return;
    updateSpending(spending.id, { amount_cents: cents, note: note.trim(), tag: tag.trim().replace(/^#/, ""), spent_on: day });
    onClose();
  }

  return (
    <Dialog onClose={onClose} label="Edit spending">
      <SheetHeader title="Edit spending" onClose={onClose} />
      <form className="form" onSubmit={submit}>
        <div className="field">
          <span>Amount</span>
          <input inputMode="decimal" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount" />
        </div>
        <label className="field">
          <span>Note</span>
          <input value={note} placeholder="Coffee, lunch…" onChange={(e) => setNote(e.target.value)} />
        </label>
        <label className="field">
          <span>Tag</span>
          <input value={tag} placeholder="cafe" onChange={(e) => setTag(e.target.value)} />
        </label>
        <label className="field">
          <span>Day</span>
          <input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
        </label>
        <div className="form-actions">
          <button type="button" className="btn ghost danger"
            onClick={() => { deleteSpending(spending); onClose(); }}>
            <Icon name="trash" size={14} /> Delete
          </button>
          <span className="grow" />
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!amount}>Save</button>
        </div>
      </form>
    </Dialog>
  );
}
