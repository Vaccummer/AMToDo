import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

function readUiConfig(): Record<string, string> {
  const configPath = resolve(__dirname, "..", "config", "ui.toml");
  const raw = readFileSync(configPath, "utf-8");
  const entries: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*(\w+)\s*=\s*"([^"]*)"\s*(?:#.*)?$/);
    if (m) entries[m[1]] = m[2];
  }
  return entries;
}

const uiConfig = readUiConfig();

export default defineConfig({
  plugins: [react()],
  base: "./",
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: "dist",
    emptyOutDir: true
  },
  define: {
    __UI_SERVER_URL__: JSON.stringify(uiConfig.server_url ?? "http://127.0.0.1:8000"),
    __UI_ACCESS_TOKEN__: JSON.stringify(uiConfig.access_token ?? "")
  }
});
