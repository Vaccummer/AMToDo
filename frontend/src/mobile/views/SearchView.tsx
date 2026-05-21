import { useEffect, useMemo, useState } from "react";
import type { AMToDoApi, NotificationItem, ScheduleItem, TodoItem } from "../../api/client";
import type { ConnectionStatusSnapshot } from "../../api/connection-status";
import { addDaysToDateKey, dateKeyFromEpoch, formatDueTime, formatTime, isOverdueTodo, startOfDateKeyEpoch } from "../../lib/time";
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
  todoStatus: string;
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
  todoStatus: "all",
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

function CalendarIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M897.9 369.2H205c-33.8 0-61.4-27.6-61.4-61.4s27.6-61.4 61.4-61.4h692.9c33.8 0 61.4 27.6 61.4 61.4s-27.6 61.4-61.4 61.4z" fill="#FFB89A" />
      <path d="M807 171H703.3c-16.6 0-30 13.4-30 30s13.4 30 30 30H807c31.6 0 57.4 24 57.4 53.4v42.3H125.2v-42.3c0-29.5 25.7-53.4 57.4-53.4H293c16.6 0 30-13.4 30-30s-13.4-30-30-30H182.5c-64.7 0-117.4 50.9-117.4 113.4v527.7c0 62.5 52.7 113.4 117.4 113.4H807c64.7 0 117.4-50.9 117.4-113.4V284.5c0-62.6-52.7-113.5-117.4-113.5z m0 694.6H182.5c-31.6 0-57.4-24-57.4-53.4V386.8h739.2v425.4c0.1 29.5-25.7 53.4-57.3 53.4z" fill="#45484C" />
      <path d="M700.2 514.5H200.5c-16.6 0-30 13.4-30 30s13.4 30 30 30h499.7c16.6 0 30-13.4 30-30s-13.5-30-30-30zM668.4 689.8h-74c-16.6 0-30 13.4-30 30s13.4 30 30 30h74c16.6 0 30-13.4 30-30s-13.4-30-30-30zM479.3 689.8H200.5c-16.6 0-30 13.4-30 30s13.4 30 30 30h278.8c16.6 0 30-13.4 30-30s-13.4-30-30-30z" fill="#33CC99" />
    </svg>
  );
}

function NotifyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function cloneSearchConfig(config: SearchConfig): SearchConfig {
  return {
    ...config,
    todoFields: [...config.todoFields],
    scheduleFields: [...config.scheduleFields]
  };
}

function dateRangeParams(startDate: string, endDate: string): [number | null, number | null] {
  const start = startDate ? startOfDateKeyEpoch(startDate) : null;
  const end = endDate ? startOfDateKeyEpoch(addDaysToDateKey(endDate, 1)) : null;
  return [start, end];
}

