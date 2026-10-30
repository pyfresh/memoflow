# DSH 微信入站写入 MemoFlow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让已配对的 DSH 微信会话在明确理解用户意图后，通过受限本地工具创建 MemoFlow 备忘录/提醒，并对缺少具体时间的自然语言给出可操作的追问。

**Architecture:** MemoFlow Tauri 进程在本机回环地址提供一个随机令牌保护的结构化入站工具端点。端点只接受创建备忘录/提醒所需字段，并通过现有 SQLite 快照校验与事务写入；DSH 自定义 agent preset 通过 MCP/本地工具调用该端点。日期和时间由 DSH 解析成结构化参数，MemoFlow 负责最终校验，模糊的“下午”不会被写成任意固定小时。

**Tech Stack:** Svelte/TypeScript repository, Tauri 2/Rust, rusqlite, DSH agent preset/MCP, Vitest, Cargo test.

---

### Task 1: 固定入站契约并写失败测试

**Files:**
- Create: `src/lib/inbound/memoflow-tool.ts`
- Test: `src/lib/inbound/memoflow-tool.test.ts`

- [ ] **Step 1: Write the failing tests**

覆盖：完整 `title + dueAt` 返回创建参数；只有日期和 `timeOfDay: afternoon` 返回 `needs_confirmation`；非法 ISO 日期被拒绝；未知字段被拒绝。

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npm test -- src/lib/inbound/memoflow-tool.test.ts --run`
Expected: FAIL because the validator module does not exist.

- [ ] **Step 3: Implement the pure validator**

导出 `validateCreateReminderInput` 和 `validateCreateMemoInput`，只允许白名单字段，接受带时区 ISO 时间，返回 `created` 或 `needs_confirmation`/错误，不执行文件写入。

- [ ] **Step 4: Run the focused test and confirm GREEN**

Run: `npm test -- src/lib/inbound/memoflow-tool.test.ts --run`
Expected: all focused tests pass.

### Task 2: 在现有 repository 上实现受限创建操作

**Files:**
- Modify: `src/lib/data/repository.ts`
- Test: `src/lib/data/repository.test.ts`

- [ ] **Step 1: Add a failing repository regression test**

调用新的结构化入口创建标题为“考试”的 reminder，断言 snapshot 新增一条 reminder、dueAt 保留传入时区、memo body 保留原始描述；重复 external id 不重复创建。

- [ ] **Step 2: Run the test and confirm RED**

Run: `npm test -- src/lib/data/repository.test.ts --run`
Expected: FAIL because the structured inbound method is missing.

- [ ] **Step 3: Implement minimal repository method**

增加 `createInboundReminder`，复用 `saveMemoDraft`/`saveReminderDraft` 与现有校验，source 固定为 `manual` 或显式 `dsh` 标记，禁止路径、任意 JSON 合并和任意文件写入。

- [ ] **Step 4: Run repository tests and confirm GREEN**

Run: `npm test -- src/lib/data/repository.test.ts --run`
Expected: all repository tests pass.

### Task 3: 暴露回环地址工具端点并挂载 DSH preset

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`
- Create: `dsh/memoflow-tool.mjs`
- Create: `dsh/memoflow-agent-preset/agent.cordis.yml`
- Create: `dsh/memoflow-agent-preset/preset.yml`
- Test: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add failing Rust tests**

测试请求体白名单校验、缺少精确时间返回 `needs_confirmation`、完整时间创建 JSON 快照、非回环地址拒绝。

- [ ] **Step 2: Run Rust tests and confirm RED**

Run: `cargo test --manifest-path src-tauri/Cargo.toml inbound`
Expected: FAIL because the endpoint parser and command do not exist.

- [ ] **Step 3: Implement the endpoint**

使用 stdlib `TcpListener` 仅绑定 `127.0.0.1`，随机 token 存入应用数据目录并只接受 `Authorization: Bearer`。请求只支持 `POST /api/dsh/tools/create-reminder` 与 `POST /api/dsh/tools/create-memo`；写入复用 SQLite `SnapshotDb` 的事务接口，响应明确包含 `status`, `id`, `title`, `dueAt` 或 `needs_confirmation`，不记录正文和 token。

- [ ] **Step 4: Add DSH preset tool wrapper**

工具 wrapper 只把模型已经解析出的结构化参数 POST 到本机端点；系统提示要求缺少具体时刻时先追问，不把“下午”改写为 14:00/15:00；成功后必须把端点回执原样概括给微信用户。

- [ ] **Step 5: Run Rust tests and preset self-check**

Run: `cargo test --manifest-path src-tauri/Cargo.toml inbound`
Run: `node <dsh-wx-bridge>/lib/kernel/bridge.mjs --selftest-presets`
Expected: all inbound tests and preset self-check pass.

### Task 4: 端到端真实场景验证

**Files:**
- No production files; use the paired local DSH bridge and running MemoFlow.

- [ ] **Step 1: Start the new MemoFlow build and verify the local tool status**

确认端点监听回环地址、token 未出现在日志、DSH preset 已选中。

- [ ] **Step 2: Send the exact user message through the paired WeChat session**

发送：`下周一下午有一门考试`。Expected: 微信收到明确追问；数据库和 UI 不新增一个伪造的固定小时。

- [ ] **Step 3: Complete the conversation with a concrete time**

发送：`下午三点`。Expected: 微信收到成功回执，MemoFlow 日历/最近事项出现标题“考试”，dueAt 是按当前时区解析的下周一 15:00。

- [ ] **Step 4: Run the full verification suite**

Run: `npm run check`
Run: `npm run test:run`
Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Run: `npm run tauri -- build`
Expected: every command exits 0; report any environment-limited step explicitly.

