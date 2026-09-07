---
doc_type: runbook
owner_boundary: retrieval-serving
status: active
---

# Campus Docs 与 Notices 维护及统一 RAG 发布

## 边界

本文说明如何把整理后的 Campus Web 文档更新到对象存储、刷新静态文档候选，分别构建 Docs/Notice
Chunk 与 Embedding 制品，并由一个统一 serving publisher 发布 Campus RAG 索引。它不负责来源采集、
正文清洗方法、普通运行时发布或环境 Secret 创建。

Docs 的共享输入是对象存储中的 `campus-docs/source.json` 及其引用对象；Notice 的输入是
`notice-publisher` 已发布正文。静态站、Docs builder、Notice builder 和统一 publisher 是独立消费者，
各自产生或消费不可变制品并独立失败；二者之间没有跨系统事务或第二个索引指针。在线 Agent 只通过
`campus_search` 读取已发布的当前 collection。

## 维护规则

`campus_docs_source.v4` 是完整当前期望集合，不是增量补丁。清单、reader、版本和补充对象的字段及
关系以[文档来源与静态交付合同](../contracts/document-reader-delivery.md)为准；本手册只说明操作顺序。
新增或修订对象先上传，再通过来源更新命令写入固定键；删除通过完整清单移除。RAG 只索引当前 reader，
历史 reader 只要仍被清单引用就不能清理。

生命周期 owner 也按阶段区分：来源 owner 管理门户原始对象和来源清单，Campus Web/Campus Docs 数据面
管理仍被清单引用的 normalized reader 与补充资产，Notice 数据面管理已发布正文，Campus RAG serving
管理两类 chunk/embedding 制品、当前 Qdrant collection 和旧 collection。统一 publisher 是
`campus_docs_serving.current_index` 的唯一写入者。对象是否存在于 bucket 不等于仍可删除；本手册中的
清理都是人工核对的明确集合。

## 更新来源

1. 从当前 `campus-docs/source.json` 制作完整候选清单，不从 bucket 列表、修改时间或文件名推断内容。
2. 上传候选清单引用的新 reader、补充数据和图片，记录每个对象的精确 `key`、`byteSize` 和
   `sha256`。
3. 在本地保存候选清单为 `<candidate-source.json>`，检查文档身份、版本选择、公开路径和重定向。
4. 使用写入身份执行完整编译和固定键更新：

```bash
pnpm --dir apps/campus-web docs:source:update -- \
  --source-file <candidate-source.json>
```

命令会规范化清单、读取并核对全部引用、完整编译所有版本，最后才覆盖固定来源键并回读验证。任一步
失败都先修复候选清单或引用对象，不手工覆盖 `source.json`。

## 刷新 Campus Web

来源更新成功后，手动运行 `staging-candidate-publish`，选择
`candidate_scope=campus-web-docs`。该入口重新读取当前固定来源键，构建真实静态文档并上传不可变 Campus
Web Worker version；环境是否选择该 version 仍由环境仓决定。

每个当前版本同时生成普通文档 URL 和 `/v/<versionSlug>` 固定链接。静态构建和 RAG 构建是同一来源的
独立消费者，可以分别运行；任一消费者失败时只修复并重跑所属构建，不回滚已经写入的来源清单。

## 本地 Docs Chunk 与 Embedding 构建

首次在当前 worktree 使用本地任务时，先生成 Campus Docs publisher 自己的环境文件：

```bash
pnpm dev:init -- --target campus-docs-index-publisher
```

该初始化只生成本包 `.env.local`，不执行 migration、bootstrap 或 seed。需要在本地检查正式分块实现时，
使用该文件中的对象存储只读身份生成 Chunk Set：

```bash
pnpm --dir jobs/campus-docs-index-publisher build-chunks
```

命令读取固定来源和当前 reader，执行与线上 Chunk Job 相同的分块及硬校验，并把制品写入当前
worktree 的 `var/campus-docs/rag/`。Chunk identity、reader 元素覆盖、section 边界、root unit 顺序、
`retrievalText` 来源、字符上限或表格单元格覆盖不满足时，命令失败且不写 Chunk Set。该阶段不访问
embedding provider、PostgreSQL 或 Qdrant。

