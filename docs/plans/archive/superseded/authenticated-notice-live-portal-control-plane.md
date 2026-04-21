---
doc_type: plan
status: superseded
created: 2026-04-19
updated: 2026-04-22
---

# Authenticated Notice Live Portal And Control Plane

## 文档边界

本文固定 `authenticated-notice live portal / authenticated control-plane` 这条 deferred workstream。

它负责：

- `authenticated_notice_portal` source-channel 的 repo-native collector follow-up
- 认证态 `notice` / `file_release` live capture、targeted rerun、incremental sync 与 scheduling
- run ledger、artifact refs、auth readiness、source-channel operator control-plane
- live capture 与 historical export / bootstrap import 的 reconcile truth

它不负责：

- non-auth `internal_notice -> regulations/*` downstream hardening
- target-specific bounded owner recovery
- repo-wide object-storage 架构重写
- restricted query-serving 或 document-center rollout

## Lifecycle Contract

- 文档 lifecycle 保持 `deferred`
- 本文只保留 source-channel phase order、固定边界与排除项
- auth window 状态与执行进度只写在 `.planning/WORKSTREAMS.md` 与对应 workstream `STATE.md`

## Current Baseline

当前 merged truth 已固定的前提：

- authenticated source foundation 已关闭，live portal follow-up 仍未 reopen
- `notice` 与 `file_release` 继续是分离 source surface
- collector 继续只负责 auth bootstrap、fetch、对象上传与 typed artifact 输出
- ingestion / replay / promotion 语义继续归属 `packages/ingestion-core` 与 `apps/ingestion-worker`
- bounded owner recovery 继续留在独立 workstream

## Execution Contract

这条线始终按一条 auth-dependent workstream 推进：

1. collector runtime truth refresh
2. auth bootstrap / live capture policy / scheduling
3. run ledger / artifact refs / auth readiness
4. live-historical reconcile
5. bounded operator control-plane
6. planning closeout

固定原因：

- 登录态复用、live capture、artifact refs、run ledger 与 operator surface 共享同一 source-channel truth
- 若拆 lane，live capture 与 historical replay 很容易长期维持两套 truth

## Fixed Rules

- repo-owned collector runtime 的第一 owner 继续是独立 `apps/*` shell
- `file_release` export 不得伪装成 canonical `notice` source-truth
- object bytes 继续留在 `S3-compatible object storage`
- operator control-plane 只能作为 authenticated notice 的 source-channel bounded surface，不得复用 `official_web` owner

## Forward Phases

### Phase A: Collector Runtime Truth Refresh

目标：

- 固定 collector 的 repo-native runtime 边界

### Phase B: Auth Bootstrap / Live Capture Policy / Scheduling

目标：

- 固定认证窗口内 live capture、targeted rerun 与 schedule contract

### Phase C: Run Ledger / Artifact Refs / Auth Readiness

目标：

- 为 authenticated source-channel 建立可追溯的 run truth

### Phase D: Live-Historical Reconcile

目标：

- 收口 live lane 与 historical lane 的 dedupe / replay / reconcile 语义

### Phase E: Bounded Operator Control Plane

目标：

- 为 run、artifact、auth readiness 提供 bounded operator read model

### Phase F: Planning Closeout

目标：

- 把 reopened 能力、default-off 能力与认证依赖写回 planning

## Exclusions

固定不包含：

- regulation downstream consumption
- source-wide replay / materialization
- query-serving opening

## Handoff Rule

后续接手时：

1. 先看 `.planning/WORKSTREAMS.md`
2. 再看对应 workstream `STATE.md`
3. 最后回到本文确认 source-channel 顺序与排除项
