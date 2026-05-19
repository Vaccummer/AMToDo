export function initShell(): void {
  if (window.amtodoShell) return;
  if (isCapacitorNative()) {
    import("./capacitor").then(({ CapacitorShell }) => {
      window.amtodoShell = new CapacitorShell();
    });
  }
}

function isCapacitorNative(): boolean {
  const cap = window.Capacitor;
  if (!cap) return false;
  if (typeof cap.isNativePlatform === "function") return cap.isNativePlatform();
  return !!cap.isNativePlatform;
}
