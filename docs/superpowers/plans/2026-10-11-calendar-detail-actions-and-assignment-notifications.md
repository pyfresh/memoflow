# Calendar Detail Actions and Assignment Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add colored complete/delete actions to calendar item details and notify for imported Blackboard assignments one day before their deadline.

**Architecture:** Keep the existing `ReminderEditor` modal and repository APIs. Pass explicit memo and reminder IDs into the editor, dispatch complete/delete events to `App.svelte`, and reuse repository status/deletion methods. Add an optional persisted `notificationAt` to reminders; imported assignments set it to the deadline minus one local day, while the scheduler uses it when present and falls back to `dueAt` for all other reminders.

**Tech Stack:** Svelte, TypeScript, Vitest, existing local repository and reminder scheduler.

---

### Task 1: Add failing repository and scheduler tests for assignment notification time

**Files:**
- Modify: `tests/reminders/scheduler.test.ts`
- Modify: `tests/store/repository.test.ts`
- Test behavior: assignment notification window and ordinary reminder fallback.

- [ ] **Step 1: Write the failing scheduler test**

Add a test that creates one assignment reminder with `dueAt: '2026-10-08T23:59:00+08:00'` and `notificationAt: '2026-10-07T23:59:00+08:00'`, plus one ordinary reminder with only `dueAt`. Assert that at `2026-10-07T23:59:00+08:00` the scheduler returns only the assignment and at `2026-10-01T10:00:00+08:00` it returns neither.

- [ ] **Step 2: Run the focused scheduler test and verify the expected failure**

Run: `npm test -- --run tests/reminders/scheduler.test.ts`

Expected: FAIL because `Reminder` does not yet accept or use `notificationAt`.

- [ ] **Step 3: Write the failing repository import test**

Add a test in `tests/store/repository.test.ts` that imports an `itemType: 'assignment'` due at `2026-10-08T23:59:00+08:00` and asserts the created reminder has `notificationAt: '2026-10-07T23:59:00+08:00'`. Import a `project` in the same test and assert its reminder has no `notificationAt`.

- [ ] **Step 4: Run the focused repository test and verify it fails for the missing field**

Run: `npm test -- --run tests/store/repository.test.ts -t "assignment"`

Expected: FAIL because imported reminders do not persist a one-day notification time.

### Task 2: Implement persisted assignment notification scheduling

**Files:**
- Modify: `src/lib/domain/types.ts`
- Modify: `src/lib/domain/reminders.ts`
- Modify: `src/lib/reminders/scheduler.ts`
- Modify: `src/lib/data/repository.ts`
- Test: `tests/reminders/scheduler.test.ts`, `tests/store/repository.test.ts`

- [ ] **Step 1: Add the optional reminder field and local-day helper**

Add `notificationAt?: string` to `Reminder`. Export a local-day shift helper from `src/lib/domain/reminders.ts` and use it to calculate assignment notification times without converting through the host timezone.

- [ ] **Step 2: Validate and migrate stored reminder data**

In `validateSnapshot`, parse `notificationAt` when present. For older Blackboard assignment snapshots that lack the field, identify assignments through their linked memo `sourceKind === 'assignment'` or linked `blackboardItems[].itemType === 'assignment'`, then derive `notificationAt` from `dueAt`.

- [ ] **Step 3: Set and update the field during Blackboard import**

When creating or updating an imported assignment, set `notificationAt` to one local day before `candidate.dueAt`. When an existing Blackboard item changes from assignment to another type, remove the field. Reset notification delivery state when either deadline or notification time changes.

- [ ] **Step 4: Preserve the rule while editing or advancing reminders**

Pass the assignment notification time through `saveMemoDraft`/`saveReminderDraft` when editing an imported assignment. In `setReminderStatus`, after advancing a recurring assignment occurrence, recompute `notificationAt` from the new `dueAt`.

- [ ] **Step 5: Make the scheduler use the notification window**

Change `getDueReminders` to compare `now` with `reminder.notificationAt ?? reminder.dueAt`, while keeping status and delivery guards unchanged.

- [ ] **Step 6: Run focused tests and the full test suite**

Run: `npm test -- --run tests/reminders/scheduler.test.ts tests/store/repository.test.ts`

