---
doc_type: phase_plan
phase: "4"
phase_name: "Package And Runtime Rename Decision"
status: planned
created: 2026-04-21
updated: 2026-04-21
---

# Phase 4 Plan

## Objective

冻结 `execution-capability-family-convergence` 的 one-shot full rename 执行模型：

- 现有 `*-specialist` implementation surface 必须整体迁移到 `*-agent`
- package/runtime/import/docs/planning/test truth 必须在单波次内完成
- 不留下 compatibility shim、dual naming 或 partial rename

## Why This Phase Exists

`Phase 1-3` 已经完成：

- family terminology freeze
- current runtime contract label split
- prompt / eval / observability wording convergence

剩下唯一未冻结的问题是 implementation identity：

- `packages/rag-specialist`
- `packages/navigation-specialist`
- `campus_rag_specialist`
- `campus_navigation_specialist`

如果不把 full rename 的执行边界写死，repo 会停在：

- 方向已经被选中
- 但 write set、顺序、验证面不清楚
- execution 很容易退化成局部 rename 或过渡 alias

## Locked Inputs

- `Phase 1` 已冻结 forward family mapping
- `Phase 2` 已冻结 `selected_target` / `selectedTarget` raw runtime semantics
- `Phase 3` 已冻结 prompt/eval/observability 的 raw-vs-derived split
- 当前 repo 禁止临时 compatibility layer、dual path alias、半迁移长期存在
- availability 删除线不属于本 phase

## Decisions To Freeze

1. 现有 `*-specialist` implementation surface 是否继续作为 stable implementation truth。
2. one-shot full rename 的 scope 必须至少覆盖：
   - package dir
   - Python distribution
   - Python import/module
   - runtime helper/object naming
   - repo docs / planning / tests 的 canonical references
3. 不接受 partial rename 或长期 dual naming shim。
4. future family naming 与 existing implementation naming 的关系必须写成一条可复用规则。

## Execution Slices

### Slice 1: Audit Rename Candidate Surfaces

- 列出 `rag-specialist` / `navigation-specialist` 在以下层面的 canonical ownership：
  - workspace package dir
  - `pyproject.toml` project name
  - `src/<module>`
  - import references
  - runtime delegate / helper names
  - docs / planning truth
- 明确哪些是 public-ish implementation identity，哪些只是 docs wording

### Slice 2: Freeze One-Shot Rename Scope

- 明确本次 rename 必须同波次覆盖：
  - `packages/rag-specialist -> packages/rag-agent`
  - `packages/navigation-specialist -> packages/navigation-agent`
  - `campus-rag-specialist -> campus-rag-agent`
  - `campus-navigation-specialist -> campus-navigation-agent`
  - `campus_rag_specialist -> campus_rag_agent`
  - `campus_navigation_specialist -> campus_navigation_agent`
- 明确 runtime helper / delegate / package-owned references 的重命名规则
- 明确 docs / planning / tests / verification artefacts 的 canonical replacement rule

### Slice 3: Freeze Sequencing Rule

- 明确 rename 的执行顺序至少包含：
  - workspace/package metadata
  - imports / runtime helpers
  - tests
  - docs / planning truth
  - final verification
- 明确 execution phase 不允许边改边保留旧名字
- 明确如果任一关键 surface 不能同波次完成，则整次 rename 不应开始

### Slice 4: Close Follow-up Ambiguity

- 明确 `campus-services-agent` / `notice-agent` 这类已经是 `*-agent` 的 package，不要求反向回退
- 明确 `rag-specialist` / `navigation-specialist` 在 rename 完成后不再作为 canonical implementation truth
- 明确 Phase 4 结论如何影响 future workstream 命名

## Proposed Write Set

- `.planning/workstreams/execution-capability-family-convergence/phases/phase-4-package-and-runtime-rename-decision/CONTEXT.md`
- `.planning/workstreams/execution-capability-family-convergence/phases/phase-4-package-and-runtime-rename-decision/RESEARCH.md`
- `.planning/workstreams/execution-capability-family-convergence/phases/phase-4-package-and-runtime-rename-decision/PLAN.md`
- `.planning/workstreams/execution-capability-family-convergence/STATE.md`
- `docs/plans/execution-capability-family-convergence.md`
- 如 phase 执行后进入 full rename implementation，再更新：
  - `docs/architecture/current-architecture.md`
  - `docs/architecture/system/execution-and-agents-architecture.md`
  - `docs/architecture/target-architecture.md`
  - 必要的 repo planning truth
  - workspace package dirs / `pyproject.toml`
  - Python imports across apps/packages/tests

## Verification Matrix

- planning truth
  - `Phase 4` 目录存在 `CONTEXT.md`、`RESEARCH.md`、`PLAN.md`
  - `STATE.md` 的 `Current Plan` 指向 `Phase 4`
- research truth
  - external references 与 local coupling evidence 已被转译成 full rename constraints，而不是继续悬而未决
  - local coupling evidence 明确量化 rename cost
- decision truth
  - plan 明确拒绝 no-rename、partial rename、compatibility shim
  - plan 明确 one-shot full rename 的 scope 与 sequencing

## Verification Commands

- `git diff --check -- .planning/workstreams/execution-capability-family-convergence/STATE.md docs/plans/execution-capability-family-convergence.md .planning/workstreams/execution-capability-family-convergence/phases/phase-4-package-and-runtime-rename-decision/CONTEXT.md .planning/workstreams/execution-capability-family-convergence/phases/phase-4-package-and-runtime-rename-decision/RESEARCH.md .planning/workstreams/execution-capability-family-convergence/phases/phase-4-package-and-runtime-rename-decision/PLAN.md`
- `rg -n \"one-shot full rename|partial rename|compatibility shim|campus_rag_agent|campus_navigation_agent|campus_rag_specialist|campus_navigation_specialist\" .planning/workstreams/execution-capability-family-convergence/phases/phase-4-package-and-runtime-rename-decision/`

## Exit Rule

`Phase 4` 规划完成后，repo 应达到：

- full rename 已被定义成一个明确 execution problem，而不是模糊 future cleanup
- 现有 `*-specialist` implementation surface 的迁移边界与验证面有了可执行标准
- future capability family 的命名不会再被 existing rename 未决问题反复拖住
