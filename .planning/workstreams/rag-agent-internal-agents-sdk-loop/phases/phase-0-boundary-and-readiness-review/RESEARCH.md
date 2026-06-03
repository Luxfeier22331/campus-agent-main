---
doc_type: research
status: ready_for_planning
created: 2026-05-05
updated: 2026-05-05
---

<!-- markdownlint-disable MD013 -->

# Phase 0 Research: Boundary And Readiness Review

## Research Question

What must be true before planning implementation of an official OpenAI Agents SDK loop inside
`rag-agent`?

## Official SDK Facts To Verify During Phase 0

Phase 0 must verify these against the installed SDK version and official documentation before code
implementation depends on them:

- `Agent` construction supports instructions, model configuration, tools and structured output for
  the RAG use case.
- `Runner` behavior used by the repo can be deterministic enough for unit tests through injected or
  mock runners.
- `FunctionTool` can be constructed from repo-owned strict JSON schema and calls only repo-owned
  execution functions.
- Tool-call controls can enforce or test single/serial tool-call behavior, max turns and no parallel
  tool calls.
- Structured output failure behavior can be converted to repo-owned fail-closed response states.
- SDK-native tracing can remain disabled by default; sanitized projection can be derived from
  repo-owned run/tool records instead.

Official references:

- OpenAI Agents SDK agents: `https://openai.github.io/openai-agents-python/agents/`
- OpenAI Agents SDK tools: `https://openai.github.io/openai-agents-python/tools/`
- OpenAI Agents SDK guardrails: `https://openai.github.io/openai-agents-python/guardrails/`
- OpenAI Agents SDK tracing: `https://openai.github.io/openai-agents-python/tracing/`

## Repo Pattern Facts

The completed SDK adapter promotion workstream already established the safe repo pattern:

```text
AgentSpec / ToolSpec / Go handoff
-> Python adapter
-> official SDK runner
-> repo-owned tool executor
-> repo-owned AgentResponse
-> Go finalization
```

RAG-internal SDK loop differs in one important way:

- It should not derive public ToolSpec tools.
- It should not place `retrieval.query` in `allowed_structured_handoff_tools`.
- It should wrap internal retrieval execution after deterministic scope/version/preflight.

## Required Hardening Before Implementation

### Claim / Span Grounding

Source-id citation alone is insufficient. An accepted SDK answer must map claims or list items to
returned evidence anchors:

- `source_id`
- bounded excerpt or span reference
- optional document/chunk/source ref already safe for diagnostics
- claim/list-item mapping

The existing grounding validation path must be audited before deciding whether to reuse it directly
or add an SDK-specific projection validator.

### Bounded Replan

SDK should not freely rewrite retrieval queries. Default behavior should select from deterministic
planner query slots. If semantic replan is admitted:

- max replan count is fixed,
- reason is mandatory,
- no widening of corpus, collection, authorization, target docs, target versions, revision track or
  serving surface is allowed,
- sanitized observation records the attempt and outcome.

### Trace Safety

Native SDK tracing is useful for development, but this repo must not serialize raw prompts,
transcripts, raw evidence or source bodies into shared contracts, panel responses, workflow trace or
eval canonical assets. The default posture is native tracing off, repo-owned sanitized projection
on.

### Runtime Mode

This early research originally considered multiple rollout modes:

- `candidate`: code exists but only direct tests use it.
- `shadow`: SDK output is computed for diagnostics but not user-visible.
- `default_on`: SDK is the primary RAG synthesis path.
- `fallback_only`: rejected historical option where SDK would be selected after primary path failure.
- `closed`: SDK path is unavailable.

That posture has been superseded by the SDK-native hardcut: product serving may use only a single
admitted path or stay closed. Shadow, candidate, fallback-only and dual-primary modes are retained
here only as historical research terms, not implementation permission.

## Phase 0 Research Output

This research supports a Phase 0 audit plan. It is not implementation evidence. The phase must still
inspect the current codebase and produce a readiness matrix in `SUMMARY.md`.
