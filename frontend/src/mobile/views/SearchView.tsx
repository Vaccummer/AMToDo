import { useEffect, useMemo, useState } from "react";
import type { AMToDoApi, NotificationItem, ScheduleItem, TodoItem } from "../../api/client";
import type { ConnectionStatusSnapshot } from "../../api/connection-status";
import { addDaysToDateKey, dateKeyFromEpoch, formatTime, isOverdueTodo, startOfDateKeyEpoch } from "../../lib/time";
import { ContextMenu, TrashIcon } from "./ContextMenu";
import { NotifyFormModal } from "./NotifyFormModal";
import { DatePicker } from "./DatePicker";
import { Dropdown } from "./Dropdown";
import { ScheduleDetailModal } from "./ScheduleDetailModal";
import { TodoDetailModal } from "./TodoDetailModal";
import { useConfirm } from "./ConfirmDialog";
import { useI18n } from "../../i18n";

type Props = {
  api: AMToDoApi;
  onNavigate: (target: "todo" | "schedule", dateKey?: string) => void;
  onOpenSettings?: (focusTarget?: "url" | "token") => void;
  connectionStatus?: ConnectionStatusSnapshot;
  onConnectionError?: (kind: "network" | "token" | null, message?: string) => void;
};

type SearchMode = "todo" | "schedule" | "notify";
type TodoTimeField = "planned" | "due" | "created" | "updated";
type ScheduleTimeField = "overlap" | "created" | "updated";
type NotifyTimeField = "trigger" | "created" | "updated";
type SortOrder = "asc" | "desc";
type TodoStatusFilter = "open" | "overdue" | "late-done" | "done";

const TODO_STATUS_FILTERS: TodoStatusFilter[] = ["open", "overdue", "late-done", "done"];
const NOT_SEARCHED_STATUS_TEXT = new Set(["尚未搜索", "Not searched yet"]);
const NO_MATCH_STATUS_TEXT = new Set(["没有匹配结果", "No results found"]);
const SEARCHING_STATUS_TEXT = new Set(["搜索中", "Searching..."]);
const INVALID_ID_STATUS_TEXT = new Set(["请输入有效的数字 ID", "Please enter valid numeric IDs"]);
const CONNECTION_FAILED_STATUS_TEXT = new Set(["连接失败", "Connection Failed"]);

function getTodoStatusFilterOptions(t: (key: string) => string) {
  return [
    { value: "open", label: t("search.statusOpen") },
    { value: "overdue", label: t("search.statusOverdue") },
    { value: "late-done", label: t("search.statusLateDone") },
    { value: "done", label: t("search.statusDone") }
  ];
}

type SearchConfig = {
  mode: SearchMode;
  query: string;
  useRegex: boolean;
  ignoreCase: boolean;
  idSearch: boolean;
  todoTimeField: TodoTimeField;
  scheduleTimeField: ScheduleTimeField;
  notifyTimeField: NotifyTimeField;
  todoTimeRanges: Record<TodoTimeField, { start: string; end: string }>;
  scheduleTimeRanges: Record<ScheduleTimeField, { start: string; end: string }>;
  notifyTimeRanges: Record<NotifyTimeField, { start: string; end: string }>;
  todoFields: string[];
  scheduleFields: string[];
  todoStatuses: TodoStatusFilter[];
  priorityMin: string;
  priorityMax: string;
  tag: string;
  description: string;
  category: string;
  location: string;
  todoSortBy: string;
  scheduleSortBy: string;
  sortOrder: SortOrder;
};

type ResultItem =
  | { type: "todo"; item: TodoItem }
  | { type: "schedule"; item: ScheduleItem }
  | { type: "notify"; item: NotificationItem };

function getTodoFieldOptions(t: (key: string) => string) {
  return [
    { value: "title", label: t("common.title") },
    { value: "description", label: t("common.description") },
    { value: "tag", label: t("common.tags") }
  ];
}

function getScheduleFieldOptions(t: (key: string) => string) {
  return [
    { value: "title", label: t("common.title") },
    { value: "description", label: t("common.description") },
    { value: "location", label: t("common.location") },
    { value: "category", label: t("common.category") }
  ];
}

function getTodoTimeOptions(t: (key: string) => string) {
  return [
    { value: "planned", label: t("common.plannedTime") },
    { value: "due", label: t("common.dueTime") },
    { value: "created", label: t("common.createdAt") },
    { value: "updated", label: t("common.updatedAt") }
  ];
}

function getScheduleTimeOptions(t: (key: string) => string) {
  return [
    { value: "overlap", label: t("search.scheduleTime") },
    { value: "created", label: t("common.createdAt") },
    { value: "updated", label: t("common.updatedAt") }
  ];
}

function getNotifyTimeOptions(t: (key: string) => string) {
  return [
    { value: "trigger", label: t("common.triggerTime") },
    { value: "created", label: t("common.createdAt") },
    { value: "updated", label: t("common.updatedAt") }
  ];
}

function getNotifyFieldOptions(t: (key: string) => string) {
  return [
    { value: "title", label: t("common.title") },
    { value: "description", label: t("common.description") }
  ];
}

function getNotifySortOptions(t: (key: string) => string) {
  return [
    { value: "trigger_at", label: t("common.triggerTime") },
    { value: "created_at", label: t("search.latestCreated") },
    { value: "updated_at", label: t("search.latestModified") },
    { value: "title", label: t("common.title") }
  ];
}

function getTodoSortOptions(t: (key: string) => string) {
  return [
    { value: "updated_at", label: t("search.latestModified") },
    { value: "created_at", label: t("search.latestCreated") },
    { value: "planned_at", label: t("common.plannedTime") },
    { value: "due_at", label: t("common.dueTime") },
    { value: "priority", label: t("common.priority") },
    { value: "status", label: t("common.status") },
    { value: "title", label: t("common.title") }
  ];
}

function getScheduleSortOptions(t: (key: string) => string) {
  return [
    { value: "updated_at", label: t("search.latestModified") },
    { value: "created_at", label: t("search.latestCreated") },
    { value: "start_at", label: t("common.startTime") },
    { value: "end_at", label: t("common.endTime") },
    { value: "duration", label: t("common.duration") },
    { value: "title", label: t("common.title") }
  ];
}

const EMPTY_TIME_RANGES = { start: "", end: "" };

const DEFAULT_SEARCH_CONFIG: SearchConfig = {
  mode: "todo",
  query: "",
  useRegex: false,
  ignoreCase: true,
  idSearch: false,
  todoTimeField: "planned",
  scheduleTimeField: "overlap",
  notifyTimeField: "trigger",
  todoTimeRanges: { planned: { ...EMPTY_TIME_RANGES }, due: { ...EMPTY_TIME_RANGES }, created: { ...EMPTY_TIME_RANGES }, updated: { ...EMPTY_TIME_RANGES } },
  scheduleTimeRanges: { overlap: { ...EMPTY_TIME_RANGES }, created: { ...EMPTY_TIME_RANGES }, updated: { ...EMPTY_TIME_RANGES } },
  notifyTimeRanges: { trigger: { ...EMPTY_TIME_RANGES }, created: { ...EMPTY_TIME_RANGES }, updated: { ...EMPTY_TIME_RANGES } },
  todoFields: ["title", "description", "tag"],
  scheduleFields: ["title", "description", "location", "category"],
  todoStatuses: [...TODO_STATUS_FILTERS],
  priorityMin: "",
  priorityMax: "",
  tag: "",
  description: "",
  category: "",
  location: "",
  todoSortBy: "updated_at",
  scheduleSortBy: "updated_at",
  sortOrder: "desc"
};

