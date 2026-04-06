---
doc_type: plan
status: active
created: 2026-04-03
updated: 2026-04-05
---

# Authenticated Notice Source Foundation

## 文档边界

本文只负责 `authenticated_notice_portal` source channel 的前向实施 handoff。

本文不负责：

- 替代 `docs/architecture/authenticated-notice-source-architecture.md` 的长期边界
- 替代 `ADR-0024` 的 source-channel / runtime ownership 决策
- 宣称该 source channel 已进入当前 merged truth

## 目标

把一套当前位于 repo 外的登录态内部通知采集器，重构成 `campus-agent` 可长期吸收的 source channel foundation，同时保持：

- collector runtime 与 data plane 分层
- typed bootstrap seam 只是过渡接入方式，不是长期 truth
- 首个下游 collection 默认 restricted 且 `offline_preparation`

## 实施问题

这份文档只回答六个问题：

- source channel 与首个 collection 的命名与目录如何冻结
- bootstrap import seam 要读什么、写什么
- canonical source-truth 需要哪些 artifacts
- collector 迁入 repo 时哪些模块保留、哪些模块重写
- restricted rollout 的默认发布顺序是什么
- 需要什么验证证据

## 已冻结默认值

本轮已确认以下默认值，不再继续作为开放问题：

- source channel：
  - `authenticated_notice_portal`
- collector app：
  - `apps/authenticated-notice-collector`
- 首个 collection：
  - `campus_notices/internal_notice`
- 发布姿态：
  - `restricted`
  - `offline_preparation`
- bootstrap seam：
  - 允许消费 export bundle + object-keyed attachments
  - 不把 SQLite / export schema 升级为长期 contract

## 实施顺序

### Wave 1：Collection Config And Import Contract Freeze

当前 repo 已经存在：

- `configs/ingestion/campus_notices/internal_notice/runtime-profile.json`
- `configs/ingestion/campus_notices/internal_notice/canonical-profile.json`
- `configs/ingestion/campus_notices/internal_notice/chunk-profile.json`
- collection README

这一 wave 的任务不再是“从零新增 config”，而是把现有 config 与 import contract 一起正式纳入 phase truth，并补齐 focused verification 与 `.planning` 记录。

要求：

- `serving_stage=offline_preparation`
- `retrieval_enabled=false`
- `query_enabled_by_default=false`
- canonical profile 明确 `notice` 是 primary source unit

同时在 `packages/ingestion-core` 冻结 import contract：

- importer 输入：
  - `notices-bundle-*.json`
  - blob/object manifest
  - typed collector metadata
- importer 输出：
  - `capture/*`
  - `provider/*`
  - `source-truth/*`
  - document registry inputs

### Wave 2：Bootstrap Importer

在 `packages/ingestion-core` 增加 authenticated notice importer，至少完成：

- 从 bundle 读取 notice metadata、正文 HTML、分类、links、attachments
- 基于 `site_id + notice_id` 生成 `raw_asset_id`
- 基于 notice 实质内容生成 `raw_version_id`
- 写 notice source-truth：
  - `notice-manifest.json`
  - `content-blocks.jsonl`
  - `attachment-refs.jsonl`
- 生成 document import inputs

在 `apps/ingestion-worker` 增加一个新入口命令，用于：

- backfill 一次性导入
- 局部重跑某个 notice 或某批 bundle

当前这条 wave 已具备 repo-local importer 与 worker 入口，但下一步重点是：

- historical export first
- 按 `1 -> 50 -> 240 -> 6694` 做 staged replay
- 每轮把 smoke summary 落到 `.tmp/authenticated-notice-smoke/<timestamp>/summary.json`
- 记录 created / updated / skipped / raw_uploaded / raw_reused / errors，而不是只看 exit code
- authenticated notice 的空 `attachment-observations.jsonl` / `attachment-refs.jsonl` 属于合法 source-truth 产物；repo-local MinIO 如在 zero-byte `put_object` 后拖慢复用连接，worker 侧应隔离空对象写入，而不是把 empty artifact 语义偷偷改掉
- collector bootstrap export 应至少产出 typed reference-only `links / notice_attachments / attachments`，但不得把 `local_path` 或临时文件系统布局提升成长期 object-storage truth

当前 worktree 已完成的 bounded replay 证据：

- `2` 条：`.tmp/authenticated-notice-smoke/20260404T131900-2-timed/summary.json`
- `10` 条：`.tmp/authenticated-notice-smoke/20260404T131350-10/summary.json`
- `50` 条：`.tmp/authenticated-notice-smoke/20260404T131544-50/summary.json`
- `240` 条：`.tmp/authenticated-notice-smoke/20260404T152745-240/summary.json`

当前明确 deferred：

- `6694` 及更大 backfill
- live portal 恢复后的 scheduled run / incremental sync
- authenticated notice control plane

### Wave 3：Restricted Document Projection

把 importer 生成的 document import inputs 接到 registry / chunk pipeline。

最小要求：

- document registry 主写入 `visibility_level=restricted`
- 初始 `entitlement_groups` 使用明确的 restricted baseline
- 当前 collection 不开 query-serving

