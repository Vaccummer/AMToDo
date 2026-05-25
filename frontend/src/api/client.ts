import { SERVER_URL } from "../config";
import type { UiWsClient } from "./ws-client";
import type { UploadProgress } from "../lib/chunked-upload";
import { streamingUpload } from "../lib/chunked-upload";
import type { DownloadProgress } from "../lib/chunked-download";
import { downloadWithProgress } from "../lib/chunked-download";
import { generateFileKeys, createEncryptStream } from "../lib/stream-crypto";

export type HealthResponse = {
  status: string;
  version: string;
  name?: string;
  public_key?: string;
  public_key_fingerprint?: string;
  ipv4?: string;
  ipv6?: string;
  bind?: string[];
  limits: {
    max_attachment_size_bytes: number;
  };
};

export type UserResponse = {
  ok: boolean;
  user: {
    id: number;
    name: string;
    token: string;
    created_at: number;
  };
};

export type TodoItem = {
  id: number;
  title: string;
  description: string | null;
  planned_at: number | null;
  due_at: number | null;
  completed: boolean;
  priority: number;
  tag: string | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
  deleted_at?: number | null;
  attachment_count?: number;
  extra_fields?: Record<string, string> | null;
};

export type TodoListResponse = {
  ok: boolean;
  filter: { completed: boolean | null };
  count: number;
  todos: TodoItem[];
  range?: { start_at: number | null; end_at: number | null };
};

export type TodoResponse = {
  ok: boolean;
  todo: TodoItem;
};

export type TodoSearchResponse = {
  ok: boolean;
  query: string;
  use_regex: boolean;
  ignore_case: boolean;
  fields: string[];
  range: {
    planned_start_at: number | null;
    planned_end_at: number | null;
    due_start_at: number | null;
    due_end_at: number | null;
    created_start_at: number | null;
    created_end_at: number | null;
    updated_start_at: number | null;
    updated_end_at: number | null;
  };
  filter: {
    completed: boolean | null;
    priority_min: number | null;
    priority_max: number | null;
    tag: string | null;
  };
  sort: { by: string; order: string };
  pagination: { limit: number; offset: number; has_more: boolean };
  total: number;
  count: number;
  todos: TodoItem[];
};

export type TodoStatsResponse = {
  ok: boolean;
  range: { start_at: number | null; end_at: number | null };
  stats: {
    total: number;
    completed: number;
    rate: number;
    by_priority: Record<string, number>;
  };
};

export type AttachmentMetadata = {
  id: number;
  user_id: number;
  todo_id: number;
  file_index: number;
  filename: string;
  mime_type: string;
  preview_kind: "image" | "video" | "none";
  plain_size_bytes: number;
  cipher_size_bytes: number;
  plain_sha256: string;
  cipher_sha256: string;
  file_key: string;
  nonce: string;
  encryption_alg: string;
  storage_path: string;
  is_orphaned: boolean;
  created_at: number;
  updated_at: number;
};

export type AttachmentResponse = {
  ok: boolean;
  attachment: AttachmentMetadata;
};

export type AttachmentListResponse = {
  ok: boolean;
  count: number;
  attachments: AttachmentMetadata[];
};

export type ScheduleAttachmentMetadata = {
  id: number;
  user_id: number;
  schedule_id: number;
  file_index: number;
  filename: string;
  mime_type: string;
  preview_kind: "image" | "video" | "none";
  plain_size_bytes: number;
  cipher_size_bytes: number;
  plain_sha256: string;
  cipher_sha256: string;
  file_key: string;
  nonce: string;
  encryption_alg: string;
  storage_path: string;
  is_orphaned: boolean;
  created_at: number;
  updated_at: number;
};

export type ScheduleAttachmentResponse = {
  ok: boolean;
  attachment: ScheduleAttachmentMetadata;
};

export type ScheduleAttachmentListResponse = {
  ok: boolean;
  count: number;
  attachments: ScheduleAttachmentMetadata[];
};

export type ScheduleItem = {
  id: number;
  title: string;
  description: string | null;
  start_at: number;
  end_at: number;
  duration: number;
  timezone: string;
  location: string | null;
  category: string | null;
  created_at: number;
  updated_at: number;
  deleted_at?: number | null;
  attachment_count?: number;
  extra_fields?: Record<string, string> | null;
};

