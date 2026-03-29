# campus-rag-specialist

`packages/rag-specialist` 是当前已接受的 retrieval-oriented specialist 边界。

它负责：

- 接收来自 `packages/supervisor-core` 的稳定 specialist handoff
- 调用 `packages/retrieval-core` 获取 evidence
- 组装基于 evidence 的回答
- 返回 `SpecialistResponse` 与 confidence

它不负责：

- supervisor 级 routing / policy / audit
- transport / runtime host
- ingestion、object storage、registry 写入

当前默认 query-serving retrieval specialist 仍是 `rag-specialist`；它已经不是早期的 bootstrap 占位壳。
