# Blackboard Course Code Tag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show Blackboard course codes as stable tags on imported course items without changing their titles.

**Architecture:** Normalize a course code from the explicit Blackboard field or the prefix before the first colon in `courseName`. Centralize generated Blackboard tags in the repository, merge them during updates while retaining custom tags, and cover both normalization and persistence behavior with focused tests.

**Tech Stack:** Svelte/TypeScript, Vitest, existing `LocalRepository` storage abstraction.

---

### Task 1: Normalize course codes from Blackboard data

**Files:**
- Modify: `src/lib/import/normalize.ts`
- Test: `tests/import/normalize.test.ts`

- [x] **Step 1: Add failing normalization tests**

Add tests asserting that an explicit `courseCode` wins over the course name and that a missing code is extracted from `AIS6002:Science Foundation...`.

- [x] **Step 2: Run the focused test**

Run `npm run test:run -- tests/import/normalize.test.ts` and verify the new extraction assertion fails before implementation.

- [x] **Step 3: Implement `normalizeCourseCode`**

Trim the explicit code first; otherwise trim the substring before the first `:` when it is non-empty. Return `null` for missing or blank values and use it in `normalizeExternalItem`.

- [x] **Step 4: Run the focused test again**

Run `npm run test:run -- tests/import/normalize.test.ts` and verify all normalization tests pass.

### Task 2: Persist course codes as deduplicated Blackboard tags

**Files:**
- Modify: `src/lib/data/repository.ts`
- Test: `tests/store/repository.test.ts`

- [x] **Step 1: Add failing repository assertions**

Import an assignment with `courseCode: 'AIS6002'` and assert the new memo tags are `['assignment', 'AIS6002']`; repeat the import and assert `AIS6002` occurs once while a custom tag remains.

- [x] **Step 2: Run the focused test**

Run `npm run test:run -- tests/store/repository.test.ts` and verify the new assertions fail before implementation.

- [x] **Step 3: Implement tag generation and update merging**

Add a repository helper that creates the type tag plus a non-empty course-code tag. For existing Blackboard memos, remove only prior generated type/course-name/course-code tags, preserve other tags, and append the current generated tags without duplicates. Use the helper for new memos as well.

- [x] **Step 4: Run the focused test again**

Run `npm run test:run -- tests/store/repository.test.ts` and verify all repository tests pass.

### Task 3: Run the full verification suite

**Files:**
- No source changes.

- [x] **Step 1: Run all frontend tests**

Run `npm run test:run`; expect all test files and tests to pass.

- [x] **Step 2: Run Svelte checks**

Run `npm run check`; expect `0 errors and 0 warnings`.

- [x] **Step 3: Build the desktop artifact**

Run `CARGO_TARGET_DIR=target-course-code-tag npm run tauri build` in PowerShell with the existing single-job setting if needed; expect the release EXE and installer bundles to be generated.
