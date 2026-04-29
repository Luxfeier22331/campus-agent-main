# campus-rag-agent

`packages/rag-agent` 是当前已接受的 retrieval-oriented agent 边界。

它负责：

- 接收来自 `apps/supervisor-agent-worker` 的稳定 agent handoff
- 调用 `packages/retrieval-core` 获取 evidence
- 组装基于 evidence 的回答
- 返回 `AgentResponse` 与 confidence

它不负责：

- supervisor 级 routing / policy / audit
- transport / runtime host
- ingestion、object storage、registry 写入

当前默认 query-serving retrieval agent 仍是 `rag-agent`；它已经不是早期的 bootstrap 占位壳。