export type ScheduleListResponse = {
  ok: boolean;
  range: { start_at: number; end_at: number };
  count: number;
  schedules: ScheduleItem[];
};

export type ScheduleResponse = {
  ok: boolean;
  schedule: ScheduleItem;
};

export type ScheduleSearchResponse = {
  ok: boolean;
  query: string;
  use_regex: boolean;
  ignore_case: boolean;
  fields: string[];
  range: {
    start_at: number | null;
    end_at: number | null;
    created_start_at: number | null;
    created_end_at: number | null;
    updated_start_at: number | null;
    updated_end_at: number | null;
  };
  filter: { category: string | null; location: string | null };
  sort: { by: string; order: string };
  pagination: { limit: number; offset: number; has_more: boolean };
  total: number;
  count: number;
  schedules: ScheduleItem[];
};

export type ScheduleStatsResponse = {
  ok: boolean;
  range: { start_at: number | null; end_at: number | null };
  stats: Record<string, unknown>;
};

export type ConflictResponse = {
  ok: boolean;
  range: { start_at: number; end_at: number };
  exclude_id: number | null;
  conflict: boolean;
  count: number;
  schedules: ScheduleItem[];
};

export type TargetResult = {
  target: number;
  ok: boolean;
  todo?: TodoItem;
  schedule?: ScheduleItem;
  error?: { type: string; message: string };
};

export type TargetsResponse = {
  ok: boolean;
  results: TargetResult[];
};

export type TrashListParams = {
  query?: string;
  start_at?: number | null;
  end_at?: number | null;
  limit?: number;
  offset?: number;
};

export type TodoTrashListResponse = {
  ok: boolean;
  count: number;
  total?: number;
  todos: TodoItem[];
};

export type ScheduleTrashListResponse = {
  ok: boolean;
  count: number;
  total?: number;
  schedules: ScheduleItem[];
};

export type ChangelogAction =
  | "create"
  | "update"
  | "delete"
  | "restore"
  | "purge"
  | "attachment_add"
  | "attachment_remove";

export type ChangelogEntry = {
  id: number;
  entity_id: number;
  action: ChangelogAction | string;
  changed_fields: string[];
  before_snapshot: Record<string, unknown> | null;
  after_snapshot: Record<string, unknown> | null;
  created_at: number;
};

export type ChangelogResponse = {
  ok: boolean;
  total: number;
  entries: ChangelogEntry[];
};

export type NotificationMentionItem = {
  id: number;
  target_type: "todo" | "schedule";
  target_id: number;
};

export type NotificationItem = {
  id: number;
  title: string;
  description: string | null;
  trigger_at: number;
  created_at: number;
  updated_at: number | null;
  deleted_at?: number | null;
  mentions: NotificationMentionItem[];
  extra_fields?: Record<string, string> | null;
};

export type NotificationResponse = {
  ok: boolean;
  notification: NotificationItem;
};

export type NotificationListResponse = {
  ok: boolean;
  count: number;
  notifications: NotificationItem[];
};

export type TodoUpdateRequest = {
  title?: string;
  description?: string | null;
  planned_at?: number | null;
  due_at?: number | null;
  priority?: number;
  tag?: string | null;
  extra_fields?: string | null;
};

export type ScheduleCreateParams = {
  title: string;
  start_at: number;
  end_at: number;
  description?: string | null;
  location?: string | null;
  category?: string | null;
  extra_fields?: Record<string, string> | null;
};

export type ScheduleUpdateRequest = {
  title?: string;
  start_at?: number | null;
  end_at?: number | null;
  description?: string | null;
  location?: string | null;
  category?: string | null;
  extra_fields?: string | null;
};

const DEFAULT_BASE_URL = SERVER_URL;
const KEY_ID = "server-key-v1";
export const API_NETWORK_STATUS_EVENT = "amtodo:api-network-status";

