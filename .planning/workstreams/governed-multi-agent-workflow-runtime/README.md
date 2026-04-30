---
doc_type: index
status: deferred
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Workstream: Governed Multi-Agent Workflow Runtime

这是 `governed-multi-agent-workflow-runtime` 的 native workstream 入口。

本 workstream 负责把当前 repo 的 supervisor-led architecture 从“single handoff /
direct structured runtime 为主”推进到受控 multi-agent workflow。它不把 Go
`supervisor-api` 改成 LLM triage agent，也不把 provider function calling 提升为顶层
orchestration owner；目标是让 Go 继续拥有 deterministic governance，让 Python /
domain-agent 在明确边界内执行 bounded semantic collaboration。

## Current Status

- status: `deferred`
- current phase: `Phase 0 planning complete`
- active implementation: no
- current slice: waiting for tool / agent single-step readiness

## Why This Exists

当前 target architecture 已固定为 supervisor-led governed multi-agent architecture。
但底层多个 tool / agent 的单点 readiness、typed output projection、workflow trace
denominator 与 product-path evidence 仍需要先各自成立。

因此本 workstream 先只冻结目标形态、phase 顺序、依赖矩阵与恢复条件；在
`transport_schedule_lookup`、`campus_notice_get/discover`、`navigation-agent`
place/stop context 与 `rag-agent` bounded context grounding 通过对应 release/eval gate
之前，不进入 runtime 实现。

## Target Shape

长期目标固定为：

```text
app-api
-> Go supervisor-api deterministic admission
-> WorkflowPlan
-> bounded domain-agent steps
-> StepOutputProjection / typed artifact exchange
-> Go supervisor finalization
-> app-api / product surface
```

默认协作模式是 manager-style multi-agent：

- Go `supervisor-api` 保持 workflow plan、allowed agents、allowed tools、budget、
  timeout、fail-close 与 finalization ownership。
- domain agents 作为 bounded specialist 被调用，返回 typed projection。
- explicit specialist handoff 只在 specialist 需要接管下一轮回复 ownership 时使用。
- provider-native function calling 只能作为 domain-agent 内部 adapter，不拥有跨 family
  tool selection 或 permission expansion。

## First Pilot Candidate

首个 implementation pilot 只在恢复条件满足后启动，候选场景固定为：

```text
transport / schedule question
-> campus-services-agent: ScheduleBaseline
-> notice-agent: NoticeChangeSet / CanonicalNoticeContext
-> navigation-agent: PlaceContext / StopContext
-> rag-agent or grounding validator: EvidenceBundle / GroundingVerdict
-> Go supervisor finalization
```

该 pilot 的价值是验证稳定班次基底、近期通知 override、上车地点上下文与证据校验能否通过
typed projections 协作，而不是把所有问题继续压进单个 RAG prompt。

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`
- phase plans: `./phases/*/PLAN.md`

## Boundary Notes

- 不在本 workstream 内补底层 tool 的数据面、OCR、read model、projection builder 或
  query service readiness。
- 不把 `rag-agent` 恢复成所有 campus capability 的 hidden fallback。
- 不让 agent 之间传 raw provider trace、raw source HTML、raw OCR dump、raw SQL result
  或 unbounded evidence snippets。
- 不把 multi-agent trace 写成 current truth；实现前 `current-architecture.md` 不更新。
- 不打开 state-changing tool；后续如涉及代办、预约、提交、支付或工单，必须另开
  approval / HITL / audit / rollback / eval workstream。
