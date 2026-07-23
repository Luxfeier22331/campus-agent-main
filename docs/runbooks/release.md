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
   `release-config` 会在昂贵构建前验证 Worker 凭据和文档 release 等共同前提。预检通过后，镜像、
   Worker 和 Kubernetes 清单分别产生不可变候选物；一个候选面的发布失败不使已经成功发布的候选物
   失效，同一源码提交重试时应直接复用它们。
3. 检查候选物记录的源码提交、摘要和构建身份，不用可变标签或重复构建覆盖已有产物。
4. 生成或更新环境仓变更，由环境仓选择完整的一组运行版本。

候选发布从 workflow 创建，到生成环境仓变更或返回可处理失败为止，总等待上限为 20 分钟。调度等待
计入总等待，并单独记录以区分容量与任务耗时。单一 ARM64 Runner 依靠受影响面选择、不可变标签复用和
固定 BuildKit builder 的本地热缓存完成发布；registry cache 只用于 builder 丢失后的恢复。超过上限
时先检查缓存命中、重复安装和发布计划，不能通过提高超时或解除 2 GiB 内存限制解决。冷缓存全量构建
仍无法满足时，必须增加构建容量。已经发布的不可变镜像会在同一源码提交的重试中直接复用。

`release-config` 必须在镜像构建前完成 Worker 凭据、`DOCS_RELEASE_ID` 和对象存储 release 校验，避免
已知配置错误在昂贵构建结束后才暴露。Campus Docs publisher 生成 release 后，将其完整内容摘要写入
源码仓库 Actions variable `DOCS_RELEASE_ID`；手动发布可以用同名 workflow input 覆盖本次候选。

Campus Web 的不可变 Worker version 会固化对应 `docsReleaseId`，环境仓只选择 Worker version，
不维护第二份文档 release 指针。具体不变量见 `docs/contracts/document-reader-publish.md`；发布和
物化命令见 `jobs/docs-publish/README.md`。

## 环境交接

合并环境仓变更前，检查：

- 所有候选物均来自同一预期源码版本，且引用不可变；
- 环境配置、凭据消费合同、数据库变更和网络边界完整；
- 强依赖数据库结构的角色、Secret、migration 和 workload 位于同一发布 Application；嵌入宿主的
  可选领域能力则由领域 Application 拥有 schema、专用角色和授权，宿主只作 optional 消费；
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
