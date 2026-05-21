import { useCallback, useEffect, useRef, useState } from "react";

type Props = {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  id?: string;
};

function parseValue(v: string): string[] {
  const digits = v.replace(/[^0-9]/g, "").slice(0, 6).padEnd(6, "0");
  return digits.split("");
}

function toDisplay(digits: string[]): string {
  return `${digits[0]}${digits[1]}:${digits[2]}${digits[3]}:${digits[4]}${digits[5]}`;
}

function toValue(digits: string[]): string {
  const raw = digits.join("");
  return `${raw.slice(0, 2)}:${raw.slice(2, 4)}:${raw.slice(4, 6)}`;
}

/** Map cursor pos in display string to digit index (0-5), skip colons */
function posToIndex(pos: number): number {
  if (pos <= 1) return pos;
  if (pos <= 2) return 1;
  if (pos <= 4) return pos - 1;
  if (pos <= 5) return 4;
  return Math.min(pos - 2, 5);
}

function indexToPos(idx: number): number {
  if (idx <= 1) return idx;
  if (idx <= 3) return idx + 1;
  return idx + 2;
}

function nextSegmentIndex(idx: number): number {
  if (idx <= 1) return 2;
  if (idx <= 3) return 4;
  return 5;
}

function clampTimeDigits(digits: string[]): string[] {
  const next = [...digits];
  const hour = Math.min(Number(`${next[0]}${next[1]}`), 23);
  const minute = Math.min(Number(`${next[2]}${next[3]}`), 59);
  const second = Math.min(Number(`${next[4]}${next[5]}`), 59);
  return [
    String(Math.floor(hour / 10)),
    String(hour % 10),
    String(Math.floor(minute / 10)),
    String(minute % 10),
    String(Math.floor(second / 10)),
    String(second % 10)
  ];
}

export function TimeInput({ value, onChange, className, id }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [digits, setDigits] = useState<string[]>(() => parseValue(value));

  // Sync from parent
  useEffect(() => {
    const next = parseValue(value);
    const current = digits.join("");
    if (next.join("") !== current) {
      setDigits(next);
    }
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const syncCursor = useCallback((idx: number) => {
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      const pos = indexToPos(idx);
      el.setSelectionRange(pos, pos + 1);
    });
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      const el = e.currentTarget;
      const pos = el.selectionStart ?? 0;
      const idx = posToIndex(pos);

      if (e.key === "Tab" || e.key === "Enter" || e.key === "Escape") {
        return;
      }

      // Arrow keys — let default but re-sync after
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        const prev = Math.max(0, idx - 1);
        syncCursor(prev);
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        const next = Math.min(5, idx + 1);
        syncCursor(next);
        return;
      }
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        return;
      }

      // Home / End
      if (e.key === "Home") {
        e.preventDefault();
        syncCursor(0);
        return;
      }
      if (e.key === "End") {
        e.preventDefault();
        syncCursor(5);
        return;
      }

      // Backspace — reset current digit, or move backward across segments when already zero.
      if (e.key === "Backspace") {
        e.preventDefault();
        setDigits((prev) => {
          const next = [...prev];
          const targetIdx = next[idx] === "0" ? Math.max(0, idx - 1) : idx;
          next[targetIdx] = "0";
          onChange(toValue(next));
          syncCursor(targetIdx);
          return next;
        });
        return;
      }

      // Delete — reset current to placeholder
      if (e.key === "Delete") {
        e.preventDefault();
        setDigits((prev) => {
          const next = [...prev];
          next[idx] = "0";
          onChange(toValue(next));
          return next;
        });
        syncCursor(idx);
        return;
      }

      // Digit input
      if (e.key >= "0" && e.key <= "9") {
        e.preventDefault();
        setDigits((prev) => {
          const next = [...prev];
          const typed = parseInt(e.key, 10);
          const tensLimit = idx === 0 ? 2 : idx === 2 || idx === 4 ? 5 : 9;

          if ((idx === 0 || idx === 2 || idx === 4) && typed > tensLimit) {
            next[idx] = "0";
            next[idx + 1] = String(typed);
            const clamped = clampTimeDigits(next);
            onChange(toValue(clamped));
            syncCursor(nextSegmentIndex(idx));
            return clamped;
          }

          next[idx] = String(typed);
          const clamped = clampTimeDigits(next);
          onChange(toValue(clamped));
          syncCursor(idx + 1);
          return clamped;
        });
        return;
      }

      // Block everything else
      e.preventDefault();
    },
    [onChange, syncCursor]
  );

  // Prevent native cursor movement from messing up position
  const handleClick = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const pos = el.selectionStart ?? 0;
    const idx = posToIndex(pos);
    syncCursor(idx);
  }, [syncCursor]);

  const handleFocus = useCallback(() => {
    syncCursor(0);
  }, [syncCursor]);

  return (
    <input
      ref={inputRef}
      type="text"
      className={className}
      id={id}
      value={toDisplay(digits)}
      placeholder="00:00:00"
      maxLength={8}
      autoComplete="off"
      spellCheck={false}
      readOnly
      onKeyDown={handleKeyDown}
      onClick={handleClick}
      onFocus={handleFocus}
    />
  );
}
