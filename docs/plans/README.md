---
doc_type: index
status: active
created: 2026-04-12
updated: 2026-04-19
---

# Plans

`plans/` 只保留仍对前向实施有指导价值的计划文档。
当前 active/deferred/backlog workstreams 与其状态以 `.planning/PROJECT.md` 和 `.planning/WORKSTREAMS.md` 为准；单条 workstream 的 execution truth 固定在 `.planning/workstreams/<slug>/`。这里负责说明哪些计划仍是当前 workstream 的入口文档。

## Active

### Product-path safety / prompt / grounding

- `hallucination-governance-and-grounded-generation-execution-plan.md`
  - `product-path safety / prompt / grounding governance` 的单一入口；后续接手时不再拆成敏感问题拦截 / system prompt / grounding / eval artifact 多条并发线

### Product surfaces

- `shared-product-surfaces-acceptance-hardening.md`
  - `app-api`、`public-chat-web`、`protected-panel-web` 的联合验收 / 硬化入口；当前 reopen 后同时承接 public auth shell productization、forgot/reset password 与 auth mailer contract，内部顺序继续由 workstream roadmap 固定

### Data plane / quality / source channels

- `internal-notice-policy-regulation-consumption-implementation.md`
  - `authenticated-notice -> regulation downstream consumption` 的单一 non-auth 入口；后续接手时不再拆成 replay / promotion / target hardening 多条并发线
- `authenticated-notice-file-release-owner-recovery.md`
  - `authenticated-notice file_release owner recovery` 的单一 auth 入口；后续接手时固定按 `auth-window targeted capture -> owner recovery -> bounded validation` 顺序推进

## Deferred

- `authenticated-notice-live-portal-control-plane.md`
  - `authenticated-notice live portal / authenticated control-plane` 的单一 deferred 入口；覆盖 repo-native authenticated collector、live `notice` / `file_release` capture、scheduler/incremental sync、run ledger 与 source-channel control-plane，但当前不表示认证窗口已恢复执行
- `operator-observability-control-plane-foundation.md`
  - `operator observability / control-plane` 的单一 deferred 入口；覆盖 app-owned observability fact、audit/quality/safety/cost read model、panel 新域与 sink participation，但当前不表示 control-plane 已恢复扩面执行
- `protected-panel-requests-triage-table-redesign.md`
  - panel `Requests` 分诊台重构仍保留为 follow-up 计划，但当前未进入 active workstreams 集合
- `golden-dataset-execution-plan.md`
  - eval / golden dataset 的后续扩样与治理仍有价值，但当前没有独立 active execution wave
- `restricted-document-rollout-and-verification.md`
  - `restricted document rollout / verification` 的单一 deferred 入口；覆盖 restricted collection rollout、surface behavior、allow/deny matrix 与泄露防护验证，但当前不表示 restricted surface 已恢复执行
- `legacy-acl-carrier-compatibility-sunset.md`
  - canonical vocabulary 主路径已收口，但 shared contract / persisted payload canonicalization / fixture vocabulary 仍有 residue；当前没有单独 active wave 持续清债
- `post-closeout-follow-up-execution-plan.md`
  - Wave A/B/D/E 主体收口已完成；当前只保留 provider-blocked 或后置 reopen follow-up
- `versioned-history-query-foundation.md`
  - 能力仍在 target architecture 内，但当前没有 active execution wave

## Backlog

- `campus-navigation-rollout-map-consumption.md`
  - `campus navigation rollout / place_card / map consumption` 的 backlog 入口；当前只保留 repo 级 registry 条目，直到地图实际上线
- `official-web-source-channel-news-opening.md`
  - `official-web source channel / news opening` 的 backlog 入口；当前只保留 repo 级 registry 条目，直到新闻面 opening 被重新提升优先级

## Completed

- `prompt-grounding-and-hallucination-hardening-plan.md`
  - prompt stack / grounding baseline 已收口完成；后续前向 workstream 已转到 `hallucination-governance-and-grounded-generation-execution-plan.md`
- `intent-memory-acl-foundation.md`
  - identity / memory / authz foundation 已在 Phase 11 收口；后续如果重开 memory productization，应新建 follow-up lane
- `campus-identity-and-restricted-document-foundation.md`
  - principal taxonomy、authorization projection 与 restricted foundation 已关闭；剩余工作转向 deferred rollout / sunset follow-up
- `authenticated-notice-source-foundation.md`
  - source-channel foundation phase 已关闭；后续 source-triage / promotion 前向工作转到 `internal_notice` consumption plan 与对应 runbooks
- `public-chat-web-vendor-tech-debt-convergence.md`
  - closeout 已完成，保留完成态记录
- `campus-place-finding-foundation.md`
  - Wave E foundation code truth 已关闭；后续导航产品恢复已转到 `campus-navigation-rollout-map-consumption.md`

## Historical

- `supervisor-current-design-implementation.md`
  - 早期 supervisor implementation baseline；当前架构真相已转移到 supporting architecture 与 ADR
- `authenticated-notice-historical-backfill-closeout.md`
  - legacy cumulative-prefix closeout 对照文档；不再代表当前执行路径
- `local-live-eval-canonical-registry-recovery.md`
  - 一次 repo-local recovery / closeout 叙事；当前 live eval 真相已转移到 runbooks、reference 与 `.planning/`

## 使用规则

- `active` 表示当前可接手的 workstream 入口；多个 `active` 文档可以并行存在，由不同会话分别推进
- `deferred` 表示能力仍被接受，但当前没有活跃执行面
- `backlog` 表示能力仍被接受，但当前只保留 repo 级 registry 条目，不预建 native workstream 目录
- `completed` 与 `historical` 必须退出 `docs/README.md` 的默认入口
