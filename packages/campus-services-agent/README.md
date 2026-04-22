# campus-services-agent

`packages/campus-services-agent` 是 `campus-agent` 中首发 structured runtime campus service capability 的 owner package。

它负责：

- 接收 `campus-services-agent` 的 typed agent handoff
- 在 package 内维护 thin tool adapter
- 将 tool payload 映射为 internal query service packet
- 调用 execution-side internal query service，并返回 typed `SpecialistResponse`

它不负责：

- supervisor routing / final response assembly
- browser-facing API、`app-api` loopback HTTP 或 raw/source bundle scan
- ingestion/data plane truth owner

当前这个 package 主要冻结 owner boundary、internal query service interface 与 thin adapter seam；真正的 projection-backed query implementation 仍可在后续 phase 内继续补齐。
