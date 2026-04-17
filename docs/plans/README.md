---
doc_type: index
status: active
created: 2026-04-12
updated: 2026-04-12
---

# Plans

`plans/` 只保留仍对前向实施有指导价值的计划文档。
当前 active execution order 仍以 `.planning/PROJECT.md` 和 `.planning/STATE.md` 为准；这里负责说明哪些计划还应被继续引用。

## Active

### Current implementation lane

- `hallucination-governance-and-grounded-generation-execution-plan.md`

### Data plane / quality / source channels

- `internal-notice-policy-regulation-consumption-implementation.md`

## Deferred

- `operator-observability-control-plane-foundation.md`
  - operator observability control plane 的长期方向已接受，但当前没有独立 active execution wave；与 observability expansion 相关的当前工作以 Phase 15 与项目级 planning 为准
- `protected-panel-requests-triage-table-redesign.md`
  - panel `Requests` 分诊台重构仍保留为 follow-up 计划，但当前未进入默认 active lane
- `golden-dataset-execution-plan.md`
  - eval / golden dataset 的后续扩样与治理仍有价值，但当前没有独立 active execution wave
- `restricted-document-rollout-and-verification.md`
  - restricted rollout 方向仍被接受，但当前 restricted collections 默认仍处于 `offline_preparation`，没有独立 active execution wave
- `legacy-acl-carrier-compatibility-sunset.md`
  - canonical vocabulary 主路径已收口，但 shared contract / persisted payload canonicalization / fixture vocabulary 仍有 residue；当前没有单独 active wave 持续清债
- `post-closeout-follow-up-execution-plan.md`
  - Wave A/B/D/E 主体收口已完成；当前只保留 provider-blocked 或后置 reopen follow-up
- `versioned-history-query-foundation.md`
  - 能力仍在 target architecture 内，但当前没有 active execution wave

## Completed

- `prompt-grounding-and-hallucination-hardening-plan.md`
  - prompt stack / grounding baseline 已收口完成；当前默认 active lane 已切到 Phase 15 grounded-generation follow-up
- `intent-memory-acl-foundation.md`
  - identity / memory / authz foundation 已在 Phase 11 收口；后续如果重开 memory productization，应新建 follow-up lane
- `campus-identity-and-restricted-document-foundation.md`
  - principal taxonomy、authorization projection 与 restricted foundation 已关闭；剩余工作转向 deferred rollout / sunset follow-up
- `authenticated-notice-source-foundation.md`
  - source-channel foundation phase 已关闭；后续 source-triage / promotion 前向工作转到 `internal_notice` consumption plan 与对应 runbooks
- `public-chat-web-vendor-tech-debt-convergence.md`
  - closeout 已完成，保留完成态记录
- `campus-place-finding-foundation.md`
  - Wave E foundation code truth 已关闭；后续 follow-up 转向 seed 扩面与 staging 验收

## Historical

- `supervisor-current-design-implementation.md`
  - 早期 supervisor implementation baseline；当前架构真相已转移到 supporting architecture 与 ADR
- `authenticated-notice-historical-backfill-closeout.md`
  - legacy cumulative-prefix closeout 对照文档；不再代表当前执行路径
- `local-live-eval-canonical-registry-recovery.md`
  - 一次 repo-local recovery / closeout 叙事；当前 live eval 真相已转移到 runbooks、reference 与 `.planning/`

## 使用规则

- `active` 才能继续作为默认实施入口
- `deferred` 表示能力仍被接受，但当前没有活跃执行面
- `completed` 与 `historical` 必须退出 `docs/README.md` 的默认入口
