---
doc_type: reference
truth_scope: eval
owner_boundary: packages/eval-langfuse
status: active
created: 2026-06-28
updated: 2026-07-03
---
# Eval

## Active Shape

Repo-owned eval is now Langfuse/Ragas-first:

- `packages/eval-langfuse` owns TypeScript adapters for Langfuse datasets,
  traces, score config sync, dataset sync, safe Ragas projection, score
  publishing, trace verification and agent eval runners.
- `packages/ragas-runner` is the only accepted Python island. It runs upstream
  Ragas over safe JSON input produced by TypeScript.
- `packages/eval-langfuse/assets` keeps repo-authored Langfuse/Ragas-facing
  eval asset truth. Public RAG assets under this root are source-clean synthetic
  examples for qrels / answer-quality shape; they are not the real release gold
  corpus.
- `packages/eval-langfuse/assets/datasets/agent/public_web_search` keeps
  the first tool-specific case slice for `agent-tool-use`: public-web-search
  routing/tool selection, source quality and grounded answer review.
- Runtime behavior, workflow orchestration, authz and product contracts belong
  to their owning apps/packages and their tests. They must not be recreated as
  broad self-built eval frameworks.

The completed platform loop is:

```text
Langfuse traces / datasets
-> packages/eval-langfuse safe projection
-> packages/ragas-runner upstream Ragas
-> packages/eval-langfuse Langfuse scores
```

This is the scoring part of the broader learning loop defined in
`docs/architecture/system/learning-loop.md`. Eval lanes validate and compare
candidate improvements; they do not own candidate selection, product feedback
storage, Operator Console surfaces or release authority.

Candidate selection is owned by `jobs/learning-loop-candidates`. It reads safe
online feedback/runtime projections, selects review candidates and can publish
dataset items to Langfuse dataset `online-answer/candidates` through
`packages/eval-langfuse`. It does not run RAGAS, publish scores, query raw
Langfuse traces or expose an Operator Console review UI.

## Active Lanes

Workflow-dispatchable eval lanes are listed in `docs/reference/eval-map.md`.
Current active lanes are:

- `ragas-trace`
- `ragas-dataset`
- `agent-tool-use`

The Ragas lanes follow this closed loop:

```text
Langfuse traces/datasets
-> packages/eval-langfuse safe RAG projection
-> packages/ragas-runner upstream Ragas
-> packages/eval-langfuse Langfuse scores
```

These lanes produce evaluation evidence and review candidates. They are not a
repo-owned release gate framework.

Langfuse experiments and annotation queues remain official platform workflows.
This repo no longer owns custom experiment-manifest or review-manifest
automation.

`ragas-dataset` requires materialized dataset items. Qrels-only dataset items
carry `reference_context_ids` but no generated answer or retrieved context text;
they must be paired with safe trace/observation projection before Ragas scoring.

`agent-tool-use` is not a RAGAS lane. It validates agent tool decisions through
`tool_trajectory.v1`: whether the request should be a direct answer, a
fail-closed outcome or an admitted tool call; whether the selected tool is
correct; whether arguments and result contract are valid; and whether
tool-specific source policy checks pass when the tool returns bounded sources.

The current first tool-specific slice is public web search. It runs cases where
the expected behavior is `public_web_search`, `knowledge_query` or
`direct_answer` through the app-api chat stream. It writes deterministic
Langfuse scores for chosen tool, public HTTPS MUC source policy, required
source coverage and source count. `required_answer_facts` remain review payload
for human / Langfuse review workflows; they are not scored by Ragas.

### Public Web Search Provider Bakeoff

The public-web-search slice of `agent-tool-use` is also the selection lane for
the default `public_web_search` provider profile. Provider adoption is not
decided by architecture preference, provider branding or a single smoke result.

All candidates must be evaluated against the same repo-authored agent cases,
the same source policy and the same score registry. A candidate can become the
default serving profile only when it has:

- correct tool-selection behavior for `public_web_search`, `knowledge_query`
  and `direct_answer` cases
- public HTTPS MUC source-policy validity
- required-source coverage for the expected official page or host
- acceptable source count for answer grounding
- recorded latency, provider error rate and provider/model identity
- accepted unit-cost data when cost projection is claimed

Candidates that expose provider-side domain allowlists should still be checked
by the repo source-policy scorer. Candidates without an equivalent domain
allowlist, including Linux.do Chat Completions web search and the current
Gemini Google Search grounding adapter, must return explicit URL citations and
pass post-search source-policy validation; they must not be treated as
equivalent to allowlisted search APIs until eval evidence supports that default.
Linux.do prompt model evaluation is separate from this lane;
the public-web-search slice only compares the configured `public_web_search`
search profile.

