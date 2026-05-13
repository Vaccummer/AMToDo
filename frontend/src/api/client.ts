export type HealthResponse = {
  status: string;
  version: string;
};

export type TodoItem = {
  id: number;
  title: string;
  completed: boolean;
  due_at: number | null;
  due_date?: string | null;
};

export type TodoListResponse = {
  ok: boolean;
  count: number;
  todos: TodoItem[];
};

export type ScheduleItem = {
  id: number;
  title: string;
  start_at: number;
  end_at: number;
  timezone: string;
  location?: string | null;
  category?: string | null;
};

export type ScheduleListResponse = {
  ok: boolean;
  count: number;
  schedules: ScheduleItem[];
};

const DEFAULT_BASE_URL = "http://127.0.0.1:8000";

export class AMToDoApi {
  private readonly baseUrl: string;
  private readonly token: string | null;

  constructor(baseUrl = DEFAULT_BASE_URL, token: string | null = null) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.token = token;
  }

  health(): Promise<HealthResponse> {
    return this.get("/api/v1/health");
  }

  listTodos(startAt: number, endAt: number): Promise<TodoListResponse> {
    return this.get(`/api/v1/todos?start_at=${startAt}&end_at=${endAt}`);
  }

  completeTodo(id: number): Promise<unknown> {
    return this.post("/api/v1/todos/done", { targets: [id] });
  }

  reopenTodo(id: number): Promise<unknown> {
    return this.post("/api/v1/todos/reopen", { targets: [id] });
  }

  listSchedules(startAt: number, endAt: number): Promise<ScheduleListResponse> {
    return this.get(`/api/v1/schedules?start_at=${startAt}&end_at=${endAt}`);
  }

  private get<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: "GET" });
  }

  private post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, {
      method: "POST",
      body: JSON.stringify(body)
    });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("Content-Type", "application/json");
    if (this.token) {
      headers.set("Authorization", `Bearer ${this.token}`);
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.error?.message ?? response.statusText);
    }
    return payload as T;
  }
}
