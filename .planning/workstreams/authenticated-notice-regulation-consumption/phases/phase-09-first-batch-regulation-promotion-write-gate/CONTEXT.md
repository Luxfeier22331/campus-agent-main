---
doc_type: phase_context
phase: "9"
phase_name: "First-Batch Regulation Promotion Write Gate"
status: completed
created: 2026-04-30
updated: 2026-04-30
---

# Phase 9 Context

## Phase Boundary

Phase 9 reopens `authenticated-notice-regulation-consumption` for a bounded first
write gate after the collected-notice replay workstream proved that a new
regulation cohort is ready for downstream target materialization.

The phase promotes only the eight downstream-admitted regulation candidates
produced by collected-notice Phase 6R evidence:

- `594` -> `regulations/institutional_rules`
- `483`, `485`, `487`, `493`, `509`, `564`, `620` -> `regulations/scoped_rules`

The remaining `32` `needs_multimodal` rows and `2` `manual_review` rows stay out
of scope.

## Current Truth

- Current completed regulation workstream stop point is `offline_preparation`.
- Existing accepted target split from the previous closeout is
  `institutional_rules=2` and `scoped_rules=9`.
- Collected-notice Phase 6R.3 evidence shows:
  - `downstream_admitted=8`
  - `institutional_rules_document_count=1`
  - `scoped_rules_document_count=7`
  - `duplicate_target_document_id_count=0`
  - `normalization_failed_document_count=0`
  - `normalization_flagged_document_count=0`
  - verdict `passed`
- Collected-notice Phase 7 acceptance still marks regulation as
  `offline_preparation_only`, with `write_enabled=false`.

## Locked Decisions

- This phase may write selected target canonical documents and related registry /
  object-store artifacts for the eight admitted candidates only.
- Query serving, RAG release, Qdrant alias publish, public-chat citation opening,
  and broad source replay remain out of scope.
- Existing target documents from the previous `11`-target closeout must be
  preserved unless an explicit same-identity update is detected and admitted.
- The write path must consume source/object-store truth and machine-readable
  admission evidence; it must not depend on local-only temporary files as
  source truth.
- `regulations/*` must continue to receive only semantic-owner canonical
  regulation text, not wrapper notices, metadata-only rows, attachment catalogs,
  or pending multimodal placeholders.
- First-batch promotion must be reversible by selected target identities and
  provenance, not by wiping whole target scopes.

## Canonical References

- `.planning/workstreams/collected-notice-consumption-replay-closeout/evidence/phase-06-r1-regulation-candidate-audit-and-admission/regulation-candidate-audit.json`
  - source cohort, admission classes, owner-text readiness, selected eight.
- `.planning/workstreams/collected-notice-consumption-replay-closeout/evidence/phase-06-r3-regulation-normalization-quality-gate/regulation-normalization-consistency-report.json`
  - quality and materialization counts for the admitted eight.
- `.planning/workstreams/collected-notice-consumption-replay-closeout/evidence/phase-07-acceptance-and-closeout/acceptance-summary.json`
  - explicit no-write/offline-preparation stop point before Phase 9.
- `docs/decisions/adr-0035-notice-derived-regulation-promotion-boundary.md`
  - `regulations/*` only receives canonical regulation text behind an explicit
    promotion boundary.
- `docs/decisions/adr-0040-regulation-work-title-and-edition-separation.md`
  - target identity/title/version semantics.
- `docs/decisions/adr-0041-authenticated-document-center-and-regulation-layer-split.md`
  - original file access truth remains separate from regulation semantic truth.
- `packages/ingestion-core/src/campus_ingestion_core/internal_notice_regulation_materialization.py`
  - existing institutional materialization write patterns.
- `packages/ingestion-core/src/campus_ingestion_core/internal_notice_scoped_rule_materialization.py`
  - existing scoped-rule materialization write patterns.
- `packages/ingestion-core/src/campus_ingestion_core/internal_notice_target_materialization_refresh.py`
  - selected-scope preservation helper.
- `apps/ingestion-worker/src/campus_ingestion_worker/preview_collected_notice_regulation_materialization.py`
  - current dry-run preview worker.
- `apps/ingestion-worker/src/campus_ingestion_worker/publish_internal_notice_regulation_document_site.py`
  - existing selected formal import / docs reader guarded pattern.

## Out Of Scope

- Running OCR / multimodal recovery for the remaining `needs_multimodal` rows.
- Resolving the two manual-review rows.
- Opening public query serving or public-chat citations.
- Reworking the regulation taxonomy or collected-notice classifier.
- Capturing new authenticated portal data.
