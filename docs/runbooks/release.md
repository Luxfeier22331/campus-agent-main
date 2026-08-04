---
doc_type: runbook
owner_boundary: runtime-release
status: active
---

# 发布

## 边界

本文说明源码候选物如何交给环境仓并进入 staging 或 production。分支和贡献流程见
`CONTRIBUTING.md`，验证命令见 `docs/reference/verification.md`，环境部署及恢复命令由环境仓
操作手册维护。

## 发布链

```text
main 中已验证的源码
-> 不可变候选物
-> 环境仓变更
-> 环境控制器应用期望版本
-> 受影响用户路径验收
-> production 选择
```

源码仓负责构建、测试、扫描并发布带完整源码身份的候选物。环境仓负责选择镜像、Cloudflare
Worker version、配置和其他环境资源。候选物发布成功不表示环境已经部署。

## 候选物发布

1. 确认目标源码已经合入 `main`，且该变更要求的 PR 检查通过。
2. 当前 workflow 从环境仓游标计算累计影响面，发布受影响的不可变候选物；PR 已拥有源码、合同、
   disposable 数据库和浏览器证据，main 候选不重复运行这些 profile；
   触发条件、输入和产物以 `.github/workflows/` 为准。App API 与 Campus Web 在各自的候选任务中
   完成 Worker 配置预检；镜像、两个 Worker 和 Kubernetes 清单分别产生候选物。一个候选面的发布
   失败不使已经成功发布的候选物失效，但本次不会创建不完整的 GitOps 提升；同一源码提交重试时应
   直接复用已有候选物。
3. 检查候选物记录的源码提交、摘要和构建身份，不用可变标签或重复构建覆盖已有产物。
4. 在环境仓 checkout 中运行 `pnpm gitops promote-source`，校验读取时的 staging 游标仍未前进，
   只更新 staging root 已注册的活跃 Application。创建或更新唯一 `deploy/staging` PR 前先渲染受
   影响的 Kubernetes 期望状态；环境仓 PR 再完成仓库级检查和受影响的 Terraform、Helm 检查，确认
   只含机器版本字段后由受信任 GitHub App 自动 squash merge。

发布基线来自环境仓 `releases/staging.json`，不是 workflow 触发事件的前一个提交。镜像和 Cloudflare Worker
影响面由 Turbo package graph 与 package 外部 task input 计算，Kubernetes 由 `infra/k8s` 所有者范围
计算。当前 staging 自动候选只包含已注册活跃 Application 消费的 `agent-runtime`、
`app-api-schema`、`execution-control`、`ops-web`、App API Worker、Campus Web Worker 与 Kubernetes
source。采集运行时
当前未部署到 staging，因此 `ingestion-control`、`ingestion-control-worker` 和 `source-collector`
不会被候选发布自动构建。`docker-bake.hcl` 中未进入候选映射的 Dining 和 docs 镜像只按明确发布需求
手动构建。

发布 workflow、路径配置、Bake 文件或发布适配器本身的变化只运行静态检查、适配器测试和 Bake
解析，不自动重建所有运行时镜像。需要昂贵的完整回归时，从 `manual-validation-profile` 一次选择
一个明确 profile；候选 planner 始终按 Source 与 GitOps 游标的实际 diff 选择制品，不提供隐式全量
候选开关。

制品构建和环境仓交接分别由所属 workflow job 维护超时，不在 runbook 重复写入总等待阈值。调度等待
应单独记录，以区分容量与任务耗时。镜像在 GitHub-hosted ARM64 runner 上原生构建，通过 GHCR
registry cache 跨临时 builder 复用层。发生超时时先检查缓存命中、重复安装和发布计划。一次手动选择
的昂贵 profile 在冷缓存下仍无法在 workflow 超时内完成时，应缩小任务输入或明确增加构建容量。已经
发布的不可变镜像会在同一源码提交的重试中直接复用。

Campus Web 的 staging publisher 在 main/artifact lane 读取固定来源键
`campus-docs/source.json`，核对来源对象并生成静态文档；它使用 Source staging Environment 提供的
公网 `OBJECT_STORE_ENDPOINT` 和对象存储只读身份，不依赖集群网络，也不增加 Cloudflare Access
调用方准入。构建进程内部继续使用通用 derived 变量名。来源清单的 `sourceDigest` 只
记录在构建和候选元数据中；正常开发、构建和部署不传递手工文档版本标识。它不能注入 Worker 运行
变量或成为独立环境选择。Campus Web 构建或对象存储读取失败只阻止该候选，promotion 不接受缺失的
已选择 Worker 候选。

