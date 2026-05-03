---
doc_type: phase_plan
status: completed
workstream: regulation-rag-release-lane
phase: phase-09-institutional-30-release
created: 2026-05-03
updated: 2026-05-03
---
# Phase 9 Plan: Institutional 30 Release

## Goal

Publish the current校级 `regulations/institutional_rules` scope through the
regulation RAG release lane, using release admission and retrieval acceptance
before switching the serving alias.

## Scope

- Include only current校级 `institutional_rules` records admitted by the operator
  registry.
- Keep院级 `scoped_rules` outside default query-serving.
- Use the existing `institutional_rules_release_acceptance.v1.json` release gate
  after aligning version locks with the current operator registry.

## Steps

- Confirm reader publish, chunk preparation and release admission evidence for
  the 30-record current institutional scope.
- Enqueue all 30 records into the regulation RAG release candidate store.
- Process pending candidates with the registry-scope RAG release executor,
  release admission manifest and institutional acceptance fixture.
- If acceptance fails because fixture version locks are stale, update the qrels
  and release acceptance fixture to current operator registry version ids, then
  replay the candidate processor.
- Verify candidate store status, serving alias target and point count.
- Record final workstream evidence and close the lane.

## Verification

```bash
jq empty \
  packages/evals/fixtures/institutional_rules_release_acceptance.v1.json \
  packages/evals/fixtures/institutional_rules_retrieval_qrels.json \
  .planning/workstreams/regulation-rag-release-lane/evidence/phase-09-institutional-30-release/*.json

uv run --all-packages python -m unittest \
  tests.ingestion.test_admit_regulation_rag_release_worker \
  tests.ingestion.test_process_regulation_rag_release_candidates_worker \
  tests.ingestion.test_index_release_acceptance \
  tests.evals.retrieval_benchmark_qrels_module_and_handbook_suite \
  -v
```
