# Quick Task 260411-ouc Summary

## Outcome

- 已为 `internal_notice` promotion candidate 落成 repo-native `local-only chunk prep / quality` 工具链。
- 新链路固定消费 `candidate-documents.jsonl`，生成 target-side `document-units.jsonl` 与 `chunks.jsonl` 预览，但不写 `regulations/*` registry、不写 Postgres、不写 Qdrant。
- 真实样本 `187233 / 关于修订《中央民族大学采购工作管理办法》的通知` 已完成 rebuilt candidate export + rebuilt chunk prep 验收。

## What Changed

- `packages/ingestion-core/src/campus_ingestion_core/internal_notice_regulation_promotion.py`
  - candidate artifact 现在额外固化 `source_uri`、`entitlement_groups`、`visibility_scope`、`visibility_level`、`embedding_model`、`is_current`
- `packages/ingestion-core/src/campus_ingestion_core/internal_notice_regulation_projection.py`
  - 新增 target-side projected document builder
  - 统一生成 `document_id` / `version_id` / projection metadata / `document-units.jsonl`
- `packages/ingestion-core/src/campus_ingestion_core/internal_notice_regulation_candidate_chunk_prep.py`
  - 新增 local-only candidate chunk-prep loader / exporter / validation summary
- `apps/ingestion-worker/src/campus_ingestion_worker/prepare_internal_notice_regulation_candidate_chunks.py`
  - 新增 worker CLI
- Tests
  - `tests/ingestion/test_internal_notice_regulation_candidate_chunk_prep.py`
  - `tests/ingestion/test_prepare_internal_notice_regulation_candidate_chunks_worker.py`
  - existing candidate export tests now cover ACL / visibility metadata

## Real Sample Evidence

使用 rebuilt inventory 后，真实样本输出落在：

- `candidate-export-rebuilt/`
- `chunk-prep-rebuilt/`

关键结果：

- `candidate_id = 0425aed278c86fda`
- `source_notice_release_time = 2021-02-28 16:09`
- `target_document_id = institutional_regulation:muc:中央民族大学采购工作管理办法:a2f1da036a48`
- `total_unit_count = 16`
- `total_chunk_count = 16`
- hard validation result:
  - `missing_title_chunk_count = 0`
  - `missing_contextualization_count = 0`
  - `missing_projection_metadata_count = 0`
  - `wrapper_notice_leak_chunk_count = 0`
  - `front_matter_leak_chunk_count = 0`

当前仍需记录的质量观察：

- `short_body_chunk_count = 7`
- 这说明 current `institutional_regulations` generic structure-first chunking 已经满足基本 hard gate，但仍存在若干 heading-like / short-body fragment
- 后续若进入 target collection materialization 前，应再单独评估是否需要 `institutional_regulations` 的 merge / semantic chunk tuning

## Important Finding

这次 real sample 还确认了一件必须显式记录的事情：

- `.tmp/historical-intake/run14-policy-regulation-expanded/local-smoke/registry/source-truth-inventory.json` 仍是旧快照
- 直接消费这份旧 inventory，会导致 `candidate-documents.jsonl` 中的 `source_notice_release_time = null`
- 在新的 hard gate 下，这种旧 candidate export 会被 `chunk-prep-stale-inventory/validation-summary.json` 显式判成 `passed=false`，并报出 `missing_projection_metadata_count = 16`
- 因此真实验收必须优先使用 rebuilt inventory entry，而不是盲信旧 local-smoke inventory

## Boundary

- No Postgres writes
- No target collection write
- No embedding / Qdrant
- No release / alias
- No OCR mode change

## External Rationale

这条链路采用的是“先把 candidate 投影成可复用的 target-side consumption unit，再做 local-only chunk quality”的保守路线，依据来自官方文档：

- Azure AI Search index projections:
  - <https://learn.microsoft.com/en-us/azure/search/search-how-to-define-index-projections>
- Azure AI Search chunking guidance:
  - <https://learn.microsoft.com/en-us/azure/search/vector-search-how-to-chunk-documents>
- Google Cloud Document AI custom splitter:
  - <https://cloud.google.com/document-ai/docs/custom-splitter>
