---
doc_type: decision
truth_scope: repository
owner_boundary: docs/decisions
decision_id: ADR-0025
status: superseded
created: 2026-04-04
updated: 2026-07-04
superseded_by:
  - adr-0054-ingestion-control-plane-and-kernel-boundary.md
  - adr-0063-internal-portal-source-channel-name.md
  - adr-0077-ingestion.md
  - docs/architecture/domains/authenticated-notice/architecture.md
---
# ADR-0025 Authenticated Notice Async Staged Closeout

适用范围：`authenticated_notice_portal` historical export closeout、对象存储 operations
prefix、staging tables、single-promoter commit、deterministic verification

## 当前状态说明

Superseded on 2026-07-04.

本文记录 historical authenticated notice closeout 的 staged-pipeline rationale。当前
notice mainline handoff 已收口为 ingestion-control task lifecycle 读取
`authenticated_notice_capture_release.v1` object-store refs；本文中的 historical operations
prefix、staging 表、single-promoter 与旧 closeout runner 不拥有当前 source-truth
materialization contract，不再作为当前 notice ingestion mainline 的 accepted
runtime 决策。

需要恢复 closeout 历史细节时，应从本文或 git history 提取具体事实，再提升到当前
domain architecture、data doc 或 runbook。

## 背景

Phase 12.1 的 historical closeout runner 已把 bundle / manifest / checkpoint /
reconciliation 收口成 repo-owned workflow，但它的核心执行模型仍然是：

- cumulative prefix replay
- 同一 `internal_notice` scope 的重复 `scope_refresh`
- 大 checkpoint 只能串行等待

对 `6694` 条历史 notice 而言，这种模型的代价已经明显暴露：

- checkpoint 成本随前缀扩大而累积
- progress visibility 依赖长时间运行中的同一进程
- 真实昂贵的工作其实是 per-notice source-truth / document artifact materialization，却没有被并行化
- canonical document scope 的 single-writer 语义又不允许把当前 importer 直接拆成多个 disjoint
  shard 并发写最终 scope

因此需要一条新的 closeout execution model，在不破坏 authenticated notice source-channel /
data-plane 边界的前提下，把可并行工作与 single-writer promotion 严格拆开。

## 决策 1：closeout 改为 staged async pipeline

canonical closeout pipeline 固定为：

`frozen bundle -> shard plan -> async shard executors -> staged artifacts/state
-> deterministic verification -> single promoter -> replace_scope`

其中：

- shard executor 只负责并发写 source-truth artifacts、staged document artifacts 和
  staging rows
- canonical `campus_notices/internal_notice` document scope 只能由 promoter 一次性提交
- 不再把 repeated cumulative rerun 当成 canonical closeout model

## 决策 2：operations prefix 固定落在对象存储

每次 closeout run 的 object-store truth 固定落在：

- `campus_notices/operations/authenticated-notice-closeout/{run_id}/`

至少包含：

- `run-manifest.json`
- `shard-plan.json`
- `heartbeat/shard-0001.json`
- `milestones/staged.json`
- `milestones/verified.json`
- `milestones/promoted.json`
- `reconciliation/verification.json`
- `promotions/promotion-0001.json`
- `staging/shards/<shard>/documents/...`

这些 artifacts 属于 operations / staging truth，不是 source-truth 或 final document
truth。

## 决策 3：staging state 固定落在独立 closeout schema

closeout staging tables 固定落在：

- `ingestion_closeout`

第一版表集合固定为：

- `closeout_runs`
- `closeout_shards`
- `closeout_notice_stage`
- `closeout_raw_asset_stage`
- `closeout_document_stage`
- `closeout_milestones`
- `closeout_promotions`

这些表负责记录：

- frozen input / run state
- shard heartbeat / attempt / progress
- per-notice artifact manifest
- per-raw-asset staged record
- per-document staged record、content hash、staged/final object refs
- milestone payload
- promotion result

它们不是长期 document registry，也不是 collector runtime state。

## 决策 4：source-truth 与 final document truth 分层写入

closeout 中的 artifact ownership 固定为：

- `capture/*`、`provider/*`、`source-truth/*` shard 可直接写 canonical source
  bucket/key，因为这些对象围绕 `raw_asset_id + raw_version_id` 稳定命名、天然可重放、且不承担 final
  document scope ownership
- `document-units` / canonical markdown shard 先写 operations prefix 下的 staged
  object，promoter 再复制到 canonical `campus_notices/documents/internal_notice/...`

因此：

- parallel shard 不会直接改最终 `documents/internal_notice`
- canonical source-truth 仍保持 source-channel upstream truth
- final document scope 仍保持 single-writer semantics

## 决策 5：verification 改为 deterministic staged verification

closeout promotion 前必须通过 deterministic verification。

第一版至少验证：

- expected notice count == staged notice count
- expected document ids / raw asset ids 已全部进入 staging
- staged document content hash 与 expected hash 一致
- staged raw version 与 expected raw version 一致
- `source-truth/notice-manifest.json` 对象存在
- staged `document-units.jsonl` 对象存在
- document scope 不存在 unexpected staged document ids

verification 失败时：

- run 进入 failed / verification-failed milestone
- 不允许 promote
- 不以 rerun 整个 bundle 作为默认 proof path

## 决策 6：canonical promotion 固定为 single promoter

promoter 的职责固定为：

- 读取 staged rows 与 staged object refs
- upsert expected raw assets
- 将 staged document artifacts 复制到 canonical final key
- 构造 final `DocumentRegistryRecord`
- 对 `campus_notices/internal_notice` 执行单次 `replace_scope`
- 写出 promotion / reconciliation artifact

禁止：

- shard 直接调用 final `replace_scope`
- 多个 promoter 同时写 canonical scope
- 用 disjoint shard 并发直接写 document registry

## 结果

直接结果如下：

- `packages/ingestion-core` 新增 authenticated notice closeout planner / store /
  service / verifier
- 历史实现曾在 `apps/ingestion-worker` 暴露 run / show / promote CLI；该 executable
  surface 已被 ingestion-control clean target 取代，不再是 active operation path
- historical cumulative closeout runner 降级为 legacy workflow，保留给已启动或需要对照的旧执行
- operations prefix 与 closeout staging schema 成为 authenticated notice historical
  closeout 的 canonical progress truth

## Complementary Docs

- `docs/architecture/domains/authenticated-notice/architecture.md`
- `docs/data/authenticated-notice.md`
- `docs/architecture/system/data-plane.md`
- `docs/runbooks/ingestion.md`
