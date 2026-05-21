# Mobile Todo Glass Surface (Concept E) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the mobile todo page to concept E's "Glass Surface" design with dark gradient hero, frosted glass panel, card-based todos, gradient FAB, and dark bottom nav.

**Architecture:** Add a `MobileTodoHero` component for the stat cards, use CSS overrides in `mobile.css` for glass panel/card/FAB/nav styling, and conditionally render hero + FAB inside `TodoView.tsx` when on mobile. No changes to desktop layout.

**Tech Stack:** React 19, TypeScript, CSS custom properties (theme tokens), Capacitor (Android)

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `frontend/src/mobile/styles/mobile.css` | Modify | Glass panel, card overrides, FAB, dark nav, hide DateBar |
| `frontend/src/views/MobileTodoHero.tsx` | Create | Hero section with date + 3 stat cards |
| `frontend/src/views/TodoView.tsx` | Modify | Import hero, add FAB, wire up counts |
| `frontend/src/styles/todo.css` | Modify | Add `.mobile-fab` class |

---

### Task 1: Dark Frosted Bottom Tab Bar

**Files:**
- Modify: `frontend/src/mobile/styles/mobile.css`

- [ ] **Step 1: Update `.mobile-tab-bar` styles**

Replace the existing `.mobile-tab-bar` block in `mobile.css` with concept E's dark frosted style:

```css
/* ── Bottom Tab Bar (Concept E: Dark Frosted) ── */

.mobile-tab-bar {
  display: flex;
  height: calc(56px + env(safe-area-inset-bottom));
  padding-bottom: env(safe-area-inset-bottom);
  background: rgba(26, 40, 32, 0.98);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  flex-shrink: 0;
}

.mobile-tab-bar button {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  border: 0;
  background: transparent;
  color: rgba(255, 255, 255, 0.35);
  font-size: 11px;
  font-weight: 600;
  -webkit-tap-highlight-color: transparent;
  transition: color 0.15s;
}

.mobile-tab-bar button.active {
  color: #4ade80;
}

.mobile-tab-bar button:active {
  opacity: 0.7;
}

.mobile-tab-bar img {
  width: 22px;
  height: 22px;
  opacity: 0.35;
  transition: opacity 0.15s;
  filter: none;
}

.mobile-tab-bar button.active img {
  opacity: 1;
  filter: none;
}
```

- [ ] **Step 2: Verify in browser**

Open Chrome DevTools mobile emulation (375px), navigate to the app. The bottom tab bar should now have a dark green background with muted white icons/labels, and green active state on the selected tab.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/mobile/styles/mobile.css
git commit -m "feat(mobile): dark frosted bottom tab bar for concept E"
```

---

### Task 2: Create MobileTodoHero Component

**Files:**
- Create: `frontend/src/views/MobileTodoHero.tsx`

- [ ] **Step 1: Create the component file**

```tsx
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
    const remaining = todos.filter((t) => !t.completed).length;
    const done = todos.filter((t) => t.completed).length;
    const overdue = todos.filter((t) => isOverdueTodo(t)).length;
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
```

- [ ] **Step 2: Verify it compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors (component is not imported yet, so no impact)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/views/MobileTodoHero.tsx
git commit -m "feat(mobile): add MobileTodoHero component with stat cards"
```

---

### Task 3: Hero Section + Glass Panel + FAB in TodoView

**Files:**
- Modify: `frontend/src/views/TodoView.tsx`
- Modify: `frontend/src/mobile/styles/mobile.css`
- Modify: `frontend/src/styles/todo.css`

- [ ] **Step 1: Add hero CSS to mobile.css**

Append these styles to `mobile.css`:

