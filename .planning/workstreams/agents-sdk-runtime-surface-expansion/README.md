---
doc_type: index
status: completed
created: 2026-05-06
updated: 2026-05-06
---

<!-- markdownlint-disable MD013 -->

# Workstream: Agents SDK Runtime Surface Expansion

这是 `agents-sdk-runtime-surface-expansion` 的 native workstream 入口。

它负责把已完成的两条 SDK 线继续扩成可治理、可验证、可逐面开放的 runtime substrate：

- `agents-sdk-domain-agent-adapter-promotion`
- `rag-agent-internal-agents-sdk-loop`

这条线不把 OpenAI Agents SDK 提升为 repo-wide orchestration owner，也不改写 Go
`supervisor-api` 的 ToolSpec / AgentSpec / `WorkflowPlan` / finalizer ownership。

## Current Status

- status: `completed`
- completed phase: `Phase 7`
- completion posture: Phase 0-6 completed admitted SDK surface expansion; the only formerly
  attached future item, governed workflow step-internal SDK execution, has been removed from this
  workstream and returned to `governed-multi-agent-workflow-runtime`
- current slice: none
- completed scope: admitted SDK surfaces now have per-tool instruction
  profiles, trace-safe execution semantics, real-provider public/chat product-path acceptance,
  bounded campus-services structured result passthrough, and an ingestion-side offline notice
  multimodal SDK adapter behind the existing normalized DTO seam
- completed this turn:
  - new active workstream planning truth
  - runner-shell instruction profile propagation
  - safe observability projection for instruction profile id
  - focused SDK runner tests for notice discover and campus services guide profiles
  - per-tool campus-services instruction profiles for service guide / status / transport /
    contact
  - trace-safe observability for `result_usage_mode` and `surface_execution_mode`
  - delegate-path parity assertions for notice / campus-services / calendar admitted surfaces
  - local real-provider public/chat acceptance through
    `public-chat-web -> app-api -> supervisor-api -> supervisor-agent-worker -> rag-agent SDK`
  - local smoke wrapper teardown no longer emits spurious `pnpm ELIFECYCLE` noise after success
  - SDK shell now returns bounded structured `result.payload_kind + tool_result` for admitted
    campus-services surfaces when repo-owned tool execution occurs
  - campus-services service-guide / contact SDK tool results now retain minimal source-backed
    nested fact groups needed by downstream structured answer synthesis
  - focused SDK runner / delegate tests now assert service-guide and contact structured result
    passthrough instead of only `source_ref_count`
  - internal notice multimodal processing now supports a repo-owned `agents_sdk` runtime behind
    the existing ingestion DTO seam without leaking SDK-native output into persisted projection
  - internal notice runtime smoke now validates multimodal runtime readiness generically instead of
    assuming chat-completions-only endpoint semantics
  - governed workflow step-internal SDK work has been removed from this workstream and returned to
    `governed-multi-agent-workflow-runtime`

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`

## Boundary Notes

- 本线只扩展 domain-agent / worker 内部 SDK runtime surface。
- Go `supervisor-api` 继续拥有 ToolSpec admission、opening gate、workflow plan、trace summary
  与 finalization。
- SDK-native trace、handoff graph、provider raw response、session memory 仍不得进入
  `packages/contracts`、panel、eval canonical fixture 或 public response。
- 不开放 hosted web search、file search、code interpreter、remote MCP、shell、filesystem、
  raw SQL、object-store read、collector/ingestion write 或 index build query-time tool。
- `retrieval.query` 继续保持 `agent_internal` / closed。

## Related Workstreams

- `agents-sdk-domain-agent-adapter-promotion`
  - 已完成 SDK adapter default-on promotion 和 selected read-only tool admission
- `rag-agent-internal-agents-sdk-loop`
  - 已完成 RAG 内部 SDK semantic loop
- `governed-multi-agent-workflow-runtime`
  - 后续若恢复，承接 step-internal SDK runtime；SDK 只允许运行在 admitted workflow step
    内部，不替代 Go workflow truth
