import { useEffect, useMemo, useState } from "react";
import { AMToDoApi, type HealthResponse } from "./api/client";
import { ScheduleView } from "./views/ScheduleView";
import { TodoView } from "./views/TodoView";
import closeIcon from "./assets/close.svg";
import maximumIcon from "./assets/maximum.svg";
import minimumIcon from "./assets/minimum.svg";
import windowlizeIcon from "./assets/windowlize.svg";

type Tab = "todo" | "schedule";

export function App() {
  const [activeTab, setActiveTab] = useState<Tab>("todo");
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [maximized, setMaximized] = useState(false);
  const api = useMemo(() => new AMToDoApi(undefined, "_-jJMQ5pDF_xoxoWOvdDEkkhQ9v9oWSuDoSp3p5FNu4"), []);

  useEffect(() => {
    api
      .health()
      .then((result) => {
        setHealth(result);
        setHealthError(null);
      })
      .catch((error: unknown) => {
        setHealth(null);
        setHealthError(error instanceof Error ? error.message : "无法连接后端");
      });
  }, [api]);

  useEffect(() => {
    window.amtodoShell.isMaximized().then(setMaximized).catch(() => setMaximized(false));
    return window.amtodoShell.onMaximizedChange(setMaximized);
  }, []);

  return (
    <div className="app-shell">
      <header className="titlebar">
        <div className="titlebar-drag">
          <div className="brand-dot" />
          <span className="brand-title">AMToDo</span>
          <span className={health ? "server-pill ok" : "server-pill"}>
            {health ? `API ${health.version}` : healthError ? "API 离线" : "API 检查中"}
          </span>
        </div>
        <div className="window-controls">
          <button type="button" aria-label="最小化" onClick={() => window.amtodoShell.minimize()}>
            <img src={minimumIcon} alt="" />
          </button>
          <button
            type="button"
            aria-label={maximized ? "还原" : "最大化"}
            onClick={() => window.amtodoShell.toggleMaximize()}
          >
            <img src={maximized ? windowlizeIcon : maximumIcon} alt="" />
          </button>
          <button
            type="button"
            aria-label="关闭"
            className="close"
            onClick={() => window.amtodoShell.close()}
          >
            <img src={closeIcon} alt="" />
          </button>
        </div>
      </header>

      <main className="workspace">
        <nav className="side-nav">
          <button
            type="button"
            className={activeTab === "todo" ? "active" : ""}
            onClick={() => setActiveTab("todo")}
          >
            ToDo
          </button>
          <button
            type="button"
            className={activeTab === "schedule" ? "active" : ""}
            onClick={() => setActiveTab("schedule")}
          >
            Schedule
          </button>
        </nav>
        <section className="content-panel">
          {activeTab === "todo" ? <TodoView api={api} /> : <ScheduleView api={api} />}
        </section>
      </main>
    </div>
  );
}
