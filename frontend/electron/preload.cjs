const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("amtodoShell", {
  minimize: () => ipcRenderer.invoke("window:minimize"),
  toggleMaximize: () => ipcRenderer.invoke("window:toggle-maximize"),
  close: () => ipcRenderer.invoke("window:close"),
  isMaximized: () => ipcRenderer.invoke("window:is-maximized"),
  onMaximizedChange: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("window:maximized", listener);
    return () => ipcRenderer.removeListener("window:maximized", listener);
  },
  readSettings: () => ipcRenderer.invoke("settings:read"),
  writeSettings: (settings) => ipcRenderer.invoke("settings:write", settings),
  registerHotkey: (accelerator) => ipcRenderer.invoke("hotkey:register", accelerator),
  unregisterHotkey: () => ipcRenderer.invoke("hotkey:unregister"),
  startNotificationPolling: (settings) => ipcRenderer.invoke("notification:start-polling", settings),
  stopNotificationPolling: () => ipcRenderer.invoke("notification:stop-polling"),
  connectNotificationWebSocket: (settings) => ipcRenderer.invoke("notification:ws-connect", settings),
  disconnectNotificationWebSocket: () => ipcRenderer.invoke("notification:ws-disconnect"),
  onNotificationClicked: (callback) => {
    const listener = (_event, notificationId) => callback(notificationId);
    ipcRenderer.on("notification:clicked", listener);
    return () => ipcRenderer.removeListener("notification:clicked", listener);
  }
});
