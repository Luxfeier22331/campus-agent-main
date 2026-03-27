# campus-ingestion-core

`packages/ingestion-core` 承载 `campus-agent` 的 ingestion / data-plane 主逻辑。

它负责：

- source bucket / derived bucket object key 语义
- raw ingestion、source-truth fan-out、document registry 与 raw-asset registry
- cleanup、chunking、indexable chunk 构建与 Qdrant indexing
- corpus / collection runtime profile 与 rebuild 支撑

它不负责：

- online query-serving 编排
- supervisor / specialist 路由
- API transport 或 HTTP host
