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

## Source Object Completeness Invariant

source-truth replay 额外依赖一个不可放宽的前提：

- `attachment-refs.jsonl` 里凡是带 `object_key` 的 attachment ref，对应源对象都必须已经存在于 source bucket

如果 worker 在 replay attachment child document 时遇到 `NoSuchKey`，这不是 replay runner 的重试问题，而是 source bucket completeness 被破坏。

处理原则固定为：

- 不改 canonical input
- 不把 collector 的 `local_path` 写回 repo contract
- 允许把 `bundle + blob_root` 作为一次性 operator repair input，用来把缺失源对象补回 source bucket
- 回填完成后修复同一个 run，再继续 worker；不要新开 delta run

repo-owned repair 入口：

```bash
uv run --package campus-ingestion-worker python -m campus_ingestion_worker.backfill_authenticated_notice_attachment_objects \
  --bundle-path /home/reptilian/code/rag-data/muc-notice-collector/runtime/exports/notices-bundle-20260403-full.json \
  --blob-root /home/reptilian/code/rag-data/muc-notice-collector/runtime/blob-store \
  --max-concurrency 8
```

如果只想针对已知失败 notice 精确回填，可重复传入 `--notice-id`：

```bash
uv run --package campus-ingestion-worker python -m campus_ingestion_worker.backfill_authenticated_notice_attachment_objects \
  --bundle-path /home/reptilian/code/rag-data/muc-notice-collector/runtime/exports/notices-bundle-20260403-full.json \
  --blob-root /home/reptilian/code/rag-data/muc-notice-collector/runtime/blob-store \
  --notice-id 354605 \
  --notice-id 353301 \
  --notice-id 354016 \
  --notice-id 354371 \
  --notice-id 354954 \
  --max-concurrency 8
```

这条命令的行为固定为 fast fail：

- bundle relation 有 `object_key` 但缺 `sha256`，直接失败
- source bucket 已有对象但内容摘要不匹配，直接失败
- source bucket 缺对象且 `blob_root/object_key` 不存在，直接失败
- 本地 blob 内容与 bundle `sha256` / `byte_size` 不一致，直接失败

回填成功后，继续对同一个 run 执行 repair + worker resume。

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

inventory 本质上是一个 projection-only metadata snapshot：planner 不再 re-scan every `source-truth` artifact, 而是根据 `notice-manifest.json` / `content-blocks.jsonl` / `attachment-refs.jsonl` 派生出一个轻量的 `ingestion_projection` 视图。这份 projection 既落在 `campus_notices/operations/authenticated-notice-closeout/{run_id}/ingestion_projection.json`，也写入 `ingestion_projection` 表，供 planner 和 verifier 共享。

inventory 至少包含：

- `document_id`
- `version_id`
- `raw_asset_id`
- `raw_version_id`
- source-truth object refs
- attachment ref count
- attachment extraction-class summary
- attachment kind / extraction lane / projection_name / visibility projections (typed fields required for downstream stage commit)

repair frozen run 时的固定规则补充：

- repair 允许刷新 `ingestion_projection.json`，但输入仍然只能是该 run 自己冻结下来的 parent snapshots 与 frozen source-truth objects
- repair 必须用当前 source projection rules 重算 attachment projection plan，不能把旧 run 中已经证明错误的 attachment classification 原样保留
- 这条规则尤其覆盖“平台 decorative asset 曾被误判进 OCR lane”这类情况；例如 editor static assets（`spacer.gif` 等）在 repair 后必须回到 `reference_only`
- 如果 verifier 发现某些 completed batch 的 `closeout_notice_stage` 仍是旧 shape，缺少 `attachment_outcomes`，repair 必须重开这些 completed batch，而不是继续把它们当 done
- 对这类 reopened batch，repair 必须先清掉该 batch 在 `closeout_notice_stage` / `closeout_raw_asset_stage` / `closeout_document_stage` 中的旧 rows，再允许 worker 重新 materialize；不能把旧 stage rows 和新 projection 结果混在一起

这一步的目标是把“当前要消费什么”固定下来，避免 worker 在执行中反复扫描整份 scope，同时把 derived metadata 作为 planning 进度的 canonical truth。

### 2. Plan Batches By Notice Scope

planning 必须按 notice scope 生成 batch。

固定规则：

- 同一条 notice 的 parent + child 必须在同一个 batch 内
- batch 只持有自己冻结后的 notice slice
- worker 只允许读取自己 claim 到的 batch input
- 不允许在 worker 热路径里重新 eager prepare 整个 source scope

为了 operator 能感知 planner 进度，planner 会在 run manifest / `ingestion_closeout.closeout_runs` 中依次写入 `planning_started` / `inventory_loaded` / `batches_frozen` / `planned` 这几个 progress milestone。具体来说：

