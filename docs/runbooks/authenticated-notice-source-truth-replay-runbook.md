---
doc_type: runbook
status: active
created: 2026-04-05
updated: 2026-04-12
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
- `docs/runbooks/authenticated-notice-source-truth-replay-pilot-runbook.md` 的 bounded pilot 操作面
- `docs/reference/internal-notice-offline-preparation-strategy.md` 的 collection-specific lane strategy
- `docs/reference/internal-notice-offline-preparation-quality-acceptance.md` 的质量验收规则
- `docs/runbooks/authenticated-notice-bootstrap-smoke-runbook.md` 的 bundle import smoke
- `docs/runbooks/authenticated-notice-async-staged-closeout-runbook.md` 的 run lifecycle / show / watch / promote 操作面
- live collector / control-plane runbook

## Canonical Execution Model

authenticated notice historical replay 的 canonical 执行模型固定为：

- source projection / attachment routing 规则有变化时，先做 bounded pilot 或 targeted routing test
- routing 规则一旦变化，进入 full replay planning 前必须先重建 source-truth inventory
- full replay -> staged validation -> chunk preparation -> preparation validation -> promote -> unpublished release 已经有 repo-supported 执行路径
- 对新的 replay/preparation run，verified chunk preparation 仍是显式决策点；如需继续 release，下一步固定是 `release_registry_scope --no-publish-alias`，而不是直接 publish alias
- operator 环境必须显式设置 `OCR_PROVIDER_MODE=paddleocr_async_jobs`，不依赖 `OCR_BASE_URL` 推断 provider
- 如果操作环境会把坏代理值重新注入进程，release / collection / alias 检查都必须显式清空大小写代理变量；单纯 `env -u HTTP_PROXY ...` 不足以阻止 repo env bootstrap 把坏代理值重新注回进程

本文下面只描述 repo-supported execution path；是否在当前项目阶段继续 release，由 `.planning/PROJECT.md`、`.planning/WORKSTREAMS.md` 与对应 workstream `STATE.md` 决定。

## OCR 失败判定顺序

对 authenticated notice historical replay，OCR 失败的 operator 判定顺序固定为：

- 对规章制度 / 手册类 `pdf`，默认先把它当作 `ocr_required`，不要先切本地 native PDF 路径再决定是否送 OCR
- 先检查失败 attachment 的真实图片内容
- 再结合该图片在 notice 正文里的上下文判断，它是否本来就应该进入 `ocr_required`
- 如果图片上下文明确是操作指引 / 日程导览，而不是正文承载，先把它改判到 `manual_review_required`；当前已知高频关键词包括：
  - `选课时间安排`
  - `具体选课方式`
  - `选课方式参考如下表格`
  - `学习时间安排`
  - `学习时间及考试安排`
  - `选课操作流程`
- 对二维码、示例证书、宣传海报、正文已完整给出说明的冗余教程截图，先修 projection routing 到 `reference_only` 或 `manual_review_required`
- 只有在图片区块确实承载线性文本 / 评分表 / 制度正文，而不是操作流程图、时间安排图、空间导览图时，才保留 `ocr_required`
- 只有当 attachment 已确认属于线性文本 / 表格主导的有效 OCR candidate，且 async jobs 仍然出现 `state=done` 但 `jsonUrl` 持续不可读，才把它认定为 provider contract breach

固定禁止：

- 因单个坏图或低价值图片，直接把整条 historical replay 主路径切换到同步 endpoint
- 在未做图片与上下文判定前，先把 provider 当成第一嫌疑

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

source projection / attachment routing 规则变更后的固定补充：

- planner 读取的是已经持久化的 inventory，而不是 live source objects 的临时重新扫描
- 因此只要 projection rules、attachment classifier、manual-review routing 有变更，就必须先重新执行 `rebuild_authenticated_notice_source_truth_inventory`
- 如果跳过这一步，planner / verifier 会继续使用旧的 `expected_document_count`、`expected_attachment_document_count`、`expected_ocr_candidate_count`
- 这类 stale inventory 会让 run 在 verifier 阶段失败，即使新的 routing 代码已经修好

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