使用输出的 Chunk Set 和当前 worktree 根 `.env` 中的 Provider 连接生成本地 Docs Embedding Set：

```bash
pnpm --dir jobs/campus-docs-index-publisher build-embeddings -- \
  --chunk-set sha256:<chunk-set-id>
```

该命令从当前 worktree 根 `.env` 读取 `EMBEDDING_BASE_URL` 和 `EMBEDDING_API_KEY`，固定使用
`Qwen3-Embedding-4B`，并根据规范化 endpoint 和固定模型合同计算 Model Target hash。它只读写当前
worktree 的 `var/campus-docs/rag/`，不访问 Model Config、execution-control、Ops Web、PostgreSQL、
Qdrant 或集群对象存储。它与线上 Embedding Job 共用制品生成实现；差别只有本地连接和文件 Store。

## 本地 Notice Chunk 与 Embedding 构建

Notice 的 Chunk/Embedding builder 保留在 `notice-index-publisher`，不由 Docs package 重新处理。首次使用
时生成其本地环境文件，并从本地 Notices 数据库生成显式 Chunk Run：

```bash
pnpm dev:init -- --target notice-index-publisher
pnpm --dir jobs/notice-index-publisher build-chunks-local
```

使用输出的 `run` 生成 Notice Embedding Set。命令只读取该显式 Chunk Run；线上版本从 Model Config 读取
一次 `campus_docs_embedding` 连接，本地版本读取当前 worktree 的 embedding 连接：

```bash
NOTICE_CHUNK_RUN=sha256:<chunk-run-id> \
pnpm --dir jobs/notice-index-publisher build-embeddings
```

Notice Chunk Run 使用 `notice_chunk_run.v1`。Embedding Set 只保存向量和显式 Chunk Run 引用；这些阶段不访问
Qdrant、不维护 `current_index`，也不重新生成 Docs 制品。统一 publisher 从 Chunk `retrievalText` 首行生成
Notice title，并由 `noticeId` 生成 `/notices/<noticeId>` citation。

## Chunk 策略治理验证

需要重新验证 Campus Docs 分块策略时，在不改变生产 campus_docs_reader_elements.v5 的前提下，对候选
Chunk Set 运行治理 review：

```bash
pnpm --dir jobs/campus-docs-index-publisher review-chunks-local -- \\
  --chunk-set sha256:<chunk-set-id> \\
  --embedding-evaluation sha256:<embedding-evaluation-id>
```

`--embedding-evaluation` 可省略；提供时只读取既有评测并把全部 evidence Chunk 及其 question/rank
加入审阅项，不重新调用 provider。该步骤读取候选 Chunk Set 及其来源投影，生成全量 census、150 份
文档的确定性覆盖样本、候选信号和 450 个 Chunk 级 `review-items.ndjson`。450 项包含独立元数据与
near-max Chunk、全部 embedding evidence、按配额抽取的表格上下文/短章节/同章节尾块/短表格/
many-root 或 split-reader、100 个无信号对照项和覆盖补齐项。普通分层每份文档最多 4 项，必须全量
纳入的元数据、near-max 和 embedding evidence 不受该上限约束。

逐项检查正文、heading 路径、reader root units 和前后边界，并用以下最小 NDJSON 合同记录判断：

```json
{"chunkId":"chunk_...","verdict":"keep"}
{"action":"upstream-reader","chunkId":"chunk_...","reason":"heading boundary is wrong","verdict":"change"}
```

`change` 的 action 只能是 `drop`、`attach`、`merge`、`split` 或 `upstream-reader`；`keep` 不带 action。
标签可以分批汇总：

```bash
pnpm --dir jobs/campus-docs-index-publisher summarize-chunk-review-labels-local -- \\
  --review-run sha256:<review-run-id> \\
  --labels ../../var/campus-docs/chunk-governance/labels/<name>.ndjson
```

命令会拒绝重复或不属于该 Review Run 的 Chunk ID，并按 primary stratum、candidate signal、verdict 和
action 输出已标注数、未标注数及 change rate。候选信号只是人工审阅索引，不是自动改 Chunk 的规则。

有真实 embedding 连接时，再对固定问题文件执行 dense 检索评测：

