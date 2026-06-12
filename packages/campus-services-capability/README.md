# campus-services-capability

`packages/campus-services-capability` 是 `campus-agent` 中首发 structured runtime campus
service capability 的 owner package。

它负责：

- 维护 `campus-services-capability` 的 repo-owned SDK tool executor
- 将 admitted structured tool payload 映射为 internal query service packet
- 调用 execution-side internal query service，并返回 bounded SDK tool result projection
- 保留 query service interface 与纯 response builder，供测试和 internal helper 使用

它不负责：

- supervisor routing / final response assembly
- browser-facing API、`app-api` loopback HTTP 或 raw/source bundle scan
- ingestion/data plane truth owner

当前这个 package 主要冻结 owner boundary、internal query service interface、bounded SDK
executor seam 与纯 response builder；生产 structured execution 不再暴露 direct online
adapter。
