---
doc_type: plan
status: completed
created: 2026-04-29
updated: 2026-04-29
phase: 6R.3
plan: regulation-normalization-quality-gate
type: implementation
wave: 1
depends_on:
  - Phase 6R.1
  - Phase 6R.1b
  - Phase 6R.2
autonomous: true
---

<!-- markdownlint-disable MD013 -->

# Phase 6R.3 Plan: Regulation Normalization Quality Gate

## Objective

Convert the Phase 6R.2 regulation materialization preview from "structurally
consistent" to "text-quality gated" before Phase 7 acceptance.

This phase still stops at `offline_preparation`. It improves and verifies
canonical text normalization only; it does not publish regulations, open
query-serving, write release aliases, write embeddings, or promote any new
source beyond the Phase 6R.1 admission manifest.

## Why This Phase Exists

Phase 6R.2 proved that the `8` downstream-admitted regulation candidates can be
grouped into target previews:

- `1` `institutional_rules` document.
- `7` `scoped_rules` documents.
- duplicate groups: `0`.
- consistency verdict: `passed`.

That consistency check only covers target identity and provenance shape. It does
not prove canonical text quality. Manual inspection found that source notice
`594` still keeps wrapper residue in the target canonical markdown:

- leading `》的通知`
- wrapper notice addressee/preamble
- `现印发给你们，请遵照执行` style text before the formal regulation body

The root issue is that the current stripper chooses the first occurrence of the
normalized title, which can be inside `《title》` in the wrapper notice instead of
the standalone formal regulation title.

## Canonical References

- `.planning/workstreams/collected-notice-consumption-replay-closeout/evidence/phase-06-r1-regulation-candidate-audit-and-admission/regulation-consumer-admission-manifest.json`
- `.planning/workstreams/collected-notice-consumption-replay-closeout/evidence/phase-06-r1b-regulation-owner-text-recovery-execution/regulation-owner-text-execution-report.json`
- `.planning/workstreams/collected-notice-consumption-replay-closeout/evidence/phase-06-r2-regulation-promotion-dry-run-and-gated-materialization/institutional-rules-materialization.dry-run.json`
- `.planning/workstreams/collected-notice-consumption-replay-closeout/evidence/phase-06-r2-regulation-promotion-dry-run-and-gated-materialization/scoped-rules-materialization.dry-run.json`
- `docs/decisions/adr-0035-notice-derived-regulation-promotion-boundary.md`
- `docs/reference/institutional-regulations-promotion-quality-acceptance.md`
- `docs/reference/institutional-regulations-offline-inventory.md`
- `docs/decisions/adr-0040-regulation-work-title-and-edition-separation.md`
- `packages/ingestion-core/src/campus_ingestion_core/collected_notice_regulation_materialization_preview.py`
- `tests/ingestion/test_collected_notice_regulation_materialization_preview.py`

## Inputs

- Phase 6R.1 refreshed regulation admission manifest.
- Phase 6R.1b owner-text object refs.
- Phase 6R.2 dry-run target materialization evidence.
- Current owner text from `searchable_merge_input`, with fallback to `plain_text`.

## Non-Goals

- No DB write.
- No object-store write.
- No release / alias publish.
- No embedding or Qdrant write.
- No query-serving enablement.
- No new owner-text provider execution.
- No new downstream admission beyond Phase 6R.1.
- No regulation materialization for `needs_multimodal`, `manual_review`, or
  rejected entries.

## Target Shape

Regulation preview generation should have a dedicated text normalization
boundary, instead of embedding one-off string slicing in target document
construction.

The target normalizer must produce:

- canonical body text
- canonical markdown
- structure-aware document units
- per-document quality signals
- deterministic failure/flag reason codes

Quality signals are evidence for acceptance; they are not source truth and do
not change the original `internal_notice` source-channel object.

## Implementation Tasks

