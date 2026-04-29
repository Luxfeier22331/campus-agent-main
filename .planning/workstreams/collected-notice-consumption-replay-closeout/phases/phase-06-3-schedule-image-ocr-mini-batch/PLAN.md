---
doc_type: plan
status: completed
created: 2026-04-29
updated: 2026-04-29
---

<!-- markdownlint-disable MD013 -->

# Phase 6.3 Plan: Schedule Image OCR Mini Batch

## Goal

只对 baseline-aware policy 判定为 current/recent/delta-relevant 的 schedule 图片
执行 OCR/multimodal mini batch。OCR 完成后重跑 transport dry-run，判断哪些
notice 可以从 `needs_multimodal` 进入 structured downstream stage。

## Inputs

- Phase 6.1 baseline-aware admission policy
- Phase 6.2 official baseline and overlay reclassification
- Phase 5 OCR attempt plan
- Eligible image object refs

## Eligibility

只处理满足以下条件之一的图片：

- notice release time 晚于 baseline effective date，且含 delta 语义。
- notice 有当前/未来服务窗口。
- notice 明确是 baseline temporary overlay / exception。
- operator 显式 admission。

不处理：

- baseline 前历史图片，除非 operator admission。
- 只有 search-only 价值的历史通知图片。
- unsupported / missing source object refs。

## Tasks

1. Build OCR execution manifest from eligible image refs.
2. Read image bytes through object-store refs.
3. Call configured OCR/multimodal provider.
4. Record provider response / visual text / layout output refs in local no-write evidence.
5. Update attempt outcome evidence.
6. Merge OCR text into searchable preview.
7. Re-run transport admission / replay / stage / consistency evidence.
8. Produce failure/manual-review report.

## Acceptance

- OCR mini batch is explicitly bounded by eligibility.
- Provider/model/provenance are recorded.
- Successful OCR still goes through structured extraction before stage.
- OCR failure does not stage downstream.
- Searchable metadata remains available for failed/deferred images.
- Current promotion remains disabled unless a later phase explicitly opens it.

## Verification

```bash
uv run --all-packages python -m unittest tests.ingestion.test_collected_notice_multimodal_readiness tests.ingestion.test_collected_notice_downstream_pilot
uv run --all-packages python -m unittest tests.ingestion.test_notice_derived_transport_schedule_materialization tests.ingestion.test_build_transport_schedule_projection_worker
uv run --all-packages ruff check packages/ingestion-core/src/campus_ingestion_core apps/ingestion-worker/src/campus_ingestion_worker tests/ingestion
uv run --all-packages ruff format . --check
find .planning/workstreams/collected-notice-consumption-replay-closeout/evidence -name '*.json' -print0 | xargs -0 -n1 jq empty
pnpm docs:lint
git diff --check
```
