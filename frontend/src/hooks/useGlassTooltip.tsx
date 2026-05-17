import { useState, useCallback, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";

export type GlassTooltipPosition = { top: number; left: number };

export function useGlassTooltip() {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState<GlassTooltipPosition>({ top: 0, left: 0 });
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const show = useCallback((rect: DOMRect) => {
    clearTimeout(hideTimer.current);
    setAnchor(rect);
    setPos({ top: rect.top, left: 0 });
    setVisible(true);
  }, []);

  const hide = useCallback(() => {
    hideTimer.current = setTimeout(() => setVisible(false), 80);
  }, []);

  const keepVisible = useCallback(() => {
    clearTimeout(hideTimer.current);
  }, []);

  const adjustPos = useCallback((tooltipWidth: number, tooltipHeight: number) => {
    setPos((prev) => {
      if (!anchor) return prev;
      const left = anchor.left - tooltipWidth - 8;
      const maxTop = window.innerHeight - tooltipHeight - 8;
      const top = Math.min(Math.max(4, prev.top), maxTop);
      return { top, left: Math.max(4, left) };
    });
  }, [anchor]);

  return { visible, pos, anchor, show, hide, keepVisible, adjustPos };
}

type GlassTooltipContent = {
  dotColor: string;
  title: string;
  id: number;
  fields: { icon: string; label: string; value: string }[];
};

export function GlassTooltip({
  visible,
  pos,
  content,
  onMouseEnter,
  onMouseLeave,
  onMeasure,
}: {
  visible: boolean;
  pos: GlassTooltipPosition;
  content: GlassTooltipContent;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onMeasure?: (width: number, height: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (visible && ref.current && onMeasure) {
      onMeasure(ref.current.offsetWidth, ref.current.offsetHeight);
    }
  }, [visible, onMeasure]);

  if (!visible) return null;

  return createPortal(
    <div
      className="glass-tooltip"
      ref={ref}
      style={{ top: pos.top, left: pos.left }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="glass-tooltip-header">
        <span className="glass-tooltip-dot" style={{ background: content.dotColor }} />
        <span className="glass-tooltip-title">{content.title}</span>
        <span className="glass-tooltip-tag">#{content.id}</span>
      </div>
      <div className="glass-tooltip-fields">
        {content.fields.filter((f) => f.value && f.value !== "-").map((f, i) => (
          <div className="glass-tooltip-field" key={i}>
            <span className="glass-tooltip-field-icon">{f.icon}</span>
            <div className="glass-tooltip-field-content">
              <span className="glass-tooltip-field-label">{f.label}</span>
              <span className="glass-tooltip-field-value">{f.value}</span>
            </div>
          </div>
        ))}
      </div>
    </div>,
    document.body
  );
}
