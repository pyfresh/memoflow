# Blackboard iCalendar Import Implementation Plan

> Status: Superseded. The product now uses the authenticated Blackboard page import as its only sync path; this file is retained as historical planning context.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a private Blackboard iCalendar URL import path that imports all selected calendars into MemoFlow with preview, deduplication, recurrence handling, and explicit errors.

**Architecture:** Rust validates and downloads the HTTPS Blackboard feed with a bounded asynchronous request. A focused TypeScript parser unfolds and decodes iCalendar properties, converts VEVENT records into the existing import and schedule candidate types, and leaves the existing page scraper as a fallback. The import dialog presents the URL mode, parsing status, preview, and confirmation through the same repository flow used by page capture.

**Tech Stack:** Svelte 5, TypeScript, Vitest, Tauri 2, Rust, `reqwest` with Rustls, `serde_json`, existing repository snapshot persistence.

---

### Task 1: Extend import data types for recurrence and iCalendar metadata

**Files:**
- Modify: `src/lib/domain/types.ts`
- Modify: `src/lib/import/normalize.ts`
- Test: `tests/import/normalize.test.ts`

- [ ] **Step 1: Write the failing recurrence normalization test**

Add a test that passes `recurrenceRule: 'FREQ=WEEKLY'` to `normalizeExternalItem` and expects the normalized candidate to preserve it, while an unsupported rule is cleared.

- [ ] **Step 2: Run the focused test**

Run `npm run test:run -- tests/import/normalize.test.ts`. Expected: the new assertion fails because `ImportCandidate` and `normalizeExternalItem` do not expose recurrence rules.

- [ ] **Step 3: Add the minimal type and normalization fields**

Add `recurrenceRule?: string | null` to `BlackboardItem`, `ImportCandidate`, and `RawBlackboardItem`. Normalize only `FREQ=DAILY`, `FREQ=WEEKLY`, and `FREQ=MONTHLY`; return `null` for other frequencies. Keep all existing date and type normalization unchanged.

- [ ] **Step 4: Run the focused test**

Run `npm run test:run -- tests/import/normalize.test.ts`. Expected: all normalize tests pass.

- [ ] **Step 5: Commit the type boundary**

Run `git add src/lib/domain/types.ts src/lib/import/normalize.ts tests/import/normalize.test.ts` and commit with `feat: preserve Blackboard recurrence rules`.

### Task 2: Build the iCalendar parser with fixture coverage

**Files:**
- Create: `src/lib/import/ical.ts`
- Create: `tests/fixtures/blackboard-calendar.ics`
- Create: `tests/import/ical-parser.test.ts`

- [ ] **Step 1: Write fixture and failing parser tests**

Create a CRLF `.ics` fixture containing: one assignment with `UID`, `SUMMARY`, `DTEND;TZID=Asia/Hong_Kong`, folded and escaped `DESCRIPTION`, `URL`, and `CATEGORIES`; one weekly course event with `DTSTART`, `DTEND`, `RRULE`, `LOCATION`, and `X-BB-CALENDAR-NAME`; one Personal event; and one VEVENT missing `SUMMARY`. Test that parsing returns the three valid items, one weekly schedule candidate, one skipped record, decoded commas/newlines, `+08:00` timestamps, and stable UID based source URLs.

- [ ] **Step 2: Run the parser tests to verify the failure**

Run `npm run test:run -- tests/import/ical-parser.test.ts`. Expected: the module import or parser assertions fail because `parseIcalFeed` does not exist.

- [ ] **Step 3: Implement line unfolding and property decoding**

In `src/lib/import/ical.ts`, implement:

```ts
export interface IcalParseResult {
  items: ImportCandidate[];
  schedules: ScheduleCandidate[];
  skippedCount: number;
}

export function parseIcalFeed(input: string, feedUrl: string): IcalParseResult;
```

Normalize CRLF/LF, join continuation lines beginning with a space or tab, split each property at the first colon, preserve parameters such as `TZID`, and decode `\\n`, `\\,`, `\\;`, and `\\\\` escapes. Reject input without `BEGIN:VCALENDAR` and `VEVENT` records without both `UID` and `SUMMARY`.

