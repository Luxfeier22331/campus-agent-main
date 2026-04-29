---
doc_type: plan
status: completed
created: 2026-04-23
updated: 2026-04-24
---

# Phase 1 Plan

## Objective

把 `eval` workstream 从“已有代码底座但无可执行 plan”推进到“owner、contract 与 phase ordering 已冻结”的状态，并显式确认 `golden dataset` 只在采集内容补全后进入独立治理 phase。

## Tasks

1. 冻结 shared eval owner boundary
   - 明确 `packages/evals`、deterministic vs supplemental 分层、benchmark artifact、request correlation、publish/backflow seam 与 CI/release-gate automation 属于 shared eval
   - 明确 handbook / curriculum / notice / navigation 继续拥有各自 domain truth authoring
   - 明确 `app-api` 继续拥有 operator truth，而不是被 eval 回收

2. 冻结顺序依赖
   - 把 `golden dataset` 的正式治理改成显式依赖“采集内容补全”
   - 不再把 repo-wide coverage matrix / denominator 扩编当成当前立即执行项
   - 允许 benchmark runtime / artifact lifecycle、publish/backflow、CI/release-gate automation 先行收口

3. 补齐 workstream 原生 phase 资产
   - 新建 `phases/phase-1-shared-eval-ownership-and-contract-freeze/`
   - 让 `README.md`、`ROADMAP.md`、`STATE.md` 与 repo-level `WORKSTREAMS.md` 指向同一顺序真相
   - 结束 `Current Plan: <none>` 状态

4. 冻结下一阶段 handoff
   - 本 phase 完成后，下一阶段应进入 `Benchmark Runtime And Artifact Lifecycle`
   - `Golden Dataset And Case Governance` 保留在后置 phase，等待采集内容补全再启动

## Constraints

- 不在本 phase 启动 repo-wide golden case 扩编
- 不把缺失 corpus coverage 的 case authoring 伪装成 shared eval governance 完成
- 不改写 handbook / curriculum / notice / navigation 的 domain truth owner
- 不把 operator panel/read-model truth 回收给 eval
- 不修改 runtime、retrieval、`app-api` 或 panel 代码

## Verification

- `README.md`、`REQUIREMENTS.md`、`ROADMAP.md`、`STATE.md` 与 repo-level `WORKSTREAMS.md` 顺序一致
- `Current Plan` 不再为空
- `golden dataset` 的前置条件被显式写出，而不是隐含在会话里
- `git diff --check` 通过

## Exit Criteria

- `eval` workstream 的 owner boundary 已冻结
- `eval` workstream 的 phase ordering 已与采集补全前置条件对齐
- repo planning truth 明确允许先推进 shared runtime / artifact / publish / gate
- 下一次恢复可直接从 `Phase 2: Benchmark Runtime And Artifact Lifecycle` 继续，而不必重新判断 `golden dataset` 是否挡路
