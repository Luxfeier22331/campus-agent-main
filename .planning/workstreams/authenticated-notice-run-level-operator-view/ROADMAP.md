---
doc_type: roadmap
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Roadmap: Authenticated Notice Run-Level Operator View

## Phase Status

- [x] **Phase 1: Contract And Schema Freeze** — define run-level snapshot,
  status, redaction and table shape separately from per-notice processing.
- [x] **Phase 2: App API Store And Routes** — add projection tables, internal
  snapshot ingest, operator list/detail services and tests.
- [x] **Phase 3: Ingestion Projection Builder And Reporter** — build sanitized
  run snapshots from queue records / traces and report terminal consumer state.
- [x] **Phase 4: Protected Panel Resource** — add same-site proxy,
  data-provider resource, list/detail pages and UI tests.
- [x] **Phase 5: Real Sample Closeout** — replay real collector run token
  `20260428T181953007Z`, fix source-truth-only count handling and record
  evidence.
- [x] **Phase 6: Selected Source-Truth-Only Canary** — verify selected notice
  `355959` preserves sanitized selected notice identity and reports both
  notice-level and run-level processing projections.

## Closeout Evidence

- real sample:
  `evidence/phase-05-real-sample-20260428T181953007Z/acceptance-summary.json`
- run snapshot:
  `evidence/phase-05-real-sample-20260428T181953007Z/run-processing-snapshot.json`
- source evidence summary:
  `evidence/phase-05-real-sample-20260428T181953007Z/source-evidence-summary.json`
- selected canary:
  `evidence/phase-06-canary-355959-20260501T171611Z/source-truth-only-smoke-summary.json`

## Verification

Focused verification lanes are recorded in `STATE.md`.
