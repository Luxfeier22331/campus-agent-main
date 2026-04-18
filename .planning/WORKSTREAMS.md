---
doc_type: index
status: active
created: 2026-04-19
updated: 2026-04-19
---

# Workstreams

`WORKSTREAMS.md` 是 repo 级 workstream registry。
它负责记录哪些 workstreams 当前存在、状态如何、入口文档是什么，以及哪些条目已经落成原生 `.planning/workstreams/<slug>/` 目录。

它不替代每条 workstream 自己的 `STATE.md`、`ROADMAP.md`、`REQUIREMENTS.md`。

## Shared Planning Contract

- `PROJECT.md`
  - repo 级产品范围、关键决策与 merged/worktree truth
- `WORKSTREAMS.md`
  - repo 级 workstream registry；active / deferred / backlog / legacy 的唯一总览
- `.planning/workstreams/<slug>/STATE.md`
  - 单条 workstream 的当前状态、current slice、blockers、verification 与 continuity
- `.planning/workstreams/<slug>/ROADMAP.md`
  - 单条 workstream 的固定顺序与 phase 状态
- `.planning/workstreams/<slug>/REQUIREMENTS.md`
  - 单条 workstream 的目标、范围、non-goals 与 success criteria
- `.planning/seeds/`
  - dormant future follow-up；记录 why / trigger / breadcrumbs，供后续 milestone 或新 workstream 恢复时再拾起
- `.planning/runtime/`
  - gitignored 的本地 operator 配置、claim lease、claim history 与 session pointer 辅助状态；不承担 tracked planning truth
- `.planning/legacy-flat/`
  - 迁移前的 flat planning archive；仅保留历史 phase / milestone 参考，不再承载当前执行真相
- `.planning/quick/`、`.planning/todos/`、`.planning/codebase/`、`.planning/research/`
  - 当前继续保持 repo 共享，不按 workstream 拆分

## Active

| Workstream | Slug | Native Dir | Entry | Current Phase | Current Slice |
|------------|------|------------|-------|---------------|---------------|
| `shared file asset loader contract` | `shared-file-asset-loader-contract` | `yes` | `docs/plans/shared-file-asset-loader-contract.md` | `Phase A` | 先冻结 repo-level file asset contract：`typing -> normalization -> extraction -> terminal outcome -> provenance`，再做 bounded backend evaluation |
| `shared product surfaces acceptance / hardening` | `shared-product-surfaces-acceptance-hardening` | `yes` | `docs/plans/shared-product-surfaces-acceptance-hardening.md` | `Phase D` | Phase A-C baseline 已 fresh 通过；当前进入 browser smoke、integrated acceptance 与 staging closeout 准备 |

## Completed

| Workstream | Slug | Native Dir | Entry | Reopen Rule |
|------------|------|------------|-------|-------------|
| `product-path safety / prompt / grounding governance` | `product-path-safety-prompt-grounding-governance` | `yes` | `docs/plans/hallucination-governance-and-grounded-generation-execution-plan.md` | 只有 future product scope 扩到 open-ended public input，或重新引入 state-changing / externally side-effectful action execution，并命中 `.planning/seeds/SEED-001-conditional-moderation-lane.md` / `.planning/seeds/SEED-002-conditional-hitl-approval-recovery.md` 的 trigger 条件时才恢复 |

## Deferred

| Workstream | Slug | Native Dir | Entry | Reopen Rule |
|------------|------|------------|-------|-------------|
| `authenticated-notice -> regulation downstream consumption` | `authenticated-notice-regulation-consumption` | `yes` | `docs/plans/internal-notice-policy-regulation-consumption-implementation.md` | 只有在产品范围重新提升 authenticated-notice regulation downstream consumption 优先级时才恢复；恢复后从现有 `11` 条 admitted target 的 target-side quality closeout 继续 |
| `authenticated-notice file_release owner recovery` | `authenticated-notice-file-release-owner-recovery` | `yes` | `docs/plans/authenticated-notice-file-release-owner-recovery.md` | 只有在下一次 auth window 真正进入执行窗口，或产品范围重新提升 auth-dependent owner recovery 优先级时才恢复 |
| `authenticated-notice live portal / authenticated control-plane` | `authenticated-notice-live-portal-control-plane` | `yes` | `docs/plans/authenticated-notice-live-portal-control-plane.md` | 只有在认证窗口恢复，或产品范围决定恢复 source-channel live portal scheduling / authenticated control-plane 时才恢复 |
| `operator observability / control-plane` | `operator-observability-control-plane` | `yes` | `docs/plans/operator-observability-control-plane-foundation.md` | 只有在产品范围决定把 panel 从当前 operator shell 扩成完整 observability control-plane 时才恢复 |
| `restricted document rollout / verification` | `restricted-document-rollout-verification` | `yes` | `docs/plans/restricted-document-rollout-and-verification.md` | 只有在产品范围决定打开 restricted surface 或推进 restricted collection rollout 时才恢复 |

## Backlog

| Workstream | Slug | Native Dir | Entry | Reopen Rule |
|------------|------|------------|-------|-------------|
| `official-web source channel / news opening` | `official-web-source-channel-news-opening` | `no` | `docs/plans/official-web-source-channel-news-opening.md` | 只有在产品范围重新提升新闻面 opening 优先级后才恢复 |
| `campus navigation rollout / place_card / map consumption` | `campus-navigation-rollout-map-consumption` | `no` | `docs/plans/campus-navigation-rollout-map-consumption.md` | 等待校园地图实际上线后再恢复 |

## Legacy / Follow-up References

这些条目继续保留为 repo 级参考，但当前不是原生 workstream：

- `protected-panel-requests-triage-table-redesign.md`
- `golden-dataset-execution-plan.md`
- `legacy-acl-carrier-compatibility-sunset.md`
- `post-closeout-follow-up-execution-plan.md`
- `versioned-history-query-foundation.md`

## Usage Rules

- 判断 repo 当前有哪些 workstreams、各自状态如何，先看这里
- 判断某条 workstream 的当前切片、blockers、verification，进入对应 `.planning/workstreams/<slug>/STATE.md`
- 判断某条 workstream 的固定顺序，进入对应 `.planning/workstreams/<slug>/ROADMAP.md`
- 判断某条 workstream 的范围、non-goals 与 success criteria，进入对应 `.planning/workstreams/<slug>/REQUIREMENTS.md`
- 需要历史 phase / milestone 叙事时，进入 `.planning/legacy-flat/`
- 判断当前谁认领了某条 workstream、handoff 是否 pending、某个本机会话是否仍持有 lease，使用 `uv run --all-packages python -m scripts.workstream_claim ...`；不要把这些运行时状态补写回 tracked planning 文档
