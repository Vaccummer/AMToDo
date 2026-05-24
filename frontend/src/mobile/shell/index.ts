import { CapacitorShell } from "./capacitor";

export function initShell(): void {
  if (window.amtodoShell) return;

  // In mobile build, always create the shell — the build is exclusively for native
  // Runtime availability of Capacitor plugins is handled by try/catch in each method
  if (import.meta.env.MODE === "mobile" || isCapacitorNative()) {
    window.amtodoShell = new CapacitorShell();
    // fetch() patching disabled — the server now has CORS middleware,
    // so the Capacitor HTTP bridge is no longer needed. Native fetch()
    // supports real streaming (progress tracking, no full-buffer memory spike).
  }
}

function isCapacitorNative(): boolean {
  const cap = window.Capacitor;
  if (!cap) return false;
  if (typeof cap.isNativePlatform === "function") return cap.isNativePlatform();
  return !!cap.isNativePlatform;
}


