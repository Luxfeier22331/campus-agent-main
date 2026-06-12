# campus-knowledge-capability

`packages/knowledge-capability` 是当前已接受的 retrieval-oriented knowledge
capability 边界。

它负责：

- 接收来自 execution / offline / eval caller 的稳定 `CapabilityRequest`
- 调用 `packages/retrieval-core` 获取 evidence
- 组装基于 evidence 的回答
- 返回 `CapabilityResponse` 与 confidence

它不负责：

- supervisor 级 routing / policy / audit
- transport / runtime host
- ingestion、object storage、registry 写入

当前默认 query-serving knowledge capability 仍是 `knowledge`；它已经不是早期的 bootstrap 占位壳。
