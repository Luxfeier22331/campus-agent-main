---
doc_type: runbook
status: active
created: 2026-04-05
updated: 2026-04-06
---

# Authenticated Notice Source-Truth Replay Runbook

## 文档边界

这份 runbook 只描述一个问题：

- 当 authenticated notice historical data 已经导入 repo-owned `source-truth` 之后，后续应如何消费

它回答的是：

- canonical 处理单元是什么
- batch 应如何切
- notice 与附件是否一起推进
- parent / child document 如何进入 split / cleanup / chunking
- historical closeout 的吞吐姿态应如何设置

它不替代：

- `docs/architecture/authenticated-notice-source-architecture.md` 的长期边界
- `docs/runbooks/authenticated-notice-bootstrap-smoke-runbook.md` 的 bundle import smoke
- `docs/runbooks/authenticated-notice-async-staged-closeout-runbook.md` 的 run lifecycle / show / watch / promote 操作面
- live collector / control-plane runbook

## 适用前提

- 目标 scope 仍是 `campus_notices/internal_notice`
- collection posture 仍是 `restricted + offline_preparation`
- authenticated notice 已经完成 bootstrap import
- object store 中已经存在 canonical `capture/*`、`provider/*`、`source-truth/*`
- document registry 中已经存在 `source_channel=authenticated_notice_portal` 的父 notice source-truth rows

不适用于：

- 第一次从 export bundle 导入 repo
- live portal 增量采集
- query-serving rollout

## Canonical Input

已导入历史数据的后续消费，canonical input 固定为 source-truth，而不是 collector 临时产物。

允许读取的上游对象：

- `source-truth/notice-manifest.json`
- `source-truth/content-blocks.jsonl`
- `source-truth/attachment-refs.jsonl`
- attachment object keys 指向的已上传源对象

禁止重新提升为长期输入的对象：

- collector SQLite
- collector 本地文件系统路径
- export bundle JSON
- “某个附件单独重跑”的一次性临时清单

## Canonical Processing Unit

已导入历史数据的 canonical 处理单元固定为 `notice scope`。

一个 `notice scope` 必须同时包含：

- 1 个 parent notice document
- 0 到 N 个 derived attachment child documents
- notice 与 attachment 之间的 source-truth relation truth

因此：

- batch 按 `notice` 切，不按 `attachment` 切
- parent 与 child 必须一起进入 verification 与最终 scope refresh
- 不允许只针对附件子集做 attachment-only scope rewrite

## Canonical Pipeline

已导入 source-truth 的后续消费固定遵循：

`source-truth inventory -> batch plan -> parent/child projection replay -> split/cleanup/chunk -> staged verification -> single promote -> optional offline index release`

### 1. Freeze Source-Truth Inventory

先从 document registry 枚举 `authenticated_notice_portal` 父 notice rows，并冻结一份 run-owned notice inventory。

inventory 至少包含：

- `document_id`
- `version_id`
- `raw_asset_id`
- `raw_version_id`
- source-truth object refs
- attachment ref count
- attachment extraction-class summary

这一步的目标是把“当前要消费什么”固定下来，避免 worker 在执行中反复扫描整份 scope。

### 2. Plan Batches By Notice Scope

planning 必须按 notice scope 生成 batch。

固定规则：

- 同一条 notice 的 parent + child 必须在同一个 batch 内
- batch 只持有自己冻结后的 notice slice
- worker 只允许读取自己 claim 到的 batch input
- 不允许在 worker 热路径里重新 eager prepare 整个 source scope

建议使用加权 batch，而不是简单平均 notice 数：

- notice body 权重：`1`
- `text_extractable` attachment 权重：`1`
- `ocr_required` attachment 权重：`3`

这是当前 historical attachment 分布下的 operator tuning 建议，不是 repo contract；原因是 image OCR 才是热路径主瓶颈。

### 3. Replay Parent And Attachment Projections Together

