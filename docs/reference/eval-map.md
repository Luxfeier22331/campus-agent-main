---
doc_type: reference
truth_scope: eval
owner_boundary: packages/eval-langfuse
status: active
created: 2026-06-26
updated: 2026-07-09
---
# Eval Map

This map records the active eval surfaces after retiring the self-built
profile/release gate paths. An internal eval lane must have an explicit
observation source, scorer, Langfuse score target and owner.
The user-usage learning-loop architecture is defined in
`docs/architecture/system/learning-loop.md`; this map only records scoring lanes.

## Active Eval Lanes

`ragas-trace`
-> Langfuse traces selected by name, tag, release and optional limit
-> `packages/eval-langfuse` builds a safe RAGAS projection
-> `packages/ragas-runner` executes upstream Ragas
-> `packages/eval-langfuse` writes `ragas.*` scores to Langfuse, or validates
only when `--validate-only` is set

`ragas-dataset`
-> Langfuse dataset items selected by dataset name, optional version and limit
-> `packages/eval-langfuse` materializes safe RAGAS projection from dataset item
   fields and linked Langfuse trace / observation fields
-> `packages/ragas-runner` executes upstream Ragas
-> `packages/eval-langfuse` writes `ragas.*` scores to Langfuse, or validates
only when `--validate-only` is set

These lanes are scoring lanes, not repo release verdict lanes. They do not
replace runtime-owner contract tests, staging E2E closeout, or product release
authority.

`ragas-dataset` is not a qrels-only scorer. Qrels datasets provide
`reference_context_ids`; answer, retrieved contexts and trace identity must be
materialized before scoring.

`agent-tool-use`
-> repo-authored agent cases grouped by tool group
-> `packages/eval-langfuse` submits each case through the app-api chat stream
   or consumes an approved sanitized runtime projection
-> `packages/eval-langfuse` extracts `tool_trajectory.v1`
-> deterministic tool-use scorers write `agent.*` and tool-specific scores to
   Langfuse, or dry-run locally when score publishing is disabled

This lane is not a RAGAS lane. It scores tool decision, argument validity,
result contract validity, fail-closed correctness and tool-specific source
policy checks. It does not score final answer prose, primary model choice or
RAG answer/evidence quality.

Current `agent-tool-use` cases distinguish direct answer,
`transport_schedule_lookup` and `knowledge_query`. Knowledge cases validate the
official SDK handoff, strict scope/version arguments, internal
`knowledge_search` evidence and finalized source integrity. Trusted explicit
hints remain eval/debug-only and do not define the ordinary product path.

## Active Supporting Surfaces

- Langfuse score config sync:
  `pnpm --dir packages/eval-langfuse exec tsx ./src/cli.ts sync-score-configs`
- Langfuse dataset sync:
  `pnpm --dir packages/eval-langfuse exec tsx ./src/cli.ts sync-datasets`
- RAG dataset manifest builder:
  `pnpm --dir packages/eval-langfuse exec tsx ./src/cli.ts build-rag-dataset-manifest`
- Runtime trace evidence:
  `pnpm --dir packages/eval-langfuse exec tsx ./src/cli.ts verify-trace`
- Agent tool-use eval canonical lane:
  `agent-tool-use` over `tool_trajectory.v1`
- Learning-loop candidate selector / publisher:
  `jobs/learning-loop-candidates`

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
- retired app-api online-answer-path collector aliases
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

## Eval Asset Boundary

`packages/eval-langfuse/assets` keeps only Langfuse/Ragas-facing truth:

- score registry for active Langfuse score configs
- RAG answer-quality cases that can be synced into Langfuse datasets
- qrels / golden retrieval truth that can be projected into
  `reference_context_ids`

Old live gate policies, judge rubrics, release-acceptance fixtures, e2e
profile cases, memory profile cases and public sample score-report artifacts
have been removed from the active package.
