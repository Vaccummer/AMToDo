import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n";

export type ConfirmConfig = {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
};

type Props = ConfirmConfig & {
  open: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: Props) {
  const { t } = useI18n();
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) confirmRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="confirm-backdrop" onClick={onCancel}>
      <div
        className="confirm-card"
        role="dialog"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="confirm-icon-wrap">
          {danger ? (
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#c62f2f" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#f0a030" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          )}
        </div>

        <h3 className="confirm-title">{title}</h3>
        <p className="confirm-message">{message}</p>

        <div className="confirm-actions">
          <button
            ref={confirmRef}
            type="button"
            className={`confirm-btn ${danger ? "confirm-btn-danger" : "confirm-btn-primary"}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? t("common.processing") : (confirmLabel ?? t("common.confirm"))}
          </button>
          <button
            type="button"
            className="confirm-btn confirm-btn-cancel"
            onClick={onCancel}
            disabled={busy}
          >
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * useConfirm — drop-in replacement for window.confirm.
 *
 *     const { ask, dialog } = useConfirm();
 *     // …
 *     const ok = await ask({ title: "删除", message: "不可撤销", danger: true });
 *     if (!ok) return;
 *     // … render {dialog} somewhere in the component tree
 */
export function useConfirm() {
  const [config, setConfig] = useState<ConfirmConfig | null>(null);
  const resolveRef = useRef<((v: boolean) => void) | null>(null);

  const ask = useCallback(
    (c: ConfirmConfig): Promise<boolean> =>
      new Promise((resolve) => {
        resolveRef.current = resolve;
        setConfig(c);
      }),
    []
  );

  function handleConfirm() {
    resolveRef.current?.(true);
    resolveRef.current = null;
    setConfig(null);
  }

  function handleCancel() {
    resolveRef.current?.(false);
    resolveRef.current = null;
    setConfig(null);
  }

  const dialog = (
    <ConfirmDialog
      open={config !== null}
      title={config?.title ?? ""}
      message={config?.message ?? ""}
      confirmLabel={config?.confirmLabel}
      danger={config?.danger}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  );

  return { ask, dialog };
}
