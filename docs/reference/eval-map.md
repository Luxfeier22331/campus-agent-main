---
doc_type: reference
truth_scope: eval
owner_boundary: packages/eval-langfuse
status: active
created: 2026-06-26
updated: 2026-07-13
---
# Eval Map

| Concern | Observation | Truth | Scorer | Sink |
| --- | --- | --- | --- | --- |
| Primary tool choice | `tool_trajectory.v2.tool_calls` | `campus/agent/routing` expected tool calls | Ragas `ToolCallAccuracy` / `ToolCallF1` | Langfuse `ragas.tool_call_*` |
| Knowledge search sequence | `tool_trajectory.v2.internal_tool_calls` | Expected targets, history and search count | Ragas argument-aware tool metrics | Langfuse `ragas.tool_call_*` |
| Answer grounding | Answer plus retrieved contexts | Dataset question/reference | Ragas `Faithfulness` | Langfuse `ragas.faithfulness` |
| Answer relevance | Question plus answer | Dataset question | Ragas `AnswerRelevancy` | Langfuse `ragas.answer_relevancy` |
| Context quality | Question, answer/reference and retrieved contexts | Reference answer/context ids | Ragas context collections | Langfuse `ragas.context_*` |
| Goal outcome | Agent messages and terminal result | Reference outcome | Optional Ragas `AgentGoalAccuracyWithReference` | Langfuse `ragas.agent_goal_accuracy.with_reference` |
| Terminal outcome | Product terminal kind | `expected_outcome` | Deterministic equality | Langfuse `execution.outcome_match` |
| Hard-negative retrieval | Retrieved context ids | `forbidden_context_ids[]` | Deterministic absence check | Langfuse `retrieval.forbidden_context_absent` |
| Evidence integrity | Finalization and search projections | Contract invariants | Execution-control tests | Owning runtime test result |

## Boundaries

- Langfuse trace/dataset scoring is external platform work, not `pnpm ci:eval`.
- Dataset scoring links the real target-turn product trace through the official
  dataset-run-item API; it does not create a synthetic experiment trace.
- `reference_context_ids` support exact audit and future benchmark adapters;
  Ragas 0.4.x does not score them through a public ID metric.
- Authz, cancellation, timeout, schema strictness and source-ref validation stay
  in owning runtime tests rather than LLM judges.
- Official-web has no serving target and therefore no online RAG denominator.