repo-supported 的 bounded replay 入口是：

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

`internal_notice` 的 collection-specific strategy 固定以 `docs/reference/internal-notice-offline-preparation-strategy.md` 为准；runbook 这里只收口 operator 视角下的执行边界。

当前 operator 应按以下理解执行：

- parent notice body 是默认高质量 lane，不应因为 attachment 的脏表格或 OCR 噪声被全局缩小 chunk
- `text_extractable` attachment、`ocr_required` attachment 与 `manual_review_required` outcome 必须显式分流
- 当前 repo-tracked `220/320/32/32` 只是 generic runtime defaults，不是 `internal_notice` 的最终 lane-specific semantic policy
- `prepare_registry_scope_chunks` 的结构通过不代表 attachment quality、cleanup quality 和 chunk quality 已验收
- `internal_notice` 在进入任何 embedding / Qdrant / release 之前，必须先过 `docs/reference/internal-notice-offline-preparation-quality-acceptance.md`

`internal_notice` 当前 runtime profile 已允许进入 offline preparation 的 document/chunk/index 生命周期，但仍保持：

- `retrieval_enabled=false`
- `query_enabled_by_default=false`

这里的 canonical 后续链路已经拆成两段：

- verified replay pilot / pre-promote 审查：
  - `validate_internal_notice_chunking --closeout-run-id <run_id> --sample-dir <output_dir>`
  - `prepare_registry_scope_chunks --corpus campus_notices --collection internal_notice --closeout-run-id <run_id> --preparation-run-id <prep_id>`
  - `validate_internal_notice_chunking --preparation-run-id <prep_id> --sample-dir <output_dir>`
- current-scope / release-prep 审查：
  - `prepare_registry_scope_chunks --corpus campus_notices --collection internal_notice --preparation-run-id <prep_id>`
  - `validate_internal_notice_chunking --preparation-run-id <prep_id> --sample-dir <output_dir>`
- `release_registry_scope --corpus campus_notices --collection internal_notice --preparation-run-id <prep_id> --no-publish-alias`

固定规则：

- `validate_internal_notice_chunking --closeout-run-id` 是 repo-supported 的只读 staged quality 入口，不触发 promote，不写 embedding / Qdrant
- `prepare_registry_scope_chunks --closeout-run-id` 读取 verified closeout run 的 staged `document-units.jsonl`，但 manifest 固定冻结 final canonical document identity / final object keys
- `prepare_registry_scope_chunks` 不做 embedding，不写 Qdrant
- `release_registry_scope` 只负责 verified chunk preparation 之后的 `embedding -> indexing -> optional alias publish`
- `campus_notices/internal_notice` 现在要求 release 显式提供成功的 `preparation_run_id`；不能再直接跳过 chunk admission 进入 embedding
- pilot 当前仍以 verified chunk preparation 为停点；没有显式批准前，不继续 release
- local Postgres dev path 是当前已验证通过的 current-scope replay / preparation operator substrate；这条路径按 `docs/runbooks/local-postgres-dev-recovery-runbook.md` 提供本地 DSN 即可
- 如果改回 shared Supabase path，再要求 offline operator shell 显式提供 `CAMPUS_SHARED_POSTGRES_OPERATOR_URL`
- 当前 shared-path readiness 判定是 operator/session-pooler DSN 能完成实际连接与 `select 1`；legacy `CAMPUS_SHARED_POSTGRES_MANAGEMENT_URL` 只作为兼容别名接受
- 如果 shared-path `CAMPUS_SHARED_POSTGRES_OPERATOR_URL` 在 connect 阶段返回 `PoolTimeout` / `ConnectionTimeout` / `MaxClientsInSessionMode`，本轮 stop，不写 current scope
- 如果当前 shell 继承了宿主机代理值，`release_registry_scope`、`curl "$QDRANT_URL/collections"` 与 `QdrantClient.get_aliases()` 都可能对 Qdrant Cloud 超时；此时必须显式把 `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` 及其小写形式置空，并把 `NO_PROXY` / `no_proxy` 设为 `*`

