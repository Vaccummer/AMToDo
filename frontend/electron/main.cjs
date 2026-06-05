const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, globalShortcut, Notification, dialog } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

let mainWindow = null;
let tray = null;
let forceQuit = false;
let registeredHotkey = null;

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
  process.exit(0);
}

// --- Notification polling state ---
let notificationPollTimer = null;
let notificationLastPollAt = null; // unix timestamp (seconds)
const notificationFiredIds = new Set(); // IDs already shown as system notifications
const DEFAULT_POLL_INTERVAL = 30; // seconds
const DEFAULT_QUERY_WINDOW = 60; // seconds
const DEFAULT_ATTACHMENT_DIR_NAME = "AMToDo Attachments";

// --- Attachment cache helpers ---

function defaultAttachmentDownloadRoot() {
  return path.join(app.getPath("downloads"), DEFAULT_ATTACHMENT_DIR_NAME);
}

function sanitizePathPart(value, fallback) {
  const raw = String(value || "").trim();
  const cleaned = raw
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\.+$/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 180)
    .trim();
  if (!cleaned || cleaned === "." || cleaned === "..") return fallback;
  return cleaned;
}

function attachmentEntryParts(entry) {
  const ownerType = entry?.ownerType === "schedule" ? "schedule" : "todo";
  const ownerId = sanitizePathPart(entry?.ownerId, "0");
  const attachmentId = sanitizePathPart(entry?.attachmentId, "0");
  const filename = sanitizePathPart(entry?.filename, `${attachmentId}.bin`);
  const root = path.resolve(String(entry?.root || defaultAttachmentDownloadRoot()));
  const parentPath = path.join(root, ownerType, ownerId, attachmentId);
  const filePath = path.join(parentPath, filename);
  const partPath = `${filePath}.part`;
  return { root, ownerType, ownerId, attachmentId, filename, parentPath, filePath, partPath };
}

function ensureInside(parent, target) {
  const rel = path.relative(parent, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Invalid attachment cache path");
  }
}

function findCachedAttachmentFile(parts, expectedSize) {
  if (!fs.existsSync(parts.parentPath)) return null;
  const entries = fs.readdirSync(parts.parentPath, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || entry.name.endsWith(".part")) continue;
    const candidate = path.join(parts.parentPath, entry.name);
    ensureInside(parts.parentPath, candidate);
    const stat = fs.statSync(candidate);
    if (Number.isFinite(expectedSize) && expectedSize > 0 && stat.size !== expectedSize) continue;
    if (entry.name !== parts.filename) {
      try {
        fs.renameSync(candidate, parts.filePath);
        return parts.filePath;
      } catch {
        return candidate;
      }
    }
    return candidate;
  }
  return null;
}

function findPartialAttachmentFile(parts) {
  if (!fs.existsSync(parts.parentPath)) return null;
  const entries = fs.readdirSync(parts.parentPath, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".part")) continue;
    const candidate = path.join(parts.parentPath, entry.name);
    ensureInside(parts.parentPath, candidate);
    if (candidate !== parts.partPath) {
      try {
        fs.renameSync(candidate, parts.partPath);
        return parts.partPath;
      } catch {
        return candidate;
      }
    }
    return candidate;
  }
  return null;
}

function getAttachmentCacheEntry(entry) {
  const parts = attachmentEntryParts(entry);
  const expectedSize = Number(entry?.size || 0);
  const cached = findCachedAttachmentFile(parts, expectedSize);
  const partialPath = findPartialAttachmentFile(parts);
  const partialBytes = partialPath ? fs.statSync(partialPath).size : 0;
  return {
    ok: true,
    exists: Boolean(cached),
    filePath: cached || parts.filePath,
    folderPath: parts.parentPath,
    partialBytes,
    sanitizedFilename: parts.filename,
  };
}