let searchSessionConfig: SearchConfig = cloneSearchConfig(DEFAULT_SEARCH_CONFIG);

/* ============================================================
   SVG Icons
   ============================================================ */

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function FilterIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
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
    <svg
      className="icon"
      viewBox="0 0 1024 1024"
      version="1.1"
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      aria-hidden="true"
    >
      <path d="M937.280742 9.50348L401.759629 737.47007l-73.176798-122.594896L937.280742 9.50348" fill="#515151" />
      <path d="M937.280742 9.50348L369.92297 632.456613l34.212529 103.112761L937.280742 9.50348" fill="#515151" />
      <path d="M937.280742 9.50348L329.058005 613.924826 77.215777 426.706265 937.280742 9.50348" fill="#515151" />
      <path d="M931.10348 12.829698L369.92297 632.456613l252.317401 194.346171 308.863109-813.973086" fill="#515151" />
    </svg>
  );
}


function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function ResetIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
      <path d="M528.896 998.4c-262.656 0-476.672-214.016-476.672-476.672S266.24 45.056 528.896 45.056c163.84 0 314.368 82.432 402.432 221.184 14.336 22.528 7.68 53.248-14.848 67.584a49.3568 49.3568 0 0 1-67.584-14.848 377.2416 377.2416 0 0 0-320-175.616c-208.896 0-378.88 169.984-378.88 378.88s169.984 378.88 378.88 378.88a378.88 378.88 0 0 0 349.184-231.424c10.752-25.088 39.424-36.352 64-26.112 25.088 10.752 36.352 39.424 26.112 64a476.16 476.16 0 0 1-439.296 290.816z" fill="currentColor"/>
      <path d="M889.344 341.504h-217.6a49.152 49.152 0 0 1 0-98.304h168.96v-168.96a49.152 49.152 0 0 1 98.304 0v218.112c-1.024 27.136-22.528 49.152-49.664 49.152z" fill="currentColor"/>
    </svg>
  );
}

/* ============================================================
   Utility functions
   ============================================================ */

function cloneSearchConfig(config: SearchConfig): SearchConfig {
  return {
    ...config,
    todoStatuses: [...config.todoStatuses],
    todoFields: [...config.todoFields],
    scheduleFields: [...config.scheduleFields]
  };
}

function dateRangeParams(startDate: string, endDate: string): [number | null, number | null] {
  const start = startDate ? startOfDateKeyEpoch(startDate) : null;
  const end = endDate ? startOfDateKeyEpoch(addDaysToDateKey(endDate, 1)) : null;
  return [start, end];
}

function formatSearchTodoDate(epoch: number | null): string {
  if (epoch === null) return "";
  const d = new Date(epoch * 1000);
  const now = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  if (year === now.getFullYear()) {
    return `${month}/${day} ${hours}:${minutes}`;
  }
  const yy = String(year).slice(2);
  return `${yy}/${month}/${day} ${hours}:${minutes}`;
}

function todoDueDateTone(epoch: number): "past" | "today" | "future" {
  const now = Math.floor(Date.now() / 1000);
  if (epoch < now) return "past";
  const dueKey = dateKeyFromEpoch(epoch);
  const todayKey = dateKeyFromEpoch(now);
  return dueKey === todayKey ? "today" : "future";
}

function formatNotifyTime(epoch: number | null): string {
  if (epoch === null) return "";
  const d = new Date(epoch * 1000);
  const yy = String(d.getFullYear()).slice(2);
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yy}/${mo}/${day} ${h}:${mi}`;
}

function formatScheduleDate(epoch: number): string {
  const d = new Date(epoch * 1000);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${m}/${day} ${h}:${min}`;
}

function overdueDurationLabel(fromEpoch: number, toEpoch: number | undefined, t: (key: string, params?: Record<string, string | number>) => string): string {
  const effectiveToEpoch = toEpoch ?? Math.floor(Date.now() / 1000);
  const seconds = Math.max(0, effectiveToEpoch - fromEpoch);
  const days = Math.floor(seconds / 86400);
  if (days > 0) return `${days} ${t("common.days")}`;
  const hours = Math.floor(seconds / 3600);
  if (hours > 0) return `${hours} ${t("common.hours")}`;
  const minutes = Math.max(1, Math.floor(seconds / 60));
  return `${minutes} ${t("common.minutes")}`;
}

function updateFields(fields: string[], value: string, checked: boolean): string[] {
  if (checked) return Array.from(new Set([...fields, value]));
  const next = fields.filter((field) => field !== value);
  return next.length ? next : fields;
}

function resultKey(result: ResultItem): string {
  return `${result.type}:${result.item.id}`;
}

function resultDateKey(result: ResultItem): string {
  if (result.type === "todo") {
    const item = result.item as TodoItem;
    const epoch = item.planned_at ?? item.due_at ?? item.created_at;
    return epoch ? dateKeyFromEpoch(epoch) : dateKeyFromEpoch(Math.floor(Date.now() / 1000));
  }
  if (result.type === "notify") {
    return dateKeyFromEpoch(result.item.trigger_at);
  }
  return dateKeyFromEpoch(result.item.start_at);
}

function sortResults(items: ResultItem[], sortBy: string, sortOrder: SortOrder): ResultItem[] {
  const dir = sortOrder === "asc" ? 1 : -1;
  return items.sort((a, b) => {
    const va = getSortValue(a, sortBy);
    const vb = getSortValue(b, sortBy);
    if (va < vb) return -1 * dir;
    if (va > vb) return 1 * dir;
    return 0;
  });
}

function getSortValue(result: ResultItem, sortBy: string): number | string {
  if (result.type === "todo") {
    const item = result.item;
    switch (sortBy) {
      case "updated_at": return item.updated_at ?? 0;
      case "created_at": return item.created_at ?? 0;
      case "planned_at": return item.planned_at ?? 0;
      case "due_at": return item.due_at ?? 0;
      case "priority": return item.priority ?? 0;
      case "status": return getTodoStatusOrder(item);
      case "title": return item.title ?? "";
      default: return 0;
    }
  }
  if (result.type === "notify") {
    const item = result.item;
    switch (sortBy) {
      case "trigger_at": return item.trigger_at ?? 0;
      case "created_at": return item.created_at ?? 0;
      case "updated_at": return item.updated_at ?? 0;
      case "title": return item.title ?? "";
      default: return 0;
    }
  }
  const item = result.item;
  switch (sortBy) {
    case "updated_at": return item.updated_at ?? 0;
    case "created_at": return item.created_at ?? 0;
    case "start_at": return item.start_at ?? 0;
    case "end_at": return item.end_at ?? 0;
    case "duration": return (item.end_at ?? 0) - (item.start_at ?? 0);
    case "title": return item.title ?? "";
    default: return 0;
  }
}

function getTodoStatusOrder(todo: TodoItem): number {
  const overdue = isOverdueTodo(todo);
  const lateDone = Boolean(todo.completed && todo.due_at !== null && todo.completed_at !== null && todo.completed_at > todo.due_at);
  if (overdue && !todo.completed) return 0; // overdue
  if (!todo.completed) return 1; // pending
  if (lateDone) return 2; // late-done
  return 3; // done
}

function todoStatusFilterForItem(todo: TodoItem): TodoStatusFilter {
  const overdue = isOverdueTodo(todo);
  const lateDone = Boolean(todo.completed && todo.due_at !== null && todo.completed_at !== null && todo.completed_at > todo.due_at);
  if (overdue && !todo.completed) return "overdue";
  if (!todo.completed) return "open";
  if (lateDone) return "late-done";
  return "done";
}

/* ============================================================
   Main Component
   ============================================================ */

