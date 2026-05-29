import { Capacitor, registerPlugin } from "@capacitor/core";
import type { PluginListenerHandle } from "@capacitor/core";

export type BackgroundWsStatus = "connecting" | "connected" | "reconnecting" | "disconnected";
export type BackgroundWsNotificationClick = { id: number; trigger_at: number };

type BackgroundWsPlugin = {
  start(options: {
    serverUrl: string;
    accessToken: string;
    reconnectIntervalMs?: number;
  }): Promise<{ ok: boolean }>;
  stop(): Promise<{ ok: boolean }>;
  status(): Promise<{ status: BackgroundWsStatus }>;
  consumeLaunchNotification(): Promise<{ notification?: BackgroundWsNotificationClick }>;
  addListener(
    eventName: "status",
    listenerFunc: (event: { status: BackgroundWsStatus; message?: string }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: "event",
    listenerFunc: (event: { type?: string; data?: string }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: "notificationClicked",
    listenerFunc: (event: BackgroundWsNotificationClick) => void,
  ): Promise<PluginListenerHandle>;
};

const BackgroundWs = registerPlugin<BackgroundWsPlugin>("BackgroundWs");

export function isBackgroundWsAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

export async function startBackgroundWs(options: {
  serverUrl: string;
  accessToken: string;
  reconnectIntervalMs?: number;
}): Promise<void> {
  if (!isBackgroundWsAvailable()) return;
  await BackgroundWs.start(options);
}

export async function stopBackgroundWs(): Promise<void> {
  if (!isBackgroundWsAvailable()) return;
  await BackgroundWs.stop();
}

export async function getBackgroundWsStatus(): Promise<BackgroundWsStatus> {
  if (!isBackgroundWsAvailable()) return "disconnected";
  const result = await BackgroundWs.status();
  return result.status;
}

export async function requestBackgroundWsNotificationPermission(): Promise<boolean> {
  if (!isBackgroundWsAvailable()) return true;
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    const current = await LocalNotifications.checkPermissions();
    if (current.display === "granted") return true;
    const next = await LocalNotifications.requestPermissions();
    return next.display === "granted";
  } catch {
    return false;
  }
}

export async function consumeBackgroundWsLaunchNotification(): Promise<BackgroundWsNotificationClick | null> {
  if (!isBackgroundWsAvailable()) return null;
  const result = await BackgroundWs.consumeLaunchNotification();
  return result.notification ?? null;
}

export async function onBackgroundWsStatus(
  listener: (event: { status: BackgroundWsStatus; message?: string }) => void,
): Promise<() => void> {
  if (!isBackgroundWsAvailable()) return () => {};
  const handle = await BackgroundWs.addListener("status", listener);
  return () => { void handle.remove(); };
}

export async function onBackgroundWsNotificationClicked(
  listener: (event: BackgroundWsNotificationClick) => void,
): Promise<() => void> {
  if (!isBackgroundWsAvailable()) return () => {};
  const handle = await BackgroundWs.addListener("notificationClicked", listener);
  return () => { void handle.remove(); };
}