function deleteDirIfEmpty(dir, stopAt) {
  let current = dir;
  const stop = path.resolve(stopAt);
  while (current.startsWith(stop) && current !== stop) {
    try {
      if (fs.existsSync(current) && fs.readdirSync(current).length === 0) {
        fs.rmdirSync(current);
        current = path.dirname(current);
      } else {
        return;
      }
    } catch {
      return;
    }
  }
}

function directorySize(root) {
  let count = 0;
  let bytes = 0;
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const target = path.join(dir, entry.name);
      ensureInside(root, target);
      if (entry.isDirectory()) {
        walk(target);
      } else if (entry.isFile()) {
        const stat = fs.statSync(target);
        count += 1;
        bytes += stat.size;
      }
    }
  }
  for (const child of ["todo", "schedule"]) {
    const target = path.join(root, child);
    ensureInside(root, target);
    walk(target);
  }
  return { count, bytes };
}

// --- Icon helpers (load from app.png/app-tray.ico, resize for each use) ---

const APP_PNG_PATH = path.join(__dirname, "..", "src", "assets", "app.png");
const APP_TRAY_ICO_PATH = path.join(__dirname, "..", "src", "assets", "app-tray.ico");

let _appPngImage = null;
let _trayIconImage = null;

function _appPng() {
  if (!_appPngImage) _appPngImage = nativeImage.createFromPath(APP_PNG_PATH);
  return _appPngImage;
}

function createAppIcon() {
  return _appPng().resize({ width: 64, height: 64 });
}

function createTrayIcon() {
  if (!_trayIconImage) {
    _trayIconImage = fs.existsSync(APP_TRAY_ICO_PATH)
      ? nativeImage.createFromPath(APP_TRAY_ICO_PATH)
      : _appPng().resize({ width: 32, height: 32, quality: "best" });
  }
  return _trayIconImage;
}

function createWindowIcon() {
  return _appPng();
}

function showMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  tray = new Tray(createTrayIcon());
  tray.setToolTip("AMToDo");

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "显示",
      click: () => {
        showMainWindow();
      }
    },
    {
      label: "最大化",
      click: () => {
        if (mainWindow) {
          mainWindow.maximize();
          showMainWindow();
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
    showMainWindow();
  });
}

function toggleWindowVisibility() {
  if (!mainWindow) return;
  if (mainWindow.isVisible() && !mainWindow.isMinimized()) {
    mainWindow.hide();
  } else {
    showMainWindow();
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
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ after }),
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
          showMainWindow();
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

function getConfigPaths() {
  const envHome = String(process.env.AMTODO_HOME || "").trim();
  const home = envHome ? path.resolve(envHome) : path.join(app.getPath("home"), ".amtodo");
  return [path.join(home, "ui", "config.toml")];
}

function resolveConfigPath() {
  return getConfigPaths()[0];
}

function resolveReadableConfigPath() {
  const paths = getConfigPaths();
  return paths.find((candidate) => fs.existsSync(candidate)) || paths[0];
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
  const configPath = resolveReadableConfigPath();
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
    "attachment_download_root",
  ];
  lines.push("# AMToDo UI configuration (non-visual parameters).");
  for (const key of keys) {
    if (merged[key] !== undefined) {
      lines.push(`${key} = "${merged[key]}"`);
    }
  }
  lines.push("");
  const configPath = resolveConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, lines.join("\n"), "utf-8");
}

app.setAppUserModelId("AMToDo");

