---
doc_type: phase_plan
phase: "J"
phase_name: "Conditional Moderation Lane"
status: planned
created: 2026-04-19
updated: 2026-04-19
---

# Phase J Plan

## Objective

仅在明确 trigger artifact 出现时，为 app-api 增加 moderation precheck / annotation lane，并保持它从属于 code-owned `policy / scope / grounding` runtime。

## Why This Phase Exists

当前 repo 已能识别 provider `content_filter`，也已有 semantic gate；但如果 future product scope 变成更 open-ended 的 public input，仍可能需要 app-owned moderation lane。  
这条 phase 现在不该抢跑，但 admission / contract / exit rule 必须先冻结。

## Admission Rule

Phase J 只有在以下任一条件满足时才能从 `pending` 升为 active：

1. repo-tracked 产品范围变更，明确把 public scope 扩到 open-ended / broader internet-like input；
2. repo-tracked incident artifact 证明 `Phase F-I` 已不足以控制某类 repeated abuse。

合法 trigger artifact 固定为：

- `.planning/quick/<date>-*/SUMMARY.md`
- `docs/plans/*.md`
- 或 workstream `STATE.md` `Conditional Trigger Registry` 中引用的 incident / product-scope 证据

激活时必须同步更新：

- phase `status`
- workstream `STATE.md` `Conditional Trigger Registry`
- workstream `STATE.md Current Slice`

## Decisions To Freeze

1. placement 固定在 `app-api` precheck，发生在 supervisor call 之前。
2. moderation contract 固定为：
   - `moderation_verdict: allow | annotate | block`
   - `moderation_reason: string`
   - `moderation_provider: string`
3. `block` 只用于与校园 scope 无关且必须立即 fail-close 的 severe safety categories。
4. `annotate` 继续调用 supervisor，但可进入 observability / abuse controls。
5. moderation 不能替代：
   - `policy_refusal`
   - `out_of_scope`
   - `unsupported_by_evidence`
   - `freshness_fail_close`
6. provider moderation categories 允许直接消费，但 repo 内必须投影为 canonical `moderation_verdict / moderation_reason`。
7. 本 phase 不做关键词黑名单路径，也不做多 vendor moderation abstraction 平台。

## Execution Slices

### Slice 1: Activate Triggered Scope

- 把 trigger artifact 与 `Conditional Trigger Registry` 中的 active implementation 绑定
- 明确当前为什么需要 moderation lane，而不是继续依赖 `Phase F-I`

### Slice 2: Add Precheck Contract

- app-api precheck produces `allow | annotate | block`
- `annotate` path continues into current supervisor flow

### Slice 3: Project Moderation Outcome

- moderation outcome enters request observability / operator query
- moderation incidents can feed Phase I alerts and incident backfill

### Slice 4: Lock Regression Coverage

- blocked severe-safety sample
- annotated-but-continued sample
- in-scope campus query unaffected sample

## Interfaces To Freeze

- app-api precheck output:
  - `moderation_verdict`
  - `moderation_reason`
  - `moderation_provider`
- request observability projection:
  - moderation fields appear without replacing existing semantic outcome fields

## Verification Matrix

- activation regression：
  - phase cannot start without trigger artifact plus `Conditional Trigger Registry` admission
- precheck regression：
  - `block` stops before supervisor
  - `annotate` continues to supervisor and preserves current fail-close contracts
- observability regression：
  - moderation outcome is visible to operator / incident review

## Proposed Write Set

- `apps/app-api/src/modules/` precheck integration
- request observability / operator query projections
- targeted app-api tests and eval regressions
- trigger artifact and follow-up runbook updates

## Exit Rule

Phase J 完成后，repo 应达到：

- moderation lane 只在 trigger artifact 证明必要时被激活
- active admission 的 canonical truth 已固定在 workstream `STATE.md` `Conditional Trigger Registry`
- moderation verdict contract 已冻结并进入 observability
- moderation 仍只是 precheck/annotation lane，不替代 current policy / scope / grounding runtime
