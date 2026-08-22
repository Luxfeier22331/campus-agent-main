# Campus Web 文档 RAG 制品任务

该包把 Chunk Set、Embedding Set 和 Qdrant 发布拆成三个彼此独立的阶段。本地开发可以生成前两个
内容寻址制品：

```bash
pnpm --dir jobs/campus-docs-index-publisher build-chunks
EMBEDDING_API_KEY=... pnpm --dir jobs/campus-docs-index-publisher build-embeddings -- \
  --chunk-set sha256:<id> \
  --base-url https://provider.example/v1
```

当前不自动串联三个阶段。每个命令只执行一个阶段，并把下一阶段需要的内容寻址 ID 输出为 JSON。本地
`build-chunks` 从对象存储只读当前 source 和 reader；`build-embeddings` 只读本地 Chunk Set，直接调用
显式传入的 OpenAI-compatible endpoint。两者都把制品写入仓库根目录的 `var/`，不向共享 bucket 写入
正式候选。`publish-index-local` 从 `var/` 读取 Embedding Set，使用本地 PostgreSQL/Qdrant，并从
本地对象存储重新读取当前 source projection；它不调用 embedding provider，也不写入对象存储。Chunk
命令从调用进程读取 `OBJECT_STORE_ENDPOINT`、
`OBJECT_STORE_DERIVED_READ_ACCESS_KEY` 和 `OBJECT_STORE_DERIVED_READ_SECRET_KEY`，不读取其他应用的
环境文件；Embedding 命令只读取 `EMBEDDING_API_KEY` 和 `--base-url`，正式构建固定使用
`Qwen3-Embedding-4B`；纯离线 embedding CLI 不访问 Model Config、execution-control、Ops Web 或
PostgreSQL，而显式接收 Model Target hash。本地 Publish 使用现有 `EXECUTION_CONTROL_DATABASE_URL`、
`QDRANT_URL` 和 `QDRANT_API_KEY` 连接合同。

本地 Chunk/Embedding 入口与集群 `src/cli.ts` 共用相同领域函数，只替换 Store 和 Embedding 连接组装。
集群镜像在构建期生成 JavaScript，可以单独检查生产构建：

```bash
pnpm --dir jobs/campus-docs-index-publisher build
```

运行镜像不包含 TypeScript 源码或 `tsx`。

## 分块阶段

`build-chunks` 读取对象存储固定键 `campus-docs/source.json` 及其当前 reader，执行 reader 质量检查和
`campus_docs_reader_elements.v4` 分块，写入：

- `campus-docs/rag/chunk-data/sha256/<digest>/chunks.ndjson`
- `campus-docs/rag/chunk-sets/sha256/<id>/manifest.json`

本地对象键位于仓库根目录 `var/` 下；线上 Chunk Job 使用相同相对键写入现有 derived bucket。
`campus_docs_chunk_set.v2` manifest 记录当前文档投影摘要、分块定义、数据对象和数量；完整
`source.json` 摘要只作为命令诊断输出，不参与 Chunk Set 身份。成功 JSON 同时输出 `source_digest` 和
`source_projection_sha256`。写入前会校验 Chunk identity、reader 元素覆盖、section 边界、root unit
顺序、`retrievalText` 来源、字符上限和表格单元格覆盖；任一不变量失败时不产出 Chunk Set。该阶段不
访问 execution-control、PostgreSQL、Qdrant 或 embedding provider。

表格 chunk 会携带紧邻且高置信相关的 paragraph、list 或 blockquote：文本以“如下”等表格引导语结尾，
或者包含非表头单元格中的实质词项。不超过 400 字的上下文完整并入表格 chunk，不再生成重复的独立
chunk；超限时保留原正文 chunk，并把最后一个非空行的有界尾段复制到表格。表格拆成多个 chunk 时每个
chunk 都携带同一上下文，并按剩余字符预算重新拆分表格正文。

## Embedding 阶段

本地 `build-embeddings` 必须显式接收 `--chunk-set`。本地命令从 `var/` 读取 Chunk Set，并通过
`--base-url` 和 `EMBEDDING_API_KEY` 直接调用 provider，模型固定为 `Qwen3-Embedding-4B`；线上 Embedding
Job 从 `model-config:8000` 一次读取 `campus_docs_embedding` 完整配置并直接调用该连接。每个 HTTP 请求
固定包含 8 条文本，同时最多执行 8 个请求。

`campus_docs_embedding_set.v3` 记录所引用的 Chunk Set、Model Target hash、向量数量、Embedding 数据对象，以及固定的
`spaceId` 和 dimensions。provider、Base URL、model alias、API key、批大小和并发数均不进入制品。
向量空间由代码内 `EMBEDDING_SPACE` 定义。v1 reader 已退役，旧 Embedding Set 不能作为生成或复用
输入。

