---
doc_type: requirements
status: active
created: 2026-04-19
updated: 2026-04-19
---

# Requirements: Product-path Safety Prompt Grounding Governance

## Goal

以已完成的 Phase 13/14/15 repo-local baseline 为前提，持续维持 `policy gate -> prompt runtime -> grounded generation -> eval / observability artifact` 的 release-gated truth，并完成 live artifact rerun replacement。

## In Scope

- `policy_refusal / out_of_scope / unsupported_by_evidence / freshness_fail_close` 语义结果真相
- prompt runtime ownership、prompt metadata sink 与 typed runtime state
- retrieval adequacy / grounding runtime 的持续 gate
- live artifact rerun replacement
- eval / operator observability / release-gate evidence

## Non-goals

- 把敏感问题拦截、system prompt、grounding runtime 再拆成多条并发线
- 用更长 prompt 替代结构性 gate/runtime 修复
- 把 repo-local closeout 误写成 live artifact 已刷新完成

## Success Criteria

1. `policy / scope / grounding` 三层结果与当前 release gate 保持一致。
2. prompt runtime ownership 与 observability sink 不漂移。
3. live artifact rerun replacement 基于当前 supplemental provider 完成刷新。
4. 如果出现漂移，修复回到 gate/runtime，而不是重开 prompt 文案优化子线。

## Canonical Entry

- `docs/plans/hallucination-governance-and-grounded-generation-execution-plan.md`
