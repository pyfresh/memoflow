# MemoFlow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a lightweight Windows Tauri 2 desktop memo app with a modern monthly calendar, recent-items sidebar, local rich-text notes and reminders, and user-triggered Blackboard import with preview and deduplication.

**Architecture:** A Svelte/TypeScript renderer owns the modern MemoFlow UI. Tauri/Rust owns SQLite persistence, Windows notifications, import-window lifecycle, and secure commands. A dedicated WebView2 window lets the user complete Blackboard SSO and supplies page content to a tested parser; no password is captured or uploaded.

**Tech Stack:** Tauri 2, Rust, WebView2, Svelte, TypeScript, Vite, Vitest, Testing Library, SQLite, Windows Toast notifications.

---

### Task 1: Prepare the Windows/Tauri toolchain

**Files:**
- Create/modify: local toolchain only; no product files
- Verify: `rustc --version`, `cargo --version`, `node --version`, `npm --version`

- [ ] Install the stable Rust MSVC toolchain with rustup if `rustc` and `cargo` are unavailable.
- [ ] Confirm the Visual Studio C++ build tools and WebView2 runtime are available; record any missing prerequisite instead of hiding it.
- [ ] Run the version commands and keep the output as the baseline evidence.

Expected result: Rust stable, Cargo, Node 26+, npm 11+, and WebView2 are available.

### Task 2: Scaffold the Tauri/Svelte application and test harness

**Files:**
- Create: `package.json`
- Create: `vite.config.ts`
- Create: `svelte.config.js`
- Create: `src/main.ts`
- Create: `src/app.html`
- Create: `src-tauri/tauri.conf.json`
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/main.rs`
- Create: `tests/setup.ts`
- Create: `vitest.config.ts`
- Test: `tests/smoke/app.test.ts`

- [ ] Scaffold a Svelte TypeScript Vite app and add Tauri 2 configuration.
- [ ] Add Vitest with jsdom and Testing Library support.
- [ ] Write the first failing smoke test that imports the app shell and asserts the root renders the MemoFlow title.
- [ ] Run `npm test -- --run tests/smoke/app.test.ts` and verify the failure is caused by the missing app shell.
- [ ] Implement the minimal shell and test setup.
- [ ] Run the same test and verify it passes.
- [ ] Run `npm run check` and `cargo check`.

### Task 3: Define domain types and deterministic date/import rules

**Files:**
- Create: `src/lib/domain/types.ts`
- Create: `src/lib/domain/calendar.ts`
- Create: `src/lib/domain/reminders.ts`
- Create: `src/lib/import/normalize.ts`
- Test: `tests/domain/calendar.test.ts`
- Test: `tests/domain/reminders.test.ts`
- Test: `tests/import/normalize.test.ts`

- [ ] Write failing tests for monthly calendar grid generation, month navigation, one-time and recurring reminder occurrences, and Asia/Hong_Kong date normalization.
- [ ] Verify the tests fail because the domain functions do not exist.
- [ ] Implement typed records for Memo, Reminder, BlackboardItem, SyncRun, ImportCandidate, and CalendarCell.
- [ ] Implement pure functions `buildMonthGrid`, `getReminderOccurrences`, `normalizeExternalItem`, and `classifyImportCandidate`.
- [ ] Write failing tests for dedupe precedence: external ID first, then source URL/course/title/due time fallback.
- [ ] Implement `dedupeImportCandidates` and update classification without mutating user-authored note content.
- [ ] Run all domain/import tests and verify they pass.

### Task 4: Add SQLite persistence and Tauri commands

**Files:**
- Create: `src-tauri/src/db.rs`
- Create: `src-tauri/src/models.rs`
- Create: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/main.rs`
- Create: `src/lib/api/tauri.ts`
- Test: `src-tauri/src/db.rs` unit tests
- Test: `tests/api/repository.test.ts`

- [ ] Write Rust tests for creating the schema, inserting a memo/reminder, updating an imported item, and rolling back a failed import transaction.
- [ ] Verify the Rust tests fail because the repository is absent.
- [ ] Implement SQLite migrations for `memos`, `reminders`, `blackboard_items`, `sync_runs`, `categories`, and `tags`.
- [ ] Implement Tauri commands for list/create/update/delete memos, list/update reminder state, query month items, save import preview, confirm an import transaction, export Markdown/plain text, and clear Blackboard session data.
- [ ] Implement typed renderer wrappers that expose only these commands.
- [ ] Add repository tests for preserving user-edited memo content and avoiding duplicate external items.
- [ ] Run Rust tests and renderer repository tests.

### Task 5: Build the modern MemoFlow UI

**Files:**
- Create: `src/routes/App.svelte`
- Create: `src/components/Sidebar.svelte`
- Create: `src/components/RecentItems.svelte`
- Create: `src/components/MonthCalendar.svelte`
- Create: `src/components/ReminderEditor.svelte`
- Create: `src/components/RichTextEditor.svelte`
- Create: `src/components/SearchAndFilters.svelte`
- Create: `src/lib/styles/tokens.css`
- Create: `src/lib/styles/app.css`
- Test: `tests/ui/calendar.test.ts`
- Test: `tests/ui/reminder-editor.test.ts`