export function SearchView({ api, onNavigate, onOpenSettings, connectionStatus, onConnectionError }: Props) {
  const { t } = useI18n();
  const initialConfig = useMemo(() => cloneSearchConfig(searchSessionConfig), []);
  const [mode, setMode] = useState<SearchMode>(initialConfig.mode);
  const [query, setQuery] = useState(initialConfig.query);
  const [useRegex, setUseRegex] = useState(initialConfig.useRegex);
  const [ignoreCase, setIgnoreCase] = useState(initialConfig.ignoreCase);
  const [idSearch, setIdSearch] = useState(initialConfig.idSearch);
  const [todoTimeField, setTodoTimeField] = useState<TodoTimeField>(initialConfig.todoTimeField);
  const [scheduleTimeField, setScheduleTimeField] = useState<ScheduleTimeField>(initialConfig.scheduleTimeField);
  const [notifyTimeField, setNotifyTimeField] = useState<NotifyTimeField>(initialConfig.notifyTimeField);
  const [todoTimeRanges, setTodoTimeRanges] = useState(initialConfig.todoTimeRanges);
  const [scheduleTimeRanges, setScheduleTimeRanges] = useState(initialConfig.scheduleTimeRanges);
  const [notifyTimeRanges, setNotifyTimeRanges] = useState(initialConfig.notifyTimeRanges);
  const [todoFields, setTodoFields] = useState(initialConfig.todoFields);
  const [scheduleFields, setScheduleFields] = useState(initialConfig.scheduleFields);
  const [notifyFields, setNotifyFields] = useState(["title", "description"]);
  const [todoStatuses, setTodoStatuses] = useState<TodoStatusFilter[]>(initialConfig.todoStatuses);
  const [priorityMin, setPriorityMin] = useState(initialConfig.priorityMin);
  const [priorityMax, setPriorityMax] = useState(initialConfig.priorityMax);
  const [tag, setTag] = useState(initialConfig.tag);
  const [description, setDescription] = useState(initialConfig.description);
  const [category, setCategory] = useState(initialConfig.category);
  const [location, setLocation] = useState(initialConfig.location);
  const [todoSortBy, setTodoSortBy] = useState(initialConfig.todoSortBy);
  const [scheduleSortBy, setScheduleSortBy] = useState(initialConfig.scheduleSortBy);
  const [notifySortBy, setNotifySortBy] = useState("trigger_at");
  const [sortOrder, setSortOrder] = useState<SortOrder>(initialConfig.sortOrder);
  const [resultsMap, setResultsMap] = useState<Record<SearchMode, { results: ResultItem[]; total: number; status: string }>>({
    todo: { results: [], total: 0, status: t("search.notSearched") },
    schedule: { results: [], total: 0, status: t("search.notSearched") },
    notify: { results: [], total: 0, status: t("search.notSearched") },
  });
  const results = resultsMap[mode].results;
  const total = resultsMap[mode].total;
  const status = resultsMap[mode].status;
  function isNotSearchedStatus(value: string): boolean {
    return NOT_SEARCHED_STATUS_TEXT.has(value);
  }
  function displayStatus(value: string): string {
    if (NOT_SEARCHED_STATUS_TEXT.has(value)) return t("search.notSearched");
    if (NO_MATCH_STATUS_TEXT.has(value)) return t("search.noMatch");
    if (SEARCHING_STATUS_TEXT.has(value)) return t("search.searching");
    if (INVALID_ID_STATUS_TEXT.has(value)) return t("search.invalidId");
    if (CONNECTION_FAILED_STATUS_TEXT.has(value)) return t("common.connectionFailed");
    return value;
  }
  function setResults(items: ResultItem[] | ((prev: ResultItem[]) => ResultItem[])) {
    setResultsMap((prev) => {
      const current = prev[mode].results;
      const next = typeof items === "function" ? items(current) : items;
      return { ...prev, [mode]: { ...prev[mode], results: next } };
    });
  }
  function setTotal(n: number | ((prev: number) => number)) {
    setResultsMap((prev) => {
      const current = prev[mode].total;
      const next = typeof n === "function" ? n(current) : n;
      return { ...prev, [mode]: { ...prev[mode], total: next } };
    });
  }
  function setStatus(s: string) { setResultsMap((prev) => ({ ...prev, [mode]: { ...prev[mode], status: s } })); }
  const [busy, setBusy] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [detail, setDetail] = useState<ResultItem | null>(null);
  const [editingNotifyId, setEditingNotifyId] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<{ key: string; x: number; y: number } | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const { ask, dialog: confirmDialog } = useConfirm();

  const currentFields = mode === "todo" ? todoFields : mode === "schedule" ? scheduleFields : notifyFields;
  const currentSortOptions = mode === "todo" ? getTodoSortOptions(t) : mode === "schedule" ? getScheduleSortOptions(t) : getNotifySortOptions(t);
  const currentSortBy = mode === "todo" ? todoSortBy : mode === "schedule" ? scheduleSortBy : notifySortBy;

  const contextItem = useMemo(
    () => (contextMenu ? results.find((result) => resultKey(result) === contextMenu.key) ?? null : null),
    [contextMenu, results]
  );

  // Check if any filter is active (for the floating button dot)
  const matchHasValue = useRegex || idSearch || !ignoreCase || currentFields.length < (mode === "todo" ? 3 : mode === "schedule" ? 4 : 2);

  function hasTimeRangeValue(ranges: Record<string, { start: string; end: string }>) {
    return Object.values(ranges).some((r) => r.start || r.end);
  }
  const timeHasValue = mode === "todo"
    ? hasTimeRangeValue(todoTimeRanges)
    : mode === "schedule"
      ? hasTimeRangeValue(scheduleTimeRanges)
      : hasTimeRangeValue(notifyTimeRanges);

  const todoHasValue = todoStatuses.length < TODO_STATUS_FILTERS.length || priorityMin || priorityMax || tag.trim() || description.trim();
  const scheduleHasValue = category.trim() || location.trim();
  const notifyHasValue = description.trim();

  const anyFilterActive = matchHasValue || timeHasValue ||
    (mode === "todo" ? todoHasValue : mode === "schedule" ? scheduleHasValue : notifyHasValue);

  // Session persistence
  useEffect(() => {
    searchSessionConfig = {
      mode,
      query,
      useRegex,
      ignoreCase,
      idSearch,
      todoTimeField,
      scheduleTimeField,
      notifyTimeField,
      todoTimeRanges: JSON.parse(JSON.stringify(todoTimeRanges)),
      scheduleTimeRanges: JSON.parse(JSON.stringify(scheduleTimeRanges)),
      notifyTimeRanges: JSON.parse(JSON.stringify(notifyTimeRanges)),
      todoFields: [...todoFields],
      scheduleFields: [...scheduleFields],
      todoStatuses: [...todoStatuses],
      priorityMin,
      priorityMax,
      tag,
      description,
      category,
      location,
      todoSortBy,
      scheduleSortBy,
      sortOrder
    };
  }, [
    mode,
    query,
    useRegex,
    ignoreCase,
    idSearch,
    todoTimeField,
    scheduleTimeField,
    notifyTimeField,
    todoTimeRanges,
    scheduleTimeRanges,
    notifyTimeRanges,
    todoFields,
    scheduleFields,
    todoStatuses,
    priorityMin,
    priorityMax,
    tag,
    description,
    category,
    location,
    todoSortBy,
    scheduleSortBy,
    sortOrder
  ]);

  // Re-sort existing results when sort options change
  useEffect(() => {
    if (results.length <= 1) return;
    const sortBy = mode === "todo" ? todoSortBy : mode === "schedule" ? scheduleSortBy : notifySortBy;
    setResults((prev) => sortResults([...prev], sortBy, sortOrder));
  }, [todoSortBy, scheduleSortBy, notifySortBy, sortOrder]);

  /* ============================================================
     Search logic (preserved from desktop)
     ============================================================ */

  async function runSearch() {
    setBusy(true);
    setStatus(t("search.searching"));
    try {
      if (idSearch) {
        const ids = query.split(/\s+/).map((s) => parseInt(s, 10)).filter((n) => !isNaN(n) && n > 0);
        if (ids.length === 0) {
          setResults([]);
          setTotal(0);
          setStatus(t("search.invalidId"));
          return;
        }
        if (mode === "todo") {
          const fetched = await Promise.allSettled(ids.map((id) => api.getTodo(id)));
          const items: ResultItem[] = [];
          for (const r of fetched) {
            if (r.status === "fulfilled") items.push({ type: "todo", item: r.value.todo });
          }
          setResults(items);
          setTotal(items.length);
          setStatus(items.length ? "" : t("search.noMatch"));
        } else if (mode === "schedule") {
          const fetched = await Promise.allSettled(ids.map((id) => api.getSchedule(id)));
          const items: ResultItem[] = [];
          for (const r of fetched) {
            if (r.status === "fulfilled") items.push({ type: "schedule", item: r.value.schedule });
          }
          setResults(items);
          setTotal(items.length);
          setStatus(items.length ? "" : t("search.noMatch"));
        } else {
          const fetched = await Promise.allSettled(ids.map((id) => api.getNotification(id)));
          const items: ResultItem[] = [];
          for (const r of fetched) {
            if (r.status === "fulfilled") items.push({ type: "notify", item: r.value.notification });
          }
          setResults(items);
          setTotal(items.length);
          setStatus(items.length ? "" : t("search.noMatch"));
        }
        return;
      }
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
        for (const field of ["planned", "due", "created", "updated"] as const) {
          const range = todoTimeRanges[field];
          if (range.start || range.end) {
            const [s, e] = dateRangeParams(range.start, range.end);
            if (field === "planned") { params.planned_start_at = s; params.planned_end_at = e; }
            else if (field === "due") { params.due_start_at = s; params.due_end_at = e; }
            else if (field === "created") { params.created_start_at = s; params.created_end_at = e; }
            else { params.updated_start_at = s; params.updated_end_at = e; }
          }
        }
        if (priorityMin) params.priority_min = Number(priorityMin);
        if (priorityMax) params.priority_max = Number(priorityMax);
        if (tag.trim()) params.tag = tag.trim();
        if (description.trim()) params.description = description.trim();
        const response = await api.searchTodos(query, params);
        const filteredTodos = response.todos.filter((item) => todoStatuses.includes(todoStatusFilterForItem(item)));
        setResults(filteredTodos.map((item) => ({ type: "todo", item })));
        setTotal(filteredTodos.length);
        onConnectionError?.(null);
        setStatus(filteredTodos.length ? "" : t("search.noMatch"));
      } else if (mode === "schedule") {
        const params: Parameters<AMToDoApi["searchSchedules"]>[1] = {
          fields: scheduleFields,
          use_regex: useRegex,
          ignore_case: ignoreCase,
          sort_by: scheduleSortBy,
          sort_order: sortOrder,
          limit: 100,
          offset: 0
        };
        for (const field of ["overlap", "created", "updated"] as const) {
          const range = scheduleTimeRanges[field];
          if (range.start || range.end) {
            const [s, e] = dateRangeParams(range.start, range.end);
            if (field === "overlap") { params.start_at = s; params.end_at = e; }
            else if (field === "created") { params.created_start_at = s; params.created_end_at = e; }
            else { params.updated_start_at = s; params.updated_end_at = e; }
          }
        }
        if (category.trim()) params.category = category.trim();
        if (location.trim()) params.location = location.trim();
        const response = await api.searchSchedules(query, params);
        setResults(response.schedules.map((item) => ({ type: "schedule", item })));
        setTotal(response.total);
        onConnectionError?.(null);
        setStatus(response.total ? "" : t("search.noMatch"));
      } else {
        // Notify mode: fetch all and client-side filter
        let startAt: number | null = null;
        let endAt: number | null = null;
        for (const field of ["trigger", "created", "updated"] as const) {
          const range = notifyTimeRanges[field];
          if (range.start || range.end) {
            const [s, e] = dateRangeParams(range.start, range.end);
            if (field === "trigger") { startAt = s; endAt = e; }
          }
        }
        const response = await api.listNotifications({ start_at: startAt, end_at: endAt });
        let items = response.notifications;
        const q = query.trim().toLowerCase();
        if (q) {
          const matchFields = notifyFields;
          const regex = useRegex ? (() => { try { return new RegExp(query, ignoreCase ? "i" : ""); } catch { return null; } })() : null;
          items = items.filter((n) => {
            return matchFields.some((field) => {
              const val = field === "title" ? n.title : n.description ?? "";
              if (useRegex && regex) return regex.test(val);
              return ignoreCase ? val.toLowerCase().includes(q) : val.includes(q);
            });
          });
        }
        const sortBy = notifySortBy;
        const dir = sortOrder === "asc" ? 1 : -1;
        items = items.sort((a, b) => {
          let va: number | string = 0;
          let vb: number | string = 0;
          switch (sortBy) {
            case "trigger_at": va = a.trigger_at; vb = b.trigger_at; break;
            case "created_at": va = a.created_at; vb = b.created_at; break;
            case "updated_at": va = a.updated_at ?? 0; vb = b.updated_at ?? 0; break;
            case "title": va = a.title; vb = b.title; break;
          }
          if (va < vb) return -1 * dir;
          if (va > vb) return 1 * dir;
          return 0;
        });
        const resultItems: ResultItem[] = items.map((item) => ({ type: "notify", item }));
        setResults(resultItems);
        setTotal(resultItems.length);
        setStatus(resultItems.length ? "" : t("search.noMatch"));
      }
    } catch (error: unknown) {
      setResults([]);
      setTotal(0);
      if (error instanceof TypeError) {
        onConnectionError?.("network", t("connection.cannotConnectDesc"));
        setStatus(t("common.connectionFailed"));
      } else {
        const msg = error instanceof Error ? error.message : t("common.searchFailed");
        onConnectionError?.("token", msg);
        setStatus(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  /* ============================================================
     CRUD actions (preserved from desktop)
     ============================================================ */

  function beginRename(result: ResultItem) {
    if (result.type === "notify") {
      setEditingNotifyId(result.item.id);
      return;
    }
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
      setStatus(error instanceof Error ? error.message : t("common.saveFailed"));
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
      title: result.type === "todo" ? t("todo.deleteTodo") : result.type === "schedule" ? t("schedule.deleteSchedule") : t("schedule.deleteNotification"),
      message: t("common.moveToTrashConfirm"),
      confirmLabel: t("common.moveToTrash"),
      danger: true
    });
    if (!ok) return;
    try {
      if (result.type === "todo") {
        await api.deleteTodo(result.item.id);
      } else if (result.type === "schedule") {
        await api.deleteSchedule(result.item.id);
      } else {
        await api.deleteNotification(result.item.id);
      }
      const key = resultKey(result);
      setResults((items) => items.filter((item) => resultKey(item) !== key));
      setTotal((value) => Math.max(0, value - 1));
      setDetail((current) => (current && resultKey(current) === key ? null : current));
    } catch (error: unknown) {
      setStatus(error instanceof Error ? error.message : t("common.deleteFailed"));
    }
  }

  async function toggleTodo(result: ResultItem) {
    if (result.type !== "todo") return;
    const todo = result.item as TodoItem;
    const completed = !todo.completed;
    try {
      if (todo.completed) {
        await api.reopenTodo(todo.id);
      } else {
        await api.completeTodo(todo.id);
      }
      const updated: TodoItem = { ...todo, completed, completed_at: completed ? Math.floor(Date.now() / 1000) : null };
      replaceResult({ type: "todo", item: updated });
    } catch {
      // ignore
    }
  }

  function handleModeChange(next: SearchMode) {
    setMode(next);
    setContextMenu(null);
    setDetail(null);
    setEditingNotifyId(null);
    cancelRename();
  }

  /* ============================================================
     Filter actions
     ============================================================ */

  function timeOptionsWithValues(options: { value: string; label: string }[], ranges: Record<string, { start: string; end: string }>) {
    return options.map((o) => ({ ...o, hasValue: Boolean(ranges[o.value]?.start || ranges[o.value]?.end) }));
  }

  function resetMatch() {
    setUseRegex(false);
    setIgnoreCase(true);
    setIdSearch(false);
    if (mode === "todo") setTodoFields(["title", "description", "tag"]);
    else if (mode === "schedule") setScheduleFields(["title", "description", "location", "category"]);
    else setNotifyFields(["title", "description"]);
  }

  function resetTime() {
    if (mode === "todo") {
      setTodoTimeRanges({ planned: { ...EMPTY_TIME_RANGES }, due: { ...EMPTY_TIME_RANGES }, created: { ...EMPTY_TIME_RANGES }, updated: { ...EMPTY_TIME_RANGES } });
    } else if (mode === "schedule") {
      setScheduleTimeRanges({ overlap: { ...EMPTY_TIME_RANGES }, created: { ...EMPTY_TIME_RANGES }, updated: { ...EMPTY_TIME_RANGES } });
    } else {
      setNotifyTimeRanges({ trigger: { ...EMPTY_TIME_RANGES }, created: { ...EMPTY_TIME_RANGES }, updated: { ...EMPTY_TIME_RANGES } });
    }
  }

  function resetTodoFilters() {
    setTodoStatuses([...TODO_STATUS_FILTERS]);
    setPriorityMin("");
    setPriorityMax("");
    setTag("");
    setDescription("");
  }

  function toggleTodoStatus(status: TodoStatusFilter) {
    setTodoStatuses((prev) => (
      prev.includes(status)
        ? prev.filter((item) => item !== status)
        : [...prev, status]
    ));
  }

  function resetScheduleFilters() {
    setCategory("");
    setLocation("");
  }

  function resetNotifyFilters() {
    setDescription("");
  }

  function resetAllFilters() {
    resetMatch();
    resetTime();
    if (mode === "todo") resetTodoFilters();
    else if (mode === "schedule") resetScheduleFilters();
    else resetNotifyFilters();
  }

  function handleSearchSubmit() {
    void runSearch();
    setSheetOpen(false);
  }

  /* ============================================================
     Render helpers
     ============================================================ */

  function getTodoCardStatus(todo: TodoItem): { label: string; className: string } {
    const overdue = isOverdueTodo(todo);
    const lateDone = Boolean(todo.completed && todo.due_at !== null && todo.completed_at !== null && todo.completed_at > todo.due_at);
    if (overdue && !todo.completed) return { label: t("common.overdue"), className: "overdue" };
    if (lateDone) return { label: t("common.overdueCompleted"), className: "late-done" };
    if (todo.completed) return { label: t("common.completed"), className: "done" };
    return { label: "", className: "pending" };
  }

  function getScheduleCardStatus(schedule: ScheduleItem): { label: string; className: string } {
    const now = Math.floor(Date.now() / 1000);
    if (schedule.end_at && schedule.end_at < now) return { label: t("common.completed"), className: "done" };
    if (schedule.start_at && schedule.start_at > now) return { label: t("common.inProgress"), className: "pending" };
    return { label: t("common.inProgress"), className: "pending" };
  }

  function getNotifyCardStatus(notify: NotificationItem): { label: string; className: string } {
    const now = Math.floor(Date.now() / 1000);
    if (notify.trigger_at < now) return { label: t("common.completed"), className: "done" };
    return { label: t("common.inProgress"), className: "pending" };
  }

  /* ============================================================
     JSX
     ============================================================ */

  return (
    <div className="ms-container">
      {/* Top section: dark gradient header */}
      <div className="ms-top-section">
        <div className="ms-search-field">
          <SearchIcon />
          <input
            type="text"
            enterKeyHint="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSearchSubmit(); }}
            placeholder={idSearch ? t("search.inputIdPlaceholder") : mode === "todo" ? t("search.searchTodos") : mode === "schedule" ? t("search.searchSchedules") : t("search.searchNotifications")}
          />
          <button
            type="button"
            className={`ms-filter-toggle${anyFilterActive ? " active" : ""}`}
            onClick={() => setSheetOpen(true)}
            aria-label={t("search.match")}
          >
            <FilterIcon />
          </button>
        </div>

        <div className="ms-segmented-control">
          <button
            type="button"
            className={`ms-segment${mode === "todo" ? " active" : ""}`}
            onClick={() => handleModeChange("todo")}
          >
            {t("tab.todo")}
          </button>
          <button
            type="button"
            className={`ms-segment${mode === "schedule" ? " active" : ""}`}
            onClick={() => handleModeChange("schedule")}
          >
            {t("tab.schedule")}
          </button>
          <button
            type="button"
            className={`ms-segment${mode === "notify" ? " active" : ""}`}
            onClick={() => handleModeChange("notify")}
          >
            {t("tab.notify")}
          </button>
        </div>
      </div>

      {/* Results area */}
      <div className="ms-results-scroll">
        {/* Results meta: count + sort */}
        {results.length > 0 || (status && !isNotSearchedStatus(status)) ? (
          <div className="ms-results-meta">
            <span className="ms-results-count">
              {connectionStatus && (connectionStatus.status === "offline" || connectionStatus.status === "token-error")
                ? (connectionStatus.status === "offline" ? t("common.connectionFailed") : t("common.authFailed"))
                : displayStatus(status) || `${results.length}/${total} ${t("common.items")}`}
            </span>
            <div className="ms-sort-controls">
              <Dropdown
                value={currentSortBy}
                options={currentSortOptions}
                onChange={(value) => {
                  if (mode === "todo") setTodoSortBy(value);
                  else if (mode === "schedule") setScheduleSortBy(value);
                  else setNotifySortBy(value);
                }}
              />
              <button
                type="button"
                className="ms-sort-order-btn"
                onClick={() => setSortOrder((v) => (v === "desc" ? "asc" : "desc"))}
                aria-label={sortOrder === "desc" ? t("common.descending") : t("common.ascending")}
              >
                {sortOrder === "desc" ? "↓" : "↑"}
              </button>
            </div>
          </div>
        ) : null}

        {/* Result cards */}
        <div className="ms-card-list">
          {results.map((result) => {
            const key = resultKey(result);
            const isEditing = editingKey === key;

            if (result.type === "todo") {
              const todo = result.item;
              const cardStatus = getTodoCardStatus(todo);
              const dueTone = todo.due_at !== null ? todoDueDateTone(todo.due_at) : null;
              const showDuePlaceholder = todo.due_at === null && todo.completed_at !== null;
              const showDueDate = todo.due_at !== null || showDuePlaceholder;
              return (
                <div
                  className={`ms-card ms-card--${cardStatus.className}`}
                  key={key}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setContextMenu({ key, x: e.clientX, y: e.clientY });
                  }}
                  onClick={() => setDetail(result)}
                >
                  <div className="ms-card-header">
                    {isEditing ? (
                      <input
                        type="text"
                        className="ms-card-edit-input"
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === "Enter") void saveRename(result);
                          if (e.key === "Escape") cancelRename();
                        }}
                        onBlur={() => void saveRename(result)}
                        onClick={(e) => e.stopPropagation()}
                        autoFocus
                      />
                    ) : (
                      <>
                        <div
                          className={`ms-card-title${todo.completed ? " ms-card-title--completed" : ""}`}
                          onDoubleClick={() => beginRename(result)}
                        >
                          {todo.title}
                        </div>
                        {cardStatus.label && (
                          <span className="ms-card-status">
                            <span className={`ms-card-dot ms-card-dot--${cardStatus.className}`}></span>
                            <span className={`ms-card-status-label ms-card-status-label--${cardStatus.className}`}>{cardStatus.label}</span>
                          </span>
                        )}
                      </>
                    )}
                  </div>

                  <div className="ms-card-meta">
                    <span className="ms-card-meta-item ms-card-meta-item--id">No.{todo.id}</span>
                    {(todo.attachment_count ?? 0) > 0 ? (
                      <span className="ms-card-meta-item ms-card-meta-item--attach">🔗 {todo.attachment_count}</span>
                    ) : null}
                    {todo.tag ? (
                      <span className="ms-card-meta-item ms-card-meta-item--tag">
                        <svg width="16" height="16" viewBox="0 0 1024 1024" fill="currentColor" style={{ flexShrink: 0 }}>
                          <path d="M745.0624 123.1872H252.928a108.8512 108.8512 0 0 0-108.8512 108.8512v612.3008a83.456 83.456 0 0 0 131.6352 68.1472L445.44 792.6272a108.8 108.8 0 0 1 128.3072 1.8944l146.7904 110.4896a83.456 83.456 0 0 0 133.632-66.56V232.0384a108.8512 108.8512 0 0 0-109.1072-108.8512z m-118.6304 169.984H371.5584a30.72 30.72 0 0 1 0-61.44h254.8736a30.72 30.72 0 0 1 0 61.44z" />
                        </svg>
                        <span>{todo.tag}</span>
                      </span>
                    ) : null}
                  </div>

                  <div className="ms-card-dates">
                    {showDueDate ? (
                      <span className={`ms-card-date-item ms-card-date-item--due${dueTone ? ` ms-card-date-item--${dueTone}` : ""}${showDuePlaceholder ? " ms-card-date-item--placeholder" : ""}`}>
                        <svg width="14" height="14" viewBox="0 0 1024 1024" className="ms-card-date-icon" aria-hidden="true">
                          <path d="M983.637333 302.933333A502.101333 502.101333 0 0 0 719.957333 40.106667C751.786667 15.189333 792.149333 0 836.010667 0 939.861333 0 1024 83.882667 1024 187.306667c0 43.690667-15.104 83.797333-40.362667 115.626666z m-7.68 207.104a459.264 459.264 0 0 1-126.72 316.928l64.853334 64.597334a47.36 47.36 0 1 1-67.157334 66.901333l-69.632-69.461333a462.762667 462.762667 0 0 1-265.386666 83.285333 462.762667 462.762667 0 0 1-264.704-82.944l-69.290667 68.949333a47.872 47.872 0 0 1-67.84-67.584l64.341333-64.170666A459.264 459.264 0 0 1 47.957333 510.037333C47.957333 254.805333 255.744 47.786667 512 47.786667c256.256 0 464.042667 207.018667 464.042667 462.250666z m-271.957333 47.786667a47.872 47.872 0 1 0 0-95.573333H560.042667V255.146667a47.872 47.872 0 0 0-96.085334 0v254.976c0 26.453333 21.504 47.786667 48.042667 47.786666h192zM41.216 309.504A189.781333 189.781333 0 0 1 0 191.146667 191.658667 191.658667 0 0 1 192 0c44.8 0 85.930667 15.36 118.613333 40.96A512.853333 512.853333 0 0 0 41.216 309.504z" fill="#FA6935" />
                        </svg>
                        <span className="ms-card-date-text">{todo.due_at !== null ? formatSearchTodoDate(todo.due_at) : t("common.noDueDate")}</span>
                      </span>
                    ) : null}
                    {todo.completed_at ? (
                      <span className="ms-card-date-item ms-card-date-item--completed">
                        <svg width="14" height="14" viewBox="0 0 1024 1024" className="ms-card-date-icon" aria-hidden="true">
                          <path d="M38.04 518.35a475.12 487.33 0 1 0 950.24 0 475.12 487.33 0 1 0-950.24 0Z" fill="#07AA74" />
                          <path d="M513.16 18.75C258.74 18.75 52.5 224.99 52.5 479.41c0 254.42 206.25 460.66 460.66 460.66s460.66-206.25 460.66-460.66c0.01-254.42-206.24-460.66-460.66-460.66z m0 769.72c-170.69 0-309.06-138.37-309.06-309.06s138.37-309.06 309.06-309.06 309.06 138.37 309.06 309.06c0.01 170.69-138.37 309.06-309.06 309.06z" fill="#56D8B0" />
                          <path d="M716.75 407.79L507.91 616.64c-9.06 9.06-20.93 13.59-32.8 13.59-11.88 0-23.76-4.53-32.81-13.59L309.58 483.92c-18.12-18.11-18.12-47.49 0-65.62 18.12-18.11 47.49-18.11 65.62 0l99.91 99.91 176.03-176.04c18.12-18.11 47.5-18.11 65.62 0 18.11 18.13 18.11 47.51-0.01 65.62z" fill="#FFFFFF" />
                        </svg>
                        <span className="ms-card-date-text">{formatSearchTodoDate(todo.completed_at)}</span>
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            }

            if (result.type === "schedule") {
              const schedule = result.item;
              return (
                <div
                  className="ms-card ms-card--schedule"
                  key={key}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setContextMenu({ key, x: e.clientX, y: e.clientY });
                  }}
                  onClick={() => setDetail(result)}
                >
                  {isEditing ? (
                    <input
                      type="text"
                      className="ms-card-edit-input"
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === "Enter") void saveRename(result);
                        if (e.key === "Escape") cancelRename();
                      }}
                      onBlur={() => void saveRename(result)}
                      onClick={(e) => e.stopPropagation()}
                      autoFocus
                    />
                  ) : (
                    <div className="ms-card-schedule-timeline">
                      <div className="ms-card-schedule-dots">
                        <span className="ms-card-schedule-dot ms-card-schedule-dot--start"></span>
                        <span className="ms-card-schedule-line"></span>
                        <span className="ms-card-schedule-dot ms-card-schedule-dot--end"></span>
                      </div>
                      <div className="ms-card-schedule-body">
                        <div className="ms-card-schedule-header">
                          <div className="ms-card-title" onDoubleClick={() => beginRename(result)}>{schedule.title}</div>
                          <span className="ms-card-schedule-id">No.{schedule.id}</span>
                        </div>
                        <div className="ms-card-schedule-time-row">
                          <span className="ms-card-schedule-time-label">{t("common.startShort")}</span>
                          <span className="ms-card-schedule-time-value">{formatScheduleDate(schedule.start_at)}</span>
                        </div>
                        <div className="ms-card-schedule-time-row">
                          <span className="ms-card-schedule-time-label">{t("common.endShort")}</span>
                          <span className="ms-card-schedule-time-value">{formatScheduleDate(schedule.end_at)}</span>
                        </div>
                        <div className="ms-card-schedule-footer">
                          {schedule.location ? (
                            <span className="ms-card-schedule-chip ms-card-schedule-chip--loc"><svg width="14" height="14" viewBox="0 0 1024 1024"><path d="M511.744 68.267c-173.517 0-314.027 136.311-314.778 305.937 0 60.911 18.125 118.903 51.763 168.465l3.294 4.693 1.911 3.174 1.57 2.39c1.058 1.553 2.185 3.038 3.448 4.506l.785.853 200.175 232.823a68.267 68.267 0 00103.646-.17L762.641 558.08l-1.314 1.451a50.347 50.347 0 005.342-6.622l1.536-2.355c.631-.99 1.86-3.072 1.826-3.004 35.294-49.323 55.091-109.431 55.825-172.783C825.856 204.954 684.971 68.267 511.744 68.267zm0 68.267c135.97 0 245.845 106.598 245.845 237.824a235.4 235.4 0 01-43.981 134.775l-2.953 4.676-198.997 232.79-200.192-232.824-1.929-3.191-.99-1.451a230.23 230.23 0 01-43.315-134.775C265.83 242.859 375.415 136.533 511.744 136.533z" fill="#444"/><path d="M783.804 714.735a34.133 34.133 0 0145.244 10.018l1.434 2.253 73.387 125.73a68.267 68.267 0 01-54.784 102.554l-4.557.12-666.044-3.636a68.267 68.267 0 01-60.655-98.85l2.133-3.943 69.94-119.262a34.133 34.133 0 0160.16 32.171l-1.263 2.355-69.94 119.262 666.044 3.635-73.387-125.73a34.133 34.133 0 0112.288-46.677z" fill="#444"/><path d="M512 243.951a136.533 136.533 0 100 273.067 136.533 136.533 0 000-273.067zm0 68.267a68.267 68.267 0 110 136.533 68.267 68.267 0 010-136.533z" fill="#00B386"/></svg>{schedule.location}</span>
                          ) : null}
                          {schedule.attachment_count ? (
                            <span className="ms-card-schedule-chip ms-card-schedule-chip--attach">🔗 {schedule.attachment_count}</span>
                          ) : null}
                          {schedule.category ? (
                            <span className="ms-card-schedule-chip ms-card-schedule-chip--cat"><svg width="14" height="14" viewBox="0 0 1024 1024"><path d="M745.062 123.187H252.928a108.851 108.851 0 00-108.851 108.851v612.301a83.456 83.456 0 00131.635 68.147l169.728-119.872a108.8 108.8 0 01128.307 1.894l146.791 110.49a83.456 83.456 0 00133.632-66.56V232.038a108.851 108.851 0 00-109.107-108.851zm-118.63 169.984H371.558a30.72 30.72 0 010-61.44h254.874a30.72 30.72 0 010 61.44z" fill="#505587"/></svg> {schedule.category}</span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            }

            // Notify result
            const notify = result.item;
            const triggered = notify.trigger_at < Math.floor(Date.now() / 1000);
            return (
              <div
                className="ms-card ms-card--notify"
                key={key}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenu({ key, x: e.clientX, y: e.clientY });
                }}
                onClick={() => setEditingNotifyId(notify.id)}
              >
                <div className="ms-card-notify-row">
                  {isEditing ? (
                    <input
                      type="text"
                      className="ms-card-edit-input"
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === "Enter") void saveRename(result);
                        if (e.key === "Escape") cancelRename();
                      }}
                      onBlur={() => void saveRename(result)}
                      onClick={(e) => e.stopPropagation()}
                      autoFocus
                    />
                  ) : (
                    <>
                      <span className={`ms-card-notify-icon${triggered ? " ms-card-notify-icon--done" : ""}`}>
                        {triggered ? <CheckIcon /> : <BellIcon />}
                      </span>
                      <span
                        className="ms-card-notify-title"
                        onDoubleClick={() => beginRename(result)}
                      >
                        {notify.title}
                      </span>
                      <span className="ms-card-notify-time">{formatNotifyTime(notify.trigger_at)}</span>
                    </>
                  )}
                </div>
              </div>
            );
          })}

          {/* Empty states */}
          {results.length === 0 && (
            isNotSearchedStatus(status) ? (
              <div className="ms-empty-initial">
                <span className="ms-empty-title">{t("search.searchDimension")}</span>
                <span className="ms-empty-desc">{t("search.searchDimensionHint")}</span>
                <div className="ms-dimension-cards">
                  <button type="button" className="ms-dimension-card ms-card-todo" onClick={() => handleModeChange("todo")}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
                    <span className="ms-dimension-card-label">{t("tab.todo")}</span>
                    <span className="ms-empty-card-hint">{t("search.todoHint")}</span>
                  </button>
                  <button type="button" className="ms-dimension-card ms-card-schedule" onClick={() => handleModeChange("schedule")}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
                    <span className="ms-dimension-card-label">{t("tab.schedule")}</span>
                    <span className="ms-empty-card-hint">{t("search.scheduleHint")}</span>
                  </button>
                  <button type="button" className="ms-dimension-card ms-card-notify" onClick={() => handleModeChange("notify")}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
                    <span className="ms-dimension-card-label">{t("tab.notify")}</span>
                    <span className="ms-empty-card-hint">{t("search.notificationHint")}</span>
                  </button>
                  <button type="button" className="ms-dimension-card ms-card-id" onClick={() => setIdSearch(true)}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                    <span className="ms-dimension-card-label">{t("search.idLookup")}</span>
                    <span className="ms-empty-card-hint">{t("search.idLookupHint")}</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="ms-empty-no-results">
                <div className="ms-empty-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                </div>
                <span className="ms-empty-title">{t("search.noMatchFound")}</span>
                <span className="ms-empty-desc">{query ? t("search.noResultsFor", { query }) : t("search.tryDifferent")}</span>
                <div className="ms-empty-badge">
                  <div className="ms-empty-badge-dot" />
                  {t("search.matchCount", { count: 0 })}
                </div>
              </div>
            )
          )}
        </div>

      </div>

      {/* Filter bottom sheet */}
          <div className={`ms-sheet-overlay${sheetOpen ? " open" : ""}`} onClick={() => setSheetOpen(false)} />
          <div className={`ms-bottom-sheet${sheetOpen ? " open" : ""}`}>
            <div className="ms-sheet-handle" />
            <div className="ms-sheet-header">
              <h3 className="ms-sheet-title">{t("search.match")}</h3>
              <button type="button" className="ms-sheet-reset" onClick={resetAllFilters}>
                <ResetIcon /> {t("common.reset")}
              </button>
            </div>
            <div className="ms-sheet-body">
              {/* Match group */}
              <div className="ms-filter-group">
                <div className="ms-filter-group-head">
                  <div className="ms-filter-group-title">{t("search.match")}</div>
                  <button type="button" className="ms-filter-group-reset" onClick={resetMatch}>{t("common.reset")}</button>
                </div>
                <div className="ms-filter-chips">
                  <button
                    type="button"
                    className={`ms-filter-chip${useRegex ? " selected" : ""}`}
                    onClick={() => setUseRegex(!useRegex)}
                    disabled={idSearch}
                  >
                    {t("common.regex")}
                  </button>
                  <button
                    type="button"
                    className={`ms-filter-chip${ignoreCase ? " selected" : ""}`}
                    onClick={() => setIgnoreCase(!ignoreCase)}
                    disabled={idSearch}
                  >
                    {t("common.ignoreCase")}
                  </button>
                  <button
                    type="button"
                    className={`ms-filter-chip${idSearch ? " selected" : ""}`}
                    onClick={() => setIdSearch(!idSearch)}
                  >
                    ID
                  </button>
                </div>
                {!idSearch && (
                  <div className="ms-filter-chips" style={{ marginTop: 8 }}>
                    {(mode === "todo" ? getTodoFieldOptions(t) : mode === "schedule" ? getScheduleFieldOptions(t) : getNotifyFieldOptions(t)).map((field) => (
                      <button
                        key={field.value}
                        type="button"
                        className={`ms-filter-chip${currentFields.includes(field.value) ? " selected" : ""}`}
                        onClick={() => {
                          const checked = !currentFields.includes(field.value);
                          if (mode === "todo") setTodoFields((f) => updateFields(f, field.value, checked));
                          else if (mode === "schedule") setScheduleFields((f) => updateFields(f, field.value, checked));
                          else setNotifyFields((f) => updateFields(f, field.value, checked));
                        }}
                      >
                        {field.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Time range group */}
              {!idSearch && (
                <div className="ms-filter-group">
                  <div className="ms-filter-group-head">
                    <div className="ms-filter-group-title">{t("search.time")}</div>
                    <button type="button" className="ms-filter-group-reset" onClick={resetTime}>{t("common.reset")}</button>
                  </div>
                  <div className="ms-filter-chips">
                    {mode === "todo" ? (
                      timeOptionsWithValues(getTodoTimeOptions(t), todoTimeRanges).map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          className={`ms-filter-chip${todoTimeField === opt.value ? " selected" : ""}${opt.hasValue ? " has-value" : ""}`}
                          onClick={() => setTodoTimeField(opt.value as TodoTimeField)}
                        >
                          {opt.label}
                        </button>
                      ))
                    ) : mode === "schedule" ? (
                      timeOptionsWithValues(getScheduleTimeOptions(t), scheduleTimeRanges).map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          className={`ms-filter-chip${scheduleTimeField === opt.value ? " selected" : ""}${opt.hasValue ? " has-value" : ""}`}
                          onClick={() => setScheduleTimeField(opt.value as ScheduleTimeField)}
                        >
                          {opt.label}
                        </button>
                      ))
                    ) : (
                      timeOptionsWithValues(getNotifyTimeOptions(t), notifyTimeRanges).map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          className={`ms-filter-chip${notifyTimeField === opt.value ? " selected" : ""}${opt.hasValue ? " has-value" : ""}`}
                          onClick={() => setNotifyTimeField(opt.value as NotifyTimeField)}
                        >
                          {opt.label}
                        </button>
                      ))
                    )}
                  </div>
                  <div className="ms-date-row">
                    <DatePicker
                      value={mode === "todo" ? todoTimeRanges[todoTimeField].start : mode === "schedule" ? scheduleTimeRanges[scheduleTimeField].start : notifyTimeRanges[notifyTimeField].start}
                      onChange={(v) => {
                        if (mode === "todo") setTodoTimeRanges((prev) => ({ ...prev, [todoTimeField]: { ...prev[todoTimeField], start: v } }));
                        else if (mode === "schedule") setScheduleTimeRanges((prev) => ({ ...prev, [scheduleTimeField]: { ...prev[scheduleTimeField], start: v } }));
                        else setNotifyTimeRanges((prev) => ({ ...prev, [notifyTimeField]: { ...prev[notifyTimeField], start: v } }));
                      }}
                      placeholder={t("common.startDate")}
                    />
                    <DatePicker
                      value={mode === "todo" ? todoTimeRanges[todoTimeField].end : mode === "schedule" ? scheduleTimeRanges[scheduleTimeField].end : notifyTimeRanges[notifyTimeField].end}
                      onChange={(v) => {
                        if (mode === "todo") setTodoTimeRanges((prev) => ({ ...prev, [todoTimeField]: { ...prev[todoTimeField], end: v } }));
                        else if (mode === "schedule") setScheduleTimeRanges((prev) => ({ ...prev, [scheduleTimeField]: { ...prev[scheduleTimeField], end: v } }));
                        else setNotifyTimeRanges((prev) => ({ ...prev, [notifyTimeField]: { ...prev[notifyTimeField], end: v } }));
                      }}
                      placeholder={t("common.endDate")}
                      panelAlign="right"
                    />
                  </div>
                </div>
              )}

              {/* Mode-specific filters */}
              {!idSearch && mode === "todo" && (
                <div className="ms-filter-group">
                  <div className="ms-filter-group-head">
                    <div className="ms-filter-group-title">{t("tab.todo")}</div>
                    <button type="button" className="ms-filter-group-reset" onClick={resetTodoFilters}>{t("common.reset")}</button>
                  </div>
                  <div className="ms-filter-chips">
                    {getTodoStatusFilterOptions(t).map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        className={`ms-filter-chip${todoStatuses.includes(opt.value as TodoStatusFilter) ? " selected" : ""}`}
                        onClick={() => toggleTodoStatus(opt.value as TodoStatusFilter)}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <div className="ms-filter-inputs">
                    <input
                      type="number"
                      min={0}
                      value={priorityMin}
                      onChange={(e) => setPriorityMin(e.target.value)}
                      placeholder={t("search.minPriority")}
                      className="ms-filter-input"
                    />
                    <input
                      type="number"
                      min={0}
                      value={priorityMax}
                      onChange={(e) => setPriorityMax(e.target.value)}
                      placeholder={t("search.maxPriority")}
                      className="ms-filter-input"
                    />
                  </div>
                  <input
                    className="ms-filter-input ms-filter-input-full"
                    value={tag}
                    onChange={(e) => setTag(e.target.value)}
                    placeholder={t("common.tags")}
                  />
                  <input
                    className="ms-filter-input ms-filter-input-full"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={t("common.description")}
                  />
                </div>
              )}

              {!idSearch && mode === "schedule" && (
                <div className="ms-filter-group">
                  <div className="ms-filter-group-head">
                    <div className="ms-filter-group-title">{t("tab.schedule")}</div>
                    <button type="button" className="ms-filter-group-reset" onClick={resetScheduleFilters}>{t("common.reset")}</button>
                  </div>
                  <input
                    className="ms-filter-input ms-filter-input-full"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    placeholder={t("common.category")}
                  />
                  <input
                    className="ms-filter-input ms-filter-input-full"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder={t("common.location")}
                  />
                </div>
              )}

              {!idSearch && mode === "notify" && (
                <div className="ms-filter-group">
                  <div className="ms-filter-group-head">
                    <div className="ms-filter-group-title">{t("tab.notify")}</div>
                    <button type="button" className="ms-filter-group-reset" onClick={resetNotifyFilters}>{t("common.reset")}</button>
                  </div>
                  <input
                    className="ms-filter-input ms-filter-input-full"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={t("common.description")}
                  />
                </div>
              )}
            </div>
            <button type="button" className="ms-sheet-apply" onClick={handleSearchSubmit}>
              {t("common.search")}
            </button>
          </div>

      {/* Context menu */}
      {contextMenu && contextItem ? (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={[
            {
              label: `id:${contextItem.item.id}`,
              icon: null,
              action: () => {},
              disabled: true
            },
            {
              label: t("common.jump"),
              icon: <JumpIcon />,
              action: () => onNavigate(contextItem.type === "notify" ? "todo" : contextItem.type, resultDateKey(contextItem))
            },
            {
              label: t("common.edit"),
              icon: <EditIcon />,
              action: () => {
                if (contextItem.type === "notify") setEditingNotifyId(contextItem.item.id);
                else setDetail(contextItem);
              }
            },
            {
              label: t("common.delete"),
              icon: <TrashIcon />,
              danger: true,
              action: () => void deleteResult(contextItem)
            }
          ]}
          onClose={() => setContextMenu(null)}
        />
      ) : null}

      {/* Detail modals */}
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

      {editingNotifyId !== null ? (
        <NotifyFormModal
          api={api}
          editId={editingNotifyId}
          onClose={() => {
            setEditingNotifyId(null);
            void runSearch();
          }}
        />
      ) : null}

      {confirmDialog}
    </div>
  );
}
