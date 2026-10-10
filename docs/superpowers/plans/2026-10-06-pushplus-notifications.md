# PushPlus 微信提醒 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add PushPlus WeChat service-account reminders to MemoFlow while preserving Windows native notifications and retrying failed external deliveries without duplicating successful local notifications.

**Architecture:** Store notification settings and per-channel delivery state in the existing snapshot repository. The Svelte layer formats reminder content and invokes a Tauri Rust command; Rust performs the HTTPS request to PushPlus so the WebView does not depend on CORS and the token does not travel through frontend network code. The scheduler records each channel independently and marks the reminder complete only after all enabled channels succeed.

**Tech Stack:** Svelte 5, TypeScript, Vitest, Tauri 2, Rust, `reqwest` with Rustls, PushPlus `/send` JSON API.

---

### Task 1: Add notification settings and delivery state

**Files:**
- Modify: `src/lib/domain/types.ts`
- Modify: `src/lib/data/repository.ts`
- Test: `tests/store/repository.test.ts`

- [ ] **Step 1: Write failing tests for defaults and persisted settings**

Add tests that create a repository from an in-memory storage, assert default PushPlus settings are disabled with an empty token, save settings, reload, and assert the token and enabled flag persist. Add a delivery-state test that records the native channel as sent without setting the overall `notificationSentAt` until the PushPlus channel is also marked sent.

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `npm run test:run -- tests/store/repository.test.ts`

Expected: FAIL because notification settings and per-channel delivery methods do not exist.

- [ ] **Step 3: Implement the domain types and repository methods**

Add:

```ts
export type NotificationChannel = 'native' | 'pushplus';
export interface NotificationSettings {
  pushplusEnabled: boolean;
  pushplusToken: string;
}
export interface ReminderDeliveryState {
  nativeSentAt: string | null;
  pushplusSentAt: string | null;
  pushplusLastError: string | null;
}
```

Add optional `delivery?: ReminderDeliveryState` to `Reminder` and optional `notificationSettings?: NotificationSettings` to `AppSnapshot`. Give migrated reminders `{ nativeSentAt: null, pushplusSentAt: null, pushplusLastError: null }`, default settings `{ pushplusEnabled: false, pushplusToken: '' }`, and repository methods `getNotificationSettings`, `saveNotificationSettings`, `markNotificationChannelSent`, and `markNotificationChannelFailed`. Keep `notificationSentAt` as the backward-compatible aggregate completion timestamp.

- [ ] **Step 4: Run the focused tests to verify they pass**

Run: `npm run test:run -- tests/store/repository.test.ts`

Expected: all repository tests pass, including the new settings and delivery-state cases.

- [ ] **Step 5: Commit the persistence slice**

```bash
git add src/lib/domain/types.ts src/lib/data/repository.ts tests/store/repository.test.ts
git commit -m "feat: persist notification settings and channel delivery state"
```

### Task 2: Implement the PushPlus request adapter

**Files:**
- Create: `src/lib/notifications/pushplus.ts`
- Modify: `src/lib/data/desktop.ts`
- Test: `tests/notifications/pushplus.test.ts`

- [ ] **Step 1: Write failing adapter tests**

Test that `buildPushPlusMessage` returns a JSON-safe payload with `token`, `title`, `content`, `channel: 'wechat'`, and `template: 'txt'`; test that a response `{ code: 200, msg: '请求成功' }` is accepted; test that a non-200 business code and a malformed response become readable errors; test that `redactToken` never returns the full token.

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `npm run test:run -- tests/notifications/pushplus.test.ts`

Expected: FAIL because the adapter module does not exist.

- [ ] **Step 3: Implement the adapter and desktop invoke wrapper**

Define an injectable `PushPlusTransport` with `send(message): Promise<PushPlusResponse>`, a production implementation that calls `invoke('send_pushplus_message', { message })`, and pure helpers for building and validating the request. Format reminder content as title, due time, and optional `assignment`/course-code tags without including rich-text body content. Reject blank tokens before invoking Tauri.

- [ ] **Step 4: Run the focused tests to verify they pass**

Run: `npm run test:run -- tests/notifications/pushplus.test.ts`

Expected: all adapter tests pass.

- [ ] **Step 5: Commit the adapter slice**

```bash
git add src/lib/notifications/pushplus.ts src/lib/data/desktop.ts tests/notifications/pushplus.test.ts
git commit -m "feat: add PushPlus notification adapter"
```

### Task 3: Add the Tauri PushPlus command

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/Cargo.lock`

- [ ] **Step 1: Add Rust response and command tests**

Add unit tests for parsing a successful PushPlus response, converting a non-200 business code to an error containing the provider message, rejecting an empty token, and ensuring the redacted token never appears in an error string.

- [ ] **Step 2: Run the Rust tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Expected: FAIL because the command and response helpers do not exist.

- [ ] **Step 3: Implement the HTTPS command**

Add `reqwest` with JSON and Rustls features. Implement `send_pushplus_message` as a Tauri command that validates the token, POSTs JSON to `https://www.pushplus.plus/send`, checks HTTP status, parses `{ code, msg, data }`, and returns a concise error for non-200 business codes. Do not log the token or request body. Register the command in `generate_handler!`.

