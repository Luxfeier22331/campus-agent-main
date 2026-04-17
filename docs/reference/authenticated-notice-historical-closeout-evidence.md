---
doc_type: reference
status: historical
created: 2026-04-06
updated: 2026-04-12
---

# Authenticated Notice Historical Closeout Evidence

## 文档边界

这份文档只记录 `campus_notices/internal_notice` 历史 closeout 的 repo-tracked 证据。

它不负责：

- 重复 async staged closeout 的操作步骤
- 宣布 `internal_notice` 已开放 query-serving
- 取代 `.planning/STATE.md` 的执行顺序

## Final Run

- `run_id=authenticated-notice-replay-20260406-024405`
- `state=done`
- `input_kind=source_truth_replay`
- `operations_prefix=campus_notices/operations/authenticated-notice-closeout/authenticated-notice-replay-20260406-024405`
- `planned_at=2026-04-05T18:55:14.455479+00:00`
- `started_at=2026-04-05T19:13:25.664982+00:00`
- `finished_at=2026-04-06T03:18:34.333801+00:00`
- `promotion_id=promotion-0001`

## Verification Truth

- `verification.ok=true`
- `expected_notice_count=6694`
- `required_document_count=6696`
- `expected_document_id_count=6962`
- `expected_raw_asset_id_count=6694`
- `missing_attachment_outcome_count=0`
- `unexpected_document_id_count=0`
- `invalid_attachment_outcome_count=0`
- `materialized_ocr_attachment_document_count=266`
- `no_extractable_text_attachment_count=2`

说明：

- `required_document_count=6696` 表示必须存在的 final document 基线。
- `expected_document_id_count=6962` 表示 verification 过程中实际闭合的完整 document identity scope。

## Promotion Truth

- `copy_batch_count=55`
- `copy_completed_batch_count=55`
- `copy_failed_batch_count=0`
- `copied_document_count=6962`
- `copied_object_count=14192`
- `raw_asset_synced_count=6694`
- `raw_asset_upsert_count=6694`
- `replaced_scope_record_count=6962`

## Closed Incidents

- editor static asset `.../UEditor/themes/default/images/spacer.gif` 已被固定回 `reference_only`，不再误入 OCR lane
- `run_authenticated_notice_closeout_worker --parallel-workers` 的 accepted shape 现为父进程编排 + 子进程 worker，而不是单进程线程池
- repair 现可识别 stale completed batch，清空旧 stage rows、重开 batch 并补齐 `attachment_outcomes`

## Historical Posture

- historical closeout 已经完成，canonical source-truth scope 与 promotion scope 均已闭合
- `campus_notices/internal_notice` 仍保持 `restricted + offline_preparation`
- closeout 完成不等于 query-serving 开放
- closeout 之后的下一条 canonical 动作先是从 registry current truth 执行 offline `prepare_registry_scope_chunks`
- 只有 verified chunk preparation 成功后，才允许执行 `release_registry_scope --preparation-run-id <prep_id> --no-publish-alias`
