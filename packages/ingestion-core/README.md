# campus-ingestion-core

`packages/ingestion-core` 承载 `campus-agent` 的 ingestion / data-plane 主逻辑。

它负责：

- source bucket / derived bucket object key 语义
- raw ingestion、source-truth fan-out、document registry 与 raw-asset registry
- cleanup、chunking、indexable chunk 构建与 Qdrant indexing
- corpus / collection runtime profile 与 rebuild 支撑

当前运行语义：

- runtime profile 只声明 serving alias、collection prefix 与 vector binding
- ingestion 侧写入 versioned physical collection：`<collection_prefix>__<release_id>`
- validation 通过后由 ingestion 发布 serving alias
- derived bucket 只保留 source/document artifact 与 release manifest，不保留 chunk dump

它不负责：

- online query-serving 编排
- supervisor / specialist 路由
- API transport 或 HTTP host