```css
/* ── Mobile Todo Hero (Concept E) ── */

.mobile-shell .datebar {
  display: none;
}

.mobile-hero {
  background: linear-gradient(160deg, #1a2820 0%, #1a3a32 40%, #1a2820 100%);
  padding: 12px 20px 16px;
  flex-shrink: 0;
}

.mobile-hero-date {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.4);
  letter-spacing: 0.5px;
  margin-bottom: 4px;
}

.mobile-hero-title {
  font-size: 24px;
  font-weight: 700;
  color: #fff;
  letter-spacing: -0.5px;
  margin: 0 0 12px;
}

.mobile-hero-stats {
  display: flex;
  gap: 10px;
}

.mobile-stat-card {
  flex: 1;
  background: rgba(255, 255, 255, 0.06);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  padding: 12px;
  text-align: center;
}

.mobile-stat-num {
  font-size: 24px;
  font-weight: 700;
  color: #fff;
  line-height: 1;
  margin-bottom: 2px;
}

.mobile-stat-label {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.8px;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.4);
}

.mobile-stat-highlight .mobile-stat-num {
  color: #4ade80;
}

.mobile-stat-danger .mobile-stat-num {
  color: #f87171;
}

/* ── Glass Panel ── */

.mobile-shell .todo-view {
  background: linear-gradient(160deg, #1a2820 0%, #1a3a32 40%, #1a2820 100%);
}

.mobile-glass-panel {
  flex: 1;
  margin: 0 12px;
  background: rgba(250, 247, 242, 0.95);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-radius: 20px 20px 0 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.mobile-panel-header {
  padding: 16px 20px 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}

.mobile-panel-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--global-text-primary, #342f2a);
}

.mobile-panel-sort-btn {
  font-size: 11px;
  font-weight: 600;
  color: var(--status-primary-base, #1a7f72);
  background: var(--status-primary-badge-bg, #e8f3f1);
  border: none;
  padding: 5px 10px;
  border-radius: 8px;
  cursor: pointer;
}

/* ── Todo Cards (mobile override) ── */

.mobile-shell .todo-list {
  padding: 4px 16px 80px;
  gap: 6px;
}

.mobile-shell .todo-row {
  border-radius: 14px;
  border: 1px solid rgba(229, 223, 215, 0.6);
  background: #fff;
  padding: 14px;
  gap: 12px;
  margin-bottom: 0;
  min-height: auto;
}

.mobile-shell .todo-row::before {
  display: none;
}

.mobile-shell .todo-row:first-of-type {
  border-top-left-radius: 14px;
  border-top-right-radius: 14px;
}

.mobile-shell .todo-row:last-of-type {
  border-bottom: 1px solid rgba(229, 223, 215, 0.6);
  border-bottom-left-radius: 14px;
  border-bottom-right-radius: 14px;
}

.mobile-shell .todo-row:active {
  transform: scale(0.98);
}

.mobile-shell .check-button {
  width: 28px;
  height: 28px;
  border-width: 2.5px;
}

.mobile-shell .todo-title {
  font-size: 14px;
  font-weight: 500;
}

.mobile-shell .todo-row.overdue {
  background: linear-gradient(135deg, #fff5f5, #fff);
  border-color: rgba(198, 47, 47, 0.15);
}

.mobile-shell .todo-row.completed {
  background: var(--status-completed-bg, #f2f4ef);
  border-color: var(--status-completed-border, #dce4d8);
}

.mobile-shell .todo-row.late-done {
  background: linear-gradient(135deg, #fef0d0, #fff);
  border-color: rgba(212, 134, 10, 0.15);
}

/* ── FAB ── */

.mobile-fab {
  position: absolute;
  bottom: 72px;
  right: 28px;
  width: 52px;
  height: 52px;
  border-radius: 14px;
  background: linear-gradient(135deg, var(--status-primary-base, #1a7f72), #14967e);
  color: #fff;
  border: none;
  font-size: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 6px 24px rgba(26, 127, 114, 0.4);
  z-index: 50;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.mobile-fab:active {
  transform: scale(0.9);
}

/* ── Hide bottom bar on mobile (replaced by FAB) ── */

.mobile-shell .todo-bottom-bar {
  display: none;
}

/* ── Skeleton / empty state adjustments ── */

.mobile-shell .skel-row {
  border-radius: 14px;
  border: 1px solid rgba(229, 223, 215, 0.6);
  margin-bottom: 6px;
}

.mobile-shell .skel-row:first-child {
  border-top-left-radius: 14px;
  border-top-right-radius: 14px;
}

.mobile-shell .skel-row:last-child {
  border-bottom: 1px solid rgba(229, 223, 215, 0.6);
  border-bottom-left-radius: 14px;
  border-bottom-right-radius: 14px;
}
```

- [ ] **Step 2: Add `.mobile-fab` CSS class to todo.css**

Add at the end of `todo.css`:

```css
/* ── Mobile FAB (positioned inside .todo-view on mobile) ── */
```

(FAB styles are in mobile.css via `.mobile-fab` class — no changes needed in todo.css. This step is a no-op.)

- [ ] **Step 3: Import MobileTodoHero in TodoView.tsx**

At the top of `frontend/src/views/TodoView.tsx`, add the import after the existing imports:

```tsx
import { MobileTodoHero } from "./MobileTodoHero";
```

- [ ] **Step 4: Add dateLine computation inside TodoView**

After the `weekLabel` useMemo block (around line 150), add:

```tsx
const dateLine = useMemo(() => {
  const [year, month, day] = selectedDayKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const weekday = date.toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US", { weekday: "long" });
  const monthName = date.toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US", { month: "long" });
  return `${weekday}, ${monthName} ${day}`;
}, [selectedDayKey, locale]);
```

- [ ] **Step 5: Add hero section and glass panel wrapper to JSX**

In the return block of `TodoView`, wrap the content. The current structure is:

