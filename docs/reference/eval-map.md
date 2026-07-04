---
doc_type: reference
truth_scope: eval
owner_boundary: packages/eval-langfuse
status: active
created: 2026-06-26
updated: 2026-07-03
---
# Eval Map

This map records the active eval surfaces after retiring the self-built
profile/release gate paths. A workflow-dispatchable eval lane must have an
explicit observation source, scorer, Langfuse score target and owner.
The user-usage learning-loop architecture is defined in
`docs/architecture/system/learning-loop.md`; this map only records scoring lanes.

## Active Workflow Lanes

`ragas-trace`
-> Langfuse traces selected by name, tag, release and optional limit
-> `packages/eval-langfuse` builds a safe RAGAS projection
-> `packages/ragas-runner` executes upstream Ragas
-> `packages/eval-langfuse` writes `ragas.*` scores to Langfuse, or validates
only when `publish_langfuse_scores=false`

`ragas-dataset`
-> Langfuse dataset items selected by dataset name, optional version and limit
-> `packages/eval-langfuse` materializes safe RAGAS projection from dataset item
   fields and linked Langfuse trace / observation fields
-> `packages/ragas-runner` executes upstream Ragas
-> `packages/eval-langfuse` writes `ragas.*` scores to Langfuse, or validates
only when `publish_langfuse_scores=false`

These lanes are scoring lanes, not repo release verdict lanes. They do not
replace runtime-owner contract tests, staging E2E closeout, or product release
authority.

`ragas-dataset` is not a qrels-only scorer. Qrels datasets provide
`reference_context_ids`; answer, retrieved contexts and trace identity must be
materialized before scoring.

## Active Supporting Surfaces

- Learning-loop candidate selector: `jobs/learning-loop-candidates`
- Learning-loop candidate publisher: `jobs/learning-loop-candidates`
- Langfuse score config sync: `packages/eval-langfuse`
- Langfuse dataset sync: `packages/eval-langfuse`
- RAG dataset manifest builder: `packages/eval-langfuse`
- Runtime trace evidence verifier: `packages/eval-langfuse`

Repeatable commands for these supporting surfaces belong to
`docs/runbooks/eval-operations-governance.md`.

`ragas_sample_batch.v1` remains an internal/transient bridge between the TS
Langfuse adapter and the Python Ragas island. It is not a public release-gate
CLI path.

## Retired Surfaces

The following self-built lanes are no longer active eval package surfaces:

- `online-answer-path`
- `authz-privacy`
- `agentic-retrieval-plan`
- `hindsight-memory-product-path`
- `rag-first-stage`
- broad `agent-eval`
- custom `run-experiment`
- custom `sync-annotation-queue`
- custom `export-review-results`
- artifact `run-ragas-scoring`
- artifact `publish-score-report`
- app-api `online-answer-path:collect:staging`
- app-api Langfuse eval backlink routes
- Go `cmd/intent-eval-runner`
- Python `campus_evals` and the retired `packages/evals`

Runtime behavior and agent/workflow regressions should be covered by the
owning runtime tests, Temporal/execution-control traces, Langfuse datasets /
experiments, Ragas scoring, or a narrow adapter to an explicit official
benchmark. They should not reappear as repo-owned broad eval frameworks.

Learning-loop candidates are dataset intake, not scoring lanes. The selector
reads `chat.message_feedback` and `runtime.request_observability_fact`, emits
safe candidate records, and writes only Langfuse dataset items through
`packages/eval-langfuse`.

Langfuse annotation queues remain an official human review workflow, but the
repo no longer owns custom queue sync/export commands.

## Fixture Boundary

`packages/eval-langfuse/fixtures` keeps only Langfuse/Ragas-facing truth:

- score registry for active Langfuse score configs
- RAG answer-quality cases that can be synced into Langfuse datasets
- qrels / golden retrieval truth that can be projected into
  `reference_context_ids`

Old live gate policies, judge rubrics, release-acceptance fixtures, e2e
profile cases, memory profile cases and public sample score-report artifacts
have been removed from the active package.
