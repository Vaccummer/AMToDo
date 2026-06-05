import { renameSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

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
      strictPort: true,
      watch: {
        ignored: ["**/dist/**", "**/dist-mobile/**"]
      }
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
      __UI_SERVER_URL__: JSON.stringify(process.env.AMTODO_UI_SERVER_URL ?? ""),
      __UI_ACCESS_TOKEN__: JSON.stringify("")
    }
  };
});
