---
doc_type: phase_summary
status: completed
workstream: regulation-rag-release-lane
phase: phase-12-institutional-42-quality-and-release
created: 2026-05-03
updated: 2026-05-03
---

<!-- markdownlint-disable MD013 -->

# Phase 12 Summary: Institutional 42 Quality And Release

## Outcome

42 school-level `regulations/institutional_rules` passed cleaning/chunk quality
readiness for downstream RAG release. The 30 Phase 9/10 released documents keep
their prior release evidence. The 12 selected school-level re-admitted documents
were transformed into institutional-scope `document-units`, rechunked with
`institutional_rules_formal_v1`, uploaded to object storage and upserted into the
operator registry.

The real 42-doc registry-scope chunk preparation passed, release admission was
written, 42 release candidates were enqueued and processed, and all 42 candidates
reached `serving_published`. The serving alias `institutional_rules` now points
to `institutional_rules__r20260503_111156_686885_6ce8d197` with 1747 points.

Qdrant and embedding runtime readiness are not blockers. The earlier blocker
evidence was based on stale/incorrect probes; the corrected probes show root
`.env` embedding provider settings are loaded and Qdrant `/readyz`, `/livez` and
`/collections` return HTTP 200 with API key.

Release-gate live retrieval passed for 45 cases. Golden retrieval ran for 89
cases and exposed 3 follow-up gaps; those gaps are tracked separately from Phase
12 release completion.

## Evidence

- `../../evidence/phase-12-institutional-42-quality-and-release/quality-and-release-readiness.report.json`
- `../../evidence/phase-12-institutional-42-quality-and-release/selected-12-institutional-chunk-prep/chunk-prep-manifest.json`
- `../../evidence/phase-12-institutional-42-quality-and-release/selected-12-institutional-chunk-prep/validation-summary.json`
- `../../evidence/phase-12-institutional-42-quality-and-release/selected-12-institutional-chunk-prep/document-reports.jsonl`
- `../../evidence/phase-12-institutional-42-quality-and-release/release-blockers.report.json`
- `../../evidence/phase-12-institutional-42-quality-and-release/operator-registry-admission.report.json`
- `../../evidence/phase-12-institutional-42-quality-and-release/operator-registry-releasable-probe.json`
- `../../evidence/phase-12-institutional-42-quality-and-release/chunk-preparation.report.json`
- `../../evidence/phase-12-institutional-42-quality-and-release/release-admission.report.json`
- `../../evidence/phase-12-institutional-42-quality-and-release/candidate-enqueue.report.json`
- `../../evidence/phase-12-institutional-42-quality-and-release/release-execution-status.report.json`
- `../../evidence/phase-12-institutional-42-quality-and-release/process-release.report.json`
- `../../evidence/phase-12-institutional-42-quality-and-release/runtime-readiness.report.json`
- `../../evidence/phase-12-institutional-42-quality-and-release/retrieval-live-run.json`
- `../../evidence/phase-12-institutional-42-quality-and-release/retrieval-live-summary.json`
- `../../evidence/phase-12-institutional-42-quality-and-release/golden-retrieval-live-run.json`
- `../../evidence/phase-12-institutional-42-quality-and-release/golden-retrieval-live-summary.json`
- `../../evidence/phase-12-institutional-42-quality-and-release/golden-retrieval-gap-analysis.json`

## Counts

- Manifest documents: 42
- Prior released documents covered by Phase 9 evidence: 30
- Re-admitted documents rechunked in this phase: 12
- Re-admitted units: 437
- Re-admitted chunks: 345
- Combined quality evidence chunks: 1747
- Real registry-scope preparation documents: 42
- Real registry-scope preparation chunks: 1747
- Release admission documents: 42
- Enqueued release candidates: 42
- Processed release candidates: 42
- Serving-published release candidates: 42
- Current alias points: 1747
- Release-gate live retrieval cases: 45
- Release-gate doc_hit@1: 1.0
- Golden retrieval cases: 89
- Golden retrieval problem cases: 3
- Excluded annual/cohort scoped rule: 1

## Boundary

- `scoped_rules` was not globally opened.
- `中央民族大学2026届推荐应届本科毕业生免试攻读硕士学位研究生实施办法` remains excluded
  because it is annual/cohort-specific.
- The 12 selected school-level documents preserve source lineage and semantic
  version/hash, but are rechunked under institutional document ids and
  `promotion_class=formal_regulation`.
- This phase claims fresh embedding/index/alias publish only for
  `regulations/institutional_rules`; `scoped_rules` remains closed.

## Follow-Up

- `institutional-golden-scenario-49319e7c44d3`: positive recall gap for
  `中央民族大学研究生“三助”工作管理办法`.
- `institutional-golden-hard-negative-annual-postgraduate-recommendation-2026`:
  annual/cohort scope-membership question needs pre-retrieval no-hit/scope guard.
- `institutional-golden-scoped-rule-decoy-history-school`: college-level
  scoped-rule decoy question needs pre-retrieval no-hit/scope guard.