/** Convert REST path like "/api/v1/todos/list" to WS message type like "todo.list". */
function pathToWsType(path: string): string {
  const parts = path.replace(/^\/api\/v1\//, "").split("/");
  // Attachment paths: /api/v1/attachment/upload → attachment.upload
  if (parts.length >= 3 && parts[1] === "attachments") {
    return "attachment." + parts.slice(2).join(".").replace(/-/g, "_");
  }
  // Singularize resource: "todos" → "todo", "schedules" → "schedule", "notifications" → "notification"
  const resource = parts[0].replace(/s$/, "");
  return [resource, ...parts.slice(1)].join(".").replace(/-/g, "_");
}

export function notifyNetworkStatus(online: boolean, message?: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(API_NETWORK_STATUS_EVENT, {
      detail: { online, message }
    })
  );
}

const FETCH_TIMEOUT_MS = 5_000;

async function fetchWithNetworkStatus(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    return response;
  } catch (error: unknown) {
    if (controller.signal.aborted) {
      notifyNetworkStatus(false, "client.networkError");
      throw new Error(`Fetch timed out after ${FETCH_TIMEOUT_MS}ms`);
    }
    notifyNetworkStatus(false, error instanceof Error ? error.message : "client.networkError");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** Parse `extra_fields` from JSON string (server wire format) to object (frontend format). */
function parseExtraFields<T extends { extra_fields?: unknown }>(item: T): T {
  if (item && typeof item.extra_fields === "string") {
    try {
      item.extra_fields = JSON.parse(item.extra_fields) as Record<string, string>;
    } catch {
      item.extra_fields = {};
    }
  }
  return item;
}

export class AMToDoApi {
  private readonly baseUrl: string;
  private readonly token: string | null;
  private readonly p256PublicKey: CryptoKey | null;
  private readonly wsClient: UiWsClient | null;
  maxAttachmentSize: number;

  constructor(
    baseUrl = DEFAULT_BASE_URL,
    token: string | null = null,
    p256PublicKey: CryptoKey | null = null,
    maxAttachmentSize = 20 * 1024 * 1024,
    wsClient: UiWsClient | null = null,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.token = token;
    this.p256PublicKey = p256PublicKey;
    this.maxAttachmentSize = maxAttachmentSize;
    this.wsClient = wsClient;
  }

  get serverUrl(): string {
    return this.baseUrl;
  }

  /** Ensure the WS client is connected. Attempts reconnect if the client exists but is not connected. */
  private async ensureConnected(): Promise<void> {
    if (!this.wsClient) {
      throw new Error("WebSocket client not available");
    }
    const status = this.wsClient.connectionStatus;
    if (status === "connected") return;
    // "connecting" or "reconnecting" — wait briefly for the in-flight connection to land
    if (status === "connecting" || status === "reconnecting") {
      const ok = await this.wsClient.waitForConnected(10000);
      if (ok) return;
    }
    // "disconnected" or timed out above — do a fresh connect
    await this.wsClient.connect();
  }

  async health(): Promise<HealthResponse> {
    const response = await fetchWithNetworkStatus(`${this.baseUrl}/api/v1/health`);
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.error?.message ?? response.statusText);
    }
    return payload as HealthResponse;
  }

  async user(): Promise<UserResponse> {
    return this.post("/api/v1/user", {});
  }

  /** Verify token via HTTP (used by settings modal before WS is connected). */
  async verifyTokenHttp(): Promise<UserResponse> {
    const body: Record<string, unknown> = {};
    if (this.token) {
      body["access_token"] = this.token;
    }

    let bodyStr: string;
    let aesKey: CryptoKey | null = null;

    if (this.p256PublicKey) {
      const { seal } = await import("../crypto/envelope");
      const result = await seal(body, this.p256PublicKey, KEY_ID);
      bodyStr = JSON.stringify(result.envelope);
      aesKey = result.aesKey;
    } else {
      bodyStr = JSON.stringify(body);
    }

    const headers = new Headers();
    headers.set("Content-Type", "application/json");

    const response = await fetchWithNetworkStatus(`${this.baseUrl}/api/v1/user`, {
      method: "POST",
      body: bodyStr,
      headers,
    });

    let responsePayload = await response.json();

    if (aesKey) {
      const { isResponseEnvelope, openResponse } = await import("../crypto/envelope");
      if (isResponseEnvelope(responsePayload)) {
        responsePayload = await openResponse(responsePayload as Record<string, unknown>, aesKey);
      }
    }

    if (!response.ok || responsePayload.ok === false) {
      throw new Error(responsePayload?.error?.message ?? response.statusText);
    }

    return responsePayload as UserResponse;
  }

  async listTodos(startAt: number, endAt: number): Promise<TodoListResponse> {
    const res = await this.post<TodoListResponse>("/api/v1/todos/list", {
      start_at: startAt,
      end_at: endAt,
      open_only: false,
      completed_only: false
    });
    res.todos.forEach(parseExtraFields);
    return res;
  }

  async searchTodos(
    query: string,
    params?: {
      fields?: string[];
      use_regex?: boolean;
      planned_start_at?: number | null;
      planned_end_at?: number | null;
      due_start_at?: number | null;
      due_end_at?: number | null;
      created_start_at?: number | null;
      created_end_at?: number | null;
      updated_start_at?: number | null;
      updated_end_at?: number | null;
      ignore_case?: boolean;
      open_only?: boolean;
      completed_only?: boolean;
      completed?: boolean | null;
      priority_min?: number | null;
      priority_max?: number | null;
      tag?: string | null;
      description?: string | null;
      sort_by?: string;
      sort_order?: string;
      limit?: number;
      offset?: number;
    }
  ): Promise<TodoSearchResponse> {
    const res = await this.post<TodoSearchResponse>("/api/v1/todos/search", {
      query,
      fields: ["title", "description", "tag"],
      use_regex: false,
      planned_start_at: null,
      planned_end_at: null,
      due_start_at: null,
      due_end_at: null,
      created_start_at: null,
      created_end_at: null,
      updated_start_at: null,
      updated_end_at: null,
      ignore_case: true,
      open_only: false,
      completed_only: false,
      completed: null,
      priority_min: null,
      priority_max: null,
      tag: null,
      description: null,
      sort_by: "updated_at",
      sort_order: "desc",
      limit: 50,
      offset: 0,
      ...params
    });
    res.todos.forEach(parseExtraFields);
    return res;
  }

  async todoStats(
    startAt?: number | null,
    endAt?: number | null
  ): Promise<TodoStatsResponse> {
    return this.post("/api/v1/todos/stats", {
      start_at: startAt ?? null,
      end_at: endAt ?? null
    });
  }

  async createTodo(title: string, plannedAt: number, opts?: { due_at?: number | null; description?: string | null; priority?: number; tag?: string | null; extra_fields?: string | null }): Promise<TodoResponse> {
    return this.post("/api/v1/todos/create", {
      title,
      planned_at: plannedAt,
      due_at: opts?.due_at ?? null,
      description: opts?.description ?? null,
      priority: opts?.priority ?? 0,
      tag: opts?.tag ?? null,
      ...(opts?.extra_fields != null ? { extra_fields: opts.extra_fields } : {}),
    });
  }

  async getTodo(todoId: number, trashMode?: boolean): Promise<TodoResponse> {
    const path = trashMode ? "/api/v1/trash/get" : "/api/v1/todos/get";
    const res = await this.post<TodoResponse>(path, { todo_id: todoId });
    parseExtraFields(res.todo);
    return res;
  }

  async updateTodo(todoId: number, fields: TodoUpdateRequest, trashMode?: boolean): Promise<TodoResponse> {
    const path = trashMode ? "/api/v1/trash/update" : "/api/v1/todos/update";
    const res = await this.post<TodoResponse>(path, { todo_id: todoId, ...fields });
    parseExtraFields(res.todo);
    return res;
  }

  async completeTodo(id: number): Promise<TargetsResponse> {
    const res = await this.post<TargetsResponse>("/api/v1/todos/done", { targets: [id] });
    res.results.forEach(r => { if (r.todo) parseExtraFields(r.todo); if (r.schedule) parseExtraFields(r.schedule); });
    return res;
  }

  async reopenTodo(id: number): Promise<TargetsResponse> {
    const res = await this.post<TargetsResponse>("/api/v1/todos/reopen", { targets: [id] });
    res.results.forEach(r => { if (r.todo) parseExtraFields(r.todo); if (r.schedule) parseExtraFields(r.schedule); });
    return res;
  }

  async deleteTodo(id: number): Promise<TargetsResponse> {
    return this.post("/api/v1/todos/remove", { targets: [id] });
  }

  async listTodoTrash(params?: TrashListParams): Promise<TodoTrashListResponse> {
    const res = await this.post<TodoTrashListResponse>("/api/v1/todos/trash/list", {
      query: params?.query ?? "",
      start_at: params?.start_at ?? null,
      end_at: params?.end_at ?? null,
      limit: params?.limit ?? 100,
      offset: params?.offset ?? 0
    });
    res.todos.forEach(parseExtraFields);
    return res;
  }

  async restoreTodos(targets: number[]): Promise<TargetsResponse> {
    return this.post("/api/v1/trash/restore", { targets });
  }

  async purgeTodos(targets: number[]): Promise<TargetsResponse> {
    return this.post("/api/v1/trash/delete", { targets });
  }

  async todoChangelog(params?: {
    entity_id?: number | null;
    action?: string | null;
    start_at?: number | null;
    end_at?: number | null;
    limit?: number;
    offset?: number;
  }): Promise<ChangelogResponse> {
    return this.post("/api/v1/todos/changelog", {
      entity_id: params?.entity_id ?? null,
      action: params?.action ?? null,
      start_at: params?.start_at ?? null,
      end_at: params?.end_at ?? null,
      limit: params?.limit ?? 50,
      offset: params?.offset ?? 0
    });
  }

  async listTodoAttachments(todoId: number): Promise<AttachmentListResponse> {
    return this.post("/api/v1/attachment/list", { todo_id: todoId });
  }

  async getTodoAttachment(
    todoId: number,
    attachmentId: number
  ): Promise<AttachmentResponse> {
    return this.post("/api/v1/attachment/get", {
      todo_id: todoId,
      attachment_id: attachmentId
    });
  }

  async removeTodoAttachment(
    todoId: number,
    attachmentId: number
  ): Promise<AttachmentResponse> {
    return this.post("/api/v1/attachment/remove", {
      todo_id: todoId,
      attachment_id: attachmentId
    });
  }

  async renameTodoAttachment(
    todoId: number,
    attachmentId: number,
    filename: string
  ): Promise<AttachmentResponse> {
    return this.post("/api/v1/attachment/rename", {
      todo_id: todoId,
      attachment_id: attachmentId,
      filename
    });
  }

  async uploadTodoAttachment(todoId: number, file: File, onProgress?: (progress: UploadProgress) => void, abortSignal?: AbortSignal): Promise<AttachmentResponse> {
    await this.ensureConnected();
    const keys = generateFileKeys();
    const plainSize = file.size;

    // WS: init upload → get token
    const { token } = await this.wsClient!.send<{ ok: boolean; token: string }>(
      "attachment.init_upload",
      {
        owner_type: "todo",
        owner_id: todoId,
        filename: file.name,
        mime_type: file.type || null,
        file_key: keys.fileKey,
        hmac_key: keys.hmacKey,
        nonce: keys.nonce,
        plain_size: plainSize,
      },
    );

    // Encrypt in constant memory (1MB chunks), then upload via XHR
    const body = createEncryptStream(file, keys.fileKey, keys.nonce, (loaded, total) => {
      onProgress?.({ loaded, total, percent: Math.round(loaded / total * 100), phase: "encrypting" });
    }, abortSignal);
    return streamingUpload<AttachmentMetadata>(
      `${this.baseUrl}/api/v1/attachment/upload?token=${token}`,
      body,
      onProgress,
      abortSignal,
    ) as unknown as Promise<AttachmentResponse>;
  }

  async downloadTodoAttachment(todoId: number, attachmentId: number, onProgress?: (progress: DownloadProgress) => void, abortSignal?: AbortSignal): Promise<ArrayBuffer> {
    await this.ensureConnected();
    const { token } = await this.wsClient!.send<{ ok: boolean; token: string }>(
      "attachment.init_download",
      { owner_type: "todo", owner_id: todoId, attachment_id: attachmentId },
    );

    return downloadWithProgress(
      `${this.baseUrl}/api/v1/attachment/${attachmentId}/download?token=${token}`,
      onProgress,
      abortSignal,
    );
  }

  async getTodoAttachmentDownloadUrl(todoId: number, attachmentId: number): Promise<string> {
    await this.ensureConnected();
    const { token } = await this.wsClient!.send<{ ok: boolean; token: string }>(
      "attachment.init_download",
      { owner_type: "todo", owner_id: todoId, attachment_id: attachmentId },
    );
    return `${this.baseUrl}/api/v1/attachment/${attachmentId}/download?token=${token}`;
  }

  async removeTodoOrphanedAttachments(todoId: number): Promise<AttachmentListResponse> {
    return this.post("/api/v1/attachment/remove-orphaned", { todo_id: todoId });
  }

  // --- Schedule attachments ---

  async listScheduleAttachments(scheduleId: number): Promise<ScheduleAttachmentListResponse> {
    return this.post("/api/v1/attachment/list", { schedule_id: scheduleId });
  }

  async getScheduleAttachment(
    scheduleId: number,
    attachmentId: number
  ): Promise<ScheduleAttachmentResponse> {
    return this.post("/api/v1/attachment/get", {
      schedule_id: scheduleId,
      attachment_id: attachmentId
    });
  }

  async removeScheduleAttachment(
    scheduleId: number,
    attachmentId: number
  ): Promise<ScheduleAttachmentResponse> {
    return this.post("/api/v1/attachment/remove", {
      schedule_id: scheduleId,
      attachment_id: attachmentId
    });
  }

  async uploadScheduleAttachment(scheduleId: number, file: File, onProgress?: (progress: UploadProgress) => void, abortSignal?: AbortSignal): Promise<ScheduleAttachmentResponse> {
    await this.ensureConnected();
    const keys = generateFileKeys();
    const plainSize = file.size;

    // WS: init upload → get token
    const { token } = await this.wsClient!.send<{ ok: boolean; token: string }>(
      "attachment.init_upload",
      {
        owner_type: "schedule",
        owner_id: scheduleId,
        filename: file.name,
        mime_type: file.type || null,
        file_key: keys.fileKey,
        hmac_key: keys.hmacKey,
        nonce: keys.nonce,
        plain_size: plainSize,
      },
    );

    // Encrypt in constant memory (1MB chunks), then upload via XHR
    const body = createEncryptStream(file, keys.fileKey, keys.nonce, (loaded, total) => {
      onProgress?.({ loaded, total, percent: Math.round(loaded / total * 100), phase: "encrypting" });
    }, abortSignal);
    return streamingUpload<ScheduleAttachmentMetadata>(
      `${this.baseUrl}/api/v1/attachment/upload?token=${token}`,
      body,
      onProgress,
      abortSignal,
    ) as unknown as Promise<ScheduleAttachmentResponse>;
  }

  async downloadScheduleAttachment(scheduleId: number, attachmentId: number, onProgress?: (progress: DownloadProgress) => void, abortSignal?: AbortSignal): Promise<ArrayBuffer> {
    await this.ensureConnected();
    const { token } = await this.wsClient!.send<{ ok: boolean; token: string }>(
      "attachment.init_download",
      { owner_type: "schedule", owner_id: scheduleId, attachment_id: attachmentId },
    );

    return downloadWithProgress(
      `${this.baseUrl}/api/v1/attachment/${attachmentId}/download?token=${token}`,
      onProgress,
      abortSignal,
    );
  }

  async getScheduleAttachmentDownloadUrl(scheduleId: number, attachmentId: number): Promise<string> {
    await this.ensureConnected();
    const { token } = await this.wsClient!.send<{ ok: boolean; token: string }>(
      "attachment.init_download",
      { owner_type: "schedule", owner_id: scheduleId, attachment_id: attachmentId },
    );
    return `${this.baseUrl}/api/v1/attachment/${attachmentId}/download?token=${token}`;
  }

  async removeScheduleOrphanedAttachments(scheduleId: number): Promise<ScheduleAttachmentListResponse> {
    return this.post("/api/v1/attachment/remove-orphaned", { schedule_id: scheduleId });
  }

  async renameScheduleAttachment(
    scheduleId: number,
    attachmentId: number,
    filename: string
  ): Promise<ScheduleAttachmentResponse> {
    return this.post("/api/v1/attachment/rename", {
      schedule_id: scheduleId,
      attachment_id: attachmentId,
      filename
    });
  }

  async listSchedules(startAt: number, endAt: number): Promise<ScheduleListResponse> {
    const res = await this.post<ScheduleListResponse>("/api/v1/schedules/list", {
      start_at: startAt,
      end_at: endAt
    });
    res.schedules.forEach(parseExtraFields);
    return res;
  }

  async searchSchedules(
    query: string,
    params?: {
      fields?: string[];
      use_regex?: boolean;
      start_at?: number | null;
      end_at?: number | null;
      created_start_at?: number | null;
      created_end_at?: number | null;
      updated_start_at?: number | null;
      updated_end_at?: number | null;
      category?: string | null;
      location?: string | null;
      ignore_case?: boolean;
      sort_by?: string;
      sort_order?: string;
      limit?: number;
      offset?: number;
    }
  ): Promise<ScheduleSearchResponse> {
    const res = await this.post<ScheduleSearchResponse>("/api/v1/schedules/search", {
      query,
      fields: ["title", "description", "location", "category"],
      use_regex: false,
      start_at: null,
      end_at: null,
      created_start_at: null,
      created_end_at: null,
      updated_start_at: null,
      updated_end_at: null,
      category: null,
      location: null,
      ignore_case: true,
      sort_by: "updated_at",
      sort_order: "desc",
      limit: 50,
      offset: 0,
      ...params
    });
    res.schedules.forEach(parseExtraFields);
    return res;
  }

  async scheduleStats(
    startAt?: number | null,
    endAt?: number | null
  ): Promise<ScheduleStatsResponse> {
    return this.post("/api/v1/schedules/stats", {
      start_at: startAt ?? null,
      end_at: endAt ?? null
    });
  }

  async checkConflicts(
    startAt: number,
    endAt: number,
    excludeId?: number | null
  ): Promise<ConflictResponse> {
    return this.post("/api/v1/schedules/conflicts", {
      start_at: startAt,
      end_at: endAt,
      exclude_id: excludeId ?? null
    });
  }

  async createSchedule(params: ScheduleCreateParams): Promise<ScheduleResponse> {
    return this.post("/api/v1/schedules/create", {
      ...params,
      description: params.description ?? null,
      location: params.location ?? null,
      category: params.category ?? null,
      extra_fields: params.extra_fields ?? null
    });
  }

  async getSchedule(scheduleId: number, trashMode?: boolean): Promise<ScheduleResponse> {
    const path = trashMode ? "/api/v1/trash/get" : "/api/v1/schedules/get";
    const res = await this.post<ScheduleResponse>(path, { schedule_id: scheduleId });
    parseExtraFields(res.schedule);
    return res;
  }

  async updateSchedule(
    scheduleId: number,
    fields: ScheduleUpdateRequest,
    trashMode?: boolean
  ): Promise<ScheduleResponse> {
    const path = trashMode ? "/api/v1/trash/update" : "/api/v1/schedules/update";
    const res = await this.post<ScheduleResponse>(path, { schedule_id: scheduleId, ...fields });
    parseExtraFields(res.schedule);
    return res;
  }

  async removeSchedules(targets: number[]): Promise<TargetsResponse> {
    return this.post("/api/v1/schedules/remove", { targets });
  }

  async deleteSchedule(id: number): Promise<TargetsResponse> {
    return this.post("/api/v1/schedules/remove", { targets: [id] });
  }

  async listScheduleTrash(params?: TrashListParams): Promise<ScheduleTrashListResponse> {
    const res = await this.post<ScheduleTrashListResponse>("/api/v1/schedules/trash/list", {
      query: params?.query ?? "",
      start_at: params?.start_at ?? null,
      end_at: params?.end_at ?? null,
      limit: params?.limit ?? 100,
      offset: params?.offset ?? 0
    });
    res.schedules.forEach(parseExtraFields);
    return res;
  }

  async restoreSchedules(targets: number[]): Promise<TargetsResponse> {
    return this.post("/api/v1/trash/restore", { targets });
  }

  async purgeSchedules(targets: number[]): Promise<TargetsResponse> {
    return this.post("/api/v1/trash/delete", { targets });
  }

  async scheduleChangelog(params?: {
    entity_id?: number | null;
    action?: string | null;
    start_at?: number | null;
    end_at?: number | null;
    limit?: number;
    offset?: number;
  }): Promise<ChangelogResponse> {
    return this.post("/api/v1/schedules/changelog", {
      entity_id: params?.entity_id ?? null,
      action: params?.action ?? null,
      start_at: params?.start_at ?? null,
      end_at: params?.end_at ?? null,
      limit: params?.limit ?? 50,
      offset: params?.offset ?? 0
    });
  }

  // --- Notifications ---

  async createNotification(params: {
    title: string;
    trigger_at: number;
    description?: string | null;
    mentions?: { target_type: string; target_id: number }[];
    extra_fields?: string | null;
  }): Promise<NotificationResponse> {
    const res = await this.post<NotificationResponse>("/api/v1/notifications/create", {
      title: params.title,
      trigger_at: params.trigger_at,
      description: params.description ?? null,
      mentions: params.mentions ?? [],
      extra_fields: params.extra_fields ?? null,
    });
    parseExtraFields(res.notification);
    return res;
  }

  async getNotification(notificationId: number, trashMode?: boolean): Promise<NotificationResponse> {
    const path = trashMode ? "/api/v1/trash/get" : "/api/v1/notifications/get";
    const res = await this.post<NotificationResponse>(path, { notification_id: notificationId });
    parseExtraFields(res.notification);
    return res;
  }

  async updateNotification(
    notificationId: number,
    fields: {
      title?: string;
      description?: string | null;
      trigger_at?: number;
      mentions?: { target_type: string; target_id: number }[] | null;
      extra_fields?: string | null;
    }
  ): Promise<NotificationResponse> {
    const res = await this.post<NotificationResponse>("/api/v1/notifications/update", {
      notification_id: notificationId,
      ...fields,
    });
    parseExtraFields(res.notification);
    return res;
  }

  async deleteNotification(notificationId: number): Promise<{ ok: boolean }> {
    return this.post("/api/v1/notifications/remove", { notification_id: notificationId });
  }

  async listNotifications(params?: {
    start_at?: number | null;
    end_at?: number | null;
  }): Promise<NotificationListResponse> {
    return this.post("/api/v1/notifications/list", {
      start_at: params?.start_at ?? null,
      end_at: params?.end_at ?? null,
    });
  }

  async notificationChangelog(params?: {
    entity_id?: number | null;
    action?: string | null;
    start_at?: number | null;
    end_at?: number | null;
    limit?: number;
    offset?: number;
  }): Promise<ChangelogResponse> {
    return this.post("/api/v1/notifications/changelog", {
      entity_id: params?.entity_id ?? null,
      action: params?.action ?? null,
      start_at: params?.start_at ?? null,
      end_at: params?.end_at ?? null,
      limit: params?.limit ?? 50,
      offset: params?.offset ?? 0
    });
  }

  async listTriggeredNotifications(after: number): Promise<NotificationListResponse> {
    return this.post("/api/v1/notifications/list_triggered", { after });
  }

  async listNotificationTrash(): Promise<NotificationListResponse> {
    return this.post("/api/v1/notifications/trash/list", {});
  }

  async restoreNotification(notificationId: number): Promise<{ ok: boolean }> {
    return this.post("/api/v1/trash/restore", { notification_id: notificationId });
  }

  async purgeNotification(notificationId: number): Promise<{ ok: boolean }> {
    return this.post("/api/v1/trash/delete", { notification_id: notificationId });
  }

  // --- Private helpers ---

  private async downloadAttachment(path: string, body: Record<string, unknown>): Promise<ArrayBuffer> {
    if (!this.wsClient) {
      throw new Error("WebSocket not connected");
    }

    const wsType = pathToWsType(path);
    const { access_token: _, ...payload } = body;
    const result = await this.wsClient.send<{ name: string; content_base64: string }>(wsType, payload);
    const b64 = result.content_base64;
    let b64Std = b64.replace(/-/g, "+").replace(/_/g, "/");
    while (b64Std.length % 4 !== 0) b64Std += "=";
    const binary = atob(b64Std);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  private async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    await this.ensureConnected();

    const wsType = pathToWsType(path);
    // Strip access_token — WS connection is already authenticated
    const { access_token: _, ...payload } = body;
    return this.wsClient!.send<T>(wsType, payload);
  }
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
