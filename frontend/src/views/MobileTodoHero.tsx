import { useMemo } from "react";
import type { TodoItem } from "../api/client";
import { isOverdueTodo } from "../lib/time";
import { useI18n } from "../i18n";

type Props = {
  todos: TodoItem[];
  dateLine: string;
};

export function MobileTodoHero({ todos, dateLine }: Props) {
  const { t } = useI18n();

  const stats = useMemo(() => {
    const remaining = todos.filter((item) => !item.completed).length;
    const done = todos.filter((item) => item.completed).length;
    const overdue = todos.filter((item) => isOverdueTodo(item)).length;
    return { remaining, done, overdue };
  }, [todos]);

  return (
    <div className="mobile-hero">
      <div className="mobile-hero-date">{dateLine}</div>
      <h2 className="mobile-hero-title">{t("todo.todayTasks")}</h2>
      <div className="mobile-hero-stats">
        <div className="mobile-stat-card mobile-stat-highlight">
          <div className="mobile-stat-num">{stats.remaining}</div>
          <div className="mobile-stat-label">{t("common.remaining")}</div>
        </div>
        <div className="mobile-stat-card">
          <div className="mobile-stat-num">{stats.done}</div>
          <div className="mobile-stat-label">{t("common.done")}</div>
        </div>
        <div className="mobile-stat-card mobile-stat-danger">
          <div className="mobile-stat-num">{stats.overdue}</div>
          <div className="mobile-stat-label">{t("common.overdue")}</div>
        </div>
      </div>
    </div>
  );
}
