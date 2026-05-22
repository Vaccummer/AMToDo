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

function CalendarIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function TagIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </svg>
  );
}

function LocationIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function NotifyIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function AttachmentCountIcon() {
  return (
    <svg className="ms-attachment-icon" viewBox="0 0 1024 1024" aria-hidden="true">
      <path d="M431.8 350c36.8 0 71.5 7.9 104.3 23.6 24.6 11.6 46.8 27.4 66.8 47.3 19.9 19.9 35.7 42.2 47.3 66.7-15.8 15.8-34.8 23.6-57 23.6-7.8 0-15.6-1.2-23.6-3.5-13.4-21.8-31.8-40.1-53.6-53.6-25.8-15.7-53.9-23.6-84.1-23.6-21 0-41.4 4-61.1 12-19.7 8-37.4 19.8-52.9 35.3l-121 121c-15.5 15.5-27.3 33.2-35.3 52.9-7.9 19.4-12 40.1-12 61.1s4 41.4 12 61.1c8 19.8 19.7 37.4 35.3 52.9 15.6 15.6 33.2 27.3 52.9 35.3 19.4 7.9 40.2 12 61.2 12s41.4-4 61.1-12c19.7-8 37.4-19.8 52.9-35.3l84.7-84.7c26.9 7.3 54.7 11 83.5 11 4.6 0 11.1-0.2 19.5-0.6-3.2 3.5-6.4 7-9.7 10.4l-121 121c-23.3 23.3-49.7 40.9-79.3 52.9-29.1 11.9-60.3 18-91.8 18s-62.2-6-91.8-18.1c-29.7-12.1-56.1-29.7-79.3-52.8-23.3-23.3-40.9-49.7-52.9-79.2-11.9-29.1-18-60.3-18-91.8s6.1-62.7 18-91.8c12-29.5 29.6-55.9 52.9-79.2l121-121c2.3-2.3 5.8-5.5 10.4-9.8 22.5-20 47.6-35.1 75.3-45.5 27.7-10.3 56.1-15.5 85.3-15.6zM714.1 67.8c31.5 0 62.7 6.1 91.8 18 29.5 11.9 55.9 29.6 79.3 52.9 23.3 23.3 41 49.7 52.9 79.2 11.9 29.2 18 60.3 17.9 91.8 0 31.5-6.1 62.1-18.1 91.8-12.1 29.7-29.7 56.1-52.8 79.2l-121 121c-2.3 2.4-5.8 5.6-10.4 9.8-22.4 20-47.5 35.1-75.3 45.5-27.3 10.3-56.2 15.6-85.4 15.6-36.7 0-71.5-7.9-104.3-23.6-24.6-11.6-46.8-27.4-66.8-47.3-19.9-19.9-35.7-42.2-47.3-66.7 15.7-15.8 34.7-23.6 57-23.6 7.8 0 15.7 1.2 23.6 3.5 13.4 21.8 31.7 40.1 53.5 53.6 25.9 15.7 53.9 23.6 84.1 23.6 21 0 41.4-4 61.1-12 19.8-8 37.4-19.8 52.9-35.3l121-121c15.6-15.5 27.3-33.2 35.3-52.9 7.9-19.4 12-40.1 12-61.1s-4-41.4-12-61.1c-8-19.8-19.8-37.4-35.3-52.9-15.6-15.6-33.2-27.3-52.9-35.3-19.4-7.9-40.2-12-61.1-12-21 0-41.4 4-61.1 12-19.8 8-37.4 19.8-52.9 35.3L515 280.5c-26.9-7.3-54.7-11-83.5-11-4.6 0-11.1 0.2-19.5 0.6 3.2-3.5 6.4-7 9.8-10.4l121-121c23.1-23.1 49.5-40.7 79.2-52.8 29.9-12.1 60.5-18.2 92.1-18.1z m0 0" />
    </svg>
  );
}