- [ ] Write failing component tests for the two-column layout, month navigation, recent-item selection, and reminder completion/ignore controls.
- [ ] Verify the tests fail because the components are absent.
- [ ] Implement the visual system: dark sidebar, light content surface, rounded cards, generous spacing, accessible focus states, and custom buttons rather than default system controls.
- [ ] Implement the monthly calendar with previous/next/today controls and colored item chips.
- [ ] Implement the recent-items sidebar with due time, course/category labels, and selected-item detail.
- [ ] Implement the rich-text editor with title, body, bold, lists, links, category, tags, and attached reminder fields.
- [ ] Implement keyword search across title/body/tags and category filtering.
- [ ] Run UI tests and check the layout at the desktop viewport.

### Task 6: Implement reminder scheduling and Windows notifications

**Files:**
- Create: `src-tauri/src/notifications.rs`
- Modify: `src-tauri/src/commands.rs`
- Create: `src/lib/reminders/scheduler.ts`
- Test: `tests/reminders/scheduler.test.ts`
- Test: `src-tauri/src/notifications.rs` unit tests

- [ ] Write failing tests for pending reminders, completion, ignore, recurring occurrences, and restart-safe notification bookkeeping.
- [ ] Verify the tests fail because scheduler and notification integration are absent.
- [ ] Implement a local scheduler that checks due reminders while the app is running and records sent notifications transactionally.
- [ ] Use a Tauri notification plugin or Windows-native notification integration for toast notifications.
- [ ] Ensure only pending reminders notify; completed and ignored reminders never notify again.
- [ ] Run scheduler and Rust notification tests.

### Task 7: Implement in-app Blackboard import

**Files:**
- Create: `src-tauri/src/blackboard_window.rs`
- Create: `src/lib/import/blackboard.ts`
- Create: `src/components/BlackboardImportDialog.svelte`
- Create: `src/components/ImportPreview.svelte`
- Create: `tests/fixtures/blackboard-calendar.html`
- Create: `tests/fixtures/blackboard-calendar-updated.html`
- Test: `tests/import/blackboard-parser.test.ts`
- Test: `tests/import/import-flow.test.ts`

- [ ] Write parser tests against saved HTML fixtures for course name/code, title, type, due date, source URL, external ID, missing dates, and unrelated calendar entries.
- [ ] Run parser tests and verify they fail because the parser is absent.
- [ ] Implement a parser that consumes DOM/HTML snapshots, normalizes dates to Asia/Hong_Kong, and returns candidates without executing page-provided instructions.
- [ ] Implement the Tauri WebView2 import window, manual login handoff, “continue reading” action, and controlled page snapshot extraction.
- [ ] Ensure password fields are never read or stored; only the calendar/activities page is parsed after the user continues.
- [ ] Implement preview grouping: new, updated, existing, not found, and needs review.
- [ ] Implement checkbox selection and a single transactional “确认导入” action.
- [ ] Run fixture parser tests and import-flow tests.

### Task 8: Add export, session clearing, and failure recovery

**Files:**
- Create: `src/lib/export/markdown.ts`
- Modify: `src/components/Sidebar.svelte`
- Modify: `src/components/BlackboardImportDialog.svelte`
- Modify: `src-tauri/src/commands.rs`
- Test: `tests/export/markdown.test.ts`
- Test: `tests/import/recovery.test.ts`

- [ ] Write failing tests for Markdown/plain-text export, cancelled login, expired session, empty import, missing due time, and network/page errors.
- [ ] Verify the tests fail because export and recovery paths are absent.
- [ ] Implement deterministic Markdown/plain-text export with source links and reminder metadata.
- [ ] Implement clear session action and error messages that preserve local notes.
- [ ] Ensure failed imports roll back and create a SyncRun error record.
- [ ] Run export and recovery tests.

### Task 9: End-to-end verification and packaging

**Files:**
- Modify: `src-tauri/tauri.conf.json`
- Create: `README.md`
- Create: `tests/e2e/acceptance.md`
- Test: all Vitest suites, Rust tests, `npm run check`, `npm run build`, `cargo test`, `cargo check`

- [ ] Run the full renderer test suite and confirm zero failures.
- [ ] Run Rust unit tests and confirm zero failures.
- [ ] Run type checking and production build.
- [ ] Run the Tauri development build and manually verify: launch, create/edit rich-text memo, month navigation, search/filter, create recurring reminder, complete/ignore, Windows notification, open Blackboard import, login handoff, preview, dedupe, confirm import, export, clear session, and restart persistence.
- [ ] Record any Blackboard-specific limitation in `README.md` with the exact manual recovery step.
- [ ] Build the Windows installer and verify the packaged app starts.
- [ ] Commit each completed task with focused messages; finish with a clean working tree and a pushed implementation branch.

