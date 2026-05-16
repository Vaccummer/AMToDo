import { SERVER_URL } from "../config";

export type HealthResponse = {
  status: string;
  version: string;
  public_key?: string;
  limits: {
    max_attachment_size_bytes: number;
    max_attachments_per_todo: number;
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
};

export type ScheduleCreateParams = {
  title: string;
  start_at: number;
  end_at: number;
  description?: string | null;
  location?: string | null;
  category?: string | null;
};

export type ScheduleUpdateRequest = {
  title?: string;
  start_at?: number | null;
  end_at?: number | null;
  description?: string | null;
  location?: string | null;
  category?: string | null;
};

const DEFAULT_BASE_URL = SERVER_URL;
const KEY_ID = "server-key-v1";
export const API_NETWORK_STATUS_EVENT = "amtodo:api-network-status";

function notifyNetworkStatus(online: boolean, message?: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(API_NETWORK_STATUS_EVENT, {
      detail: { online, message }
    })
  );
}

async function fetchWithNetworkStatus(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  try {
    const response = await fetch(input, init);
    notifyNetworkStatus(true);
    return response;
  } catch (error: unknown) {
    notifyNetworkStatus(false, error instanceof Error ? error.message : "网络错误");
    throw error;
  }
}

export class AMToDoApi {
  private readonly baseUrl: string;
  private readonly token: string | null;
  private readonly p256PublicKey: CryptoKey | null;
  maxAttachmentSize: number;
  maxAttachmentsPerTodo: number;

