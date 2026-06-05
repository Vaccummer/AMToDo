const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const appExe = path.resolve(projectRoot, "..", "bin", "desktop", "win-unpacked", "AMToDo.exe");
const iconPath = path.resolve(projectRoot, "src", "assets", "app-tray.ico");
const rceditPath = path.resolve(projectRoot, "node_modules", "electron-winstaller", "vendor", "rcedit.exe");

for (const filePath of [appExe, iconPath, rceditPath]) {
  if (!fs.existsSync(filePath)) {
    console.error(`Missing required file: ${filePath}`);
    process.exit(1);
  }
}

const result = spawnSync(rceditPath, [appExe, "--set-icon", iconPath], {
  stdio: "inherit",
  windowsHide: true,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 0);
