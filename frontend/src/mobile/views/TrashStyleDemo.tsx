import type { ReactNode } from "react";

type Concept = "compact" | "search" | "agenda";

type TodoDemo = {
  title: string;
  status: "overdue" | "done";
  tag: string;
  attachments: number;
  dueAt: string;
  dueTone: "past" | "future";
  completedAt?: string;
  deletedAgo: string;
};

type ScheduleDemo = {
  title: string;
  date: string;
  time: string;
  timeRange: string;
  location: string;
  category: string;
  attachments: number;
  deletedAgo: string;
};

type NotifyDemo = {
  title: string;
  triggerAt: string;
  triggered: boolean;
  deletedAgo: string;
};

const concepts: Array<{ key: Concept; title: string; desc: string }> = [
  { key: "compact", title: "方案 A", desc: "贴近待办页：两行紧凑 row，适合清理大量条目。" },
  { key: "search", title: "方案 B", desc: "贴近搜索页：卡片分隔更清晰，信息 pill 自动换行。" },
  { key: "agenda", title: "方案 C", desc: "贴近日程页：左侧时间/状态锚点更明显，适合回看。" },
];

const todoItems: TodoDemo[] = [
  { title: "整理移动端回收站交互细节", status: "overdue", tag: "UI", attachments: 2, dueAt: "今天 18:00", dueTone: "past", deletedAgo: "18 分钟前删除" },
  { title: "复核附件缓存清理逻辑", status: "done", tag: "客户端", attachments: 1, dueAt: "昨天 20:00", dueTone: "past", completedAt: "昨天 19:42", deletedAgo: "2 小时前删除" },
];

const scheduleItems: ScheduleDemo[] = [
  { title: "产品评审同步会", date: "05-27", time: "10:00", timeRange: "10:00 - 11:30", location: "线上会议室", category: "产品", attachments: 3, deletedAgo: "42 分钟前删除" },
  { title: "移动端回归测试窗口", date: "05-28", time: "14:00", timeRange: "14:00 - 16:00", location: "研发区 A3", category: "测试", attachments: 0, deletedAgo: "1 天前删除" },
];

const notifyItems: NotifyDemo[] = [
  { title: "提醒：提交版本说明", triggerAt: "05-27 09:30", triggered: false, deletedAgo: "9 分钟前删除" },
  { title: "提醒：备份附件缓存目录", triggerAt: "05-25 21:00", triggered: true, deletedAgo: "3 天前删除" },
];

function RestoreIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12a7 7 0 1 0 2.05-4.95L5 9" />
      <path d="M5 5v4h4" />
    </svg>
  );
}

function BellIcon({ done }: { done?: boolean }) {
  if (done) {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M20 6 9 17l-5-5" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M10 21h4" />
    </svg>
  );
}

function ActionButton() {
  return (
    <span className="tsd-restore" aria-hidden="true">
      <RestoreIcon />
    </span>
  );
}

function Pill({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "tag" | "attach" | "time" | "deleted" | "status" }) {
  return <span className={`tsd-pill ${tone}`}>{children}</span>;
}

function TodoRow({ item, concept }: { item: TodoDemo; concept: Concept }) {
  return (
    <article className={`tsd-row tsd-todo ${concept} ${item.status}`}>
      <span className={`tsd-check ${item.status}`} />
      <div className="tsd-main">
        <div className="tsd-line1">
          <h3>{item.title}</h3>
          <span className={`tsd-status ${item.status}`}>{item.status === "done" ? "已完成" : "逾期"}</span>
          <span className={`tsd-due ${item.dueTone}`}>{item.dueAt}</span>
        </div>
        <div className="tsd-line2">
          <Pill tone="attach">🔗 {item.attachments}</Pill>
          <Pill tone="tag">{item.tag}</Pill>
          {item.completedAt ? <Pill tone="status">完成 {item.completedAt}</Pill> : <Pill>未完成</Pill>}
          <Pill tone="deleted">{item.deletedAgo}</Pill>
        </div>
      </div>
      {concept !== "compact" ? <ActionButton /> : null}
    </article>
  );
}

function ScheduleRow({ item, concept }: { item: ScheduleDemo; concept: Concept }) {
  return (
    <article className={`tsd-row tsd-schedule ${concept}`}>
      <div className="tsd-timebox">
        <strong>{item.date}</strong>
        <span>{item.time}</span>
      </div>
      <div className="tsd-main">
        <div className="tsd-line1">
          <h3>{item.title}</h3>
          <span className="tsd-due future">{item.timeRange}</span>
        </div>
        <div className="tsd-line2">
          <Pill tone="time">{item.location}</Pill>
          <Pill tone="tag">{item.category}</Pill>
          <Pill tone="attach">🔗 {item.attachments}</Pill>
          <Pill tone="deleted">{item.deletedAgo}</Pill>
        </div>
      </div>
      {concept !== "compact" ? <ActionButton /> : null}
    </article>
  );
}

function NotifyRow({ item, concept }: { item: NotifyDemo; concept: Concept }) {
  return (
    <article className={`tsd-row tsd-notify ${concept} ${item.triggered ? "triggered" : "pending"}`}>
      <span className={`tsd-notify-icon ${item.triggered ? "done" : ""}`}>
        <BellIcon done={item.triggered} />
      </span>
      <div className="tsd-main">
        <div className="tsd-line1">
          <h3>{item.title}</h3>
          <span className={`tsd-status ${item.triggered ? "done" : "pending"}`}>{item.triggered ? "已触发" : "待触发"}</span>
        </div>
        <div className="tsd-line2">
          <Pill tone="time">触发 {item.triggerAt}</Pill>
          <Pill tone="deleted">{item.deletedAgo}</Pill>
        </div>
      </div>
      {concept !== "compact" ? <ActionButton /> : null}
    </article>
  );
}

function CategoryBlock({ concept, type }: { concept: Concept; type: "todo" | "schedule" | "notify" }) {
  const title = type === "todo" ? "待办" : type === "schedule" ? "日程" : "通知";
  const count = type === "todo" ? todoItems.length : type === "schedule" ? scheduleItems.length : notifyItems.length;

  return (
    <section className={`tsd-category ${type}`}>
      <div className="tsd-category-head">
        <h3>{title}</h3>
        <span>{count} 项</span>
      </div>
      <div className="tsd-list">
        {type === "todo" ? todoItems.map((item) => <TodoRow key={item.title} item={item} concept={concept} />) : null}
        {type === "schedule" ? scheduleItems.map((item) => <ScheduleRow key={item.title} item={item} concept={concept} />) : null}
        {type === "notify" ? notifyItems.map((item) => <NotifyRow key={item.title} item={item} concept={concept} />) : null}
      </div>
    </section>
  );
}

export function TrashStyleDemo() {
  return (
    <div className="trash-style-demo">
      <header className="tsd-header">
        <div>
          <p>Mobile Trash UI Demo</p>
          <h1>分类回收站 item 样式</h1>
        </div>
        <span>3 套</span>
      </header>
      <main className="tsd-scroll">
        {concepts.map((concept) => (
          <section className={`tsd-concept ${concept.key}`} key={concept.key}>
            <div className="tsd-concept-head">
              <h2>{concept.title}</h2>
              <p>{concept.desc}</p>
            </div>
            <CategoryBlock concept={concept.key} type="todo" />
            <CategoryBlock concept={concept.key} type="schedule" />
            <CategoryBlock concept={concept.key} type="notify" />
          </section>
        ))}
      </main>
    </div>
  );
}
