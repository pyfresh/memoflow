# DSH 微信桥接通知 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 接入已配对的 dsh-wx-bridge，让 MemoFlow 的事项和倒计时提醒通过本机微信桥发送，并可靠记录排队、成功和失败状态。

**Architecture:** 新增 TypeScript DSH 通知适配器；Tauri 侧提供回环 HTTP 入队和本地回执查询命令，浏览器预览走回环 HTTP。Repository 保存 DSH 队列文件和回执状态，scheduler 轮询队列并只在 sent 后完成提醒；PushPlus 保留为可选通道。

**Tech Stack:** Svelte 5、TypeScript、Vitest、Tauri 2、Rust reqwest。

---

### Task 1: 扩展通知领域模型和持久化

**Files:**
- Modify: `src/lib/domain/types.ts`
- Modify: `src/lib/data/repository.ts`
- Test: `tests/store/repository.test.ts`
- Test: `tests/store/countdowns.test.ts`

- [ ] **Step 1: 写迁移和 DSH delivery 的失败测试**

  覆盖旧快照读取、新字段默认为空、`markNotificationChannelQueued` 保存队列路径，以及 sent/failed 清理队列路径。

- [ ] **Step 2: 运行测试确认失败**

  Run: `npm run test:run -- tests/store/repository.test.ts tests/store/countdowns.test.ts`

- [ ] **Step 3: 实现类型、默认设置和 repository 状态方法**

  增加可选 DSH 设置和 delivery 字段，保持现有 PushPlus 测试对象兼容；保存时规范化端口、host 和字符串字段。

- [ ] **Step 4: 运行测试确认通过**

  Run: `npm run test:run -- tests/store/repository.test.ts tests/store/countdowns.test.ts`

### Task 2: 实现 DSH 通知适配器

**Files:**
- Create: `src/lib/notifications/dsh.ts`
- Test: `tests/notifications/dsh.test.ts`

- [ ] **Step 1: 写失败测试**

  覆盖纯文本格式、回环地址校验、HTTP 入队响应、pending/sent/failed 回执解析，以及拒绝非本机 host。

- [ ] **Step 2: 运行测试确认失败**

  Run: `npm run test:run -- tests/notifications/dsh.test.ts`

- [ ] **Step 3: 实现适配器**

  浏览器使用 `fetch`；Tauri 使用 `invoke('send_dsh_wxbridge_message')` 和 `invoke('check_dsh_wxbridge_delivery')`。适配器返回 `queuedFile`、`pending`、`sent` 或错误，不把入队当作送达。

- [ ] **Step 4: 运行测试确认通过**

  Run: `npm run test:run -- tests/notifications/dsh.test.ts`

### Task 3: 接入提醒通知和 scheduler

**Files:**
- Modify: `src/lib/notifications.ts`
- Modify: `src/lib/reminders/scheduler.ts`
- Modify: `src/routes/App.svelte`
- Test: `tests/notifications/countdown.test.ts`
- Test: `tests/reminders/scheduler.test.ts`

- [ ] **Step 1: 写失败测试**

  覆盖启用 DSH 时首次 tick 只排队、下一次发现 sent 才标记完成、failed 会记录错误并重试；倒计时使用总时长格式。

- [ ] **Step 2: 运行测试确认失败**

  Run: `npm run test:run -- tests/notifications/countdown.test.ts tests/reminders/scheduler.test.ts`

- [ ] **Step 3: 实现 channel outcome 和 scheduler queued 分支**

  notifyReminder/notifyCountdown 增加 DSH 调用；App 把 DSH queued/sent/failed 委托给 repository。

- [ ] **Step 4: 运行测试确认通过**

  Run: `npm run test:run -- tests/notifications/countdown.test.ts tests/reminders/scheduler.test.ts`

### Task 4: 更新通知设置界面

**Files:**
- Modify: `src/components/NotificationSettings.svelte`
- Modify: `tests/ui/notification-settings.test.ts`

- [ ] **Step 1: 写失败测试**

  覆盖 DSH 开关、端口、peer ID 可选输入、测试按钮和 PushPlus 回退区块。

- [ ] **Step 2: 运行测试确认失败**

  Run: `npm run test:run -- tests/ui/notification-settings.test.ts`

- [ ] **Step 3: 实现界面**

  将 DSH 微信桥作为主通道，显示“仅回环地址”和“已排队/已发送/失败由桥回执决定”的说明；PushPlus 保留为折叠式回退配置。

- [ ] **Step 4: 运行测试确认通过**

  Run: `npm run test:run -- tests/ui/notification-settings.test.ts`

### Task 5: 增加 Tauri 本地命令

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/lib.rs` tests

- [ ] **Step 1: 写 Rust 测试**

  覆盖 host 校验、端口校验和 sent/failed 文件路径判定。

- [ ] **Step 2: 运行 Rust 测试确认失败**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml`

- [ ] **Step 3: 实现命令并注册**

  增加 `send_dsh_wxbridge_message`、`check_dsh_wxbridge_delivery`，只允许回环 host 和用户目录下的 wxbridge outbox。

- [ ] **Step 4: 运行 Rust 测试确认通过**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml`

### Task 6: 全量验证和构建

**Files:**
- Modify: `README.md` with DSH setup and test instructions

- [ ] **Step 1: 运行 TypeScript 检查和全量测试**

  Run: `npm run check` and `npm run test:run`

- [ ] **Step 2: 运行 Rust 测试和生产构建**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml` and `npm run build`

- [ ] **Step 3: 进行本机微信端到端验证**

  Create a reminder due immediately, trigger one scheduler tick, verify queue then sent state and confirm the message on the paired WeChat account. Do not include Blackboard credentials or other sensitive content.