对每条 notice，projection replay 固定分两层：

- parent notice document 只保留 notice 正文与正文结构单元
- attachment refs 留在 source-truth relation 层
- 已下载附件 materialize 为 repo-owned child documents

当前 repo 已落盘的 bounded replay 入口是：

```bash
uv run --package campus-ingestion-worker python -m campus_ingestion_worker.rebuild_authenticated_notice_source_projections \
  --corpus campus_notices \
  --collection internal_notice
```

这个入口适合 bounded replay、correctness proof 和局部 source-truth 重建。

对 full historical corpus，canonical shape 仍应复用 async staged closeout 的 batch-leased lifecycle：

- `planning -> planned -> running -> verifying -> verified -> promoting -> done|failed`

不要把整份历史 scope 重新塞回一个长时间单进程。

source-truth historical replay 的 canonical planner 入口现为：

```bash
uv run --package campus-ingestion-worker python -m campus_ingestion_worker.plan_authenticated_notice_source_truth_replay \
  --run-id internal-notice-source-truth-replay-20260406 \
  --corpus campus_notices \
  --collection internal_notice \
  --shard-size 250 \
  --batch-size 16 \
  --max-concurrency 8 \
  --notice-concurrency 8 \
  --object-store-concurrency 64 \
  --lease-seconds 300
```

后续 worker / show / watch / promote 继续复用 async staged closeout 的既有命令：

- `run_authenticated_notice_closeout_worker`
- `show_authenticated_notice_closeout`
- `watch_authenticated_notice_closeout`
- `promote_authenticated_notice_closeout`

### 4. Split / Cleanup / Chunk

projection replay 之后，parent 与 child document 都进入 repo-owned cleanup / chunk pipeline，但规则不同：

- parent notice 只围绕正文结构单元 chunk
- `attachment_ref` 结构单元必须显式跳过
- child attachment documents 各自独立 chunk
- 不把 attachment 文本重新拼回 parent notice

`internal_notice` 当前 runtime profile 已允许进入 offline preparation 的 document/chunk/index 生命周期，但仍保持：

- `retrieval_enabled=false`
- `query_enabled_by_default=false`

因此 chunking / embedding / index release 可以发生，但不代表该 collection 已经进入 query-serving。

### 5. Verify Before Scope Mutation

verification 固定以 metadata-driven 方式进行，不以“把所有对象正文重新读一遍”作为默认路径。

至少检查：

- expected notice count
- expected document ids / raw asset ids
- object existence
- staged digest / `sha256`
- raw version consistency
- unexpected document ids

verification 未通过时：

- 不 promote
- 修复同一个 run
- 不新开 delta run 去拼 canonical scope

### 6. Single Promote

最终 canonical scope mutation 固定由单个 promoter 收口。

固定语义：

- 可以有多个 batch worker
- 只能有一个 promoter 执行最终 `replace_scope`
- parent notice rows 与 attachment child rows 必须一次性收口到同一个 `replace_scope(corpus, collection, records)`

对“一次性历史导入”，正确收口方式始终是：

- 修复同一个 run
- 验证通过后 promote 一次

不是：

- 拆成多个 delta promote
- 先 promote parent 再 promote attachment

## Attachment Handling Rules

attachment extraction lane 固定按类型分流：

- `reference_only`
  - 只保留 source-truth relation
  - 不生成 child document
- `text_extractable`
  - 走确定性 native text extraction
  - 当前至少覆盖 `docx`
- `ocr_required`
  - 走在线 OCR provider
  - 当前至少覆盖 image-heavy historical corpus：`png`、`jpg`、`jpeg`、`bmp`、`gif`
- `unsupported_binary`
  - 直接 fast-fail
  - 不静默降级成可检索文档

child attachment document 必须携带明确的 derived metadata，包括但不限于：

