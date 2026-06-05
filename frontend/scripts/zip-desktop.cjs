const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const pkg = require(path.join(projectRoot, "package.json"));
const desktopOut = path.resolve(projectRoot, "..", "bin", "desktop");
const unpackedDir = path.join(desktopOut, "win-unpacked");
const zipPath = path.join(desktopOut, `AMToDo-${pkg.version}-win-x64.zip`);

if (!fs.existsSync(unpackedDir)) {
  console.error(`Missing desktop package directory: ${unpackedDir}`);
  process.exit(1);
}
if (fs.existsSync(zipPath)) {
  fs.rmSync(zipPath, { force: true });
}

const command = [
  "$ErrorActionPreference = 'Stop'",
  `Compress-Archive -Path ${JSON.stringify(path.join(unpackedDir, "*"))} -DestinationPath ${JSON.stringify(zipPath)} -Force`,
  `Write-Output ${JSON.stringify(zipPath)}`,
].join("; ");

const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], {
  stdio: "inherit",
  windowsHide: true,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 0);
