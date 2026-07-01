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
1. Confirm whether this release uses public synthetic repo fixtures or a private
   fixture root / Langfuse dataset. Public fixtures are not real gold truth.

For `student_rules`, also confirm payload indexes required by authorization
projection are present, including `entitlement_groups`, `visibility_scope`,
`visibility_level` and `policy_projection_version`.

## Release Acceptance Flow

1. Run ingestion-control owned rebuild / release / alias publish, or confirm the
   current serving collection is the intended release.
1. Record collection schema, point count, payload sample and registry backlink
   sample.
1. Sync Langfuse-bound qrels / answer-quality data when the denominator
   changed. For real release denominators, use an approved private fixture root
   or existing Langfuse dataset, not the public synthetic repo fixtures.
1. Materialize safe trace or dataset projection from the real runtime path.
1. Run Ragas trace or materialized-dataset scoring in validate-only mode before
   publishing scores.
1. Save one sanitized release acceptance result for runtime-owner closeout and
   Langfuse/Ragas evidence.

Expected result artifact names:

- `student_rules_release_acceptance.v1.result.json`
- `curriculum_plan_release_acceptance.v1.result.json`

## Surface-Specific Fixtures

The repo paths below are public synthetic examples. They validate dataset shape
and smoke projection only. Real gold qrels / answer-quality truth must be
provided by private release data or Langfuse datasets.

`student_rules`:

- retrieval qrels:
  `packages/eval-langfuse/fixtures/rag/student_rules/retrieval_qrels.json`
- release acceptance interpretation:
  `../reference/student-handbook-eval-metrics.md`

`curriculum/curriculum_plan`:

- retrieval qrels:
  `packages/eval-langfuse/fixtures/rag/curriculum_plan/retrieval_qrels.json`
- release acceptance interpretation:
  `../reference/curriculum-plan-eval-metrics.md`

## Commands

Repo-tracked automated baseline:

```bash
uv run --all-packages python -m scripts.langfuse_eval_audit audit --json
```

Ragas scoring lanes:

```bash
pnpm --dir packages/eval-langfuse langfuse ragas-score-traces --validate-only --json
pnpm --dir packages/eval-langfuse langfuse ragas-score-dataset \
  --dataset <dataset-name> --validate-only --json
```

Dataset and score config sync dry-run:

```bash
pnpm --dir packages/eval-langfuse langfuse build-rag-dataset-manifest \
  --fixture-root <public-synthetic-or-private-fixture-root> \
  --output .tmp/langfuse-rag-dataset-manifest.json --json
pnpm --dir packages/eval-langfuse langfuse sync-datasets \
  --dataset-manifest .tmp/langfuse-rag-dataset-manifest.json --dry-run --json
pnpm --dir packages/eval-langfuse langfuse sync-score-configs --dry-run --json
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
