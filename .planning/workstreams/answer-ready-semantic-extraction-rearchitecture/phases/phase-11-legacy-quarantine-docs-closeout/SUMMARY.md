---
doc_type: phase_summary
status: active
created: 2026-05-08
updated: 2026-05-08
---

<!-- markdownlint-disable MD013 -->

# Phase 11 Summary

## Outcome

Phase 11 moved from “diagnostics-only quarantine intent” to an explicit runtime/documented split:

- regulation-family retrieval plans now have a named legacy fallback mode boundary:
  - `target_v3_only`
  - `legacy_old_index_compatibility`
- target query-serving regulation paths fail closed if they try to ground on legacy primary fallback
  signals
- old-index compatibility remains available only through explicit compatibility mode
- retrieval/eval/docs now share one legacy fallback signal set instead of repeating local string
  literals

This closes the previously open implementation gap where target regulation aliases could still
return success with legacy fallback evidence and only emit diagnostics.

Phase 11 closeout hardening also now tightens the static v3 contract boundary for procedure
evidence:

- target v3 `procedure_step` metadata can no longer pass validation/release admission with generic
  placeholder actor `responsible_party`
- target v3 `procedure_step` metadata can no longer pass validation/release admission with generic
  placeholder action `procedure_step`
- this converts the previously latent “shared resolver still has compatibility fallback branches”
  debt into explicit fail-close behavior at the static gate

Phase 11 closeout hardening also now closes a publish-time audit blind spot:

- post-publish release audit no longer relies only on component-eval aggregate counts
- sampled published target-v3 payloads are now revalidated against the shared answer-ready
  contract during `audit_published_scope_release(...)`
- sampled published target-v3 payloads now fail closeout audit if unresolved fallback provenance
  leaks into released metadata such as:
  - `condition_subject_provenance=fallback:*`
  - `procedure_action_provenance=fallback:*`
- this converts the previously open “published payload may still carry unresolved semantic fallback
  debt even after release/admission evidence passed” gap into explicit fail-close behavior on the
  published index surface itself

## Changed Files

- `packages/retrieval-core/src/campus_retrieval_core/models.py`
- `packages/retrieval-core/src/campus_retrieval_core/service_step_executor.py`
- `packages/retrieval-core/src/campus_retrieval_core/service_plan_execution.py`
- `packages/retrieval-core/src/campus_retrieval_core/service_requests.py`
- `packages/retrieval-core/src/campus_retrieval_core/evidence_attributes.py`
- `packages/rag-agent/src/campus_rag_agent/retrieval_plan.py`
- `packages/rag-agent/src/campus_rag_agent/service_retrieval.py`
- `packages/shared/src/campus_shared/answer_ready_evidence_contract.py`
- `packages/shared/src/campus_shared/__init__.py`
- `packages/evals/src/campus_evals/answer_ready_component_eval.py`
- `packages/evals/src/campus_evals/answer_ready_closeout_audit.py`
- `packages/ingestion-core/src/campus_ingestion_core/registry_scope_release.py`
- `tests/retrieval/retrieval_service_replan_execution_suite.py`
- `tests/agent/test_rag_retrieval_plan.py`
- `tests/ingestion/test_registry_scope_release.py`
- `docs/architecture/system/retrieval-serving-architecture.md`
- `docs/architecture/system/data-plane-architecture.md`
- `docs/policies/student-handbook-chunking-and-validation-policy.md`

## Verification

Focused red/green verification:

```bash
uv run --all-packages python -m unittest tests.retrieval.retrieval_service_replan_execution_suite.RetrievalServiceReplanExecutionTest.test_execute_retrieval_plan_fails_closed_when_target_regulation_path_hits_legacy_fallback tests.retrieval.retrieval_service_replan_execution_suite.RetrievalServiceReplanExecutionTest.test_execute_retrieval_plan_allows_legacy_fallback_for_explicit_compatibility_mode -q
```

Result: passed.

Touched-suite verification:

```bash
uv run --all-packages python -m unittest tests.retrieval.retrieval_service_replan_execution_suite tests.retrieval.evidence_attributes_suite tests.retrieval.evidence_contract_ranking_suite tests.evals.answer_ready_closeout_audit_suite tests.evals.answer_ready_component_eval_suite tests.agent.test_rag_retrieval_plan -q
```

Result: `Ran 67 tests` / `OK`.

Additional closeout hardening verification:

```bash
uv run --all-packages python -m unittest tests.shared.test_answer_ready_evidence_contract.AnswerReadyEvidenceContractTest.test_v3_validation_fails_when_procedure_actor_uses_generic_fallback_actor tests.shared.test_answer_ready_evidence_contract.AnswerReadyEvidenceContractTest.test_v3_validation_fails_when_procedure_action_uses_generic_fallback_action tests.ingestion.test_index_release_acceptance.IndexReleaseAcceptanceTest.test_release_chunk_quality_reports_generic_fallback_procedure_actor tests.ingestion.test_index_release_acceptance.IndexReleaseAcceptanceTest.test_release_chunk_quality_reports_generic_fallback_procedure_action -q
```

Result: `Ran 4 tests` / `OK`.

```bash
uv run --all-packages python -m unittest tests.shared.test_answer_ready_evidence_contract tests.ingestion.test_index_release_acceptance -q
```

Result: `Ran 95 tests` / `OK`.

Additional post-publish payload semantic audit verification:

```bash
uv run --all-packages python -m unittest tests.ingestion.test_registry_scope_release.RegistryScopeReleaseTest.test_post_publish_audit_fails_when_sampled_payload_keeps_target_v3_fallback_provenance tests.ingestion.test_registry_scope_release.RegistryScopeReleaseTest.test_post_publish_audit_fails_when_sampled_payload_keeps_target_v3_fallback_procedure_provenance -q
```

Result: `Ran 2 tests` / `OK`.

```bash
uv run --all-packages python -m unittest tests.ingestion.test_registry_scope_release tests.ingestion.test_index_release_acceptance -q
```

Result: `Ran 61 tests` / `OK`.

```bash
uv run --all-packages ruff check packages/ingestion-core/src/campus_ingestion_core/registry_scope_release.py tests/ingestion/test_registry_scope_release.py
uv run --all-packages ruff format packages/ingestion-core/src/campus_ingestion_core/registry_scope_release.py tests/ingestion/test_registry_scope_release.py --check
```

Result: passed.

## Residual Gap

Phase 11 is materially advanced but not yet declared complete at the workstream level.

Remaining closeout work is planning-truth completion audit:

- keep `GAP-LEDGER.md` / `README.md` / `STATE.md` / `ROADMAP.md` aligned with audited evidence only
- run broader repo gates before any final claim of workstream completion
- current repo-wide markdown gate remains blocked by unrelated baseline issue
  `infra/otel/README.md:27` (`MD013`)