- [ ] **Step 4: Implement VEVENT mapping**

Map `UID` to `externalId`, `SUMMARY` to title, `DUE` then `DTEND` then `DTSTART` to `dueAt`, `DESCRIPTION` to `localMemoContent`, `URL` to `sourceUrl`, and `CATEGORIES`/`X-BB-CALENDAR-NAME`/`X-WR-CALNAME` to course metadata. Convert UTC and `TZID=Asia/Hong_Kong` values to `YYYY-MM-DDTHH:mm:ss+08:00`; treat an unzoned Blackboard local time as Hong Kong time. Pass candidates through `normalizeExternalItem`.

- [ ] **Step 5: Implement recurring schedule extraction**

For events with `RRULE:FREQ=WEEKLY`, `DTSTART`, `DTEND`, a weekday, and a non-empty course name, create a `ScheduleCandidate` with weekday, start time, end time, location, UID, and feed URL. Keep the event itself in `items` so all calendar content remains visible. Skip schedule creation when times or course identity are incomplete.

- [ ] **Step 6: Run the parser tests**

Run `npm run test:run -- tests/import/ical-parser.test.ts`. Expected: all fixture assertions pass, including folded text, escaped values, timezone conversion, skipped count, and weekly schedule extraction.

- [ ] **Step 7: Commit the parser**

Run `git add src/lib/import/ical.ts tests/fixtures/blackboard-calendar.ics tests/import/ical-parser.test.ts` and commit with `feat: parse Blackboard iCalendar feeds`.

