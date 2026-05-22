import { CapacitorShell } from "./capacitor";

export function initShell(): void {
  if (window.amtodoShell) return;

  // In mobile build, always create the shell — the build is exclusively for native
  // Runtime availability of Capacitor plugins is handled by try/catch in each method
  if (import.meta.env.MODE === "mobile" || isCapacitorNative()) {
    window.amtodoShell = new CapacitorShell();
    patchFetchForNativeHttp();
  }
}

function isCapacitorNative(): boolean {
  const cap = window.Capacitor;
  if (!cap) return false;
  if (typeof cap.isNativePlatform === "function") return cap.isNativePlatform();
  return !!cap.isNativePlatform;
}

/**
 * Patch window.fetch to use the native Capacitor HTTP plugin.
 * This bypasses the WebView's CORS enforcement for all cross-origin requests.
 */
function patchFetchForNativeHttp(): void {
  import("@capacitor-community/http").then(({ Http }) => {
    const originalFetch = window.fetch.bind(window);

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === "string" ? input
        : input instanceof URL ? input.href
        : input.url;

      // Let localhost requests go through the normal fetch (Capacitor's local server)
      if (url.startsWith("http://localhost") || url.startsWith("https://localhost")) {
        return originalFetch(input, init);
      }

      // Route all other requests through native HTTP (bypasses CORS)
      const method = (init?.method ?? "GET").toUpperCase();

      try {
        // Normalize headers: Headers object → plain object for Capacitor plugin
        let headers: Record<string, string> = {};
        if (init?.headers) {
          if (init.headers instanceof Headers) {
            init.headers.forEach((v, k) => { headers[k] = v; });
          } else if (Array.isArray(init.headers)) {
            for (const [k, v] of init.headers) headers[k] = v;
          } else {
            headers = init.headers as Record<string, string>;
          }
        }

        const options: Parameters<typeof Http.request>[0] = {
          url,
          method: method as "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD",
          headers,
          params: {},
          responseType: "text",
        };

        // Attach body for non-GET/HEAD requests
        if (init?.body && method !== "GET" && method !== "HEAD") {
          options.data = typeof init.body === "string" ? init.body : JSON.stringify(init.body);
        }

        const result = await Http.request(options);

        // Capacitor HTTP plugin may return already-parsed objects for JSON responses.
        // Response body must be a string for Response.json() to work.
        const body = typeof result.data === "string" ? result.data : JSON.stringify(result.data);

        return new Response(body, {
          status: result.status,
          headers: result.headers as Record<string, string>,
        });
      } catch (err: unknown) {
        // Convert native error to a TypeError like fetch() would throw on network failure
        throw new TypeError(err instanceof Error ? err.message : "Network request failed");
      }
    };

    console.log("[AMToDo] fetch() patched to use native HTTP bridge");
  }).catch((err) => {
    console.warn("[AMToDo] Failed to load native HTTP plugin, falling back to WebView fetch:", err);
  });
}
