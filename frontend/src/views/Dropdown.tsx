import { useEffect, useMemo, useRef, useState } from "react";

type Option = { value: string; label: string; hasValue?: boolean };

type Props = {
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  id?: string;
  searchable?: boolean;
};

export function Dropdown({ value, options, onChange, id, searchable }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selectedLabel = options.find((o) => o.value === value)?.label ?? value;

  const filtered = useMemo(() => {
    if (!query) return options;
    const q = query.toLowerCase();
    return options.filter(
      (o) => o.value.toLowerCase().includes(q) || o.label.toLowerCase().includes(q),
    );
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    setQuery("");
    if (searchable) setTimeout(() => searchRef.current?.focus(), 0);
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open]);

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

  return (
    <div className="dropdown" ref={containerRef}>
      <button
        type="button"
        className="dropdown-trigger"
        id={id}
        onClick={() => setOpen(!open)}
      >
        <span className="dropdown-trigger-text">{selectedLabel}</span>
        <svg
          className={`dropdown-chevron${open ? " open" : ""}`}
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open ? (
        <div className="dropdown-panel">
          {searchable && (
            <div className="dropdown-search">
              <input
                ref={searchRef}
                type="text"
                className="dropdown-search-input"
                placeholder="搜索…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
              />
            </div>
          )}
          {filtered.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`dropdown-option${opt.value === value ? " selected" : ""}${opt.hasValue ? " has-value" : ""}`}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
            >
              {opt.hasValue && <span className="dropdown-option-dot" />}
              {opt.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