  constructor(
    baseUrl = DEFAULT_BASE_URL,
    token: string | null = null,
    p256PublicKey: CryptoKey | null = null,
    maxAttachmentSize = 20 * 1024 * 1024,
    maxAttachmentsPerTodo = 20,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.token = token;
    this.p256PublicKey = p256PublicKey;
    this.maxAttachmentSize = maxAttachmentSize;
    this.maxAttachmentsPerTodo = maxAttachmentsPerTodo;
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

  async listTodos(startAt: number, endAt: number): Promise<TodoListResponse> {
    return this.post("/api/v1/todos/list", {
      start_at: startAt,
      end_at: endAt,
      open_only: false,
      completed_only: false
    });
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
      sort_by?: string;
      sort_order?: string;
      limit?: number;
      offset?: number;
    }
  ): Promise<TodoSearchResponse> {
    return this.post("/api/v1/todos/search", {
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
      sort_by: "updated_at",
      sort_order: "desc",
      limit: 50,
      offset: 0,
      ...params
    });
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

  async createTodo(title: string, plannedAt: number): Promise<TodoResponse> {
    return this.post("/api/v1/todos/create", {
      title,
      planned_at: plannedAt,
      due_at: null,
      description: null,
      priority: 0,
      tag: null
    });
  }

  async getTodo(todoId: number): Promise<TodoResponse> {
    return this.post("/api/v1/todos/get", { todo_id: todoId });
  }

  async updateTodo(todoId: number, fields: TodoUpdateRequest): Promise<TodoResponse> {
    return this.post("/api/v1/todos/update", { todo_id: todoId, ...fields });
  }

  async completeTodo(id: number): Promise<TargetsResponse> {
    return this.post("/api/v1/todos/done", { targets: [id] });
  }

  async reopenTodo(id: number): Promise<TargetsResponse> {
    return this.post("/api/v1/todos/reopen", { targets: [id] });
  }

  async deleteTodo(id: number): Promise<TargetsResponse> {
    return this.post("/api/v1/todos/remove", { targets: [id] });
  }

  async listTodoTrash(params?: TrashListParams): Promise<TodoTrashListResponse> {
    return this.post("/api/v1/todos/trash/list", {
      query: params?.query ?? "",
      start_at: params?.start_at ?? null,
      end_at: params?.end_at ?? null,
      limit: params?.limit ?? 100,
      offset: params?.offset ?? 0
    });
  }

  async restoreTodos(targets: number[]): Promise<TargetsResponse> {
    return this.post("/api/v1/todos/trash/restore", { targets });
  }

  async purgeTodos(targets: number[]): Promise<TargetsResponse> {
    return this.post("/api/v1/todos/trash/delete", { targets });
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
    return this.post("/api/v1/todos/attachments/list", { todo_id: todoId });
  }

  async getTodoAttachment(
    todoId: number,
    attachmentId: number
  ): Promise<AttachmentResponse> {
    return this.post("/api/v1/todos/attachments/get", {
      todo_id: todoId,
      attachment_id: attachmentId
    });
  }

  async removeTodoAttachment(
    todoId: number,
    attachmentId: number
  ): Promise<AttachmentResponse> {
    return this.post("/api/v1/todos/attachments/remove", {
      todo_id: todoId,
      attachment_id: attachmentId
    });
  }

  async uploadTodoAttachment(todoId: number, file: File): Promise<AttachmentResponse> {
    return this.post("/api/v1/todos/attachments/upload", {
      todo_id: todoId,
      filename: file.name,
      mime_type: file.type || null,
      content_base64: await fileToBase64(file)
    });
  }

  async downloadTodoAttachment(todoId: number, attachmentId: number): Promise<ArrayBuffer> {
    return this.downloadAttachment("/api/v1/todos/attachments/download", {
      todo_id: todoId,
      attachment_id: attachmentId
    });
  }

  async removeTodoOrphanedAttachments(todoId: number): Promise<AttachmentListResponse> {
    return this.post("/api/v1/todos/attachments/remove-orphaned", { todo_id: todoId });
  }

  // --- Schedule attachments ---

  async listScheduleAttachments(scheduleId: number): Promise<ScheduleAttachmentListResponse> {
    return this.post("/api/v1/schedules/attachments/list", { schedule_id: scheduleId });
  }

  async getScheduleAttachment(
    scheduleId: number,
    attachmentId: number
  ): Promise<ScheduleAttachmentResponse> {
    return this.post("/api/v1/schedules/attachments/get", {
      schedule_id: scheduleId,
      attachment_id: attachmentId
    });
  }

  async removeScheduleAttachment(
    scheduleId: number,
    attachmentId: number
  ): Promise<ScheduleAttachmentResponse> {
    return this.post("/api/v1/schedules/attachments/remove", {
      schedule_id: scheduleId,
      attachment_id: attachmentId
    });
  }

  async uploadScheduleAttachment(scheduleId: number, file: File): Promise<ScheduleAttachmentResponse> {
    return this.post("/api/v1/schedules/attachments/upload", {
      schedule_id: scheduleId,
      filename: file.name,
      mime_type: file.type || null,
      content_base64: await fileToBase64(file)
    });
  }

  async downloadScheduleAttachment(scheduleId: number, attachmentId: number): Promise<ArrayBuffer> {
    return this.downloadAttachment("/api/v1/schedules/attachments/download", {
      schedule_id: scheduleId,
      attachment_id: attachmentId
    });
  }

  async removeScheduleOrphanedAttachments(scheduleId: number): Promise<ScheduleAttachmentListResponse> {
    return this.post("/api/v1/schedules/attachments/remove-orphaned", { schedule_id: scheduleId });
  }

  async listSchedules(startAt: number, endAt: number): Promise<ScheduleListResponse> {
    return this.post("/api/v1/schedules/list", {
      start_at: startAt,
      end_at: endAt
    });
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
    return this.post("/api/v1/schedules/search", {
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
      category: params.category ?? null
    });
  }

  async getSchedule(scheduleId: number): Promise<ScheduleResponse> {
    return this.post("/api/v1/schedules/get", { schedule_id: scheduleId });
  }

  async updateSchedule(
    scheduleId: number,
    fields: ScheduleUpdateRequest
  ): Promise<ScheduleResponse> {
    return this.post("/api/v1/schedules/update", { schedule_id: scheduleId, ...fields });
  }

  async removeSchedules(targets: number[]): Promise<TargetsResponse> {
    return this.post("/api/v1/schedules/remove", { targets });
  }

  async deleteSchedule(id: number): Promise<TargetsResponse> {
    return this.post("/api/v1/schedules/remove", { targets: [id] });
  }

  async listScheduleTrash(params?: TrashListParams): Promise<ScheduleTrashListResponse> {
    return this.post("/api/v1/schedules/trash/list", {
      query: params?.query ?? "",
      start_at: params?.start_at ?? null,
      end_at: params?.end_at ?? null,
      limit: params?.limit ?? 100,
      offset: params?.offset ?? 0
    });
  }

  async restoreSchedules(targets: number[]): Promise<TargetsResponse> {
    return this.post("/api/v1/schedules/trash/restore", { targets });
  }

  async purgeSchedules(targets: number[]): Promise<TargetsResponse> {
    return this.post("/api/v1/schedules/trash/delete", { targets });
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
  }): Promise<NotificationResponse> {
    return this.post("/api/v1/notifications/create", {
      title: params.title,
      trigger_at: params.trigger_at,
      description: params.description ?? null,
      mentions: params.mentions ?? [],
    });
  }

