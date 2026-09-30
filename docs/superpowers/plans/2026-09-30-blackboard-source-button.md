# Blackboard Source Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with checkpoints.

**Goal:** Move Blackboard source links out of imported memo body HTML and expose them as a safe, standalone button in the memo editor.

**Architecture:** Keep `Memo.sourceUrl` as the source of truth. The repository stops appending a source anchor to imported `richText`; `App` passes `sourceUrl` into `ReminderEditor`, which renders a source bar above the body, removes the matching legacy anchor on initialization, and opens valid HTTP(S) URLs through Tauri's opener plugin or `window.open` in browser preview mode.

**Tech Stack:** Svelte 5, TypeScript, Vitest + Testing Library, Tauri 2 `@tauri-apps/plugin-opener`.

---

### Task 1: Keep Blackboard URLs out of imported rich text

**Files:**
- Modify: `src/lib/data/repository.ts:106-110` (`remoteMemoBody`)
- Test: `tests/store/repository.test.ts` Blackboard import tests

- [ ] **Step 1: Write the failing assertion**

Extend the Blackboard import test to assert the imported memo retains `sourceUrl` but its `richText` contains the course/body text and does not contain `打开 Blackboard 项目` or an `<a` tag:

```ts
const memo = repository.load().memos[0];
expect(memo.sourceUrl).toBe('https://bb.cuhk.edu.cn/item/1');
expect(memo.richText).not.toContain('打开 Blackboard 项目');
expect(memo.richText).not.toContain('<a');
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run `npm run test:run -- tests/store/repository.test.ts`.
Expected: the new assertion fails because `remoteMemoBody` currently appends the anchor paragraph.

- [ ] **Step 3: Implement the minimal repository change**

Change `remoteMemoBody` to return only the course heading and escaped description/item type:

```ts
function remoteMemoBody(courseName: string, itemType: string, _sourceUrl: string, description?: string): string {
  const body = description?.trim()
    ? `<p>${escapeHtml(description.trim()).replace(/\r?\n/g, '<br>')}</p>`
    : `<p>${escapeHtml(itemType)}</p>`;
  return `<p><strong>${escapeHtml(courseName)}</strong></p>${body}`;
}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run `npm run test:run -- tests/store/repository.test.ts`.
Expected: all repository tests pass.

- [ ] **Step 5: Commit the repository change**

```bash
git add src/lib/data/repository.ts tests/store/repository.test.ts
git commit -m "fix: keep Blackboard links out of memo bodies"
```

### Task 2: Add source URL behavior to `ReminderEditor`

**Files:**
- Modify: `src/components/ReminderEditor.svelte`
- Test: `tests/ui/reminder-editor.test.ts`

- [ ] **Step 1: Write failing UI tests**

Mock the opener module and add tests for the approved behavior:

```ts
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }));
```

Use an initial memo with `sourceUrl` and a legacy source anchor in `body`, then assert the source button is visible, the body no longer contains the anchor label, and clicking the button opens the URL in browser preview. Add a test that a memo without `sourceUrl` has no source button. Add a test that a `javascript:` source URL has no source button.

- [ ] **Step 2: Run the focused UI test and verify it fails**

Run `npm run test:run -- tests/ui/reminder-editor.test.ts`.
Expected: the source button queries fail because the editor has no source URL state or source bar.

- [ ] **Step 3: Implement source state, cleanup, validation, and opening**

Import `openUrl` from `@tauri-apps/plugin-opener`. Add `sourceUrl`, `sourceError`, and helpers:

```ts
function isSafeExternalUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}
```

Normalize legacy body HTML with a helper that removes only a `<p>` containing an anchor whose resolved `href` equals `sourceUrl` and whose label is `打开 Blackboard 项目`; preserve all other content. Initialize `body` from this cleaned HTML and include `sourceUrl: sourceUrl || null` in the submitted `MemoDraft`.

Add `openSource()` that clears the previous error, validates the URL, calls `openUrl(sourceUrl)` when `window.__TAURI_INTERNALS__` exists, and otherwise calls `window.open(sourceUrl, '_blank', 'noopener,noreferrer')` for browser preview. Catch errors and render `无法打开 Blackboard 项目，请稍后重试。` with `role="status"`.

Render the approved source bar between the body label/toolbar and the contenteditable body:

```svelte
{#if isSafeExternalUrl(sourceUrl)}
  <div class="source-link" role="group" aria-label="Blackboard 来源">
    <span>来源：Blackboard 课程</span>
    <button type="button" class="source-button" on:click={openSource}>↗ 打开 Blackboard 项目</button>
    {#if sourceError}<span class="source-error" role="status">{sourceError}</span>{/if}
  </div>
{/if}
```

Style the bar with the existing teal surface tokens and keep it responsive; do not change the editor's existing save/cancel layout.

- [ ] **Step 4: Run the focused UI test and verify it passes**

Run `npm run test:run -- tests/ui/reminder-editor.test.ts`.
Expected: source button, legacy cleanup, safe URL filtering, and open behavior pass with no Svelte warnings.

- [ ] **Step 5: Commit the editor change**

```bash
git add src/components/ReminderEditor.svelte tests/ui/reminder-editor.test.ts
git commit -m "feat: add Blackboard source button to memo editor"
```

### Task 3: Pass source URLs from the app and cover the integration

**Files:**
- Modify: `src/routes/App.svelte:119-133` (`editMemo`)
- Test: `tests/ui/dashboard.test.ts`

- [ ] **Step 1: Write the failing integration test**

Seed demo data, open the memo page, select `数据结构作业提交`, and assert the editor shows `打开 Blackboard 项目`. This fails before `editMemo` passes `memo.sourceUrl`.

- [ ] **Step 2: Run the focused dashboard test and verify it fails**

Run `npm run test:run -- tests/ui/dashboard.test.ts`.
Expected: the Blackboard source button is absent in the editor.

- [ ] **Step 3: Pass `sourceUrl` through `editingDraft`**

Add `sourceUrl: memo.sourceUrl` to the object built in `editMemo`. The existing `saveMemo` path already forwards the complete draft to `repository.saveMemoDraft`, so no additional persistence API is required.

- [ ] **Step 4: Run the focused dashboard test and verify it passes**

Run `npm run test:run -- tests/ui/dashboard.test.ts`.
Expected: all dashboard tests pass and the source button is visible only for the Blackboard memo.

- [ ] **Step 5: Commit the integration change**

```bash
git add src/routes/App.svelte tests/ui/dashboard.test.ts
git commit -m "fix: preserve Blackboard source URL while editing"
```

### Task 4: Full verification and desktop build

**Files:**
- No source changes expected.

- [ ] **Step 1: Run full checks**

Run `npm run check`, `npm run test:run`, and `git diff --check`.
Expected: Svelte diagnostics report 0 errors and 0 warnings; all tests pass.

- [ ] **Step 2: Build a fresh Windows executable**

Run `npm run tauri -- build --no-bundle -- --target-dir target-blackboard-source-button`.
Expected: Tauri reports the executable at `src-tauri/target-blackboard-source-button/release/memoflow.exe`.

- [ ] **Step 3: Launch and verify the executable**

Start the fresh executable and confirm its `memoflow` process reports `Responding=True`. Do not terminate existing user or legacy instances.

- [ ] **Step 4: Commit any final verification-only metadata if needed**

Do not commit generated `target-*` directories or screenshots; leave them untracked alongside the existing repair artifacts.
