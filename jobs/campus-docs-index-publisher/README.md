# Campus Web 文档 RAG 制品任务

该包提供三个彼此独立、由人工触发的命令：

```bash
pnpm --dir jobs/campus-docs-index-publisher build-chunks
pnpm --dir jobs/campus-docs-index-publisher build-embeddings -- --chunk-set sha256:<id>
pnpm --dir jobs/campus-docs-index-publisher publish-index -- \
  --chunk-set sha256:<id> \
  --embedding-set sha256:<id>
```

当前不自动串联三个阶段。每个命令只执行一个阶段，并把下一阶段需要的内容寻址 ID 输出为 JSON。

## 分块阶段

`build-chunks` 读取对象存储固定键 `campus-docs/source.json` 及其当前 reader，执行 reader 质量检查和
`campus_docs_reader_elements.v3` 分块，写入：

- `campus-docs/rag/chunk-data/sha256/<digest>/chunks.ndjson`
- `campus-docs/rag/chunk-sets/sha256/<id>/manifest.json`

manifest 记录精确来源对象、当前文档投影摘要、分块定义、数据对象和数量。该阶段不访问
execution-control、PostgreSQL、Qdrant 或 embedding provider。

## Embedding 阶段

`build-embeddings` 必须显式接收 `--chunk-set`。进程启动后只从
`execution-control-provider-snapshot:8002` 读取一次 `embedding_provider_snapshot.v1`，随后直接调用
该 provider。连接快照只包含 provider、Base URL、model 和 API key；向量维度与
`embedding_space_id` 只来自代码内 `INDEX_DEFINITION`。

可选的 `--reuse-embedding-set sha256:<id>` 是唯一复用入口。任务按
`embedding_space_id + retrievalTextSha256` 复用显式制品中的向量，不扫描对象存储，也不从 Qdrant
读取旧向量。输出为：

- `campus-docs/rag/embedding-data/sha256/<digest>/embeddings.ndjson`
- `campus-docs/rag/embedding-sets/sha256/<id>/manifest.json`

## 发布阶段

`publish-index` 必须显式接收匹配的 chunk set 和 embedding set。它不读取 reader，也不调用 provider；
只校验两个制品，生成完整 points，并写入：

- `campus-docs/rag/indexes/sha256/<id>/manifest.json`
- Qdrant collection `campus_docs_<index-manifest-hex>`

任务完成 point 数、payload 和双向量校验后，重新读取 `source.json` 并比较当前文档投影；投影未变化时
才原子替换 PostgreSQL `campus_docs_serving.current_index`。目标 collection 已存在时先做完整校验；
当前 collection 内容不匹配时停止且不删除，未激活候选发生确定性内容冲突时才删除并重建。

## 不可变写入

NDJSON 使用稳定字段顺序并以换行结尾，manifest 使用规范 JSON 和末尾换行。所有对象都按内容摘要
寻址，并通过 `If-None-Match: *` 执行 create-or-verify：同键同内容视为幂等，不同内容立即失败。不存在
`latest` 指针、构建状态机、自动链式执行或兼容回退。

三个阶段共用现有 derived bucket 写入身份：Chunk 和 Embedding 阶段写入数据及 manifest，Publisher 只为
本次发布写入不可变 index manifest；不创建独立的 Campus Docs 对象存储 Secret。

三个 Kubernetes `CronJob` 均保持 `suspend: true`。使用仓库根命令创建单个阶段 Job：

```bash
pnpm campus-docs:index-job -- --stage chunks
pnpm campus-docs:index-job -- --stage embeddings --chunk-set sha256:<id>
pnpm campus-docs:index-job -- --stage publish \
  --chunk-set sha256:<id> \
  --embedding-set sha256:<id>
```

命令只创建 Job，不等待、不读取日志，也不触发下一阶段。完整操作顺序见
`docs/runbooks/campus-docs.md`。
