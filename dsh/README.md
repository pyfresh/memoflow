# DSH 与 MemoFlow 链路

MemoFlow 的微信链路由四层组成：

```text
ClawBot/iLink（微信传输）
        ↓
DSH wx-bridge（收发适配）
        ↓
MemoFlow Agent preset（对话编排）
        ↓
memoflow-mcp-server.mjs（本机回环工具）
```

ClawBot/iLink 不会作为 Agent、MCP server 或可调用工具挂载到 `memoflow` preset。这样可以避免 DSH、ClawBot 和微信桥相互循环调用。需要独立调用 ClawBot 时，必须另行提供带鉴权、超时和幂等键的 HTTP/MCP 接口。

## MCP server 路径

`dsh/memoflow-agent-preset/agent.cordis.yml` 默认从以下位置启动 MCP server：

```text
%USERPROFILE%/.dsh/memoflow/memoflow-mcp-server.mjs
```

测试或分阶段部署时可设置 `MEMOFLOW_MCP_SERVER` 覆盖此路径。MCP server 读取 `MEMOFLOW_INBOUND_CONFIG` 指向的 MemoFlow 本机入站配置；未设置时使用 `%APPDATA%/com.pyfresh.memoflow/dsh-inbound.json`。

## 启动前检查

`dsh/dsh-preflight.mjs` 提供 `runDshPreflight`，在真实微信测试前验证：

- bridge 是回环地址且端口与配置一致；
- bridge 已配对、allowlist 非空；
- `/wxbridge/presets` 的 `selected` 为 `memoflow`；
- MCP server 文件存在且 preset 支持环境变量覆盖；
- MemoFlow bearer token 可访问入站端点。

最后一项发送一个缺少具体 `HH:mm` 的时段请求，必须得到 `needs_confirmation`，因此不会写入用户数据。

如果安装的 wxbridge 版本只轮询 outbox、没有提供 `/wxbridge/status` 和 `/wxbridge/presets` HTTP 路由，preflight 会明确报告 bridge health 不可用；进程存在或 outbox 目录存在都不能替代这项检查。
