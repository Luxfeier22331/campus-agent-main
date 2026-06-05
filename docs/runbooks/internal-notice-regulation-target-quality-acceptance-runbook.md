---
doc_type: runbook
status: active
created: 2026-04-19
updated: 2026-04-28
---
# Internal Notice Regulation Target Quality Acceptance Runbook

## 文档边界

这份 runbook 只描述一件事：

- 如何对已经 materialize 到 `regulations/institutional_rules` /
  `regulations/scoped_rules` 的 target current scope 做 local-only chunk /
  metadata / quality acceptance

它不替代：

- `docs/runbooks/internal-notice-policy-regulation-promotion-runbook.md` 的
  promotion manifest / target materialization 执行
- `docs/reference/institutional-regulations-promotion-quality-acceptance.md` 的
  acceptance truth
- `var/ingestion-evidence/authenticated-notice-regulation-consumption/README.md`
  的 workstream 顺序

## 当前边界

- 当前只做 local-only target-side acceptance
- 输入固定为已经 materialized 的 target registry rows + derived object-store
  `document-units.jsonl`
- 输出固定为 machine-readable acceptance artifacts：
  - `chunk-prep-manifest.json`
  - `validation-summary.json`
  - `document-reports.jsonl`
- 当前 stop point 继续固定在 `offline_preparation`
- chunk-prep 输入只认 target canonical scope：
  `regulations/institutional_rules` 与 `regulations/scoped_rules`
- `campus_notices/internal_notice` source records 即使出现在输入 registry snapshot
  中，也必须被 regulation target chunk-prep 忽略；它们只能通过 notice-level
  read-model/card/query 消费

当前不包括：

- embedding
- Qdrant write
- release
- alias publish

## Phase 8 Frozen Evidence

当前 bounded `11` 条 target 的 closeout evidence 已冻结在：

- `var/ingestion-evidence/authenticated-notice-regulation-consumption/evidence/phase-08-acceptance-freeze/`

冻结范围只包括 local-only acceptance artifact triplet：

- `chunk-prep-manifest.json`
- `validation-summary.json`
- `document-reports.jsonl`

最终 target 划分：

- `regulations/institutional_rules`: `2`
- `regulations/scoped_rules`: `9`

该 evidence 只证明 stop point `offline_preparation` 已通过，不代表 release /
query-serving 已打开。

## 前提

- 已先完成 `internal_notice` promotion manifest 与 target materialization
- 当前使用隔离的 snapshot / overlay 根目录承接 target acceptance artifact
- `documents.json` 与 object-store root 指向同一份 local target snapshot

## 1. 对 institutional_rules 做 target-side acceptance

```bash
uv run --package campus-ingestion-worker python -m \
  campus_ingestion_worker.prepare_institutional_regulation_chunks
  --documents-json /tmp/internal-notice-target-snapshot/documents.json \
  --object-store-root /tmp/internal-notice-target-snapshot/object-store \
  --output-dir /tmp/internal-notice-target-acceptance/institutional_rules
```

可选过滤：

- `--document-id <id>`

通过条件：

- `validation-summary.json.passed = true`
- `missing_title_chunk_count = 0`
- `missing_contextualization_count = 0`
- `missing_identity_metadata_count = 0`
- `invalid_semantic_owner_lineage_count = 0`
- `wrapper_notice_leak_chunk_count = 0`
- `front_matter_leak_chunk_count = 0`

固定 operator 解释：

- `attachment_document` owner 必须继续保留 notice 层和 owner 文档层的显式分离
- `source_notice_document_id` 与 `semantic_owner_document_id` 在 attachment-backed
  target 中不得相同
- `regulation_work_title` / `regulation_display_title` / `source_title_literal`
  缺失时必须 fail-close

## 2. 对 scoped_rules 做 target-side acceptance

```bash
uv run --package campus-ingestion-worker python -m \
  campus_ingestion_worker.prepare_scoped_rule_chunks
  --documents-json /tmp/internal-notice-target-snapshot/documents.json \
  --object-store-root /tmp/internal-notice-target-snapshot/object-store \
  --output-dir /tmp/internal-notice-target-acceptance/scoped_rules
```

可选过滤：

- `--document-id <id>`

通过条件：

- `validation-summary.json.passed = true`
- `missing_title_chunk_count = 0`
- `missing_contextualization_count = 0`
- `missing_projection_metadata_count = 0`
- `missing_cycle_year_count = 0`
- 对 `annual_cycle_rule`：
  - `missing_school_unit_name_count = 0`
- `wrapper_notice_leak_chunk_count = 0`
- `front_matter_leak_chunk_count = 0`

## 3. 验收产物检查

两条 target lane 都必须看到：

- `chunk-prep-manifest.json`
- `validation-summary.json`
- `document-reports.jsonl`

每个 document 目录下还应看到：

- `prepared-documents/<slug>--<target_suffix>/document-units.jsonl`
- `prepared-documents/<slug>--<target_suffix>/chunks.jsonl`

## 固定禁止

- 不把这一步误写成 release truth
- 不从 acceptance worker 直接继续 embedding / indexing
- 不对白名单外的更宽 source scope 做 unfiltered whole-scope rematerialization
- 不把 held / partial source notice 当成 target regulation document 做 chunk
  preparation
