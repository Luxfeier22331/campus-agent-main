# Agent Note: Staging 版本选择

Status: implemented

## 背景

源码仓与环境仓分离后，每次 `main` 候选都创建独立环境 PR，并以触发提交的前一个 SHA 计算变化。
单 Runner 的 pending workflow 可能被后续提交替换，导致中间变化不再进入任何发布范围；要求开发者
逐个审查纯版本字段，也把常规 staging 发布变成了人工队列。`replay_base_sha` 只能人工补偿该问题，
不能提供稳定顺序。

## 决策

GitOps 仓库用 `releases/staging.json` 保存已经选择的 Source `main` SHA。Source 发布始终比较该游标
与当前 `main`，由 Turbo package graph 选择累计受影响候选，并更新唯一 `deploy/staging` PR。

GitOps 默认分支中的受信任 workflow 只在以下条件全部满足时自动 squash merge：PR 由指定 GitHub
App 创建、head 是当前已通过 `validate` 的提交、Source SHA 属于 Source `main`，且结构化差异只包含
Source ref、镜像 digest、Worker version、发布标识、Application Source SHA 注解和 staging 游标。

Secret、权限、资源、网络、Terraform、workflow、Application 拓扑和其他环境变化不属于机器版本
选择，继续由人员审查。Source CI 不直接写 GitOps `main`，也不直接操作集群或流量。

Source workflow 使用受信任 GitHub App 创建 promotion PR；调用 PR action 的 Git 环境固定为
`LC_ALL=C`，避免 self-hosted runner 的本地化 Git 输出导致 action 错误恢复不存在的 stash。

当发布制品已经成功但 promotion job 失败时，workflow 提供显式 recovery 输入，按指定的 Source
run ID 与 Source SHA 复用已上传的 image/Worker artifacts，只执行 promotion 和验证；普通 push 与
常规手动发布仍会重新构建制品。两个 recovery 输入必须成对提供：只给 Source SHA 会造成镜像内容与
GitOps 溯源注记错位，只给 run ID 则无法验证制品归属，release-plan 与 promote 都会对不成对的输入
fail-fast。提供 recovery run ID 即视为确认 promotion，无需再单独打开 promote 开关；发布 run 的
image/Worker artifacts 保留 7 天，维持可实际使用的恢复窗口。

## 未采用方案

### 每个源码提交等待人工合并

拒绝。它不能在单 Runner 合并和替换 pending run 时保证完整顺序，并把低风险机械字段变成日常人工
操作。

### Source CI 直接更新环境仓主分支

拒绝。它绕过环境仓校验和可审查期望状态，使构建凭据同时拥有部署决定权。

### 增加集群内发布控制器

拒绝。当前单一 staging 环境不需要 Kargo、Flux 或 Argo Image Updater；GitHub App、GitOps PR 和
Argo CD 已能形成清晰闭环。

## 后果

- 被替换的 pending workflow 不会漏掉变化，后续运行会从已选择游标重新计算累计范围；
- staging 常规版本选择保留 PR 审计记录，但不要求开发者重复批准机器字段；
- Argo CD 与 Cloudflare 将各自结果写到被选择的 Source SHA，不以候选构建或 PR 合并代替运行状态；
- 手动重跑只能处理当前 `main`，不接受人为指定发布基线；
- 若后续启用 production，其选择仍由 release tag、GitHub Environment 和环境仓变更控制。
