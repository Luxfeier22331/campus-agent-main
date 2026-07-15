---
doc_type: reference
truth_scope: eval
owner_boundary: packages/eval-langfuse
status: active
created: 2026-03-31
updated: 2026-07-13
---
# Eval Gold Truth

## Boundary

Repo-authored agent-routing and RAG truth lives in one `cases.v1.json` per
Langfuse dataset. Runtime-local contract truth remains with the owning runtime
tests. Candidate review, scores and annotations do not directly rewrite either
source.

## Case Shape

Every RAG case has:

- stable `case_id` and `case_family`;
- `split`;
- natural `question`;
- reviewer-authored `reference`;
- stable `reference_context_ids[]` when answer-bearing sources exist;
- ordered `expected_targets[]`;
- `expected_outcome=answer|no_answer`;
- positive `expected_search_count`.

Optional `setup_turns[]` establishes conversation state before the target turn.
Optional `include_history` records a historical retrieval ask.
`forbidden_context_ids[]` records evidence that must not support the answer.
Optional `reference_contexts[]` provides answer-bearing text to metrics that
require reference context text; it does not materialize product retrieval data.

Expected tool calls are derived from this shape: one public
`knowledge_query`, followed by one `knowledge_search` for each expected target.
The dataset does not duplicate that sequence as another authored truth field.

Agent-routing cases use `query`, `expected_outcome`, `reference_tool_calls[]`
and `argument_mode`. `name_only` evaluates direct/function/handoff choice when
arguments are intentionally unstable. `eval_safe_args` may assert only the
allowlisted stable arguments, currently knowledge target and history mode.
Routing cases do not infer tool choice from answer prose.

## Authoring Rules

- Reference answers contain answer-bearing facts, not only document titles.
- Ambiguous questions become clarification/no-answer cases or gain enough
  context to have one defensible truth; do not tune retrieval toward an
  arbitrary document.
- Cross-target questions list every target needed for a supported answer.
- Follow-up cases provide enough `setup_turns` to establish the referenced
  entity before the target question.
- Historical cases set `include_history=true`; current cases do not encode a
  version id.
- Missing data becomes `no_answer`; references must not reward model-memory
  completion.
- Family aliases and partial-answer cases describe the family or supported
  fields explicitly and forbid claims for unavailable fields.

## Admission

A production bad case enters gold truth only after reviewer redaction,
deduplication, expected-target review and source verification. Langfuse
annotation can propose a change, but the accepted repo asset remains the
versioned source.

Public repo assets are synthetic contract examples. Private institutional gold
data may use the same schema through a private asset root or an approved
Langfuse dataset without publishing source text.

## Context IDs

Context ids preserve exact source expectations and support retrieval audits.
They do not imply that upstream Ragas exposes an ID-based metric. Text-based
Ragas context metrics require a materialized run with sanitized retrieved
contexts and an applicable reference answer.
