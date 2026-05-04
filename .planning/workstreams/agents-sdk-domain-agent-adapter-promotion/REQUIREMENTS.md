---
doc_type: requirements
status: active
created: 2026-05-04
updated: 2026-05-04
---

<!-- markdownlint-disable MD013 -->

# Requirements: Agents SDK Domain-Agent Adapter Promotion

## Goal

Promote OpenAI Agents SDK from a disconnected default-off pilot lane to a selected, governed
domain-agent adapter substrate, without changing repo orchestration ownership.

## In Scope

- Retire or rewrite stale `campus_notice_get` SDK pilot assumptions.
- Select still-valid read-only agent-facing ToolSpec targets for promotion.
- Connect the real OpenAI Agents SDK runner behind explicit AgentSpec / ToolSpec admission.
- Preserve Go-owned allowed agents, allowed tools, workflow plan, fail-close and finalization.
- Map SDK results into repo-owned `AgentResponse`, `StepOutputProjection` and sanitized
  observability summaries only.
- Add parity evals, trace redaction gates, latency/cost smoke and rollback policy.
- Decide per target/tool whether selected SDK lanes become default-on, stay explicitly gated, or
  are rejected after evidence.

## Out Of Scope

- Replacing Go `supervisor-api` with an SDK triage/supervisor agent.
- Letting SDK-native handoffs decide repo canonical workflow routing.
- Exposing hosted web search, hosted MCP, code interpreter, shell/filesystem, raw SQL, object-store
  bytes, collector runtime or ingestion/index build as query-time tools.
- Opening state-changing tools.
- Moving RAG agentic retrieval internals before `agentic-rag-runtime-rearchitecture` stabilizes.
- Promoting all domain agents to SDK by default.
- Introducing SDK types into `packages/contracts`.

## Success Criteria

- `campus_notice_get` is no longer the promotion target and no stale SDK gate implies it is
  product-admitted.
- A selected active AgentSpec target can build a real SDK-backed runner only after:
  - SDK runtime gate is enabled
  - target is active/open in AgentSpec
  - every tool is allowed by Go handoff and ToolSpec
  - tool is read-only, structured handoff, strict-schema and active
- SDK output is converted to repo-owned `AgentResponse` only.
- Raw SDK `RunResult`, SDK-native trace, provider response, prompt, source body and tool raw result
  never enter shared contracts, panel, workflow trace summary or eval canonical assets.
- Parity eval catches wrong tool, no-call, bad arguments, query-service failure, result misuse and
  raw trace leakage.
- Latency/cost/error budget evidence exists before any default-on promotion.
- At least one env-gated real SDK smoke exists before a default-on decision; local unit tests may
  keep using fake providers.
- Rollback is an env/config-only operation for selected SDK lanes.

## Non-Goals

- Make every request multi-agent.
- Make SDK handoffs the repo canonical handoff mechanism.
- Replace deterministic direct runtime for projection-backed service/status/schedule answers.
- Reopen `agents-sdk-domain-agent-adapter-pilot` except as historical context.
