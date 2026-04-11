---
doc_type: runbook
status: active
created: 2026-04-11
updated: 2026-04-11
---

# Internal Notice Regulation Promotion Runbook

## 文档边界

这份 runbook 只描述一件事：

- 如何把 `campus_notices/internal_notice` 中已经通过 promotion gate 的 canonical regulation text 物化到 `regulations/institutional_regulations`

它不替代：

- `docs/runbooks/authenticated-notice-source-truth-replay-runbook.md` 的 replay / closeout / release 主链路
- `docs/reference/institutional-regulations-promotion-quality-acceptance.md` 的验收标准
- `docs/decisions/adr-0035-notice-derived-regulation-promotion-boundary.md` 的边界决策

## 当前边界

- source scope 固定为 `campus_notices/internal_notice`
- target scope 固定为 `regulations/institutional_regulations`
- target collection posture 固定为 `offline_preparation`
- 当前 runbook 只覆盖 manifest build + target materialization
- 当前 runbook 不覆盖 chunk preparation、embedding、Qdrant release、alias publish

## 执行顺序

### 1. 先看 promotion manifest

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

- 先确认本轮 `promote_candidate / hold_in_internal_notice / manual_review_required` 分布
- 再执行 target collection materialization

### 2. 执行 target collection materialization

```bash
uv run --package campus-ingestion-worker python -m campus_ingestion_worker.materialize_internal_notice_regulation_candidates \
  --corpus campus_notices \
  --collection internal_notice
```

可选过滤：

- `--notice-id <id>`
- `--document-id <id>`
- `--promotion-routing-path <path>`

当前 worker 固定行为：

- 只消费 `promote_candidate`
- target `document_id` 不从 `notice_id` 派生
- duplicate candidate 会合并到一个 promoted target document，并在 metadata 中聚合 provenance
- target scope 使用 scope refresh，全量替换 `regulations/institutional_regulations`

### 3. Repo-local snapshot mode

如果需要脱离 env backends，用本地快照运行：

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

## 当前输出真相

materialization 当前会写入：

- `regulations/documents/institutional_regulations/.../canonical.md`
- `regulations/documents/institutional_regulations/.../document-units.jsonl`
- `regulations/institutional_regulations` registry rows

metadata 当前至少保留：

- `promotion_class`
- `promotion_source_collection`
- `source_notice_ids`
- `source_document_ids`
- `source_parent_document_id`
- `source_attachment_ref_id`
- `source_attachment_ref_ids`
- `source_attachment_sha256`
- `source_attachment_sha256s`
- `regulation_title_normalized`
- `issuing_org`
- `effective_date`
- `revision_signal`

## 固定禁止

- 不把 `internal_notice` alias 当作 query-serving 打开
- 不在这个 worker 里直接做 chunk preparation
- 不在这个 worker 里直接做 embedding / Qdrant write
- 不在没有单独批准的情况下做 target collection release / alias publish
