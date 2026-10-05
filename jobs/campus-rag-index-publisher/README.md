# 统一 Campus RAG serving publisher

该包是 Campus Docs 与已发布 Notices 的唯一生产 serving publisher。Docs 和 Notice 的 Chunk、Embedding
builder 仍由各自 package 拥有；本包只读取显式的 immutable Embedding Set，组装一个混合 Qdrant
collection，并原子替换 `campus_docs_serving.current_index`。

本包不采集来源、不连接 Notices 数据库、不读取 Campus Docs reader、不调用 embedding provider，也不重新
生成 embedding。重复发布同一组制品只做验证和 pointer 激活。版本目录登记真实制品引用，
保留 current 与 previous；手动入口和自动 worker 共用发布会话锁，候选先登记再创建 collection，
校验成功后使用预期 current 激活。已验证或受保护的集合不自动重建。

## 入口

```bash
pnpm --dir jobs/campus-rag-index-publisher typecheck
pnpm test --filter=campus-rag-index-publisher
pnpm --dir jobs/campus-rag-index-publisher build
```

生产镜像的唯一命令是：

```bash
publish-index
```

它要求本次 Job 显式提供：

- `CAMPUS_DOCS_EMBEDDING_SET=sha256:<id>`；
- `CAMPUS_NOTICE_EMBEDDING_SET=sha256:<id>`。

自动路径由 Temporal workflow 传入，人工路径由一次性 CLI/Job 显式传入。制品 ID 不写入 ConfigMap 或 Secret。

本地发布验证使用独立入口，不读取共享 derived bucket：

```bash
pnpm dev:init -- --target campus-rag-index-publisher
pnpm --dir jobs/campus-rag-index-publisher import-artifacts-local -- \
  --context <协作者-context> --namespace campus-agent-staging \
  --docs-embedding-set sha256:<docs-id> \
  --notice-embedding-set sha256:<notice-id>
pnpm --dir jobs/campus-rag-index-publisher publish-index-local -- \
  --docs-embedding-set sha256:<docs-id> \
  --notice-embedding-set sha256:<notice-id>
```

`campus-rag-index-publisher` target 独立准备所需 PostgreSQL、统一 schema、derived bucket 和 Qdrant。
环境渲染直接读取当前 profile 的私有 writer key 和端口；基础设施操作验证连接，不要求先初始化 core 或其他 publisher。
本地发布读取已导入的对象，不调用 provider。

`import-artifacts-local` 使用协作者 `objectstore-ro` Secret，通过临时 `kubectl port-forward` 读取集群的 `campus-agent-derived` bucket，按两个
显式 Embedding Set 的 serving 引用闭包复制所需 immutable 对象到当前 worktree 的隔离 bucket。它不会复制整个
bucket，也不会写入共享 bucket。导入完成后，`publish-index-local` 通过本地 S3 读取这些对象；manifest、digest、
对象 key 和相对文件名保持原值。

## 输入制品

Publisher 从现有 derived bucket 只读以下内容：

```text
campus-docs/rag/chunk-sets/sha256/<id>/manifest.json
campus-docs/rag/chunk-data/sha256/<digest>/chunks.ndjson
campus-docs/rag/embedding-sets/sha256/<id>/manifest.json
campus-docs/rag/embedding-data/sha256/<digest>/embeddings.ndjson

notices/rag/chunk-data/sha256/<digest>/chunks.ndjson
notices/rag/embedding-sets/sha256/<id>/manifest.json
notices/rag/embedding-data/sha256/<digest>/embeddings.ndjson
```

Docs 制品使用 `campus_docs_chunk_set.v2` 和 `campus_docs_embedding_set.v3`。Notice 制品使用
`notice_embedding_set.v2`，直接引用 chunks 对象；已有 v1 set 仍通过 chunkRun 读取。统一 publisher 从 Notice
Chunk 的 `retrievalText` 首行生成 title，并由 `noticeId` 生成 `/notices/<notice_id>` citation；不连接 live Notices DB。
文档和通知统一写入 `campus_rag_point.v3`。通知 payload 保留 `released_at` 发布时间，但不包含文档版本路由字段；
`text` 使用 `retrievalText` 首行之后的完整证据，包含章节及必要上下文。
`packages/contracts/fixtures/campus_rag/notice-point.v3.json` 由发布端输出，发布测试与执行端解析测试共同校验。
新发布要求 chunks 有真实的 `releasedAt`；缺少日期的旧制品须从来源重建，已有 collection 的回滚由 Ops 固定已验证的目标和预期 current，
取得既有发布锁后直接激活 catalog；不读取制品或访问 Qdrant，重试保持同一目标。

