---
doc_type: plan
status: deferred
created: 2026-04-19
updated: 2026-04-19
---

# Authenticated Notice Live Portal And Control Plane

## 文档边界

本文固定 `authenticated-notice live portal / authenticated control-plane` 这条单一 workstream 的前向范围：

- `authenticated_notice_portal` source-channel 的 repo-native collector runtime follow-up
- 需要认证态的 `notice` / `file_release` live capture、targeted rerun、incremental sync 与 scheduling
- source-channel run ledger、artifact refs、auth readiness、policy snapshot 与 operator control-plane
- live portal capture 与 historical export / bootstrap import 的 reconcile truth
- `authenticated_notice_portal` source-channel 内部 object-storage artifact contract 的持续收口

本文不负责：

- 替代 `docs/architecture/authenticated-notice-source-architecture.md` 的长期边界
- 把 `authenticated_notice_portal` collector 平台化成 repo-wide 通用 collector framework
- 把 `internal_notice -> regulations/*` downstream consumption 混进这条线
- 替代 `authenticated-notice file_release owner recovery` 对 `351119` 等 target-side owner body recovery 的 bounded 实施
- 把 shared object storage 语义改写成全局文件系统 / bucket 架构重构
- 把 restricted query-serving、release publish 或 authenticated document center 产品 rollout 混进这条线

## 当前生命周期状态

- 当前状态是 `deferred`
- 当前只是明确 authenticated source-channel 的后续入口，不表示认证窗口已恢复执行
- 它可以与其他独立 workstreams 并行存在；但这条线内部保持固定顺序，不再拆成并发 lane
- 当前 repo 的默认 active lanes 不包含这条 live portal / control-plane 扩面；任何当前仅为 `351119` 这类 bounded auth-window 任务，继续留在现有 `authenticated-notice file_release owner recovery` workstream

## 直接结论

`authenticated_notice_portal` 的后续工作不应拆成多条并发 workstream。

它必须作为一条 `authenticated-notice live portal / authenticated control-plane` workstream 推进，固定顺序如下：

1. collector runtime / repo migration truth refresh
2. auth bootstrap / live capture policy / scheduling
3. run ledger / artifact refs / auth readiness
4. live-historical reconcile for `notice` / `file_release`
5. operator control-plane / bounded source-channel APIs
6. planning closeout

原因固定为：

- 登录态复用、`notice` / `file_release` live capture、artifact refs、run ledger 与 control-plane 共享同一 source-channel truth
- 如果把 collector runtime、auth-window capture、scheduling、control-plane 拆成多条 lane，容易让 live capture 与 historical replay 长期维持两套 truth
- 这条线是 authenticated source channel 的延续，不是 `regulations/*` 下游语义面的延续；拆 lane 会诱导把 source-channel 欠账回塞到 downstream consumption 或 owner recovery 线里

## 前置真相

接手这条线之前，先以以下文档为准：

- `docs/architecture/authenticated-notice-source-architecture.md`
- `docs/architecture/authenticated-notice-source-truth-contract.md`
- `docs/domains/authenticated-notice.md`
- `docs/reference/authenticated-notice-portal-live-observations.md`
- `docs/reference/authenticated-notice-file-release-export-contract.md`
- `docs/plans/authenticated-notice-source-foundation.md`
- `.planning/PROJECT.md`
- `.planning/WORKSTREAMS.md`
- `.planning/workstreams/authenticated-notice-live-portal-control-plane/STATE.md`

## 固定执行规则

- repo-owned collector runtime 的第一 owner 继续是独立 `apps/*` shell，推荐落点仍为 `apps/authenticated-notice-collector`
- `notice` 与 `file_release` 继续是分离的 source surface；不得把 `file_release` export 伪装成 canonical `notice` source-truth
- collector 继续只负责 auth bootstrap / refresh、list/detail fetch、正文/附件增强、对象上传与 typed artifact 输出；`packages/ingestion-core` 与 `apps/ingestion-worker` 继续负责 bootstrap import、source-truth、document/chunk/index 语义
- object bytes 继续留在 `S3-compatible object storage`；不要把这条线扩写成 repo-wide object storage 文件架构重构
- 如果后续需要 operator control-plane，必须作为 authenticated-notice 自己的 source-channel domain 收口；不得复用 `official_web` command/query API，也不得让 `apps/ingestion-worker` 承担 collector control-plane
- 如果问题根因只落在 target-side owner body recovery、promotion/materialization 或 regulation target hardening，修复必须回到当前 active 的 `authenticated-notice file_release owner recovery` 或 `authenticated-notice -> regulation downstream consumption` workstream