### Task 3: Add bounded Blackboard feed fetching in Tauri

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/capabilities/default.json`
- Test: `src-tauri/src/lib.rs` Rust unit tests

- [ ] **Step 1: Write failing URL validation tests**

Add Rust tests for `validate_ical_url`: accept the screenshot-shaped HTTPS `.ics` URL, reject HTTP, reject another host, reject a URL longer than 2048 bytes, and reject a path that is not an iCalendar feed.

- [ ] **Step 2: Run Rust tests to verify the failure**

Run `cargo test --manifest-path src-tauri/Cargo.toml`. Expected: the new tests fail because the validator and command do not exist.

- [ ] **Step 3: Add the HTTP dependencies and validator**

Add `reqwest = { version = "0.12", default-features = false, features = ["rustls-tls", "stream"] }` and `futures-util = "0.3"`. Implement `validate_ical_url` to require `https`, host `bb.cuhk.edu.cn`, and either a `.ics` path or `/calendarFeed/` path. Return Chinese error strings suitable for the UI.

- [ ] **Step 4: Implement `fetch_blackboard_ical`**

Add an async Tauri command that uses a 15-second timeout, a MemoFlow user agent, rejects non-success HTTP status, rejects a declared body larger than 2 MiB, reads at most 2 MiB plus one byte, requires UTF-8 text beginning with `BEGIN:VCALENDAR`, and returns the feed text. Do not log the URL or response body. Register the command in `invoke_handler`.

- [ ] **Step 5: Configure the capability**

Allow the Tauri main window to invoke the new command while keeping the remote URL restriction limited to Blackboard domains already present in `src-tauri/capabilities/default.json`.

- [ ] **Step 6: Run Rust tests and format checks**

Run `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`, then `cargo test --manifest-path src-tauri/Cargo.toml`. Expected: URL validation and existing database/callback tests pass.

- [ ] **Step 7: Commit the fetch command**

Run `git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs src-tauri/capabilities/default.json` and commit with `feat: fetch private Blackboard iCalendar feeds`.

### Task 4: Add the iCal import mode to the dialog

**Files:**
- Modify: `src/components/BlackboardImportDialog.svelte`
- Modify: `src/routes/App.svelte` only if the existing confirm payload needs a new field
- Test: `tests/ui/blackboard-import.test.ts`

- [ ] **Step 1: Write failing UI tests**

Mock `__TAURI_INTERNALS__`, `invoke`, and `listen`. Add tests that render the dialog, show the iCal mode button, reject an invalid URL without invoking the command, show “正在读取 iCal” while fetching, display parser counts on success, display an empty-feed status, and keep the confirm button disabled when no candidates exist.

- [ ] **Step 2: Run the UI tests to verify the failure**

Run `npm run test:run -- tests/ui/blackboard-import.test.ts`. Expected: the new controls and statuses are absent.

- [ ] **Step 3: Add source mode and URL input state**

Add `sourceMode: 'page' | 'ical'`, `icalUrl`, `icalState`, and `skippedCount` state. Keep the existing page capture state and listener behavior intact. Add a start-stage action labelled “通过 iCal 链接导入” and an input with a paste-friendly URL field.

- [ ] **Step 4: Connect fetch and parser**

Implement `readIcal()` to set the reading status, call `invoke<string>('fetch_blackboard_ical', { url: icalUrl.trim() })`, call `parseIcalFeed`, normalize candidates, select all valid items, and switch to the existing preview stage. Map errors to explicit messages for invalid URL, expired/private feed, invalid iCalendar, empty result, skipped records, and timeout. Do not persist `icalUrl`.

- [ ] **Step 5: Extend preview and confirmation labels**

Show the source mode, item count, schedule count, and skipped count in the preview. Reuse the existing checkbox selection and `BlackboardCapturePayload` confirmation so repository persistence and deduplication remain in one place. Add a back action that returns to the iCal input state.

- [ ] **Step 6: Run UI tests and type checking**

Run `npm run test:run -- tests/ui/blackboard-import.test.ts` and `npm run check`. Expected: all iCal mode state transitions pass and Svelte diagnostics remain clean.

- [ ] **Step 7: Commit the dialog**

Run `git add src/components/BlackboardImportDialog.svelte src/routes/App.svelte tests/ui/blackboard-import.test.ts` and commit with `feat: add Blackboard iCal import mode`.

### Task 5: Persist recurrence rules and verify end to end

**Files:**
- Modify: `src/lib/data/repository.ts`
- Modify: `tests/store/repository.test.ts`
- Modify: `src/components/BlackboardImportDialog.svelte` if recurrence labels need display

- [ ] **Step 1: Write the failing repository test**

Import a candidate with `recurrenceRule: 'FREQ=WEEKLY'`, assert the created reminder stores that rule and the next import updates both `dueAt` and `recurrenceRule` without creating a duplicate memo.

- [ ] **Step 2: Run the repository test to verify the failure**

Run `npm run test:run -- tests/store/repository.test.ts`. Expected: the reminder currently stores `recurrenceRule: null` and the assertion fails.

- [ ] **Step 3: Persist recurrence rules**

Set `recurrenceRule: candidate.recurrenceRule ?? null` when creating a reminder. When updating an existing mapped reminder, update its recurrence rule and reset notification state only when the remote recurrence or due time changed.

- [ ] **Step 4: Run the repository and full frontend tests**

Run `npm run test:run`. Expected: all existing tests plus the recurrence test pass.

- [ ] **Step 5: Build and verify the desktop application**

Run `npm run check`, `cargo test --manifest-path src-tauri/Cargo.toml`, `git diff --check`, and `npm run tauri -- build --no-bundle -- --target-dir target-repair-next`. Launch `src-tauri/target-repair-next/release/memoflow.exe`, verify the window responds, and copy the verified binary to `src-tauri/target-repair/release/memoflow-fixed.exe` if the old process still locks the original filename.

- [ ] **Step 6: Commit the final integration**

Run `git add src/lib/data/repository.ts tests/store/repository.test.ts` and commit with `feat: persist iCalendar recurrence rules`.

## Self-review checklist

- The approved design's all-calendar scope is covered by the URL flow and preview.
- The private token is validated and never logged or persisted by the feature.
- Parser tests cover escaped text, time zones, recurrence, missing fields, and schedules.
- Fetch tests cover host, scheme, path, size, status, and content validation.
- UI tests cover reading, success, empty, skipped, error, and confirmation states.
- Repository tests cover UID-based updates and recurrence persistence.
- No implementation step is left as a placeholder; each step has a file, command, and expected result.