所有 serving 所需的 manifest、对象引用、NDJSON 记录、向量维度、内容摘要和数量都会在组装前校验。Docs 与 Notice 必须
使用相同的 embedding space、dimensions 和 Model Target；每个 embedding set 必须精确覆盖对应 Chunk
制品中的 retrieval text，不能缺失、额外或重复。

## Point 与 collection

统一 collection 的定义由 `src/definitions.ts` 拥有，名称为：

```text
campus_docs_<sha256>
```

后缀由 Docs Embedding Set ID、Notice Embedding Set ID 和当前 collection definition 的规范摘要共同
计算。它不是 `latest` 指针，也不代表数据库历史版本。

Docs point：

- `source_kind=document`；
- citation 使用 Docs section URL；
- 保留 document、version、section、`root_unit_ids`、正文和两个文本摘要。

Notice point：

- `source_kind=notice`；
- citation 使用 `/notices/<noticeId>`；
- 保留 `notice_id`、`chunk_index`、title、heading path 和两个文本摘要；
- `text` 使用 Chunk `retrievalText` 去掉首行标题后的内容，包含必要的原文章节、父项和表头，
  `text_sha256` 按该证据正文计算；Chunk `content` 继续用于原文覆盖。

当前 point 为 `campus_rag_point.v3`；collection identity 包含该版本。先部署接受 v1/v2/v3 的
execution-control，再部署 v9 builder 和统一 publisher，最后通过既有制品发布入口激活候选。

在线 adapter 将 Notice 的 `source_kind=notice` 映射为 UI 使用的 `campus_notice`，不通过额外 collection
或查询路由区分两类来源。Docs/Notice point ID 使用不同 source namespace，避免 chunk ID 碰撞。

## 发布顺序与失败语义

1. 读取并验证两个 Embedding Set 及其 serving 所需的 Chunk/Chunk Run 对象；
2. 生成 Docs/Notice points 和 sparse vectors；
3. 若 collection 已存在，完整核对配置、数量、point payload 和 dense/sparse vectors；
4. 若 collection 不存在，先创建 dense/sparse collection 并批量写入 points，再创建检索过滤所需的 payload indexes；
5. 等待 payload indexes 完成后执行同样的完整核对；
6. 在 PostgreSQL advisory lock 下原子更新 `campus_docs_serving.current_index`。

本次新建 collection 在写入或校验失败时删除，current pointer 不变。已存在但内容不匹配
的 collection 不删除，避免误删可能属于其他发布或回滚候选的资源。数据库激活失败时保留已验证
collection，重跑同一组 Embedding Set 即可完成 pointer 激活；若 pointer 已经指向目标，结果为 `no_op`。

`campus_docs_serving.current_index` 的逻辑 owner 是统一 Campus RAG serving；本包是唯一 current pointer
writer。Docs/Notice builder 和在线 Campus Search 不写该表。Publisher 使用现有
`EXECUTION_CONTROL_DATABASE_URL` 技术身份，不新增数据库 role 或独立 serving schema。

## 本地环境与集群模板

本地环境由以下命令生成：

```bash
pnpm dev:init -- --target campus-rag-index-publisher
```

本地 package 环境只用于连接本地 PostgreSQL、Qdrant 和 derived object store；它不生成或上传制品。
生产自动发布由 `notice-artifacts-worker` 调用本包完成，不再部署独立的 Publisher CronJob。
需要人工执行时，使用本包的 CLI 或通过受控的一次性 Job 调用相同镜像，并显式传入两个 Embedding Set。

Publisher 只需要 derived object-store read credentials、Qdrant 连接和 current-index 数据库连接；它不
需要 Model Config、Notice 数据库或 embedding provider 凭据。

完整的 Docs/Notice 构建顺序、回滚和清理步骤见 `docs/runbooks/ingestion/campus-docs.md`。

## 产品开发数据

检索数据同步使用根 `pnpm dev:local -- data sync --domain retrieval`，从当前数据库绑定读取真实
Qdrant points，不要求人工找到两个 Embedding Set；复用本包 collection 校验和事务内 catalog 激活。
本地发布与初始化共用 registry 目录中的 Qdrant materialization lock，避免多个 worktree 并发创建同名集合。
数据范围与替换规则见[本地运行检查](../../docs/runbooks/local-verification.md)。
