---
doc_type: runbook
status: active
created: 2026-04-11
updated: 2026-04-28
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
- 再确认 candidate 真的是独立 regulation owner body

固定 operator 规则：

- title-signal 高于 body citation / body heading
- section heading 不得被当成 regulation title 证据
- 当前 materialization 只对已接受 candidate 执行，不对未审 current scope 全量推进

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

## Step 3: Materialize Accepted Candidates

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
- target `document_id` 不从 `notice_id` 派生
- duplicate candidate 合并为一个 canonical target document
- target scope 使用 scope refresh
- downstream materializer 只读 consumption projection ready truth；projection
  缺失时 fail closed，不回扫 source-truth inventory 扩张 candidate

## Step 4: Document-Site Dry-Run

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
- generated target records 可以同时覆盖 `regulations/institutional_rules` 与
  `regulations/scoped_rules`
- 输出 document reader assets 只作为 dry-run artifact，不表示 public docs deploy、
  RAG release 或 query-serving 已开放

## Step 5: Formal Selected Import After Dry-Run

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

## Step 6: Repo-Local Materialization Snapshot Mode

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

## Step 7: Hand Off To Target-Side Quality Acceptance

manifest build 与 target materialization 完成后，下一步固定进入：

- `docs/runbooks/internal-notice-regulation-target-quality-acceptance-runbook.md
  `

不要在本文内继续扩成 chunk preparation、embedding 或 release。
