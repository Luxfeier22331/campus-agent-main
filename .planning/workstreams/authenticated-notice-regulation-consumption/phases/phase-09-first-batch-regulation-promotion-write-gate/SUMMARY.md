---
doc_type: phase_summary
phase: "9"
phase_name: "First-Batch Regulation Promotion Write Gate"
status: completed
created: 2026-04-30
updated: 2026-04-30
---

# Phase 9 Summary

## Result

Phase 9 completed the selected first-batch write gate for the `8` regulation
candidates proven ready by collected-notice Phase 6R/7 evidence.

Selected cohort:

- `594` -> `regulations/institutional_rules`
- `483`, `485`, `487`, `493`, `509`, `564`, `620` ->
  `regulations/scoped_rules`

## Materialization

- execute mode: `true`
- materialized document count: `8`
- created document count: `8`
- updated document count: `0`
- skipped document count: `0`
- preflight target counts:
  - `regulations/institutional_rules=1`
  - `regulations/scoped_rules=9`
- postflight target counts:
  - `regulations/institutional_rules=2`
  - `regulations/scoped_rules=16`

The live preflight registry had `institutional_rules=1`, not the planning-time
`2`. The selected write path preserved existing rows and only added the admitted
first-batch identities.

## Acceptance

- institutional selected acceptance: `passed=true`, prepared documents `1`
- scoped selected acceptance: `passed=true`, prepared documents `7`
- institutional fail-close counters:
  - missing title/context/identity: `0`
  - invalid semantic owner lineage: `0`
  - wrapper/front-matter leakage: `0`
- scoped fail-close counters:
  - missing title/context/projection metadata: `0`
  - missing cycle year/school unit: `0`
  - wrapper/front-matter leakage: `0`

## Boundaries

- `query_serving_opened=false`
- `rag_release_opened=false`
- `qdrant_alias_opened=false`
- `public_chat_citation_opened=false`
- reader assets were not opened in this phase.

Remaining non-selected regulation candidates stay blocked:

- `32` `needs_multimodal`
- `2` `manual_review`

## Evidence

- `evidence/phase-09-first-batch-regulation-promotion-write-gate/first-batch-selection.json`
- `evidence/phase-09-first-batch-regulation-promotion-write-gate/admission-preflight-report.json`
- `evidence/phase-09-first-batch-regulation-promotion-write-gate/materialization.execute.json`
- `evidence/phase-09-first-batch-regulation-promotion-write-gate/acceptance-summary.json`
- `evidence/phase-09-first-batch-regulation-promotion-write-gate/serving-closed-assertion.json`

## Reopen Rule

Reopen this workstream only when a next regulation batch is admitted, when the
`32` multimodal or `2` manual-review rows are resolved, or when product scope
explicitly moves regulation targets from offline preparation to query serving /
RAG release / public-chat citation.
