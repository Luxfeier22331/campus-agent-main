---
doc_type: phase_plan
status: planned
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 -->

# Phase 10: Institutional Rules Rebuild Release Audit

## Goal

让 `regulations/institutional_rules` 达到和 `student_rules` 同等的 v3 answer-ready release / serving
adoption 证据，关闭“只有兼容测试、没有真实 release”债务。

## Scope

- Select institutional rule samples and denominators from current admitted corpus.
- Rebuild chunks from canonical document-units.
- Run v3 answer-ready quality gate.
- Run embeddings/index release through release lane.
- Run institutional retrieval acceptance and component eval.
- Publish or adopt serving alias only after gates pass.
- Record post-publish audit.
- Use the command templates frozen in `RELEASE-LANE-ENTRYPOINTS.md`; deviations must be recorded as
  phase blockers, not silent substitutions.

## Deliverables

- Institutional v3 rebuild run artifact path.
- Release admission manifest with `answer_ready_contract_status=passed`.
- Institutional qrels/retrieval acceptance report.
- Component eval report with institutional samples.
- Fallback usage report with zero primary text-cue fallback for target v3 cases.
- Alias publish/adoption evidence or explicit current-pointer proof.
- Post-publish drift/payload audit.
- Phase summary updating `GAP-LEDGER.md`.
- Captured command invocations and JSON outputs for admission, enqueue/processing or registry scope
  release, alias operation and post-publish audit.

## Implementation Boundaries

- Do not promote `scoped_rules`.
- Do not treat document-site publish as RAG serving evidence.
- Do not declare completion from compatibility fixtures alone.

## Verification

Release commands are fixed by Phase 0 `RELEASE-LANE-ENTRYPOINTS.md`. The phase summary must record
the exact commands used, the chosen release path, the rationale for that path, and the resulting JSON
output.

Admission is mandatory:

```bash
uv run --all-packages python -m campus_ingestion_worker.admit_regulation_rag_release --corpus regulations --collection institutional_rules --preparation-run-id <run-id> --admission-run-id <admission-run-id>
```

Choose exactly one release execution path for serving adoption.

Candidate processor path. Candidate enqueue is required only if this path is chosen:

```bash
uv run --all-packages python -m campus_ingestion_worker.enqueue_regulation_rag_release_candidates --corpus regulations --collection institutional_rules --document-id <document-id> --force --output <path>
uv run --all-packages python -m campus_ingestion_worker.process_regulation_rag_release_candidates --candidate-id <candidate-id> --release-admission-manifest-key <manifest-key> --acceptance-case-path <path> --publish-alias
```

Registry scope release path:

```bash
uv run --all-packages python -m campus_ingestion_worker.release_registry_scope --corpus regulations --collection institutional_rules --preparation-run-id <run-id> --release-admission-manifest-key <manifest-key> --acceptance-case-path <path> --publish-alias
```

Do not count the unchosen release path as serving adoption proof. `scope_alias` is optional after a
successful `--publish-alias` release and is required only when this phase performs explicit alias
adoption/correction proof:

```bash
uv run --all-packages python -m campus_ingestion_worker.scope_alias --corpus regulations --collection institutional_rules --physical-collection-name <physical-collection-name> --action-reason <reason>
```

Minimum local gates:

```bash
uv run --all-packages python -m unittest tests.ingestion.test_index_release_acceptance tests.ingestion.test_registry_scope_release_acceptance_wiring tests.retrieval.evidence_contract_ranking_suite tests.evals.answer_ready_component_eval_suite -q
```

Record these output fields:

```text
processed_count
candidate_ids
status_counts
admission_blocked_count
manifest_object_key
physical_collection_name
serving_alias
document_count
point_count
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

- `institutional_rules` v3 release is accepted and serving truth is proven.
- `fallback_primary_signal_count == 0` for target institutional v3 acceptance cases.
- Post-publish audit passes.
- `scoped_rules` remains non-serving.
- Release command outputs match Phase 0 required artifact fields.
- Phase summary names the chosen release path and does not treat the unchosen path as adoption proof.
- Institutional semantic oracle rows pass against the rebuilt serving alias.

## Non-Goals

- Expand institutional denominator beyond admitted corpus.
- Open scoped or院级 rules.
