---
doc_type: index
status: active
created: 2026-04-12
updated: 2026-04-20
---

# Plans

`plans/` 只保留仍对前向实施有指导价值的计划文档。
当前 active/deferred/backlog workstreams 与其状态以 `.planning/PROJECT.md` 和 `.planning/WORKSTREAMS.md` 为准；单条 workstream 的 execution truth 固定在 `.planning/workstreams/<slug>/`。这里负责说明哪些计划仍是当前 workstream 的入口文档。

补充约束：

- plan front matter 的 `status` 表达文档 lifecycle，不表达 `.planning/WORKSTREAMS.md` 的 registry state
- `backlog` 是 repo 级 workstream registry 状态，不是 plan front matter status
- 因此 backlog entry plans 当前仍使用 `status: deferred`

## Active Workstream Entry Plans

- `notice-semantic-fan-out-and-consumption-modeling.md`
  - `notice semantic fan-out / authority / completeness modeling` 的 active 入口；固定 source notice、attachment authority 与 future handoff contract

- `operator-observability-control-plane-foundation.md`
  - `operator observability / control-plane` 的单一 active 入口；固定 aggregate API、panel 扩面与 closeout 顺序

- `execution-capability-family-convergence.md`
  - repo 级 execution capability family naming / label convergence 的 active 入口；固定 `*-specialist` 到 `*-agent` 的长期收敛顺序

## Deferred Workstream Entry Plans

- `internal-notice-policy-regulation-consumption-implementation.md`
  - `authenticated-notice -> regulation downstream consumption` 的单一 deferred 入口；覆盖 non-auth regulation downstream consumption
- `authenticated-notice-file-release-owner-recovery.md`
  - `authenticated-notice file_release owner recovery` 的单一 deferred 入口；覆盖 auth-window bounded owner recovery
- `authenticated-notice-live-portal-control-plane.md`
  - `authenticated-notice live portal / authenticated control-plane` 的单一 deferred 入口；覆盖 authenticated collector、live capture、scheduler、run ledger 与 source-channel control-plane
- `restricted-document-rollout-and-verification.md`
  - `restricted document rollout / verification` 的单一 deferred 入口；覆盖 restricted collection rollout、surface behavior、allow/deny matrix 与泄露防护验证

## Backlog

- `campus-navigation-rollout-map-consumption.md`
  - `campus navigation rollout / place_card / map consumption` 的 backlog 入口；registry state 为 `backlog`，文档 lifecycle 保持 `deferred`
- `official-web-source-channel-news-opening.md`
  - `official-web source channel / news opening` 的 backlog 入口；registry state 为 `backlog`，文档 lifecycle 保持 `deferred`

## Deferred Reference Plans

- `protected-panel-requests-triage-table-redesign.md`
  - panel follow-up 仍保留为 deferred reference，但不是原生 workstream 入口
- `golden-dataset-execution-plan.md`
  - eval / golden dataset 的后续扩样与治理仍有价值，但不是原生 workstream 入口
- `legacy-acl-carrier-compatibility-sunset.md`
  - vocabulary / payload canonicalization residue 仍保留为 deferred reference，但没有独立 workstream
- `versioned-history-query-foundation.md`
  - 能力仍在 target architecture 内，但只保留 deferred reference，不作为原生 workstream 入口

## Archive

- `archive/README.md`
  - `completed`、`historical` 与 `superseded` plan 已统一下沉到 archive namespace；根层只保留当前仍有前向指导价值的计划入口

## 使用规则

- `active` 表示当前可接手的 workstream 入口；多个 `active` 文档可以并行存在，由不同会话分别推进
- `deferred` 表示能力仍被接受，但当前没有活跃执行面
- `backlog` 表示能力仍被接受，但当前只保留 repo 级 registry 条目，不预建 native workstream 目录
- `deferred reference plans` 表示计划仍保留前向参考价值，但当前不是原生 workstream 入口
- `completed` 与 `historical` 必须退出 `docs/README.md` 的默认入口
