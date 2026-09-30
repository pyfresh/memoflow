# Blackboard 来源按钮设计

## 目标

Blackboard 导入的课程/作业详情中，正文只显示可读的课程内容，不再显示来源链接的 HTML。详情编辑器在正文上方提供一个独立的“打开 Blackboard 项目”按钮，点击后使用 Tauri opener 插件调用系统默认浏览器打开 `sourceUrl`。

## 用户界面

- 仅当备忘录存在 `sourceUrl` 时显示来源栏。
- 来源栏位于正文标题下方、正文编辑区上方，显示“来源：Blackboard 课程”和“打开 Blackboard 项目”按钮。
- 按钮使用现有轻量按钮样式，不挤占右上角的关闭/保存操作。
- 普通手写备忘录没有来源链接时不显示来源栏。

## 数据流

1. 导入流程继续把 Blackboard URL 写入 `Memo.sourceUrl`，但生成的 `richText` 不再拼接链接段落。
2. `App.editMemo` 将 `memo.sourceUrl` 传给 `ReminderEditor`，编辑器保存时原样带回 `MemoDraft.sourceUrl`。
3. 为兼容已保存的旧记录，编辑器初始化时从正文移除与 `sourceUrl` 对应的“打开 Blackboard 项目”链接段落；用户保存后正文永久保持清洁。
4. 点击按钮前只允许 `http:` 或 `https:` URL；无效或缺失 URL 不显示按钮，避免打开危险协议。

## 错误处理

- opener 调用失败时在编辑器中显示可读的状态提示，不影响保存和关闭。
- 浏览器打开属于外部动作，按钮点击后不修改备忘录正文或提醒数据。

## 测试

- 编辑器测试验证 Blackboard 来源栏、按钮标签、旧链接清理和普通备忘录隐藏来源栏。
- App 测试验证编辑 Blackboard 备忘录时把 `sourceUrl` 传给编辑器，并且保存后仍保留来源 URL。
- 现有完整前端测试、Svelte 类型检查和 Tauri 构建继续通过。

## 不在范围内

- 不改变 Blackboard 导入页面或登录流程。
- 不为普通备忘录增加通用链接附件管理。
- 不自动打开浏览器或在后台同步 Blackboard。
