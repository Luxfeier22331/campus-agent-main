---
doc_type: summary
status: completed
created: 2026-04-30
updated: 2026-04-30
---

<!-- markdownlint-disable MD013 -->

# Summary: Phase 0 Scope And Truth Alignment

## Result

Phase 0 froze the current canonical retrieval release hardening scope and wrote the current
inventory artifact:

- `.planning/workstreams/canonical-retrieval-release-hardening/evidence/phase-00-current-inventory.md`

## Confirmed Truth

- Runtime profiles and `configs/runtime/query-serving-scopes.v1.json` currently identify four
  default query-enabled scopes:
  - `regulations/student_rules`
  - `regulations/institutional_rules`
  - `curriculum/curriculum_plan`
  - `official_web/stable_reference`
- Existing docs/planning still drift on this truth; Phase 1 must decide whether
  `official_web/stable_reference` remains default query-enabled and then reconcile all locations.
- Release and alias publish are owned by `packages/ingestion-core` and `apps/ingestion-worker`.
- Online retrieval execution is owned by `packages/retrieval-core`.
- Runtime drift guard must come after sparse/hybrid and chunker/tokenizer provenance.

## Decisions Carried Forward

- Provider-response replay does not publish query-serving alias.
- Query-serving alias publish must fail closed when acceptance fixtures are missing or failing.
- Online retrieval runtime must use Qdrant point payload / current release metadata for drift guard;
  object-store manifest remains audit / offline fallback.
- `packages/evals` owns shared qrels and retrieval tuning runner logic.

## Next Phase

Phase 1: Query-Enabled Truth Fix.