```bash
pnpm --dir jobs/campus-docs-index-publisher evaluate-chunks-local -- \\
  --chunk-set sha256:<chunk-set-id> \\
  --questions ../../var/campus-docs/chunk-governance/questions/<name>.ndjson
```

评测从当前 worktree 根 `.env` 读取 `EMBEDDING_BASE_URL` 与 `EMBEDDING_API_KEY`，固定使用
retrievalText、Qwen3-Embedding-4B、2560 维 cosine dense 相似度和 Recall@1/3/5/10；
同时输出 target Chunk、全部 evidence、文档和 single-chunk answer 指标，并按问题 stratum 输出结果。
它使用 retrievalTextSha256 做本地逐文本缓存；相同输入复跑应显示全部缓存复用并保持相同 Run ID。

比较 baseline 与 candidate 时，必须成对提供对应的 Chunk Set 和 Evaluation Run：

```bash
pnpm --dir jobs/campus-docs-index-publisher compare-chunks-local -- \\
  --baseline-chunk-set sha256:<baseline-id> \\
  --candidate-chunk-set sha256:<candidate-id> \\
  --questions ../../var/campus-docs/chunk-governance/questions/<name>.ndjson \\
  --baseline-evaluation sha256:<baseline-evaluation-id> \\
  --candidate-evaluation sha256:<candidate-evaluation-id>
```

比较前会校验两次评测分别引用对应 Chunk Set，并使用同一模型 target、问题文件摘要、embedding 定义、
问题数量和顺序。报告给出结构 delta、evidence placement 状态、整体/分层 embedding delta 以及共同
问题的排名改善和回归计数。来源投影不同的两次 Chunk Set 仍可比较结构，但不比较 evidence placement。

治理产物仅写入当前 worktree 的 var/campus-docs/chunk-governance/；review 输出包括 census、150 份
文档样本、候选信号、450 个 Chunk 审阅项及其摘要。真实问题文件、文档正文和 embedding
向量不提交 Git。review 和 dense 评测用于人工/研究验证，不是 PR 阻断门，也不代表线上 hybrid + reranker
结果；不以短 Chunk 数量单独判断策略优劣。只有候选策略经过结构、广泛抽样和真实 embedding 证据综合
判断后，才另行决定是否生成新的生产 Chunk Set；本次治理不自动切换生产分块定义。

## 本地 Docs Publish 验证

旧 Docs package 的 `publish-index-local` 仅用于本地 Docs-only 实现验证；它不是线上 serving owner，也
不能验证包含 Notice 的统一 collection。命令只读取 `var/` 中的 Docs Embedding/Chunk 制品，不调用
provider，也不向对象存储写入 RAG 制品：

```bash
EXECUTION_CONTROL_DATABASE_URL=postgresql://<local-user>:<local-password>@127.0.0.1:5432/<local-database>?sslmode=disable \
QDRANT_URL=http://127.0.0.1:6333 QDRANT_API_KEY=<local-qdrant-key> \
pnpm --dir jobs/campus-docs-index-publisher publish-index-local -- \
  --embedding-set sha256:<embedding-set-id>
```

首次运行可检查 Docs-only Qdrant collection、全量 point 读回和 `campus_docs_serving.current_index`；同一
制品再次运行可检查 `no_op: true`。该命令服务本地兼容实现验证，不是触发线上统一 Publisher Job 的
前置状态。统一 Publisher 的生产验证使用两个线上 Embedding Set，按下节的 Job 顺序执行。

## 本地统一 RAG 发布验证

统一 Publisher 的本地验证使用与生产相同的组装、Qdrant 校验和 `current_index` 激活逻辑。验证前从集群
derived object store 导入两个 Embedding Set 的 serving 引用闭包到当前 worktree 的隔离本地 bucket。它只验证
发布阶段，不运行 Chunk、Embedding、provider 或在线查询。

先确保本地 Qdrant Compose 服务已启动，再初始化当前 worktree 的 publisher 环境和本地 schema。
publisher 初始化从运行中的容器取得 writer key 和 HTTP 映射端口，完成认证检查后生成环境文件：

```bash
pnpm dev:init -- --target campus-rag-index-publisher
pnpm dev:init -- --target notice-index-publisher
```