```tsx
<div className="todo-view">
  <DateBar ... />
  {showCalendar && ...}
  <div className="todo-list">
    ...
  </div>
  <div className="todo-bottom-bar">
    ...
  </div>
  ...
</div>
```

Replace with:

```tsx
<div className="todo-view">
  <MobileTodoHero todos={todos} dateLine={dateLine} />
  <DateBar ... />
  {showCalendar && ...}
  <div className="mobile-glass-panel">
    <div className="mobile-panel-header">
      <span className="mobile-panel-title">{t("todo.taskList")}</span>
      <button
        type="button"
        className="mobile-panel-sort-btn"
        onClick={() => setHideCompleted((v) => !v)}
      >
        {hideCompleted ? t("todo.showCompleted") : t("todo.hideCompleted")}
      </button>
    </div>
    <div className="todo-list">
      {/* ... existing todo list content unchanged ... */}
    </div>
  </div>
  <div className="todo-bottom-bar">
    {/* ... existing bottom bar (hidden on mobile via CSS) ... */}
  </div>
  <button
    type="button"
    className="mobile-fab"
    onClick={() => void addTodo()}
    title={t("todo.addTodo")}
  >
    +
  </button>
  {/* ... rest of modals unchanged ... */}
</div>
```

Key changes:
1. `<MobileTodoHero>` added at top (CSS hides DateBar on mobile, hero shows on mobile only via CSS)
2. `<div className="mobile-glass-panel">` wraps the panel header + todo-list
3. Panel header has sort/hide-completed button
4. `<button className="mobile-fab">` added outside the glass panel
5. Bottom bar stays in DOM (hidden via CSS on mobile)

- [ ] **Step 6: Add i18n keys**

Check if these keys exist in the i18n files. If not, add them:

- `todo.todayTasks` — "Today's Tasks" / "今日任务"
- `todo.taskList` — "Task List" / "任务列表"
- `common.remaining` — "Remaining" / "待办"
- `common.done` — "Done" / "已完成"

Search for the i18n files:

```bash
find frontend/src/i18n -name "*.json" -o -name "*.ts"
```

Add missing keys to each locale file.

- [ ] **Step 7: Verify mobile layout**

Run: `cd frontend && npm run dev`
Open Chrome DevTools → mobile emulation (375px × 812px, iPhone X).
Verify:
- Dark gradient hero with stat cards visible
- Glass panel with rounded top corners
- Todo items as white cards with gaps
- FAB visible at bottom-right
- Bottom bar hidden
- DateBar hidden

- [ ] **Step 8: Verify desktop layout unchanged**

Resize browser to desktop width (> 1024px).
Verify:
- DateBar visible and functional
- Todo rows are connected list (not cards)
- Bottom action bar visible (not FAB)
- No hero section visible
- Normal light theme

- [ ] **Step 9: Commit**

```bash
git add frontend/src/views/TodoView.tsx frontend/src/views/MobileTodoHero.tsx frontend/src/mobile/styles/mobile.css
git commit -m "feat(mobile): glass surface todo layout with hero, cards, and FAB"
```

---

### Task 4: i18n Keys

**Files:**
- Modify: `frontend/src/i18n/*.ts` (locale files)

- [ ] **Step 1: Find and update locale files**

```bash
grep -r "todayTasks\|taskList\|remaining" frontend/src/i18n/
```

Add missing keys to each locale. Example for English (`en.ts` or equivalent):

```ts
"todo.todayTasks": "Today's Tasks",
"todo.taskList": "Task List",
"common.remaining": "Remaining",
```

Example for Chinese (`zh.ts` or equivalent):

```ts
"todo.todayTasks": "今日任务",
"todo.taskList": "任务列表",
"common.remaining": "待办",
```

- [ ] **Step 2: Verify no missing translations**

Run the app and check the hero section and panel header render correct text.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/i18n/
git commit -m "feat(i18n): add keys for mobile todo hero and glass panel"
```

---

### Task 5: Final Polish & Testing

- [ ] **Step 1: Test all todo states on mobile**

In Chrome DevTools mobile emulation:
1. Create a new todo via FAB → verify it appears as a card
2. Toggle a todo to completed → verify green checkbox + strikethrough
3. If an overdue todo exists → verify red tint + red title
4. If a late-done todo exists → verify amber tint
5. Tap the hide-completed button in panel header → verify completed items hide/show
6. Verify skeleton loading appears correctly during date change

- [ ] **Step 2: Test on Android (if available)**

```bash
cd frontend && npm run cap:sync
```

Build and run on Android device/emulator. Verify:
- Safe area insets work correctly
- Touch interactions feel smooth (scale on tap)
- Status bar color matches dark gradient
- FAB is thumb-accessible

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat(mobile): complete glass surface (concept E) todo layout"
```
