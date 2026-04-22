---
doc_type: phase_plan
phase: "1"
phase_name: "Agent Family Terminology Freeze"
status: active
created: 2026-04-21
updated: 2026-04-21
---

# Phase 1 Plan

## Objective

把 repo 当前已经出现的 mixed execution family vocabulary 收口成一套正式、可继续执行的命名规则，让后续 contract / observability / eval / package migration 不再边做边重新发明 label。

## Why This Phase Exists

当前 repo 不是“纯 legacy specialist”或“纯 agent family”中的任意一种，而是已经同时存在三类状态：

- current package / ADR / runtime truth 仍大量使用 `rag-specialist`、`availability-specialist`、`navigation-specialist`
- target / planning docs 已开始使用 `rag-agent`、`campus-services-agent`、`notice-agent`、`navigation-agent`
- shared contract 与 supervisor delegate registry 已经接受部分 `*-agent` label，但 operator-facing formatting、telemetry、tests、evals 还主要站在 legacy label 一边

如果不先冻结 terminology，后续每条 workstream 都可能自己决定：

- `rag-specialist` 到底该叫 `rag-agent` 还是继续沿用 old name
- `navigation-specialist` / `navigation-agent` 哪个才算 target-side truth
- `availability-specialist` 是否需要被顺手改名
- `selected_target`、panel、observability、eval 到底什么时候迁移

这会让 Phase 2-4 的工作范围持续漂移。

## Locked Inputs

- `supervisor` 继续保持 top-level invariant name。
- `packages/contracts` 与 `packages/supervisor-core` 当前已经接受 mixed targets，这一事实在 Phase 1 里只被记录，不在本 phase 内继续扩散。
- `campus-services-agent` 与 `notice-agent` 已经是 admitted forward family label。
- `navigation-specialist` 与 `availability-specialist` 仍有 accepted current-truth docs / package ownership，不能被本 phase 静默改写。
- 本 phase 是 terminology freeze，不是 current-truth migration，不是 runtime implementation。

## Decisions To Freeze

1. `supervisor` 继续是唯一顶层协调入口名称，不引入 `supervisor-agent`。
2. repo-wide execution family 统一采用三层 vocabulary：
   - invariant role name
   - current-truth runtime / package / contract label
   - forward family label
3. `rag-specialist -> rag-agent` 固定为首条显式 convergence pair。
4. `campus-services-agent` 与 `notice-agent` 固定为 canonical forward family labels。
5. `navigation-specialist` 当前继续保留为 runtime / package / ADR truth；`navigation-agent` 只作为 forward planning label 使用，真正迁移留到后续 phase。
6. `availability-specialist` 在本 phase 保持 legacy current-truth label，不提前发明 `availability-agent`。
7. 从本 phase 起，不再新增新的 `*-specialist` family label；后续新增稳定 family 默认遵循 `<domain>-agent`。
8. 迁移顺序固定为：
   - terminology freeze
   - current-truth contract migration
   - prompt / eval / observability convergence
   - package / runtime rename decision

## Execution Slices

### Slice 1: Publish The Terminology Matrix

- 把每个现有 family 明确落到三层 vocabulary model：
  - invariant role name
  - current-truth label
  - forward family label
- 至少覆盖：
  - `supervisor`
  - `rag-specialist`
  - `availability-specialist`
  - `navigation-specialist`
  - `campus-services-agent`
  - `notice-agent`

### Slice 2: Freeze Current-Truth Vs Forward-Truth Surfaces

- 明确哪些 surface 在 `Phase 1` 之后仍然允许保留 current-truth legacy label：
  - package dir / import path
  - accepted ADR wording
  - current runtime dispatch / contract where already admitted
- 明确哪些 surface 从 `Phase 1` 起应使用 forward family label：
  - target architecture
  - forward planning docs
  - future stable family naming guidance

### Slice 3: Freeze Family-Specific Mapping Rules

- `rag-specialist`：
  - current-truth label 保留
  - forward family label 固定为 `rag-agent`
- `campus-services-agent` / `notice-agent`：
  - 继续保持 forward-converged，不回退命名
- `navigation-specialist`：
  - 当前 truth 保留
  - target-side planning truth 统一写 `navigation-agent`
- `availability-specialist`：
  - 当前 truth 保留
  - 在后续显式决策前不新增 forward alias

### Slice 4: Freeze Migration Boundaries For Later Phases

- `Phase 2` 只处理 current-truth contract label migration：
  - `selected_target`
  - shared enum / example payload
  - operator-facing current label surfaces
- `Phase 3` 只处理：
  - prompt docs
  - eval labels
  - telemetry / trace labels
  - operator copy
- `Phase 4` 才决定：
  - package dir rename
  - import path rename
  - runtime object rename
  - intentional non-rename carve-out

### Slice 5: Add Anti-Drift Guardrails

- 把“不得继续无规则新增混合 naming”写进 workstream truth。
- 明确新增 family 时，先确定：
  - current-truth label 是否存在
  - forward family label 是什么
  - migration 是否 deferred
- 不允许 domain workstream 在没有引用这条 convergence truth 的情况下自行发明新名称。

## Proposed Write Set

- `.planning/workstreams/execution-capability-family-convergence/phases/phase-1-agent-family-terminology-freeze/CONTEXT.md`
- `.planning/workstreams/execution-capability-family-convergence/phases/phase-1-agent-family-terminology-freeze/PLAN.md`
- `.planning/workstreams/execution-capability-family-convergence/STATE.md`
- `docs/plans/execution-capability-family-convergence.md`
- `docs/architecture/target-architecture.md`
- `docs/architecture/execution-and-agents-architecture.md`
- `docs/architecture/current-architecture.md`
- `docs/decisions/adr-0027-navigation-specialist-and-spatial-truth.md`
- `packages/availability-specialist/README.md`
- `packages/navigation-specialist/README.md`

## Verification Matrix

- planning truth
  - `Phase 1` 目录存在 `CONTEXT.md` 与 `PLAN.md`
  - `STATE.md` 的 `Current Plan` 指向 `Phase 1`
- terminology truth
  - `supervisor` 被明确冻结为 invariant role name
  - `rag-specialist -> rag-agent` 被明确冻结成 canonical pair
  - `campus-services-agent` / `notice-agent` 被明确冻结为 canonical forward family labels
  - `navigation-specialist` 与 `navigation-agent` 的 coexistence rule 被写清
  - `availability-specialist` 的 deferred posture 被写清
- phase boundary truth
  - `Phase 1` 不执行 contract / telemetry / eval / package rename
  - `Phase 2-4` 的职责分界被写清
- validation commands
  - `git diff --check -- .planning/workstreams/execution-capability-family-convergence docs/plans/execution-capability-family-convergence.md`
  - `rg -n "rag-agent|navigation-agent|availability-agent|campus-services-agent|notice-agent" docs/architecture docs/plans .planning/workstreams/execution-capability-family-convergence`

## Exit Rule

`Phase 1` 完成后，repo 应达到：

- 后续执行者不再需要重开“这个 family 到底叫 specialist 还是 agent”的讨论
- `Phase 2` 可以直接处理 current-truth contract label migration，而不是先补 naming freeze
- `Phase 3` 可以直接处理 prompt / eval / observability convergence
- `Phase 4` 可以基于已冻结 vocabulary 决定哪些 package/runtime 真要 rename，哪些保持 historical current-truth
