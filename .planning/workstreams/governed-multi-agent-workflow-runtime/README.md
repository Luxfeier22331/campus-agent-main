---
doc_type: index
status: completed
created: 2026-05-01
updated: 2026-05-06
---

<!-- markdownlint-disable MD013 -->

# Workstream: Governed Multi-Agent Workflow Runtime

这是 `governed-multi-agent-workflow-runtime` 的 native workstream 入口。

本 workstream 负责把当前 repo 的 supervisor-led architecture 从“single step /
typed structured activity 为主”推进到受控 multi-agent workflow。它不把 Go
`supervisor-api` 改成 LLM triage agent，也不把 provider function calling 提升为顶层
orchestration owner；目标是让 Go 继续拥有 deterministic governance，让 Python /
domain-agent 在明确边界内执行 bounded semantic collaboration。

## Current Status

- status: `completed`
- current phase: `Phase 9 completed`
- active implementation: no
- current slice: first governed workflow pilot 已完成收口；multi-step `selected_tools`、
  step-level `tool_call_summaries` 与 bounded provenance 已落为 repo-owned workflow truth，
  真实 `multi-agent-live-smoke` replay 通过，第二场景保持关闭
- owned follow-up scope: 无。若后续要 admission 新 governed 场景，应新开 owner workstream，
  不能在本线尾部顺手扩张

## Why This Exists

当前 target architecture 已固定为 supervisor-led governed multi-agent architecture。
但底层多个 tool / agent 的单点 readiness、typed output projection、workflow trace
denominator 与 product-path evidence 仍需要先各自成立。

本 workstream 先冻结了目标形态、phase 顺序、依赖矩阵与恢复条件；在
`transport_schedule_lookup`、`campus_notice_discover`、selected notice card/context
projection 与 `rag-agent` bounded context grounding 通过对应 release/eval gate 后，
runtime implementation 已恢复。

2026-05-06 更新：`agents-sdk-runtime-surface-expansion` 已将 multi-step workflow 的
step-internal SDK runtime follow-up 交回本 workstream。这里的含义不是让 Agents SDK
拥有全局 workflow graph，而是恢复本线后，Python step runner 可以在每个 Go-admitted
step 内部使用 Agents SDK 作为 runtime substrate；`WorkflowPlan`、step order、allowed
agents/tools、projection contract、trace 与 finalization 仍由 repo-owned contract 持有。

同日补充：Phase 3 的 workflow-trace denominator 已通过 focused suites 与真实
`multi-agent-live-smoke` gate 收口。随后 Phase 6 已把 `rag-agent` 的 bounded
`EvidenceBundle` / `GroundingVerdict` 输出落成 Go-owned `StepOutputProjection` truth，并让
transport + notice + RAG pilot 的 trace / eval / smoke 全部跟随新 truth；gate 自身的 stale
artifact reuse bug 也已修复。当前 first pilot 的真实终态已明确为：
`needs_clarification` 仍是合法业务终态，且必须保留 bounded `evidence_bundle` /
`grounding_verdict` workflow projections，不能被 runtime 当作失败路径丢弃。

2026-05-06 closeout：Phase 8 已把 multi-step trace 的最终缺口补齐。当前 `WorkflowRun`
会持久化 step-level `tool_call_summaries`，Go finalizer 以 recorded run truth 生成
`selected_tools` 与 operator-safe summary，不再从 final step 反推；当 step 结果缺少直接
`source_refs` 时，runtime 允许回退到该 step 的 bounded output projection ids 作为 provenance。
Phase 9 也已明确：暂不 admission 第二个 governed 场景；`service_guide/status/contact +
navigation + rag` 组合另开后续 workstream 处理。

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
-> rag-agent: EvidenceBundle / GroundingVerdict
-> Go supervisor finalization
```

该 pilot 的价值是验证稳定班次基底、近期通知 override 与证据校验能否通过 typed
projections 协作，而不是把所有问题继续压进单个 RAG prompt。`navigation-agent`
place/stop context 已延后，不属于当前 first pilot。

`GroundingVerdict` 当前不是独立 hidden agent。首个 pilot 中它已作为 `rag-agent` 的 bounded
output 落成 workflow projection，并由 Go finalizer / eval gate 复核；若后续要拆成独立 grounding specialist，必须先有
repo-owned `AgentSpec`、projection contract、readiness row 与 eval denominator。

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- readiness matrix: `./READINESS-MATRIX.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`
- phase plans: `./phases/*/PLAN.md`

## Boundary Notes

- 不在本 workstream 内补底层 tool 的数据面、OCR、read model、projection builder 或
  query service readiness。
- 不把 `rag-agent` 恢复成所有 campus capability 的 hidden fallback。
- 不新增未登记的 hidden specialist agent；所有 stable specialist 都必须先进入 repo-owned
  `AgentSpec` 或同等 canonical artifact。
- 不把 `campus_notice_get` 重新提升为 top-level ToolSpec / provider / SDK tool；notice
  相关步骤只消费 selected notice card/context projection。
- 不让 agent 之间传 raw provider trace、raw source HTML、raw OCR dump、raw SQL result
  或 unbounded evidence snippets。
- 不让 Agents SDK 生成、改写或持久化全局 workflow plan；它只能作为 admitted step
  内部的 runtime substrate。
- 不把 multi-agent trace 写成 current truth；实现前 `current-architecture.md` 不更新。
- 不打开 state-changing tool；后续如涉及代办、预约、提交、支付或工单，必须另开
  approval / HITL / audit / rollback / eval workstream。
