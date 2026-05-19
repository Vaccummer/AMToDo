import { readFileSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
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

function renameHtmlPlugin(outDir: string, from: string, to: string): Plugin {
  return {
    name: "rename-html",
    closeBundle() {
      try {
        renameSync(resolve(outDir, from), resolve(outDir, to));
      } catch { /* file may not exist */ }
    },
  };
}

const uiConfig = readUiConfig();

export default defineConfig(({ mode }) => {
  const isMobile = mode === "mobile";

  return {
    plugins: [
      react(),
      ...(isMobile ? [renameHtmlPlugin(resolve(__dirname, "dist-mobile"), "mobile.html", "index.html")] : []),
    ],
    base: "./",
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true
    },
    build: {
      outDir: isMobile ? "dist-mobile" : "dist",
      emptyOutDir: true,
      rollupOptions: {
        input: isMobile
          ? { main: resolve(__dirname, "mobile.html") }
          : { main: resolve(__dirname, "index.html") },
      },
    },
    define: {
      __UI_SERVER_URL__: JSON.stringify(uiConfig.server_url ?? "http://127.0.0.1:8000"),
      __UI_ACCESS_TOKEN__: JSON.stringify(uiConfig.access_token ?? "")
    }
  };
});
