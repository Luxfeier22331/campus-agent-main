# campus-notice-agent

`packages/notice-agent` 是 `campus-agent` 中首发 structured runtime notice capability 的 owner package。

它负责：

- 接收 `notice-agent` 的 typed specialist handoff
- 在 package 内维护 notice discovery / get 的 thin tool adapter
- 将 tool payload 映射为 execution-side internal query service packet
- 调用 notice query service，并返回 typed `SpecialistResponse`

它不负责：

- supervisor routing / final response assembly
- browser-facing API、`app-api` loopback HTTP 或 query-time raw notice/source scan
- source-truth / normalized-truth ingestion owner

当前这个 package 主要冻结 owner boundary、internal query service interface 与 thin adapter seam；真正的 projected notice query implementation 仍可在后续 phase 内补齐。
