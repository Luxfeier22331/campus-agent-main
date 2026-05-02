---
doc_type: summary
status: completed
created: 2026-05-02
updated: 2026-05-02
---

<!-- markdownlint-disable MD013 -->

# Phase 1-5 Summary: Core Implementation

## Outcome

Implemented a bounded regulation RAG release lane slice:

- `rag_release_candidate` dataclass, in-memory store and Postgres-backed store.
- Registry-delta enqueue using document identity/version/hash and runtime profile
  identity.
- Candidate processing with non-serving terminal states for query-disabled,
  profile-disabled, non-current, withdrawn and deleted documents.
- Registry-scope release executor that calls chunk preparation and release-managed
  indexing/acceptance/publish flow.
- Worker CLI:
  `campus-ingestion-process-regulation-rag-release-candidates`.
- Institutional and scoped-rule materialization handoff into candidate store when
  a store is injected or operator store env is configured.
- Authenticated notice processing projection and protected panel display for
  `documentSiteStatus`, `ragPreparationStatus`, `ragIndexStatus`,
  `ragServingStatus` and `ragVerificationStatus`.

## Guardrails

- Document site publish and RAG serving remain separate states.
- `scoped_rules` remains query-disabled by default; pending candidates become
  non-serving terminal status unless the runtime profile explicitly opens query.
- Local fixture replay does not require candidate-store Postgres and does not
  silently become production release truth.
- Operator projection does not expose raw body, OCR payload, object key, raw chunk
  text or vector/index payload.

## Verification

- Focused candidate/worker/projection/materialization tests passed:

  ```bash
  uv run --all-packages python -m unittest \
    tests.ingestion.test_regulation_rag_release_lane \
    tests.ingestion.test_process_regulation_rag_release_candidates_worker \
    tests.ingestion.test_authenticated_notice_processing_projection \
    tests.ingestion.test_materialize_internal_notice_regulation_worker \
    tests.ingestion.test_materialize_internal_notice_scoped_rules_worker \
    tests.ingestion.internal_notice_regulation_materialization_gate_suite.InternalNoticeRegulationMaterializationGateTest.test_materialize_uses_projection_truth_without_rebuilding_promotion_manifest \
    tests.ingestion.internal_notice_scoped_rule_materialization_materialize_suite.InternalNoticeScopedRuleMaterializationMaterializeTest.test_materialize_scoped_rules_from_internal_notice_scope \
    -v
  ```

- Wider regulation/scoped materialization tests passed:

  ```bash
  uv run --all-packages python -m unittest \
    tests.ingestion.test_internal_notice_regulation_materialization \
    tests.ingestion.internal_notice_scoped_rule_materialization_materialize_suite \
    -v
  ```

## Next

Phase 6 should collect canary cohort evidence for current institutional rule,
query-disabled scoped rule, historical scoped rule and source-truth-only negative
notice.
