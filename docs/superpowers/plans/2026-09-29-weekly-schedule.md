# Weekly Schedule Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the redundant category navigation with a weekly course schedule populated from Blackboard course meeting data.

**Architecture:** Add a `CourseScheduleEntry` record to the shared snapshot and parse schedule rows separately from deadline rows. The Tauri capture bridge will emit both deadline items and schedule rows; the app will persist them through the existing repository and render a Monday-to-Sunday weekly grid in a new `schedule` view.

**Tech Stack:** Svelte 5, TypeScript, Vitest, Testing Library, Tauri 2/Rust, SQLite snapshot persistence.

---

### Task 1: Add the schedule domain contract

**Files:**
- Modify: `src/lib/domain/types.ts`
- Modify: `src/lib/domain/navigation.ts`
- Test: `tests/domain/schedule.test.ts`

- [x] **Step 1: Write failing tests** for weekday validation helpers and the `schedule` navigation view.
- [x] **Step 2: Run `npm run test:run -- tests/domain/schedule.test.ts` and confirm failure because the schedule type/helpers do not exist.
- [x] **Step 3: Add `CourseScheduleEntry` with `id`, course identity, `weekday`, `startTime`, `endTime`, `location`, `source`, `externalId`, `sourceUrl`, and timestamps. Extend `View` with `'schedule'` and add pure helpers for weekday labels and valid `HH:mm` values.
- [x] **Step 4: Run the focused test and confirm it passes.

### Task 2: Parse Blackboard course meeting rows

**Files:**
- Modify: `src/lib/import/normalize.ts`
- Modify: `src/lib/import/blackboard.ts`
- Create: `tests/fixtures/blackboard-schedule.html`
- Modify: `tests/import/blackboard-parser.test.ts`

- [x] **Step 1: Add a fixture containing a Blackboard schedule row with course name/code, weekday, start/end time, location, external ID, and source link; add a failing parser assertion.
- [x] **Step 2: Run `npm run test:run -- tests/import/blackboard-parser.test.ts` and confirm the schedule assertion fails.
- [x] **Step 3: Implement `normalizeScheduleEntry` and `parseBlackboardScheduleHtml`. Accept numeric weekdays and common Chinese/English day labels, normalize times to `HH:mm`, resolve relative links, and skip rows missing a weekday or start/end time.
- [x] **Step 4: Run the parser tests and confirm both deadline and schedule parsing pass.

### Task 3: Persist and import schedule entries

**Files:**
- Modify: `src/lib/data/repository.ts`
- Modify: `tests/store/repository.test.ts`
- Modify: `src-tauri/src/db.rs`
- Modify: `src-tauri/src/lib.rs`

- [x] **Step 1: Add failing repository tests for snapshot defaults, idempotent schedule upsert, and preserving an existing local schedule when the same Blackboard ID is imported.
- [x] **Step 2: Run the repository tests and confirm failure because snapshots do not contain schedule records and the repository has no schedule import method.
- [x] **Step 3: Add optional `courseSchedules` to `AppSnapshot`, validate it as an array, add `importBlackboardSchedules`, and include schedules in demo seed data. Update SQLite snapshot validation/defaults to accept `courseSchedules`.
- [x] **Step 4: Extend the Rust capture envelope with schedule rows and emit `{ items, schedules }` while retaining the nonce/source validation. Capture schedule DOM attributes separately from deadline rows.
- [x] **Step 5: Run TypeScript repository tests; run `cargo test` when Cargo is available and record the result otherwise.

### Task 4: Replace category navigation with the weekly schedule page

**Files:**
- Modify: `src/components/Sidebar.svelte`
- Create: `src/components/WeeklySchedule.svelte`
- Modify: `src/routes/App.svelte`
- Modify: `src/lib/styles/app.css`
- Modify: `tests/ui/dashboard.test.ts`
- Create: `tests/ui/weekly-schedule.test.ts`

- [x] **Step 1: Add failing UI tests asserting the sidebar has `周课表`, no longer has `分类`, and the weekly grid renders seven weekday columns with imported course entries.
- [x] **Step 2: Run the focused UI tests and confirm failure.
- [x] **Step 3: Replace the sidebar category section with a `周课表` navigation item. Remove the category filter controls and category filtering state from `App.svelte`.
- [x] **Step 4: Implement `WeeklySchedule.svelte` with previous/next week and current-week controls, seven Monday-first columns, course cards, location/time metadata, and an empty state explaining that Blackboard sync supplies the schedule.
- [x] **Step 5: Wire the new capture payload into `App.svelte`, persist imported schedules, refresh the snapshot, and render the schedule view.
- [x] **Step 6: Run focused UI tests and confirm they pass.

### Task 5: Regression verification and delivery

**Files:**
- Modify: `src/components/BlackboardImportDialog.svelte`
- Modify: `tests/ui/dashboard.test.ts`

- [x] **Step 1: Update the importer preview and completion copy to mention both deadline items and course schedule entries.
- [x] **Step 2: Run `npm run check`, `npm run test:run`, `npm run build`, and `git diff --check`.
- [x] **Step 3: Review the diff, commit as `feat: add Blackboard weekly schedule`, and push `main`.
