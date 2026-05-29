import { Filesystem, Directory } from "@capacitor/filesystem";

const ATTACHMENT_CACHE_DIR = "attachment-cache";
const MEDIA_EXTS = new Set([
  "jpg",
  "jpeg",
  "png",
  "heic",
  "heif",
  "webp",
  "gif",
  "mp4",
  "mov",
  "m4v",
  "webm",
  "3gp",
  "3gpp",
]);

const CAPTURE_NAME_RE = /(^|[_.-])(photo|video|img|vid|camera|capture|record|temp|tmp)([_.-]|\d|$)/i;

type TempMediaStats = {
  count: number;
  bytes: number;
};

type TempMediaEntry = {
  path: string;
  bytes: number;
};

function joinPath(base: string, name: string): string {
  return base && base !== "." ? `${base}/${name}` : name;
}

function fileExt(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(idx + 1).toLowerCase() : "";
}

function isCaptureTempMedia(path: string): boolean {
  const name = path.split("/").pop() ?? path;
  const ext = fileExt(name);
  if (!MEDIA_EXTS.has(ext)) return false;
  const lowerPath = path.toLowerCase();
  return CAPTURE_NAME_RE.test(name) || lowerPath.includes("/camera/") || lowerPath.includes("/capture/") || lowerPath.includes("/temp/");
}

async function collectTempMedia(dirPath = "."): Promise<TempMediaEntry[]> {
  let listing;
  try {
    listing = await Filesystem.readdir({ path: dirPath, directory: Directory.Cache });
  } catch {
    return [];
  }

  const entries: TempMediaEntry[] = [];
  for (const file of listing.files) {
    const fullPath = joinPath(dirPath, file.name);
    if (fullPath === ATTACHMENT_CACHE_DIR || fullPath.startsWith(`${ATTACHMENT_CACHE_DIR}/`)) {
      continue;
    }

    if (file.type === "directory") {
      entries.push(...await collectTempMedia(fullPath));
      continue;
    }

    if (!isCaptureTempMedia(fullPath)) continue;
    try {
      const stat = await Filesystem.stat({ path: fullPath, directory: Directory.Cache });
      entries.push({ path: fullPath, bytes: stat.size ?? 0 });
    } catch {
      entries.push({ path: fullPath, bytes: 0 });
    }
  }
  return entries;
}

export async function getCaptureTempMediaSize(): Promise<TempMediaStats> {
  const entries = await collectTempMedia();
  return {
    count: entries.length,
    bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
  };
}

export async function clearCaptureTempMedia(): Promise<void> {
  const entries = await collectTempMedia();
  await Promise.all(entries.map((entry) =>
    Filesystem.deleteFile({ path: entry.path, directory: Directory.Cache }).catch(() => {})
  ));
}
