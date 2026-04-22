---
doc_type: context
status: completed
created: 2026-04-23
updated: 2026-04-24
---

# Phase 1 Context

## Why This Phase Exists

`packages/evals` 已经积累出不少 shared runtime 与 benchmark substrate，但 workstream 还停在 “active yet no plan” 的状态。

如果不先把 owner / contract / sequencing 写实，后续会继续发生三类漂移：

- runtime / artifact / publish / CI 明明已经是 shared eval 责任，却继续寄生在 handbook / curriculum / safety / operator 的局部 closeout 中
- `golden dataset` 因为依赖采集内容补全，被误当成整个 eval workstream 的硬 blocker，导致其他可推进内容一起停滞
- operator publish / backflow、request correlation 与 benchmark artifact 的 shared seam 没有被正式收口，继续靠局部实现事实维持

## Repo Facts

- `eval` 已是原生 active workstream，但此前 `Current Plan` 仍为 `<none>`
- `packages/evals` 已具备：
  - deterministic / supplemental 分层
  - live benchmark profile
  - `run / repair / accept` artifact
  - operator publish / backflow 相关能力
  - handbook / curriculum / official-web 的多条现有 eval lane
- repo 当前已经存在 accepted 的 golden dataset / eval metric ADR：
  - `docs/decisions/adr-0003-golden-dataset-governance.md`
  - `docs/decisions/adr-0004-evaluation-metrics.md`

## User Decision Already Made

- `golden dataset` 需要等待采集内容补全之后再做
- 当前要继续推进 `eval`，但不要把采集补全前置条件混成“整条 eval 线都不能动”

## Phase Output

本 phase 必须冻结：

- shared eval 的 owner boundary
- shared eval 与 domain truth owner / app-api operator truth owner 的分界
- workstream 顺序：先推进 runtime / artifact / publish / automation，再等待采集补全后进入 `golden dataset` governance
- 原生 phase 计划入口，结束 `Current Plan: <none>` 状态
