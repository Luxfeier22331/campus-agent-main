---
doc_type: runbook
owner_boundary: retrieval-serving
status: active
---

# Campus Docs 维护与索引发布

## 边界

本文说明如何把整理后的 Campus Web 文档更新到对象存储、刷新静态文档候选，并按三个独立阶段手动
构建 Campus Docs 检索索引。它不负责来源采集、正文清洗方法、普通运行时发布或环境 Secret 创建。

共享输入只有对象存储中的 `campus-docs/source.json` 及其引用对象。Campus Web 静态构建和 Campus Docs
RAG 制品和 Campus Web 静态站是两个独立消费者，各自产生不可变产物并独立失败；二者之间没有跨系统
事务或第二个文档版本指针。在线 Agent 只通过 `campus_search` 读取已发布的当前 collection。

## 维护规则

`campus_docs_source.v3` 是完整当前期望集合，不是增量补丁。清单、reader、版本和补充对象的字段及
关系以[文档来源与静态交付合同](../contracts/document-reader-delivery.md)为准；本手册只说明操作顺序。
新增或修订对象先上传，再通过来源更新命令写入固定键；删除通过完整清单移除。RAG 只索引当前 reader，
历史 reader 只要仍被清单引用就不能清理。

生命周期 owner 也按阶段区分：来源 owner 管理门户原始对象和来源清单，Campus Web/Campus Docs 数据面
管理仍被清单引用的 normalized reader 与补充资产，Campus Docs serving 管理 chunk/embedding 制品和
当前 Qdrant collection。对象是否存在于 bucket 不等于仍可删除；本手册中的清理都是人工核对的明确集合。

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

## 本地 Chunk 与 Embedding 构建

需要在本地检查正式分块实现时，使用当前对象存储的只读身份生成 Chunk Set：

```bash
pnpm --dir jobs/campus-docs-index-publisher build-chunks
```

命令读取固定来源和当前 reader，执行与线上 Chunk Job 相同的分块及硬校验，并把制品写入当前
worktree 的 `var/campus-docs/rag/`。Chunk identity、reader 元素覆盖、section 边界、root unit 顺序、
`retrievalText` 来源、字符上限或表格单元格覆盖不满足时，命令失败且不写 Chunk Set。该阶段不访问
embedding provider、PostgreSQL 或 Qdrant。

使用输出的 Chunk Set 和显式 Provider 连接生成本地 Embedding Set：

```bash
EMBEDDING_API_KEY=... pnpm --dir jobs/campus-docs-index-publisher build-embeddings -- \
  --chunk-set sha256:<chunk-set-id> \
  --base-url https://provider.example/v1
```

该命令固定使用 `Qwen3-Embedding-4B`，只读写当前 worktree 的 `var/campus-docs/rag/`，不访问
execution-control、Ops Web、PostgreSQL、Qdrant 或集群对象存储。它与线上 Embedding Job 共用制品生成
实现；差别只有本地显式连接和文件 Store。

## 本地 Publish 验证

本地 Embedding Set 生成后，使用本地真实 Qdrant 和当前对象存储 source 执行 publish。命令只读取
`var/` 中的 Embedding/Chunk 制品，不调用 provider，也不向对象存储写入 RAG 制品：

```bash
EXECUTION_CONTROL_DATABASE_URL=postgresql://<local-user>:<local-password>@127.0.0.1:5432/<local-database>?sslmode=disable \
QDRANT_URL=http://127.0.0.1:6333 QDRANT_API_KEY=<local-qdrant-key> \
pnpm --dir jobs/campus-docs-index-publisher publish-index-local -- \
  --embedding-set sha256:<embedding-set-id>
```

首次运行可检查 Qdrant collection、全量 point 读回和 `campus_docs_serving.current_index`；同一制品
再次运行可检查 `no_op: true`。该命令服务本地实现验证，不是触发线上 Publisher Job 的前置状态。

## RAG 制品

本地 Chunk 命令只读对象存储中的当前 source 和 reader，本地 Embedding 命令只读本地 Chunk Set；二者
按[文档阅读器数据模型](../data/document-reader.md)定义的相对布局写入当前 worktree 的 `var/`。这些文件
用于本地检查，不是线上候选，也不通过上传进入下一阶段。线上 Chunk 与 Embedding Job 将同一布局写入
derived bucket，所有正式对象都按内容寻址。