Expected: focused tests pass. Then run `npm test`; expected: all tests pass.

- [ ] **Step 7: Commit the notification behavior**

Run:
```bash
git add src/lib/domain/types.ts src/lib/domain/reminders.ts src/lib/reminders/scheduler.ts src/lib/data/repository.ts tests/reminders/scheduler.test.ts tests/store/repository.test.ts
git commit -m "feat: notify Blackboard assignments one day early"
```

### Task 3: Add failing editor and app tests for detail actions

**Files:**
- Modify: `tests/ui/reminder-editor.test.ts`
- Modify: `tests/ui/dashboard.test.ts`

- [ ] **Step 1: Write the failing editor tests**

Render `ReminderEditor` with `existingMemoId: 'memo-1'` and `existingReminderId: 'reminder-1'`. Assert that buttons named “完成” and “删除” render, have distinct green/red action classes, and dispatch the matching event payload when clicked. Render a new editor without IDs and assert neither action button renders.

- [ ] **Step 2: Run the focused UI tests and verify the expected failure**

Run: `npm test -- --run tests/ui/reminder-editor.test.ts tests/ui/dashboard.test.ts`

Expected: FAIL because the editor has no action props or events.

- [ ] **Step 3: Add an app regression test for editing a standalone calendar reminder**

Seed a standalone reminder, open it through the calendar selection path, save without changing fields, and assert the reminder count remains one. This protects the existing `editingReminderId` requirement while adding the new actions.

### Task 4: Implement colored detail actions and correct calendar editing IDs

**Files:**
- Modify: `src/components/ReminderEditor.svelte`
- Modify: `src/routes/App.svelte`
- Test: `tests/ui/reminder-editor.test.ts`, `tests/ui/dashboard.test.ts`

- [ ] **Step 1: Add explicit editor identity props and events**

Add `existingMemoId` and `existingReminderId` props. Dispatch `complete` and `delete` with `{ memoId, reminderId }`. Render the actions only for existing items, make every action `type="button"`, and keep the existing save/cancel behavior unchanged.

- [ ] **Step 2: Add the approved title-bar styling**

Place actions in the editor heading in the order green “完成”, red “删除”, then neutral close. Use the approved colors and visible focus states; hide “完成” when there is no reminder ID, while allowing “删除” for an existing memo.

- [ ] **Step 3: Track memo and reminder IDs in `App.svelte`**

Add `editingReminderId`. Clear it for new memo/reminder creation. Set it from the linked reminder in `editMemo`, and preserve the standalone reminder ID in `editItem` so saving from the calendar updates the existing reminder instead of creating a duplicate.

- [ ] **Step 4: Handle complete/delete events in `App.svelte`**

For complete, call `repository.setReminderStatus(reminderId, 'completed')`. For delete, call `deleteMemo(memoId)` when a memo exists or `deleteReminder(reminderId)` for standalone reminders. Close the modal, refresh, and flush after each action.

- [ ] **Step 5: Run the focused UI tests**

Run: `npm test -- --run tests/ui/reminder-editor.test.ts tests/ui/dashboard.test.ts`

Expected: all focused UI tests pass.

- [ ] **Step 6: Run type checking and the full build**

Run: `npm run check` and `npm run build`

Expected: both exit with code 0.

- [ ] **Step 7: Commit the detail action behavior**

Run:
```bash
git add src/components/ReminderEditor.svelte src/routes/App.svelte tests/ui/reminder-editor.test.ts tests/ui/dashboard.test.ts
git commit -m "feat: add calendar detail actions"
```

### Task 5: Final verification

**Files:**
- Review: `docs/superpowers/specs/2026-10-11-calendar-item-detail-actions-design.md`
- Review: `src/components/ReminderEditor.svelte`, `src/routes/App.svelte`, `src/lib/reminders/scheduler.ts`

- [ ] **Step 1: Run the complete verification commands**

Run:
```bash
npm test
npm run check
npm run build
```

Expected: all tests pass, type checking succeeds, and the production build completes successfully.

- [ ] **Step 2: Review the diff against the approved design**

Confirm the title-bar action order/colors, standalone reminder ID preservation, assignment notification offset, old snapshot migration, Blackboard link button, and no unrelated files changed.
