---
doc_type: runbook
status: active
created: 2026-04-11
updated: 2026-05-01
---
# Internal Notice Regulation Promotion Runbook

## 文档边界

这份 runbook 只描述一件事：

- 如何把 `campus_notices/internal_notice` 中已经通过 promotion gate 的 canonical
  regulation text 物化到 regulation target

它不替代：

- replay / closeout 主链路
- promotion / materialization acceptance truth
- target-side chunk / metadata / quality acceptance runbook

相关文档：

- `docs/reference/institutional-regulations-promotion-quality-acceptance.md`
- `docs/reference/institutional-regulations-offline-inventory.md`
- `docs/runbooks/internal-notice-regulation-target-quality-acceptance-runbook.md
  `
- `docs/decisions/adr-0035-notice-derived-regulation-promotion-boundary.md`
- `docs/decisions/adr-0037-unified-scoped-rules-holding-collection.md`
- `docs/decisions/adr-0040-regulation-work-title-and-edition-separation.md`

## Current Boundary

- source scope 固定为 `campus_notices/internal_notice`
- consumer admission 对 regulation 使用 `target_surface=regulations/*`
- concrete target scope 由 consumption projection / materializer 解析：
  - `institutional_regulation` -> `regulations/institutional_rules`
  - `annual_cycle_rule` / `time_bound_operational_rule` ->
    `regulations/scoped_rules`
- target posture 固定为 `offline_preparation`
- 本 runbook 覆盖 manifest build、selected dry-run、dry-run 后正式 selected
  import、target materialization 与 document reader asset publish
- 不覆盖 embedding、Qdrant、release、alias publish
- 文档站、docs read-model 与 RAG/chunk-prep 只消费 target canonical scope：
  `regulations/institutional_rules` 与 `regulations/scoped_rules`
- `campus_notices/internal_notice` 中被 hold 的 partial / wrapper / amendment-summary
  notice 只保留 notice-level title/url/card/query，不允许直接进入 docs reader、
  docs read-model 或 regulation chunk-prep

## Step 1: Build Promotion Manifest

```bash
uv run --package campus-ingestion-worker python -m \
  campus_ingestion_worker.build_internal_notice_regulation_promotion_manifest \
  --corpus campus_notices \
  --collection internal_notice
```

可选过滤：

- `--notice-id <id>`
- `--document-id <id>`
- `--promotion-routing-path <path>`

operator 目标：

- 先确认 `promote_candidate / hold_in_internal_notice /
  requires_multimodal_processing / no_adoption` 分布
- 对 regulation admission preview，`historical_annual_cycle_rule_hold` 与
  `historical_time_window_rule_hold` 都是 stop condition，不得继续 formal
  import
- 再确认 candidate 真的是独立 regulation owner body

固定 operator 规则：

- title-signal 高于 body citation / body heading
- section heading 不得被当成 regulation title 证据
- 当前 materialization 只对已接受 candidate 执行，不对未审 current scope 全量推进

## Step 1A: Batch Admission Audit For Collected Notices

当 selected cohort 来自 collected notice bundle，必须先用 batch audit 固化每条 notice
的 admission 结果，再决定是否进入 target materialization：

```bash
uv run --package campus-ingestion-worker python -m \
  campus_ingestion_worker.audit_collected_notice_regulation_admission_batch \
  --selection-json /tmp/selection.json \
  --bundle-json /tmp/notices-bundle.json \
  --output-dir /tmp/collected-notice-regulation-admission-audit \
  --generated-at 2026-05-01T00:00:00+08:00 \
  --expect 186977:historical_annual_cycle_rule_hold:search_only \
  --expect 191176:historical_time_window_rule_hold:search_only
```

可选参数：

- `--allow-missing` 只允许在 audit 输入 bundle 不完整、且 operator 明确接受 coverage
  缺口时使用；默认 missing selected notice 是 fail-closed
- `--expect <notice_id>:<regulation_admission_class>:<consumption_class>` 用于锁定已知
  样本预期

输出：

- `summary.json`
- `admission-manifest.json`
- `coverage.json`

固定 operator 规则：

- `historical_annual_cycle_rule_hold` 与 `historical_time_window_rule_hold`
  固定是 search-only，不进入 `regulations/*`
