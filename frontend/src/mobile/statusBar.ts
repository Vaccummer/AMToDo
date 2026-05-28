const MAIN_STATUS_BAR_FALLBACK = "#faf7f2";
const SETTINGS_STATUS_BAR_BG = "#f5f2ec";

function getCssColor(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function setStatusBar(color: string): void {
  import("@capacitor/status-bar").then(({ StatusBar, Style }) => {
    StatusBar.setStyle({ style: Style.Light }).catch(() => {});
    StatusBar.setBackgroundColor({ color }).catch(() => {});
  }).catch(() => {});
}

export function setMainStatusBar(): void {
  setStatusBar(getCssColor("--global-surface-bg", MAIN_STATUS_BAR_FALLBACK));
}

export function setSettingsStatusBar(): void {
  setStatusBar(SETTINGS_STATUS_BAR_BG);
}
