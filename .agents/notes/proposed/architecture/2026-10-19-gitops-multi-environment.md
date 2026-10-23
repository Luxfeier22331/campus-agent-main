# Agent Note: GitOps 多环境与多副本准备

Status: proposed

## 背景

GitOps 仓库只有 staging 一个环境，环境名硬编码在目录（`clusters/staging`、`cloudflare/staging`、
`releases/staging*.json`）、发布工具（`generate-kargo.ts`、`scope.ts`、`kargo-release.ts`）、
`kargo-execute.yml` 和 Kargo Stage 中。单节点集群的约束（删除 PodDisruptionBudget、`maxSurge: 0`、
固定一个副本）也分散在各 overlay 和 Source base 里。新增环境或在某个环境提高副本数时，需要复制目录并
逐个修改工具代码，没有一处表达“环境差异”。

staging 已把 SealedSecret wave、GHCR pull secret 与单副本滚动更新收敛为
`clusters/staging/components/` 下的 Kustomize Component，每个 Application 文件直接声明项目、删除
策略与同步所有权；本提案在此基础上继续。曾评估 kro，因其 API 仍为 alpha、缺少版本固定与渐进发布，
且与 Kargo 的晋级模型重叠，不引入。

## 提案

- 环境成为参数：工具从环境清单读取环境名、集群、AppProject 前缀与 Terraform root，不再在代码中写
  `staging`；目录调整为 `clusters/<env>/`、`cloudflare/<env>/`、`releases/<env>/`，共享 Component 上移到
  `clusters/components/`。
- 每个环境的 child Application 由一个 ApplicationSet 生成，环境差异来自生成器参数；Application 的
  项目、删除策略和同步所有权仍是生成结果中的显式字段，由 Conftest 检查。
- Kargo 每个环境一个 Stage，共享一个 PromotionTask，环境差异作为 `vars`；下游环境从上游 Stage 的
  Freight 晋级，复用同一份发布计划格式。
- 单节点约束成为按环境引用的 Component（`single-replica-rollout`、删除 PDB）；Source base 不固定
  `replicas`，副本数由环境 overlay 声明，多副本环境不引用单节点 Component 并保留 PDB。
- 迁移按目录逐步进行，每一步保持 staging 渲染结果不变。

## 未采用方案

### 复制 staging 目录作为新环境

最快，但工具代码仍只认识 staging，环境之间的差异无法审查，修复需要在每份副本重复。

### 引入 kro 组合资源

kro 能把一组资源抽象为一个 API，但当前为 v1alpha1，没有实例版本固定与渐进发布，默认 RBAC 为
unrestricted，Argo CD 健康检查尚未进入当前版本；晋级顺序仍需 Kargo 承担，收益不足以抵消新控制面。

### 用 Helm 包装第一方 workload 以参数化环境

与 [GitOps](../../implemented/process/2026-07-16-gitops.md) 中“第一方 workload 默认使用 Kustomize base”
的决定冲突；Component 与 overlay 已能表达当前差异。

## 可观察结果

- 新增一个环境只需要新增环境清单条目、环境目录与 Stage `vars`，不修改发布工具代码。
- staging 在每个迁移步骤后的 Application 与 overlay 渲染结果与迁移前一致。
- 某个环境提高副本数只修改该环境 overlay，不修改 Source base。

## 风险

- 移动 Application 文件或改名会让 root 认为旧 Application 被删除；`cascade` 策略的 child 会连同资源
  被删除。迁移必须保持 Application 名称不变，或先改为 `manual` 再移动。
- ApplicationSet 会把生成结果写回 Application；需要确认它不会覆盖 Kargo 发起的同步操作，以及
  `automated.enabled: false` 与 ignore-healthcheck 注解在生成结果中保留。
- Source base 移除 `replicas` 后，未声明副本数的 overlay 回到 Kubernetes 默认的一个副本；多副本环境
  必须在引用新 base 的同一次 GitOps 变更中声明副本数。
