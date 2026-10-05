# Campus Docs Chunk 与 Embedding 任务

该包实现 Campus Docs 的 Chunk Set、Embedding Set 构建和离线评测。serving 发布由 `jobs/campus-rag-index-publisher` 的统一 publisher 负责；
该包不采集或清洗来源文档，也不负责环境选择。

## 入口

- `src/local-chunk-cli.ts`、`src/local-embedding-cli.ts`：本地 Docs 验证入口；
- `src/cli.ts`：Kubernetes Docs builder 阶段入口；
- `src/definitions.ts`：Docs 分块和向量空间定义。生产统一 collection 定义属于 unified publisher。

```bash
pnpm --dir jobs/campus-docs-index-publisher build-chunks
pnpm --dir jobs/campus-docs-index-publisher build-embeddings -- \
  --chunk-set sha256:<id>
```

当前不自动串联两个 builder 阶段。每个命令只执行一个阶段，并把下一阶段需要的内容寻址 ID 输出为 JSON。本地
`build-chunks` 从对象存储只读当前 source 和 reader；`build-embeddings` 只读本地 Chunk Set，直接调用
根 `.env` 中的 OpenAI-compatible endpoint。两者都把制品写入仓库根目录的 `var/`，不向共享 bucket 写入
正式候选。Chunk
命令从调用进程读取 `OBJECT_STORE_ENDPOINT`、
`OBJECT_STORE_DERIVED_READ_ACCESS_KEY` 和 `OBJECT_STORE_DERIVED_READ_SECRET_KEY`，不读取其他应用的
环境文件；Embedding 命令通过当前 worktree 根 `.env` 读取 `EMBEDDING_BASE_URL` 和
`EMBEDDING_API_KEY`，正式构建固定使用 `Qwen3-Embedding-4B`；纯离线 embedding CLI 不访问 Model
Config、execution-control、Ops Web 或 PostgreSQL，并根据规范化 endpoint 和固定模型合同计算 Model
Target hash。本地 Publish 使用现有 `EXECUTION_CONTROL_DATABASE_URL`、
`QDRANT_URL` 和 `QDRANT_API_KEY` 连接合同。

linked worktree 首次使用本包前执行一次：

```bash
pnpm dev:init -- --target campus-docs-index-publisher
```

该 target 生成本包的 `.env.local`，但不执行 migration 或应用 bootstrap。Chunk、review 和 local publish
读取本包 `.env.local`；embedding 和 embedding evaluation 读取当前 worktree 根 `.env`。进程环境优先于
`.env`，因此可在一次显式命令中覆盖本地 provider 连接。

本地 Docs Chunk/Embedding 入口与集群 `src/cli.ts` 共用相同领域函数，只替换 Store 和 Embedding 连接组装。
集群镜像在构建期生成 JavaScript，可以单独检查生产构建：

```bash
pnpm --dir jobs/campus-docs-index-publisher build
```

运行镜像不包含 TypeScript 源码或 `tsx`。

## 分块阶段

`build-chunks` 读取 Campus Web 从 Git 声明自动生成的固定键 `campus-docs/source.json` 及其当前 reader，执行 reader 质量检查和
`campus_docs_reader_elements.v5` 分块，写入：

- `campus-docs/rag/chunk-data/sha256/<digest>/chunks.ndjson`
- `campus-docs/rag/chunk-sets/sha256/<id>/manifest.json`

本地对象键位于仓库根目录 `var/` 下；线上 Chunk Job 使用相同相对键写入现有 derived bucket。
`campus_docs_chunk_set.v2` manifest 记录当前文档投影摘要、分块定义、数据对象和数量；完整
`source.json` 摘要只作为命令诊断输出，不参与 Chunk Set 身份。成功 JSON 同时输出 `source_digest` 和
`source_projection_sha256`。写入前会校验 Chunk identity、可索引 reader 元素覆盖、section 边界、root unit
顺序、`retrievalText` 来源、字符上限和表格单元格覆盖；任一不变量失败时不产出 Chunk Set。该阶段不
访问 execution-control、PostgreSQL、Qdrant 或 embedding provider。

v5 继续使用 800 Unicode 字符软目标、1600 字符硬上限和零重叠，并增加以下边界治理：同一 section
相邻 Chunk 任一侧短于 200 字且合并后不超上限时回并，不跨 heading、表格或“专业毕业要求：”硬边界；
形如 `> Source URL: https://...` 的独立来源段落不生成 evidence Chunk；文档开头连续的审批/修订日期和
文号附着到同一 preamble 的首个正文 Chunk，后续直接进入 heading 时不跨 section 附着；独立短段落
“<专业名>专业毕业要求：”在其前强制切分，并与后续要求正文进入新 Chunk。普通冒号结尾段落不触发
该硬边界。

表格 chunk 会携带紧邻且高置信相关的 paragraph、list 或 blockquote：文本以“如下”等表格引导语结尾，
或者包含非表头单元格中的实质词项。不超过 400 字的上下文完整并入表格 chunk，不再生成重复的独立
chunk；超限时保留原正文 chunk，并把最后一个非空行的有界尾段复制到表格。表格拆成多个 chunk 时每个
chunk 都携带同一上下文，并按剩余字符预算重新拆分表格正文。

## Chunk 治理与策略验证

