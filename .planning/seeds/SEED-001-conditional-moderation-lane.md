---
id: SEED-001
status: dormant
planted: 2026-04-19
planted_during: product-path-safety-prompt-grounding-governance closeout after Phase I
trigger_when: repo-tracked product scope expands to open-ended public input, or repo-tracked incident evidence shows Phase F-I abuse controls are insufficient
scope: Medium
---

# SEED-001: Conditional Moderation Lane

## Why This Matters

当前 repo 已具备 semantic gate、provider `content_filter` observability、`safety_identifier` abuse throttle 与 operator safety alerts。
如果 future public scope 变成更 open-ended 的输入，或 incident evidence 证明 `Phase F-I` 仍不足以控制重复滥用，就需要补一个 app-owned moderation precheck / annotation lane。这个能力现在不该抢跑，但 admission 条件和冻结边界必须被保留下来，避免未来 reopen 时重新发散。

## When to Surface

**Trigger:** repo-tracked product scope expands to open-ended public input, or repo-tracked incident evidence shows Phase F-I abuse controls are insufficient.

This seed should be presented during `$gsd-new-milestone` when the milestone scope matches any of these conditions:
- public scope 明确扩到 open-ended / broader internet-like input
- repo-tracked incident artifact 证明当前 `policy / scope / grounding + Phase I` abuse controls 无法稳定压住某类 repeated abuse

## Scope Estimate

**Medium** — 一条聚焦 app-api precheck、observability projection、operator review 与 targeted regression 的 follow-up phase，不扩成通用 moderation platform。

## Breadcrumbs

Related code and decisions found in the current codebase:

- `docs/plans/archive/completed/hallucination-governance-and-grounded-generation-execution-plan.md`
- `.planning/workstreams/product-path-safety-prompt-grounding-governance/STATE.md`
- `.planning/workstreams/product-path-safety-prompt-grounding-governance/phases/phase-i-abuse-controls-and-security-ops-loop/SUMMARY.md`
- `apps/app-api/src/modules/safety-ops-policy.ts`
- `apps/app-api/src/modules/operator-query/store.ts`
- `tests/supervisor/test_supervisor_policy.py`

## Notes

- placement 固定在 `app-api` precheck，发生在 supervisor call 之前
- canonical contract 预留为：
  - `moderation_verdict: allow | annotate | block`
  - `moderation_reason: string`
  - `moderation_provider: string`
- `annotate` 继续调用当前 supervisor flow；`block` 只用于必须立即 fail-close 的 severe safety categories
- moderation 不能替代 code-owned `policy_refusal`、`out_of_scope`、`unsupported_by_evidence`、`freshness_fail_close`
- 不做关键词黑名单路径，也不扩成多 vendor moderation abstraction 平台