## Phase A: Collector Runtime / Repo Migration Truth Refresh

目标：

- 确认 authenticated collector 的 repo-native runtime 边界没有漂移
- 固定 live `notice` / `file_release` capture 继续由 collector runtime 承接，而不是塞回 replay worker、临时脚本或下游 consumer

退出条件：

- `apps/authenticated-notice-collector` 的职责边界重新明确
- auth bootstrap / refresh、list/detail fetch、附件对象上传、typed artifact 输出的 owner 没有漂移
- collector repo migration 不再依赖未落盘的 donor 假设

## Phase B: Auth Bootstrap / Live Capture Policy / Scheduling

目标：

- 补齐认证窗口内的 `auth:check`、live capture policy、targeted rerun、incremental sync 与 scheduling contract
- 让需要认证信息才能运行的内部采集器，明确成为这条 workstream 的标准组成部分，而不是 repo 外隐性依赖

退出条件：

- `notice` / `file_release` 的 live capture policy 已明确
- targeted capture、incremental sync 与 scheduled run 的边界都已落盘
- 认证态依赖不再被写成“临时人工操作”或“以后再说”的隐性前提

## Phase C: Run Ledger / Artifact Refs / Auth Readiness

目标：

- 为 authenticated source-channel 补齐 run ledger、artifact refs、policy snapshot、auth readiness 与失败分类
- 让 live run、targeted rerun 与 source artifacts 可以稳定回链

退出条件：

- source-channel run truth 有明确 owner
- `auth readiness`、capture status、artifact pointers 与 failure taxonomy 可追溯
- live portal 执行不再只靠外部脚本日志或人工记忆复原

## Phase D: Live-Historical Reconcile For `notice` / `file_release`

目标：

- 收口 live portal capture 与 historical export / bootstrap import 的 reconcile 语义
- 确保同一条 `notice` / `file_release` 不会因为 live lane 与 historical lane 并存而形成两套 truth

退出条件：

- live capture 与 historical export 的 dedupe / replay / reconcile contract 已明确
- `notice` 与 `file_release` 的 source identity 在两条入口之间保持一致
- 当前 downstream workstreams 不需要继续吸收 source-channel reconcile 欠账

## Phase E: Operator Control Plane / Bounded Source-Channel APIs

目标：

- 为 authenticated notice source-channel 补齐 bounded operator read model、触发入口与审计视图
- 让 operator 可以看见 run、artifact、auth readiness 与 capture outcome，而不是直接面向 object storage、SQLite 或原始导出文件

退出条件：

- 已有最小 operator control-plane contract
- control-plane 仍是 source-channel operator surface，而不是数据库控制台、对象存储浏览器或万能后台
- 它与当前 `official_web` / shared product surfaces 的边界没有新的 ownership 漂移

## Phase F: Planning Closeout

目标：

- 把 authenticated live portal / control-plane 的最终状态写回 planning truth，并关闭 reopen 语义漂移

退出条件：

- `.planning/PROJECT.md`、`.planning/WORKSTREAMS.md`、`.planning/workstreams/authenticated-notice-live-portal-control-plane/STATE.md` 与相关 reference 文档已更新
- 已明确记录哪些能力已恢复、哪些仍 default-off、哪些仍依赖认证窗口
- 不把一次局部 auth-window 成功误写成整条 workstream 已完成

## 接手标准

其他会话接手这条线时，默认按以下顺序开始：

1. 先检查 `.planning/WORKSTREAMS.md` 与 `.planning/workstreams/authenticated-notice-live-portal-control-plane/STATE.md`，确认这条线是否仍处于 `deferred`
2. 如果只是恢复执行，不要直接跳到某个局部 targeted capture；先从 collector runtime、live capture policy 与 run truth 当前真相开始核对
3. 完成后再更新 `.planning/PROJECT.md`、`.planning/WORKSTREAMS.md`、`.planning/workstreams/authenticated-notice-live-portal-control-plane/STATE.md`、domain index 与相关 reference 文档
