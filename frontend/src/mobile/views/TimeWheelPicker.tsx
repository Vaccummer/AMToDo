import { useCallback, useEffect, useRef, useState } from "react";

type Props = {
  value: string;
  onChange: (value: string) => void;
  onClear?: () => void;
  clearLabel?: string;
  className?: string;
  id?: string;
};

const ITEM_H = 34;
const VIEWPORT_H = 100;
const VISIBLE = 3;
const PAD = VISIBLE;
const CENTER_OFFSET = (VIEWPORT_H - ITEM_H) / 2;

function parseValue(v: string): [number, number, number] {
  const parts = v.split(":").map(Number);
  return [
    Math.min(Math.max(parts[0] ?? 0, 0), 23),
    Math.min(Math.max(parts[1] ?? 0, 0), 59),
    Math.min(Math.max(parts[2] ?? 0, 0), 59),
  ];
}

function toValue(h: number, m: number, s: number): string {
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function scrollToIndex(el: HTMLElement, idx: number, smooth: boolean) {
  const top = idx * ITEM_H - CENTER_OFFSET;
  if (smooth) {
    el.scrollTo({ top, behavior: "smooth" });
  } else {
    el.scrollTop = top;
  }
}

function readIndex(el: HTMLElement): number {
  return Math.round((el.scrollTop + CENTER_OFFSET) / ITEM_H);
}

/* ── Scroll Column ── */

type ColumnProps = {
  count: number;
  value: number;
  onChange: (v: number) => void;
  opened: boolean;
};

function Column({ count, value, onChange, opened }: ColumnProps) {
  const ref = useRef<HTMLDivElement>(null);
  const scrolling = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Scroll to initial position when popup opens
  useEffect(() => {
    const el = ref.current;
    if (!el || !opened) return;
    scrollToIndex(el, PAD + value, false);
  }, [opened]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll when value changes externally (e.g. from "Now" button)
  useEffect(() => {
    const el = ref.current;
    if (!el || !opened || scrolling.current) return;
    scrollToIndex(el, PAD + value, true);
  }, [value, opened]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    scrolling.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      scrolling.current = false;
      const idx = readIndex(el);
      const clamped = Math.max(0, Math.min(count - 1, idx - PAD));
      scrollToIndex(el, PAD + clamped, true);
      onChange(clamped);
    }, 80);
  }, [count, onChange]);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return (
    <div className="twp-column" ref={ref} onScroll={handleScroll}>
      {Array.from({ length: PAD }, (_, i) => (
        <div key={`p-${i}`} className="twp-item twp-item--pad" />
      ))}
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={`twp-item${i === value ? " twp-item--selected" : ""}`}>
          {pad2(i)}
        </div>
      ))}
      {Array.from({ length: PAD }, (_, i) => (
        <div key={`b-${i}`} className="twp-item twp-item--pad" />
      ))}
    </div>
  );
}

/* ── Main Picker ── */

export function TimeWheelPicker({ value, onChange, onClear, clearLabel = "Clear", className, id }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<[number, number, number]>(() => parseValue(value));
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync draft when value changes externally
  useEffect(() => {
    if (!open) {
      setDraft(parseValue(value));
    }
  }, [value, open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    const timer = setTimeout(() => {
      window.addEventListener("click", handleClick);
    }, 0);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("click", handleClick);
    };
  }, [open]);

  function handleOpen() {
    setDraft(parseValue(value));
    setOpen(true);
  }

  function handleConfirm() {
    onChange(toValue(draft[0], draft[1], draft[2]));
    setOpen(false);
  }

  function handleNow() {
    const now = new Date();
    setDraft([now.getHours(), now.getMinutes(), now.getSeconds()]);
  }

  function handleClear() {
    onClear?.();
    setOpen(false);
  }

  const handleColumnChange = useCallback(
    (which: "h" | "m" | "s", v: number) => {
      setDraft((prev) => {
        const next: [number, number, number] = [...prev];
        if (which === "h") next[0] = v;
        else if (which === "m") next[1] = v;
        else next[2] = v;
        return next;
      });
    },
    []
  );

  const display = value || "00:00:00";

  return (
    <div className={`twp-picker${className ? ` ${className}` : ""}`} id={id} ref={containerRef}>
      <div
        className={`twp-picker-field${open ? " open" : ""}`}
        onClick={handleOpen}
        tabIndex={0}
        role="combobox"
        aria-expanded={open}
      >
        <svg
          className="twp-picker-icon"
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        <span className="twp-picker-text">{display}</span>
        <svg
          className={`twp-picker-chevron${open ? " open" : ""}`}
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>

      {open ? (
        <div className="twp-popup">
          <div className="twp-popup-inner">
            <div className="twp-highlight" />
            <Column count={24} value={draft[0]} onChange={(v) => handleColumnChange("h", v)} opened={open} />
            <span className="twp-sep">:</span>
            <Column count={60} value={draft[1]} onChange={(v) => handleColumnChange("m", v)} opened={open} />
            <span className="twp-sep">:</span>
            <Column count={60} value={draft[2]} onChange={(v) => handleColumnChange("s", v)} opened={open} />
          </div>
          <div className="twp-popup-actions">
            {onClear ? (
              <button type="button" className="twp-btn twp-btn-clear" onClick={handleClear}>
                {clearLabel}
              </button>
            ) : null}
            <button type="button" className="twp-btn twp-btn-now" onClick={handleNow}>
              Now
            </button>
            <button type="button" className="twp-btn twp-btn-confirm" onClick={handleConfirm}>
              OK
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
