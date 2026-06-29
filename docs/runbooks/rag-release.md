---
doc_type: runbook
truth_scope: ops
owner_boundary: docs/runbooks
status: active
created: 2026-06-28
updated: 2026-06-28
---
# RAG Release

## Boundary

This runbook owns the repeatable release / rebuild acceptance flow for current
query-serving RAG collections.

Current covered surfaces:

- `regulations/student_rules`
- `curriculum/curriculum_plan`

It does not own source-truth cleaning rules, split-manifest policy, eval
denominators, Execution Agent Layer routing, or one-off release evidence.

## Source Of Truth

- Retrieval architecture: `../architecture/system/retrieval-serving.md`
- Data-plane release model: `../architecture/system/data-plane.md`
- Eval metrics:
  - `../reference/student-handbook-eval-metrics.md`
  - `../reference/curriculum-plan-eval-metrics.md`
- Collection runtime profiles:
  - `../../configs/ingestion/regulations/student_rules/runtime-profile.json`
  - `../../configs/ingestion/curriculum/curriculum_plan/runtime-profile.json`

## Common Baseline

Current hybrid baseline:

- dense: `Qwen3-Embedding-4B @ 2560`
- sparse: Qdrant native BM25, tokenizer `multilingual`, language `none`
- fusion: native hybrid query with RRF
- evidence shape: registry-backed `EvidenceBundle`

Live / remote sparse execution uses self-hosted Qdrant server-side BM25
inference. Local mocks are test doubles and do not define live sparse truth.

## Preflight

Before release acceptance:

1. Confirm the runtime profile points at the intended corpus / collection,
   serving alias, physical collection prefix and vector binding.
1. Confirm source OCR truth in the runtime profile still matches the accepted
   source family.
1. Confirm `DOCUMENT_REGISTRY_DATABASE_URL` points at the registry for this
   release candidate.
1. Confirm reset / publish policy for the target alias family is explicit.
1. Confirm legacy corpus-specific Python live runner entrypoints are not used.

For `student_rules`, also confirm payload indexes required by authorization
projection are present, including `entitlement_groups`, `visibility_scope`,
`visibility_level` and `policy_projection_version`.

## Release Acceptance Flow

1. Run ingestion-control owned rebuild / release / alias publish, or confirm the
   current serving collection is the intended release.
1. Record collection schema, point count, payload sample and registry backlink
   sample.
1. Run collection-specific hybrid query fixture.
1. Run retrieval qrels scorer against explicit run results.
1. Run deterministic workflow / status release gate and error gate where the
   collection has scenarios.
1. Save one sanitized release acceptance result for coverage / qrels tooling.

Expected result artifact names:

- `student_rules_release_acceptance.v1.result.json`
- `curriculum_plan_release_acceptance.v1.result.json`

## Surface-Specific Fixtures

`student_rules`:

- hybrid fixture:
  `packages/evals/fixtures/rag/student_rules/hybrid_queries.json`
- retrieval qrels:
  `packages/evals/fixtures/rag/student_rules/retrieval_qrels.json`
- release acceptance interpretation:
  `../reference/student-handbook-eval-metrics.md`

`curriculum/curriculum_plan`:

- hybrid fixture:
  `packages/evals/fixtures/rag/curriculum_plan/hybrid_queries.json`
- retrieval qrels:
  `packages/evals/fixtures/rag/curriculum_plan/retrieval_qrels.json`
- release acceptance interpretation:
  `../reference/curriculum-plan-eval-metrics.md`

## Commands

Repo-tracked automated baseline:

```bash
uv run --all-packages python -m unittest \
  tests.evals.test_retrieval_benchmark \
  tests.evals.test_golden_cases
```

Retrieval benchmark scorer:

```bash
uv run --all-packages python -m campus_evals.retrieval_benchmark \
  --qrels <qrels.json> \
  --results <run-results.json>
```

Workflow / status deterministic gate:

```bash
uv run --all-packages python -m unittest tests.evals.test_golden_cases
```

## Evidence Template

Every fresh release acceptance should record:

- timestamp, branch and git commit
- serving alias and physical collection
- collection schema and point count
- payload sample and registry backlink sample
- retrieval benchmark aggregate / split summary
- hybrid fixture top hit / failure reason
- workflow status distribution where applicable
- deterministic release gate / error gate summary where applicable
- runtime observation summaries if provider execution participated

Do not keep `.tmp` paths as long-lived documentation. Promote only stable
denominators, accepted interpretations or artifact contract changes into the
matching reference docs.

## Failure Signatures

- `Index required but not found for "entitlement_groups"` means the serving alias
  likely points to an old schema collection. Fix the release / alias target; do
  not blame provider runtime.
- Empty chunks, missing registry records or missing source truth are fail-closed
  release blockers.
- Provider outage is a runtime blocker, not a corpus truth gap.
- No-hit behavior must return an empty bundle; it must not fall back to local
  lexical repair or old-index compatibility.
