import { useEffect, useRef } from "react";

export type MenuItem = {
  label: string;
  icon: React.ReactNode;
  action: () => void;
  danger?: boolean;
};

type Props = {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
};

function TrashIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

export function ContextMenu({ x, y, items, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("mousedown", handleClick, true);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("mousedown", handleClick, true);
      window.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  return (
    <div className="context-menu" ref={menuRef} style={{ left: x, top: y }}>
      {items.map((item, i) => (
        <button
          key={i}
          type="button"
          className={`context-menu-item${item.danger ? " danger" : ""}`}
          onClick={() => {
            item.action();
            onClose();
          }}
        >
          <span className="context-menu-icon">{item.icon}</span>
          <span className="context-menu-label">{item.label}</span>
        </button>
      ))}
    </div>
  );
}

export { TrashIcon };
