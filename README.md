# MemoFlow

MemoFlow is a lightweight Windows desktop memo and reminder app built with Tauri 2, Svelte, TypeScript, Rust, SQLite, and WebView2.

## Features

- Modern two-column workspace with recent items and a monthly calendar
- Rich text memo editing with bold, lists, and links
- Categories, tags, keyword search, one-time and recurring reminders
- Windows notifications with complete/ignore actions
- Local SQLite persistence in the desktop build
- Markdown export
- Manual Blackboard import launched from the app
- In-app Blackboard SSO window with preview and explicit import confirmation
- Stable Blackboard deduplication and update tracking

## Development

Prerequisites:

- Node.js 20+
- Rust stable MSVC
- Visual Studio C++ Build Tools
- Microsoft WebView2 Runtime

Install dependencies:

~~~powershell
npm install
~~~

Run the desktop app:

~~~powershell
npm run tauri dev
~~~

Run checks:

~~~powershell
npm run check
npm run test:run
$env:Path = "C:\\Users\\<user>\\.cargo\\bin;" + $env:Path
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
~~~

Build installers:

~~~powershell
npm run tauri build
~~~

Installers are written under src-tauri/target/release/bundle/.

## DSH 微信提醒

MemoFlow 可通过已配对的 `@zmainer/dsh-wx-bridge` 将事项和倒计时提醒发送到微信。先在 DSH 桌面端安装并启动该插件，完成微信扫码配对，并确认桥接只监听本机 `127.0.0.1:7239`。

在 MemoFlow 的“通知设置”中启用“DSH 微信桥接”，端口保持 `7239`；如需指定收件人，再填写配对后的 peer ID。点击“发送 DSH 测试消息”只代表消息已进入桥接 outbox，界面不会把入队误报为微信已送达。桥接将文件移动到 `outbox/sent` 或 `outbox/failed` 后，MemoFlow 才会把提醒标记为已发送并清除待处理状态。

提醒调度器只在 MemoFlow 运行时执行；应用关闭时，DSH 桥本身不会替 MemoFlow 计算事项的到期时间。PushPlus 仍可作为备用通知渠道单独启用。

## Blackboard import

Click 同步 Blackboard inside MemoFlow. The desktop app opens a separate Blackboard WebView2 window. Complete SSO there, open the total calendar/activity page, then click 读取总日历 in MemoFlow. The app only transfers structured deadline metadata into a preview; it does not read password fields or import anything before confirmation.

The current parser uses semantic calendar attributes and deadline elements. Blackboard pages that do not expose those fields show an unsupported-page error instead of creating guessed reminders. If CUHK(SZ) changes its Blackboard layout, update the parser fixtures and selectors before shipping a new build.

The remote import window is session-scoped by a nonce, validates the source origin and payload limits, and clears its session when the import dialog closes. The app does not upload Blackboard content to a server.

## Data

Desktop persistence uses a transactional SQLite snapshot in the app data directory. Browser-mode development uses localStorage as a fallback. Corrupt snapshots fail loudly and preserve the last valid database file.

