# DSH 微信桥接通知设计

## 目标

让 MemoFlow 使用已经配对的 `@zmainer/dsh-wx-bridge` 发送事项和倒计时提醒，同时保留 PushPlus 作为可选回退。通知状态必须区分排队、已发送和失败，避免把 HTTP 入队成功误认为微信已送达。

## 架构

新增 `dsh` 通知适配器。桌面版通过 Tauri 命令访问仅监听 `127.0.0.1` 的 `/wxbridge/push`，浏览器预览直接访问同一回环地址。桥返回的 outbox 文件路径写入提醒的 delivery 状态；后续调度轮询 `outbox/sent` 和 `outbox/failed`，只有发现 sent 才完成提醒，失败则保留可重试状态。

`NotificationSettings` 增加 DSH 开关、端口和可选 peer ID。host 固定为回环地址，不允许设置为局域网或公网地址。现有 PushPlus 字段继续兼容旧快照，默认关闭。通知格式保持“标题 + 截止时间/倒计时总长”的纯文本结构。

## 数据和状态

- `NotificationChannel` 增加 `dsh`。
- delivery 增加 `dshQueuedFile`、`dshSentAt`、`dshLastError`。
- scheduler 新增 queued 状态处理：排队只保存文件，不完成提醒；sent 才记录完成；failed 记录错误并在下一次 tick 重试。
- 旧快照缺少新字段时由 repository 补齐，不改变已有 PushPlus 数据。

## 安全边界

- DSH host 仅允许 `127.0.0.1` 或 `localhost`，端口默认为 7239。
- 不读取或写入微信凭据；MemoFlow 只接收桥返回的队列路径和状态。
- 不向 DSH 直接写 MemoFlow SQLite；本次只实现通知通道，不实现微信创建备忘录 Tool。

## 验证

- 适配器测试请求体、响应校验和 sent/failed/pending 状态。
- scheduler 测试排队后不完成、发送后完成、失败后可重试。
- repository 测试新字段保存和旧快照迁移。
- 保留现有 PushPlus、倒计时和 UI 测试，并运行 `npm run check` 与 `npm run test:run`。