- expectation mismatch 必须 fail closed，不允许继续 formal import
- audit summary 是 admission evidence，不是 target materialization，也不写入 source truth

## Step 2: Optional Targeted Source Projection Rebuild

当某条 notice 已确认应该由 attachment owner 推进，但当前 source scope 缺少对应 child document
时，先执行：

```bash
uv run --package campus-ingestion-worker python -m \
  campus_ingestion_worker.rebuild_authenticated_notice_source_projections \
  --corpus campus_notices \
  --collection internal_notice \
  --notice-id <notice_id>
```

固定要求：

- `--notice-id` 模式是定向 rebuild
- 这一步只修 source / attachment projection，不等于 regulation target materialization

## Step 3: Build Owner-Recovery Report For Held Notices

当 promotion / selected cohort audit 显示某条 regulation-like notice 缺少完整 owner
body 时，先生成 owner-recovery report：

```bash
uv run --package campus-ingestion-worker python -m \
  campus_ingestion_worker.build_internal_notice_regulation_owner_recovery \
  --corpus campus_notices \
  --collection internal_notice \
  --notice-id <notice_id> \
  --output-dir /tmp/internal-notice-regulation-owner-recovery
```

可选过滤：

- `--notice-id <id>`
- `--selection-path <path>`
- `--without-promotion-manifest`
- `--without-file-release-inventory`

固定 lookup 顺序：

1. 已采集并 materialized 的 notice attachment child document
2. authenticated `file_release_capture`
3. `official_web/*` source document
4. existing `regulations/*` registry document

固定 operator 规则：

- 只有找到 source-backed owner candidate，才能继续进入 owner processing /
  promotion；不得用 LLM 补写缺失制度正文
- 未找到 owner source 的 notice 必须 fail closed，保留 notice-level title/url/card/query
- owner-recovery report 是 admission evidence，不是 target materialization，也不打开
  docs/RAG release

## Step 4: Materialize Accepted Candidates

institutional regulations:

```bash
uv run --package campus-ingestion-worker python -m \
  campus_ingestion_worker.materialize_internal_notice_regulation_candidates \
  --corpus campus_notices \
  --collection internal_notice
```

scoped rules:

```bash
uv run --package campus-ingestion-worker python -m \
  campus_ingestion_worker.materialize_internal_notice_scoped_rules \
  --corpus campus_notices \
  --collection internal_notice
```

可选过滤：

- `--notice-id <id>`
- `--document-id <id>`
- `--promotion-routing-path <path>`

当前固定行为：

- 只消费 `promote_candidate`
- `policy_regulation` 只是 source triage signal，不是 target promotion
  eligibility
- 明显历史年度周期规则或已过期时间窗口规则必须 hold in
  `campus_notices/internal_notice`，例如
  `药学院2021年硕博连读博士研究生招生实施细则` 与
  `生命与环境科学学院关于2021年暑假期间实验室安全管理规定` 应保留为
  notice-level query，不发布到 `regulations/scoped_rules`
- target `document_id` 不从 `notice_id` 派生
- duplicate candidate 合并为一个 canonical target document
- target scope 使用 scope refresh
- downstream materializer 只读 consumption projection ready truth；projection
  缺失时 fail closed，不回扫 source-truth inventory 扩张 candidate

## Step 5: Document-Site Dry-Run

如果需要验证 selected `regulation_candidate` 是否能进入 document storage 与
canonical document reader asset package，但仍不开放 query-serving，使用 dry-run
入口：

```bash
uv run --package campus-ingestion-worker python -m \
  campus_ingestion_worker.dry_run_internal_notice_regulation_document_site \
  --documents-json /tmp/internal-notice-documents.json \
  --source-truth-inventory-json \
    /tmp/internal-notice-source-truth-inventory.json \
  --object-store-root /tmp/object-store-root \
  --output-dir /tmp/internal-notice-regulation-document-site-dry-run \
  --notice-id <notice_id>
```

固定要求：

- `--documents-json`
- `--source-truth-inventory-json`
- `--object-store-root`
- `--output-dir`
- `--notice-id` 或 `--selection-path`

必须显式选择 notice；不允许全量扫描 source-truth inventory。

