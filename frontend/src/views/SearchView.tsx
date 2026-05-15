import { useMemo, useState } from "react";
import type { AMToDoApi, ScheduleItem, TodoItem } from "../api/client";
import { addDaysToDateKey, formatTime, startOfDateKeyEpoch } from "../lib/time";
import { ContextMenu, TrashIcon } from "./ContextMenu";
import { DatePicker } from "./DatePicker";
import { Dropdown } from "./Dropdown";
import { ScheduleDetailModal } from "./ScheduleDetailModal";
import { TodoDetailModal } from "./TodoDetailModal";
import { useConfirm } from "./ConfirmDialog";

type Props = {
  api: AMToDoApi;
  onNavigate: (target: "todo" | "schedule") => void;
};

type SearchMode = "todo" | "schedule";
type TodoTimeField = "planned" | "due" | "created" | "updated";
type ScheduleTimeField = "overlap" | "created" | "updated";

type ResultItem =
  | { type: "todo"; item: TodoItem }
  | { type: "schedule"; item: ScheduleItem };

const TODO_FIELD_OPTIONS = [
  { value: "title", label: "标题" },
  { value: "description", label: "描述" },
  { value: "tag", label: "标签" }
];

const SCHEDULE_FIELD_OPTIONS = [
  { value: "title", label: "标题" },
  { value: "description", label: "描述" },
  { value: "location", label: "地点" },
  { value: "category", label: "分类" }
];

const TODO_TIME_OPTIONS = [
  { value: "planned", label: "计划时间" },
  { value: "due", label: "截止时间" },
  { value: "created", label: "创建时间" },
  { value: "updated", label: "修改时间" }
];

const SCHEDULE_TIME_OPTIONS = [
  { value: "overlap", label: "日程时间" },
  { value: "created", label: "创建时间" },
  { value: "updated", label: "修改时间" }
];

const TODO_SORT_OPTIONS = [
  { value: "updated_at", label: "最新修改" },
  { value: "created_at", label: "最新创建" },
  { value: "planned_at", label: "计划时间" },
  { value: "due_at", label: "截止时间" },
  { value: "priority", label: "优先级" },
  { value: "title", label: "标题" }
];

const SCHEDULE_SORT_OPTIONS = [
  { value: "updated_at", label: "最新修改" },
  { value: "created_at", label: "最新创建" },
  { value: "start_at", label: "开始时间" },
  { value: "end_at", label: "结束时间" },
  { value: "duration", label: "时长" },
  { value: "title", label: "标题" }
];

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <path d="M16.5 16.5L21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function JumpIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M7 17L17 7M9 7h8v8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function dateRangeParams(startDate: string, endDate: string): [number | null, number | null] {
  const start = startDate ? startOfDateKeyEpoch(startDate) : null;
  const end = endDate ? startOfDateKeyEpoch(addDaysToDateKey(endDate, 1)) : null;
  return [start, end];
}

