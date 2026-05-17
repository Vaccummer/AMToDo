import type { Theme, ThemeNode } from "./types";

const themeModules = import.meta.glob<Theme>("./*.json", { eager: true });

const themes: Record<string, Theme> = {};
for (const path in themeModules) {
  const theme = themeModules[path];
  themes[theme.name] = theme;
}

export const DEFAULT_THEME = "warm-light";

export function listThemes(): string[] {
  return Object.keys(themes);
}

export function getTheme(name: string): Theme {
  return themes[name] ?? themes[DEFAULT_THEME];
}

/**
 * Flatten a nested theme object into CSS variable entries.
 * Keys named "_comment" are skipped.
 * Example: { global: { shell: { bg: "#f3f0eb" } } } → [ ["--global-shell-bg", "#f3f0eb"] ]
 */
function flattenTheme(node: ThemeNode, prefix: string): [string, string][] {
  const entries: [string, string][] = [];
  if (typeof node === "string") {
    entries.push([prefix, node]);
  } else {
    for (const [key, value] of Object.entries(node)) {
      if (key === "_comment") continue;
      const varName = prefix ? `${prefix}-${key}` : `--${key}`;
      entries.push(...flattenTheme(value, varName));
    }
  }
  return entries;
}

let scrollbarStyleEl: HTMLStyleElement | null = null;

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;

  // Flatten all groups except "name" into CSS variable pairs
  for (const [group, value] of Object.entries(theme)) {
    if (group === "name" || typeof value === "string") continue;
    const entries = flattenTheme(value, `--${group}`);
    for (const [varName, color] of entries) {
      root.style.setProperty(varName, color);
    }
  }

  // Inject scrollbar styles via <style> element
  const scrollbar = (theme.components as Record<string, ThemeNode>)
    ?.scrollbar as Record<string, string> | undefined;
  if (scrollbar) {
    if (!scrollbarStyleEl) {
      scrollbarStyleEl = document.createElement("style");
      scrollbarStyleEl.id = "theme-scrollbar";
      document.head.appendChild(scrollbarStyleEl);
    }
    scrollbarStyleEl.textContent = `
      ::-webkit-scrollbar-thumb { background: ${scrollbar.thumb}; }
      ::-webkit-scrollbar-thumb:hover { background: ${scrollbar["thumb-hover"]}; }
    `;
  }
}
