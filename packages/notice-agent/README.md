# campus-notice-agent

`packages/notice-agent` 是 `campus-agent` 中首发 structured runtime notice
capability 的 owner package。

它负责：

- 维护 `notice-agent` 的 repo-owned SDK tool executors
- 将 admitted structured tool payload 映射为 execution-side internal query service packet
- 调用 notice query service，并返回 bounded SDK tool result projection
- 保留 `campus_notice_get` internal selected-notice resolve seam，
  不将其暴露为 provider/SDK tool

它不负责：

- supervisor routing / final response assembly
- browser-facing API、`app-api` loopback HTTP 或 query-time raw notice/source scan
- source-truth / normalized-truth ingestion owner

当前这个 package 主要冻结 owner boundary、internal query service interface、
bounded SDK executor seam 与 `campus_notice_get` internal runtime；internal
notice 的 projected read-model 查询 runtime 已迁到 `apps/execution-control`。

当前已实现：

- `NoticeHTTPQueryService`：调用 Go `apps/execution-control` internal query routes：
  `/internal/query/notices/discover` 与 `/internal/query/notices/get`
- `sdk_tool_executor`：负责 admitted structured notice tools 的 bounded SDK result projection
- `notice_get_runtime`：负责 internal selected notice resolve，不暴露为 structured tool

Go `apps/execution-control` 现在负责：

- restricted internal notice authorization fail-close gate
- 只读 `ingestion_projection.internal_notice_read_model`
- 从 S3-compatible derived bucket 读取 canonical markdown body

它仍不负责打开 browser-facing API、panel/chatbot 入口或 live collector/control-plane。
