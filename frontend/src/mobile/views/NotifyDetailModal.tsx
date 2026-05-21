import { useEffect, useState } from "react";
import type { AMToDoApi, NotificationItem } from "../../api/client";
import type { UISettings } from "../../lib/settings";
import { useI18n } from "../../i18n";

function formatDateTime(epoch: number, timezone: string): string {
  const d = new Date(epoch * 1000);
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

type MentionDisplay = {
  target_type: "todo" | "schedule";
  target_id: number;
  title: string | null;
  error: boolean;
};

type Props = {
  api: AMToDoApi;
  notificationId: number;
  settings: UISettings;
  onClose: () => void;
  onEdit: (id: number) => void;
};

export function NotifyDetailModal({
  api,
  notificationId,
  settings,
  onClose,
  onEdit,
}: Props) {
  const [notification, setNotification] = useState<NotificationItem | null>(null);
  const [mentions, setMentions] = useState<MentionDisplay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { t } = useI18n();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    api
      .getNotification(notificationId)
      .then(async (res) => {
        if (cancelled) return;
        setNotification(res.notification);

        // Fetch titles for mentions
        const results: MentionDisplay[] = await Promise.all(
          res.notification.mentions.map(async (m) => {
            try {
              if (m.target_type === "todo") {
                const r = await api.getTodo(m.target_id);
                return {
                  target_type: m.target_type,
                  target_id: m.target_id,
                  title: r.todo.title,
                  error: false,
                };
              } else {
                const r = await api.getSchedule(m.target_id);
                return {
                  target_type: m.target_type,
                  target_id: m.target_id,
                  title: r.schedule.title,
                  error: false,
                };
              }
            } catch {
              return {
                target_type: m.target_type,
                target_id: m.target_id,
                title: null,
                error: true,
              };
            }
          })
        );

        if (!cancelled) setMentions(results);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : t("common.loadFailed"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [api, notificationId]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleBackdrop(e: React.MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") onClose();
  }

  return (
    <div
      className="schedule-modal-backdrop"
      onClick={handleBackdrop}
      onKeyDown={handleKeyDown}
    >
      <div className="schedule-modal-card" role="dialog" aria-label={t("notify.detail")}>
        <div className="schedule-modal-header">
          <div className="schedule-modal-header-left">
            <span className="schedule-modal-dot" />
            <h2 className="schedule-modal-title">{t("notify.detail")}<span className="notify-modal-id-badge">#{notificationId}</span></h2>
          </div>
          <button
            type="button"
            className="schedule-modal-close"
            onClick={onClose}
            aria-label={t("common.close")}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="schedule-modal-body">
          {loading ? (
            <div style={{ textAlign: "center", padding: "2rem" }}>{t("common.loadingEllipsis")}</div>
          ) : error ? (
            <div className="schedule-modal-error">{error}</div>
          ) : notification ? (
            <>
              <div className="schedule-modal-section-label">{t("notify.basicInfo")}</div>

              <div className="schedule-modal-field">
                <span className="schedule-modal-label">{t("common.title")}</span>
                <span style={{ fontSize: "1rem" }}>{notification.title}</span>
              </div>

              {notification.description ? (
                <div className="schedule-modal-field">
                  <span className="schedule-modal-label">{t("common.description")}</span>
                  <span style={{ fontSize: "0.95rem", whiteSpace: "pre-wrap" }}>
                    {notification.description}
                  </span>
                </div>
              ) : null}

              <div className="schedule-modal-field">
                <span className="schedule-modal-label">{t("common.triggerTime")}</span>
                <span>{formatDateTime(notification.trigger_at, settings.timezone)}</span>
              </div>

              <div className="schedule-modal-field">
                <span className="schedule-modal-label">{t("common.createdAt")}</span>
                <span>{formatDateTime(notification.created_at, settings.timezone)}</span>
              </div>

              {notification.updated_at ? (
                <div className="schedule-modal-field">
                  <span className="schedule-modal-label">{t("common.updatedAt")}</span>
                  <span>{formatDateTime(notification.updated_at, settings.timezone)}</span>
                </div>
              ) : null}

              <div className="schedule-modal-divider" />

              <div className="schedule-modal-section-label">{t("notify.relatedItems")}</div>

              {mentions.length === 0 ? (
                <div style={{ color: "var(--text-muted, #888)", padding: "0.25rem 0" }}>
                  {t("notify.noRelatedItems")}
                </div>
              ) : (
                mentions.map((m, i) => (
                  <div className="schedule-modal-field" key={i}>
                    <span className="schedule-modal-label" style={{ minWidth: "4.5rem" }}>
                      {m.target_type === "todo" ? "ToDo" : "Schedule"}
                    </span>
                    <span>
                      {m.error
                        ? `[${t("notify.deletedTarget")} ${m.target_type === "todo" ? "ToDo" : "Schedule"} #${m.target_id}]`
                        : m.title ?? `#${m.target_id}`}
                    </span>
                  </div>
                ))
              )}
            </>
          ) : null}
        </div>

        <div className="schedule-modal-actions">
          <button
            type="button"
            className="schedule-modal-btn schedule-modal-btn-save"
            disabled={!notification}
            onClick={() => {
              if (notification) onEdit(notification.id);
            }}
          >
            {t("common.edit")}
          </button>
          <button
            type="button"
            className="schedule-modal-btn schedule-modal-btn-delete"
            onClick={onClose}
          >
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