function formatEpoch(epoch: number | null): string {
  if (epoch === null) return "";
  const d = new Date(epoch * 1000);
  const nowYear = new Date().getFullYear();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hm = formatTime(epoch);
  if (year === nowYear) {
    return `${month}-${day} ${hm}`;
  }
  return `${year}-${month}-${day} ${hm}`;
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

function AttachmentCountIcon() {
  return (
    <svg className="search-attachment-icon" viewBox="0 0 1024 1024" aria-hidden="true">
      <path d="M431.8 350c36.8 0 71.5 7.9 104.3 23.6 24.6 11.6 46.8 27.4 66.8 47.3 19.9 19.9 35.7 42.2 47.3 66.7-15.8 15.8-34.8 23.6-57 23.6-7.8 0-15.6-1.2-23.6-3.5-13.4-21.8-31.8-40.1-53.6-53.6-25.8-15.7-53.9-23.6-84.1-23.6-21 0-41.4 4-61.1 12-19.7 8-37.4 19.8-52.9 35.3l-121 121c-15.5 15.5-27.3 33.2-35.3 52.9-7.9 19.4-12 40.1-12 61.1s4 41.4 12 61.1c8 19.8 19.7 37.4 35.3 52.9 15.6 15.6 33.2 27.3 52.9 35.3 19.4 7.9 40.2 12 61.2 12s41.4-4 61.1-12c19.7-8 37.4-19.8 52.9-35.3l84.7-84.7c26.9 7.3 54.7 11 83.5 11 4.6 0 11.1-0.2 19.5-0.6-3.2 3.5-6.4 7-9.7 10.4l-121 121c-23.3 23.3-49.7 40.9-79.3 52.9-29.1 11.9-60.3 18-91.8 18s-62.2-6-91.8-18.1c-29.7-12.1-56.1-29.7-79.3-52.8-23.3-23.3-40.9-49.7-52.9-79.2-11.9-29.1-18-60.3-18-91.8s6.1-62.7 18-91.8c12-29.5 29.6-55.9 52.9-79.2l121-121c2.3-2.3 5.8-5.5 10.4-9.8 22.5-20 47.6-35.1 75.3-45.5 27.7-10.3 56.1-15.5 85.3-15.6zM714.1 67.8c31.5 0 62.7 6.1 91.8 18 29.5 11.9 55.9 29.6 79.3 52.9 23.3 23.3 41 49.7 52.9 79.2 11.9 29.2 18 60.3 17.9 91.8 0 31.5-6.1 62.1-18.1 91.8-12.1 29.7-29.7 56.1-52.8 79.2l-121 121c-2.3 2.4-5.8 5.6-10.4 9.8-22.4 20-47.5 35.1-75.3 45.5-27.3 10.3-56.2 15.6-85.4 15.6-36.7 0-71.5-7.9-104.3-23.6-24.6-11.6-46.8-27.4-66.8-47.3-19.9-19.9-35.7-42.2-47.3-66.7 15.7-15.8 34.7-23.6 57-23.6 7.8 0 15.7 1.2 23.6 3.5 13.4 21.8 31.7 40.1 53.5 53.6 25.9 15.7 53.9 23.6 84.1 23.6 21 0 41.4-4 61.1-12 19.8-8 37.4-19.8 52.9-35.3l121-121c15.6-15.5 27.3-33.2 35.3-52.9 7.9-19.4 12-40.1 12-61.1s-4-41.4-12-61.1c-8-19.8-19.8-37.4-35.3-52.9-15.6-15.6-33.2-27.3-52.9-35.3-19.4-7.9-40.2-12-61.1-12-21 0-41.4 4-61.1 12-19.8 8-37.4 19.8-52.9 35.3L515 280.5c-26.9-7.3-54.7-11-83.5-11-4.6 0-11.1 0.2-19.5 0.6 3.2-3.5 6.4-7 9.8-10.4l121-121c23.1-23.1 49.5-40.7 79.2-52.8 29.9-12.1 60.5-18.2 92.1-18.1z m0 0" />
    </svg>
  );
}

function IdIcon() {
  return (
    <svg className="todo-id-icon" viewBox="0 0 1024 1024" aria-hidden="true">
      <path d="M933.933489 392.327772a38.459877 38.459877 0 0 0 38.35759-38.35759 38.459877 38.459877 0 0 0-38.35759-38.35759h-205.187534L757.488576 42.813412A38.613307 38.613307 0 0 0 723.171318 0.210916 38.562164 38.562164 0 0 0 680.773396 34.732747l-29.151769 280.879845H413.395422l28.486904-272.79918A38.562164 38.562164 0 0 0 407.769642 0.210916a38.562164 38.562164 0 0 0-42.142205 34.317257l-29.407486 281.084419H90.066511a38.459877 38.459877 0 0 0-38.35759 38.35759 38.51102 38.51102 0 0 0 38.35759 38.35759h238.175062l-24.958006 238.635352H90.066511a38.35759 38.35759 0 1 0 0 76.71518h205.187534L266.511424 980.477484a38.35759 38.35759 0 1 0 76.71518 8.080665l29.356342-280.879845h238.226206l-28.486904 272.79918a38.35759 38.35759 0 1 0 76.254889 8.080665l29.407486-280.879845h245.948866a38.35759 38.35759 0 0 0 0-76.71518h-238.175062l24.958006-238.635352z m-315.299389 238.635352H380.407895l24.958005-238.635352h238.226205z" fill="#00C080" />
    </svg>
  );
}

function updateFields(fields: string[], value: string, checked: boolean): string[] {
  if (checked) return Array.from(new Set([...fields, value]));
  const next = fields.filter((field) => field !== value);
  return next.length ? next : fields;
}

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
  const [todoStatus, setTodoStatus] = useState(initialConfig.todoStatus);
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
  const [results, setResults] = useState<ResultItem[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState(t("search.notSearched"));
  const [busy, setBusy] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [detail, setDetail] = useState<ResultItem | null>(null);
  const [editingNotifyId, setEditingNotifyId] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<{ key: string; x: number; y: number } | null>(null);
  const { ask, dialog: confirmDialog } = useConfirm();

  const currentFields = mode === "todo" ? todoFields : mode === "schedule" ? scheduleFields : notifyFields;
  const currentSortOptions = mode === "todo" ? getTodoSortOptions(t) : mode === "schedule" ? getScheduleSortOptions(t) : getNotifySortOptions(t);
  const currentSortBy = mode === "todo" ? todoSortBy : mode === "schedule" ? scheduleSortBy : notifySortBy;

  const contextItem = useMemo(
    () => (contextMenu ? results.find((result) => resultKey(result) === contextMenu.key) ?? null : null),
    [contextMenu, results]
  );

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
      todoStatus,
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
    todoStatus,
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
        if (todoStatus === "open") params.completed = false;
        if (todoStatus === "completed") params.completed = true;
        if (priorityMin) params.priority_min = Number(priorityMin);
        if (priorityMax) params.priority_max = Number(priorityMax);
        if (tag.trim()) params.tag = tag.trim();
        if (description.trim()) params.description = description.trim();
        const response = await api.searchTodos(query, params);
        setResults(response.todos.map((item) => ({ type: "todo", item })));
        setTotal(response.total);
        onConnectionError?.(null);
        setStatus(response.total ? "" : t("search.noMatch"));
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
    setResults([]);
    setTotal(0);
    setStatus(t("search.notSearched"));
    setContextMenu(null);
    setDetail(null);
    setEditingNotifyId(null);
    cancelRename();
  }

  // Helper: check if a group has active values
  const matchHasValue = useRegex || idSearch || !ignoreCase || currentFields.length < (mode === "todo" ? 3 : mode === "schedule" ? 4 : 2);

  function hasTimeRangeValue(ranges: Record<string, { start: string; end: string }>) {
    return Object.values(ranges).some((r) => r.start || r.end);
  }
  const timeHasValue = mode === "todo"
    ? hasTimeRangeValue(todoTimeRanges)
    : mode === "schedule"
      ? hasTimeRangeValue(scheduleTimeRanges)
      : hasTimeRangeValue(notifyTimeRanges);

  function timeOptionsWithValues(options: { value: string; label: string }[], ranges: Record<string, { start: string; end: string }>) {
    return options.map((o) => ({ ...o, hasValue: Boolean(ranges[o.value]?.start || ranges[o.value]?.end) }));
  }

  const todoHasValue = todoStatus !== "all" || priorityMin || priorityMax || tag.trim() || description.trim();
  const scheduleHasValue = category.trim() || location.trim();
  const notifyHasValue = description.trim();

  function ResetIcon() {
    return (
      <svg width="10" height="10" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
        <path d="M528.896 998.4c-262.656 0-476.672-214.016-476.672-476.672S266.24 45.056 528.896 45.056c163.84 0 314.368 82.432 402.432 221.184 14.336 22.528 7.68 53.248-14.848 67.584a49.3568 49.3568 0 0 1-67.584-14.848 377.2416 377.2416 0 0 0-320-175.616c-208.896 0-378.88 169.984-378.88 378.88s169.984 378.88 378.88 378.88a378.88 378.88 0 0 0 349.184-231.424c10.752-25.088 39.424-36.352 64-26.112 25.088 10.752 36.352 39.424 26.112 64a476.16 476.16 0 0 1-439.296 290.816z" fill="currentColor"/>
        <path d="M889.344 341.504h-217.6a49.152 49.152 0 0 1 0-98.304h168.96v-168.96a49.152 49.152 0 0 1 98.304 0v218.112c-1.024 27.136-22.528 49.152-49.664 49.152z" fill="currentColor"/>
      </svg>
    );
  }

  function resetMatch() {
    setUseRegex(false);
    setIgnoreCase(true);
    setIdSearch(false);
    if (mode === "todo") setTodoFields(["title", "description", "tag"]);
    else setScheduleFields(["title", "description", "location", "category"]);
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

  function resetNotifyFilters() {
    setDescription("");
  }

  function resetTodoFilters() {
    setTodoStatus("all");
    setPriorityMin("");
    setPriorityMax("");
    setTag("");
    setDescription("");
  }

  function resetScheduleFilters() {
    setCategory("");
    setLocation("");
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
            {t("tab.todo")}
          </button>
          <button
            type="button"
            className={mode === "schedule" ? "active" : ""}
            onClick={() => handleModeChange("schedule")}
          >
            {t("tab.schedule")}
          </button>
          <button
            type="button"
            className={mode === "notify" ? "active" : ""}
            onClick={() => handleModeChange("notify")}
          >
            {t("tab.notify")}
          </button>
        </div>
      </div>

      <div className="search-layout">
        <aside className="search-options">
          <div className="search-sidebar-box">
            <div className="search-sidebar-input-wrap">
              <SearchIcon />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void runSearch(); } }}
                placeholder={idSearch ? t("search.inputIdPlaceholder") : mode === "todo" ? t("search.searchTodos") : mode === "schedule" ? t("search.searchSchedules") : t("search.searchNotifications")}
              />
            </div>
            <button type="button" className="search-sidebar-btn" disabled={busy} onClick={() => void runSearch()}>
              {t("common.search")}
            </button>
          </div>

          {/* 匹配 */}
          <details className={`opt-collapsible${matchHasValue ? " has-group-value" : ""}`} open>
            <summary>
              <span className="search-option-title" style={{ display: "flex", alignItems: "center", gap: 5 }}>
                {t("search.match")}
                <span className="has-value-dot" />
              </span>
              <button
                type="button"
                className={`opt-reset-btn${matchHasValue ? " has-value" : ""}`}
                onClick={(e) => { e.stopPropagation(); resetMatch(); }}
              >
                <ResetIcon /> {t("common.reset")}
              </button>
            </summary>
            <div className="opt-body">
              <div className="search-toggle-row">
                <label className="search-toggle">
                  <input type="checkbox" checked={useRegex} onChange={(e) => setUseRegex(e.target.checked)} disabled={idSearch} />
                  <span>{t("common.regex")}</span>
                </label>
                <label className="search-toggle">
                  <input type="checkbox" checked={ignoreCase} onChange={(e) => setIgnoreCase(e.target.checked)} disabled={idSearch} />
                  <span>{t("common.ignoreCase")}</span>
                </label>
                <label className="search-toggle">
                  <input type="checkbox" checked={idSearch} onChange={(e) => setIdSearch(e.target.checked)} />
                  <span>ID</span>
                </label>
              </div>
              {!idSearch ? (
                <div className="field-chip-row" style={{ marginTop: 6 }}>
                  {(mode === "todo" ? getTodoFieldOptions(t) : mode === "schedule" ? getScheduleFieldOptions(t) : getNotifyFieldOptions(t)).map((field) => (
                    <label className="field-chip" key={field.value}>
                      <input
                        type="checkbox"
                        checked={currentFields.includes(field.value)}
                        onChange={(e) => {
                          if (mode === "todo") setTodoFields((f) => updateFields(f, field.value, e.target.checked));
                          else if (mode === "schedule") setScheduleFields((f) => updateFields(f, field.value, e.target.checked));
                          else setNotifyFields((f) => updateFields(f, field.value, e.target.checked));
                        }}
                      />
                      <span>{field.label}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <div className="search-id-hint">{t("search.idHint")}</div>
              )}
            </div>
          </details>

          {!idSearch ? (
            <>
              {/* 时间 */}
              <details className={`opt-collapsible${timeHasValue ? " has-group-value" : ""}`}>
                <summary>
                  <span className="search-option-title" style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    {t("search.time")}
                    <span className="has-value-dot" />
                  </span>
                  <button
                    type="button"
                    className={`opt-reset-btn${timeHasValue ? " has-value" : ""}`}
                    onClick={(e) => { e.stopPropagation(); resetTime(); }}
                  >
                    <ResetIcon /> {t("common.reset")}
                  </button>
                </summary>
                <div className="opt-body">
                  {mode === "todo" ? (
                    <>
                      <Dropdown
                        value={todoTimeField}
                        options={timeOptionsWithValues(getTodoTimeOptions(t), todoTimeRanges)}
                        onChange={(v) => setTodoTimeField(v as TodoTimeField)}
                      />
                      <div className="time-stack" style={{ marginTop: 6 }}>
                        <div className={`time-row${todoTimeRanges[todoTimeField].start || todoTimeRanges[todoTimeField].end ? " has-value" : ""}`}>
                          <div className="time-row-singles">
                            <DatePicker value={todoTimeRanges[todoTimeField].start} onChange={(v) => setTodoTimeRanges((prev) => ({ ...prev, [todoTimeField]: { ...prev[todoTimeField], start: v } }))} placeholder={t("common.startDate")} />
                            <DatePicker value={todoTimeRanges[todoTimeField].end} onChange={(v) => setTodoTimeRanges((prev) => ({ ...prev, [todoTimeField]: { ...prev[todoTimeField], end: v } }))} placeholder={t("common.endDate")} />
                          </div>
                        </div>
                      </div>
                    </>
                  ) : mode === "schedule" ? (
                    <>
                      <Dropdown
                        value={scheduleTimeField}
                        options={timeOptionsWithValues(getScheduleTimeOptions(t), scheduleTimeRanges)}
                        onChange={(v) => setScheduleTimeField(v as ScheduleTimeField)}
                      />
                      <div className="time-stack" style={{ marginTop: 6 }}>
                        <div className={`time-row${scheduleTimeRanges[scheduleTimeField].start || scheduleTimeRanges[scheduleTimeField].end ? " has-value" : ""}`}>
                          <div className="time-row-singles">
                            <DatePicker value={scheduleTimeRanges[scheduleTimeField].start} onChange={(v) => setScheduleTimeRanges((prev) => ({ ...prev, [scheduleTimeField]: { ...prev[scheduleTimeField], start: v } }))} placeholder={t("common.startDate")} />
                            <DatePicker value={scheduleTimeRanges[scheduleTimeField].end} onChange={(v) => setScheduleTimeRanges((prev) => ({ ...prev, [scheduleTimeField]: { ...prev[scheduleTimeField], end: v } }))} placeholder={t("common.endDate")} />
                          </div>
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <Dropdown
                        value={notifyTimeField}
                        options={timeOptionsWithValues(getNotifyTimeOptions(t), notifyTimeRanges)}
                        onChange={(v) => setNotifyTimeField(v as NotifyTimeField)}
                      />
                      <div className="time-stack" style={{ marginTop: 6 }}>
                        <div className={`time-row${notifyTimeRanges[notifyTimeField].start || notifyTimeRanges[notifyTimeField].end ? " has-value" : ""}`}>
                          <div className="time-row-singles">
                            <DatePicker value={notifyTimeRanges[notifyTimeField].start} onChange={(v) => setNotifyTimeRanges((prev) => ({ ...prev, [notifyTimeField]: { ...prev[notifyTimeField], start: v } }))} placeholder={t("common.startDate")} />
                            <DatePicker value={notifyTimeRanges[notifyTimeField].end} onChange={(v) => setNotifyTimeRanges((prev) => ({ ...prev, [notifyTimeField]: { ...prev[notifyTimeField], end: v } }))} placeholder={t("common.endDate")} />
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </details>

              {/* 待办 */}
              {mode === "todo" ? (
                <details className={`opt-collapsible${todoHasValue ? " has-group-value" : ""}`}>
                  <summary>
                    <span className="search-option-title" style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      {t("tab.todo")}
                      <span className="has-value-dot" />
                    </span>
                    <button
                      type="button"
                      className={`opt-reset-btn${todoHasValue ? " has-value" : ""}`}
                      onClick={(e) => { e.stopPropagation(); resetTodoFilters(); }}
                    >
                      <ResetIcon /> {t("common.reset")}
                    </button>
                  </summary>
                  <div className="opt-body">
                    <Dropdown
                      value={todoStatus}
                      options={[
                        { value: "all", label: t("search.allStatus") },
                        { value: "open", label: t("search.uncompleted") },
                        { value: "completed", label: t("search.completed") }
                      ]}
                      onChange={setTodoStatus}
                    />
                    <div className="search-number-row" style={{ marginTop: 6 }}>
                      <input
                        type="number"
                        min={0}
                        value={priorityMin}
                        onChange={(e) => setPriorityMin(e.target.value)}
                        placeholder={t("search.minPriority")}
                      />
                      <input
                        type="number"
                        min={0}
                        value={priorityMax}
                        onChange={(e) => setPriorityMax(e.target.value)}
                        placeholder={t("search.maxPriority")}
                      />
                    </div>
                    <input
                      className="search-filter-input"
                      value={tag}
                      onChange={(e) => setTag(e.target.value)}
                      placeholder={t("common.tags")}
                      style={{ marginTop: 6 }}
                    />
                    <input
                      className="search-filter-input"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder={t("common.description")}
                      style={{ marginTop: 6 }}
                    />
                  </div>
                </details>
              ) : mode === "schedule" ? (
                <details className={`opt-collapsible${scheduleHasValue ? " has-group-value" : ""}`}>
                  <summary>
                    <span className="search-option-title" style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      {t("tab.schedule")}
                      <span className="has-value-dot" />
                    </span>
                    <button
                      type="button"
                      className={`opt-reset-btn${scheduleHasValue ? " has-value" : ""}`}
                      onClick={(e) => { e.stopPropagation(); resetScheduleFilters(); }}
                    >
                      <ResetIcon /> {t("common.reset")}
                    </button>
                  </summary>
                  <div className="opt-body">
                    <input
                      className="search-filter-input"
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      placeholder={t("common.category")}
                    />
                    <input
                      className="search-filter-input"
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                      placeholder={t("common.location")}
                      style={{ marginTop: 6 }}
                    />
                  </div>
                </details>
              ) : (
                <details className={`opt-collapsible${notifyHasValue ? " has-group-value" : ""}`}>
                  <summary>
                    <span className="search-option-title" style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      {t("tab.notify")}
                      <span className="has-value-dot" />
                    </span>
                    <button
                      type="button"
                      className={`opt-reset-btn${notifyHasValue ? " has-value" : ""}`}
                      onClick={(e) => { e.stopPropagation(); resetNotifyFilters(); }}
                    >
                      <ResetIcon /> {t("common.reset")}
                    </button>
                  </summary>
                  <div className="opt-body">
                    <input
                      className="search-filter-input"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder={t("common.description")}
                    />
                  </div>
                </details>
              )}
            </>
          ) : null}
        </aside>

        <section className="search-results">
          <div className="search-results-toolbar">
            <span>{connectionStatus && (connectionStatus.status === "offline" || connectionStatus.status === "token-error") ? (connectionStatus.status === "offline" ? t("common.connectionFailed") : t("common.authFailed")) : status || `${results.length}/${total} ${t("common.items")}`}</span>
            <div className="search-sort-controls">
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
                className="sort-order-btn"
                onClick={() => setSortOrder((value) => (value === "desc" ? "asc" : "desc"))}
                aria-label={sortOrder === "desc" ? t("common.descending") : t("common.ascending")}
                title={sortOrder === "desc" ? t("common.descending") : t("common.ascending")}
              >
                {sortOrder === "desc" ? "↓" : "↑"}
              </button>
            </div>
          </div>

          <div className="search-result-list">
            {results.map((result) => {
              const key = resultKey(result);
              const isEditing = editingKey === key;
              if (result.type === "todo") {
                const todo = result.item;
                const overdue = isOverdueTodo(todo);
                const lateDone = Boolean(todo.completed && todo.due_at !== null && todo.completed_at !== null && todo.completed_at > todo.due_at);
                const hasDue = todo.due_at !== null;
                const statusLabel = overdue
                  ? `${t("common.overdue")} ${overdueDurationLabel(todo.due_at!, undefined, t)}`
                  : lateDone
                    ? `${t("common.overdue")} ${overdueDurationLabel(todo.due_at!, todo.completed_at!, t)}${t("common.completed")}`
                    : todo.completed
                      ? t("common.completed")
                      : t("common.inProgress");
                const rowClass = [
                  "todo-row",
                  todo.completed ? "completed" : "",
                  overdue ? "overdue" : "",
                  lateDone ? "late-done" : ""
                ].filter(Boolean).join(" ");
                return (
                  <div
                    className={rowClass}
                    key={key}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setContextMenu({ key, x: event.clientX, y: event.clientY });
                    }}
                  >
                    <button
                      type="button"
                      className="check-button"
                      onClick={(e) => { e.stopPropagation(); void toggleTodo(result); }}
                      title={todo.completed ? t("common.cancelComplete") : t("common.markComplete")}
                    >
                      {todo.completed ? "✓" : ""}
                    </button>
                    <div className="todo-main">
                      {isEditing ? (
                        <input
                          type="text"
                          className="todo-edit-input"
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
                          className="todo-title"
                          style={{ textAlign: "left", border: 0, background: "transparent", font: "inherit", cursor: "pointer", width: "100%" }}
                          onDoubleClick={() => beginRename(result)}
                          onClick={() => setDetail(result)}
                        >
                          {todo.title}
                        </button>
                      )}
                      <div className="todo-meta">
                        <span className="todo-status-badge">{statusLabel}</span>
                        {hasDue ? <span className="due-time">{t("common.due")} {formatDueTime(todo.due_at!)}</span> : <span className="due-time">{t("common.noDueDate")}</span>}
                        {todo.completed_at ? <span className="todo-completed-time">{t("common.finishedAt")} {formatDueTime(todo.completed_at)}</span> : null}
                      </div>
                    </div>
                    <div className="todo-right">
                      <span className="todo-id-badge" title={`id:${todo.id}`}>
                        <IdIcon />
                        <span>{todo.id}</span>
                      </span>
                      <span className="todo-attachment-count" title={`${t("common.attachments")} ${todo.attachment_count ?? 0}`}>
                        <AttachmentCountIcon />
                        <span>{todo.attachment_count ?? 0}</span>
                      </span>
                    </div>
                  </div>
                );
              }
              // Schedule result
              if (result.type === "schedule") {
                const schedule = result.item;
                return (
                  <div
                    className={["search-result-row", "schedule"].filter(Boolean).join(" ")}
                    key={key}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setContextMenu({ key, x: event.clientX, y: event.clientY });
                    }}
                  >
                    <span className="search-result-kind" title={`id:${schedule.id}`}>
                      <CalendarIcon />
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
                          {schedule.title}
                        </button>
                      )}
                      <div className="search-result-meta">
                        <span>{formatEpoch(schedule.start_at)} - {formatEpoch(schedule.end_at)}</span>
                        {schedule.category ? <span>{schedule.category}</span> : null}
                        {schedule.location ? <span>{schedule.location}</span> : null}
                        <span className="search-result-id">id:{schedule.id}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="search-delete-btn"
                      onClick={(e) => { e.stopPropagation(); void deleteResult(result); }}
                      title={t("common.delete")}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                );
              }
              // Notify result
              const notify = result.item;
              return (
                <div
                  className={["search-result-row", "notify"].filter(Boolean).join(" ")}
                  key={key}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setContextMenu({ key, x: event.clientX, y: event.clientY });
                  }}
                >
                  <span className="search-result-kind" title={`id:${notify.id}`}>
                    <NotifyIcon />
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
                        onClick={() => setEditingNotifyId(notify.id)}
                      >
                        {notify.title}
                      </button>
                    )}
                    <div className="search-result-meta">
                      <span>{t("common.trigger")} {formatEpoch(notify.trigger_at)}</span>
                      {notify.description ? <span>{notify.description}</span> : null}
                      <span className="search-result-id">id:{notify.id}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="search-delete-btn"
                    onClick={(e) => { e.stopPropagation(); void deleteResult(result); }}
                    title={t("common.delete")}
                  >
                    <TrashIcon />
                  </button>
                </div>
              );
            })}
            {results.length === 0 && (
              status === t("search.notSearched") ? (
                <div className="search-empty search-empty-initial">
                  <span className="search-empty-title">{t("search.searchDimension")}</span>
                  <span className="search-empty-sub">{t("search.searchDimensionHint")}</span>
                  <div className="search-cards">
                    <button type="button" className="search-card card-todo" onClick={() => setMode("todo")}>
                      <div className="card-icon">
                        <svg viewBox="0 0 24 24"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
                      </div>
                      <div className="card-text">
                        <span className="card-label">{t("tab.todo")}</span>
                        <span className="card-hint">{t("search.todoHint")}</span>
                      </div>
                    </button>
                    <button type="button" className="search-card card-schedule" onClick={() => setMode("schedule")}>
                      <div className="card-icon">
                        <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
                      </div>
                      <div className="card-text">
                        <span className="card-label">{t("tab.schedule")}</span>
                        <span className="card-hint">{t("search.scheduleHint")}</span>
                      </div>
                    </button>
                    <button type="button" className="search-card card-notify" onClick={() => setMode("notify")}>
                      <div className="card-icon">
                        <svg viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
                      </div>
                      <div className="card-text">
                        <span className="card-label">{t("tab.notify")}</span>
                        <span className="card-hint">{t("search.notificationHint")}</span>
                      </div>
                    </button>
                    <button type="button" className="search-card card-id" onClick={() => setIdSearch(true)}>
                      <div className="card-icon">
                        <svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                      </div>
                      <div className="card-text">
                        <span className="card-label">{t("search.idLookup")}</span>
                        <span className="card-hint">{t("search.idLookupHint")}</span>
                      </div>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="search-empty search-empty-no-result">
                  <div className="search-empty-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="11" cy="11" r="8" />
                      <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                  </div>
                  <span className="search-empty-title">{t("search.noMatchFound")}</span>
                  <span className="search-empty-sub">{query ? t("search.noResultsFor", { query }) : t("search.tryDifferent")}</span>
                  <div className="search-empty-badge">
                    <div className="search-empty-badge-dot" />
                    {t("search.matchCount", { count: 0 })}
                  </div>
                </div>
              )
            )}
          </div>
        </section>
      </div>

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
