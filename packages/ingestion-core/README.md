# campus-ingestion-core

`packages/ingestion-core` 承载 `campus-agent` 的 ingestion / data-plane 领域逻辑与
artifact contract helper。它不是 task lifecycle executor。

它负责：

- source bucket / derived bucket object key 语义
- source-truth、projection、document artifact 与 registry 领域语义
- shared file asset loader、chunking 与 materialization strategy helper
- corpus / collection runtime profile helper

当前运行语义：

- task admission、claim / lease、retry、dead-letter 与 closeout 由
  `apps/ingestion-control` 承接
- collection source capture 由 TS collector apps 承接；collector 只输出 source bucket
  artifact pack、run ledger 与 typed handoff object
- Python 只保留需要 Python 生态的 extraction adapter；不得恢复 collection CLI、
  release / alias publish、Qdrant ops 或 cleanup lifecycle

它不负责：

- online query-serving 编排
- Execution Agent Layer 路由
- API transport 或 HTTP host
- task queue / worker lease / dead-letter runtime
- collector scheduling、browser lifecycle 或 Crawlee runner
