export type HealthResponse = {
  status: string;
  version: string;
};

export type TodoItem = {
  id: number;
  title: string;
  description: string | null;
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

const DEFAULT_BASE_URL = "http://127.0.0.1:3468";

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

  createTodo(title: string): Promise<TodoResponse> {
    return this.post("/api/v1/todos", {
      title
    });
  }

  completeTodo(id: number): Promise<TargetsResponse> {
    return this.post("/api/v1/todos/done", { targets: [id] });
  }

  reopenTodo(id: number): Promise<TargetsResponse> {
    return this.post("/api/v1/todos/reopen", { targets: [id] });
  }

  updateTodo(id: number, title: string): Promise<unknown> {
    return this.patch(`/api/v1/todos/${id}`, { title });
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

  private patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, {
      method: "PATCH",
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