从集群导入本次两个 Embedding Set：

```bash
pnpm --dir jobs/campus-rag-index-publisher import-artifacts-local -- \
  --namespace campus-agent-staging \
  --context <kubectl-context> \
  --docs-embedding-set sha256:<docs-embedding-set-id> \
  --notice-embedding-set sha256:<notice-embedding-set-id>
```

导入器只复制两个 Embedding Set 实际引用的 serving immutable 对象，保持生产 object key，不复制整个 bucket，
也不写入集群 bucket。

运行验证：

```bash
pnpm --dir jobs/campus-rag-index-publisher publish-index-local -- \
  --docs-embedding-set sha256:<docs-embedding-set-id> \
  --notice-embedding-set sha256:<notice-embedding-set-id>
```

命令会读取并校验 serving 所需的两条 artifact chain，创建并校验混合 Docs/Notice collection，然后激活
`campus_docs_serving.current_index`。成功后检查输出的 `collection`、`point_count` 和 `no_op`，并在本地
数据库确认 current binding；使用相同两个 ID 重跑应返回 `no_op: true`。缺少或篡改任一引用对象时必须
失败且不改变 current binding。

本地 publisher 的 `.env.local` 使用当前 worktree 的隔离本地 S3 bucket 和 writer 凭据；`publish-index-local`
只读取该 bucket，不回退到 filesystem。没有两套已完成且格式符合合同的 Embedding Set 时，停止发布
验证，不在该命令中重新生成 embedding。

## RAG 制品

本地 Docs Chunk 命令只读对象存储中的当前 source 和 reader，本地 Docs Embedding 命令只读本地 Docs
Chunk Set；Notice builder 则从已发布 Notice 快照生成 Chunk Run，再生成 Notice Embedding Set。各自按
领域定义的相对布局写入当前 worktree 的 `var/`。这些文件用于本地检查，不是线上候选，也不通过上传
进入下一阶段。线上两个 builder 将同一制品合同写入 derived bucket，所有正式对象都按内容寻址。

NDJSON 和 manifest 都使用规范序列化并以换行结尾。写入使用 `If-None-Match: *`；同键同内容是幂等
重跑，不同内容是错误。系统不维护 `latest` 制品指针，下一阶段必须显式接收上一阶段输出的
`sha256:<id>`。

四个 builder Job 使用现有 derived bucket 身份。Docs/Notice Chunk 和 Embedding Job 写入各自的数据与
manifest；统一 Publisher 只读取显式 Docs/Notice Embedding Set，组装一个同时包含两类 point 的 Qdrant
collection，并写入当前指针。Publisher 不写入新的对象存储制品，不访问 Notices DB 或 embedding provider，
也不创建单独的 serving artifact Secret。

## 手动执行

`CronJob/campus-docs-chunk-builder`、`campus-docs-embedding-builder`、`notice-chunk-builder`、
`notice-embedding-builder` 和 `campus-rag-index-publisher` 各自保存一个完整阶段的 Pod 模板，必须保持
`suspend: true`，不得通过解除暂停执行。维护者只使用 `kubectl` 从模板创建一次性 Job；Embedding 和
Publisher 的内容寻址输入只写入本次 Job，不保存到 CronJob、ConfigMap 或 Secret。每个 Job 不等待或触发
下一阶段。

### 1. 构建 Docs Chunk Set

```bash
kubectl -n <namespace> create job \
  --from=cronjob/campus-docs-chunk-builder <job-name>
```

等待并读取该 Job 日志。成功 JSON 包含 `chunk_set`、`chunk_count`、`document_count`、
`source_digest` 和 `source_projection_sha256`。`source_digest` 只用于诊断，Chunk Set 身份由有效当前
文档投影、分块定义和实际 Chunk 数据形成。下一阶段显式使用日志返回的 `chunk_set`。

该 Job 只访问来源、reader 和 derived bucket，不访问 execution-control、PostgreSQL、Qdrant 或
embedding provider。

### 2. 构建 Docs Embedding Set