因此 chunking / embedding / index release 仍然可以发生，但必须分阶段发生，而且不代表该 collection 已经进入 query-serving。

对“先消费已导入历史数据”的 operator 目标，verified chunk preparation 仍是自然决策点；是否继续执行 release，必须作为单独决策处理，不能由 replay / preparation 自动推导。即使某次 operator 执行已经留下 unpublished release 样本，也不改变 `internal_notice` 仍保持 alias 未发布、query-serving 未开放的事实。

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
  - 当前覆盖 `docx`、`xls`、`xlsx`
  - `xls` / `xlsx` 已属于 canonical success path，不再视为未完成支持
  - 不把 `pdf` 当作这条 lane 的默认 canonical 输入
- `manual_review_required`
  - 当前用于校园导览图、位置图、楼宇分区图等空间关系主导的 inline image
  - 不进入当前 OCR / chunk pipeline
  - staged truth 必须显式保留 `review_reason`
- `ocr_required`
  - 走 PaddleOCR-VL async jobs endpoint
  - authenticated notice historical replay 的 operator 环境必须显式设置 `OCR_PROVIDER_MODE=paddleocr_async_jobs`
  - 对 `state=done` 但 `resultUrl.jsonUrl` 持续不可读的情况，只有在 attachment 已确认属于有效 OCR candidate，且已结合 notice 正文上下文排除错误分流后，才视为 provider contract breach
  - 当前默认覆盖两类输入：
    - policy / handbook / procedure 等文档型 `pdf`
    - text-dominant image corpus：`png`、`jpg`、`jpeg`、`bmp`、`gif`
  - native PDF extraction 最多只作为 diagnostics / probe，不作为 canonical success path
  - lane outcome 固定分成两类：
    - `materialized_document`：OCR 产出非空标准化文本，生成 child document
    - `no_extractable_text`：OCR 成功返回但没有可提取正文，不生成 child document
  - 对 `materialized_document`，worker / promoter 必须完整维护 provider payload、`layout-elements.jsonl`、canonical markdown、`document-units.jsonl` 这组 derived artifacts
  - `no_extractable_text` 不是 fallback，也不是静默跳过；它必须作为 attachment-level replay outcome 落进 staged truth，供 verification / operator 审计
- `unsupported_binary`
  - 直接 fast-fail
  - 不静默降级成可检索文档
  - 当前 `.doc` 继续属于这条 lane；后续如果补齐，只允许经 worker-owned normalizer 进入现有 `text_extractable` path

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

- frozen inventory / batch input 冻结的是 attachment projection plan，不把所有 attachment candidate 预先当成“必有 child document”
- verifier 必须确认每个 OCR candidate 和 `manual_review_required` candidate 都有确定 outcome
- final expected document scope = parent documents + `text_extractable` child documents + outcome 为 `materialized_document` 的 OCR children
- `no_extractable_text` 与 `manual_review_required` attachment 都继续作为 source-truth relation 留存，但不进入 final document scope

## Throughput Posture

### Worker Topology

full historical replay 推荐的起步姿态：

- worker 进程数：`8`
- batch size：`16-24` notices
- per-worker notice 并发：`4-8`
- per-worker object-store 并发：`32-64`
- per-worker OCR 并发：`2-4`

这些值是基于 repo 当前结构与真实 historical corpus 形态的 operator 建议，不是 contract 常量。

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

## 可执行边界

repo 内已经具备：

- bootstrap import
- source-truth replay 的 bounded projection runner
- async staged closeout 的 planning / worker / verify / promote 生命周期

因此正确的执行分工是：

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
- 不在 `packages/ingestion-core` 里手写 `.doc` legacy binary parser
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
- LibreOffice command-line conversion (`--convert-to`):
  `https://help.libreoffice.org/latest/en-US/text/shared/guide/start_parameters.html`
- Unstructured partitioning (`partition_doc` via LibreOffice -> `partition_docx`):
  `https://docs.unstructured.io/open-source/core-functionality/partitioning`
