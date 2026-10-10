# 课表 ZIP 导入实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 MemoFlow 从本地课表 ZIP 导入按周重复课程，并将 Blackboard 入口准确标注为作业导入。

**Architecture:** 前端通过 `fflate` 在本地解压 ZIP，逐个调用课程 iCalendar 解析器生成带学期范围的 `ScheduleCandidate`。独立导入弹窗负责选择、预览和确认，仓储负责 UID 去重和持久化，周课表按有效日期过滤。

**Tech Stack:** Svelte 5, TypeScript, Vitest, fflate, Tauri 2, localStorage/SQLite persistence.

---

### Task 1: Extend course schedule data and parser contracts

**Files:**
- Modify: `src/lib/domain/types.ts`
- Modify: `src/lib/import/ical.ts`
- Modify: `src/lib/import/normalize.ts`
- Test: `tests/import/ical-parser.test.ts`

- [x] **Step 1: Write the failing tests**

Add assertions for the supplied ICS shape: a weekly event returns `startDate`, `endDate`, `recurrenceRule`, `courseCode`, `weekday`, `startTime`, `endTime`, and `location`; a non-course event remains excluded from schedules.

- [x] **Step 2: Run the parser test and verify it fails**

Run `npm run test:run -- tests/import/ical-parser.test.ts`.
Expected failure: `ScheduleCandidate` does not expose term metadata and the parsed schedule does not include it.

- [x] **Step 3: Implement the minimal parser changes**

Extend `ScheduleCandidate` and `CourseScheduleEntry` with optional `startDate`, `endDate`, and `recurrenceRule`. Parse `COUNT` from a weekly RRULE and calculate the final occurrence date from `DTSTART` and `COUNT`; keep existing date/time normalization and UID behavior.

- [x] **Step 4: Run the parser tests**

Run `npm run test:run -- tests/import/ical-parser.test.ts` and confirm all parser tests pass.

### Task 2: Add ZIP archive parsing

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/lib/import/schedule-zip.ts`
- Create: `tests/import/schedule-zip.test.ts`

- [x] **Step 1: Add a failing ZIP parser test**

Read `Class_Schedule_Data_226010343_2610.zip` as bytes in the test and assert that parsing returns six schedules, no reminders/items, and the expected CIE6007 Tuesday/Thursday entries. Add a second test with one malformed ICS and assert valid files remain usable while the filename appears in errors.

- [x] **Step 2: Run the new test and verify it fails**

Run `npm run test:run -- tests/import/schedule-zip.test.ts`.
Expected failure: the ZIP parser module and dependency are not present.

- [x] **Step 3: Add the lightweight dependency and parser**

Install `fflate@0.8.3`. Implement `parseCourseScheduleZip(bytes)` with `unzipSync`, case-insensitive `.ics` filtering, UTF-8 decoding, per-file `parseIcalFeed`, schedule-only output, stable UID deduplication, and file-level errors.

- [x] **Step 4: Run the ZIP parser tests**

Run `npm run test:run -- tests/import/schedule-zip.test.ts` and confirm the six-course fixture and malformed-file behavior pass.

### Task 3: Persist archive schedules generically

**Files:**
- Modify: `src/lib/data/repository.ts`
- Modify: `src/lib/domain/types.ts`
- Test: `tests/store/repository.test.ts`

- [x] **Step 1: Write the failing repository test**

Assert that `importCourseSchedules` inserts archive schedules with `source: 'archive'`, preserves term metadata, updates an existing UID, and counts a repeated import as existing.

- [x] **Step 2: Run the repository test and verify it fails**

Run `npm run test:run -- tests/store/repository.test.ts`.
Expected failure: `importCourseSchedules` is not defined and archive source is unsupported.

- [x] **Step 3: Implement generic schedule import**

Add `CourseScheduleSource = 'archive' | 'blackboard'`, add `importCourseSchedules(candidates, source)`, update the stable key and changed-field comparison to include term metadata, and keep `importBlackboardSchedules` as a compatibility wrapper.

- [x] **Step 4: Run the repository tests**

Run `npm run test:run -- tests/store/repository.test.ts` and confirm existing and new persistence tests pass.

### Task 4: Build the ZIP import dialog and weekly schedule entry point

**Files:**
- Create: `src/components/CourseScheduleImportDialog.svelte`
- Modify: `src/components/WeeklySchedule.svelte`
- Modify: `src/routes/App.svelte`
- Modify: `src/components/BlackboardImportDialog.svelte`
- Modify: `src/lib/styles/app.css`
- Test: `tests/ui/weekly-schedule.test.ts`
- Test: `tests/ui/blackboard-import.test.ts`

- [x] **Step 1: Write failing UI tests**

Assert that the weekly schedule page exposes `导入课表 ZIP`, selecting the fixture shows six courses and a confirm action, confirming writes schedules without creating reminders, and the Blackboard action is named `从 Blackboard 导入作业`.

- [x] **Step 2: Run UI tests and verify they fail**

Run `npm run test:run -- tests/ui/weekly-schedule.test.ts tests/ui/blackboard-import.test.ts`.
Expected failure: no ZIP button/dialog exists and the old Blackboard label remains.

- [x] **Step 3: Implement the dialog and wiring**

Use a hidden file input with `accept=".zip,application/zip"`, read the selected file as an `ArrayBuffer`, call `parseCourseScheduleZip`, show status/preview/error states, and call `repository.importCourseSchedules` on confirmation. Keep the modal dismissible by close button and backdrop. Update the sidebar action and importer title/copy to `从 Blackboard 导入作业`.

- [x] **Step 4: Run the UI tests**

Run `npm run test:run -- tests/ui/weekly-schedule.test.ts tests/ui/blackboard-import.test.ts` and confirm the new workflow passes.

### Task 5: Filter the weekly grid and verify the product

**Files:**
- Modify: `src/components/WeeklySchedule.svelte`
- Modify: `tests/ui/weekly-schedule.test.ts`

- [x] **Step 1: Add a failing range test**

Add one schedule whose `startDate` is after the displayed week and assert it is not rendered, while an in-range schedule remains visible.

- [x] **Step 2: Implement date-range filtering**

Filter each weekday column by `weekStart + weekday` against optional `startDate` and `endDate`; old records without range metadata remain visible.

- [x] **Step 3: Run the focused and complete checks**

Run `npm run test:run -- tests/import/schedule-zip.test.ts tests/import/ical-parser.test.ts tests/store/repository.test.ts tests/ui/weekly-schedule.test.ts tests/ui/blackboard-import.test.ts`, then `npm run test:run`, `npm run check`, `npm run build`, and `git diff --check`.

- [x] **Step 4: Build the desktop artifact**

Run `$env:CARGO_TARGET_DIR='D:\Projects\日历\src-tauri\src-tauri\target-current'; npm run tauri build -- --no-bundle` and verify `src-tauri/src-tauri/target-current/release/memoflow.exe` exists.
