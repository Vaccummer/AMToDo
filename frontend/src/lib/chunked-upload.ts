import { CapacitorHttp } from "@capacitor/core";

export interface UploadProgress {
  loaded: number;
  total: number;
  percent: number;
  phase?: "uploading";
}

export interface UploadResult<T = unknown> {
  ok: boolean;
  attachment: T;
}

type UploadBody = XMLHttpRequestBodyInit;

function isCapacitorNative(): boolean {
  const cap = window.Capacitor;
  if (!cap) return false;
  if (typeof cap.isNativePlatform === "function") return cap.isNativePlatform();
  return !!cap.isNativePlatform;
}

function uploadBodySize(content: UploadBody): number {
  if (content instanceof Blob) return content.size;
  if (content instanceof ArrayBuffer) return content.byteLength;
  if (ArrayBuffer.isView(content)) return content.byteLength;
  if (typeof content === "string") return new Blob([content]).size;
  return 0;
}

async function uploadWithFetch<T = unknown>(
  url: string,
  content: UploadBody,
  headers: Record<string, string>,
  onProgress?: (progress: UploadProgress) => void,
  abortSignal?: AbortSignal,
): Promise<UploadResult<T>> {
  const total = uploadBodySize(content);
  onProgress?.({ loaded: 0, total, percent: 0, phase: "uploading" });
  const response = await fetch(url, {
    method: "PUT",
    body: content,
    headers,
    signal: abortSignal,
  });

  const text = await response.text();
  if (!response.ok) {
    let message = `Upload failed: ${response.status}`;
    try {
      const payload = JSON.parse(text);
      message = payload?.error?.message ?? payload?.detail ?? message;
    } catch {
      if (text) message = `${message} ${text}`;
    }
    throw new Error(message);
  }

  onProgress?.({ loaded: total, total, percent: 100, phase: "uploading" });
  return JSON.parse(text) as UploadResult<T>;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function uploadWithNativeHttp<T = unknown>(
  url: string,
  content: UploadBody,
  headers: Record<string, string>,
  onProgress?: (progress: UploadProgress) => void,
): Promise<UploadResult<T>> {
  if (!(content instanceof Blob)) {
    return uploadWithFetch(url, content, headers, onProgress);
  }

  const total = content.size;
  onProgress?.({ loaded: 0, total, percent: 0, phase: "uploading" });
  const response = await CapacitorHttp.put({
    url,
    headers,
    data: await blobToBase64(content),
    dataType: "file",
    responseType: "json",
    connectTimeout: 30_000,
    readTimeout: 600_000,
  });

  if (response.status < 200 || response.status >= 300) {
    const data = response.data;
    const message = typeof data === "object" && data !== null
      ? (data.error?.message ?? data.detail ?? `Upload failed: ${response.status}`)
      : `Upload failed: ${response.status}${data ? ` ${String(data)}` : ""}`;
    throw new Error(message);
  }

  onProgress?.({ loaded: total, total, percent: 100, phase: "uploading" });
  return response.data as UploadResult<T>;
}

/**
 * Upload a ReadableStream with progress.
 * The stream is accumulated into an ArrayBuffer because XHR upload progress
 * events are still more widely supported than fetch upload progress.
 */
export async function streamingUpload<T = unknown>(
  url: string,
  body: ReadableStream<Uint8Array>,
  onProgress?: (progress: UploadProgress) => void,
  abortSignal?: AbortSignal,
): Promise<UploadResult<T>> {
  // Accumulate chunks from the stream.
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = body.getReader();
  while (true) {
    if (abortSignal?.aborted) {
      reader.cancel();
      throw new Error("Upload aborted");
    }
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }

  const content = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    content.set(chunk, offset);
    offset += chunk.length;
  }

  // Upload via XHR (supports progress events, unlike fetch)
  return uploadWithProgress<T>(
    url,
    content.buffer,
    { "Content-Type": "application/octet-stream" },
    onProgress,
    abortSignal,
  );
}

/**
 * XHR-based upload for an ArrayBuffer.
 */
export function uploadWithProgress<T = unknown>(
  url: string,
  content: UploadBody,
  headers: Record<string, string>,
  onProgress?: (progress: UploadProgress) => void,
  abortSignal?: AbortSignal,
): Promise<UploadResult<T>> {
  if (isCapacitorNative()) {
    if (abortSignal?.aborted) return Promise.reject(new Error("Upload aborted"));
    return uploadWithNativeHttp(url, content, headers, onProgress);
  }

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);

    for (const [k, v] of Object.entries(headers)) {
      xhr.setRequestHeader(k, v);
    }

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress?.({
          loaded: e.loaded,
          total: e.total,
          percent: Math.round((e.loaded / e.total) * 100),
          phase: "uploading",
        });
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        reject(new Error(`Upload failed: ${xhr.status}`));
      }
    };

    xhr.onerror = () => reject(new Error("Upload network error"));
    xhr.ontimeout = () => reject(new Error("Upload timed out"));
    xhr.onabort = () => reject(new Error("Upload aborted"));

    if (abortSignal) {
      abortSignal.addEventListener("abort", () => xhr.abort());
    }

    xhr.responseType = "text";
    xhr.timeout = 600_000; // 10 min — large files on slow mobile networks
    xhr.send(content);
  });
}
