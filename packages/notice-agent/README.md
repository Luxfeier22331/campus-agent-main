# campus-notice-agent

`packages/notice-agent` 是 `campus-agent` 中首发 structured runtime notice
capability 的 owner package。

它负责：

- 接收 `notice-agent` 的 typed agent handoff
- 在 package 内维护 notice discovery / get 的 thin tool adapter
- 将 tool payload 映射为 execution-side internal query service packet
- 调用 notice query service，并返回 typed `SpecialistResponse`

它不负责：

- supervisor routing / final response assembly
- browser-facing API、`app-api` loopback HTTP 或 query-time raw notice/source scan
- source-truth / normalized-truth ingestion owner

当前这个 package 主要冻结 owner boundary、internal query service interface 与 thin adapter
seam；internal notice 的 projected read-model query service 已落地为 package 内实现。

当前已实现：

- `NoticeReadModelQueryService`：读取 repo-owned read model repository，执行
  `campus_notice_discover` / `campus_notice_get` 的 result 映射
- restricted internal notice fail-close gate：缺少 principal / entitlement /
  restricted retrieval filter 时返回 `source_family_unavailable`
- `ObjectStoreNoticeBodyRepository`：按 read model 中的 canonical markdown object key
  从 derived bucket 读取正文

它仍不负责打开 browser-facing API、panel/chatbot 入口或 live collector/control-plane。
