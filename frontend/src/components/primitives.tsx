import {
  CSSProperties, ReactNode, useEffect, useLayoutEffect, useRef, useState,
} from "react";
import { createPortal } from "react-dom";
import { Icon, IconName } from "./Icon";
import { dismissToast, toasts } from "../lib/toast";

// ---------- Overlay stack: Escape closes only the topmost overlay ----------

const stack: number[] = [];
let overlaySeq = 0;

function useOverlay(onClose: () => void) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const id = ++overlaySeq;
    stack.push(id);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && stack[stack.length - 1] === id) {
        e.preventDefault();
        e.stopPropagation();
        closeRef.current();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      stack.splice(stack.indexOf(id), 1);
    };
  }, []);
}

// ---------- Dialog / drawer / bottom sheet ----------

// Centred dialog on desktop; a bottom sheet on phones. variant "drawer" docks to the right.
export function Dialog({ onClose, children, label, variant = "dialog", className = "", initialFocus = true }: {
  onClose: () => void;
  children: ReactNode;
  label: string;
  variant?: "dialog" | "drawer" | "palette";
  className?: string;
  initialFocus?: boolean;
}) {
  useOverlay(onClose);
  const ref = useRef<HTMLDivElement>(null);
  const restore = useRef<HTMLElement | null>(null);

  useEffect(() => {
    restore.current = document.activeElement as HTMLElement | null;
    // Respect a child that focused itself (autoFocus); otherwise prefer a text field over a button.
    if (initialFocus && !ref.current?.contains(document.activeElement)) {
      const el = ref.current;
      const target = el?.querySelector<HTMLElement>("[data-autofocus]")
        ?? el?.querySelector<HTMLElement>("input:not([type=hidden]), textarea")
        ?? el?.querySelector<HTMLElement>("button");
      target?.focus({ preventScroll: true });
    }
    document.body.classList.add("has-overlay");
    return () => {
      document.body.classList.remove("has-overlay");
      restore.current?.focus?.({ preventScroll: true });
    };
  }, [initialFocus]);

  // Keep Tab inside the dialog.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !ref.current) return;
    const items = [...ref.current.querySelectorAll<HTMLElement>(
      "a[href], button:not([disabled]), input:not([disabled]), textarea, select, [tabindex]:not([tabindex='-1'])",
    )].filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  return createPortal(
    <div className={`overlay overlay-${variant}`} data-overlay onPointerDown={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}>
      <div ref={ref} className={`sheet sheet-${variant} ${className}`} role="dialog" aria-modal="true"
        aria-label={label} onKeyDown={onKeyDown}>
        {variant !== "palette" && <div className="sheet-grabber" aria-hidden="true" />}
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function SheetHeader({ title, onClose, children }: { title: ReactNode; onClose: () => void; children?: ReactNode }) {
  return (
    <div className="sheet-head">
      <h2 className="sheet-title">{title}</h2>
      <div className="sheet-head-actions">
        {children}
        <IconButton icon="close" label="Close" onClick={onClose} />
      </div>
    </div>
  );
}

// ---------- Popover anchored to a rect ----------

export type Anchor = { x: number; y: number; w?: number; h?: number };

export function Popover({ anchor, onClose, children, className = "", placement = "bottom", width }: {
  anchor: Anchor;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  placement?: "bottom" | "right";
  width?: number;
}) {
  useOverlay(onClose);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<CSSProperties>({ opacity: 0, left: 0, top: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const aw = anchor.w ?? 0;
    const ah = anchor.h ?? 0;
    const m = 8;
    let left: number;
    let top: number;
    if (placement === "right") {
      left = anchor.x + aw + m;
      if (left + r.width > vw - m) left = anchor.x - r.width - m;
      top = anchor.y;
    } else {
      left = anchor.x;
      top = anchor.y + ah + 6;
      if (top + r.height > vh - m) top = anchor.y - r.height - 6;
    }
    left = Math.max(m, Math.min(left, vw - r.width - m));
    top = Math.max(m, Math.min(top, vh - r.height - m));
    setPos({ left, top });
  }, [anchor.x, anchor.y, anchor.w, anchor.h, placement]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    // Defer so the click that opened the popover doesn't close it.
    const t = window.setTimeout(() => window.addEventListener("pointerdown", onDown, true), 0);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [onClose]);

  return createPortal(
    <div ref={ref} className={"popover " + className} data-overlay style={{ ...pos, width }} role="dialog">
      {children}
    </div>,
    document.body,
  );
}

export function anchorOf(el: Element): Anchor {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

// ---------- Menu ----------

export type MenuItem =
  | { label: string; icon?: IconName; onSelect: () => void; danger?: boolean; hint?: string; checked?: boolean }
  | "divider";

export function Menu({ anchor, items, onClose }: { anchor: Anchor; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("button")?.focus();
  }, []);
  const onKeyDown = (e: React.KeyboardEvent) => {
    const buttons = [...(ref.current?.querySelectorAll<HTMLElement>("button") ?? [])];
    const i = buttons.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") { e.preventDefault(); buttons[(i + 1) % buttons.length]?.focus(); }
    if (e.key === "ArrowUp") { e.preventDefault(); buttons[(i - 1 + buttons.length) % buttons.length]?.focus(); }
  };
  return (
    <Popover anchor={anchor} onClose={onClose} className="menu">
      <div ref={ref} role="menu" onKeyDown={onKeyDown}>
        {items.map((item, i) => item === "divider" ? <div key={i} className="menu-divider" /> : (
          <button key={i} role="menuitem" className={"menu-item" + (item.danger ? " danger" : "")}
            onClick={() => { onClose(); item.onSelect(); }}>
            {item.icon && <Icon name={item.icon} size={16} />}
            <span className="grow">{item.label}</span>
            {item.checked && <Icon name="check" size={15} />}
            {item.hint && <kbd>{item.hint}</kbd>}
          </button>
        ))}
      </div>
    </Popover>
  );
}

// ---------- Small pieces ----------

export function IconButton({ icon, label, onClick, className = "", size = 18, active, disabled, shortcut }: {
  icon: IconName; label: string; onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  className?: string; size?: number; active?: boolean; disabled?: boolean; shortcut?: string;
}) {
  return (
    <button type="button" className={"icon-btn " + className + (active ? " active" : "")} aria-label={label}
      title={shortcut ? `${label} (${shortcut})` : label} onClick={onClick} disabled={disabled}
      aria-pressed={active === undefined ? undefined : active}>
      <Icon name={icon} size={size} />
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label, size }: {
  value: T; options: { value: T; label: string; hint?: string }[]; onChange: (v: T) => void; label: string;
  size?: "sm";
}) {
  return (
    <div className={"segmented" + (size ? " " + size : "")} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value}
          className={value === o.value ? "on" : ""} onClick={() => onChange(o.value)}
          title={o.hint ? `${o.label} (${o.hint})` : o.label}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

const PRIORITY_CLASS = ["", "p-low", "p-med", "p-high"];

export function TaskCheck({ done, priority = 0, onToggle, label }: {
  done: boolean; priority?: number; onToggle: () => void; label: string;
}) {
  return (
    <button type="button" className={"task-check " + PRIORITY_CLASS[priority] + (done ? " done" : "")}
      role="checkbox" aria-checked={done} aria-label={label}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onToggle(); }}>
      <Icon name="check" size={12} strokeWidth={3} />
    </button>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function Empty({ icon, title, children }: { icon: IconName; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon"><Icon name={icon} size={22} /></div>
      <strong>{title}</strong>
      {children && <div className="empty-body">{children}</div>}
    </div>
  );
}

export function Toaster() {
  const list = toasts.use();
  return createPortal(
    <div className="toaster" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={"toast " + t.tone} role={t.tone === "error" ? "alert" : "status"}>
          {t.tone === "success" && <Icon name="check" size={16} />}
          <span className="toast-msg">{t.message}</span>
          {t.action && (
            <button className="toast-action" onClick={() => { t.action!.run(); dismissToast(t.id); }}>
              {t.action.label}
            </button>
          )}
          <button className="toast-x" aria-label="Dismiss" onClick={() => dismissToast(t.id)}>
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}

export const PROJECT_COLORS = [
  "#5b5bd6", "#2f7ff0", "#0e9f8e", "#2f9e5b", "#84a31c", "#d98a1c", "#e5603b", "#e5487a", "#8e4ec6", "#7c8597",
];

export function ColorPicker({ value, onChange, label = "Colour" }: { value: string; onChange: (c: string) => void; label?: string }) {
  return (
    <div className="color-picker" role="radiogroup" aria-label={label}>
      {PROJECT_COLORS.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={value.toLowerCase() === c}
          aria-label={c} className={"swatch-btn" + (value.toLowerCase() === c ? " on" : "")}
          style={{ "--c": c } as CSSProperties} onClick={() => onChange(c)} />
      ))}
    </div>
  );
}
