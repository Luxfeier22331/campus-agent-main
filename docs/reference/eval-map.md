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
-> repo-authored agent cases grouped by tool family
-> `packages/eval-langfuse` submits each case through the app-api chat stream
   or consumes an approved sanitized runtime projection
-> `packages/eval-langfuse` extracts `tool_trajectory.v1`
-> deterministic tool-use scorers write `agent.*` and tool-specific scores to
   Langfuse, or dry-run locally when score publishing is disabled

This lane is not a RAGAS lane. It scores tool decision, argument validity,
result contract validity, fail-closed correctness and tool-specific source
policy checks. It does not score final answer prose, primary model choice or
RAG answer/evidence quality.

The first internal eval slice is public web search:

`agent-tool-use / public-web-search`
-> repo-authored agent cases in
   `packages/eval-langfuse/assets/datasets/agent/public_web_search/agent_cases.v1.json`
-> `packages/eval-langfuse` submits each case through the app-api chat stream
-> `packages/eval-langfuse` writes deterministic tool/source scores to Langfuse,
   or dry-runs locally when score publishing is disabled

The typed tool uses public web sources selected by the model-backed search
provider; it does not produce RAG retrieved contexts or qrels denominators.
`required_answer_facts` are retained as review payload instead of automatic
model-judge scores.

Provider bakeoff uses this same lane. Run one configured `public_web_search`
provider profile per eval pass and compare the resulting deterministic scores
plus latency, provider error rate, provider/model identity and accepted cost
projection. The eval map does not admit provider fallback chains, merged result
sets or model-selected provider routing.

## Active Supporting Surfaces

- Langfuse score config sync:
  `pnpm --dir packages/eval-langfuse langfuse sync-score-configs`
- Langfuse dataset sync:
  `pnpm --dir packages/eval-langfuse langfuse sync-datasets`
- RAG dataset manifest builder:
  `pnpm --dir packages/eval-langfuse langfuse build-rag-dataset-manifest`
- Runtime trace evidence:
  `pnpm --dir packages/eval-langfuse langfuse verify-trace`
- Agent tool-use eval canonical lane:
  `agent-tool-use` over `tool_trajectory.v1`
- Public web search agent asset validation:
  `pnpm --dir packages/eval-langfuse langfuse validate-public-web-search-eval`
- Public web search agent eval through app-api chat:
  `pnpm --dir packages/eval-langfuse langfuse run-public-web-search-agent-eval
  --app-api-base-url <url>`; this is the current public-web-search slice of
  `agent-tool-use`
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

## Eval Asset Boundary

`packages/eval-langfuse/assets` keeps only Langfuse/Ragas-facing truth:

- score registry for active Langfuse score configs
- RAG answer-quality cases that can be synced into Langfuse datasets
- qrels / golden retrieval truth that can be projected into
  `reference_context_ids`
- public web search agent cases for routing, source quality and grounded answer
  review

Old live gate policies, judge rubrics, release-acceptance fixtures, e2e
profile cases, memory profile cases and public sample score-report artifacts
have been removed from the active package.