建议优先策略：

- 先独立 restricted collection
- 暂不混入 public collection

当前这条 wave 的实现重点已经从“能导入 notice”前移到“消费已导入 source-truth”：

- parent notice document 从 source-truth replay 重建，只保留 notice 正文结构单元
- `attachment-refs.jsonl` 不再继续混入父 notice document-units
- 已下载附件按 extraction class 生成 restricted child documents，并继承父 notice 授权投影
- scope refresh 使用一次 `replace_scope(corpus, collection, records)` 收口父 notice 与 child attachment documents

本轮固定 extraction class：

- `reference_only`
  - 只保留 attachment ref truth，不生成 child document
- `text_extractable`
  - 当前至少覆盖 `docx`
- `ocr_required`
  - 当前至少覆盖 image-heavy historical corpus：`png`、`jpg`、`jpeg`、`bmp`、`gif`
- `unsupported_binary`
  - 直接 fail，不做隐式降级

当前历史附件现实分布决定了 wave 3 必须把 image OCR 放在主路径上，而不是先围绕 Office 文档设计：

- `attachments-20260403-full.json` 总量：`2399`
- `image/png`：`1575`
- `image/jpeg`：`819`
- `docx`：`1`

因此本轮 implementation 目标是：

- repo-native source projection config
- attachment projection/materialization runner
- parent/child document replay tests
- `internal_notice` collection-specific chunk guard，显式跳过 `attachment_ref`
- restricted scope rebuild verification

### Wave 4：Collector Repo Migration

把 repo 外 collector 迁入 monorepo 时，按下面拆分：

- 保留：
  - auth bootstrap / refresh
  - list/detail fetch
  - 正文 link/attachment enrich
  - object upload
- 降级：
  - SQLite 仅作为 app 内 cache / dedupe / runtime state
- 移除其系统间 truth 地位：
  - export JSON 不再是长期 repo contract

迁入后 collector 应直接产出 repo 认可的 typed artifacts，而不是继续要求 ingestion 只认旧 bundle shape。

当前收敛方向：

- collector export manifest 要显式携带 notice-type policy snapshot，而不是只留下 type id 列表
- 正文 link / attachment observation 默认允许停留在 reference-only 语义
- reference-only attachment 允许 `object_key=null`，但 `normalized_source_url` / `origin_scope` / `resource_role` 必须显式

### Wave 5：Optional Control Plane

如果后续需要持续调度、run ledger、operator read model，再新增 dedicated control-plane domain。

要求：

- 这是后续 wave，不阻塞 source-truth foundation
- 不复用 `official_web` command/query APIs
- 不让 `apps/ingestion-worker` 承担 collector control plane

## 代码落点建议

### Docs

- `docs/architecture/authenticated-notice-source-architecture.md`
- `docs/architecture/authenticated-notice-source-truth-contract.md`
- `docs/decisions/adr-0024-authenticated-notice-source-channel.md`

### Ingestion

- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_import.py`
- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_source_truth.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/import_authenticated_notice_export.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/smoke_authenticated_notice_bootstrap.py`

### Config

- `configs/ingestion/campus_notices/internal_notice/README.md`
- `configs/ingestion/campus_notices/internal_notice/runtime-profile.json`
- `configs/ingestion/campus_notices/internal_notice/canonical-profile.json`
- `configs/ingestion/campus_notices/internal_notice/chunk-profile.json`

### Collector

- `apps/authenticated-notice-collector/`

## 验证要求

至少补齐以下验证：

- collection config tests
  - `internal_notice` 使用 repo-tracked runtime / canonical / chunk profiles
  - `retrieval_enabled=false`
  - `query_enabled_by_default=false`
- importer unit tests
  - stable `raw_asset_id` / `raw_version_id`
  - HTML -> content blocks conversion
  - attachment refs normalization
- registry/chunk tests
  - restricted projection write-in
  - no query-serving by default
- bootstrap smoke
  - 从一份真实 bundle 成功导入 source-truth + document registry
- leakage guards
  - restricted collection 未授权时不得进入公开 query path

对应 runbook：

- `docs/runbooks/authenticated-notice-bootstrap-smoke-runbook.md`

## 推荐验证命令

Python baseline:

```bash
uv run --package campus-ingestion-worker python -m unittest \
  tests.ingestion.test_collection_config \
  tests.ingestion.test_corpus_runtime_profile \
  tests.ingestion.test_authenticated_notice_import \
  tests.ingestion.test_import_authenticated_notice_export_worker \
  tests.ingestion.test_smoke_authenticated_notice_bootstrap_worker
```

JS/TS baseline:

```bash
pnpm --dir apps/authenticated-notice-collector typecheck
pnpm --dir apps/authenticated-notice-collector test
pnpm --dir apps/authenticated-notice-collector build
```

## 当前不做

- 不在本轮把 `authenticated_notice_portal` 接成 public query surface
- 不在本轮落 panel / operator control plane
- 不在本轮把 collector 外部 repo 的命名或目录结构原样保留为长期 truth
