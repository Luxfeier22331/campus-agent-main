# campus-retrieval-core

`packages/retrieval-core` 是 query-only 的 retrieval 与 evidence 获取边界。

它负责：

- 接收 `RetrievalRequest`
- 读取 collection runtime profile 并执行 fail-closed gate
- 通过 Qdrant native hybrid query 获取候选
- 结合 registry truth 返回 `EvidenceBundle`

当前运行语义：

- retrieval 默认只读取 runtime profile 声明的 serving alias
- retrieval 不负责生成 physical collection，也不负责 alias publish
- retrieval 不把对象存储中的任何 release manifest 当作在线 chunk truth

它不负责：

- supervisor / agent 编排
- ingestion、cleanup、chunking 或 index 构建编排
- API transport 或 auth

当前 handbook live baseline 是 `dense + sparse + RRF`，但这个 package 对上游暴露的仍是稳定的 retrieval/evidence 抽象，而不是“bootstrap” 占位实现。
