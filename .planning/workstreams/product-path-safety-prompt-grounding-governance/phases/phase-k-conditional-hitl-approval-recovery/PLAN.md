---
doc_type: phase_plan
phase: "K"
phase_name: "Conditional HITL Approval Recovery"
status: planned
created: 2026-04-19
updated: 2026-04-19
---

# Phase K Plan

## Objective

仅在出现 state-changing / externally side-effectful action execution scope 时，把当前 `approval_required` terminal semantic outcome 升级为 real HITL approval + resumed execution contract。

## Why This Phase Exists

当前 repo 已有：

- `approval_required` semantic outcome
- prompt packet / operator guidance
- panel-visible `待审批` status

但这些都还不是可恢复执行的人审流。  
这条 phase 现在不应抢跑，但 admission、resume contract 与 non-goals 必须先冻结。

## Admission Rule

Phase K 只有在以下条件成立时才能从 `pending` 升为 active：

1. repo-tracked 产品范围变更，正式引入 state-changing 或 externally side-effectful action execution；
2. corresponding trigger artifact 被写入 tracked planning truth。

合法 trigger artifact 固定为：

- `docs/plans/*.md` 中明确声明新的 action execution scope
- `.planning/quick/<date>-*/SUMMARY.md` 中引用的产品范围或安全 closeout 决议

激活时必须同步更新：

- phase `status`
- workstream `STATE.md` `Conditional Trigger Registry`
- workstream `STATE.md Current Slice`

## Decisions To Freeze

1. `approval_required` 在未激活 `Phase K` 前继续只是 terminal semantic outcome。
2. 激活后 canonical resume contract 固定为：
   - response may include `approval_request_id`
   - approval state machine: `pending | approved | rejected | expired`
   - approved requests resume from typed stored payload, not raw prompt replay
3. resumed execution 必须重新验证：
   - policy / scope
   - authorization
   - source-trust
   - grounding / adequacy preconditions
4. approval 不能授予越权读取，也不能 bypass fail-close semantics。
5. panel `待审批` 必须从展示状态升级为 backed approval request read model。
6. 本 phase 不做 generic workflow engine，不扩成跨产品审批平台。

## Execution Slices

### Slice 1: Activate Triggered Scope

- 证明当前已经存在真实 action execution 范围
- 把 trigger artifact 与 `Conditional Trigger Registry` 中的 activation record 绑定
- 写清哪些动作必须进入 HITL，而不是继续停在 `approval_required` terminal answer

### Slice 2: Add Approval Request Contract

- persist `approval_request_id`
- persist approval status and typed resume payload
- bind request execution and operator read model

### Slice 3: Add Resume Path

- operator approval resumes execution from stored typed payload
- resume path re-runs current safety / authz checks before side effect

### Slice 4: Lock Regression Coverage

- pending approval sample
- approved then resumed sample
- rejected / expired sample
- approval cannot bypass authz or source-trust sample

## Interfaces To Freeze

- approval request contract:
  - `approval_request_id`
  - `approval_status`
- resumed execution contract:
  - typed stored payload
  - mandatory revalidation before execution

## Verification Matrix

- activation regression：
  - phase cannot start without action-execution trigger artifact plus `Conditional Trigger Registry` admission
- state-machine regression：
  - `pending -> approved -> resumed`
  - `pending -> rejected`
  - `pending -> expired`
- safety regression：
  - approval does not bypass current policy / authz / source-trust checks
- panel regression：
  - `待审批` reflects real approval request state

## Proposed Write Set

- app-api approval persistence / projection modules
- operator panel request / approval read model
- supervisor / execution admission path for resumed execution
- targeted app-api and panel tests
- trigger artifact / runbook updates

## Exit Rule

Phase K 完成后，repo 应达到：

- `approval_required` 已从 terminal semantic outcome 升级为 backed HITL resume contract
- active admission 的 canonical truth 已固定在 workstream `STATE.md` `Conditional Trigger Registry`
- resume path 使用 typed stored payload，而不是 raw prompt replay
- approval 继续从属于 current safety / authz / source-trust runtime，而不是成为 override 通道
