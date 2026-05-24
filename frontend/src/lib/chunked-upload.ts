export interface UploadProgress {
  loaded: number;
  total: number;
  percent: number;
}

export interface UploadResult<T = unknown> {
  ok: boolean;
  attachment: T;
}

export function uploadWithProgress<T = unknown>(
  url: string,
  cipher: ArrayBuffer,
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
    xhr.send(cipher);
  });
}