1. Extract regulation text normalization from preview document construction.
   - Create a small internal normalizer boundary used by the Phase 6R.2 preview
     builder.
   - Keep target identity/provenance logic in the materialization preview module.
   - Keep the public worker command shape stable.

2. Build wrapper-aware canonical body selection.
   - Prefer a standalone title occurrence followed by regulation structure
     markers such as `第一章`, `第一条`, `一、`, or `（一）`.
   - Avoid title occurrences inside `《...》` wrapper references.
   - When both title and first article/chapter exist, select the later formal
     body boundary, not the earliest wrapper mention.
   - Preserve a fallback path when no strong structure marker exists, but emit a
     quality flag.

3. Clean deterministic OCR/layout artifacts.
   - Remove common page markers such as `-2-`, isolated page-number lines, and
     repeated footer/header fragments when deterministic.
   - Normalize heading spacing for forms like `第一章总则` to `第一章 总则`
     without changing body semantics.
   - Collapse excessive blank lines while preserving paragraph separation.
   - Remove duplicated leading title blocks only when they repeat the normalized
     title or known issuing-org/file-number preamble directly before the body.

4. Replace blank-line-only units with structure-aware preview units.
   - Split by chapter/article headings when available.
   - Preserve stable `unit_id` ordering under the target document id.
   - Keep blank-line fallback only for documents with no detected structure.
   - Include unit type signals such as `chapter`, `article`, or
     `regulation_body_fallback`.

5. Generate a regulation normalization quality report.
   - Emit one row per target preview document.
   - Required fields:
     - `target_collection`
     - `target_document_id`
     - `source_notice_ids`
     - `title`
     - `wrapper_removed`
     - `suspicious_prefix`
     - `title_occurrence_count`
     - `chapter_count`
     - `article_count`
     - `page_artifact_count`
     - `unit_count`
     - `quality_verdict`
     - `reason_codes`
   - `quality_verdict` values:
     - `passed`
     - `flagged_manual_review`
     - `failed`

6. Produce before/after dry-run evidence.
   - Write evidence under
     `.planning/workstreams/collected-notice-consumption-replay-closeout/evidence/phase-06-r3-regulation-normalization-quality-gate/`.
   - Include:
     - `institutional-rules-materialization.normalized.dry-run.json`
     - `scoped-rules-materialization.normalized.dry-run.json`
     - `regulation-normalization-quality-report.json`
     - `regulation-normalization-before-after-report.json`
     - `regulation-normalization-consistency-report.json`
   - The consistency report must restate that write/release/query-serving
     actions remain disabled.

7. Add focused regression tests.
   - Wrapper title in `《title》` must not become the canonical body boundary.
   - Source notice `594`-style wrapper residue must be stripped.
   - Already-clean scoped rule body must remain stable.
   - Page markers and duplicate title blocks are removed deterministically.
   - Article/chapter unit splitting produces stable ordered units.
   - Quality report flags suspicious prefix and insufficient structure.
   - No-write flags remain false.

## Expected File Scope

- `packages/ingestion-core/src/campus_ingestion_core/collected_notice_regulation_materialization_preview.py`
- `packages/ingestion-core/src/campus_ingestion_core/collected_notice_regulation_text_normalization.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/preview_collected_notice_regulation_materialization.py`
- `tests/ingestion/test_collected_notice_regulation_materialization_preview.py`
- `tests/ingestion/test_collected_notice_regulation_text_normalization.py`
- `tests/ingestion/test_preview_collected_notice_regulation_materialization_worker.py`
- `.planning/workstreams/collected-notice-consumption-replay-closeout/evidence/phase-06-r3-regulation-normalization-quality-gate/`

## Acceptance Criteria

- Source notice `594` no longer has `》的通知`, wrapper addressee/preamble, or
  `现印发...请遵照执行` residue in target canonical markdown.
- The `7` scoped-rule previews keep their meaningful body content and do not
  regress because of institution-rule-specific wrapper handling.
