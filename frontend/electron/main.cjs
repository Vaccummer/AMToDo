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

function createTrayIcon() {
  const size = 16;
  const buf = Buffer.alloc(size * size * 4, 0);
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const r = size / 2 - 1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const dist = Math.hypot(x - cx, y - cy);
      if (dist <= r) {
        buf[i] = 0x00;     // R
        buf[i + 1] = 0xc0; // G
        buf[i + 2] = 0x80; // B
        buf[i + 3] = 0xff; // A
      } else if (dist <= r + 1.5) {
        const alpha = Math.max(0, Math.min(255, Math.round((r + 1.5 - dist) * 255)));
        buf[i] = 0x00;
        buf[i + 1] = 0xc0;
        buf[i + 2] = 0x80;
        buf[i + 3] = Math.min(alpha, 255);
      }
    }
  }
  return nativeImage.createFromBuffer(buf, { width: size, height: size, scaleFactor: 1 });
}

function createAppIcon() {
  const size = 64;
  const buf = Buffer.alloc(size * size * 4, 0);
  const cx = size / 2;
  const cy = size / 2;
  const outerR = size / 2 - 2;
  const innerR = outerR - 8;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const dist = Math.hypot(x - cx, y - cy);
      if (dist <= innerR) {
        // white inner circle
        buf[i] = 0xff;
        buf[i + 1] = 0xff;
        buf[i + 2] = 0xff;
        buf[i + 3] = 0xff;
      } else if (dist <= outerR) {
        // green ring
        buf[i] = 0x00;
        buf[i + 1] = 0xc0;
        buf[i + 2] = 0x80;
        buf[i + 3] = 0xff;
      }
    }
  }
  // draw a simple checkmark line in the center
  const lx1 = 22, ly1 = 32, lx2 = 28, ly2 = 38;
  const lx3 = 28, ly3 = 38, lx4 = 42, ly4 = 24;
  for (const [sx, sy, ex, ey] of [[lx1, ly1, lx2, ly2], [lx3, ly3, lx4, ly4]]) {
    const steps = Math.max(Math.abs(ex - sx), Math.abs(ey - sy));
    for (let t = 0; t <= steps; t++) {
      const px = Math.round(sx + (ex - sx) * t / steps);
      const py = Math.round(sy + (ey - sy) * t / steps);
      const pi = (py * size + px) * 4;
      buf[pi] = 0x00;
      buf[pi + 1] = 0x9f;
      buf[pi + 2] = 0x72;
      buf[pi + 3] = 0xff;
    }
  }
  return nativeImage.createFromBuffer(buf, { width: size, height: size, scaleFactor: 1 });
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

        const electronNotification = new Notification({
          title: n.title || "AMToDo",
          body: n.description || "",
        });

        const notificationId = n.id;
        electronNotification.on("click", () => {
          if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
          }
          mainWindow?.webContents.send("notification:clicked", notificationId);
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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 760,
    minHeight: 520,
    title: "AMToDo",
    icon: createAppIcon(),
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

function readUiToml() {
  const configPath = resolveConfigPath();
  const raw = fs.readFileSync(configPath, "utf-8");
  const entries = {};
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*(\w+)\s*=\s*"([^"]*)"\s*(?:#.*)?$/);
    if (m) entries[m[1]] = m[2];
  }
  return entries;
}

function writeUiToml(settings) {
  const configPath = resolveConfigPath();
  const lines = [];
  const keys = [
    "server_url", "access_token", "admin_token",
    "language", "timezone", "font_family", "font_size",
    "calendar_days", "week_start",
    "scheduler_start_hour", "scheduler_end_hour", "scheduler_slot_minutes",
    "global_hotkey_enabled", "global_hotkey",
    "notification_poll_interval", "notification_query_window"
  ];
  lines.push("# AMToDo UI configuration (non-visual parameters).");
  for (const key of keys) {
    if (settings[key] !== undefined) {
      lines.push(`${key} = "${settings[key]}"`);
    }
  }
  lines.push("");
  fs.writeFileSync(configPath, lines.join("\n"), "utf-8");
}

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

  createWindow();
  createTray();

  // Register global hotkey if enabled in settings
  try {
    const settings = readUiToml();
    if (settings.global_hotkey_enabled === "true" && settings.global_hotkey) {
      registerGlobalHotkey(settings.global_hotkey);
    }
    // Start notification polling
    startNotificationPolling(settings);
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
