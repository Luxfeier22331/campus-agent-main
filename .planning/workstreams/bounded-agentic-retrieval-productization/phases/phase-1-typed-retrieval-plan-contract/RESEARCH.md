---
doc_type: research
status: active
created: 2026-04-21
updated: 2026-04-21
---

# Phase 1 Research

## Existing Repo Truth

### Current retrieval baseline is still single-shot

- `docs/architecture/system/retrieval-serving-architecture.md` 明确区分：
  - current baseline = single-shot hybrid retrieval
  - target shape = planner-first agentic retrieval
- 当前 retrieval pipeline 仍是：
  - query framing
  - version / surface selection
  - metadata filter
  - candidate retrieval
  - fusion / ranking
  - evidence shaping

直接含义：

- `Phase 1` 不能假装 multi-step 已存在
- `Phase 1` 必须先定义新的 typed plan truth，而不是先改 executor

### Current `rag-agent` planning is rewrite-level, not step-level

- `packages/rag-agent/src/campus_rag_agent/intent.py` 中 `RagRetrievalPlan` 仍只是：
  - `default_rewrite`
  - `personalized_rewrite`
- `packages/rag-agent/src/campus_rag_agent/service.py` 当前仍按 scope-specific query planning +
  single retrieval call 组织回答流程

直接含义：

- Phase 1 需要决定：
  - typed retrieval plan 是否进入 `packages/contracts`
  - 还是先作为 `rag-agent` / `retrieval-core` 之间的 package-internal seam
- 不应把当前 rewrite label 误写成长期 `RetrievalPlan`

### Current `retrieval-core` still owns a single-request kernel

- `packages/retrieval-core/src/campus_retrieval_core/models.py` 只有 `RetrievalRequest`
- `packages/retrieval-core/src/campus_retrieval_core/service.py` 当前入口是一次 `retrieve_sources(...)`

直接含义：

- `RetrievalStep` 不能只是 `RetrievalRequest` 改名
- step contract 必须区分：
  - planner-emitted step truth
  - executor-consumed retrieval kernel request

### Versioned-history foundation is already closed

- `.planning/workstreams/versioned-history-query-foundation/STATE.md` 已完成：
  - typed `version_query`
  - registry resolution
  - retrieval version filter
  - answer semantics / eval

直接含义：

- Phase 1 应复用现有 `version_query` truth
- 不应重新创造第二套历史版本 mode vocabulary
- `historical / as_of / compare` 更像 plan mode / branch precondition，而不是新的 top-level capability

### Structured runtime tools are explicitly outside generic retrieval planning

- `docs/architecture/system/execution-and-agents-architecture.md` 与
  `docs/architecture/system/agentic-retrieval-architecture.md` 都已固定：
  - `service_status_lookup`
  - `transport_schedule_lookup`
  - `campus_notice_discover`
  - `campus_notice_get`
  不属于 agentic retrieval 本身

直接含义：

- allowed step taxonomy 必须显式排除 structured runtime query
- `live_source_lookup` 也只能命中 repo-admitted live source channel，不等于 tool router

## Official Source Findings

### Azure AI Search: agentic retrieval is a planner plus a structured three-part retrieval response

Official sources:

- https://learn.microsoft.com/en-us/azure/search/agentic-retrieval-overview
- https://learn.microsoft.com/en-us/azure/search/agentic-retrieval-how-to-retrieve
- https://learn.microsoft.com/en-us/azure/search/agentic-retrieval-how-to-answer-synthesis

Observed pattern:

- agentic retrieval is explicitly modeled as a multi-query pipeline
- subqueries run in parallel
- retrieval returns three distinct layers:
  - grounding content
  - source/reference data
  - execution/activity details
- answer synthesis is optional; raw grounding extraction remains a first-class mode
- query-planning model and answer-generation model can be different

Direct implication for this repo:

- `RetrievalPlan` should not be reduced to “rewrite strategy”
- `StepResult` should keep at least three layers:
  - grounding payload for synthesis
  - reference payload for traceability / citations
  - activity payload for operator/debug
- `retrieval-core` should stay usable without mandatory answer synthesis
- plan/executor contract should keep answer generation outside the retrieval kernel

### OpenAI: tool calling works best with small typed tool sets, JSON schema, and explicit tool restrictions

Official sources:

- https://platform.openai.com/docs/guides/function-calling/how-do-i-ensure-the-model-calls-the-correct-function
- https://platform.openai.com/docs/guides/function-calling/prompt-chaining
- https://platform.openai.com/docs/guides/tools/file-search

Observed pattern:

- tool calling is a multi-step loop:
  - model emits tool call
  - application executes it
  - tool output returns to model
- official guidance recommends:
  - obvious tool shapes
  - enums / object structure
  - small tool counts
  - offloading known arguments into application code
  - restricting available tools with `tool_choice` / `allowed_tools`
- file search keeps metadata filtering and result-count controls explicit

Direct implication for this repo:

- allowed retrieval step types should be a closed enum, not free-form text
- live-assisted retrieval should expose only an explicitly admitted subset of live tools/branches
- planner should not be asked to synthesize arguments the application already knows:
  - scope
  - authz filter
  - version filter
  - runtime-profile gate
- retrieval plan should encode budget and filter intent explicitly before executor mapping

### Anthropic: citations are more reliable when they are structured, not prompt-only