可选的 `--reuse-embedding-set sha256:<id>` 是唯一复用入口。任务按
`spaceId + dimensions + retrievalTextSha256` 复用显式制品中的向量，不扫描对象存储，也不从 Qdrant
读取旧向量。输出为：

- `campus-docs/rag/embedding-data/sha256/<digest>/embeddings.ndjson`
- `campus-docs/rag/embedding-sets/sha256/<id>/manifest.json`

## 发布阶段

本地发布入口显式接收 `--embedding-set`；线上 `publish-index` 从本次 Job 的
`CAMPUS_DOCS_EMBEDDING_SET` 读取同一标识。发布阶段从 manifest 解析唯一 Chunk Set，不读取 reader，也不调用
provider；只校验制品链、生成完整 points，并写入 Qdrant collection。collection 名由显式 Embedding
Set ID 与 `COLLECTION_DEFINITION` 的规范 JSON SHA-256 形成，不另行生成索引制品。

`CHUNK_SET_DEFINITION`、`EMBEDDING_SPACE` 和 `COLLECTION_DEFINITION` 分别拥有分块、向量空间和 Qdrant
查询/point 定义，不再维护混合的总索引定义。

任务完成 point 数、payload 和双向量校验后，重新读取 `source.json` 并比较当前文档投影；投影未变化时
才原子替换 PostgreSQL `campus_docs_serving.current_index`。目标 collection 已存在时先做完整校验；
内容不匹配时停止且不删除。仅当本次新建 collection 的写入、校验或来源复核失败时删除该 collection；
数据库激活报错后保留已验证 collection，重跑同一 Embedding Set 完成状态确认或激活。

本地生成 Embedding Set 后，在本地真实 Qdrant 上执行同一发布函数：

```bash
EXECUTION_CONTROL_DATABASE_URL=postgresql://<local-user>:<local-password>@127.0.0.1:5432/<local-database>?sslmode=disable \
QDRANT_URL=http://127.0.0.1:6333 QDRANT_API_KEY=<local-qdrant-key> \
pnpm --dir jobs/campus-docs-index-publisher publish-index-local -- \
  --embedding-set sha256:<embedding-set-id>
```

本地运行可以检查 collection 配置、完整 point 校验和 `current_index` 激活；对同一 Embedding Set
重复运行可以检查 `no_op: true`。本地验证不形成线上 Publisher Job 的前置状态。

## 不可变写入

NDJSON 使用稳定字段顺序并以换行结尾，manifest 使用规范 JSON 和末尾换行。所有对象都按内容摘要
寻址。本地文件 Store 和线上 S3 Store 都执行 create-or-verify：同键同内容视为幂等，不同内容立即
失败；线上使用 `If-None-Match: *`。不存在 `latest` 指针、构建状态机、自动链式执行或兼容回退。

三个线上阶段共用现有 derived bucket 身份：Chunk 和 Embedding 阶段写入数据及 manifest，Publisher
只读取显式制品并写入 Qdrant/当前 collection 指针；不创建独立的 Campus Docs 对象存储 Secret。本地
Chunk 和 Embedding 制品不会上传或晋升，正式候选由线上 Job 使用相同实现重新生成。

三个 Kubernetes `CronJob` 均保持 `suspend: true`，且各自固定一个完整阶段命令。线上操作不依赖仓库或
pnpm；Chunk Job 可以直接从模板创建，Embedding 和 Publisher 只通过 `kubectl set env --local` 注入本次
制品标识：

```bash
kubectl -n <namespace> create job \
  --from=cronjob/campus-docs-chunk-builder <job-name>

kubectl -n <namespace> create job \
  --from=cronjob/campus-docs-embedding-builder <job-name> \
  --dry-run=client -o yaml |
kubectl set env --local -f - CAMPUS_DOCS_CHUNK_SET=sha256:<id> -o yaml |
kubectl -n <namespace> create -f -

kubectl -n <namespace> create job \
  --from=cronjob/campus-docs-index-publisher <job-name> \
  --dry-run=client -o yaml |
kubectl set env --local -f - CAMPUS_DOCS_EMBEDDING_SET=sha256:<id> -o yaml |
kubectl -n <namespace> create -f -
```

需要复用向量时，在 Embedding 的 `kubectl set env` 命令中同时设置
`CAMPUS_DOCS_REUSE_EMBEDDING_SET=sha256:<id>`。每个 Job 只执行自己的阶段，不触发下一阶段。完整操作顺序见
`docs/runbooks/campus-docs.md`，设计理由见
`docs/decisions/adr-0084-agent-knowledge-tools.md`。
