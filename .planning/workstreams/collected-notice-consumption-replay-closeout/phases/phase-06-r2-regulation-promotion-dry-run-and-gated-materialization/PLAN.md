---
doc_type: plan
status: completed
created: 2026-04-29
updated: 2026-04-29
phase: 6R.2
plan: regulation-promotion-dry-run-and-gated-materialization
type: implementation
wave: 1
depends_on:
  - Phase 6R.1
autonomous: true
---

<!-- markdownlint-disable MD013 -->

# Phase 6R.2 Plan: Regulation Promotion Dry-Run And Gated Materialization

## Objective

Use the admitted Phase 6R.1 regulation candidates to run no-write target
materialization previews for:

- `regulations/institutional_rules`
- `regulations/scoped_rules`

The stop point remains `offline_preparation`. This phase does not publish query
serving, release aliases, or overwrite source-channel truth.

## Canonical References

- Phase 6R.1 admission manifest
- `docs/decisions/adr-0035-notice-derived-regulation-promotion-boundary.md`
- `docs/reference/institutional-regulations-promotion-quality-acceptance.md`
- `docs/reference/institutional-regulations-offline-inventory.md`
- `docs/decisions/adr-0040-regulation-work-title-and-edition-separation.md`
- `packages/ingestion-core/src/campus_ingestion_core/internal_notice_regulation_materialization.py`
- `packages/ingestion-core/src/campus_ingestion_core/internal_notice_scoped_rule_materialization.py`

## Inputs

- `regulation-consumer-admission-manifest.json`
- Queue-backed searchable units
- Source object refs
- Existing promotion/materialization helpers

## Non-Goals

- No release / alias publish.
- No embedding or Qdrant writes.
- No query-serving enablement.
- No `internal_notice` source scope rewrite.
- No materialization for rejected/manual-review/needs-multimodal entries.

## Tasks

1. Build institutional rules dry-run materialization.
   - Input only `institutional_rules_candidate`.
   - Generate canonical markdown preview.
   - Generate document-units preview.
   - Generate target registry refresh preview.
2. Build scoped rules dry-run materialization.
   - Input only `scoped_rules_candidate`.
   - Preserve annual/time-bound/school-specific metadata.
   - Generate canonical markdown and document-units previews.
3. Aggregate duplicate provenance.
   - Preserve `source_notice_ids`.
   - Preserve notice-level and owner-document-level ids separately.
   - Do not generate duplicate target documents.
4. Produce reports.
   - `institutional-rules-materialization.dry-run.json`
   - `scoped-rules-materialization.dry-run.json`
   - `duplicate-provenance-aggregation-report.json`
   - `regulation-materialization-consistency-report.json`
   - `regulation-source-to-target-trace.json`
5. Add tests.
   - Institutional rules exclude scoped candidates.
   - Scoped rules exclude institution-wide candidates.
   - Wrapper text is stripped from target canonical markdown.
   - Target identity is not derived from `notice_id`.
   - Source scope remains unchanged.

## Expected File Scope

- `packages/ingestion-core/src/campus_ingestion_core/collected_notice_regulation_materialization_preview.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/preview_collected_notice_regulation_materialization.py`
- `tests/ingestion/test_collected_notice_regulation_materialization_preview.py`
- `tests/ingestion/test_preview_collected_notice_regulation_materialization_worker.py`
- `.planning/workstreams/collected-notice-consumption-replay-closeout/evidence/phase-06-r2-regulation-promotion-dry-run-and-gated-materialization/`

## Verification

```bash
uv run --all-packages python -m unittest tests.ingestion.test_collected_notice_regulation_materialization_preview tests.ingestion.test_preview_collected_notice_regulation_materialization_worker
uv run --all-packages python -m unittest tests.ingestion.internal_notice_regulation_materialization_gate_suite tests.ingestion.internal_notice_scoped_rule_materialization_materialize_suite
uv run --all-packages python -m unittest tests.ingestion.test_internal_notice_institutional_regulation_chunk_prep tests.ingestion.test_internal_notice_scoped_rule_chunk_prep
uv run --all-packages ruff check packages/ingestion-core/src/campus_ingestion_core/collected_notice_regulation_materialization_preview.py apps/ingestion-worker/src/campus_ingestion_worker/preview_collected_notice_regulation_materialization.py tests/ingestion/test_collected_notice_regulation_materialization_preview.py tests/ingestion/test_preview_collected_notice_regulation_materialization_worker.py
uv run --all-packages ruff format --check packages/ingestion-core/src/campus_ingestion_core/collected_notice_regulation_materialization_preview.py apps/ingestion-worker/src/campus_ingestion_worker/preview_collected_notice_regulation_materialization.py tests/ingestion/test_collected_notice_regulation_materialization_preview.py tests/ingestion/test_preview_collected_notice_regulation_materialization_worker.py
find .planning/workstreams/collected-notice-consumption-replay-closeout/evidence/phase-06-r2-regulation-promotion-dry-run-and-gated-materialization -name '*.json' -print0 | xargs -0 -n1 jq empty
pnpm docs:lint
git diff --check
```

## Success Criteria

- Admitted regulation candidates can produce target previews without writing release or query-serving state.
- `institutional_rules` and `scoped_rules` remain separate.
- Duplicate provenance is aggregated into one semantic target document where appropriate.
- Source-channel `internal_notice` truth remains intact.

## Completion Summary

Completed on 2026-04-29.

Phase 6R.2 now consumes the refreshed Phase 6R.1 admission manifest and owner
text refs written by Phase 6R.1b. It generates no-write target materialization
previews for the `8` downstream-admitted regulation candidates:

- `1` `institutional_rules` preview document.
- `7` `scoped_rules` preview documents.
- `0` duplicate provenance groups.
- consistency verdict `passed`.

No release, alias publish, DB write, object-store write, embedding, Qdrant write,
or query-serving opening occurred.