app.on("second-instance", () => {
  if (mainWindow) {
    showMainWindow();
  } else if (app.isReady()) {
    createWindow();
  }
});

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
        showMainWindow();
        mainWindow?.webContents.send("notification:clicked", { id, trigger_at });
      });
      electronNotification.show();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("attachment-cache:default-root", () => {
    return { ok: true, path: defaultAttachmentDownloadRoot() };
  });

  ipcMain.handle("attachment-cache:select-root", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "选择附件下载目录",
      defaultPath: defaultAttachmentDownloadRoot(),
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true };
    return { ok: true, path: result.filePaths[0] };
  });

  ipcMain.handle("attachment-cache:get", (_event, entry) => {
    try {
      return getAttachmentCacheEntry(entry);
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("attachment-cache:append", (_event, entry, data) => {
    try {
      const parts = attachmentEntryParts(entry);
      fs.mkdirSync(parts.parentPath, { recursive: true });
      ensureInside(parts.parentPath, parts.partPath);
      const offset = Number(entry?.offset || 0);
      const existing = fs.existsSync(parts.partPath) ? fs.statSync(parts.partPath).size : 0;
      if (existing !== offset) {
        return { ok: false, error: `Partial size mismatch: expected ${offset}, found ${existing}` };
      }
      const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
      fs.appendFileSync(parts.partPath, bytes);
      return { ok: true, bytes: existing + bytes.length };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("attachment-cache:finalize", (_event, entry) => {
    try {
      const parts = attachmentEntryParts(entry);
      const expectedSize = Number(entry?.size || 0);
      if (!fs.existsSync(parts.partPath)) return { ok: false, error: "Partial file not found" };
      const stat = fs.statSync(parts.partPath);
      if (expectedSize > 0 && stat.size < expectedSize) {
        return { ok: false, error: `Download incomplete: received ${stat.size} of ${expectedSize} bytes` };
      }
      try { fs.rmSync(parts.filePath, { force: true }); } catch {}
      fs.renameSync(parts.partPath, parts.filePath);
      return { ok: true, filePath: parts.filePath, folderPath: parts.parentPath };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("attachment-cache:delete", (_event, entry) => {
    try {
      const parts = attachmentEntryParts(entry);
      if (fs.existsSync(parts.parentPath)) {
        for (const item of fs.readdirSync(parts.parentPath)) {
          const target = path.join(parts.parentPath, item);
          ensureInside(parts.parentPath, target);
          fs.rmSync(target, { recursive: true, force: true });
        }
        deleteDirIfEmpty(parts.parentPath, parts.root);
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("attachment-cache:clear-root", (_event, rootValue) => {
    try {
      const root = path.resolve(String(rootValue || defaultAttachmentDownloadRoot()));
      for (const child of ["todo", "schedule"]) {
        const target = path.join(root, child);
        ensureInside(root, target);
        fs.rmSync(target, { recursive: true, force: true });
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("attachment-cache:size-root", (_event, rootValue) => {
    try {
      const root = path.resolve(String(rootValue || defaultAttachmentDownloadRoot()));
      return { ok: true, ...directorySize(root) };
    } catch (err) {
      return { ok: false, error: err.message, count: 0, bytes: 0 };
    }
  });

  ipcMain.handle("attachment-cache:read-text", (_event, entry, maxBytesValue) => {
    try {
      const info = getAttachmentCacheEntry(entry);
      if (!info.exists) return { ok: false, error: "Cached file not found" };
      const maxBytes = Math.max(1, Math.min(Number(maxBytesValue || 512000), 1024 * 1024));
      const fd = fs.openSync(info.filePath, "r");
      try {
        const stat = fs.fstatSync(fd);
        const bytesToRead = Math.min(stat.size, maxBytes);
        const buffer = Buffer.alloc(bytesToRead);
        fs.readSync(fd, buffer, 0, bytesToRead, 0);
        return {
          ok: true,
          text: buffer.toString("utf8"),
          truncated: stat.size > bytesToRead,
        };
      } finally {
        fs.closeSync(fd);
      }
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("attachment-cache:open-folder", (_event, entry) => {
    try {
      const info = getAttachmentCacheEntry(entry);
      const target = info.exists ? info.filePath : info.folderPath;
      if (info.exists) {
        shell.showItemInFolder(target);
      } else {
        fs.mkdirSync(info.folderPath, { recursive: true });
        shell.openPath(info.folderPath);
      }
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
      showMainWindow();
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
