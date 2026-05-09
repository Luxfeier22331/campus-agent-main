---
doc_type: phase_summary
status: completed
created: 2026-05-08
updated: 2026-05-09
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

Final closeout review also fixed one lingering ingestion regression and one deeper publish-audit
blind spot:

- `_build_answer_ready_regulation_segments()` now passes the first item block text into
  `_first_item_line_index(...)`, which restores `regulation_chunk_precision` coverage
- post-publish audit now compares sampled flat payload metadata with runtime-effective metadata
  recovered from `_node_content`
- closeout audit fails when only runtime metadata still marks target-v3 contract or keeps fallback
  provenance
- closeout audit also fails when flat payload projection drops target-v3 markers that runtime
  retrieval would still consume

Final closeout review also hardened release-manifest audit consistency:

- release-admission manifests are now idempotent-only for a given `admission_run_id`; conflicting
  rewrites fail closed instead of silently replacing prior admission truth
- release/admission manifest cross-check now fails when `admitted_at > published_at`
- offsetless/naive ISO timestamps now fail closed as invalid audit input instead of raising a
  runtime comparison error

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
- `packages/ingestion-core/src/campus_ingestion_core/regulation_rag_release_admission.py`
- `packages/ingestion-core/src/campus_ingestion_core/regulation_rag_release_manifest_audit.py`
- `packages/ingestion-core/src/campus_ingestion_core/regulation_chunking.py`
- `tests/retrieval/retrieval_service_replan_execution_suite.py`
- `tests/agent/test_rag_retrieval_plan.py`
- `tests/ingestion/test_registry_scope_release.py`
- `tests/ingestion/test_regulation_rag_release_manifest_audit.py`
- `tests/ingestion/test_regulation_chunk_precision.py`
- `tests/ingestion/test_index_release_acceptance.py`
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
uv run --all-packages python -m unittest tests.ingestion.test_regulation_chunk_precision -q
```

Result: `Ran 3 tests` / `OK`.

```bash
uv run --all-packages python -m unittest tests.ingestion.test_regulation_rag_release_manifest_audit tests.ingestion.test_index_release_acceptance -q
```

Result: `Ran 51 tests` / `OK`.

```bash
uv run --all-packages python -m unittest tests.agent.rag_agent_retrieval_intent_planning_suite tests.agent.rag_agent_institutional_rules_consumption_suite tests.evals.regulation_answer_ready_component_live_runner_suite tests.ingestion.test_registry_scope_release tests.retrieval.evidence_contract_ranking_suite tests.evals.answer_ready_component_eval_suite tests.ingestion.test_regulation_chunk_precision -q
```

Result: `Ran 85 tests` / `OK`.

```bash
uv run --all-packages python -m unittest discover -s tests -t .
```

Result: `Ran 2941 tests in 25.990s` / `FAILED (failures=7, errors=1, skipped=1)`.

The remaining broad failures are outside this workstream:

- `tests.api.supervisor_api_bridge_services_suite.*`
- `tests.ingestion.authenticated_notice_import_inventory_suite.*`
- `tests.ingestion.test_collected_notice_queue_consumer.*`
- `tests.ingestion.test_official_web_university_collection_worker.*`
- `tests.test_check_decomposition_tracked.*`
- `tests.test_environment_layout.*`
- `tests.test_supervisor_runtime_process_smoke.*`

```bash
pnpm docs:lint
pnpm yaml:lint
```

Result:

- `pnpm docs:lint`: `Summary: 0 error(s)`
- `pnpm yaml:lint`: `Validated 22 YAML files from current worktree outside .planning/.`

```bash
uv run --all-packages ruff check .
uv run --all-packages ruff format . --check
pnpm decomposition:lint
```

Result:

- `uv run --all-packages ruff check .`: failed (`Found 51 errors`)
- `uv run --all-packages ruff format . --check`: failed
  (`112 files would be reformatted, 1789 files already formatted`)
- `pnpm decomposition:lint`: failed; repo-wide decomposition drift remains, including
  answer-ready-related long files such as
  `packages/shared/src/campus_shared/regulation_semantic_registry.py`,
  `packages/ingestion-core/src/campus_ingestion_core/regulation_chunking.py`,
  `tests/ingestion/test_handbook_chunking_pipeline.py`,
  `tests/ingestion/test_index_release_acceptance.py`, and
  `tests/ingestion/test_registry_scope_release.py`

```bash
uv run --all-packages ruff check packages/ingestion-core/src/campus_ingestion_core/registry_scope_release.py tests/ingestion/test_registry_scope_release.py
uv run --all-packages ruff format packages/ingestion-core/src/campus_ingestion_core/registry_scope_release.py tests/ingestion/test_registry_scope_release.py --check
```

Result: passed.

```bash
uv run --all-packages ruff check packages/shared/src/campus_shared/regulation_semantic_registry.py packages/shared/src/campus_shared/answer_ready_evidence_contract.py packages/ingestion-core/src/campus_ingestion_core/regulation_chunking.py packages/ingestion-core/src/campus_ingestion_core/registry_scope_release.py packages/ingestion-core/src/campus_ingestion_core/regulation_rag_release_admission.py packages/ingestion-core/src/campus_ingestion_core/regulation_rag_release_manifest_audit.py packages/retrieval-core/src/campus_retrieval_core/service_step_executor.py packages/rag-agent/src/campus_rag_agent/typed_answer_drafts.py tests/ingestion/test_registry_scope_release.py tests/ingestion/test_index_release_acceptance.py tests/ingestion/test_regulation_chunk_precision.py tests/ingestion/test_regulation_rag_release_manifest_audit.py tests/retrieval/evidence_contract_ranking_suite.py tests/shared/test_regulation_semantic_registry.py tests/shared/test_answer_ready_evidence_contract.py tests/agent/rag_agent_retrieval_intent_planning_suite.py tests/agent/rag_agent_institutional_rules_consumption_suite.py tests/evals/regulation_answer_ready_component_live_runner_suite.py
uv run --all-packages python -m unittest tests.shared.test_regulation_semantic_registry tests.shared.test_answer_ready_evidence_contract tests.agent.rag_agent_institutional_rules_consumption_suite tests.evals.regulation_answer_ready_component_live_runner_suite -q
```

Result:

- targeted answer-ready `ruff check`: `All checks passed!`
- focused regression suite: `Ran 206 tests` / `OK`

## Final Status

Phase 11 functional closeout work is complete, and the last workstream-owned semantic review
findings are closed. Workstream closure remains blocked by the explicit repo-owned
`Verification Baseline` in `REQUIREMENTS.md`, which is still red on broad `ruff`,
`ruff format`, `decomposition`, and `unittest discover`.
