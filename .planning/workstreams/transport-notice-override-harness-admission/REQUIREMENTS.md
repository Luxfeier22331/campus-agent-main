---
doc_type: requirements
status: backlog
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 MD060 -->

# Requirements: Transport Notice Override Harness Admission

## Goal

把下面这条扩展目标，从 planning-only 变成可治理、可验证、可 fail-close 的
supervisor-level artifact workflow：

```text
transport schedule baseline
-> notice change set
-> grounding verdict / evidence bundle
-> supervisor finalization
```

它解决的问题是：用户问“今天/近期班车怎么坐、某条通知是否改变当前班车安排、基线时刻和
近期通知冲突时该信谁”时，系统不能靠 planner 特判、query-time raw notice scan 或 RAG
猜测拼答案；必须先读稳定班车基线，再读已消费并 admission 的 notice change set，最后由
supervisor finalizer 用可审计 artifact 生成答复。

## Required Deliverables

- repo-owned `notice_change_set` artifact producer contract
- artifact registry / capability graph 对 transport override path 的显式
  producer/consumer truth
- `CapabilityPlan -> resolver -> WorkflowPlan` admission 规则，且不新增 planner 场景特判
- data-plane admission gate：官方 baseline、notice routing classification、effective window、
  evidence completeness、title/source URL、searchable-only exclusion
- shared execution contract promotion：projection kind enum、Go `StepOutputProjection`
  constructor/validator、OpenAPI/generated Go/Python/TS contract、bridge parser compatibility
- workflow context projection：第二步/后续步骤只消费 projection refs 和 safety summaries，
  不传 raw notice body、OCR dump、HTML、SQL rows、object locator 或 provider trace
- finalizer usage rule：最终答复必须记录使用了哪些 `schedule_baseline`、
  `notice_change_set`、`evidence_bundle` / `grounding_verdict` artifacts
- baseline-only / override / conflict / stale / missing-evidence / clarification-no-answer
  eval denominator
- public product opening 之前的 focused smoke / acceptance evidence

## Success Criteria

- `notice_change_set` 不再是 `planned_contract_gap`；它有 producer binding、projection kind
  contract、runtime loader/drift tests 和 artifact trace coverage。
- transport composite workflow 由 artifact resolver admission，不由 planner keyword branch
  拼 fixed workflow。
- 缺 baseline、缺 notice change set、notice 过期、notice 只有 searchable-only、证据不完整、
  多 notice 冲突或 route/direction 不明确时，workflow typed fail-close 或 clarification。
- 对可回答问题，final response 至少能区分：
  - 稳定基线是什么
  - 近期通知改变了什么
  - 生效窗口是什么
  - 依据的通知标题与 source URL 是什么
- eval trace 能证明最终答案使用了 `schedule_baseline` 和 `notice_change_set`，并在需要
  grounding 时使用 `evidence_bundle` / `grounding_verdict`。

## Scope Boundaries

### In Scope

- transport schedule baseline + authenticated notice override 的 composite question。
- 通勤班车、地铁接驳车、临时运营调整、停运/恢复、乘车点/方向/窗口变化。
- 只读查询、source-backed answer、title/source URL card exposure。
- repo-owned artifact、contract、eval、trace、smoke planning and implementation path。

### Out Of Scope

- 低优先级 notice 的深度处理；它们最多进入 title/source URL 搜索卡。
- 没有完整正文/附件/OCR/多模态解析证据的 notice query-time promotion。
- public/chat opening；本 workstream 只能产出 opening prerequisite evidence。

## Non-Goals

- 不把 transport override 逻辑塞回 `agent-harness-capability-graph-runtime`
- 不通过 generic RAG 或 raw notice scan 替代 `notice_change_set` producer truth
- 不绕过 `transport_schedule_lookup` 的 current baseline contract
- 不直接打开 public product path
- 不新增 state-changing tool、预约/购票/派车执行能力、导航路线规划能力或供应商/车辆调度系统
- 不让 `campus-services-agent` 或 `notice-agent` 在 query time 自行扩大 source scope
- 不把 `manual_review_required` / `review_later` 作为 forward runtime 状态；不能自动
  admission 的 notice 必须保持 searchable-only、offline model-reviewed 后再进入 change set，
  或在运行时 fail closed
