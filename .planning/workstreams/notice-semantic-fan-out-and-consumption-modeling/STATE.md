---
workstream: notice-semantic-fan-out-and-consumption-modeling
created: 2026-04-21
updated: 2026-04-21
---

# Project State

## Current Position
**Status:** Active
**Current Phase:** 1
**Current Phase Name:** Notice Source And Role Taxonomy Freeze
**Current Plan:** N/A
**Total Phases:** 5
**Total Plans in Phase:** 0
**Progress:** 0/5 phases complete
**Last Activity:** 2026-04-21
**Last Activity Description:** Created the workstream and froze its initial scope around notice semantic fan-out, authority/completeness modeling, and future agent/surface handoff.

## Current Slice

- 新建独立 semantic-modeling lane，处理：
  - `source_notice`
  - `notice_attachment`
  - `derived consumption unit`
- 当前问题收口为：
  - 单条 notice 如何 fan-out 到多个单一主角色消费单元
  - notice body、attachment body、wrapper text 的 authority / precedence
  - `attachments_declared != attachments_captured` 时的 completeness / answerability
  - `notice-agent`、future `rag-agent`、`campus-services-agent` 的 handoff 规则
- exemplar notice 固定为：
  - `关于启动2026届推荐优秀应届本科毕业生免试攻读研究生工作的通知`
- 这条线不负责：
  - runtime tool 直接实现
  - `scoped_rules` query-serving reopen
  - auth-dependent capture / file_release recovery

## Blockers

- 当前 repo 尚无 notice semantic fan-out 的正式 schema 或 role taxonomy contract。
- 现有 runtime workstream 主要冻结的是 tool / routing / query service 边界，不负责 source notice 的多角色建模。
- 附件 authority 与 completeness contract 仍未落盘；当前样本已暴露 `附件已声明但未抓到` 的典型问题。

## Verification

- `gsd-sdk query workstream.create 'notice semantic fan-out and consumption modeling' --raw --cwd '/home/reptilian/code/campus-agent'`
- planning change only；本次未实现新的 runtime code、query service 或 ingestion worker
- `git diff --check -- .planning/WORKSTREAMS.md docs/plans/notice-semantic-fan-out-and-consumption-modeling.md .planning/workstreams/notice-semantic-fan-out-and-consumption-modeling/REQUIREMENTS.md .planning/workstreams/notice-semantic-fan-out-and-consumption-modeling/ROADMAP.md .planning/workstreams/notice-semantic-fan-out-and-consumption-modeling/STATE.md`

## Session Continuity

**Stopped At:** Workstream scaffold and planning truth are in place; next session should start `Phase 1: Notice Source And Role Taxonomy Freeze`
**Resume File:** docs/plans/notice-semantic-fan-out-and-consumption-modeling.md
