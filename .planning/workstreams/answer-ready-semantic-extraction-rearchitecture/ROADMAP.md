---
doc_type: roadmap
status: active
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 -->

# Roadmap: Answer-Ready Semantic Extraction Rearchitecture

## Phase Status

- [x] **Phase 0: Scope Inventory And Done Definition Freeze** — inventory current v2 implementation,
  freeze no-debt definition, semantic oracle, taxonomy admission, institutional denominator,
  fallback budget and concrete release-lane entrypoints.
- [x] **Phase 1: Contract V3 And Schema Governance** — define `answer_ready_evidence.v3`, required
  fields by evidence role, schema validation and migration rules.
- [ ] **Phase 2: Taxonomy And Registry Normalization** — move subject/category/procedure semantics
  into reusable registries and controlled vocabularies.
- [ ] **Phase 3: Clause Parent-Child Unit Model** — implement stable clause, parent article,
  condition group and answer-ready unit identity.
- [ ] **Phase 4: Typed Semantic Extraction Pipeline** — refactor ingestion extraction to produce v3
  metadata from structured units, taxonomy and registries.
- [ ] **Phase 5: Answer-Ready Quality Gates** — upgrade chunk/release gates to static metadata
  correctness admission and keep query-conditioned contradiction checks in retrieval/component eval.
- [ ] **Phase 6: Retrieval Consumption And Fallback Removal** — make retrieval ranking, selection and
  replan consume typed v3 metadata, with fallback budget zero for target releases.
- [ ] **Phase 7: Typed Answer Grounding Integration** — align typed answer drafts and claim grounding
  with the v3 evidence contract.
- [ ] **Phase 8: Component Eval And Stage Attribution** — add eval diagnostics that localize failures
  to extraction, retrieval, ranking, selection, draft, grounding or release admission.
- [ ] **Phase 9: Student Rules Rebuild Release Audit** — rebuild `regulations/student_rules` through
  the release lane and prove serving adoption.
- [ ] **Phase 10: Institutional Rules Rebuild Release Audit** — rebuild `regulations/institutional_rules`
  through the release lane and prove serving adoption.
- [ ] **Phase 11: Legacy Quarantine Docs Closeout** — isolate old-index compatibility, remove target
  fallbacks, update docs and close the debt ledger.

## Execution Rules

- Execute phases in order unless a phase plan explicitly allows parallel read-only audit.
- `packages/shared` contract/schema changes must land before dependent ingestion/retrieval changes.
- `student_rules` and `institutional_rules` release adoption must happen through the regulation RAG
  release lane, not ad hoc index writes.
- Every phase summary must update `GAP-LEDGER.md`.
- A phase is not complete without verification evidence.
- Phase 0 must bind concrete release-lane commands and artifact fields before implementation phases
  can claim serving adoption.
- Phase 0 must freeze the semantic oracle before extraction/ranking/eval tests are expanded.

## Completion Gate

The workstream closes only after Phase 11 records:

- v3 contract docs and implementation
- taxonomy/registry governance
- target release manifests for both default regulation scopes
- fallback usage reports showing zero primary text-cue fallback for target v3 releases
- component eval reports with stage attribution
- docs updates for data-plane, retrieval-serving and chunking policy where affected
- completed Phase 0 oracle/entrypoint/taxonomy admission artifacts