```bash
kubectl -n <namespace> create job \
  --from=cronjob/campus-docs-embedding-builder <job-name> \
  --dry-run=client -o yaml |
kubectl set env --local -f - \
  CAMPUS_DOCS_CHUNK_SET=sha256:<chunk-set-id> -o yaml |
kubectl -n <namespace> create -f -
```

需要显式复用既有向量时才增加：

```bash
kubectl -n <namespace> create job \
  --from=cronjob/campus-docs-embedding-builder <job-name> \
  --dry-run=client -o yaml |
kubectl set env --local -f - \
  CAMPUS_DOCS_CHUNK_SET=sha256:<chunk-set-id> \
  CAMPUS_DOCS_REUSE_EMBEDDING_SET=sha256:<embedding-set-id> -o yaml |
kubectl -n <namespace> create -f -
```

Embedding Job 启动后从 `model-config:8000` 一次读取 `campus_docs_embedding` 完整配置并直接调用
provider。该连接由 Ops Web 通过 Model Config 管理；Job 不接收 provider Base URL、model 或 API key
环境变量，也没有独立 provider Secret。每个请求固定发送 8 条文本，同时最多执行 8 个请求。

复用只按 `spaceId + dimensions + retrievalTextSha256` 从显式 embedding set 读取，不扫描 bucket，也
不从 Qdrant 读取向量。Embedding Set 不保存 provider、endpoint、model alias 或调用参数。成功 JSON
包含 `embedding_set`、`embedding_count`、
`reused_embedding_input_count` 和 `generated_embedding_input_count`。Embedding Set v3 同时记录
Model Target hash；该 hash 直接来自完整配置响应。只有 hash 与检索文本合同都匹配时才能复用。
Publisher 显式使用日志返回的
`embedding_set`。`campus_docs_embedding_set.v1` 已退役，不能作为 `--reuse-embedding-set` 输入。

### 3. 构建 Notice Chunk Run

在 ingestion runtime 中从已发布 Notice 的 repeatable-read 快照生成 Chunk Run：

```bash
kubectl -n <namespace> create job \
  --from=cronjob/notice-chunk-builder <job-name>
```

成功日志包含 `chunk_run`、`chunk_count` 和 `notice_count`。该 Job 读取 Notices 数据库并写入 derived bucket，
但不访问 Qdrant 或 `current_index`；review sample 和 validation 仅供离线诊断。

### 4. 构建 Notice Embedding Set

```bash
kubectl -n <namespace> create job \
  --from=cronjob/notice-embedding-builder <job-name> \
  --dry-run=client -o yaml |
kubectl set env --local -f - \
  NOTICE_CHUNK_RUN=sha256:<chunk-run-id> -o yaml |
kubectl -n <namespace> create -f -
```

Notice Embedding Job 只读取显式 Chunk Run，从 Model Config 一次读取 `campus_docs_embedding`，按
`retrievalTextSha256` 复用显式可验证 cache 或调用 provider，最后写入 `notice_embedding_set.v1`。
它不访问 Qdrant、`current_index` 或 Docs reader。

### 5. 发布统一 Campus RAG Index

```bash
kubectl -n <namespace> create job \
  --from=cronjob/campus-rag-index-publisher <job-name> \
  --dry-run=client -o yaml |
kubectl set env --local -f - \
  CAMPUS_DOCS_EMBEDDING_SET=sha256:<docs-embedding-set-id> \
  CAMPUS_NOTICE_EMBEDDING_SET=sha256:<notice-embedding-set-id> -o yaml |
kubectl -n <namespace> create -f -
```

统一 Publisher 只读取两个显式 Embedding Set，并从各自 manifest 解析 Docs Chunk Set 和 Notice Chunk
Run；不读取 reader、不连接 Notices 数据库，也不调用 embedding provider。它把两套已生成向量组装为一个
混合 Docs/Notice collection，Docs point 使用 `source_kind=document`，Notice point 使用
`source_kind=notice`，Notice citation 固定为 `/notices/<noticeId>`。Qdrant collection 后缀由两个
Embedding Set ID 与当前 Collection Definition 的规范 JSON 摘要形成：

```text
campus_docs_<sha256>
```