NDJSON 和 manifest 都使用规范序列化并以换行结尾。写入使用 `If-None-Match: *`；同键同内容是幂等
重跑，不同内容是错误。系统不维护 `latest` 制品指针，下一阶段必须显式接收上一阶段输出的
`sha256:<id>`。

三个 Job 使用现有 derived bucket 身份。Chunk 和 Embedding Job 写入各自的数据与 manifest；Publisher
只读取显式制品并发布 Qdrant/当前指针，不写入新的对象存储制品，也不创建单独的对象存储 Secret 或
只读/写入两套 Campus Docs 凭据。

## 手动执行

`CronJob/campus-docs-chunk-builder`、`CronJob/campus-docs-embedding-builder` 和
`CronJob/campus-docs-index-publisher` 各自保存一个完整阶段的 Pod 模板，必须保持 `suspend: true`，不得
通过解除暂停执行。维护者只使用 `kubectl` 从模板创建一次性 Job；Embedding 和 Publisher 的内容寻址
输入只写入本次 Job，不保存到 CronJob、ConfigMap 或 Secret。每个 Job 不等待或触发下一阶段。

### 1. 构建 Chunk Set

```bash
kubectl -n <namespace> create job \
  --from=cronjob/campus-docs-chunk-builder <job-name>
```

等待并读取该 Job 日志。成功 JSON 包含 `chunk_set`、`chunk_count`、`document_count`、
`source_digest` 和 `source_projection_sha256`。`source_digest` 只用于诊断，Chunk Set 身份由有效当前
文档投影、分块定义和实际 Chunk 数据形成。下一阶段显式使用日志返回的 `chunk_set`。

该 Job 只访问来源、reader 和 derived bucket，不访问 execution-control、PostgreSQL、Qdrant 或
embedding provider。

### 2. 构建 Embedding Set

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

### 3. 发布 Index

```bash
kubectl -n <namespace> create job \
  --from=cronjob/campus-docs-index-publisher <job-name> \
  --dry-run=client -o yaml |
kubectl set env --local -f - \
  CAMPUS_DOCS_EMBEDDING_SET=sha256:<embedding-set-id> -o yaml |
kubectl -n <namespace> create -f -
```

Publisher 只读取显式 Embedding Set，并从其 manifest 解析 Chunk Set；不读取 reader，也不调用
embedding provider。Qdrant collection 后缀由显式 Embedding Set ID 与当前 Collection Definition 的
规范 JSON 摘要形成：

```text
campus_docs_<sha256>
```

Publisher 写入并完整校验 Qdrant points 后，重新读取 `source.json`，只比较会影响当前索引的文档投影。
投影未变化时才原子替换 PostgreSQL `campus_docs_serving.current_index`。成功 JSON 包含 `collection`、
`point_count` 和 `no_op`。Publisher 复用 `execution_control` 数据库连接，不创建独立 role、DSN 或
数据库 Secret。

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

- reader、摘要或清单关系无效：修复来源对象或候选清单，重新运行 Chunk Job；
- provider 快照或 embedding 调用失败：当前索引不变；修复 Ops Web 中的连接并重新运行 Embedding Job；
- embedding set 或其 chunk set 引用无效：Publisher 在写 Qdrant 前失败，使用正确的 Embedding Set ID
  重跑；
- 新 collection 写入、校验或来源末次核对失败：Publisher 删除本次新建 collection，当前绑定不变；
- 目标 collection 已存在但内容不匹配：Publisher 停止且不删除该 collection；
- 目标 collection 已存在且内容完整：重跑会完成验证并尝试激活；
- 数据库激活返回错误：保留已验证 collection，直接重跑同一 Embedding Set ID；若上次提交已成功，
  激活返回 `no_op: true`，否则完成当前指针替换。

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

旧 collection 不在激活时自动删除。当前在线 execution-control 不读取 collection，也不会在运行准入中
冻结它。人工删除前必须：

1. 从 `campus_docs_serving.current_index` 读取当前 collection，永不删除当前值；
2. 确认没有正在运行的 Campus Docs Publisher Job 使用待删除 collection；
3. 使用 Qdrant 管理凭据删除明确列出的非当前 collection，并再次确认当前 collection 可读取。

仓库不维护 collection 历史表、保留状态机或自动回收任务。每次清理只处理本次明确核对的集合。

## 相关文档

- [检索服务](../architecture/system/retrieval-serving.md)
- [文档站架构](../architecture/system/document-site.md)
- [文档来源与静态交付合同](../contracts/document-reader-delivery.md)
- [文档阅读器数据模型](../data/document-reader.md)
