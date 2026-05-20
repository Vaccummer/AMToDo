const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, globalShortcut, Notification } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

let mainWindow = null;
let tray = null;
let forceQuit = false;
let registeredHotkey = null;

// --- Notification polling state ---
let notificationPollTimer = null;
let notificationLastPollAt = null; // unix timestamp (seconds)
const notificationFiredIds = new Set(); // IDs already shown as system notifications
const DEFAULT_POLL_INTERVAL = 30; // seconds
const DEFAULT_QUERY_WINDOW = 60; // seconds

// --- Icon helpers (load from app.png, resize for each use) ---

const APP_PNG_PATH = path.join(__dirname, "..", "src", "assets", "app.png");

let _appPngImage = null;

function _appPng() {
  if (!_appPngImage) _appPngImage = nativeImage.createFromPath(APP_PNG_PATH);
  return _appPngImage;
}

function createAppIcon() {
  return _appPng().resize({ width: 64, height: 64 });
}

function createTrayIcon() {
  return _appPng().resize({ width: 16, height: 16 });
}

function createWindowIcon() {
  return _appPng();
}

function createTray() {
  tray = new Tray(createTrayIcon());
  tray.setToolTip("AMToDo");

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "显示",
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    {
      label: "最大化",
      click: () => {
        if (mainWindow) {
          mainWindow.maximize();
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    { type: "separator" },
    {
      label: "退出",
      click: () => {
        forceQuit = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);

  tray.on("click", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function toggleWindowVisibility() {
  if (!mainWindow) return;
  if (mainWindow.isVisible() && !mainWindow.isMinimized()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

function registerGlobalHotkey(accelerator) {
  if (registeredHotkey) {
    globalShortcut.unregister(registeredHotkey);
    registeredHotkey = null;
  }
  if (!accelerator) return { ok: true };
  try {
    const success = globalShortcut.register(accelerator, toggleWindowVisibility);
    if (success) {
      registeredHotkey = accelerator;
      return { ok: true };
    }
    return { ok: false, error: "快捷键注册失败" };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function unregisterGlobalHotkey() {
  if (registeredHotkey) {
    globalShortcut.unregister(registeredHotkey);
    registeredHotkey = null;
  }
}

// --- Notification polling ---

function pollNotifications(serverUrl, accessToken, queryWindow) {
  const after = notificationLastPollAt != null
    ? notificationLastPollAt
    : Math.floor(Date.now() / 1000) - queryWindow;

  const url = serverUrl.replace(/\/+$/, "") + "/api/v1/notifications/list_triggered";

  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ after, access_token: accessToken }),
  })
    .then((res) => res.json())
    .then((data) => {
      if (!data.ok || !Array.isArray(data.notifications)) return;

      for (const n of data.notifications) {
        if (notificationFiredIds.has(n.id)) continue;

        notificationFiredIds.add(n.id);

        const epoch = typeof n.trigger_at === "number" ? n.trigger_at : 0;
        const triggerTime = formatTimeStr(epoch);
        const desc = typeof n.description === "string" ? n.description : "";
        const body = desc ? `${desc}\n触发: ${triggerTime}` : `触发: ${triggerTime}`;

        const electronNotification = new Notification({
          title: n.title || "AMToDo",
          body,
          icon: createAppIcon(),
          silent: getNotifSetting("notification_silent") === "true",
          timeoutType: getNotifSetting("notification_timeout") === "never" ? "never" : "default",
        });

        electronNotification.on("click", () => {
          if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
          }
          mainWindow?.webContents.send("notification:clicked", { id: n.id, trigger_at: n.trigger_at });
        });

        electronNotification.show();
      }

      // Advance lastPollAt to now so we don't re-query the same window
      notificationLastPollAt = Math.floor(Date.now() / 1000);
    })
    .catch(() => {
      // Swallow network errors silently — polling will retry next interval
    });
}

function startNotificationPolling(settings) {
  stopNotificationPolling();

  const serverUrl = settings.server_url || "http://127.0.0.1:8000";
  const accessToken = settings.access_token || "";
  const pollInterval = Number(settings.notification_poll_interval) || DEFAULT_POLL_INTERVAL;
  const queryWindow = Number(settings.notification_query_window) || DEFAULT_QUERY_WINDOW;

  if (!accessToken) return; // no token, nothing to poll

  // Reset state
  notificationLastPollAt = Math.floor(Date.now() / 1000) - queryWindow;
  notificationFiredIds.clear();

  // Fire immediately, then on interval
  pollNotifications(serverUrl, accessToken, queryWindow);
  notificationPollTimer = setInterval(() => {
    pollNotifications(serverUrl, accessToken, queryWindow);
  }, pollInterval * 1000);
}

function stopNotificationPolling() {
  if (notificationPollTimer) {
    clearInterval(notificationPollTimer);
    notificationPollTimer = null;
  }
  notificationLastPollAt = null;
  notificationFiredIds.clear();
}



function formatTimeStr(epoch) {
  if (!epoch) return "";
  const d = new Date(epoch * 1000);
  if (isNaN(d.getTime())) return "";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return hh + ":" + mm + ":" + ss;
}

function getNotifSetting(key) {
  return readUiToml()[key] || "";
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 760,
    minHeight: 520,
    title: "AMToDo",
    icon: createWindowIcon(),
    frame: false,
    thickFrame: true,
    roundedCorners: true,
    transparent: true,
    backgroundColor: "#00000000",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.on("maximize", () => {
    mainWindow.webContents.send("window:maximized", true);
  });

  mainWindow.on("unmaximize", () => {
    mainWindow.webContents.send("window:maximized", false);
  });

  mainWindow.on("close", (event) => {
    if (!forceQuit) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (isDev) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

function resolveConfigPath() {
  return path.resolve(__dirname, "..", "..", "config", "ui.toml");
}

// ── In-memory settings store ──
let _settingsCache = null;

function _parseToml(raw) {
  const entries = {};
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*(\w+)\s*=\s*"([^"]*)"\s*(?:#.*)?$/);
    if (m) entries[m[1]] = m[2];
  }
  return entries;
}

function _loadSettingsFromDisk() {
  const configPath = resolveConfigPath();
  const raw = fs.readFileSync(configPath, "utf-8");
  return _parseToml(raw);
}

/** Read settings from memory. Loads from disk once on first call. */
function readUiToml() {
  if (_settingsCache === null) {
    try {
      _settingsCache = _loadSettingsFromDisk();
    } catch {
      _settingsCache = {};
    }
  }
  return { ..._settingsCache }; // return shallow copy to prevent accidental mutation
}

/** Write settings: update memory first, then flush to disk. */
function writeUiToml(settings) {
  const current = readUiToml();
  const merged = { ...current, ...settings };
  _settingsCache = merged;

  const lines = [];
  const keys = [
    "server_url", "lan_address", "access_token", "admin_token",
    "language", "timezone", "font_family", "font_size",
    "calendar_days", "week_start",
    "scheduler_start_hour", "scheduler_end_hour", "scheduler_slot_minutes",
    "global_hotkey_enabled", "global_hotkey",
    "notification_enabled", "notification_poll_interval", "notification_query_window",
    "notification_silent", "notification_timeout",
    "ws_reconnect_retries", "reconnect_max_attempts",
    "ws_enabled", "notify_on_disconnect",
    "ws_reconnect_interval_ms",
    "known_key_fingerprint"
  ];
  lines.push("# AMToDo UI configuration (non-visual parameters).");
  for (const key of keys) {
    if (merged[key] !== undefined) {
      lines.push(`${key} = "${merged[key]}"`);
    }
  }
  lines.push("");
  fs.writeFileSync(resolveConfigPath(), lines.join("\n"), "utf-8");
}

app.setAppUserModelId("AMToDo");

app.whenReady().then(() => {
  ipcMain.handle("settings:read", () => {
    try {
      return readUiToml();
    } catch {
      return {};
    }
  });

  ipcMain.handle("settings:write", (_event, settings) => {
    try {
      writeUiToml(settings);
      // Stop notification polling when settings change; renderer can restart
      stopNotificationPolling();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("hotkey:register", (_event, accelerator) => {
    return registerGlobalHotkey(accelerator);
  });

  ipcMain.handle("hotkey:unregister", () => {
    unregisterGlobalHotkey();
    return { ok: true };
  });

  ipcMain.handle("window:minimize", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });
  ipcMain.handle("window:toggle-maximize", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  });
  ipcMain.handle("window:close", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      // hide to tray rather than quitting
      win.hide();
    }
  });
  ipcMain.handle("window:is-maximized", (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false;
  });

  ipcMain.handle("notification:start-polling", (_event, settings) => {
    try {
      startNotificationPolling(settings);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("notification:stop-polling", () => {
    try {
      stopNotificationPolling();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("notification:show", (_event, { title, body, id, trigger_at }) => {
    try {
      const electronNotification = new Notification({
        title: title || "AMToDo",
        body,
        icon: createAppIcon(),
        silent: getNotifSetting("notification_silent") === "true",
        timeoutType: getNotifSetting("notification_timeout") === "never" ? "never" : "default",
      });
      electronNotification.on("click", () => {
        if (mainWindow) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.show();
          mainWindow.focus();
        }
        mainWindow?.webContents.send("notification:clicked", { id, trigger_at });
      });
      electronNotification.show();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  createWindow();
  createTray();

  // Register global hotkey if enabled in settings
  try {
    const settings = readUiToml();
    if (settings.global_hotkey_enabled === "true" && settings.global_hotkey) {
      registerGlobalHotkey(settings.global_hotkey);
    }
    // Start notification polling as fallback (renderer handles primary WS connection)
    if (settings.server_url && settings.access_token) {
      startNotificationPolling(settings);
      console.log("Notification mode: poll (fallback for renderer WS)");
    }
  } catch {
    // settings file may not exist yet
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  forceQuit = true;
  unregisterGlobalHotkey();
  stopNotificationPolling();
});