function IdIcon() {
  return (
    <svg className="ms-id-icon" viewBox="0 0 1024 1024" aria-hidden="true">
      <path d="M933.933489 392.327772a38.459877 38.459877 0 0 0 38.35759-38.35759 38.459877 38.459877 0 0 0-38.35759-38.35759h-205.187534L757.488576 42.813412A38.613307 38.613307 0 0 0 723.171318 0.210916 38.562164 38.562164 0 0 0 680.773396 34.732747l-29.151769 280.879845H413.395422l28.486904-272.79918A38.562164 38.562164 0 0 0 407.769642 0.210916a38.562164 38.562164 0 0 0-42.142205 34.317257l-29.407486 281.084419H90.066511a38.459877 38.459877 0 0 0-38.35759 38.35759 38.51102 38.51102 0 0 0 38.35759 38.35759h238.175062l-24.958006 238.635352H90.066511a38.35759 38.35759 0 1 0 0 76.71518h205.187534L266.511424 980.477484a38.35759 38.35759 0 1 0 76.71518 8.080665l29.356342-280.879845h238.226206l-28.486904 272.79918a38.35759 38.35759 0 1 0 76.254889 8.080665l29.407486-280.879845h245.948866a38.35759 38.35759 0 0 0 0-76.71518h-238.175062l24.958006-238.635352z m-315.299389 238.635352H380.407895l24.958005-238.635352h238.226205z" fill="#00C080" />
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

  const todoHasValue = todoStatus !== "all" || priorityMin || priorityMax || tag.trim() || description.trim();
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
    setResults([]);
    setTotal(0);
    setStatus(t("search.notSearched"));
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
    if (overdue) return { label: t("common.overdue"), className: "overdue" };
    if (lateDone) return { label: `${t("common.overdue")} ${t("common.completed")}`, className: "overdue" };
    if (todo.completed) return { label: t("common.completed"), className: "done" };
    return { label: t("common.inProgress"), className: "pending" };
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
        <div className="ms-top-row">
          <h2 className="ms-title">{t("tab.search") || "Search"}</h2>
          <button
            type="button"
            className={`ms-regex-toggle${useRegex ? " active" : ""}`}
            onClick={() => setUseRegex(!useRegex)}
            disabled={idSearch}
            aria-label={t("common.regex")}
          >
            .*
          </button>
        </div>

        <div className="ms-search-field">
          <SearchIcon />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSearchSubmit(); }}
            placeholder={idSearch ? t("search.inputIdPlaceholder") : mode === "todo" ? t("search.searchTodos") : mode === "schedule" ? t("search.searchSchedules") : t("search.searchNotifications")}
          />
          <button type="button" className="ms-go-btn" disabled={busy} onClick={handleSearchSubmit}>
            {busy ? "..." : t("common.search")}
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
        {results.length > 0 || (status && status !== t("search.notSearched")) ? (
          <div className="ms-results-meta">
            <span className="ms-results-count">
              {connectionStatus && (connectionStatus.status === "offline" || connectionStatus.status === "token-error")
                ? (connectionStatus.status === "offline" ? t("common.connectionFailed") : t("common.authFailed"))
                : status || `${results.length}/${total} ${t("common.items")}`}
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
        <div className="ms-result-list">
          {results.map((result) => {
            const key = resultKey(result);
            const isEditing = editingKey === key;

            if (result.type === "todo") {
              const todo = result.item;
              const cardStatus = getTodoCardStatus(todo);
              const overdue = isOverdueTodo(todo);
              const lateDone = Boolean(todo.completed && todo.due_at !== null && todo.completed_at !== null && todo.completed_at > todo.due_at);
              return (
                <div
                  className={`ms-result-card${todo.completed ? " ms-completed" : ""}${overdue ? " ms-overdue" : ""}${lateDone ? " ms-late-done" : ""}`}
                  key={key}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setContextMenu({ key, x: e.clientX, y: e.clientY });
                  }}
                  onClick={() => setDetail(result)}
                >
                  <div className="ms-card-top">
                    <span className="ms-type-badge ms-type-badge--todo">{t("tab.todo")}</span>
                    <span className={`ms-card-status ms-status-${cardStatus.className}`}>{cardStatus.label}</span>
                  </div>

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
                    <div
                      className="ms-card-title"
                      onDoubleClick={() => beginRename(result)}
                    >
                      {todo.completed ? <s>{todo.title}</s> : todo.title}
                    </div>
                  )}

                  {todo.description ? (
                    <div className="ms-card-desc">{todo.description}</div>
                  ) : null}

                  <div className="ms-card-meta">
                    {todo.due_at !== null ? (
                      <span className="ms-meta-item">
                        <CalendarIcon />
                        <span>{formatDueTime(todo.due_at)}</span>
                      </span>
                    ) : (
                      <span className="ms-meta-item">
                        <CalendarIcon />
                        <span>{t("common.noDueDate")}</span>
                      </span>
                    )}
                    {todo.tag ? (
                      <span className="ms-meta-item">
                        <TagIcon />
                        <span>{todo.tag}</span>
                      </span>
                    ) : null}
                    {todo.attachment_count ? (
                      <span className="ms-meta-item">
                        <AttachmentCountIcon />
                        <span>{todo.attachment_count}</span>
                      </span>
                    ) : null}
                    <span className="ms-meta-item ms-meta-id">
                      <IdIcon />
                      <span>{todo.id}</span>
                    </span>
                  </div>
                </div>
              );
            }

            if (result.type === "schedule") {
              const schedule = result.item;
              const cardStatus = getScheduleCardStatus(schedule);
              return (
                <div
                  className="ms-preview-card"
                  key={key}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setContextMenu({ key, x: e.clientX, y: e.clientY });
                  }}
                  onClick={() => setDetail(result)}
                >
                  <div className="ms-card-top">
                    <span className="ms-type-badge ms-type-badge--schedule">{t("tab.schedule")}</span>
                    <span className={`ms-card-status ms-status-${cardStatus.className}`}>{cardStatus.label}</span>
                  </div>

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
                    <div
                      className="ms-card-title"
                      onDoubleClick={() => beginRename(result)}
                    >
                      {schedule.title}
                    </div>
                  )}

                  {schedule.description ? (
                    <div className="ms-card-desc">{schedule.description}</div>
                  ) : null}

                  <div className="ms-card-meta">
                    <span className="ms-meta-item">
                      <ClockIcon />
                      <span>{formatEpoch(schedule.start_at)} - {formatEpoch(schedule.end_at)}</span>
                    </span>
                    {schedule.location ? (
                      <span className="ms-meta-item">
                        <LocationIcon />
                        <span>{schedule.location}</span>
                      </span>
                    ) : null}
                    {schedule.category ? (
                      <span className="ms-meta-item">
                        <TagIcon />
                        <span>{schedule.category}</span>
                      </span>
                    ) : null}
                    <span className="ms-meta-item ms-meta-id">
                      <IdIcon />
                      <span>{schedule.id}</span>
                    </span>
                  </div>
                </div>
              );
            }

            // Notify result
            const notify = result.item;
            const cardStatus = getNotifyCardStatus(notify);
            return (
              <div
                className="ms-preview-card"
                key={key}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenu({ key, x: e.clientX, y: e.clientY });
                }}
                onClick={() => setEditingNotifyId(notify.id)}
              >
                <div className="ms-card-top">
                  <span className="ms-type-badge ms-type-badge--notify">{t("tab.notify")}</span>
                  <span className={`ms-card-status ms-status-${cardStatus.className}`}>{cardStatus.label}</span>
                </div>

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
                  <div
                    className="ms-card-title"
                    onDoubleClick={() => beginRename(result)}
                  >
                    {notify.title}
                  </div>
                )}

                {notify.description ? (
                  <div className="ms-card-desc">{notify.description}</div>
                ) : null}

                <div className="ms-card-meta">
                  <span className="ms-meta-item">
                    <NotifyIcon />
                    <span>{t("common.trigger")} {formatEpoch(notify.trigger_at)}</span>
                  </span>
                  <span className="ms-meta-item ms-meta-id">
                    <IdIcon />
                    <span>{notify.id}</span>
                  </span>
                </div>
              </div>
            );
          })}

          {/* Empty states */}
          {results.length === 0 && (
            status === t("search.notSearched") ? (
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

        {/* Floating filter button */}
        <button
          type="button"
          className="ms-floating-filter"
          onClick={() => setSheetOpen(true)}
          aria-label={t("search.match")}
        >
          <FilterIcon />
          {anyFilterActive && <span className="ms-filter-active-dot" />}
        </button>
      </div>

      {/* Filter bottom sheet */}
      {sheetOpen && (
        <>
          <div className="ms-sheet-overlay" onClick={() => setSheetOpen(false)} />
          <div className="ms-bottom-sheet">
            <div className="ms-sheet-handle" />
            <div className="ms-sheet-header">
              <h3>{t("search.match")}</h3>
              <button type="button" className="ms-sheet-reset" onClick={resetAllFilters}>
                <ResetIcon /> {t("common.reset")}
              </button>
            </div>
            <div className="ms-sheet-body">
              {/* Match group */}
              <div className="ms-filter-group">
                <div className="ms-filter-group-title">{t("search.match")}</div>
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
                  <div className="ms-filter-group-title">{t("search.time")}</div>
                  <div className="ms-filter-chips">
                    {mode === "todo" ? (
                      getTodoTimeOptions(t).map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          className={`ms-filter-chip${todoTimeField === opt.value ? " selected" : ""}`}
                          onClick={() => setTodoTimeField(opt.value as TodoTimeField)}
                        >
                          {opt.label}
                        </button>
                      ))
                    ) : mode === "schedule" ? (
                      getScheduleTimeOptions(t).map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          className={`ms-filter-chip${scheduleTimeField === opt.value ? " selected" : ""}`}
                          onClick={() => setScheduleTimeField(opt.value as ScheduleTimeField)}
                        >
                          {opt.label}
                        </button>
                      ))
                    ) : (
                      getNotifyTimeOptions(t).map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          className={`ms-filter-chip${notifyTimeField === opt.value ? " selected" : ""}`}
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
                    />
                  </div>
                </div>
              )}

              {/* Mode-specific filters */}
              {!idSearch && mode === "todo" && (
                <div className="ms-filter-group">
                  <div className="ms-filter-group-title">{t("tab.todo")}</div>
                  <div className="ms-filter-chips">
                    {[
                      { value: "all", label: t("search.allStatus") },
                      { value: "open", label: t("search.uncompleted") },
                      { value: "completed", label: t("search.completed") }
                    ].map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        className={`ms-filter-chip${todoStatus === opt.value ? " selected" : ""}`}
                        onClick={() => setTodoStatus(opt.value)}
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
                  <div className="ms-filter-group-title">{t("tab.schedule")}</div>
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
                  <div className="ms-filter-group-title">{t("tab.notify")}</div>
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
        </>
      )}

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