- [ ] **Step 4: Run Rust tests and the existing command tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Expected: all Rust tests pass.

- [ ] **Step 5: Commit the Tauri slice**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs
git commit -m "feat: send PushPlus messages from Tauri"
```

### Task 4: Make reminder scheduling channel-aware

**Files:**
- Modify: `src/lib/reminders/scheduler.ts`
- Modify: `src/lib/notifications.ts`
- Modify: `src/routes/App.svelte`
- Test: `tests/reminders/scheduler.test.ts`

- [ ] **Step 1: Write failing scheduler tests**

Add tests for a successful native and PushPlus delivery, a PushPlus failure after native success, and the next tick retrying PushPlus while skipping native. Assert that aggregate `notificationSentAt` is written only when every enabled channel succeeds and that failed delivery stores a readable error.

- [ ] **Step 2: Run the focused scheduler tests to verify they fail**

Run: `npm run test:run -- tests/reminders/scheduler.test.ts`

Expected: FAIL because the scheduler only supports one aggregate notification callback.

- [ ] **Step 3: Implement per-channel delivery results**

Change the notification callback to return channel results, preserve compatibility for existing void callbacks in tests, and add repository hooks for channel success/failure. `notifyReminder` sends the native notification once and sends PushPlus only when enabled, configured, and not already marked successful. A PushPlus failure leaves the native timestamp intact, records the error, and causes the scheduler to retry the missing external channel.

- [ ] **Step 4: Wire settings into the app scheduler**

Load `notificationSettings` from the snapshot during initialization, pass current settings into the notifier callback, and refresh the snapshot after channel-state updates. Keep the existing 30-second polling interval. The native notification remains the local fallback; PushPlus is optional and disabled by default.

- [ ] **Step 5: Run the scheduler and regression tests**

Run: `npm run test:run -- tests/reminders/scheduler.test.ts tests/store/repository.test.ts tests/ui/dashboard.test.ts`

Expected: all focused scheduler, repository, and dashboard tests pass.

- [ ] **Step 6: Commit the scheduler slice**

```bash
git add src/lib/reminders/scheduler.ts src/lib/notifications.ts src/routes/App.svelte tests/reminders/scheduler.test.ts
git commit -m "feat: retry notification channels independently"
```

### Task 5: Add PushPlus settings UI

**Files:**
- Create: `src/components/NotificationSettings.svelte`
- Modify: `src/components/Sidebar.svelte`
- Modify: `src/routes/App.svelte`
- Test: `tests/ui/notification-settings.test.ts`

- [ ] **Step 1: Write failing component tests**

Test that the settings dialog renders a disabled PushPlus switch and password input, saves a token and enabled state, rejects an empty enabled token, invokes the test-send callback, and displays success or readable failure feedback.

- [ ] **Step 2: Run the focused UI tests to verify they fail**

Run: `npm run test:run -- tests/ui/notification-settings.test.ts`

Expected: FAIL because the settings component and sidebar entry do not exist.

- [ ] **Step 3: Implement the settings dialog**

Add a compact settings modal matching the existing UI. Provide a password-style Token field, a binary enable control, a test button, save/cancel buttons, and an `aria-live` status region. Never render the full token after saving; show only a configured indicator and an option to replace or clear it.

- [ ] **Step 4: Connect the sidebar and app state**

Add a `通知设置` sidebar action. Open the dialog from `App.svelte`, save through the repository, close on success, and restart the scheduler callback with the latest settings without losing current reminder data.

- [ ] **Step 5: Run the UI and complete regression tests**

Run: `npm run test:run -- tests/ui/notification-settings.test.ts tests/ui/dashboard.test.ts tests/ui/weekly-schedule.test.ts`

Expected: all selected UI tests pass.

- [ ] **Step 6: Commit the settings UI**

```bash
git add src/components/NotificationSettings.svelte src/components/Sidebar.svelte src/routes/App.svelte tests/ui/notification-settings.test.ts
git commit -m "feat: add PushPlus notification settings"
```

### Task 6: Verify the complete product

**Files:**
- Modify: `docs/superpowers/specs/2026-10-06-pushplus-notifications-design.md` only if validation changes the documented behavior

- [ ] **Step 1: Run the complete TypeScript test suite**

Run: `npm run test:run`

Expected: all test files pass.

- [ ] **Step 2: Run Svelte diagnostics**

Run: `npm run check`

Expected: `svelte-check found 0 errors and 0 warnings`.

- [ ] **Step 3: Build the frontend**

Run: `npm run build`

Expected: Vite and adapter-static finish successfully.

- [ ] **Step 4: Build an isolated EXE**

Run in PowerShell:

```powershell
$env:CARGO_TARGET_DIR='D:\Projects\日历\src-tauri\src-tauri\target-pushplus-notifications'
npm run tauri build -- --no-bundle
```

Expected: `D:\Projects\日历\src-tauri\src-tauri\target-pushplus-notifications\release\memoflow.exe` exists.

- [ ] **Step 5: Run final diff validation**

Run: `git diff --check`

Expected: exit code `0`.
