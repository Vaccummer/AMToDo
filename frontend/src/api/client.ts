import { SERVER_URL } from "../config";

export type HealthResponse = {
  status: string;
  version: string;
  public_key?: string;
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
  pattern: string;
  case_sensitive: boolean;
  range: {
    planned_start_at: number | null;
    planned_end_at: number | null;
    created_start_at: number | null;
    created_end_at: number | null;
  };
  filter: { completed: boolean | null };
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
  pattern: string;
  case_sensitive: boolean;
  range: { start_at: number | null; end_at: number | null };
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

export class AMToDoApi {
  private readonly baseUrl: string;
  private readonly token: string | null;
  private readonly p256PublicKey: CryptoKey | null;

  constructor(
    baseUrl = DEFAULT_BASE_URL,
    token: string | null = null,
    p256PublicKey: CryptoKey | null = null
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.token = token;
    this.p256PublicKey = p256PublicKey;
  }

  async health(): Promise<HealthResponse> {
    const response = await fetch(`${this.baseUrl}/api/v1/health`);
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
    pattern: string,
    params?: {
      planned_start_at?: number | null;
      planned_end_at?: number | null;
      created_start_at?: number | null;
      created_end_at?: number | null;
      ignore_case?: boolean;
      open_only?: boolean;
      completed_only?: boolean;
    }
  ): Promise<TodoSearchResponse> {
    return this.post("/api/v1/todos/search", {
      pattern,
      planned_start_at: null,
      planned_end_at: null,
      created_start_at: null,
      created_end_at: null,
      ignore_case: false,
      open_only: false,
      completed_only: false,
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

  async listSchedules(startAt: number, endAt: number): Promise<ScheduleListResponse> {
    return this.post("/api/v1/schedules/list", {
      start_at: startAt,
      end_at: endAt
    });
  }

  async searchSchedules(
    pattern: string,
    params?: {
      start_at?: number | null;
      end_at?: number | null;
      ignore_case?: boolean;
    }
  ): Promise<ScheduleSearchResponse> {
    return this.post("/api/v1/schedules/search", {
      pattern,
      start_at: null,
      end_at: null,
      ignore_case: false,
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

  // --- Private helpers ---

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

    const response = await fetch(`${this.baseUrl}${path}`, {
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