Publisher 写入并完整校验 Qdrant points 后，原子替换 PostgreSQL `campus_docs_serving.current_index`。成功
JSON 包含 `collection`、`point_count` 和
`no_op`。Publisher 是该 current pointer 的唯一写入者，复用 `execution_control` 数据库连接，不创建
独立 role、DSN 或数据库 Secret。

PostgreSQL advisory lock 只保护发布阶段的当前绑定替换。同一时刻已有 Publisher 时，新 Publisher Job
立即失败；Chunk 和 Embedding 阶段不使用该锁。

查看任一阶段结果时，由操作者对刚创建的 Job 执行：

```bash
kubectl -n <namespace> wait --for=condition=complete --timeout=65m job/<job-name>
kubectl -n <namespace> logs job/<job-name> --all-containers=true
```

日志输出阶段开始、低频进度和最终 JSON，也是取得下一阶段内容寻址 ID 的入口。Job 完成或失败后保留
24 小时再由 Kubernetes 自动删除；
CronJob 的任务历史设置不管理由上述命令创建的独立 Job。

## 验证与失败处理

- Docs reader、摘要或清单关系无效：修复来源对象或候选清单，重新运行 Docs Chunk Job；
- Notice Chunk Run 或其 serving 数据无效：修复已发布 Notice 或 Notice builder 输入，重新运行
  Notice Chunk Job；
- provider 快照或 embedding 调用失败：当前索引不变；修复 Model Config 中的连接并重新运行对应
  Embedding Job；已有合法向量可按显式复用合同复用；
- 任一 Embedding Set 或其 Chunk 制品引用无效：统一 Publisher 在写 Qdrant 前失败，使用正确的两个
  Embedding Set ID 重跑；
- 新 collection 写入或校验失败：统一 Publisher 删除本次新建 collection，
  当前绑定不变；
- 目标 collection 已存在但内容不匹配：Publisher 停止且不删除该 collection；
- 目标 collection 已存在且内容完整：重跑会完成验证并尝试激活；
- 数据库激活返回错误：保留已验证 collection，直接重跑同一 Docs/Notice Embedding Set ID；若上次提交
  已成功，激活返回 `no_op: true`，否则完成当前指针替换。

Embedding 设置可以在首次索引发布前保存和验证。配置验证使用固定 Embedding 合同并记录 provider
返回的观测维度。离线分块、向量和 collection 定义发生变化时，必须用同一版本重新生成并发布
collection；已发布的当前 collection 由 `campus_search` 按需消费。

## Reader 清理

对象存储清理是人工治理操作，不由制品 Job 执行，也不在仓库保存通用清理程序。

1. 紧接清理前重新读取并校验当前 `source.json`。
2. 从所有 reader、补充对象和补充图片引用计算完整存活 key 集合。
3. 枚举目标前缀的全部对象版本和 delete marker；只把不在存活集合中的 key 放入待删除集合。
4. 人工核对待删除对象的格式、前缀、数量和来源批次。集合与预期不完全一致时停止。
5. bucket 开启版本控制，因此使用管理员身份删除待删除 key 的所有具体 `VersionId` 和 delete marker；
   只写普通 delete marker 不会回收存储。
6. 清理后重新读取当前清单，并按 `byteSize` 和 `sha256` 核对全部存活对象。

清理期间来源摘要发生变化时，丢弃待删除集合并从第一步重新计算。不得删除仍被历史版本引用的 reader。

## Qdrant 清理

旧 collection 不在激活时自动删除，保留它作为回滚候选。当前在线 execution-control 不读取 collection，
也不会在运行准入中冻结它。人工删除前必须：

1. 从 `campus_docs_serving.current_index` 读取当前 collection，永不删除当前值；
2. 确认没有正在运行的 Campus RAG Publisher Job 使用待删除 collection；
3. 使用 Qdrant 管理凭据删除明确列出的非当前 collection，并再次确认当前 collection 可读取。

仓库不维护 collection 历史表、保留状态机或自动回收任务。每次清理只处理本次明确核对的集合。

## 相关文档

- [检索服务](../architecture/system/retrieval-serving.md)
- [文档站架构](../architecture/system/document-site.md)
- [文档来源与静态交付合同](../contracts/document-reader-delivery.md)
- [文档阅读器数据模型](../data/document-reader.md)
