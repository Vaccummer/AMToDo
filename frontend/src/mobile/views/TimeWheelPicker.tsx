import { useCallback, useEffect, useRef } from "react";

type Props = {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  id?: string;
};

const ITEM_H = 40;
const VISIBLE = 3; // items visible above + below center
const PAD = VISIBLE; // blank padding items at each end

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
  const top = idx * ITEM_H;
  if (smooth) {
    el.scrollTo({ top, behavior: "smooth" });
  } else {
    el.scrollTop = top;
  }
}

function readIndex(el: HTMLElement): number {
  return Math.round(el.scrollTop / ITEM_H);
}

type ColumnProps = {
  count: number;
  value: number;
  onChange: (v: number) => void;
};

function Column({ count, value, onChange }: ColumnProps) {
  const ref = useRef<HTMLDivElement>(null);
  const scrolling = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync from parent
  useEffect(() => {
    const el = ref.current;
    if (!el || scrolling.current) return;
    scrollToIndex(el, PAD + value, false);
  }, [value]);

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
      {/* top padding */}
      {Array.from({ length: PAD }, (_, i) => (
        <div key={`p-${i}`} className="twp-item twp-item--pad" />
      ))}
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={`twp-item${i === value ? " twp-item--selected" : ""}`}>
          {pad2(i)}
        </div>
      ))}
      {/* bottom padding */}
      {Array.from({ length: PAD }, (_, i) => (
        <div key={`b-${i}`} className="twp-item twp-item--pad" />
      ))}
    </div>
  );
}

export function TimeWheelPicker({ value, onChange, className, id }: Props) {
  const [h, m, s] = parseValue(value);

  const handleChange = useCallback(
    (which: "h" | "m" | "s", v: number) => {
      const [ch, cm, cs] = parseValue(value);
      const next = which === "h" ? [v, cm, cs] : which === "m" ? [ch, v, cs] : [ch, cm, v];
      onChange(toValue(next[0], next[1], next[2]));
    },
    [value, onChange]
  );

  return (
    <div className={`twp${className ? ` ${className}` : ""}`} id={id}>
      <div className="twp-highlight" />
      <Column count={24} value={h} onChange={(v) => handleChange("h", v)} />
      <span className="twp-sep">:</span>
      <Column count={60} value={m} onChange={(v) => handleChange("m", v)} />
      <span className="twp-sep">:</span>
      <Column count={60} value={s} onChange={(v) => handleChange("s", v)} />
    </div>
  );
}