operator 规则：

- `--object-store-root` 不得直接指向长期 source snapshot 输出根
- local-only dry-run 必须使用隔离 target 输出目录
- admission manifest 使用 `target_surface=regulations/*`
- dry-run 必须证明 selected notice 通过 applicability gate；如果输出
  `historical_annual_cycle_rule_hold` 或 `historical_time_window_rule_hold`，该
  notice 不得继续进入 formal import
- generated target records 可以同时覆盖 `regulations/institutional_rules` 与
  `regulations/scoped_rules`
- 输出 document reader assets 只作为 dry-run artifact，不表示 public docs deploy、
  RAG release 或 query-serving 已开放

## Step 6: Formal Selected Import After Dry-Run

dry-run 通过后，使用 formal selected import 入口把同一批 selected notice 写入
source-truth PG/object store、consumption projection、regulation target scope 和
document-reader asset manifest：

```bash
uv run --package campus-ingestion-worker python -m \
  campus_ingestion_worker.publish_internal_notice_regulation_document_site \
  --bundle-path /tmp/notices-bundle.selected.json \
  --manifest-path /tmp/export-manifest.selected.json \
  --dry-run-report-path \
    /tmp/internal-notice-regulation-document-site-dry-run/dry-run-report.json \
  --output-dir /tmp/internal-notice-regulation-document-site-import \
  --site-id muc_internal_portal \
  --source-home-url https://portal.example.edu/home \
  --notice-id <notice_id>
```

固定要求：

- 必须先有同一 selection 的 `dry-run-report.json`
- `dry-run-report.json` 必须证明：
  - `query_serving_opened=false`
  - `rag_release_opened=false`
  - `ready_projection_entry_count > 0`
  - `materialized_document_count > 0`
  - `reader_document_count > 0`
- formal import 永远是 `upsert_selected`
- formal import 会从输入 bundle 中过滤 selected notices，写出
  `selected-notices-bundle.json` 和 `selected-export-manifest.json`
- selected materialization 不得 refresh 整个 target scope；已有
  `regulations/institutional_rules` / `regulations/scoped_rules` records 必须保留
- document reader manifest 必须包含 target scope 当前所有 active/current records，
  不能只包含 selected notice，否则 app-api docs read model 的 scope replace 会删掉既有文档
- publish report 必须保留 `docs_read_model_scope_write_mode` 与
  `target_scope_snapshot_document_counts`；前者固定为
  `replace_manifest_scopes_with_full_current_target_snapshot`，后者用于审计本次
  docs manifest 是否覆盖目标 scope 当前全集
- document reader manifest 的 `collections` / `documents` 必须是 docs read-model
  allowlist scope；`campus_notices/internal_notice` 是 source notice scope，不是
  document-site target scope

动态更新口径：

- 每次新增 selected regulation notice 只做 selected source-truth / projection /
  target materialization upsert，不做 target scope replace
- 每次导入 app-api docs read model 前，重新从 target registry 生成
  `regulations/institutional_rules` / `regulations/scoped_rules` 的当前全集
  reader manifest
- app-api docs read-model importer 继续按 manifest scopes replace；安全前提是
  manifest 是 scope snapshot，而不是 selected-only artifact
- 这条链路只更新 document storage / reader assets / docs read model；不触发
  embedding、RAG release、query-serving alias 或 public-chat 入口打开

如果要把 reader manifest 正式导入 app-api docs PG：

```bash
manifest=/tmp/internal-notice-regulation-document-site-import/docs-read-model-manifest.json
DOCS_READ_MODEL_MANIFEST_PATH="$manifest" \
pnpm --dir apps/app-api docs:import-read-model
```

或在 worker 中显式追加：

```bash
--import-docs-read-model
```

这一步只开放 document storage / document reader control plane，不开放
RAG release 或 regulation query-serving collection。

## Step 6A: Exact Target-Side Residue Cleanup

当历史误流程已经把 held notice 写入 regulation target side，必须用 exact target identity
清理残留；不得清理 source truth、`campus_notices/internal_notice`、historical
planning scratch 或无关 target rows/objects/points。

dry-run 默认只备份与审计：

