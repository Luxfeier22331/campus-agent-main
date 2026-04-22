---
phase: "2"
name: "Current-Truth Contract Label Migration"
created: 2026-04-21
updated: 2026-04-21
status: planned
---

# Phase 2 Context

**Gathered:** 2026-04-21
**Status:** Planned

<domain>
## Phase Boundary

本 phase 只负责：

- 收口 current-truth contract label migration：
  - `SpecialistTarget`
  - `selected_target` / `selectedTarget`
  - app-api execution / HTTP / operator schema examples
  - operator-facing target label / filter surfaces
- 明确 raw runtime target、forward family label、operator display label 三者的 contract 分层
- 为 `Phase 3` 的 prompt / eval / observability wording convergence 提供干净前置条件

它不负责：

- package dir / import path / runtime object rename
- 把 `rag-agent` / `navigation-agent` 直接塞进 current runtime contract enum
- prompt 文案、eval wording、trace tag 名称的全量收口
- 重新设计 supervisor routing 或 specialist ownership
- 重开 `Phase 1` 的 terminology freeze

</domain>

<current_truth>
## Current Truth

- `packages/contracts/src/campus_contracts/models.py` 当前把 `SpecialistTarget` 定义为 mixed current runtime target enum：
  - `rag-specialist`
  - `availability-specialist`
  - `navigation-specialist`
  - `campus-services-agent`
  - `notice-agent`
- `SupervisorResponse.selected_target` 继续直接使用 `SpecialistTarget | None`。
- `docs/contracts/app-api-supervisor-execution.md`、`docs/contracts/app-api-http.md`、`docs/contracts/app-api-operator-observability-http.md` 与 `docs/data/app-api-schema.md` 都把 `selected_target` / `selectedTarget` 当成外露字段，但尚未统一写明它是：
  - runtime dispatch target
  - 还是 forward family label
  - 还是 operator-facing display label
- `apps/protected-panel-web/src/panel/requests/request-formatters.ts` 当前只 special-case `rag-specialist -> 检索专家`。
- `apps/protected-panel-web/src/panel/pages/overview-page/constants.ts` 当前只把 `rag-specialist` 放进 target filter options。
- `tests/contracts/test_models.py`、`tests/api/test_supervisor_api.py`、`tests/supervisor/test_supervisor_core.py`、`tests/supervisor/test_supervisor_policy.py` 与多条 eval path 仍大量把 `rag-specialist` / `availability-specialist` 视为 raw contract truth。
- `Phase 1` 已冻结：
  - `rag-specialist -> rag-agent`
  - `navigation-specialist -> navigation-agent`
  - `campus-services-agent` / `notice-agent` 为 canonical forward/current runtime labels
  - `availability-specialist` 暂不生成 `availability-agent`
  但这些规则还没有转化为 current-truth contract migration plan。

</current_truth>

<decisions>
## Implementation Decisions

- **02-01:** `SpecialistTarget` 在本 phase 继续表示 current runtime dispatch target，不表示 forward family label。
- **02-02:** `selected_target` / `selectedTarget` 在本 phase 继续表示“supervisor 最终实际选择的 runtime target”，不表示 human-readable label，也不表示 future family grouping。
- **02-03:** `rag-agent` 与 `navigation-agent` 在本 phase 不进入 shared runtime contract enum；它们仍只属于 target-side / planning-side family vocabulary。
- **02-04:** `campus-services-agent` 与 `notice-agent` 继续保留在 current runtime contract enum 中，因为它们已经是实际 delegate / handoff target，而不是纯文档别名。
- **02-05:** operator-facing display label 应由显式 mapping 决定，而不是把 raw `selected_target` 直接拿去展示。
- **02-06:** 如果后续需要 family-level grouping / reporting，应使用显式命名的新字段或 projection，而不是重载 `selected_target`。
- **02-07:** prompt wording、eval wording、trace/telemetry tag naming 的 repo-wide convergence 继续 deferred 到 `Phase 3`；本 phase 只允许记录边界，不提前实现。

</decisions>

<specifics>
## Specific Gaps

- shared contract 缺少对 `selected_target` 语义的显式文字冻结，导致 current runtime target 与 forward family label 的边界还靠上下文猜。
- app-api schema / execution docs 的 example payload 仍未明确区分 raw target 与 operator label。
- panel 当前只对 `rag-specialist` 有友好显示，其他 current runtime targets 仍会直接暴露 raw string。
- operator filters 还没有按 current runtime target 闭集收口。
- tests / eval paths 仍广泛消费 raw target strings，但没有 phase-local迁移边界，容易把 Phase 2 和 Phase 3 混成一次大改名。

</specifics>

<canonical_refs>
## Canonical References

- `.planning/workstreams/execution-capability-family-convergence/REQUIREMENTS.md`
- `.planning/workstreams/execution-capability-family-convergence/ROADMAP.md`
- `.planning/workstreams/execution-capability-family-convergence/STATE.md`
- `.planning/workstreams/execution-capability-family-convergence/phases/phase-1-agent-family-terminology-freeze/SUMMARY.md`
- `docs/plans/execution-capability-family-convergence.md`
- `docs/architecture/current-architecture.md`
- `docs/architecture/target-architecture.md`
- `docs/architecture/execution-and-agents-architecture.md`
- `packages/contracts/src/campus_contracts/models.py`
- `packages/contracts/src/campus_contracts/__init__.py`
- `packages/supervisor-core/src/campus_supervisor_core/policy.py`
- `packages/supervisor-core/src/campus_supervisor_core/response.py`
- `packages/supervisor-core/src/campus_supervisor_core/audit.py`
- `docs/contracts/app-api-supervisor-execution.md`
- `docs/contracts/app-api-http.md`
- `docs/contracts/app-api-operator-observability-http.md`
- `docs/data/app-api-schema.md`
- `apps/protected-panel-web/src/panel/requests/request-formatters.ts`
- `apps/protected-panel-web/src/panel/pages/overview-page/constants.ts`
- `tests/contracts/test_models.py`
- `tests/api/test_supervisor_api.py`
- `tests/supervisor/test_supervisor_core.py`
- `tests/supervisor/test_supervisor_policy.py`
- `packages/evals/src/campus_evals/expectations.py`

</canonical_refs>

<deferred>
## Deferred Follow-up

- `Phase 3`: prompt docs、eval wording、telemetry / trace labels、operator wording 的 convergence
- `Phase 4`: package dir、import path、runtime object label 是否真正 rename
- 任何新的 target family、new field rollout 或 package rename 的实现
- `availability-specialist` 的长期 forward alias 决策

</deferred>