The lane must not add provider fallback chains, result merging or
model-selected provider routing. Compare one active provider profile at a time,
then choose the default profile outside the model-visible tool contract.

## Platform Capabilities

Active repo-owned Langfuse adapter capabilities are:

- learning-loop dataset candidate payload construction and publishing
- score config sync
- dataset sync from repo RAG eval assets
- RAG dataset manifest construction
- public web search agent asset validation
- public web search agent runner through app-api chat stream
- sanitized `tool_trajectory.v1` consumption for tool-use eval
- safe trace/dataset projection into Ragas input
- Ragas trace and materialized-dataset scoring
- `ragas.*` score publishing back to Langfuse
- trace identity, observation contract and forbidden-field verification

Langfuse remains the eval platform and score sink. It does not own canonical
versioned eval asset truth, product storage, Temporal history, operator query
truth, repo contracts or release authority.

## Safe Projection Boundary

Ragas-bound projection may include trace/dataset identity, question/user input,
answer, retrieved contexts, retrieved context ids, reference context ids and
optional reference text when those fields are approved for eval storage.

Forbidden fields include secrets, auth material, raw prompts, raw transcripts,
provider raw responses, unrestricted source bodies, object-store paths and
retrieval backend dumps.

## Active Scores

The active RAG score family is `ragas.*`.

Default metrics:

- `ragas.faithfulness`
- `ragas.answer_relevancy`
- `ragas.context_precision`
- `ragas.context_recall`

Optional metrics are enabled only through Ragas runtime config:

- `ragas.context_precision_without_reference`
- `ragas.id_context_precision`
- `ragas.id_context_recall`

The active deterministic public-web-search agent scores currently registered
for publishing are:

- `agent.tool_selection.correct`
- `public_web_search.source_policy.valid`
- `public_web_search.required_source.covered`
- `public_web_search.source_count`

The canonical `agent-tool-use` score family also admits these deterministic
scores once their producers and registry entries exist:

- `agent.tool_arguments.valid`
- `agent.result_contract.valid`
- `agent.fail_closed.correct`

All score names must exist in
`packages/eval-langfuse/assets/registries/langfuse_score_registry.v1.json` before
publishing. Unknown score names fail closed.

## Eval Asset Semantics

Repo-tracked public RAG assets are synthetic, source-clean examples. They are useful
for schema, dataset-manifest, qrels-only and safe-projection smoke coverage.
They are not a publication of the real private gold truth.

Real release denominators should enter through one of these paths:

- a private asset root passed to `build-rag-dataset-manifest --asset-root`
- existing Langfuse datasets populated from approved private release data
- sanitized runtime trace / observation projection generated by the owning
  runtime

Asset `split` values in `packages/eval-langfuse/assets` are descriptive
dataset partitions:

- `smoke`: small connectivity/projection sample
- `curated`: reviewer-curated representative case
- `regression`: accepted regression case
- `known_gap`: known missing-source or unsupported-capability case

`curated` and `regression` in public synthetic assets do not mean release
admission. Release readiness is owned by product/runtime release checks and
explicit release closeout, not by a fixture label.

## Operator Coverage Projection

The old app-api eval coverage projection is retired. Do not recreate:

- internal coverage snapshot ingest endpoints
- browser-facing eval coverage endpoints
- app-api eval coverage tables
- app-api Ragas low-score diagnostic candidate projections

Coverage and score state now belongs to Langfuse datasets/runs/scores plus the
`packages/eval-langfuse` audit output. The old app-api
`GET /api/operator/quality/eval-candidates` intake is not part of the current
Ops Index target; operator-facing review intake must use a new explicit
curated-summary contract if it returns to the product surface.

## Deleted Self-Built Policy Artifacts

The old repo-owned operations profile policy, denominator registry, RAG
maturity policy/backlog and generated golden dataset matrix are retired and
deleted. Do not recreate them as active eval truth.

Also do not recreate these retired active eval surfaces:

- `packages/evals`
- Python `campus_evals`
- `scripts.eval_gate`
- broad `agent-eval`
- `rag-first-stage`
- `ragas-batch`
- custom `run-experiment`
- custom `sync-annotation-queue`
- custom `export-review-results`
- generic score report publishers or local release-closeout gates

The remaining active eval reference files are:

- `docs/reference/eval-map.md`
- `docs/reference/eval-gold-truth-model.md`
- `docs/reference/eval/retrieval_qrels_denominator_policy.v1.json`
- `docs/reference/eval/rag_known_gap_cases.v1.json`
