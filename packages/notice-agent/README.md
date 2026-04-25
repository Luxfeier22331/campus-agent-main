# campus-notice-agent

`packages/notice-agent` 是 `campus-agent` 中首发 structured runtime notice
capability 的 owner package。

它负责：

- 接收 `notice-agent` 的 typed agent handoff
- 在 package 内维护 notice discovery / get 的 thin tool adapter
- 将 tool payload 映射为 execution-side internal query service packet
- 调用 notice query service，并返回 typed `AgentResponse`

它不负责：

- supervisor routing / final response assembly
- browser-facing API、`app-api` loopback HTTP 或 query-time raw notice/source scan
- source-truth / normalized-truth ingestion owner

当前这个 package 主要冻结 owner boundary、internal query service interface 与 thin adapter
seam；internal notice 的 projected read-model 查询 runtime 已迁到 `apps/supervisor-api`。

当前已实现：

- `NoticeHTTPQueryService`：调用 Go `apps/supervisor-api` internal query routes：
  `/internal/query/notices/discover` 与 `/internal/query/notices/get`
- `delegate_to_notice_agent(...)`：必须显式注入 query service；默认不再从 Python
  env 构造 PG/S3 read-model runtime
- `tool_adapter`：负责 notice discover/get result 到 `AgentResponse` 的薄映射

Go `apps/supervisor-api` 现在负责：

- restricted internal notice authorization fail-close gate
- 只读 `ingestion_projection.internal_notice_read_model`
- 从 S3-compatible derived bucket 读取 canonical markdown body

它仍不负责打开 browser-facing API、panel/chatbot 入口或 live collector/control-plane。
