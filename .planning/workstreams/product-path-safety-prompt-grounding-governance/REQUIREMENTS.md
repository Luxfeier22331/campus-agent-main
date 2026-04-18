---
doc_type: requirements
status: completed
created: 2026-04-19
updated: 2026-04-19
---

# Requirements: Product-path Safety Prompt Grounding Governance

## Goal

以已完成的 A-E baseline closeout 与 2026-04-19 latest passing artifact 为前提，把 `source-trust runtime -> remote-content hardening -> safety traceability -> abuse controls` 收口成产品侧正式 runtime truth，而不是停留在分析结论或 plan-only 语义里。

## In Scope

- `policy_refusal / out_of_scope / unsupported_by_evidence / freshness_fail_close` 语义结果真相
- prompt runtime ownership、prompt metadata sink 与 typed runtime state
- retrieval adequacy / grounding runtime 的持续 gate
- live artifact rerun replacement
- eval / operator observability / release-gate evidence
- `source-trust tier` 的 contract / evidence / grounding / release-gate runtimeization
- `official_web` 与后续 live/authenticated source 的 remote-content sanitization / prompt-injection hardening
- 终端用户在线问答的 provider-side safety traceability 与 app-owned observability 对齐
- public/product-path 最小 abuse controls、alerts 与 incident backfill hooks

## Non-goals

- 把敏感问题拦截、system prompt、grounding runtime 再拆成多条并发线
- 用更长 prompt 替代结构性 gate/runtime 修复
- 把 repo-local closeout 误写成 live artifact 已刷新完成
- 把这条线扩成厂商级完整 LLM safety platform
- 用关键词黑名单或“敏感词拦截”替代 code-owned `policy / scope / grounding / source-trust` gate
- 在产品尚未重新引入高风险 action execution 时，提前实现脱离场景的人审执行系统
- 把 conditional moderation lane 与 HITL approval recovery 继续算作这条已完成 workstream 的必做 phase；它们已改为 dormant seeds，等待未来 scope trigger

## Success Criteria

1. A-E 已完成的 `policy / scope / grounding / live artifact` 基线继续保持当前 release gate 一致，不因后续 phase 回退。
2. `source-trust tier` 不再只是 plan 术语，而是进入 contracts、evidence、grounding verdict 与 release-gate projection。
3. `official_web` 与其他 remote content 在进入 prompt/runtime 前有明确的 sanitization / prompt-injection hardening 与 regression evidence。
4. 终端用户在线问答具备 provider-side safety traceability，且不泄漏原始 prompt / answer / auth secrets。
5. public/product-path 至少具备最小 abuse control、异常信号与 incident backfill hooks，而不是只有质量观测。
6. future moderation 与 HITL follow-up 已明确迁出为 dormant seeds，不再让当前 workstream 因 trigger-only scope 长期停在 hold。
7. 如果出现漂移，修复回到 gate/runtime，而不是重开 prompt 文案优化子线。

## Phase Completion Contract

- `Phase F`
  - 冻结显式 `T0-T3` taxonomy、surface mapping、claim/tier compatibility、authz non-override rule，以及 `source_trust_tier` / `source_trust_summary` contract；其中 `curriculum/curriculum_plan` 与现有 internal curriculum derived surfaces 必须明确落到 `T0/T0-derived`，且 `T0-derived` 不得成为新的 enum。
- `Phase G`
  - 冻结 remote-content sanitization boundary、`remote_content_suspicion` label set、generation downgrade 规则，以及 official-web/live-source regression matrix。
- `Phase H`
  - 冻结 canonical `safety_identifier` derivation、provider-side projection、app-owned persistence 与 telemetry exposure boundary；匿名 fallback 必须是 session-scoped、固定到 `ResolvedAppPrincipal.session.sessionId`，并固定 HMAC secret env owner/key。
- `Phase I`
  - 冻结最小 abuse control set：rate limit or throttle key、alert derivation、incident backfill hook 与 operator query consumption path；同时固定 app-owned signal source、initial thresholds、sink non-ownership rule，以及 throttled request 的 canonical `status/error_code`。

## Follow-up Seeds

- `SEED-001`：future `Conditional Moderation Lane`
- `SEED-002`：future `Conditional HITL Approval Recovery`

## Canonical Entry

- `docs/plans/hallucination-governance-and-grounded-generation-execution-plan.md`
