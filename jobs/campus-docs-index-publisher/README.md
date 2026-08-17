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
本地 `build-chunks` 从对象存储只读当前 source 和 reader，把制品写入仓库根目录的 `var/`；它不向
共享 bucket 写入正式候选。该命令从调用进程读取 `OBJECT_STORE_ENDPOINT`、
`OBJECT_STORE_DERIVED_READ_ACCESS_KEY` 和 `OBJECT_STORE_DERIVED_READ_SECRET_KEY`，不读取其他应用的
环境文件。Embedding 和 Publisher 继续消费对象存储中的显式正式制品。

本地 Chunk 入口和集群 `src/cli.ts` 共用同一个 Chunk 命令及领域函数，只替换制品 Store。集群镜像在
构建期生成 JavaScript，可以单独检查生产构建：

```bash
pnpm --dir jobs/campus-docs-index-publisher build
```

运行镜像不包含 TypeScript 源码或 `tsx`。本地只读 `eval-chunks` 不进入集群镜像。

## Chunk 只读评测

在生成正式 chunk set 前，可以只读加载当前来源和 reader，并在内存中运行相同分块实现：

```bash
pnpm --dir jobs/campus-docs-index-publisher eval-chunks
```

该命令使用现有 `OBJECT_STORE_DERIVED_READ_ACCESS_KEY` 和
`OBJECT_STORE_DERIVED_READ_SECRET_KEY`，不暴露对象存储写入方法，不生成 chunk set，也不访问
embedding provider、Qdrant 或 PostgreSQL。默认报告写入
`/tmp/campus-docs-chunk-eval/<source-digest>/report.json` 和 `report.md`。

人工抽样评分和当前文档问题可以分阶段补充：

```bash
pnpm --dir jobs/campus-docs-index-publisher eval-chunks -- \
  --reviews <reviews.json> \
  --query-cases <query-cases.json>
```

`reviews.json` 使用 `{ "reviews": [{ "chunk_id": "...", "critical": false,
"notes": "...", "score": 2 }] }`；`score` 只能是 `0`、`1` 或 `2`。`query-cases.json` 使用
`{ "cases": [{ "case_id": "...", "question": "...", "target_document_id": "...",
"target_root_unit_ids": ["..."], "required_evidence": ["..."], "max_chunk_count": 3 }] }`。
问题评测只检查目标证据是否完整落入有限 chunk，不执行 embedding 或检索排名。

## 分块阶段

`build-chunks` 读取对象存储固定键 `campus-docs/source.json` 及其当前 reader，执行 reader 质量检查和
`campus_docs_reader_elements.v4` 分块，写入：

- `campus-docs/rag/chunk-data/sha256/<digest>/chunks.ndjson`
- `campus-docs/rag/chunk-sets/sha256/<id>/manifest.json`

本地对象键位于仓库根目录 `var/` 下；线上 Chunk Job 使用相同相对键写入现有 derived bucket。
`campus_docs_chunk_set.v2` manifest 记录当前文档投影摘要、分块定义、数据对象和数量；完整
`source.json` 摘要只作为命令诊断输出，不参与 Chunk Set 身份。成功 JSON 同时输出 `source_digest` 和
`source_projection_sha256`。该阶段不访问 execution-control、PostgreSQL、Qdrant 或 embedding provider。

表格 chunk 会携带紧邻且高置信相关的 paragraph、list 或 blockquote：文本以“如下”等表格引导语结尾，
或者包含非表头单元格中的实质词项。不超过 400 字的上下文完整并入表格 chunk，不再生成重复的独立
chunk；超限时保留原正文 chunk，并把最后一个非空行的有界尾段复制到表格。表格拆成多个 chunk 时每个
chunk 都携带同一上下文，并按剩余字符预算重新拆分表格正文。

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
寻址。本地文件 Store 和线上 S3 Store 都执行 create-or-verify：同键同内容视为幂等，不同内容立即
失败；线上使用 `If-None-Match: *`。不存在 `latest` 指针、构建状态机、自动链式执行或兼容回退。

三个线上阶段共用现有 derived bucket 写入身份：Chunk 和 Embedding 阶段写入数据及 manifest，Publisher
只为本次发布写入不可变 index manifest；不创建独立的 Campus Docs 对象存储 Secret。本地 Chunk 制品
不会上传或晋升，正式候选由线上 Chunk Job 使用同一实现重新确定性生成。

三个 Kubernetes `CronJob` 均保持 `suspend: true`。使用仓库根命令创建单个阶段 Job：

```bash
pnpm campus-docs:index-job -- --stage chunks
pnpm campus-docs:index-job -- --stage embeddings --chunk-set sha256:<id>
pnpm campus-docs:index-job -- --stage publish \
  --chunk-set sha256:<id> \
  --embedding-set sha256:<id>
```

命令只创建 Job，不等待、不读取日志，也不触发下一阶段。完整操作顺序见
`docs/runbooks/campus-docs.md`，设计理由见
`docs/decisions/adr-0084-agent-knowledge-tools.md`。