  async getNotification(notificationId: number): Promise<NotificationResponse> {
    return this.post("/api/v1/notifications/get", { notification_id: notificationId });
  }

  async updateNotification(
    notificationId: number,
    fields: {
      title?: string;
      description?: string | null;
      trigger_at?: number;
      mentions?: { target_type: string; target_id: number }[] | null;
    }
  ): Promise<NotificationResponse> {
    return this.post("/api/v1/notifications/update", {
      notification_id: notificationId,
      ...fields,
    });
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

  async listTriggeredNotifications(after: number): Promise<NotificationListResponse> {
    return this.post("/api/v1/notifications/list_triggered", { after });
  }

  async listNotificationTrash(): Promise<NotificationListResponse> {
    return this.post("/api/v1/notifications/trash/list", {});
  }

  async restoreNotification(notificationId: number): Promise<{ ok: boolean }> {
    return this.post("/api/v1/notifications/trash/restore", { notification_id: notificationId });
  }

  async purgeNotification(notificationId: number): Promise<{ ok: boolean }> {
    return this.post("/api/v1/notifications/trash/delete", { notification_id: notificationId });
  }

  // --- Private helpers ---

  private async downloadAttachment(path: string, body: Record<string, unknown>): Promise<ArrayBuffer> {
    const headers = new Headers();
    headers.set("Content-Type", "application/json");

    if (this.token) {
      body["access_token"] = this.token as unknown as string;
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

    const response = await fetchWithNetworkStatus(`${this.baseUrl}${path}`, {
      method: "POST",
      body: bodyStr,
      headers
    });

    if (!response.ok) {
      let errorPayload: unknown;
      try {
        errorPayload = await response.json();
      } catch {
        throw new Error(response.statusText);
      }
      if (aesKey) {
        const { isResponseEnvelope, openResponse } = await import("../crypto/envelope");
        if (isResponseEnvelope(errorPayload as Record<string, unknown>)) {
          errorPayload = await openResponse(errorPayload as Record<string, unknown>, aesKey);
        }
      }
      const err = errorPayload as { error?: { message?: string } };
      throw new Error(err?.error?.message ?? response.statusText);
    }

    return response.arrayBuffer();
  }

  private async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const headers = new Headers();
    headers.set("Content-Type", "application/json");

    if (this.token) {
      body = { ...body, access_token: this.token };
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

    const response = await fetchWithNetworkStatus(`${this.baseUrl}${path}`, {
      method: "POST",
      body: bodyStr,
      headers
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

    return responsePayload as T;
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