Official sources:

- https://docs.anthropic.com/en/docs/build-with-claude/citations
- https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/overview

Observed pattern:

- Anthropic explicitly states structured citations are more reliable than prompt-only citation patterns
- citation granularity is determined by document/chunking shape
- tool use is also modeled as:
  - typed tool definitions
  - model requests tool use
  - application executes and returns results

Direct implication for this repo:

- source cards / canonical reader jump should continue to be code-owned structured references, not prompt-composed free text
- supporting evidence should point to stable canonical units, not raw retrieval trace IDs
- if live-assisted retrieval is introduced, app-side execution remains mandatory; it should not become hidden prompt browse behavior

### MCP: tools and resources should stay distinct

Official sources:

- https://modelcontextprotocol.io/introduction
- https://modelcontextprotocol.io/docs/learn/server-concepts

Observed pattern:

- MCP separates:
  - tools: model-controlled actions with typed schemas
  - resources: application-controlled read-only context
  - prompts: reusable instruction templates
- tool execution commonly pairs with approval flows and activity logs

Direct implication for this repo:

- not every retrieval-side external lookup should become a model-driven tool
- read-only live reference access may fit better as application-owned resource acquisition behind the retrieval executor
- activity logging for plan/step execution should be designed from day one, not bolted on later

## Architecture Pattern Recommendation

### Recommended placement of `RetrievalPlan`

Recommendation:

- `Phase 1` should keep `RetrievalPlan / RetrievalStep / StepResult` out of `packages/contracts`
- first placement should be the `rag-agent <-> retrieval-core` boundary

Why:

- repo guardrails already forbid retrieval / infra types leaking into shared supervisor-facing contracts
- current consumer of the plan is internal:
  - `rag-agent`
  - `retrieval-core`
- freezing this seam internally first preserves the ability to refine it in `Phase 2-4` without polluting browser-facing or supervisor-facing contracts

Confidence:

- high

### Recommended initial step taxonomy

Recommendation:

- initial allowed step types should be:
  - `indexed_lookup`
  - `entity_resolution`
  - `historical_version_lookup`
  - `compare_pair_lookup`
  - `freshness_gate`
  - `live_source_lookup`

Explicit exclusions:

- `service_status_lookup`
- `transport_schedule_lookup`
- `campus_notice_discover`
- `campus_notice_get`
- general web search
- unadmitted remote capability

Confidence:

- medium-high

### Recommended result layering

Recommendation:

- `StepResult` should carry separate typed fields for:
  - candidate/grounding content
  - reference metadata
  - execution activity
  - terminal failure / blocked state

Why:

- Azure’s three-part retrieval response aligns with repo needs for:
  - grounded synthesis
  - canonical source-card / reader linking
  - operator observability
- it avoids mixing raw debug traces into user-facing answer truth

Confidence:

- high

### Recommended live-assisted posture

Recommendation:

- `live_source_lookup` should be repo-owned and gate-controlled
- it should execute through application-owned adapters or MCP-style typed capability, not direct general-web browse

Why:

- matches repo’s bounded campus scope
- preserves source-trust / authz / runtime-profile gates
- matches official tool/resource patterns better than hidden prompt browsing

Confidence:

- high

## Don’t Hand-Roll

- Do not hand-roll prompt-only plan serialization without a typed artifact.
- Do not treat `RetrievalRequest` as if it were already a `RetrievalStep`.
- Do not let the planner silently widen serving scope when recall is weak.
- Do not mix structured runtime tool families back into generic retrieval taxonomy.
- Do not make citations depend on prompt-generated quote text alone.

## Common Pitfalls

- A “smart” planner with no explicit budget will silently turn into an unbounded latency/cost sink.
- If step types are too generic, they become a disguised tool router and collapse domain boundaries.
- If result layers are not separated early, raw execution/debug payloads leak into answer/citation logic.
- If `live_assisted` is modeled as hidden browsing, source-trust and fail-close semantics will rot immediately.
- If the plan enters shared contracts too early, retrieval-internal volatility leaks upward and blocks iteration.

## Phase 1 Design Questions

需要在本 phase 冻结的关键问题：

1. `RetrievalPlan` 是否进入 shared contract，还是先保持在 specialist/retrieval boundary 内？
2. `RetrievalStep` 的最小字段集是什么，哪些字段必须 code-owned，哪些只能由 executor 派生？
3. `VersionQuery`、freshness mode 与 source-trust 要如何进入 plan，而不和 capability/scope 混层？
4. bounded replan 应如何表达，才能避免 silent scope expansion？
5. candidate set、supporting evidence 与 operator-facing query activity 各自处在哪一层？

## Working Conclusion

Phase 1 不应尝试直接实现 multi-step retrieval。

Phase 1 应先把以下 truth 冻结下来：

- plan/step/result vocabulary
- step taxonomy
- budget/fail-close semantics
- planner/executor ownership boundary
- 与 version/freshness/live/source-trust 的接口面

只有这些 truth 先稳定，Phase 2 才值得进入真实 planner/executor 实现。

## Recommended Immediate Next Move

最合理的下一步不是写 executor，而是先补一轮 contract/design docs，至少明确：

- `RetrievalPlan` placement
- `RetrievalStep` schema
- initial step taxonomy
- result layering
- bounded replan contract
- `live_source_lookup` admission rule
