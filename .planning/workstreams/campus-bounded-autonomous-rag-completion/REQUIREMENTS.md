---
doc_type: requirements
status: active
created: 2026-05-04
updated: 2026-05-04
---

<!-- markdownlint-disable MD013 -->

# Requirements: Campus-Bounded Autonomous RAG Completion

## Goal

补齐 `campus-agent` 在校园边界内真正需要的 autonomous RAG 能力，让 RAG 在 supervisor-led
multi-agent 架构中具备 bounded autonomy、typed planning、source-trust awareness、
grounded synthesis、guardrailed tool/context usage、repeatable eval gates 与 production runtime
controls。

本线的目标不是追求开放域 full autonomous agent，而是把校园助理的可控自主性做完整。

## Current Gap Assessment

当前已具备：

- `agentic-rag-runtime-rearchitecture` 已完成 planner-first RAG runtime、typed retrieval plan、
  bounded replan provenance、evidence selection stage、grounding stage 与 diagnostic attribution。
- `supervisor-multi-agent-runtime-contract-hardening` 已完成 multi-agent contract hardening：
  AgentSpec、AgentInvocation、context projection、tool provenance、workflow trace / eval contract。
- `retrieval-serving-architecture` 已明确当前 query-enabled surface 和
  `current / historical / as_of / compare` version query mode。
- `eval` workstream 已把 RAG-only denominator 收口到 `student_rules`、
  `institutional_rules`、`curriculum_plan`、`official_web/stable_reference`，并排除
  `fresh_news`。

仍需要补齐：

- RAG 对 upstream domain-agent context 的 admission、budget、projection-kind 与 evidence-use
  规则。
- query mode、version、source trust、source freshness 与 answer eligibility 的 plan-time 决策。
- claim-level evidence coverage，不允许 title/entity hit 或 non-answer-bearing chunk 支撑最终断言。
- retrieved content / OCR / HTML / notice body 的 instruction quarantine 与 prompt-injection
  regression gate。
- RAGAS / agent workflow eval 对 planner、handoff、evidence、grounding、guardrail 与 runtime
  overhead 的统一 denominator。
- public/protected product path 的 latency、token、tool turn、cancel、timeout、partial failure 与
  trace-safe observability controls。

## In Scope

- Campus-bounded domain-agent to RAG handoff contract audit and implementation planning.
- RAG-consumable `StepOutputProjection` / context projection rules, including projection kind,
  source refs, content hash, safety summary, length budget and fail-close behavior.
- Query mode planning for `current`、`historical`、`as_of`、`compare` and explicit non-opening of
  `freshness_sensitive` / `live_assisted` unless a separate admission happens.
- Source trust and source eligibility matrix for regulations, curriculum and stable official-web
  references.
- Evidence selection hardening: answer-bearing evidence, claim coverage, citation back-links,
  contradictory evidence handling and no-answer policy.
- Untrusted content guardrails for retrieved chunks, source bodies, OCR text and cross-agent
  projection summaries.
- Eval denominator expansion for RAG quality and workflow correctness, including RAGAS small-sample
  and regression gates.
- Runtime budgets: max turns, max retrieval steps, tool budgets, context budgets, per-stage latency,
  token/cost accounting, cancellation, timeout and fail-close metrics.
- Product path acceptance for `public-chat-web` and protected/operator-facing diagnostics where
  already admitted.

## Out Of Scope

- Open-domain web search / provider-hosted web search as a default answer path.
- Arbitrary URL browse/fetch from user input or retrieved content.
- Reopening `official_web/fresh_news` as current RAG eval or answer surface.
- Replacing Go supervisor deterministic runtime with an agent framework.
- Peer-to-peer autonomous agent mesh.
- Moving retrieval executable types, SDK-native types or infrastructure details into
  `packages/contracts`.
- Making `retrieval-core` own source truth, product scope, runtime profile or serving alias policy.
- State-changing tools, payment, submission, booking, cancellation or other side effects.
- Fixing unrelated worktree dirty files or historical source-pack ingestion gaps not needed by
  current RAG surfaces.

## Success Criteria

1. RAG handoff accepts only admitted projection refs / bounded context, never raw provider traces,
   raw source bodies, raw OCR dumps or raw prompt history.
2. Query planning explicitly records capability, scope, version mode, source-trust requirements,
   freshness posture, step budget and fail-close conditions.
3. Default product paths cannot silently enter `freshness_sensitive` / `live_assisted` or `fresh_news`.
4. Evidence selection requires answer-bearing support for each final claim; unsupported or
   contradictory claims produce no-answer, caveat or clarification rather than hallucinated
   completion.
5. Retrieved content is treated as data: source text cannot override system/developer/tool policy or
   request arbitrary tools.
6. RAGAS / eval reports can attribute low answer relevancy and faithfulness to planner,
   retrieval, evidence selection, synthesis, grounding, guardrail or diagnostic overhead.
7. Runtime path enforces max turns, retrieval steps, tool calls, context length, latency and
   cancellation/fail-close budgets.
8. Public chat acceptance proves improved RAG behavior on admitted campus surfaces without opening
   new serving scopes.
9. Planning and architecture docs explain the completed gap closure and define a precise reopen rule.

## Canonical Entry

- `.planning/workstreams/campus-bounded-autonomous-rag-completion/README.md`
