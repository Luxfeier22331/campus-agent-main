---
doc_type: phase_summary
status: completed
phase: Phase 1
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 MD060 -->

# Phase 1 Summary: NoticeChangeSet Contract And Data-Plane Admission

## Result

Phase 1 is complete.

This phase froze and tested the `notice_change_set` contract/admission seam without promoting it
to supported runtime projection status and without implementing the Phase 2 producer.

## Completed Artifacts

- `packages/contracts/src/campus_contracts/models_notice_change_set.py`
  - Adds a dedicated `NoticeChangeSet` schema model.
  - Defines stable artifact names:
    - `notice_change_set`
    - `NoticeChangeSet`
    - `notice.notice_change_set.transport_override_lookup`
    - `campus_notice_change_set_lookup`
  - Validates source refs, title/source URL, facts, effective window, conflict summaries,
    fail-close reason codes and raw-payload key rejection.
- `tests/contracts/contract_models_notice_change_set_suite.py`
  - Covers answer-eligible transport overlay.
  - Rejects missing source URL, orphan facts, searchable-only facts, missing baseline without
    fail-close reason, missing evidence, conflict without summaries, raw payload keys and missing
    effective window.
- `packages/ingestion-core/src/campus_ingestion_core/notice_change_set_admission.py`
  - Adds a narrow forward admission gate over existing `NoticeConsumptionProjectionEntry`.
  - Checks transport candidate kind, ready-for-target status, complete evidence, answerability,
    source title/source URL and official baseline availability.
  - Does not query PG, build a producer, or materialize runtime artifacts.
- `tests/ingestion/test_notice_change_set_admission.py`
  - Covers ready transport admission, missing baseline, searchable-only exclusion,
    incomplete media, missing source refs, non-transport candidate and reference-only rejection.
  - Confirms title/source URL may come from read-model context instead of being duplicated in
    projection metadata.
- `tests/contracts/contract_models_notice_change_set_suite.py`
  - Confirms Phase 1 contract names match the artifact registry placeholder.
  - Confirms `notice_change_set` remains absent from OpenAPI/Go runtime projection enum until
    Phase 2+ promotion.

## Explicit Non-Promotion

`configs/runtime/workflow-artifacts.v1.json` still keeps `notice_change_set` as
`planned_contract_gap`.

That is intentional. Phase 1 owns contract/admission only. Phase 2 must implement the producer and
baseline gate before the registry can move toward `contract_only` or `supported_go_runtime`.

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.contracts.contract_models_notice_change_set_suite \
  tests.ingestion.test_notice_change_set_admission -q

uv run --all-packages ruff check \
  packages/contracts/src/campus_contracts/models_notice_change_set.py \
  tests/contracts/contract_models_notice_change_set_suite.py \
  packages/ingestion-core/src/campus_ingestion_core/notice_change_set_admission.py \
  tests/ingestion/test_notice_change_set_admission.py

uv run --all-packages ruff format \
  packages/contracts/src/campus_contracts/models_notice_change_set.py \
  tests/contracts/contract_models_notice_change_set_suite.py \
  packages/ingestion-core/src/campus_ingestion_core/notice_change_set_admission.py \
  tests/ingestion/test_notice_change_set_admission.py --check
```

Latest review run: 20 tests passed. All commands passed.

## Handoff To Phase 2

Phase 2 should implement the read-only producer over admitted projection/read-model truth:

- proposed tool/binding name: `campus_notice_change_set_lookup`
- no raw notice/OCR/HTML/object lookup
- official baseline missing returns `transport_baseline_missing`
- searchable-only and incomplete-media notices remain non-answerable