function formatEpoch(epoch: number | null): string {
  if (epoch === null) return "";
  const d = new Date(epoch * 1000);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${month}-${day} ${formatTime(epoch)}`;
}

function updateFields(fields: string[], value: string, checked: boolean): string[] {
  if (checked) return Array.from(new Set([...fields, value]));
  const next = fields.filter((field) => field !== value);
  return next.length ? next : fields;
}

export function SearchView({ api, onNavigate }: Props) {
  const [mode, setMode] = useState<SearchMode>("todo");
  const [query, setQuery] = useState("");
  const [useRegex, setUseRegex] = useState(false);
  const [ignoreCase, setIgnoreCase] = useState(true);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [todoTimeField, setTodoTimeField] = useState<TodoTimeField>("planned");
  const [scheduleTimeField, setScheduleTimeField] = useState<ScheduleTimeField>("overlap");
  const [todoFields, setTodoFields] = useState(["title", "description", "tag"]);
  const [scheduleFields, setScheduleFields] = useState(["title", "description", "location", "category"]);
  const [todoStatus, setTodoStatus] = useState("all");
  const [priorityMin, setPriorityMin] = useState("");
  const [priorityMax, setPriorityMax] = useState("");
  const [tag, setTag] = useState("");
  const [category, setCategory] = useState("");
  const [location, setLocation] = useState("");
  const [todoSortBy, setTodoSortBy] = useState("updated_at");
  const [scheduleSortBy, setScheduleSortBy] = useState("updated_at");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [results, setResults] = useState<ResultItem[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState("尚未搜索");
  const [busy, setBusy] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [detail, setDetail] = useState<ResultItem | null>(null);
  const [contextMenu, setContextMenu] = useState<{ key: string; x: number; y: number } | null>(null);
  const { ask, dialog: confirmDialog } = useConfirm();

  const currentFields = mode === "todo" ? todoFields : scheduleFields;
  const currentSortOptions = mode === "todo" ? TODO_SORT_OPTIONS : SCHEDULE_SORT_OPTIONS;
  const currentSortBy = mode === "todo" ? todoSortBy : scheduleSortBy;

  const contextItem = useMemo(
    () => (contextMenu ? results.find((result) => resultKey(result) === contextMenu.key) ?? null : null),
    [contextMenu, results]
  );

  async function runSearch() {
    setBusy(true);
    setStatus("搜索中");
    try {
      const [rangeStart, rangeEnd] = dateRangeParams(startDate, endDate);
      if (mode === "todo") {
        const params: Parameters<AMToDoApi["searchTodos"]>[1] = {
          fields: todoFields,
          use_regex: useRegex,
          ignore_case: ignoreCase,
          sort_by: todoSortBy,
          sort_order: sortOrder,
          limit: 100,
          offset: 0
        };
        if (rangeStart !== null || rangeEnd !== null) {
          if (todoTimeField === "planned") {
            params.planned_start_at = rangeStart;
            params.planned_end_at = rangeEnd;
          } else if (todoTimeField === "due") {
            params.due_start_at = rangeStart;
            params.due_end_at = rangeEnd;
          } else if (todoTimeField === "created") {
            params.created_start_at = rangeStart;
            params.created_end_at = rangeEnd;
          } else {
            params.updated_start_at = rangeStart;
            params.updated_end_at = rangeEnd;
          }
        }
        if (todoStatus === "open") params.completed = false;
        if (todoStatus === "completed") params.completed = true;
        if (priorityMin) params.priority_min = Number(priorityMin);
        if (priorityMax) params.priority_max = Number(priorityMax);
        if (tag.trim()) params.tag = tag.trim();
        const response = await api.searchTodos(query, params);
        setResults(response.todos.map((item) => ({ type: "todo", item })));
        setTotal(response.total);
        setStatus(response.total ? "" : "没有匹配结果");
      } else {
        const params: Parameters<AMToDoApi["searchSchedules"]>[1] = {
          fields: scheduleFields,
          use_regex: useRegex,
          ignore_case: ignoreCase,
          sort_by: scheduleSortBy,
          sort_order: sortOrder,
          limit: 100,
          offset: 0
        };
        if (rangeStart !== null || rangeEnd !== null) {
          if (scheduleTimeField === "overlap") {
            params.start_at = rangeStart;
            params.end_at = rangeEnd;
          } else if (scheduleTimeField === "created") {
            params.created_start_at = rangeStart;
            params.created_end_at = rangeEnd;
          } else {
            params.updated_start_at = rangeStart;
            params.updated_end_at = rangeEnd;
          }
        }
        if (category.trim()) params.category = category.trim();
        if (location.trim()) params.location = location.trim();
        const response = await api.searchSchedules(query, params);
        setResults(response.schedules.map((item) => ({ type: "schedule", item })));
        setTotal(response.total);
        setStatus(response.total ? "" : "没有匹配结果");
      }
    } catch (error: unknown) {
      setResults([]);
      setTotal(0);
      setStatus(error instanceof Error ? error.message : "搜索失败");
    } finally {
      setBusy(false);
    }
  }

  function beginRename(result: ResultItem) {
    setEditingKey(resultKey(result));
    setEditText(result.item.title);
  }

  function cancelRename() {
    setEditingKey(null);
    setEditText("");
  }

  async function saveRename(result: ResultItem) {
    const title = editText.trim();
    if (!title || title === result.item.title) {
      cancelRename();
      return;
    }
    try {
      if (result.type === "todo") {
        const response = await api.updateTodo(result.item.id, { title });
        replaceResult({ type: "todo", item: response.todo });
      } else {
        const response = await api.updateSchedule(result.item.id, { title });
        replaceResult({ type: "schedule", item: response.schedule });
      }
    } catch (error: unknown) {
      setStatus(error instanceof Error ? error.message : "保存失败");
    }
    cancelRename();
  }

  function replaceResult(next: ResultItem) {
    const key = resultKey(next);
    setResults((items) => items.map((item) => (resultKey(item) === key ? next : item)));
    setDetail((current) => (current && resultKey(current) === key ? next : current));
  }

  async function deleteResult(result: ResultItem) {
    const ok = await ask({
      title: result.type === "todo" ? "删除待办" : "删除日程",
      message: "确定删除这个项目吗？此操作不可撤销。",
      confirmLabel: "删除",
      danger: true
    });
    if (!ok) return;
    try {
      if (result.type === "todo") {
        await api.deleteTodo(result.item.id);
      } else {
        await api.deleteSchedule(result.item.id);
      }
      const key = resultKey(result);
      setResults((items) => items.filter((item) => resultKey(item) !== key));
      setTotal((value) => Math.max(0, value - 1));
      setDetail((current) => (current && resultKey(current) === key ? null : current));
    } catch (error: unknown) {
      setStatus(error instanceof Error ? error.message : "删除失败");
    }
  }

  function handleModeChange(next: SearchMode) {
    setMode(next);
    setResults([]);
    setTotal(0);
    setStatus("尚未搜索");
    setContextMenu(null);
    setDetail(null);
    cancelRename();
  }

  return (
    <div className="search-view">
      <div className="search-topbar">
        <div className="search-tabs" role="tablist">
          <button
            type="button"
            className={mode === "todo" ? "active" : ""}
            onClick={() => handleModeChange("todo")}
          >
            ToDo
          </button>
          <button
            type="button"
            className={mode === "schedule" ? "active" : ""}
            onClick={() => handleModeChange("schedule")}
          >
            Schedule
          </button>
        </div>
        <form
          className="search-box"
          onSubmit={(event) => {
            event.preventDefault();
            void runSearch();
          }}
        >
          <SearchIcon />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={mode === "todo" ? "搜索待办" : "搜索日程"}
          />
          <button type="submit" disabled={busy}>
            搜索
          </button>
        </form>
      </div>

      <div className="search-layout">
        <aside className="search-options">
          <section className="search-option-group">
            <span className="search-option-title">匹配</span>
            <div className="search-toggle-row">
              <label className="search-toggle">
                <input
                  type="checkbox"
                  checked={useRegex}
                  onChange={(event) => setUseRegex(event.target.checked)}
                />
                <span>正则</span>
              </label>
              <label className="search-toggle">
                <input
                  type="checkbox"
                  checked={ignoreCase}
                  onChange={(event) => setIgnoreCase(event.target.checked)}
                />
                <span>忽略大小写</span>
              </label>
            </div>
            <div className="field-chip-row">
              {(mode === "todo" ? TODO_FIELD_OPTIONS : SCHEDULE_FIELD_OPTIONS).map((field) => (
                <label className="field-chip" key={field.value}>
                  <input
                    type="checkbox"
                    checked={currentFields.includes(field.value)}
                    onChange={(event) => {
                      if (mode === "todo") {
                        setTodoFields((fields) => updateFields(fields, field.value, event.target.checked));
                      } else {
                        setScheduleFields((fields) => updateFields(fields, field.value, event.target.checked));
                      }
                    }}
                  />
                  <span>{field.label}</span>
                </label>
              ))}
            </div>
          </section>

          <section className="search-option-group">
            <span className="search-option-title">时间</span>
            <Dropdown
              value={mode === "todo" ? todoTimeField : scheduleTimeField}
              options={mode === "todo" ? TODO_TIME_OPTIONS : SCHEDULE_TIME_OPTIONS}
              onChange={(value) => {
                if (mode === "todo") setTodoTimeField(value as TodoTimeField);
                else setScheduleTimeField(value as ScheduleTimeField);
              }}
            />
            <div className="search-date-row">
              <DatePicker value={startDate} onChange={setStartDate} placeholder="开始日期" />
              <DatePicker value={endDate} onChange={setEndDate} placeholder="结束日期" />
            </div>
          </section>

          {mode === "todo" ? (
            <section className="search-option-group">
              <span className="search-option-title">待办</span>
              <Dropdown
                value={todoStatus}
                options={[
                  { value: "all", label: "全部状态" },
                  { value: "open", label: "未完成" },
                  { value: "completed", label: "已完成" }
                ]}
                onChange={setTodoStatus}
              />
              <div className="search-number-row">
                <input
                  type="number"
                  min={0}
                  value={priorityMin}
                  onChange={(event) => setPriorityMin(event.target.value)}
                  placeholder="最低优先级"
                />
                <input
                  type="number"
                  min={0}
                  value={priorityMax}
                  onChange={(event) => setPriorityMax(event.target.value)}
                  placeholder="最高优先级"
                />
              </div>
              <input
                className="search-filter-input"
                value={tag}
                onChange={(event) => setTag(event.target.value)}
                placeholder="标签"
              />
            </section>
          ) : (
            <section className="search-option-group">
              <span className="search-option-title">日程</span>
              <input
                className="search-filter-input"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                placeholder="分类"
              />
              <input
                className="search-filter-input"
                value={location}
                onChange={(event) => setLocation(event.target.value)}
                placeholder="地点"
              />
            </section>
          )}
        </aside>

        <section className="search-results">
          <div className="search-results-toolbar">
            <span>{status || `${results.length}/${total} 项`}</span>
            <div className="search-sort-controls">
              <Dropdown
                value={currentSortBy}
                options={currentSortOptions}
                onChange={(value) => {
                  if (mode === "todo") setTodoSortBy(value);
                  else setScheduleSortBy(value);
                }}
              />
              <button
                type="button"
                className="sort-order-btn"
                onClick={() => setSortOrder((value) => (value === "desc" ? "asc" : "desc"))}
                aria-label={sortOrder === "desc" ? "降序" : "升序"}
                title={sortOrder === "desc" ? "降序" : "升序"}
              >
                {sortOrder === "desc" ? "↓" : "↑"}
              </button>
            </div>
          </div>

          <div className="search-result-list">
            {results.map((result) => {
              const key = resultKey(result);
              const isEditing = editingKey === key;
              return (
                <div
                  className={`search-result-row ${result.type}`}
                  key={key}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setContextMenu({ key, x: event.clientX, y: event.clientY });
                  }}
                >
                  <span className="search-result-kind">
                    {result.type === "todo" ? "ToDo" : "Schedule"}
                  </span>
                  <div className="search-result-main">
                    {isEditing ? (
                      <input
                        className="search-title-input"
                        value={editText}
                        onChange={(event) => setEditText(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") void saveRename(result);
                          if (event.key === "Escape") cancelRename();
                        }}
                        onBlur={() => void saveRename(result)}
                        autoFocus
                      />
                    ) : (
                      <button
                        type="button"
                        className="search-result-title"
                        onDoubleClick={() => beginRename(result)}
                        onClick={() => setDetail(result)}
                      >
                        {result.item.title}
                      </button>
                    )}
                    <div className="search-result-meta">
                      {result.type === "todo" ? (
                        <>
                          <span>{result.item.completed ? "已完成" : "未完成"}</span>
                          {result.item.tag ? <span>{result.item.tag}</span> : null}
                          {result.item.planned_at ? <span>计划 {formatEpoch(result.item.planned_at)}</span> : null}
                          {result.item.due_at ? <span>截止 {formatEpoch(result.item.due_at)}</span> : null}
                        </>
                      ) : (
                        <>
                          <span>{formatEpoch(result.item.start_at)} - {formatEpoch(result.item.end_at)}</span>
                          {result.item.category ? <span>{result.item.category}</span> : null}
                          {result.item.location ? <span>{result.item.location}</span> : null}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {contextMenu && contextItem ? (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={[
            {
              label: "跳转",
              icon: <JumpIcon />,
              action: () => onNavigate(contextItem.type)
            },
            {
              label: "编辑",
              icon: <EditIcon />,
              action: () => setDetail(contextItem)
            },
            {
              label: "删除",
              icon: <TrashIcon />,
              danger: true,
              action: () => void deleteResult(contextItem)
            }
          ]}
          onClose={() => setContextMenu(null)}
        />
      ) : null}

      {detail?.type === "todo" ? (
        <TodoDetailModal
          todo={detail.item}
          api={api}
          onClose={() => setDetail(null)}
          onDelete={(id) => {
            setResults((items) => items.filter((item) => item.type !== "todo" || item.item.id !== id));
            setDetail(null);
          }}
          onUpdate={(item) => replaceResult({ type: "todo", item })}
        />
      ) : null}

      {detail?.type === "schedule" ? (
        <ScheduleDetailModal
          schedule={detail.item}
          api={api}
          onClose={() => setDetail(null)}
          onDelete={(id) => {
            setResults((items) => items.filter((item) => item.type !== "schedule" || item.item.id !== id));
            setDetail(null);
          }}
          onUpdate={(item) => replaceResult({ type: "schedule", item })}
        />
      ) : null}

      {confirmDialog}
    </div>
  );
}

function resultKey(result: ResultItem): string {
  return `${result.type}:${result.item.id}`;
}
