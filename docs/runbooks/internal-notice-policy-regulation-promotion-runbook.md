---
doc_type: runbook
status: active
created: 2026-04-11
updated: 2026-04-20
---

# Internal Notice Regulation Promotion Runbook

## 文档边界

这份 runbook 只描述一件事：

- 如何把 `campus_notices/internal_notice` 中已经通过 promotion gate 的 canonical regulation text 物化到 regulation target

它不替代：

- replay / closeout 主链路
- promotion / materialization acceptance truth
- target-side chunk / metadata / quality acceptance runbook

相关文档：

- `docs/reference/institutional-regulations-promotion-quality-acceptance.md`
- `docs/reference/institutional-regulations-offline-inventory.md`
- `docs/runbooks/internal-notice-regulation-target-quality-acceptance-runbook.md`
- `docs/decisions/adr-0035-notice-derived-regulation-promotion-boundary.md`
- `docs/decisions/adr-0040-regulation-work-title-and-edition-separation.md`

## Current Boundary

- source scope 固定为 `campus_notices/internal_notice`
- target scope 固定为 regulation target collection
- target posture 固定为 `offline_preparation`
- 本 runbook 只覆盖 manifest build + target materialization
- 不覆盖 embedding、Qdrant、release、alias publish

## Step 1: Build Promotion Manifest

```bash
uv run --package campus-ingestion-worker python -m campus_ingestion_worker.build_internal_notice_regulation_promotion_manifest \
  --corpus campus_notices \
  --collection internal_notice
```

可选过滤：

- `--notice-id <id>`
- `--document-id <id>`
- `--promotion-routing-path <path>`

operator 目标：

- 先确认 `promote_candidate / hold_in_internal_notice / manual_review_required` 分布
- 再确认 candidate 真的是独立 regulation owner body

固定 operator 规则：

- title-signal 高于 body citation / body heading
- section heading 不得被当成 regulation title 证据
- 当前 materialization 只对已接受 candidate 执行，不对未审 current scope 全量推进

## Step 2: Optional Targeted Source Projection Rebuild

当某条 notice 已确认应该由 attachment owner 推进，但当前 source scope 缺少对应 child document 时，先执行：

```bash
uv run --package campus-ingestion-worker python -m campus_ingestion_worker.rebuild_authenticated_notice_source_projections \
  --corpus campus_notices \
  --collection internal_notice \
  --notice-id <notice_id>
```

固定要求：

- `--notice-id` 模式是定向 rebuild
- 这一步只修 source / attachment projection，不等于 regulation target materialization

## Step 3: Materialize Accepted Candidates

```bash
uv run --package campus-ingestion-worker python -m campus_ingestion_worker.materialize_internal_notice_regulation_candidates \
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

## Step 4: Repo-Local Snapshot Mode

如果需要脱离 env backend，用隔离 snapshot 运行：

```bash
uv run --package campus-ingestion-worker python -m campus_ingestion_worker.materialize_internal_notice_regulation_candidates \
  --documents-json /tmp/internal-notice-documents.json \
  --source-truth-inventory-json /tmp/internal-notice-source-truth-inventory.json \
  --object-store-root /tmp/object-store-root
```

固定要求：

- `--documents-json`
- `--source-truth-inventory-json`
- `--object-store-root`

必须三者同时提供。

operator 规则：

- `--object-store-root` 不得直接指向长期 source snapshot 输出根
- local-only acceptance 必须使用隔离 target 输出目录

## Step 5: Hand Off To Target-Side Quality Acceptance

manifest build 与 target materialization 完成后，下一步固定进入：

- `docs/runbooks/internal-notice-regulation-target-quality-acceptance-runbook.md`

不要在本文内继续扩成 chunk preparation、embedding 或 release。
