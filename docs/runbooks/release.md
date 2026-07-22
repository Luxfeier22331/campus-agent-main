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

源码仓负责构建、测试、扫描并发布带完整源码身份的候选物。环境仓负责选择镜像、Worker version、
Cloudflare version、配置和其他环境资源。候选物发布成功不表示环境已经部署。

## 候选物发布

1. 确认目标源码已经合入 `main`，且该变更要求的 PR 检查通过。
2. 由当前 workflow 发布受影响的不可变候选物；触发条件、输入和产物以 `.github/workflows/`
   为准。
   Worker 候选发布前，`release-config` 会使用 `CLOUDFLARE_AUTOMATION_TOKEN` 验证目标账户的
   Wrangler 认证。镜像、Worker 和 Kubernetes 清单是独立候选面；一个候选面的配置失败不得阻止
   其他已验证候选物的构建和环境仓交接。
3. 检查候选物记录的源码提交、摘要和构建身份，不用可变标签或重复构建覆盖已有产物。
4. 生成或更新环境仓变更，由环境仓选择完整的一组运行版本。

Campus Web 的不可变 Worker version 已固化对应 `docsReleaseId`，环境仓只选择 Worker version，
不维护第二份文档 release 指针。具体不变量见 `docs/contracts/document-reader-publish.md`；发布和
物化命令见 `jobs/docs-publish/README.md`。

## 环境交接

合并环境仓变更前，检查：

- 所有候选物均来自同一预期源码版本，且引用不可变；
- 环境配置、凭据消费合同、数据库变更和网络边界完整；
- 可登录数据库角色、Secret、migration 和依赖它的 workload 位于同一发布 Application，且
  migration 是低于 workload 的 `Sync` hook；
- 渲染结果和控制器计划只包含预期资源；
- 回滚目标及其依赖仍可用。

合并后等待环境仓定义的 reconcile、migration、rollout 和 readiness 完成。不得绕过环境仓直接
修改集群、流量或线上 Secret。

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
- 某次 `main` 发布在产物或 promotion 前失败，且后续提交已进入 `main`：手动运行
  `staging-candidate-publish`，设置 `validate_only=false`，并把失败范围之前的完整 commit SHA
  作为 `replay_base_sha`。workflow 会重新计算该 SHA 到当前 `main` 的受影响发布面；不能用
  任意分支、非祖先提交或零 SHA 代替；
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
