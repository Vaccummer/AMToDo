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
  showSystemNotification: (params) => ipcRenderer.invoke("notification:show", params),
  selectAttachmentDownloadRoot: () => ipcRenderer.invoke("attachment-cache:select-root"),
  getDefaultAttachmentDownloadRoot: () => ipcRenderer.invoke("attachment-cache:default-root"),
  getAttachmentCacheEntry: (entry) => ipcRenderer.invoke("attachment-cache:get", entry),
  appendAttachmentCacheChunk: (entry, data) => ipcRenderer.invoke("attachment-cache:append", entry, data),
  finalizeAttachmentCacheEntry: (entry) => ipcRenderer.invoke("attachment-cache:finalize", entry),
  deleteAttachmentCacheEntry: (entry) => ipcRenderer.invoke("attachment-cache:delete", entry),
  clearAttachmentDownloadCache: (root) => ipcRenderer.invoke("attachment-cache:clear-root", root),
  getAttachmentDownloadCacheSize: (root) => ipcRenderer.invoke("attachment-cache:size-root", root),
  readAttachmentTextPreview: (entry, maxBytes) => ipcRenderer.invoke("attachment-cache:read-text", entry, maxBytes),
  openAttachmentCacheFolder: (entry) => ipcRenderer.invoke("attachment-cache:open-folder", entry),
  onNotificationClicked: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on("notification:clicked", listener);
    return () => ipcRenderer.removeListener("notification:clicked", listener);
  },
});
