import { Preferences } from "@capacitor/preferences";
import { LocalNotifications } from "@capacitor/local-notifications";
import type { PluginListenerHandle } from "@capacitor/core";
import {
  consumeBackgroundWsLaunchNotification,
  onBackgroundWsNotificationClicked,
} from "../../lib/background-ws";

const SETTINGS_KEY = "amtodo-settings";

export class CapacitorShell implements NonNullable<Window["amtodoShell"]> {
  minimize = async () => {};
  toggleMaximize = async () => {};
  close = async () => {};
  isMaximized = async () => false;
  onMaximizedChange = () => () => {};

  readSettings = async (): Promise<SettingsData> => {
    const { value } = await Preferences.get({ key: SETTINGS_KEY });
    if (!value) return {};
    try {
      return JSON.parse(value) as SettingsData;
    } catch {
      return {};
    }
  };

  writeSettings = async (settings: SettingsData): Promise<{ ok: boolean; error?: string }> => {
    try {
      const { value } = await Preferences.get({ key: SETTINGS_KEY });
      const existing: SettingsData = value ? JSON.parse(value) : {};
      await Preferences.set({
        key: SETTINGS_KEY,
        value: JSON.stringify({ ...existing, ...settings }),
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  };

  startNotificationPolling = async (_settings: SettingsData) => ({ ok: true });
  onNotificationClicked = (callback: (data: { id: number; trigger_at: number }) => void) => {
    let disposed = false;
    let localHandle: PluginListenerHandle | null = null;
    let nativeCleanup: (() => void) | null = null;

    const handler = (action: { notification: { id: number; extra?: Record<string, unknown> } }) => {
      const extra = action.notification.extra;
      if (extra?.id != null && extra?.trigger_at != null) {
        callback({ id: extra.id as number, trigger_at: extra.trigger_at as number });
      }
    };
    LocalNotifications.addListener("localNotificationActionPerformed", handler as Parameters<typeof LocalNotifications.addListener>[1])
      .then((handle) => {
        if (disposed) {
          void handle.remove();
        } else {
          localHandle = handle;
        }
      })
      .catch(() => {});

    consumeBackgroundWsLaunchNotification()
      .then((notification) => {
        if (!disposed && notification) callback(notification);
      })
      .catch(() => {});

    onBackgroundWsNotificationClicked((notification) => {
      if (!disposed) callback(notification);
    })
      .then((cleanup) => {
        if (disposed) cleanup();
        else nativeCleanup = cleanup;
      })
      .catch(() => {});

    return () => {
      disposed = true;
      void localHandle?.remove();
      nativeCleanup?.();
    };
  };
  showSystemNotification = async (_params: { title: string; body: string; id: number; trigger_at: number }) => ({ ok: true });
}
