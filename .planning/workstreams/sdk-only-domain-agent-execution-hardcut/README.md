---
doc_type: index
status: completed
created: 2026-05-07
updated: 2026-05-08
---

<!-- markdownlint-disable MD013 -->

# Workstream: SDK-only Domain-Agent Execution Hardcut

这是 `sdk-only-domain-agent-execution-hardcut` 的 native workstream 入口。

本 workstream 负责把当前 `sdk_adapter_admitted` structured domain-agent execution 从
“SDK path 与 direct adapter path 双轨并存”收口为 SDK-only provider-facing agent/tool loop。
它的核心结论是：对已经标记为 `sdk_adapter_admitted` 的 ToolSpec，SDK 是必需 runtime seam，
不是 preferred path；缺少 SDK runner、provider、model、API key、ToolSpec admission 或 Go
`allowed_tools` 时必须 fail closed，不能回退到 direct adapter。

## Current Status

- status: `completed`
- current phase: `complete`
- current slice: SDK-only structured domain-agent runtime hard cut completed; direct/provider-loop
  residue removed and closeout truth aligned
- owner boundary: `apps/supervisor-agent-worker` + `packages/campus-services-agent` +
  `packages/notice-agent` + `packages/contracts` + `configs/runtime/tools.v1.json` +
  supervisor/eval tests

## Latest Review

Phase 1-8 execution is complete: worker delegates fail closed instead of falling back, direct
online adapter modules are deleted, package-owned SDK executors own structured domain execution,
retired provider-loop/pilot governance residue is removed from active runtime/tests/evals, and
planning/architecture truth now matches the SDK-only runtime.

## Target Shape

最终执行链固定为：

```text
Go supervisor-api
-> AgentRequest / allowed_tools
-> Python supervisor-agent-worker SDK shell
-> repo-owned SDK tool executor
-> internal query service
-> bounded tool result
-> SDK final output
-> Go finalization
```

Repo-owned 边界保持不变：

- Go `supervisor-api` 继续拥有 AgentSpec / ToolSpec / allowed-tools admission、workflow
  planning、fail-close terminal envelope 和 finalization。
- `packages/contracts` 继续拥有 handoff DTO 与 function schema metadata，不引入 SDK native type。
- domain packages 继续拥有 query service / HTTP query client / bounded result projection。
- OpenAI Agents SDK 只作为 provider-facing agent/tool loop shell。

## Explicit Hard-Cut Rules

- 不保留 direct adapter fallback。
- 不保留“SDK preferred, direct fallback”的 worker routing。
- 不保留同一 structured tool 的 direct online execution API。
- 不新增 compatibility lane、shadow lane 或迁移开关来维持旧路径。
- `SUPERVISOR_AGENTS_SDK_RUNTIME_ENABLED=false` 对 SDK-admitted tools 的含义是 fail closed，
  不是使用 direct adapter 继续完成请求。
- Phase 1 不删除 agent-internal helper，例如 `campus_notice_get`；这类路径不是
  `sdk_adapter_admitted` structured handoff，删除/重命名由 Phase 2/3 在 package executor
  边界冻结后处理。

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`
- summary: `./SUMMARY.md`

## Relation To Existing Workstreams

- Builds on completed `agents-sdk-domain-agent-adapter-promotion`.
- Builds on completed `execution-tool-calling-governance`.
- Builds on completed `supervisor-multi-agent-runtime-contract-hardening`.
- Does not reopen SDK as repo-wide orchestration owner.
- Does not change RAG internal `retrieve_evidence` posture; that remains an agent-internal SDK
  loop, not a structured handoff ToolSpec exposed to supervisor.

## Reopen Rule

Reopen this workstream only if:

- a `sdk_adapter_admitted` structured tool regains direct adapter fallback or a second runtime
  substrate;
- repo-owned provider-loop / pilot runtime modules are reintroduced into worker, package or eval
  surfaces;
- package-owned SDK executors stop being the only production structured execution owner for admitted
  domain tools;
- ToolSpec / provider function schema single-source coverage drifts without guard failure; or
- a newly admitted structured tool bypasses the SDK-only handoff shape enforced here.
