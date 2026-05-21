# Mobile Todo Page — Glass Surface (Concept E) Design

**Date:** 2026-05-21
**Scope:** Mobile-only UI changes to the todo page layout
**Approach:** Modify TodoView + CSS overrides (Approach A)

## Overview

Transform the mobile todo page from the current light list-based layout to concept E's "Glass Surface" design: dark gradient hero with stat cards, frosted glass panel containing white card-based todo items, gradient FAB, and dark frosted bottom nav.

## Constraints

- **Mobile-only**: No changes to desktop UI. Desktop `DateBar`, bottom bar, and row styles remain untouched.
- **Shared components**: `TodoView.tsx` is shared between desktop and mobile. Changes use CSS classes or conditional rendering — no breaking changes to desktop.
- `DateBar` is hidden on mobile via CSS (not removed — `ScheduleView` still uses it).
- Bottom tab bar styling changes apply to `mobile.css` only.

## Design Sections

### 1. Hero Section

**New component:** `MobileTodoHero`

**Props:**
- `remaining: number` — active todo count
- `done: number` — completed todo count
- `overdue: number` — overdue todo count
- `dateLine: string` — formatted date (e.g., "Thursday, May 21")

**Visual spec:**
- Background: dark gradient `linear-gradient(160deg, #1a2820 0%, #1a3a32 40%, #1a2820 100%)`
- Padding: `12px 20px 16px`
- Date line: 12px, `rgba(255,255,255,0.4)`, letter-spacing 0.5px
- Title: "Today's Tasks", 24px bold white, letter-spacing -0.5px, margin-bottom 12px
- Stat row: 3 cards in flex row, gap 10px
  - Each card: `background: rgba(255,255,255,0.06)`, `backdrop-filter: blur(20px)`, `border: 1px solid rgba(255,255,255,0.08)`, `border-radius: 14px`, `padding: 12px`, text-align center
  - Number: 24px bold, line-height 1, margin-bottom 2px
  - Label: 10px, font-weight 600, letter-spacing 0.8px, uppercase, `rgba(255,255,255,0.4)`
  - Remaining card number: `#4ade80` (green)
  - Done card number: white
  - Overdue card number: `#f87171` (red)

**Data source:** Computed inside `TodoView.tsx` from existing `todos` state:
```
remaining = todos.filter(t => !t.completed).length
done = todos.filter(t => t.completed).length
overdue = todos.filter(t => isOverdueTodo(t)).length
```

**Rendering:** Conditional — only rendered when a mobile CSS class or media query is active. Uses a `.mobile-hero` wrapper that is `display: none` on desktop.

### 2. Glass Panel

**Implementation:** CSS wrapper around `.todo-list` on mobile.

**Visual spec:**
- `background: rgba(250, 247, 242, 0.95)`
- `backdrop-filter: blur(20px)`, `-webkit-backdrop-filter: blur(20px)`
- `border-radius: 20px 20px 0 0`
- `margin: 0 12px`
- `overflow: hidden`
- `display: flex; flex-direction: column`
- `flex: 1` (fills remaining vertical space)

**Panel header:**
- Padding: `16px 20px 8px`
- Left: "Task List" title, 15px bold, `var(--text-1)`
- Right: sort/filter button, 11px bold, primary color, primary-soft background, 8px border-radius

### 3. Todo Cards

**Replace current `.todo-row` styling on mobile** with card-based design.

**Visual spec per card:**
- `background: #fff`
- `border-radius: 14px`
- `padding: 14px`
- `display: flex; align-items: center; gap: 12px`
- `border: 1px solid rgba(229, 223, 215, 0.6)`
- `transition: transform 0.1s`
- Active state: `transform: scale(0.98)`
- Gap between cards: 6px (via `.todo-list` flex gap)

**Checkbox:**
- 28x28px circle, `border: 2.5px solid var(--primary)`
- Inner checkmark SVG: 14px, opacity 0 → 1 on completed

**Title:** 14px, font-weight 500, `var(--text-1)`

**Meta-line:** flex row, gap 6px
- Priority badge (High): `background: var(--danger-soft); color: var(--danger)`
- Priority badge (Med): `background: var(--amber-soft); color: #8a6d1b`
- Tag badge: `background: var(--primary-soft); color: var(--primary)`
- Time text: 11px, `var(--text-3)`

**States:**
- **Overdue**: `background: linear-gradient(135deg, #fff5f5, #fff)`, red border, red title, red checkbox
- **Completed**: `background: var(--completed-bg)`, green border, filled checkbox, strikethrough title

### 4. FAB (Floating Action Button)

**Replaces:** `.todo-bottom-bar` on mobile (hidden via CSS).

**Visual spec:**
- Position: `absolute`, `bottom: 72px`, `right: 28px`
- Size: 52x52px, `border-radius: 14px`
- Background: `linear-gradient(135deg, var(--primary), #14967e)`
- Color: white, font-size 26px
- Shadow: `0 6px 24px rgba(26, 127, 114, 0.4)`
- Z-index: 50
- Action: `addTodo()` (same as current Add button)

### 5. Bottom Tab Bar (Dark Frosted)

**File:** `mobile.css`

**Visual spec:**
- Background: `rgba(26, 40, 32, 0.98)` with `backdrop-filter: blur(20px)`
- Border-top: `1px solid rgba(255, 255, 255, 0.06)`
- Default icon/label: `rgba(255, 255, 255, 0.35)`
- Active icon/label: `#4ade80` (green)

### 6. DateBar Handling

- On mobile, the `DateBar` component inside `TodoView` is hidden via CSS: `.mobile-shell .datebar { display: none }`
- The hero section replaces date navigation functionality
- Date navigation on mobile: tap the date line in hero to open `CalendarPopup`, or use the existing swipe/scroll behavior
- `DateBar` remains fully functional for desktop and for `ScheduleView`

## Files to Modify

| File | Changes |
|------|---------|
| `frontend/src/mobile/styles/mobile.css` | Glass panel, card overrides, FAB, dark nav, hide DateBar |
| `frontend/src/views/TodoView.tsx` | Add `MobileTodoHero` rendering, conditional FAB |
| `frontend/src/views/MobileTodoHero.tsx` | NEW — hero section component |
| `frontend/src/styles/todo.css` | Minor: add `.mobile-fab` class |

## Files NOT Modified

- `frontend/src/mobile/App.tsx` — no changes needed (tab bar styled via CSS)
- `frontend/src/views/DateBar.tsx` — untouched
- `frontend/src/views/ScheduleView.tsx` — untouched
- Desktop build — no impact

## Testing

- Verify desktop layout unchanged (Electron dev mode)
- Verify mobile layout on Capacitor Android build or Chrome DevTools mobile emulation (375px width)
- Test all todo states: active, overdue, completed, late-done
- Test FAB creates new todo
- Test todo card tap opens detail modal
- Test todo card checkbox toggles completion
- Verify DateBar hidden on mobile, visible on desktop
- Verify ScheduleView DateBar unaffected
