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
  content: ArrayBuffer,
  headers: Record<string, string>,
  onProgress?: (progress: UploadProgress) => void,
  abortSignal?: AbortSignal,
): Promise<UploadResult<T>> {
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
