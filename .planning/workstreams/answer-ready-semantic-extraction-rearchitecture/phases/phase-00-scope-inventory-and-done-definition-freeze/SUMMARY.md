---
doc_type: phase_summary
status: completed
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 -->

# Summary: Phase 0 Scope Inventory And Done Definition Freeze

## Result

Phase 0 is complete. It did not change production code, release profiles, aliases or runtime
allowlists. It froze the execution contract for the remaining workstream phases.

## Artifacts Created

- `INVENTORY.md` — current v2 producer/consumer inventory and heuristic lineage map
- `DONE-DEFINITION.md` — v3 no-debt completion criteria and negative criteria
- `FALLBACK-BUDGET.md` — zero primary text-cue fallback rule for target v3 releases
- `RELEASE-ADOPTION-PROOF.md` — required manifest, alias and post-publish evidence
- `SEMANTIC-ORACLE.md` — frozen semantic expectations for student and institutional samples
- `RELEASE-LANE-ENTRYPOINTS.md` — concrete release/admission/alias command templates
- `TAXONOMY-ADMISSION.md` — controlled-value and alias governance
- `INSTITUTIONAL-DENOMINATOR.md` — institutional early coverage rule
- `STATIC-VS-QUERY-GATES.md` — release-gate vs query-conditioned eval split

## Key Decisions

- Completion requires both `student_rules` and `institutional_rules` release/adoption evidence.
- `answer_ready_evidence.v3` must prove semantic correctness against an oracle, not just field
  presence.
- Static release gates validate chunk/document metadata validity; query-conditioned contradictions
  belong to retrieval/component eval.
- Old-index fallback is compatibility-only and cannot satisfy target v3 completion.
- Taxonomy changes require admission metadata and release invalidation or compatibility proof.
- Phase 9/10 must use the repo release lane entrypoints frozen in
  `RELEASE-LANE-ENTRYPOINTS.md`. The available entrypoints are:
  - `campus_ingestion_worker.admit_regulation_rag_release`
  - `campus_ingestion_worker.enqueue_regulation_rag_release_candidates`
  - `campus_ingestion_worker.process_regulation_rag_release_candidates`
  - `campus_ingestion_worker.release_registry_scope`
  - `campus_ingestion_worker.scope_alias`
- Phase 9/10 must choose either the candidate-processor path or the direct registry-scope release
  path for each serving adoption. They must not treat both as mandatory for the same release.
- Phase 9 `student_rules` serving adoption defaults to direct `release_registry_scope`; candidate
  enqueue is not mandatory for `student_rules`.

## Verification

```bash
pnpm docs:lint
```

Result: `0 error(s)`.

## Next Phase

Phase 1: Contract V3 And Schema Governance.
