# campus-mcp

这是 Campus MCP 的薄 stdio 适配器。Bot 通过 stdio 消费 MCP 工具；MCP 不读取 Qdrant、PostgreSQL
或 Model Config，只向上游检索 HTTP 服务转发 `campus_search` 工具调用。

本地运行：

```bash
CAMPUS_MCP_UPSTREAM_URL=http://127.0.0.1:8000 \
CAMPUS_MCP_UPSTREAM_TOKEN=mcp-upstream-token \
node dist/index.js
```

AstrBot 配置时将 `command` 指向 Node，将 `CAMPUS_MCP_UPSTREAM_URL` 和
`CAMPUS_MCP_UPSTREAM_TOKEN` 通过环境变量传入。`campus_search` 是 MCP 暴露的工具名，不是凭据名。

## 凭据配置

当前接入方式是 stdio：Bot 启动 MCP 子进程，stdio 本身不使用 Bearer token。
`CAMPUS_MCP_UPSTREAM_TOKEN` 是 MCP 调用上游 HTTP 服务的凭据，不代表某个工具的身份。
当前 MCP 注册的工具是 `campus_search`。

凭据由服务管理员生成，例如运行 `openssl rand -hex 32`；没有在线申请或签发接口。
已有接入的凭据由管理员提供。两端配置同一个值：

- 上游服务：`CAMPUS_MCP_CLIENT_TOKENS=astrbot=<生成的值>`。多个客户端用逗号分隔的
  `客户端标识=token` 配置，每个客户端使用独立值。
- MCP 进程：`CAMPUS_MCP_UPSTREAM_TOKEN=<生成的值>`，并设置可访问的
  `CAMPUS_MCP_UPSTREAM_URL`。可选的 `CAMPUS_MCP_UPSTREAM_TIMEOUT_MS` 默认是 `70000`。
- Kubernetes 中，上游配置读取 `campus-search-service-secrets` 的 `CAMPUS_MCP_CLIENT_TOKENS` 键；
  MCP 端由 Bot 管理员在 MCP 子进程环境中配置对应 token。

`RETRIEVAL_INTERNAL_TOKEN` 使用另外生成的值，只在 execution-control 与上游检索服务之间共享，
不分发给外部 Bot。旧凭据变量不保留兼容读取。