- `planning_started`：planner 把 run manifest 写入 operations prefix，并开始读 projection inventory。
- `inventory_loaded`：planner 读完 `ingestion_projection`，确认每个 notice 的 typed metadata 并准备分 batch；这个状态可供 `show` / `watch` 报告当前 inventory 序列。
- `batches_frozen`：每个 batch 的 frozen input slice（manifest + inventory subset）写出到 `batches/<batch>/input.json`。
- `planned`：全部 batch manifest / metadata 写完，run 状态刷新到 `planned`，可以启动 leased worker。

这些状态都建立在 projection-only inventory 之上；planner 不允许在 `planning` 期间重新触碰 `source-truth` 对象，只能基于 `ingestion_projection` 派生的 slices。

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

这里的 canonical 后续链路已经拆成两段：

- `prepare_registry_scope_chunks --corpus campus_notices --collection internal_notice --preparation-run-id <prep_id>`
- `release_registry_scope --corpus campus_notices --collection internal_notice --preparation-run-id <prep_id> --no-publish-alias`

固定规则：

- `prepare_registry_scope_chunks` 只做 registry current truth 的 split / cleanup / chunk / validation，不做 embedding，不写 Qdrant
- `release_registry_scope` 只负责 verified chunk preparation 之后的 `embedding -> indexing -> optional alias publish`
- `campus_notices/internal_notice` 现在要求 release 显式提供成功的 `preparation_run_id`；不能再直接跳过 chunk admission 进入 embedding

因此 chunking / embedding / index release 仍然可以发生，但必须分阶段发生，而且不代表该 collection 已经进入 query-serving。

### 4.1 Typed Stage Columns & Bulk Commit

planner 与 worker 在 `closeout_notice_stage` / `closeout_raw_asset_stage` / `closeout_document_stage` 的热路径写入中，必须提前摄入 `ingestion_projection` 中的 typed fields：

- `projection_name`
- `attachment_kind`
- `extraction_lane`
- `derived_from` / `derived_from_document_id` 等 provenance columns
- `visibility_*` / `entitlement_*` / `policy_projection_version`

这些字段直接构成 `stage` 表的 schema，所以 planner 在 `ingestion_projection` 中 already materializes them, worker 只要 bulk stage 语义地依次写入一个 batch 的 notice/raw/document rows，避免每条 notice 多次 upsert。具体来说：

- worker 在处理完 batch 时一次性 `INSERT` `closeout_*_stage`，再在同一事务内更新 `closeout_batches` / `closeout_shards` / `closeout_workers`。
- stage rows 的 `projection_name` 与 `derived_from` 保证 verifier/promoter 能够把批次重新映射回 source-truth scope，而不再需要额外 scan raw data.

以上保障了 hot path 写放大的收敛，提交本身以 batch 为单位发生。

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

verifier 只读 `ingestion_projection` / `batches/<batch>/input.json` 这类 frozen inventory artifact，逐条对照 staged rows 的 metadata（`sha256`/`content_length`/`raw_version_id`）与 object `HEAD`，不再重新遍历 `source-truth` raw objects。

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

### 7. Promotion Progress Without Full Scans

single promoter 仍然唯一变更 canonical scope，但可以在 promotion stage 里以 bulk-friendly 方式处理 raw asset upsert：

- promoter 读 `ingestion_projection` + `closeout_raw_asset_stage` 中的 scoped rows，直接 bulk upsert `raw_asset_registry` / `raw_asset_versions`，不再对整个 collection 做 full-scope scan。
- promoter 的 object-store native copy / upsert 有两个阶段：先把 staged object metadata & digest 复制到 final keys，再在 promotion progress rows 中逐 batch 标记 `raw_asset_count` / `document_count`，方便后续 `show` / `watch` 直接读 aggregated progress truth。
- 只要 `closeout_promotions` / `closeout_promotion_batches` 的 aggregation fields 可信，operator 也不需要靠 scanning staged objects 判断 promoter 是否完成。

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
  - lane outcome 固定分成两类：
    - `materialized_document`：OCR 产出非空标准化文本，生成 child document
    - `no_extractable_text`：OCR 成功返回但没有可提取正文，不生成 child document
  - `no_extractable_text` 不是 fallback，也不是静默跳过；它必须作为 attachment-level replay outcome 落进 staged truth，供 verification / operator 审计
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

planning / verification 口径固定补充：

- frozen inventory / batch input 冻结的是 attachment projection plan，不把所有 OCR candidate 预先当成“必有 child document”
- verifier 必须确认每个 OCR candidate 都有确定 outcome
- final expected document scope = parent documents + `text_extractable` child documents + outcome 为 `materialized_document` 的 OCR children
- `no_extractable_text` attachment 继续作为 source-truth relation 留存，但不进入 final document scope

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
