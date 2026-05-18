---
doc_type: index
status: completed
created: 2026-05-07
updated: 2026-05-07
---

# Workstream: Academic Calendar Lookup Capability Closeout

这条 workstream 负责把 `academic_calendar_lookup` 从“已挂到
`campus-services-agent` 的薄结构化 tool”补齐为可开放的校历事实查询能力。

上一条 `academic-calendar-campus-services-consolidation` 只解决 runtime
ownership：`calendar-agent` 退役，tool 归入 `campus-services-agent`。本
workstream 不重复该工作，只补 capability correctness。

## Scope

本 workstream 覆盖：

- `academic_calendar_lookup` 的问题边界、contract、query resolver 与回答口径
- `calendar/academic_calendar` projection / typed read model 的事件表达能力
- 教学周、学期窗口、假期区间、停课、补课、调休上课与执行课表查询
- planner / intent routing 对 calendar fact、notice 文档检索、service guide 的区分
- deterministic eval、public/chat E2E 与 projection doctor

本 workstream 不覆盖：

- 恢复独立 `calendar-agent`
- 把 `calendar/academic_calendar` 改名为 campus-services collection
- 查询时回扫 raw 官网页面、图片、notice HTML 或 generic RAG
- 个人课表、具体考试安排、预约、申请、提交等事务能力
- `校历在哪里看` 这类入口说明；它仍属于 `service_guide_lookup`

## Current Status

- status: `completed`
- completed phase: `Phase 8`
- runtime owner: `campus-services-agent`
- tool: `academic_calendar_lookup`
- data-plane owner: `calendar/academic_calendar`
- current posture: implementation closeout complete；runtime ownership、
  contract、projection schema、resolver、planner routing、eval denominator 与
  docs 已收口；后续 `academic-calendar-source-truth-reconciliation` 已把
  notice-derived calendar arrangement、`2026-05-09` 冲突收敛与 `春假`
  colloquial alias 语义并入当前真相
- current blocker: 无核心能力 blocker；旧 closeout 文档里关于
  `春假 -> source-backed not_found` 的判断已被后续 reconciliation 覆盖

## Native Planning Truth

- current design audit: `./CURRENT-DESIGN.md`
- planning review: `./PLANNING-REVIEW.md`
- completion audit: `./GAP-LEDGER.md`
- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`
- current source-truth follow-up:
  `../academic-calendar-source-truth-reconciliation/README.md`

Historical phase-planning files in this directory capture the capability
closeout baseline. Spring-break and notice-derived calendar-arrangement
semantics are superseded by
`academic-calendar-source-truth-reconciliation`.

## External Basis

- OpenAI Function Calling / strict tool schemas:
  <https://developers.openai.com/api/docs/guides/function-calling>
- OpenAI Structured Outputs / tool schema adherence:
  <https://developers.openai.com/api/docs/guides/structured-outputs>
- OpenAI Agent evals / traces and datasets:
  <https://developers.openai.com/api/docs/guides/agent-evals>
- RFC 5545 calendar event interval convention:
  <https://www.rfc-editor.org/rfc/rfc5545>

## Completion Target

完成后必须能稳定回答：

- `2026-05-07 是第几教学周`
- `今天第几教学周`
- `今年春假是什么时候`：返回 source-backed 校内连续不上课时间，并在回答里自然映射到这段安排
- `2026-04-25 执行哪天课表`
- `2026-05-01 上课吗`
- `本学期什么时候结束`

并且必须证明：

- `找春假通知原文` 不走 calendar tool
- `校历在哪里看` 不走 calendar tool
- resolved result 必须有 source refs
- public/chat E2E denominator 已覆盖 date-week 与 named-event positive cases
