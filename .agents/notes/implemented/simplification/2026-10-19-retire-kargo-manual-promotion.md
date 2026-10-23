# Agent Note: 退役 Kargo manual 晋级通道

Status: implemented

## 背景

[无 UI Kargo 发布编排](../process/2026-10-13-kargo-headless-release.md)在 staging 之外定义了第二条
Kargo 通道：`manual` Warehouse 订阅 `candidates/manual`，`manual` Stage 关闭自动晋级，用于把 Source
正式版本（formal release）人工晋级到 staging。配套机制包括 `formal-release.yml` 的
plan/pause/select/resume 操作、`release/enable-manual` 启用 PR、首次正式选版后把 manual 资源加入
Kustomize 的 opt-in 设计，以及 `authorized-stage` 注解对 `campus-agent-delivery:manual` 的授权。

该通道从未被使用：`candidates/manual` 分支从未在远端存在（`publishManualCandidate` 会在首次成功
select 时创建它），Source 仓库没有发布过任何正式版本（0 release、0 tag），`release/enable-manual`
与 pause/resume 分支也从未创建过。

设计上它的两个职责都已有独立承担者：人工把关由 pause/resume 对 ProjectConfig
`autoPromotionEnabled` 的修改提供；"已验证组合"的保存由 `publish` 创建的 immutable Release 和
candidate 内的完整 `formalRelease` 提供。manual Stage 本身只是放行槽位，且其生成的步骤把选版 PR
分支与 Deployment 查询都写死为 `deploy/staging/` 与 `environment=staging`，与 staging Stage 共用
同一命名空间，宣称的通道隔离并未实现。

正式版本的人工审批是以后才需要的能力，届时的形态是检测人工打的 tag 后产出正式版本，与现在的
`workflow_dispatch` + deployment_id 入口无关。

## 决策

从 GitOps 退役 manual 晋级通道的完整链路：

- 生成器不再产出 `manual-warehouse.yaml` 和 `manual-stage.yaml`，两个文件删除；`policy.yaml` 只保留
  staging 的 promotionPolicy。
- `authorized-stage` 注解只授权 `campus-agent-delivery:staging`。
- execute 任务的 `candidateBranch` 变量及其 workflow dispatch 输入删除——它存在的唯一目的就是在
  manual 通道下选择 `candidates/manual`，单通道下是常量。
- `release-command.ts` 删除 plan/select/pause/resume 操作及 `publishManualCandidate`、
  `enableManualResources`、`pauseSelection`、`policyPr`、`resumePromotion`、`schemaCompatibility`、
  `report`；保留 publish、retire、roots。
- `formal-release.yml` 只保留 retire 操作。
- retention 的候选遍历只走 `candidates/staging`；正式版本的保留根逻辑保留（未退役正式版本仍在
  保护范围内，当前没有数据）。
- release-status 不再报告 manual 启用状态。
- 环境仓交付手册删除手动晋级章节、manual Promotion 示例和 plan/pause/select/resume 表行。

保留的部分：`publish`（从成功 Deployment 导出并发布 immutable Release）、`retire`
（`releases/retired.json`）、retention roots 计算（部署/恢复根、当前选择根、staging 候选边界）、
`prepareSelection` 对 `formalRelease` candidate 的选择支持、Kargo 完成状态对
`formalRelease.sourceSha` 的回退。这些属于正式版本产物机制，与晋级通道正交，且 `roots` 被 Source
的每日 `ghcr-retention` 定时任务消费。

## 未采用方案

### 同时退役正式版本产物机制（publish/retire/roots）

拒绝。`roots` 是 Source `ghcr-retention` cron 任务的必需输入，删除它需要跨两仓同步改造一个每日运行
的 GHCR prune 任务；且正式版本从未发布过，"保护未退役正式版本"分支当前是空操作，删除不改变 retention
行为，只有代码行数收益。未来 tag 触发的正式版本入口本来就要重写 publish，届时一并调整。

### 保留 manual 资源定义以备将来

拒绝。从未运行的代码不是低风险资产：生成器强制生成它们、CI 强制校验、24 个 argocd-update 步骤的
权限注解需要随受控应用列表同步维护。未来需要人工晋级通道时按当时的实际形态（tag 触发、审批方式）
重新设计，比恢复一条隔离未实现、职责可替代的旧通道更直接。

## 后果

- `formal-release.yml` 只剩 retire；发布正式版本仍走 Source `formal-release.yml` dispatch GitOps
  `publish-formal-release.yml`，不受影响。
- `candidates/manual` 若未来出现（不会有历史数据），retention 的 `for-each-ref` 守卫已随通道删除，
  不再被扫描。
- 未来接入 tag 触发的正式版本人工审批时，重新设计晋级入口；本笔记记录的保留边界（publish/retire/
  roots 与 `formalRelease` candidate 支持）是那时的起点。
