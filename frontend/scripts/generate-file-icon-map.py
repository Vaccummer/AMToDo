from __future__ import annotations

import json
import pathlib
import tomllib


ROOT = pathlib.Path(__file__).resolve().parents[1]
ICON_ROOT = ROOT / "src" / "assets" / "file-icons"
OUT_PATH = ROOT / "src" / "lib" / "file-icon-map.ts"


def normalize_ext(ext: str) -> str:
    ext = ext.strip().lower()
    return ext if ext.startswith(".") else f".{ext}"


def compact_svg(svg: str) -> str:
    return " ".join(svg.split())


def main() -> None:
    data = tomllib.loads((ICON_ROOT / "index.toml").read_text(encoding="utf-8"))
    default_svg = compact_svg(data["option"]["default"])
    icon_by_ext: dict[str, str] = {}

    for key, extensions in data["map_dict"].items():
        svg_path = ICON_ROOT / "svg" / f"{key}.svg"
        svg = compact_svg(svg_path.read_text(encoding="utf-8")) if svg_path.exists() else default_svg
        for ext in extensions:
            icon_by_ext[normalize_ext(ext)] = svg

    lines = [
        "// Generated from frontend/src/assets/file-icons/index.toml and svg/*.svg.",
        "// Run `python scripts/generate-file-icon-map.py` from frontend/ after changing file icon sources.",
        "",
        f"export const DEFAULT_FILE_ICON_SVG = {json.dumps(default_svg, ensure_ascii=False)};",
        "",
        "export const FILE_ICON_BY_EXTENSION: Record<string, string> = Object.freeze(",
        json.dumps(icon_by_ext, ensure_ascii=False, indent=2),
        ");",
        "",
        "export function getFileIconSvg(filename: string): string {",
        "  const cleanName = filename.split(/[\\\\/]/).pop() ?? filename;",
        "  const lower = cleanName.toLowerCase();",
        '  const dotIndex = lower.lastIndexOf(".");',
        "  if (dotIndex > 0) {",
        "    const ext = lower.slice(dotIndex);",
        "    const icon = FILE_ICON_BY_EXTENSION[ext];",
        "    if (icon) return icon;",
        "  }",
        '  const exactIcon = FILE_ICON_BY_EXTENSION[lower.startsWith(".") ? lower : `.${lower}`];',
        "  return exactIcon ?? DEFAULT_FILE_ICON_SVG;",
        "}",
        "",
    ]
    OUT_PATH.write_text("\n".join(lines), encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()
