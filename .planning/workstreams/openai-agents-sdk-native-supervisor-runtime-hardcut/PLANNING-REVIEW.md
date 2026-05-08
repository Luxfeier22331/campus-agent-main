---
doc_type: review
status: active
created: 2026-05-08
updated: 2026-05-08
---

<!-- markdownlint-disable MD013 -->

# Planning Review: OpenAI Agents SDK Native Supervisor Runtime Hardcut

## Review Verdict

Planning is viable after correction.

The workstream should proceed as a hard-cut runtime convergence line, not as another SDK pilot or
rollout lane. The corrected boundary is:

- SDK owns Python provider-facing semantic runtime: model turns, function tool loop, output typing,
  guardrails, SDK run lifecycle and internal handoff substrate.
- Go keeps deterministic supervisor ownership: admission, WorkflowPlan, ToolSpec, allowed tools,
  budgets, source-trust, runtime policy and finalization.
- RAG deterministic retrieval planning, retrieval execution and evidence selection remain
  repo-owned; SDK hardcut applies to answer drafting / synthesis and internal tool-loop substrate.

## Findings And Fixes

High severity: Phase 1 originally asked for guard tests that would fail on known current residue
before implementation removed it. That would leave a permanently red repo if interpreted literally.

Fix: Phase 1 now creates `CURRENT-DEBT-INVENTORY.md`, `SDK-PRIMITIVE-MAPPING.md` and guard
acceptance criteria. Executable guard tests move to implementation/deletion phases.

High severity: RAG hardcut language could be misread as SDK owning retrieval planning, retrieval
execution or evidence selection.

Fix: README, REQUIREMENTS, ROADMAP and STATE now clarify that SDK owns provider-facing answer
drafting / synthesis and tool-loop substrate, while deterministic retrieval/evidence stages remain
repo-owned.

Medium severity: The relation to completed SDK workstreams was underspecified and could look like
reopening completed lines.

Fix: README now states this workstream builds on completed SDK lines without reopening them, and
closes remaining worker/package runtime residue.

Medium severity: Official SDK basis did not distinguish OpenAI's general flexibility from this
repo's hard-cut decision.

Fix: README and REQUIREMENTS now state that official docs allow mixed SDK / Responses usage, while
this repo deliberately hard-cuts Python semantic runtime due to accumulated custom-loop debt.

Low severity: STATE did not record verification evidence after the first planning write.

Fix: STATE now records markdownlint and diff whitespace verification commands and observed results.

Medium severity: Phase 2 native runtime exposed `runner_captures`, a test-only capture field, on the
production runtime instance.

Fix: test capture now lives in the test closure only. `OpenAIAgentsNativeRuntime` no longer exposes
test helper state or inspects runner-specific test attributes.

Medium severity: Phase 2 native runtime only returned locally recorded tool invocations. If a runner
returns explicit SDK-style tool call metadata, the factory dropped it.

Fix: `OpenAIAgentsNativeRuntime` now preserves explicit runner `tool_calls` when present and falls
back to local function invocation records only when the runner result does not expose tool calls.

## Official SDK Alignment Notes

Official docs establish the primitives this plan relies on:

- Agents SDK has a small primitive set: agents, agents-as-tools / handoffs and guardrails.
- The SDK includes a built-in agent loop for tool invocation, result return and continued turns.
- Function tools wrap Python functions and can use explicit JSON schema through `FunctionTool`.
- Multi-agent patterns split into manager-style agents-as-tools and handoffs.
- Tracing records LLM generation, tool calls, handoffs and guardrails; this repo must export only
  sanitized projections.

References:

- <https://openai.github.io/openai-agents-python/>
- <https://openai.github.io/openai-agents-python/agents/>
- <https://openai.github.io/openai-agents-python/tools/>
- <https://openai.github.io/openai-agents-python/handoffs/>
- <https://openai.github.io/openai-agents-python/tracing/>

## Non-Negotiable Corrections For Implementation

- Do not implement a new compatibility flag for old RAG synthesis.
- Do not add a shadow/candidate/fallback rollout mode.
- Do not move retrieval source-trust or serving-surface policy into SDK prompts.
- Do not let SDK choose cross-agent route order unless Go WorkflowPlan already admitted it.
- Do not leak raw SDK/provider/tool payloads into contracts, eval canonical fixtures, panel or
  public response.

## Phase 1 Required Artifacts

Phase 1 is not complete until these files exist and are verified:

- `CURRENT-DEBT-INVENTORY.md`
- `SDK-PRIMITIVE-MAPPING.md`

They must name exact code owners for:

- custom SDK runner shell
- RAG rollout modes
- mock runner / fake runtime
- provider loop residue
- direct adapter residue
- schema duplication
- trace projection / leakage risks
