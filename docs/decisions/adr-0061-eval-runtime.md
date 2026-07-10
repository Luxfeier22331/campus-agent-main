---
doc_type: decision
truth_scope: repository
owner_boundary: docs/decisions
decision_id: ADR-0061
status: accepted
created: 2026-06-26
updated: 2026-06-28
---
# ADR-0061: Eval Runtime

## Context

`campus-agent` already uses Langfuse as the LLM observability and eval
platform. ADR-0059 accepted Langfuse as a telemetry / eval sink and feedback
workflow platform while keeping execution, product projection and contract
truth in this repository.

The old eval runtime was Python-heavy:

- `packages/evals` owned many fixtures, qrels, deterministic scorers, profile
  reports and release gate helpers.
- `scripts.eval_gate` was the shared Python gate CLI for release automation.
- `packages/eval-langfuse` already owns the TypeScript Langfuse platform
  adapter, dataset sync, trace verification and Ragas score publication.
- RAGAS remains a necessary long-term RAG quality capability, but the old
  Python eval framework is too broad to remain its owner.

This split leaves the wrong long-term default. New eval work should not expand
Python-side self-built automation when Langfuse already provides datasets,
experiments, scores, score configs, annotation queues and score analytics.

Official Langfuse docs describe the platform as covering evaluation workflows
with LLM-as-a-Judge, human annotations and custom API/SDK workflows; versioned
datasets for experiments; universal score objects for evaluation results; and
annotation queues for human review:

- <https://langfuse.com/docs/evaluation/overview>
- <https://langfuse.com/docs/evaluation/experiments/datasets>
- <https://langfuse.com/docs/evaluation/scores/overview>
- <https://langfuse.com/docs/evaluation/evaluation-methods/annotation-queues>

## Decision

Make TypeScript plus Langfuse the default eval runtime and platform path.

- New eval runners, score publishing, dataset sync and trace verification
  default to `packages/eval-langfuse` or a TS-owned eval package. Langfuse
  experiments and annotation queues remain official platform workflows, but
  repo-owned custom experiment / review manifest automation is retired.
- The old `packages/evals` package is retired from the active workspace.
  Repo-tracked eval assets and qrels that feed Langfuse now live under
  `packages/eval-langfuse/assets`; runtime-owned test fixtures live with the
  owning runtime. No package metadata, Python modules, runners, publishers,
  provider transport code or release gates may be reintroduced there.
- `packages/ragas-runner` is the only accepted Python exception for RAGAS
  scoring. It is an execution island around the upstream RAGAS library, called
  by TS orchestration, and limited to sanitized artifact input/output.
- Old `scripts.eval_gate` is retired. `packages/eval-langfuse` CLI provides
  TS/Langfuse workflow doctor/audit helpers and must not import `campus_evals`
  or publish case-results artifacts.
- Python eval code is not an accepted owner for gates, truth repair, Langfuse
  adapters, publishers, platform automation or long-lived profile families.
- RAGAS scoring follows ADR-0062. The active workflow sources are Langfuse
  traces / datasets, projected safely by `packages/eval-langfuse`, scored by
  `packages/ragas-runner`, and written back as Langfuse `ragas.*` scores.
  `ragas_sample_batch.v1` is only an internal/transient bridge to the Python
  island, not a public release-gate CLI path.
- The old TS profile lanes (`online-answer-path`, `authz-privacy`,
  `agentic-retrieval-plan`, `hindsight-memory-product-path`) and their
  artifact score publisher are retired from active workflow dispatch.
- Custom `run-experiment`, `sync-annotation-queue` and
  `export-review-results` commands are retired from active workflow dispatch.

Langfuse owns platform artifacts and workflow surfaces: datasets, experiments,
scores, score configs, annotation queues, score analytics and trace drill-down.

The repository still owns canonical truth and release authority: golden cases,
qrels, review/admission policy, business contract truth, authz/privacy
boundaries, sanitized app-api/operator projections and fail-closed release
verdicts.

## Governance Principles

- Langfuse is the eval platform, score sink, official annotation workflow and
  trace drill-down surface. It is not repo truth, execution runtime, product
  storage or release authority.
- The repository owns canonical cases, qrels, review/admission policy, artifact
  schemas, score registry, sanitized projection contracts and release verdicts.
- `packages/eval-langfuse` is the default owner for TS Langfuse platform
  integration, safe Ragas projection, Langfuse platform sync, score publishing
  and trace verification.
- `packages/ragas-runner` may only execute upstream RAGAS scoring against
  safe projection input and emit `ragas_score_batch.v1` output. It must not own
  case truth, trace selection, provider transport, Langfuse publishing, release
  gates or long-lived orchestration.
- The old `packages/evals` package must not be recreated as a fixture package,
  Python package, runner, publisher or release gate owner.
- A new eval lane is admitted only after it declares its observation source,
  artifact schema, score builder, Langfuse score name, denominator rule,
  review semantics and owning package.
- Eval lanes consume sanitized artifacts from execution, product and runtime
  owners. They do not orchestrate production workflows or replace Temporal /
  execution-control ownership.
- Repo-owned broad agent evaluators and retrieval candidate wrappers are not
  accepted eval lanes. Agent evaluation should use Langfuse datasets /
  experiments or explicit mature benchmark adapters; retrieval diagnostics
  should come from execution-control traces or a narrow TS scoring adapter.

## Relationship To Prior ADRs

ADR-0059 remains active. Langfuse is still not the execution runtime, product
data store, operator query backend or contract owner.

ADR-0062 supersedes this ADR's artifact-only assumption for RAGAS input. Ragas
now targets the official Langfuse collaboration flow: Langfuse traces /
datasets provide safe eval projection, Ragas scores it, and Langfuse stores the
scores.

ADR-0003 and ADR-0004 remain active for golden dataset governance and metric
semantics. This ADR supersedes their older implementation wording that named
`packages/evals` as the concrete owner. Current active ownership is
`packages/eval-langfuse` for Langfuse-bound eval assets / artifacts, owning runtime
testdata for runtime-local truth, and `packages/ragas-runner` for the isolated
RAGAS execution island.

## Consequences

- No new Python eval profile is accepted without an explicit migration reason.
- New Langfuse-bound payloads must stay sanitized and fail closed on missing
  identity, denominator drift, missing configuration or forbidden fields.
- Operator Console must not query Langfuse directly. Any drill-down link
  consumed by operator surfaces must pass through the minimal app-api Ops Index
  or safe link template; app-api must not copy Langfuse observations or scores.
- Python `scripts.eval_gate accept`, `campus_evals.profile_registry` and
  direct-process live-smoke profile automation are retired from active release
  automation. Replacement lanes must produce repo-owned artifacts and
  fail-closed release verdicts before they enter workflow dispatch.
- The `campus_evals` Python package is retired from active workspace code.
- New RAGAS features must extend Langfuse safe projection, sanitized
  sample/score artifact contracts or TS Langfuse score path first. They must
  not reintroduce provider projection, HTTP transport tuning, Langfuse
  publishing or release gate ownership into the Python island.
- Documentation that states `packages/evals` owns active eval runtime or eval asset
  truth must be updated to the retired-package boundary above.