```bash
uv run --package campus-ingestion-worker python -m \
  campus_ingestion_worker.cleanup_internal_notice_regulation_target_residue \
  --notice-id 186977 \
  --title 药学院2021年硕博连读博士研究生招生实施细则 \
  --collection scoped_rules \
  --document-id \
    institutional_regulation:muc:药学院2021年硕博连读博士研究生招生实施细则:b398c5cfe7e3 \
  --version-id sha256:<target-version> \
  --target-key \
    regulations/documents/scoped_rules/<exact-target-key>/canonical.md \
  --qdrant-collection scoped_rules__r20260501 \
  --target-surface regulations/scoped_rules \
  --output-dir /tmp/notice-186977-target-residue-cleanup
```

确认 `postgres-row-backup.json`、object backups 与 dry-run manifest 后，才允许追加
`--apply`：

```bash
uv run --package campus-ingestion-worker python -m \
  campus_ingestion_worker.cleanup_internal_notice_regulation_target_residue \
  --notice-id 186977 \
  --title 药学院2021年硕博连读博士研究生招生实施细则 \
  --collection scoped_rules \
  --document-id \
    institutional_regulation:muc:药学院2021年硕博连读博士研究生招生实施细则:b398c5cfe7e3 \
  --version-id sha256:<target-version> \
  --target-key \
    regulations/documents/scoped_rules/<exact-target-key>/canonical.md \
  --qdrant-collection scoped_rules__r20260501 \
  --target-surface regulations/scoped_rules \
  --output-dir /tmp/notice-186977-target-residue-cleanup \
  --apply
```

固定要求：

- Postgres delete 只按 `collection/document_id/version_id` exact match
- object store delete 只删显式 `--target-key`
- Qdrant delete 只删 `document_id/version_id` 粗筛后匹配
  `source_notice_ids|notice_id` 与 `target_surface` 的 points
- cleanup manifest 必须记录
  `postgres_exact_remaining`、`object_store_exact_keys_remaining` 与
  `qdrant_residue_count`
- app-api / protected panel 只显示 compact audit/cleanup counts 和 run ids，不暴露
  bucket、object key、backup path 或 raw operations path

## Step 7: Repo-Local Materialization Snapshot Mode

如果只需要脱离 env backend 验证某个 target materializer，可用隔离 snapshot 运行
对应 materializer：

```bash
uv run --package campus-ingestion-worker python -m \
  campus_ingestion_worker.materialize_internal_notice_regulation_candidates \
  --documents-json /tmp/internal-notice-documents.json \
  --source-truth-inventory-json \
    /tmp/internal-notice-source-truth-inventory.json \
  --object-store-root /tmp/object-store-root
```

或：

```bash
uv run --package campus-ingestion-worker python -m \
  campus_ingestion_worker.materialize_internal_notice_scoped_rules \
  --documents-json /tmp/internal-notice-documents.json \
  --source-truth-inventory-json \
    /tmp/internal-notice-source-truth-inventory.json \
  --object-store-root /tmp/object-store-root
```

固定要求：

- `--documents-json`
- `--source-truth-inventory-json`
- `--object-store-root`

必须三者同时提供。

## Step 8: Hand Off To Target-Side Quality Acceptance

manifest build 与 target materialization 完成后，下一步固定进入：

- `docs/runbooks/internal-notice-regulation-target-quality-acceptance-runbook.md
  `

不要在本文内继续扩成 chunk preparation、embedding 或 release。

## Quality Gate Closeout Reference

当前 regulation notice promotion quality gate 的 closeout truth 固定在：

- `git history notice-derived regulation quality gate workstream`
- `git history notice-derived regulation quality gate state`
- `git history notice-derived regulation phase 06 closeout summary`

固定 acceptance 口径：

- selected cohort evidence 以 Phase 2 artifact 为准；
- `187233` 是 amendment-summary-only negative fixture；
- 当前 selected cohort 没有 import-eligible notice id；
- Phase 0 PG/bucket cleanup evidence 是本轮 closeout 的 target-reference audit；
- 后续若 owner-recovery 找到 source-backed complete owner document，必须先走同一
  selection 的 dry-run，再走 formal selected import；
- query-serving、RAG release、public/docs product entrypoint 不在本 runbook 内打开。
