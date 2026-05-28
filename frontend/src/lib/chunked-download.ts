import { Capacitor, CapacitorHttp } from "@capacitor/core";

export interface DownloadProgress {
  loaded: number;
  total: number;
  percent: number;
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function asArrayBuffer(data: unknown): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data;
  if (typeof data === "string") return base64ToArrayBuffer(data);
  if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView;
    const copy = new Uint8Array(view.byteLength);
    copy.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
    return copy.buffer;
  }
  throw new Error("Download failed: invalid binary response");
}

async function nativeDownloadWithProgress(
  url: string,
  onProgress?: (progress: DownloadProgress) => void,
  abortSignal?: AbortSignal,
): Promise<ArrayBuffer> {
  if (abortSignal?.aborted) throw new Error("Download aborted");
  onProgress?.({ loaded: 0, total: 0, percent: 0 });
  const response = await CapacitorHttp.get({
    url,
    responseType: "arraybuffer",
    connectTimeout: 30_000,
    readTimeout: 600_000,
  });
  if (abortSignal?.aborted) throw new Error("Download aborted");
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Download failed: ${response.status}`);
  }
  const buffer = asArrayBuffer(response.data);
  onProgress?.({ loaded: buffer.byteLength, total: buffer.byteLength, percent: 100 });
  return buffer;
}

export async function downloadWithProgress(
  url: string,
  onProgress?: (progress: DownloadProgress) => void,
  abortSignal?: AbortSignal,
): Promise<ArrayBuffer> {
  if (Capacitor.isNativePlatform()) {
    return nativeDownloadWithProgress(url, onProgress, abortSignal);
  }

  const resp = await fetch(url, { signal: abortSignal });
  if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);

  const contentLength = Number(resp.headers.get("Content-Length") || 0);
  const reader = resp.body!.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress?.({
      loaded,
      total: contentLength,
      percent: contentLength ? Math.round((loaded / contentLength) * 100) : 0,
    });
  }

  // Validate that we received at least the expected bytes (truncated download check).
  if (contentLength > 0 && loaded < contentLength) {
    throw new Error(`Download incomplete: received ${loaded} of ${contentLength} bytes`);
  }

  const result = new Uint8Array(loaded);
  let offset = 0;
  for (let i = 0; i < chunks.length; i++) {
    result.set(chunks[i], offset);
    offset += chunks[i].length;
    chunks[i] = null!;
  }
  return result.buffer;
}
