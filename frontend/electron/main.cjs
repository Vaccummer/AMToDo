const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, globalShortcut, Notification } = require("electron");
const crypto = require("node:crypto");
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

// --- WebSocket notification state ---
let wsSessionKey = null;       // Buffer, 32 bytes
let wsSessionKeyExpiry = 0;    // Unix seconds
let wsConnection = null;       // WebSocket instance
let wsServerUrl = null;        // current server URL
let wsAccessToken = null;      // current access_token

// --- Crypto helpers for WebSocket ---

function base64urlEncode(buffer) {
  return buffer.toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(str) {
  let b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4 !== 0) b64 += "=";
  return Buffer.from(b64, "base64");
}

function sha256Hex(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function aes256GcmDecrypt(keyBytes, nonce, ciphertextWithTag) {
  // ciphertextWithTag: ciphertext || 16-byte tag
  const tag = ciphertextWithTag.slice(-16);
  const ciphertext = ciphertextWithTag.slice(0, -16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", keyBytes, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function readServerPublicKeyPem() {
  const rootPath = path.resolve(__dirname, "..", "..");
  const keyPath = path.join(rootPath, "config", "keys", "server_public.pem");
  return fs.readFileSync(keyPath);
}

function encryptEnvelope(payload, serverPublicKeyPem) {
  // Generate ephemeral P-256 ECDH keypair
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  const ekRaw = ecdh.getPublicKey(); // uncompressed point

  // Extract raw 65-byte EC point from server's SPKI PEM
  const serverPubKeyObj = crypto.createPublicKey({
    key: serverPublicKeyPem,
    format: "pem",
    type: "spki",
  });
  const der = Buffer.from(
    serverPubKeyObj.export({ format: "der", type: "spki" })
  );
  // SPKI DER → last 65 bytes = uncompressed EC point (0x04 || x || y)
  const rawServerKey = der.slice(-65);

  // Compute shared secret via ECDH
  const shared = ecdh.computeSecret(rawServerKey);

  // HKDF-SHA256 → AES-256 key
  const hkdfInfo = Buffer.from("amtodo-encryption", "utf8");
  const aesKey = crypto.hkdfSync("sha256", shared, Buffer.alloc(0), hkdfInfo, 32);

  // Encrypt inner payload
  const nonce = crypto.randomBytes(12);
  const now = Math.floor(Date.now() / 1000);
  const requestId = crypto.randomUUID().replace(/-/g, "");
  const inner = JSON.stringify({ requestId, timestamp: now, payload });

  const cipher = crypto.createCipheriv("aes-256-gcm", aesKey, nonce);
  const encrypted = Buffer.concat([cipher.update(inner, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  const envelope = {
    version: 1,
    keyId: "server-key-v1",
    alg: "ECDH-P256-HKDF-SHA256+A256GCM",
    ek: base64urlEncode(ekRaw),
    nonce: base64urlEncode(nonce),
    data: base64urlEncode(encrypted),
    tag: base64urlEncode(tag),
  };

  return { envelope, dataKey: aesKey };
}

function decryptEnvelopeResponse(responseBody, dataKey) {
  const nonce = base64urlDecode(responseBody.nonce);
  const encData = base64urlDecode(responseBody.data);
  const tag = base64urlDecode(responseBody.tag);

  const decipher = crypto.createDecipheriv("aes-256-gcm", dataKey, nonce);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(encData), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8"));
}

// --- WebSocket connection management ---

async function fetchSessionKey(serverUrl, accessToken) {
  const serverPublicKeyPem = readServerPublicKeyPem();
  const { envelope, dataKey } = encryptEnvelope(
    { access_token: accessToken },
    serverPublicKeyPem
  );

  const res = await fetch(serverUrl.replace(/\/+$/, "") + "/api/v1/notifications/ws-key", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(envelope),
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch session key: ${res.status}`);
  }

  const rawBody = await res.json();
  const data = decryptEnvelopeResponse(rawBody, dataKey);

  if (!data.ok) {
    throw new Error(data.error || "Failed to obtain session key");
  }

  wsSessionKey = base64urlDecode(data.session_key);
  wsSessionKeyExpiry = data.expires_at;
  return wsSessionKey;
}

function decryptWebSocketMessage(base64Data) {
  const raw = base64urlDecode(base64Data);
  const nonce = raw.slice(0, 12);
  const ciphertext = raw.slice(12);
  return aes256GcmDecrypt(wsSessionKey, nonce, ciphertext);
}

function connectWebSocket(serverUrl, accessToken) {
  // Clean up old connection
  disconnectWebSocket();

  wsServerUrl = serverUrl;
  wsAccessToken = accessToken;

  const wsUrl = serverUrl.replace(/^http/, "ws").replace(/\/+$/, "") + "/api/v1/notifications/ws";

  // Require the 'ws' package (install with: cd frontend && npm install ws)
  let WebSocketClient;
  try {
    WebSocketClient = require("ws");
  } catch (_) {
    // Fallback: try native WebSocket (available in newer Electron / Node.js 21+)
    WebSocketClient = globalThis;
  }
  const ws = new (WebSocketClient.WebSocket || WebSocketClient)(wsUrl);
  wsConnection = ws;

  ws.on("open", async () => {
    try {
      // Fetch session key if needed
      if (!wsSessionKey || Date.now() / 1000 >= wsSessionKeyExpiry) {
        await fetchSessionKey(serverUrl, accessToken);
      }

      // Send authentication message
      const keyHash = sha256Hex(wsSessionKey);
      ws.send(JSON.stringify({ type: "auth", key_hash: keyHash }));
    } catch (e) {
      console.error("WebSocket auth failed:", e);
      ws.close();
    }
  });

  ws.on("message", (data) => {
    // data is Buffer (ws package) or string (native WebSocket)
    const raw = typeof data === "string" ? data : data.toString("utf8");

    try {
      const msg = JSON.parse(raw);

      switch (msg.type) {
        case "auth_ok":
          console.log("WebSocket authenticated");
          break;

        case "auth_failed":
          console.error("WebSocket auth rejected:", msg.reason);
          ws.close();
          break;

        case "notification": {
          const decrypted = decryptWebSocketMessage(msg.data);
          const rawJson = decrypted.toString("utf8");
          const notification = JSON.parse(rawJson);

          const epoch = typeof notification.trigger_at === "number" ? notification.trigger_at : 0;
          const triggerTime = formatTimeStr(epoch);
          const desc = typeof notification.description === "string" ? notification.description : "";
          const body = desc ? `${desc}\n触发: ${triggerTime}` : `触发: ${triggerTime}`;
          console.log("[ws] notif title=%s epoch=%d triggerTime=%s body=%s", notification.title, epoch, triggerTime, body);

          const electronNotification = new Notification({
            title: notification.title || "AMToDo",
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
            mainWindow?.webContents.send("notification:clicked", {
              id: notification.id,
              trigger_at: notification.trigger_at,
            });
          });

          electronNotification.show();
          break;
        }

        case "ping":
          ws.send(JSON.stringify({ type: "pong" }));
          break;
      }
    } catch (e) {
      console.error("Failed to handle WebSocket message:", e);
    }
  });

  ws.on("close", (code, reason) => {
    console.log("WebSocket closed:", code, reason?.toString() || "");
    wsConnection = null;
    // Do NOT auto-reconnect; client controls reconnection
  });

  ws.on("error", (error) => {
    console.error("WebSocket error:", error);
  });
}

function disconnectWebSocket() {
  if (wsConnection) {
    try { wsConnection.close(); } catch (_) {}
    wsConnection = null;
  }
  wsSessionKey = null;
  wsSessionKeyExpiry = 0;
  wsServerUrl = null;
  wsAccessToken = null;
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

// Lazily read current notification settings from ui.toml
let _cachedNotifSettings = null;
function getNotifSetting(key) {
  if (_cachedNotifSettings === null) {
    try { _cachedNotifSettings = readUiToml(); } catch (_) { _cachedNotifSettings = {}; }
  }
  return _cachedNotifSettings[key] || "";
}

async function tryReconnectWebSocket() {
  if (!wsServerUrl || !wsAccessToken) return false;

  try {
    const healthUrl = wsServerUrl.replace(/\/+$/, "") + "/api/v1/health";
    const healthRes = await fetch(healthUrl, {
      method: "HEAD",
      signal: AbortSignal.timeout(5000),
    });

    if (!healthRes.ok) return false;

    connectWebSocket(wsServerUrl, wsAccessToken);
    return true;
  } catch (_) {
    return false;
  }
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
    "notification_poll_interval", "notification_query_window",
    "notification_silent", "notification_timeout"
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
      _cachedNotifSettings = null;  // refresh cache after write
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

  ipcMain.handle("notification:ws-connect", async (_event, settings) => {
    // Mutually exclusive: close polling when switching to WebSocket
    stopNotificationPolling();
    disconnectWebSocket();
    try {
      connectWebSocket(settings.server_url, settings.access_token);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("notification:ws-disconnect", () => {
    disconnectWebSocket();
    return { ok: true };
  });

  createWindow();
  createTray();

  // Register global hotkey if enabled in settings
  try {
    const settings = readUiToml();
    if (settings.global_hotkey_enabled === "true" && settings.global_hotkey) {
      registerGlobalHotkey(settings.global_hotkey);
    }
    // Start notification push (WebSocket preferred, polling as fallback)
    if (settings.server_url && settings.access_token) {
      try {
        connectWebSocket(settings.server_url, settings.access_token);
        console.log("Notification mode: websocket");
      } catch {
        startNotificationPolling(settings);
        console.log("Notification mode: poll (websocket unavailable)");
      }
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
