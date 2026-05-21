import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../i18n";

type Option = { value: string; label: string; hasValue?: boolean };

type Props = {
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  id?: string;
  searchable?: boolean;
};

export function Dropdown({ value, options, onChange, id, searchable }: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [panelStyle, setPanelStyle] = useState<React.CSSProperties>({});

  const selectedLabel = options.find((o) => o.value === value)?.label ?? value;

  const filtered = useMemo(() => {
    if (!query) return options;
    const q = query.toLowerCase();
    return options.filter(
      (o) => o.value.toLowerCase().includes(q) || o.label.toLowerCase().includes(q),
    );
  }, [options, query]);

  // Compute fixed position for portaled panel
  useEffect(() => {
    if (!open) return;
    function updatePosition() {
      const trigger = containerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const PANEL_MAX = 220;
      const spaceBelow = window.innerHeight - rect.bottom - 8;
      const spaceAbove = rect.top - 8;
      const flip = spaceBelow < PANEL_MAX && spaceAbove > spaceBelow;
      setPanelStyle({
        position: "fixed",
        top: flip ? rect.top - 4 - Math.min(PANEL_MAX, spaceAbove) : rect.bottom + 4,
        left: rect.left,
        width: rect.width,
        zIndex: 10000,
        maxHeight: flip ? Math.min(PANEL_MAX, spaceAbove) : Math.min(PANEL_MAX, spaceBelow),
      });
    }
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

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
      const target = e.target as Node;
      if (containerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    }
    const timer = setTimeout(() => {
      window.addEventListener("click", handleClick);
    }, 0);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("click", handleClick);
    };
  }, [open]);

  const panel = open ? (
    <div className="dropdown-panel" ref={panelRef} style={panelStyle}>
      {searchable && (
        <div className="dropdown-search">
          <input
            ref={searchRef}
            type="text"
            className="dropdown-search-input"
            placeholder={t("common.search") + "…"}
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
  ) : null;

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
      {panel ? createPortal(panel, document.body) : null}
    </div>
  );
}