治理入口与生产分块共用本包实现，读取显式 Chunk Set，不自动改写生产定义或索引绑定。
审阅、标签汇总、同题集真实 Embedding 评测与对比的操作、路径解析和结果解释统一见
[Chunk 策略治理验证](../../docs/runbooks/ingestion/campus-docs.md#chunk-策略治理验证)。
这些本地诊断不是 PR gate，也不代表线上 hybrid 与 reranker 效果。

## Embedding 阶段

本地 `build-embeddings` 必须显式接收 `--chunk-set`。本地命令从 `var/` 读取 Chunk Set，并从当前
worktree 根 `.env` 读取 `EMBEDDING_BASE_URL` 与 `EMBEDDING_API_KEY`，直接调用 provider；模型固定为
`Qwen3-Embedding-4B`，Model Target hash 由规范化 endpoint 和固定模型合同计算。线上 Embedding Job
从 `model-config:8000` 一次读取 `campus_docs_embedding` 完整配置并直接调用该连接。每个 HTTP 请求固定
包含 8 条文本，同时最多执行 8 个请求。

`campus_docs_embedding_set.v3` 记录所引用的 Chunk Set、Model Target hash、向量数量、Embedding 数据对象，以及固定的
`spaceId` 和 dimensions。provider、Base URL、model alias、API key、批大小和并发数均不进入制品。
向量空间由代码内 `EMBEDDING_SPACE` 定义。v1 reader 已退役，旧 Embedding Set 不能作为生成或复用
输入。

可选的 `--reuse-embedding-set sha256:<id>` 是唯一复用入口。任务按
`spaceId + dimensions + retrievalTextSha256` 复用显式制品中的向量，不扫描对象存储，也不从 Qdrant
读取旧向量。输出为：

- `campus-docs/rag/embedding-data/sha256/<digest>/embeddings.ndjson`
- `campus-docs/rag/embedding-sets/sha256/<id>/manifest.json`

## 生产 serving 边界

本包没有生产 `publish-index` CLI，也没有生产 Docs-only publisher CronJob。Docs Embedding Set 由本包
输出后，必须与 Notice Embedding Set 一起交给
`jobs/campus-rag-index-publisher`。统一 publisher 从两个 manifest 解析各自的 Chunk Set/Chunk Run，
不读取 reader、不调用 embedding provider，并将 Docs (`source_kind=document`) 与 Notice
(`source_kind=notice`) points 组装到同一个 `campus_docs_<sha256>` collection。

Notice citation 由 Notice Chunk Run v1 的 `noticeId` 固定生成，形如 `/notices/<noticeId>`；统一 publisher
不连接 live Notices DB。它拥有 `campus_docs_serving.current_index` 的激活逻辑。
检索数据初始化使用根 `dev:local data seed --domain retrieval` 或 `dev:local data sync --domain retrieval` 并复用该逻辑；显式制品发布使用统一 RAG publisher。

统一 publisher 在完成 point 数、payload 和双向量校验后原子替换 PostgreSQL `campus_docs_serving.current_index`。
目标 collection 已存在时先做完整校验；内容不匹配时停止且不删除。仅当本次新建 collection 的写入或校验失败时删除该 collection；
数据库激活报错后保留已验证 collection，重跑同一 Docs/Notice Embedding Set 完成状态确认或激活。

## 不可变写入

NDJSON 使用稳定字段顺序并以换行结尾，manifest 使用规范 JSON 和末尾换行。所有对象都按内容摘要
寻址。本地文件 Store 和线上 S3 Store 都执行 create-or-verify：同键同内容视为幂等，不同内容立即
失败；线上使用 `If-None-Match: *`。不存在 `latest` 指针、构建状态机、自动链式执行或兼容回退。

两个 Docs builder 阶段共用现有 derived bucket 身份并写入数据及 manifest；统一 Publisher
只读取显式 Docs/Notice 制品并写入 Qdrant/当前 collection 指针；不创建独立的 Campus Docs 对象存储 Secret。本地
Chunk 和 Embedding 制品不会上传或晋升，正式候选由线上 Job 使用相同实现重新生成。

Docs 的两个 Kubernetes `CronJob` 均保持 `suspend: true`，且各自固定一个 builder 命令。统一 Publisher
的执行模板属于 execution runtime；线上操作不依赖仓库或 pnpm。Docs builder 的输入只通过本次 Job
环境注入：

```bash
kubectl -n <namespace> create job \
  --from=cronjob/campus-docs-chunk-builder <job-name>

kubectl -n <namespace> create job \
  --from=cronjob/campus-docs-embedding-builder <job-name> \
  --dry-run=client -o yaml |
kubectl set env --local -f - CAMPUS_DOCS_CHUNK_SET=sha256:<id> -o yaml |
kubectl -n <namespace> create -f -

```

需要复用向量时，在 Docs Embedding 的 `kubectl set env` 命令中同时设置
`CAMPUS_DOCS_REUSE_EMBEDDING_SET=sha256:<id>`。每个 Job 只执行自己的阶段，不触发下一阶段。Notice
builder 和统一 Publisher 的完整操作顺序见 [Campus Docs 与 Notices 操作手册](../../docs/runbooks/ingestion/campus-docs.md)。

## 相关文档

- 完整操作步骤：[Campus Docs 与 Notices 操作手册](../../docs/runbooks/ingestion/campus-docs.md)
- 索引架构与制品语义：[检索服务](../../docs/architecture/system/retrieval-serving.md)
- 文档输入数据：[阅读器数据](../../docs/data/document-reader.md)
- 设计理由：[机构知识决策](../../.agents/notes/implemented/architecture/2026-07-29-agent-knowledge-tools.md)
