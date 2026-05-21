import { useCallback, useEffect, useState } from "react";
import type { AMToDoApi, NotificationItem } from "../api/client";
import type { UISettings } from "../lib/settings";
import { useI18n } from "../i18n";
import { NotifyFormModal } from "./NotifyFormModal";
import { NotifyDetailModal } from "./NotifyDetailModal";
import { ContextMenu, TrashIcon } from "./ContextMenu";

function EditIcon() {
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
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function RestoreIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 7v6h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.5 13A7 7 0 1 0 7 5.3L3 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PurgeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 6h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M8 6V4h8v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 6l1 14h10l1-14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 11v5M14 11v5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function formatDateTime(epoch: number, timezone: string): string {
  const d = new Date(epoch * 1000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const lookup = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const nowParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
  }).formatToParts(new Date());
  const nowYear = Object.fromEntries(nowParts.map((p) => [p.type, p.value])).year;
  const hm = `${lookup.hour}:${lookup.minute}`;
  if (lookup.year === nowYear) {
    return `${lookup.month}-${lookup.day} ${hm}`;
  }
  return `${lookup.year}-${lookup.month}-${lookup.day} ${hm}`;
}

type Props = {
  api: AMToDoApi;
  settings: UISettings;
  onNavigate?: (type: "todo" | "schedule", id: number, action: "jump" | "edit") => void;
};

export function NotifyView({ api, settings, onNavigate }: Props) {
  const { t } = useI18n();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [showTrash, setShowTrash] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    notificationId: number;
  } | null>(null);

  const load = useCallback(async () => {
    try {
      if (showTrash) {
        const res = await api.listNotificationTrash();
        setNotifications(res.notifications);
      } else {
        const res = await api.listNotifications();
        setNotifications(res.notifications);
      }
    } catch {
      /* ignore */
    }
  }, [api, showTrash]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleDelete(id: number) {
    await api.deleteNotification(id);
    void load();
  }

  async function handleRestore(id: number) {
    await api.restoreNotification(id);
    void load();
  }

  async function handlePurge(id: number) {
    await api.purgeNotification(id);
    void load();
  }

  return (
    <div className="notify-view">
      <div className="notify-header">
        <h2>{showTrash ? t("notify.trash") : t("notify.title")}</h2>
        <div className="notify-header-actions">
          <button type="button" onClick={() => setShowTrash(!showTrash)}>
            {showTrash ? t("notify.back") : t("notify.trashBtn")}
          </button>
          {!showTrash && (
            <button
              type="button"
              className="primary"
              onClick={() => {
                setEditId(null);
                setFormOpen(true);
              }}
            >
              {t("notify.newNotification")}
            </button>
          )}
        </div>
      </div>

      <div className="notify-list">
        {notifications.map((n) => (
          <div
            key={n.id}
            className="notify-row"
            onClick={() => setDetailId(n.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setContextMenu({
                x: e.clientX,
                y: e.clientY,
                notificationId: n.id,
              });
            }}
          >
            <div className="notify-row-title">{n.title}</div>
            <div className="notify-row-time">
              {formatDateTime(n.trigger_at, settings.timezone)}
            </div>
            {n.mentions.length > 0 && (
              <span className="notify-row-badge">{n.mentions.length}</span>
            )}
            {showTrash && (
              <div className="notify-row-actions">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleRestore(n.id);
                  }}
                >
                  {t("common.restore")}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handlePurge(n.id);
                  }}
                >
                  {t("common.purge")}
                </button>
              </div>
            )}
          </div>
        ))}
        {notifications.length === 0 && (
          <div className="notify-empty">
            {showTrash ? t("notify.trashEmpty") : t("notify.noNotifications")}
          </div>
        )}
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={
            showTrash
              ? [
                  {
                    label: t("common.restore"),
                    icon: <RestoreIcon />,
                    action: () => void handleRestore(contextMenu.notificationId),
                  },
                  {
                    label: t("common.purge"),
                    icon: <PurgeIcon />,
                    danger: true,
                    action: () => void handlePurge(contextMenu.notificationId),
                  },
                ]
              : [
                  {
                    label: t("common.edit"),
                    icon: <EditIcon />,
                    action: () => {
                      setEditId(contextMenu.notificationId);
                      setFormOpen(true);
                    },
                  },
                  {
                    label: t("common.delete"),
                    icon: <TrashIcon />,
                    danger: true,
                    action: () => void handleDelete(contextMenu.notificationId),
                  },
                ]
          }
          onClose={() => setContextMenu(null)}
        />
      )}

      {formOpen && (
        <NotifyFormModal
          api={api}
          editId={editId}
          onClose={() => {
            setFormOpen(false);
            setEditId(null);
            void load();
          }}
          onNavigate={onNavigate}
        />
      )}

      {detailId !== null && !formOpen && (
        <NotifyDetailModal
          api={api}
          notificationId={detailId}
          settings={settings}
          onClose={() => setDetailId(null)}
          onEdit={(id) => {
            setDetailId(null);
            setEditId(id);
            setFormOpen(true);
          }}
        />
      )}
    </div>
  );
}
