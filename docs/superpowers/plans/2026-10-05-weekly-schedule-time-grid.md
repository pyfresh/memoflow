# 周课表时间格网 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 MemoFlow 周课表改为按真实开始和结束时间定位课程块的周一至周五时间格网，呈现与已确认的 A 方案一致。

**Architecture:** 保留现有 `CourseScheduleEntry`、周切换、学期范围过滤和 ZIP 导入逻辑。新增一个纯函数负责把 `HH:mm` 转换为格网的分钟偏移，组件用 CSS Grid 放置时间刻度和星期列，并在每个星期列中用绝对定位显示课程块；小屏幕保留横向滚动，确保时间比例不被压缩。

**Tech Stack:** Svelte 5, TypeScript, Vitest, CSS Grid, CSS custom properties.

---

### Task 1: Add time-position calculation tests

**Files:**
- Create: `src/lib/domain/schedule-grid.ts`
- Create: `tests/domain/schedule-grid.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { getScheduleGridPosition, parseScheduleMinutes } from '../../src/lib/domain/schedule-grid';

describe('schedule grid positioning', () => {
  it('converts valid clock strings to minutes from the grid start', () => {
    expect(parseScheduleMinutes('08:30')).toBe(510);
    expect(parseScheduleMinutes('14:00')).toBe(840);
    expect(parseScheduleMinutes('19:30')).toBe(1170);
  });

  it('returns top offset and height for a course block', () => {
    expect(getScheduleGridPosition('14:00', '16:50', '08:30', 40)).toEqual({ top: 220, height: 113.33333333333333 });
  });

  it('clamps a course that starts before or ends after the visible grid', () => {
    expect(getScheduleGridPosition('07:30', '23:00', '08:30', 40)).toEqual({ top: 0, height: 540 });
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm run test:run -- tests/domain/schedule-grid.test.ts`

Expected: FAIL because `src/lib/domain/schedule-grid.ts` does not exist.

- [ ] **Step 3: Implement the minimal calculation helpers**

```ts
export function parseScheduleMinutes(value: string): number | null {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

export function getScheduleGridPosition(startTime: string, endTime: string, gridStart: string, pixelsPerHour: number) {
  const start = parseScheduleMinutes(startTime) ?? parseScheduleMinutes(gridStart)!;
  const end = parseScheduleMinutes(endTime) ?? start;
  const visibleStart = parseScheduleMinutes(gridStart)!;
  const visibleEnd = visibleStart + 13.5 * 60;
  const clampedStart = Math.max(visibleStart, Math.min(start, visibleEnd));
  const clampedEnd = Math.max(clampedStart, Math.min(end, visibleEnd));
  return { top: ((clampedStart - visibleStart) / 60) * pixelsPerHour, height: ((clampedEnd - clampedStart) / 60) * pixelsPerHour };
}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `npm run test:run -- tests/domain/schedule-grid.test.ts`

Expected: 3 tests pass.

### Task 2: Replace the weekly schedule markup with the time grid

**Files:**
- Modify: `src/components/WeeklySchedule.svelte`
- Test: `tests/ui/weekly-schedule.test.ts`

- [ ] **Step 1: Add UI assertions for the time grid**

Assert that the rendered component exposes `时间`, weekday headers, the `14:00 - 16:50` course text, and a course block with a style containing the calculated top/height values. Keep the ZIP import button and date-range filtering assertions unchanged.

- [ ] **Step 2: Run the UI test and verify the new assertions fail**

Run: `npm run test:run -- tests/ui/weekly-schedule.test.ts`

Expected: FAIL because the current component renders seven independent day cards without a time axis.

- [ ] **Step 3: Implement the A layout**

Render Monday through Friday columns, a sticky header row, a left time-label column from `08:30` through `21:30`, and a fixed 13.5-hour track. For each entry, call `getScheduleGridPosition(entry.startTime, entry.endTime, '08:30', 40)` and set `top` and `height` in pixels. Show course code, course name, time, and location in the block; use a stable class derived from the course code for light color variation.

- [ ] **Step 4: Add responsive behavior**

Keep the grid at a readable minimum width and wrap it in horizontal overflow below 900px. On desktop, keep the existing page header and navigation controls. Preserve the empty state and ZIP import action.

- [ ] **Step 5: Run the UI test and verify it passes**

Run: `npm run test:run -- tests/ui/weekly-schedule.test.ts`

Expected: all weekly schedule tests pass.

### Task 3: Verify product behavior and desktop artifact

**Files:**
- Modify: `docs/superpowers/plans/2026-10-05-weekly-schedule-time-grid.md`

- [ ] **Step 1: Run the complete test suite**

Run: `npm run test:run`

Expected: all test files pass, including the schedule grid and ZIP import tests.

- [ ] **Step 2: Run type and template checks**

Run: `npm run check`

Expected: `svelte-check found 0 errors and 0 warnings`.

- [ ] **Step 3: Build the frontend**

Run: `npm run build`

Expected: Vite completes and writes the static build.

- [ ] **Step 4: Build a new EXE in an isolated target directory**

Run: `$env:CARGO_TARGET_DIR='D:\Projects\日历\src-tauri\src-tauri\target-schedule-time-grid'; npm run tauri build -- --no-bundle`

Expected: `src-tauri/src-tauri/target-schedule-time-grid/release/memoflow.exe` exists.

- [ ] **Step 5: Check the patch**

Run: `git diff --check`

Expected: exit code 0.
