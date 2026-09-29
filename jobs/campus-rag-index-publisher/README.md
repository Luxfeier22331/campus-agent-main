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
pnpm dev:init -- --target notice-index-publisher
pnpm --dir jobs/campus-rag-index-publisher import-artifacts-local -- \
  --context <协作者-context> --namespace campus-agent-staging \
  --docs-embedding-set sha256:<docs-id> \
  --notice-embedding-set sha256:<notice-id>
pnpm --dir jobs/campus-rag-index-publisher publish-index-local -- \
  --docs-embedding-set sha256:<docs-id> \
  --notice-embedding-set sha256:<notice-id>
```

`notice-index-publisher` target 只用于补齐本地 schema owner 的 baseline；它不参与发布。RAG publisher 的
`dev:init` 从正在运行的本地 Qdrant Compose 容器读取 writer key 和 HTTP 映射端口，通过认证检查后写入
当前 worktree 的托管 `.env.local`。重跑初始化会刷新该连接；容器不可用或认证失败时初始化报错。
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

notices/rag/chunk-runs/sha256/<id>/manifest.json
notices/rag/chunk-runs/sha256/<id>/chunks.ndjson
notices/rag/embedding-sets/sha256/<id>/manifest.json
notices/rag/embedding-data/sha256/<digest>/embeddings.ndjson
```

Docs 制品使用 `campus_docs_chunk_set.v2` 和 `campus_docs_embedding_set.v3`。Notice 制品使用
`notice_chunk_run.v1` 和 `notice_embedding_set.v1`。统一 publisher 从 Notice Chunk 的 `retrieval_text`
首行生成 title，并由 `notice_id` 生成 `/notices/<notice_id>` citation；不连接 live Notices DB。

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
- 保留 `notice_id`、`chunk_index`、title、heading path、正文和两个文本摘要。

在线 adapter 将 Notice 的 `source_kind=notice` 映射为 UI 使用的 `campus_notice`，不通过额外 collection
或查询路由区分两类来源。Docs/Notice point ID 使用不同 source namespace，避免 chunk ID 碰撞。

## 发布顺序与失败语义

1. 读取并验证两个 Embedding Set 及其 serving 所需的 Chunk/Chunk Run 对象；
2. 生成 Docs/Notice points 和 sparse vectors；
3. 若 collection 已存在，完整核对配置、数量、point payload 和 dense/sparse vectors；
4. 若 collection 不存在，创建并批量写入，再执行同样的完整核对；
5. 在 PostgreSQL advisory lock 下原子更新 `campus_docs_serving.current_index`。

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

完整产品初始化使用根 `pnpm dev:init -- --target core`。cluster 模式从当前数据库绑定读取真实
Qdrant points，不要求人工找到两个 Embedding Set；复用本包 collection 校验和事务内 catalog 激活。
本地发布与初始化共用 registry 目录中的 Qdrant materialization lock，避免多个 worktree 并发创建同名集合。
数据范围与替换规则见[本地运行检查](../../docs/runbooks/local-verification.md)。
