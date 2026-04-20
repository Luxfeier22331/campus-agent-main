---
phase: "1"
name: "Agent Family Terminology Freeze"
created: 2026-04-21
updated: 2026-04-21
status: active
---

# Phase 1 Context

**Gathered:** 2026-04-21
**Status:** Active

<domain>
## Phase Boundary

本 phase 只负责：

- 冻结 execution capability family 的术语层级：
  - invariant role name
  - current-truth runtime / contract label
  - forward family label
- 明确 `supervisor`、`rag-specialist`、`availability-specialist`、`navigation-specialist`、`campus-services-agent`、`notice-agent` 的命名归属与 coexistence 规则
- 把 `rag-specialist -> rag-agent` 收口成明确的 forward naming pair
- 明确哪些内容属于后续：
  - `Phase 2` current-truth contract label migration
  - `Phase 3` prompt / eval / observability label convergence
  - `Phase 4` package / runtime rename decision

它不负责：

- repo-wide rename code / docs / tests
- 新增 runtime family、tool、payload 或 routing behavior
- 修改 package dir、import path、workspace package name
- 调整 `selected_target`、telemetry tag、panel filter、eval expectation 的实现
- 重开任何 domain workstream 的 runtime/product scope

</domain>

<current_truth>
## Current Truth

- `docs/architecture/current-architecture.md` 仍把当前 package truth 写成：
  - `packages/rag-specialist`
  - `packages/availability-specialist`
- `docs/architecture/execution-and-specialists-architecture.md` 与 `docs/architecture/target-architecture.md` 已开始写入前向 `<domain>-agent` 规则，并显式使用：
  - `campus-services-agent`
  - `notice-agent`
  - `navigation-agent`
- `packages/contracts/src/campus_contracts/models.py` 的 `SpecialistTarget` 已处于混合态，同时接受：
  - `rag-specialist`
  - `availability-specialist`
  - `navigation-specialist`
  - `campus-services-agent`
  - `notice-agent`
- `packages/supervisor-core/src/campus_supervisor_core/agent.py` 的默认 delegate registry 也已同时注册 legacy `*-specialist` 与 newer `*-agent` target。
- `apps/app-api` telemetry 与 `apps/protected-panel-web` 的 operator-facing selected-target formatting 仍主要围绕 legacy label 工作；当前用户可见文案只显式 special-case 了 `rag-specialist`。
- `tests/` 与 `packages/evals/` 中仍大量把 `rag-specialist`、`availability-specialist`、`navigation-specialist` 视为 current runtime truth。
- `docs/decisions/adr-0027-navigation-specialist-and-spatial-truth.md` 以及已有 availability package docs 仍明确使用 `navigation-specialist` / `availability-specialist`，说明 accepted current truth 与 target-side planning truth 还没有正式映射。
- 当前这条 workstream 在创建前只有：
  - `REQUIREMENTS.md`
  - `ROADMAP.md`
  - `STATE.md`
  还没有 phase-local terminology freeze artifacts。

</current_truth>

<decisions>
## Implementation Decisions

- **01-01:** `supervisor` 是 invariant top-level role name；本 workstream 不引入 `supervisor-agent`。
- **01-02:** 本 phase 冻结三层 vocabulary model：
  - invariant role name
  - current-truth runtime / package / contract label
  - forward family label
- **01-03:** `rag-specialist` 的唯一 forward family label 固定为 `rag-agent`；后续 planning / target docs 不再发明别的 RAG family 名称。
- **01-04:** `campus-services-agent` 与 `notice-agent` 已经是 forward-converged family label；本 phase 只确认它们继续作为 canonical forward family name，不回退成新的 `*-specialist`。
- **01-05:** `navigation-specialist` 继续是 current-truth runtime / package / ADR label；`navigation-agent` 只作为 forward family label 存在，真正的 contract/runtime rename 留到后续 phase。
- **01-06:** `availability-specialist` 在本 phase 继续保持 legacy current-truth label；在后续 phase 明确决定前，不新增 `availability-agent` 这类未经收口的 forward alias。
- **01-07:** 从本 phase 起，不再新增新的 `*-specialist` family label，除非有后续 accepted ADR / active workstream 显式覆盖。
- **01-08:** migration order 固定为：
  - `Phase 1` terminology freeze
  - `Phase 2` current-truth contract label migration
  - `Phase 3` prompt / eval / observability label convergence
  - `Phase 4` package / runtime rename decision

</decisions>

<specifics>
## Specific Gaps

- `rag-specialist` 与 `rag-agent` 已经同时出现在 repo，但没有 phase-local canonical mapping。
- `navigation-specialist` 与 `navigation-agent` 分别出现在 accepted ADR/current runtime 与 target-side planning docs，缺少正式 coexistence rule。
- `availability-specialist` 目前没有被冻结的前向 posture，后续文档很容易随手发明新名字。
- `selected_target`、operator-facing label、telemetry、eval expectation 都在消费这些字符串，但还没有清楚写明各自归属哪一条后续 phase。
- `docs/plans/execution-capability-family-convergence.md` 仍停留在“下一步先写 Phase 1 PLAN”的状态，需要正式接手并更新 continuity。

</specifics>

<canonical_refs>
## Canonical References

- `docs/plans/execution-capability-family-convergence.md`
- `.planning/workstreams/execution-capability-family-convergence/REQUIREMENTS.md`
- `.planning/workstreams/execution-capability-family-convergence/ROADMAP.md`
- `.planning/workstreams/execution-capability-family-convergence/STATE.md`
- `docs/architecture/current-architecture.md`
- `docs/architecture/target-architecture.md`
- `docs/architecture/execution-and-specialists-architecture.md`
- `docs/decisions/adr-0027-navigation-specialist-and-spatial-truth.md`
- `packages/contracts/src/campus_contracts/models.py`
- `packages/supervisor-core/src/campus_supervisor_core/agent.py`
- `apps/app-api/src/modules/telemetry/sentry-scope.ts`
- `apps/app-api/src/modules/telemetry/axiom-envelope.ts`
- `apps/protected-panel-web/src/panel/pages/overview-page/constants.ts`
- `apps/protected-panel-web/src/panel/requests/request-formatters.ts`
- `tests/supervisor/test_supervisor_core.py`
- `tests/supervisor/test_supervisor_routing.py`
- `packages/evals/src/campus_evals/expectations.py`

</canonical_refs>

<deferred>
## Deferred Follow-up

- `Phase 2`: `selected_target` / contract enum / operator-facing current-truth label migration
- `Phase 3`: prompt docs、eval labels、observability / trace labels 与 operator copy convergence
- `Phase 4`: package dir、import path、runtime object label 是否真正 rename 的单次收口决策
- 任何新的 runtime family / tool implementation
- `availability-specialist` 的长期 repositioning 或 retirement 决策

</deferred>
