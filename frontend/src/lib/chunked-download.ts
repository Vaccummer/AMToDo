export interface DownloadProgress {
  loaded: number;
  total: number;
  percent: number;
}

export async function downloadWithProgress(
  url: string,
  onProgress?: (progress: DownloadProgress) => void,
  abortSignal?: AbortSignal,
): Promise<ArrayBuffer> {
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
  // If received > expected, the server metadata may be stale — let the HMAC check catch corruption.
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
