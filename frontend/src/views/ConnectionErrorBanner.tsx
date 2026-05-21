import type { ConnectionStatusSnapshot, UnifiedStatus } from "../api/connection-status";
import { useI18n } from "../i18n";

type Props = {
  snapshot: ConnectionStatusSnapshot;
  variant: "full-page" | "bar";
  serverUrl?: string;
  onOpenSettings?: (focusTarget?: "url" | "token") => void;
  onRetry?: () => void;
};

/** Translate snapshot error messages that are stored as i18n keys. */
function translateError(msg: string | null, t: (key: string, params?: Record<string, string | number>) => string): string | null {
  if (!msg) return null;
  if (msg.includes(".") && !msg.includes(" ")) {
    const translated = t(msg);
    return translated !== msg ? translated : msg;
  }
  return msg;
}

/** Returns null when status is healthy — caller should render nothing. */
function resolve(status: UnifiedStatus, t: (key: string, params?: Record<string, string | number>) => string) {
  switch (status) {
    case "online":
    case "idle":
    case "checking":
      return null;
    case "reconnecting":
      return {
        color: "bad" as const,
        title: t("connection.reconnecting"),
        desc: t("connection.reconnectingDesc"),
        btnLabel: t("connection.checkSettings"),
        focusTarget: "url" as const,
      };
    case "offline":
      return {
        color: "net" as const,
        title: t("connection.cannotConnect"),
        desc: t("connection.cannotConnectDesc"),
        btnLabel: t("connection.checkSettings"),
        focusTarget: "url" as const,
      };
    case "token-error":
      return {
        color: "tok" as const,
        title: t("connection.authFailed"),
        desc: t("connection.authFailedDesc"),
        btnLabel: t("connection.updateToken"),
        focusTarget: "token" as const,
      };
    case "fingerprint":
      return {
        color: "fp" as const,
        title: t("connection.fingerprintMismatch"),
        desc: t("connection.fingerprintMismatchDesc"),
        btnLabel: t("connection.viewDetails"),
        focusTarget: "url" as const,
      };
    case "key-mismatch":
      return {
        color: "fp" as const,
        title: t("connection.keyMismatch"),
        desc: t("connection.keyMismatchDesc"),
        btnLabel: t("connection.checkSettings"),
        focusTarget: "url" as const,
      };
    case "replay-detected":
      return {
        color: "net" as const,
        title: t("connection.replayDetected"),
        desc: t("connection.replayDetectedDesc"),
        btnLabel: t("connection.checkSettings"),
        focusTarget: "url" as const,
      };
    default:
      return null;
  }
}

// ── SVG Icons ──

function WifiOffIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M1 1l22 22M16.72 11.06A10.94 10.94 0 0 1 19 12.55M5 12.55a10.94 10.94 0 0 1 5.17-2.39M10.71 5.05A16 16 0 0 1 22.56 9M1.42 9a15.91 15.91 0 0 1 4.7-2.88M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01" />
    </svg>
  );
}

function AlertTriangleIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function iconForColor(color: string) {
  switch (color) {
    case "net": return <WifiOffIcon />;
    case "bad": return <AlertTriangleIcon />;
    case "fp":  return <ShieldIcon />;
    case "tok": return <LockIcon />;
    default:    return <WifiOffIcon />;
  }
}

// ── Full-page variant ──

function FullPageBanner({ info, snapshot, serverUrl, onOpenSettings, onRetry, translatedError }: {
  info: NonNullable<ReturnType<typeof resolve>>;
  snapshot: ConnectionStatusSnapshot;
  serverUrl?: string;
  onOpenSettings?: (focusTarget?: "url" | "token") => void;
  onRetry?: () => void;
  translatedError?: string | null;
}) {
  const handleClick = () => {
    if (onOpenSettings) {
      onOpenSettings(info.focusTarget);
    } else {
      onRetry?.();
    }
  };

  const desc = translatedError || info.desc;

  return (
    <div className={`conn-error-fullpage conn-error-${info.color}`}>
      <div className="conn-error-fullpage-icon">
        {iconForColor(info.color)}
      </div>
      <p className="conn-error-fullpage-title">{info.title}</p>
      <p className="conn-error-fullpage-desc">{desc}</p>
      {info.color === "net" && serverUrl && (
        <p className="conn-error-fullpage-url">{serverUrl}</p>
      )}
      <button type="button" className="conn-error-fullpage-btn" onClick={handleClick}>
        {info.btnLabel}
      </button>
    </div>
  );
}

// ── Bar variant (schedule, Style A from demo) ──

function BarBanner({ info, snapshot, onOpenSettings, onRetry, translatedError }: {
  info: NonNullable<ReturnType<typeof resolve>>;
  snapshot: ConnectionStatusSnapshot;
  onOpenSettings?: (focusTarget?: "url" | "token") => void;
  onRetry?: () => void;
  translatedError?: string | null;
}) {
  const handleClick = () => {
    if (onOpenSettings) {
      onOpenSettings(info.focusTarget);
    } else {
      onRetry?.();
    }
  };

  const desc = translatedError || info.desc;

  return (
    <div className={`conn-error-bar conn-error-${info.color}`}>
      <div className="conn-error-bar-icon">
        {iconForColor(info.color)}
      </div>
      <div className="conn-error-bar-body">
        <div className="conn-error-bar-title">{info.title}</div>
        <div className="conn-error-bar-desc">{desc}</div>
      </div>
      <button type="button" className="conn-error-bar-btn" onClick={handleClick}>
        {info.btnLabel}
      </button>
    </div>
  );
}

// ── Main component ──

export function ConnectionErrorBanner({ snapshot, variant, serverUrl, onOpenSettings, onRetry }: Props) {
  const { t } = useI18n();
  const info = resolve(snapshot.status, t);
  if (!info) return null;

  const translatedError = translateError(snapshot.errorMessage, t);

  if (variant === "bar") {
    return <BarBanner info={info} snapshot={snapshot} onOpenSettings={onOpenSettings} onRetry={onRetry} translatedError={translatedError} />;
  }
  return <FullPageBanner info={info} snapshot={snapshot} serverUrl={serverUrl} onOpenSettings={onOpenSettings} onRetry={onRetry} translatedError={translatedError} />;
}
