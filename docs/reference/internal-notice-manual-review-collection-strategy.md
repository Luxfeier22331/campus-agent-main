---
doc_type: reference
status: active
created: 2026-04-11
updated: 2026-04-20
---

# Internal Notice Manual-Review Collection Strategy

## 文档边界

本文冻结 `campus_notices/internal_notice -> regulations/*` 这条线 residual manual-review / duplicate-hold boundary 的当前解释。

它回答的是：

- annual / time-bound rule 为什么不再留在 `institutional_regulations`
- duplicate hold 与 regulation target 的分界是什么
- 哪些 notice 继续停在 source / triage layer，不得误升格

它不回答：

- auth-dependent owner recovery 进度
- future dedicated holding lane 的产品化
- query-serving reopen

## Fixed Conclusions

### 1. `annual_cycle_rule` / `time_bound_operational_rule` 不再进入 `institutional_regulations`

固定结论：

- 这两类文档仍可通过 promotion gate
- 但其 `target_collection` 现在固定为 `regulations/scoped_rules`
- `institutional_regulations` 只保留 institution-wide stable regulation

### 2. Duplicate hold 与 target promotion 是两件事

固定结论：

- duplicate hold 继续保留在 `internal_notice`
- 它只保留 source truth / provenance，不再生成第二份 regulation target
- 语义正文去重高于原始 `content_hash` 复制

### 3. Parent notice 的 body citation / body heading 不能充当 formal-regulation evidence

固定结论：

- `办法 / 意见 / 方案` 的正文引用词不构成 target admission evidence
- `一、...`、`第X条`、`（一）...` 这类 heading 也不构成 title 证据
- wrapper / operational notice 继续留在 `internal_notice`

## Current Boundary Interpretation

当前 regulation import line 已拆成两类 target：

- institution-wide stable regulation -> `institutional_regulations`
- annual/time-bound scoped rules -> `scoped_rules`

固定要求：

- `time_bound_operational_rule` 与 `annual_cycle_rule` 现在是 target split 问题，不再是自动 manual-review 排除问题
- `duplicate_hold_source` 只表示 source-layer duplicate，不表示 target-side第二份 materialization

## Residual Frontier Rule

当前 residual frontier 只允许保留真正缺 owner body 或缺 target metadata 的样本。

固定要求：

- 已能独立恢复 semantic owner body 的样本，应进入目标 target，而不是继续停在 manual-review
- handbook / wrapper / operational notice 不得借由 manual-review residual lane 混入 regulation target

## Related Docs

- `docs/reference/institutional-regulations-offline-inventory.md`
- `docs/reference/institutional-regulations-promotion-quality-acceptance.md`
- `docs/plans/internal-notice-policy-regulation-consumption-implementation.md`
- `docs/plans/authenticated-notice-file-release-owner-recovery.md`
