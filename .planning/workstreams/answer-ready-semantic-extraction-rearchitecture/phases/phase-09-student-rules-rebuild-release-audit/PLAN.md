---
doc_type: phase_plan
status: planned
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 -->

# Phase 9: Student Rules Rebuild Release Audit

## Goal

通过 regulation RAG release lane 重建 `regulations/student_rules` 的 v3 chunks/index/release，并用真实
release/adoption evidence 证明 target serving path 不再依赖 primary text-cue fallback。

## Scope

- Rebuild chunks from canonical document-units.
- Run v3 answer-ready quality gate.
- Run embeddings/index release through release lane.
- Run retrieval acceptance and component eval.
- Publish or adopt serving alias only after gates pass.
- Record post-publish audit.
- Use the command templates frozen in `RELEASE-LANE-ENTRYPOINTS.md`; deviations must be recorded as
  phase blockers, not silent substitutions.

## Deliverables

- Rebuild run artifact path.
- Release admission manifest with `answer_ready_contract_status=passed`.
- Retrieval acceptance report.
- Component eval report.
- Fallback usage report with zero primary text-cue fallback for target v3 cases.
- Alias publish/adoption evidence or explicit current-pointer proof.
- Post-publish drift/payload audit.
- Phase summary updating `GAP-LEDGER.md`.
- Captured command invocations and JSON outputs for admission, release processing, alias operation
  and post-publish audit.

## Implementation Boundaries

- Do not index from raw source or provider output.
- Do not bypass release admission.
- Do not publish alias on supplemental judge pass alone.
- Do not change query-enabled surface.

## Verification

Release commands are fixed by Phase 0 `RELEASE-LANE-ENTRYPOINTS.md`. The phase summary must record
the exact commands used, the chosen release path, the rationale for that path, and the resulting JSON
output.

Admission is mandatory:

```bash
uv run --all-packages python -m campus_ingestion_worker.admit_regulation_rag_release --corpus regulations --collection student_rules --preparation-run-id <run-id> --admission-run-id <admission-run-id>
```

Choose exactly one release execution path for serving adoption. The Phase 9 serving-adoption path is
direct registry-scope release because the current explicit enqueue CLI is scoped to institutional
candidate workflows. Candidate processing can be used only if a valid pre-existing pending
`student_rules` candidate is intentionally processed as diagnostic evidence, and it must not replace
the serving-adoption proof.

Diagnostic-only candidate processor path, if a valid pending candidate already exists:

```bash
uv run --all-packages python -m campus_ingestion_worker.process_regulation_rag_release_candidates --candidate-id <candidate-id> --release-admission-manifest-key <manifest-key> --acceptance-case-path <path> --publish-alias
```

Serving-adoption registry scope release path:

```bash
uv run --all-packages python -m campus_ingestion_worker.release_registry_scope --corpus regulations --collection student_rules --preparation-run-id <run-id> --release-admission-manifest-key <manifest-key> --acceptance-case-path <path> --publish-alias
```

Do not count the unchosen release path as serving adoption proof. `scope_alias` is optional after a
successful `--publish-alias` release and is required only when this phase performs explicit alias
adoption/correction proof:

```bash
uv run --all-packages python -m campus_ingestion_worker.scope_alias --corpus regulations --collection student_rules --physical-collection-name <physical-collection-name> --action-reason <reason>
```

Minimum local gates:

```bash
uv run --all-packages python -m unittest tests.ingestion.test_index_release_acceptance tests.retrieval.evidence_contract_ranking_suite tests.evals.answer_ready_component_eval_suite tests.agent.rag_agent_realistic_e2e_samples_suite -q
```

Record these output fields:

```text
manifest_object_key
physical_collection_name
serving_alias
answer_ready_contract_status
retrieval_acceptance_status
fallback_primary_signal_count
post_publish_audit_status
answer_ready_contract_version
answer_ready_semantic_failure_count
semantic_oracle_pass_count
semantic_oracle_fail_count
```

## Exit Criteria

- `student_rules` v3 release is accepted and serving truth is proven.
- `fallback_primary_signal_count == 0` for target v3 acceptance cases.
- Post-publish audit passes.
- No old-index compatibility report is used as target completion evidence.
- Release command outputs match Phase 0 required artifact fields.
- Phase summary names the chosen release path and does not treat the unchosen path as adoption proof.
- Student-rule semantic oracle rows pass against the rebuilt serving alias.

## Non-Goals

- Rebuild `institutional_rules`.
- Change handbook OCR/source truth.