- `projection_name`
- `derived_from`
- `derived_from_document_id`
- `derived_from_raw_asset_id`
- `derived_from_raw_version_id`
- `parent_document_id`
- `attachment_ref_id`
- `attachment_kind`
- `attachment_role`
- `attachment_content_sha256`
- `extraction_class`
- `extraction_policy_version`

## Throughput Posture

### Worker Topology

full historical replay 推荐的起步姿态：

- worker 进程数：`8`
- batch size：`16-24` notices
- per-worker notice 并发：`4-8`
- per-worker object-store 并发：`32-64`
- per-worker OCR 并发：`2-4`

这些值是基于当前 repo 结构与真实 historical corpus 形态的 operator 建议，不是 contract 常量。

### Object Storage

对象存储热路径的策略固定为：

- 使用 bounded parallelism
- 把 source object upload / staged document upload / final copy 作为不同并发层考虑
- 遇到短暂限流或抖动时做 retry / backoff
- 保持 deterministic object key 与 repo-owned prefix layout，不因为吞吐焦虑随意改 key 语义

repo 当前已接受的对象前缀布局与 ownership 不变；吞吐优化不应破坏这些语义。

### Postgres / Supabase

对于 persistent worker：

- 在 IPv4 posture 下继续使用 Supabase session pooler
- 不把 transaction pooler 当作长驻 batch worker 的主连接方式
- batch notice/raw/document stage rows 与聚合状态必须同事务提交

如果后续确认 stage-row 写入成为主要瓶颈，优先升级为 bulk-friendly 路径：

- `COPY`
- 或明确的 batched insert

不要回退成 per-row autocommit 写入。

### OCR

OCR 并发必须与 object-store 并发分离控制。

固定原因：

- object-store 请求是高并发 I/O bound
- OCR 是外部重计算 / 外部排队型热路径
- 两者共用一个大并发阈值会放大尾延迟与失败恢复成本

因此：

- 不让 OCR concurrency 直接等于 object-store concurrency
- 不让单个 notice 持有无限 attachment OCR 并发

## 当前可执行边界

当前 repo 内已经具备：

- bootstrap import
- source-truth replay 的 bounded projection runner
- async staged closeout 的 planning / worker / verify / promote 生命周期

因此当前正确的执行分工是：

- bounded correctness replay：使用 `rebuild_authenticated_notice_source_projections`
- full historical consumption：沿用 async staged closeout 的 batch-leased execution model

不要继续把“已导入 source-truth 的历史消费”建模成：

- 一个巨大的全量单文件任务
- 一个只扫附件的补丁任务
- 一个长期依赖 stdout 的黑盒进程

## Forbidden Shapes

- 不按附件切 batch
- 不把 attachment text 再拼回 parent notice body
- 不对同一 scope 做 parent-only / child-only 多次 promote
- 不回到 collector 本地文件系统重新建 canonical truth
- 不把 `unsupported_binary` 静默降级成普通文本
- 不把 long-running persistent worker 放到 Supabase transaction pooler
- 不以“先跑起来”为理由破坏 single-promoter `replace_scope` 语义

## External References

这些外部链接只用于吞吐与运行姿态参考，不改变 repo 的 canonical ownership / source-truth / scope-mutation 语义：

- Amazon S3 Performance Guidelines:
  `https://docs.aws.amazon.com/AmazonS3/latest/userguide/optimizing-performance-guidelines.html`
- Amazon S3 Performance Design Patterns:
  `https://docs.aws.amazon.com/AmazonS3/latest/userguide/optimizing-performance-design-patterns.html`
- Supabase connection methods and poolers:
  `https://supabase.com/docs/reference/postgres/connection-strings`
- Supabase session / transaction mode terminology:
  `https://supabase.com/docs/guides/troubleshooting/supavisor-and-connection-terminology-explained-9pr_ZO`
- PostgreSQL bulk population guidance:
  `https://www.postgresql.org/docs/18/populate.html`
