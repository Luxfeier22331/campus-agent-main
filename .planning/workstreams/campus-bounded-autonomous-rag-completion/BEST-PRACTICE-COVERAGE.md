---
doc_type: coverage
status: completed
created: 2026-05-05
updated: 2026-05-05
---

<!-- markdownlint-disable MD013 -->

# Best-Practice Coverage: Campus-Bounded Agentic RAG

## Scope

This document maps externally confirmed agentic-system guidance to the bounded campus RAG
implementation. It is not an admission to open general web search, `fresh_news`, arbitrary URL
fetch or provider-hosted web search.

## External Baseline

- OpenAI Agents SDK docs describe agents as applications that plan, call tools, collaborate across
  specialists and keep enough state for multi-step work:
  `https://developers.openai.com/api/docs/guides/agents`
- OpenAI orchestration docs distinguish handoffs from manager-style bounded specialist calls, and
  recommend adding specialists only when ownership, policy, prompt clarity or trace legibility
  materially improves:
  `https://developers.openai.com/api/docs/guides/agents/orchestration`
- OpenAI guardrails docs separate input, output and tool guardrails, and note tool-call checks
  should live next to the tool boundary when every custom tool call needs validation:
  `https://developers.openai.com/api/docs/guides/agents/guardrails-approvals`

## Coverage Matrix

|Best-practice dimension|Campus-bounded implementation evidence|Regression gate|
|---|---|---|
|Structured planning|`RetrievalPlan`, `RetrievalStep`, planner information needs and safe entity resolution summaries|`tests.agent.rag_agent_agentic_runtime_contract_suite` and `tests.agent.rag_agent_agentic_depth_runtime_suite`|
|Bounded handoff|`WorkflowAgentContext.projection_refs` with required metadata and raw-key rejection|`tests.contracts.contract_models_workflow_projection_refs_suite`|
|Specialist boundary|RAG remains `supervisor -> agent` delegated capability; retrieval executable types stay out of public contracts|`tests.test_agentic_rag_completion_ledger` plus contract model suites|
|Tool guardrails|ToolSpec and runtime policy remain repo-owned; RAG eval denominator keeps unadmitted live/source paths fail-closed|`tests.evals.agentic_retrieval_plan_eval_suite`|
|Untrusted content quarantine|Source/projection summaries reject raw payload/body/auth keys and retrieved content cannot become tool policy|`tests.contracts.contract_models_agentic_rag_summaries_suite` and `tests.contracts.contract_models_workflow_projection_refs_suite`|
|Trace/eval attribution|Eval cases track decomposition, planner quality, replan reason, claim graph verdicts and best-practice coverage dimensions|`tests.evals.agentic_retrieval_plan_eval_suite`|
|Budget/fail-close|Replan preserves scope/selector/budget and live/latest branches fail closed unless separately admitted|`tests.retrieval.retrieval_service_replan_execution_suite`|

## Current Non-Goals

- No open-domain full autonomous agent.
- No default live/latest/freshness answer path.
- No arbitrary URL browse/fetch.
- No provider-hosted web-search fallback.
- No state-changing tools or HITL approval lane in RAG; those require separate admission.
