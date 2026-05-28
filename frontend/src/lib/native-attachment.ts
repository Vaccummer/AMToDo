import { Capacitor, registerPlugin } from "@capacitor/core";
import type { PluginListenerHandle } from "@capacitor/core";
import type { UploadProgress, UploadResult } from "./chunked-upload";

export type NativeAttachmentFile = {
  uri: string;
  name: string;
  mimeType: string | null;
  size: number;
};

type NativeUploadProgress = UploadProgress & { uploadId: string };

type NativeAttachmentPlugin = {
  pickFiles(options: { accept?: string; multiple?: boolean }): Promise<{ files: NativeAttachmentFile[] }>;
  upload<T = unknown>(options: {
    uploadId: string;
    uri: string;
    url: string;
    contentType: string;
    size: number;
    headers: Record<string, string>;
  }): Promise<UploadResult<T>>;
  cancelUpload(options: { uploadId: string }): Promise<{ ok: boolean }>;
  addListener(
    eventName: "uploadProgress",
    listenerFunc: (progress: NativeUploadProgress) => void,
  ): Promise<PluginListenerHandle>;
};

const NativeAttachment = registerPlugin<NativeAttachmentPlugin>("NativeAttachment");

export function isNativeAttachmentUploadAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

export async function pickNativeAttachmentFiles(options: { accept?: string; multiple?: boolean } = {}): Promise<NativeAttachmentFile[]> {
  const result = await NativeAttachment.pickFiles({
    accept: options.accept ?? "*/*",
    multiple: options.multiple ?? true,
  });
  return result.files;
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
      phase: "uploading",
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
    onProgress?.({ loaded: total, total, percent: 100, phase: "uploading" });
    return result;
  } finally {
    abortSignal?.removeEventListener("abort", abort);
    await listener.remove();
  }
}