需要在源码差异没有选中 Campus Web 时重新读取当前文档来源，可手动运行
`staging-candidate-publish`，选择 `candidate_scope=campus-web-docs` 并关闭 `validate_only`。该输入只把
活跃的 `campus-web-staging` 加入正常累计差异的候选集合，不扩大制品或验证 profile；它不能与
validation-only 模式组合。

PR 的 `affected-node` 会先读取 Turbo 影响面，再执行普通包构建；Campus Web 在 PR 中只执行现有的
`build:worker` 确定性测试构建，不访问对象存储。真实文档页面构建只由 main/artifact lane 中独立的
Campus Web publisher 完成。

## 环境交接

常规 staging 版本 PR 只允许修改 Source ref、镜像 digest、Cloudflare Worker version、发布标识、Application
Source SHA 注解和 staging 游标；这些字段由环境仓策略检查并自动合并。以下变化必须使用普通短期分支
并由人员审查：Secret、权限、资源、网络、Terraform、workflow、Application 拓扑和 production。

人工环境变更合并前，检查：

- 所有候选物均来自同一预期源码版本，且引用不可变；
- 环境配置、凭据消费合同、数据库变更和网络边界完整；
- 强依赖数据库结构的角色、Secret、migration 和 workload 位于同一发布 Application；嵌入宿主的
  可选领域能力则由领域 Application 拥有 schema、专用角色和授权，宿主只作 optional 消费；
- 渲染结果和控制器计划只包含预期资源；
- 回滚目标及其依赖仍可用。

合并后等待环境仓定义的 reconcile、migration、rollout 和 readiness 完成。不得绕过环境仓直接
修改集群、流量或线上 Secret。

数据库安装、迁移和授权 Job 使用 `sync-wave: -1`，并作为 Argo CD 跟踪的期望资源保留完成状态。
它们通过 `Force=true,Replace=true` 在清单或镜像变化时删除重建，使制品变化本身能够触发同步并在
后续 workload 前完成。不得把这类 Job 改成成功后删除的 Sync hook；删除 hook 后，Application revision
可能在没有执行新迁移的情况下前移。

## Staging 验收

环境达到期望 revision 后，根据本次变更选择 `docs/runbooks/e2e.md` 中的真实用户路径。验收必须
使用环境实际选择的版本、正式认证方式和已发布数据，不能用本地 fixture 或候选物存在代替。

失败时先区分源码缺陷、环境配置缺陷、外部服务故障和缺少可选数据，再在相应所有者处修复。
不通过放宽断言、跳过认证或手工修改集群完成验收。

## Production 发布

production 只选择已合入 `main` 的提交或其 release tag。发布前确认：

- 本次要求的 staging 用户路径已通过；
- production 的审批、部署和回滚入口可用；
- 所有不可变产物及依赖仍可取得；
- 环境仓选择的版本与批准版本一致。

生产发布和回滚按环境仓操作手册执行。源码仓不保存一次发布的截图、私有地址或环境状态。

## 失败处理

- 候选物发布中断：对同一源码提交重试缺失步骤，不覆盖已存在的不可变产物；
- Worker version 操作失败时，发布脚本保留 Wrangler 的退出码、signal 和脱敏后的 stderr；先按该错误区分凭据、网络或响应格式问题，不切换旧 Token，也不把失败伪装成候选物成功；
- 某次 `main` 发布在产物或 GitOps 交接前失败：从当前 `main` 手动重跑
  `staging-candidate-publish`，设置 `validate_only=false`；这只重算环境仓游标到当前 Source 的实际
  diff，不触发全量候选，且 workflow 不接受人工基线；
- 环境计划失败：修复环境仓变更，不强制同步；
- migration 或 rollout 失败：使用环境仓定义的恢复路径回到已知版本；
- 用户路径失败：记录关联标识，按最先失败的组件定位并重新执行受影响路径。

任何恢复都不能改用可变标签、绕过环境仓或把健康检查成功当成产品路径已经恢复。

## 相关文档

- `docs/architecture/system/runtime-release.md`
- `docs/runbooks/e2e.md`
- `docs/environment/readiness.md`
- `docs/decisions/adr-0065-gitops.md`
- `docs/decisions/adr-0074-repository-boundary.md`
- `docs/decisions/adr-0083-promotion.md`
