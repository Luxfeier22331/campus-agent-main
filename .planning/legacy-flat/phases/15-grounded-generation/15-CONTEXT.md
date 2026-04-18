# Phase 15 Context: 幻觉治理与 Grounded Generation 二次硬化

## Objective

把当前 repo 的幻觉治理从 “semantic split + fail-close baseline” 升级为 “retrieval adequacy + grounded generation + claim-level verification + release-gated artifacts” 的完整系统。

## Why Now

- Phase 13 已完成 policy / scope / unsupported fail-close 语义收口
- Phase 14 已完成 prompt stack / strict output / prompt metadata sink / deterministic-path regression 收口
- 当前剩余 gap 已不再是 prompt runtime ownership，而是 grounded answer 的可证明性和可持续评测能力

## Phase Boundary

本 phase 只处理：

- retrieval adequacy gate
- provider-agnostic grounding runtime
- claim taxonomy 扩展
- claim-level eval / artifact retention

本 phase 不处理：

- open-domain general assistant 能力
- fresh official-web serving 扩面
- memory 授权或 retrieval visibility 放宽
- replacing deterministic curriculum / handbook protected paths

## Repo-Level Design Summary

1. `supervisor` 继续先做 `policy_refusal / out_of_scope / approval_required / needs_clarification / in_scope_knowledge`
2. `rag-specialist` 在生成前增加 retrieval adequacy gate
3. deterministic protected path 保持优先
4. 非 deterministic completed answer 进入 provider-agnostic grounding runtime
5. grounding runtime 按 canonical claim taxonomy 输出 claim support / downgrade verdict
6. eval / operator surface 将 retrieval inadequacy、unsupported claim、clarification、false refusal、false allow 分开记录

## Waves

### Wave A

冻结 retrieval adequacy contract、ambiguity/weak-support diagnostics、clarification-instead-of-guess 基线。

### Wave B

实现 provider-agnostic grounding runtime、canonical claim taxonomy、provider-native citation/support normalizer。

### Wave C

扩展 eval lanes、artifact retention、operator observability summary。

### Wave D

完成 acceptance closeout 与 live artifact refresh；若 supplemental provider `/responses` 仍异常，则只关闭 repo-local truth，并显式记录外部 blocker。

## Key References

- `docs/plans/hallucination-governance-and-grounded-generation-execution-plan.md`
- `docs/plans/prompt-grounding-and-hallucination-hardening-plan.md`
- `docs/architecture/prompt-and-instruction-architecture.md`
- `.planning/phases/14-prompt-stack-system-prompt-runtime/14-03-SUMMARY.md`
