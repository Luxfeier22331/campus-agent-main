---
id: SEED-002
status: dormant
planted: 2026-04-19
planted_during: product-path-safety-prompt-grounding-governance closeout after Phase I
trigger_when: repo-tracked product scope reintroduces state-changing or externally side-effectful action execution
scope: Large
---

# SEED-002: Conditional HITL Approval Recovery

## Why This Matters

当前 repo 已有 `approval_required` semantic outcome、prompt packet/operator guidance，以及 panel-visible `待审批` status；但它还不是 backed approval request state machine，也没有 resumed execution contract。
如果 future product scope 重新引入 state-changing 或 externally side-effectful action execution，就必须把当前 terminal `approval_required` 升级成真实的人审恢复执行闭环，同时保持它继续从属于 policy / authz / source-trust / grounding runtime。

## When to Surface

**Trigger:** repo-tracked product scope reintroduces state-changing or externally side-effectful action execution.

This seed should be presented during `$gsd-new-milestone` when the milestone scope matches any of these conditions:
- `docs/plans/*.md` 明确声明新的 action execution scope
- `.planning/quick/<date>-*/SUMMARY.md` 或其他 repo-tracked product decision 明确要求把 `approval_required` 从 terminal answer 升级为可恢复执行的人审流

## Scope Estimate

**Large** — 会涉及 approval persistence/read model、resume contract、panel/operator path 与 resumed execution revalidation，不应在当前无 action execution 范围时抢跑。

## Breadcrumbs

Related code and decisions found in the current codebase:

- `docs/plans/archive/completed/hallucination-governance-and-grounded-generation-execution-plan.md`
- `docs/decisions/adr-0017-supervisor-internal-execution-admission.md`
- `.planning/workstreams/product-path-safety-prompt-grounding-governance/STATE.md`
- `packages/contracts/src/campus_contracts/models.py`
- `apps/app-api/src/modules/runtime-command/service.ts`
- `apps/app-api/src/modules/request-observability.ts`
- `apps/protected-panel-web/src/panel/requests/request-formatters.ts`
- `tests/supervisor/test_supervisor_core.py`

## Notes

- `approval_required` 在未触发本 seed 前继续只是 terminal semantic outcome
- future canonical resume contract 需要至少冻结：
  - `approval_request_id`
  - `approval_status: pending | approved | rejected | expired`
  - typed stored resume payload，而不是 raw prompt replay
- resumed execution 必须重新验证 `policy / scope / authorization / source-trust / grounding`
- approval 不能授予越权读取，也不能 bypass fail-close semantics
- 不扩成 generic workflow engine 或跨产品审批平台
