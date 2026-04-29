---
doc_type: summary
status: completed
created: 2026-04-29
updated: 2026-04-29
phase: 6R.1b
---

<!-- markdownlint-disable MD013 -->

# Phase 6R.1b Summary: Regulation Owner Text Recovery Execution

## Result

Phase 6R.1b is complete.

This phase added a provider-backed owner-text recovery executor for the Phase
6R.1a mini-batch, then executed it with `--execute`.

## Evidence

Evidence directory:

`evidence/phase-06-r1b-regulation-owner-text-recovery-execution/`

Dry-run report:

- selected attempts: `10`
- planned attempts: `10`
- provider calls: `false`
- object-store writes: `false`
- DB writes: `false`

Execute report:

- selected attempts: `10`
- succeeded attempts: `10`
- failed attempts: `0`
- owner-text ready attempts: `10`
- provider: `mineru_api`
- model: `vlm`
- object-store writes: `true`
- DB writes: `false`

Recovered source notice ids:

`620`, `483`, `487`, `485`, `493`, `481`, `564`, `619`, `594`, `509`

Owner text lengths:

`2780`, `1896`, `2450`, `3307`, `3092`, `3039`, `1879`, `4859`, `1795`, `3963`

## Written Output

Each succeeded attempt wrote the refs declared in the Phase 6R.1a attempt plan:

- `provider_response`
- `plain_text`
- `layout_elements`
- `searchable_merge_input`

The first succeeded attempt, source notice `620`, was additionally read back
from object storage after execution. The read-back confirmed non-empty provider
response, owner text, layout elements, and searchable merge input objects under
the declared `campus-rag-source` keys. The sampled evidence is recorded in
`object-store-readback-sample.json`.

## Boundary Decision

This phase only recovers owner text and normalized merge inputs.

It does not write source-truth DB rows, does not materialize `regulations/*`,
and does not publish query-serving state. The next regulation step is to rerun
the Phase 6R.1 admission/audit logic against the new owner-text-ready refs,
then run Phase 6R.2 as a gated materialization dry-run.

## Code

- `packages/ingestion-core/src/campus_ingestion_core/collected_notice_regulation_owner_text_recovery_constants.py`
- `packages/ingestion-core/src/campus_ingestion_core/collected_notice_regulation_owner_text_execution.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/execute_collected_notice_regulation_owner_text.py`
- `tests/ingestion/test_collected_notice_regulation_owner_text_execution.py`
- `tests/ingestion/test_execute_collected_notice_regulation_owner_text_worker.py`

## Follow-Up

Phase 6R.1 has been rerun against this execution report. The next step is Phase
6R.2 no-write gated materialization for the refreshed downstream-admitted
regulation candidates.