- Target document ids remain independent of `notice_id`.
- `source_notice_ids`, `source_document_ids`, `source_urls`,
  `source_object_refs`, and source scope remain preserved.
- `institutional_rules` and `scoped_rules` stay separated.
- Quality report exists and gives deterministic verdicts/reason codes per
  preview document.
- Consistency report passes only when quality gate failures are absent or
  explicitly classified as `flagged_manual_review`.
- The phase produces no DB, object-store, release, embedding, Qdrant, or
  query-serving writes.

## Verification

```bash
uv run --all-packages python -m unittest tests.ingestion.test_collected_notice_regulation_text_normalization tests.ingestion.test_collected_notice_regulation_materialization_preview tests.ingestion.test_preview_collected_notice_regulation_materialization_worker
uv run --all-packages python -m unittest tests.ingestion.internal_notice_regulation_materialization_gate_suite tests.ingestion.internal_notice_scoped_rule_materialization_materialize_suite
uv run --all-packages python -m unittest tests.ingestion.test_internal_notice_institutional_regulation_chunk_prep tests.ingestion.test_internal_notice_scoped_rule_chunk_prep
uv run --all-packages ruff check packages/ingestion-core/src/campus_ingestion_core/collected_notice_regulation_materialization_preview.py packages/ingestion-core/src/campus_ingestion_core/collected_notice_regulation_text_normalization.py apps/ingestion-worker/src/campus_ingestion_worker/preview_collected_notice_regulation_materialization.py tests/ingestion/test_collected_notice_regulation_materialization_preview.py tests/ingestion/test_collected_notice_regulation_text_normalization.py tests/ingestion/test_preview_collected_notice_regulation_materialization_worker.py
uv run --all-packages ruff format --check packages/ingestion-core/src/campus_ingestion_core/collected_notice_regulation_materialization_preview.py packages/ingestion-core/src/campus_ingestion_core/collected_notice_regulation_text_normalization.py apps/ingestion-worker/src/campus_ingestion_worker/preview_collected_notice_regulation_materialization.py tests/ingestion/test_collected_notice_regulation_materialization_preview.py tests/ingestion/test_collected_notice_regulation_text_normalization.py tests/ingestion/test_preview_collected_notice_regulation_materialization_worker.py
find .planning/workstreams/collected-notice-consumption-replay-closeout/evidence/phase-06-r3-regulation-normalization-quality-gate -name '*.json' -print0 | xargs -0 -n1 jq empty
pnpm docs:lint
git diff --check
```

## Plan Quality Check

- Goal-backward: this phase exists because Phase 7 cannot honestly close out
  regulation replay while canonical text still contains wrapper residue.
- Boundary check: the plan keeps regulation source truth in `internal_notice` and
  only improves no-write target preview text.
- Drift check: target identity/provenance/admission rules remain owned by
  Phase 6R.1 and Phase 6R.2; this phase only adds text normalization and quality
  evidence.
- Stop-point check: the phase preserves `offline_preparation` and explicitly
  blocks release/query-serving.

## Completion Summary

Completed on 2026-04-29.

Phase 6R.3 added a dedicated regulation canonical text normalization boundary,
reran the `8` Phase 6R.1 downstream-admitted candidates, and generated
no-write normalized materialization evidence:

- `1` `institutional_rules` normalized preview document.
- `7` `scoped_rules` normalized preview documents.
- quality report verdict: `passed`.
- consistency verdict: `passed`.
- failed normalization documents: `0`.
- flagged normalization documents: `0`.
- before/after changed documents: `6`.

The source notice `594` target canonical markdown now starts at
`# 中央民族大学毕业生就业奖励办法` followed by `第一章 总则`; wrapper residue such
as `》的通知`、`学校各单位` and `现印发给你们，请遵照执行` is no longer present in
the target preview.

No DB write, object-store write, release publish, embedding, Qdrant write, or
query-serving opening occurred.
