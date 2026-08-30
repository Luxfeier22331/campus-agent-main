# Campus Docs 索引任务

该包实现 Campus Docs 的 Chunk Set 构建、Embedding Set 构建和 Qdrant collection 发布。三个阶段分别
执行并通过显式内容寻址 ID 交接；该包不采集或清洗来源文档，也不负责环境选择。

## 入口

- `src/local-chunk-cli.ts`、`src/local-embedding-cli.ts`、`src/local-publish-cli.ts`：本地验证入口；
- `src/cli.ts`：Kubernetes Job 使用的阶段入口；
- `src/definitions.ts`：分块、向量空间和 collection 定义。

## 相关文档

- 完整操作步骤：`docs/runbooks/campus-docs.md`
- 索引架构与制品语义：`docs/architecture/system/retrieval-serving.md`
- 文档输入数据：`docs/data/document-reader.md`
