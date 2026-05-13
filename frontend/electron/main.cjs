const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage } = require("electron");
const path = require("node:path");

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

let mainWindow = null;
let tray = null;
let forceQuit = false;

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

app.whenReady().then(() => {
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

  createWindow();
  createTray();

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
});
