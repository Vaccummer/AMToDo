import { Capacitor, registerPlugin } from "@capacitor/core";
import type { PluginListenerHandle } from "@capacitor/core";
import type { UploadProgress, UploadResult } from "./chunked-upload";

export type NativeAttachmentFile = {
  uri: string;
  name: string;
  mimeType: string | null;
  size: number;
};

export type CaptureTempMediaStats = {
  count: number;
  bytes: number;
  photoCount: number;
  videoCount: number;
};

type NativeUploadProgress = UploadProgress & { uploadId: string };
type NativeDownloadProgress = {
  downloadId: string;
  loaded: number;
  total: number;
  percent: number;
};

type NativeAttachmentPlugin = {
  pickFiles(options: { accept?: string; multiple?: boolean }): Promise<{ files: NativeAttachmentFile[] }>;
  capturePhoto(options?: { locale?: string }): Promise<{ file?: NativeAttachmentFile | null }>;
  captureVideo(options?: { locale?: string }): Promise<{ file?: NativeAttachmentFile | null }>;
  upload<T = unknown>(options: {
    uploadId: string;
    uri: string;
    url: string;
    contentType: string;
    size: number;
    headers: Record<string, string>;
  }): Promise<UploadResult<T>>;
  cancelUpload(options: { uploadId: string }): Promise<{ ok: boolean }>;
  download(options: {
    downloadId: string;
    url: string;
    cachePath: string;
    title?: string;
    totalSize?: number;
    headers?: Record<string, string>;
  }): Promise<{ ok: boolean; uri: string }>;
  cancelDownload(options: { downloadId: string }): Promise<{ ok: boolean }>;
  getCaptureTempMediaStats(): Promise<CaptureTempMediaStats>;
  clearCaptureTempMedia(): Promise<{ ok: boolean } & CaptureTempMediaStats>;
  addListener(
    eventName: "uploadProgress",
    listenerFunc: (progress: NativeUploadProgress) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: "downloadProgress",
    listenerFunc: (progress: NativeDownloadProgress) => void,
  ): Promise<PluginListenerHandle>;
};

const NativeAttachment = registerPlugin<NativeAttachmentPlugin>("NativeAttachment");

export function isNativeAttachmentUploadAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

export function isNativeAttachmentDownloadAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

export async function pickNativeAttachmentFiles(options: { accept?: string; multiple?: boolean } = {}): Promise<NativeAttachmentFile[]> {
  const result = await NativeAttachment.pickFiles({
    accept: options.accept ?? "*/*",
    multiple: options.multiple ?? true,
  });
  return result.files;
}

export async function captureNativeAttachmentMedia(kind: "photo" | "video", locale?: string): Promise<NativeAttachmentFile | null> {
  const options = locale ? { locale } : undefined;
  const result = kind === "photo"
    ? await NativeAttachment.capturePhoto(options)
    : await NativeAttachment.captureVideo(options);
  return result.file ?? null;
}

export async function getNativeCaptureTempMediaStats(): Promise<CaptureTempMediaStats> {
  return NativeAttachment.getCaptureTempMediaStats();
}

export async function clearNativeCaptureTempMedia(): Promise<CaptureTempMediaStats> {
  const result = await NativeAttachment.clearCaptureTempMedia();
  return {
    count: result.count,
    bytes: result.bytes,
    photoCount: result.photoCount,
    videoCount: result.videoCount,
  };
}

export async function uploadNativeAttachmentWithProgress<T = unknown>(
  url: string,
  file: NativeAttachmentFile,
  headers: Record<string, string>,
  onProgress?: (progress: UploadProgress) => void,
  abortSignal?: AbortSignal,
): Promise<UploadResult<T>> {
  const uploadId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let aborted = false;

  const listener = await NativeAttachment.addListener("uploadProgress", (progress) => {
    if (progress.uploadId !== uploadId) return;
    const total = Math.max(progress.total, 0);
    onProgress?.({
      loaded: progress.loaded,
      total,
      percent: progress.percent,
      phase: progress.percent >= 100 ? "processing" : "uploading",
    });
  });

  const abort = () => {
    aborted = true;
    NativeAttachment.cancelUpload({ uploadId }).catch(() => {});
  };

  if (abortSignal?.aborted) {
    await listener.remove();
    throw new Error("Upload aborted");
  }
  abortSignal?.addEventListener("abort", abort, { once: true });

  try {
    const total = Math.max(file.size, 0);
    onProgress?.({ loaded: 0, total, percent: 0, phase: "uploading" });
    const result = await NativeAttachment.upload<T>({
      uploadId,
      uri: file.uri,
      url,
      contentType: file.mimeType || "application/octet-stream",
      size: file.size,
      headers,
    });
    if (aborted) throw new Error("Upload aborted");
    onProgress?.({ loaded: total, total, percent: 100, phase: "processing" });
    return result;
  } finally {
    abortSignal?.removeEventListener("abort", abort);
    await listener.remove();
  }
}

export async function downloadNativeAttachmentWithProgress(
  url: string,
  cachePath: string,
  title: string,
  totalSize: number,
  onProgress?: (progress: { loaded: number; total: number; percent: number }) => void,
  abortSignal?: AbortSignal,
  headers: Record<string, string> = {},
): Promise<{ uri: string }> {
  const downloadId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let aborted = false;

  const listener = await NativeAttachment.addListener("downloadProgress", (progress) => {
    if (progress.downloadId !== downloadId) return;
    onProgress?.({
      loaded: progress.loaded,
      total: progress.total,
      percent: progress.percent,
    });
  });

  const abort = () => {
    aborted = true;
    NativeAttachment.cancelDownload({ downloadId }).catch(() => {});
  };

  if (abortSignal?.aborted) {
    await listener.remove();
    throw new Error("Download aborted");
  }
  abortSignal?.addEventListener("abort", abort, { once: true });

  try {
    onProgress?.({ loaded: 0, total: Math.max(totalSize, 0), percent: 0 });
    const result = await NativeAttachment.download({
      downloadId,
      url,
      cachePath,
      title,
      totalSize,
      headers,
    });
    if (aborted) throw new Error("Download aborted");
    onProgress?.({ loaded: Math.max(totalSize, 0), total: Math.max(totalSize, 0), percent: 100 });
    return { uri: result.uri };
  } finally {
    abortSignal?.removeEventListener("abort", abort);
    await listener.remove();
  }
}
