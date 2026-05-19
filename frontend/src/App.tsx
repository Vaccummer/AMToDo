import { useAppCore } from "./hooks/useAppCore";
import { DesktopLayout } from "./layout/DesktopLayout";
import { MobileLayout } from "./layout/MobileLayout";

function isMobile(): boolean {
  const cap = window.Capacitor;
  if (!cap) return false;
  if (typeof cap.isNativePlatform === "function") return cap.isNativePlatform();
  return !!cap.isNativePlatform;
}

export function App() {
  const core = useAppCore();

  if (isMobile()) {
    return <MobileLayout {...core} />;
  }
  return <DesktopLayout {...core} />;
}
