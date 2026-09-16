# Agent Note: 源码仓库与环境仓库边界

Status: implemented

## 背景

应用仓库需要能够公开并被其他机构复用。可复用的 Kubernetes 工作负载基础配置与真实环境的
应用选择、参数、机器覆盖、网络坐标和加密凭据清单具有不同的变更边界。把两者放在同一事实源
会暴露环境拓扑，并产生重复的部署期望状态。

## 决策

应用源码与已部署 Kubernetes desired state 分仓管理。

应用源码仓库负责：

- application、job 与 package source；
- 稳定 runtime 与 secret-consumption contract；
- namespace-neutral first-party Kustomize base，包括完整 Pod/Job 行为、稳定 Secret key 合同和
  应用级 NetworkPolicy；
- image build、scan、SBOM 与 immutable SHA-tag publication；
- Cloudflare Worker build 与不改变 traffic 的 immutable version upload。

每个部署环境仓库负责：

- Argo CD root 与 child Application；
- environment overlay、namespace、resource sizing 与 network coordinate，但不重写第一方
  command、安全上下文或数据库连接组装；
- 固定版本的 third-party Helm chart 与 value；
- strict-scope SealedSecret 与 environment trust anchor；
- first-party image digest 与完整 source commit SHA；
- Cloudflare 非 secret 基础设施、Worker version selection 与 traffic；
- Terraform remote state 与从环境派生的 public GitHub variable；
- 环境专用 rollout 与 cluster verification。

Cloudflare 不由 Argo CD 管理。应用仓库上传 immutable Worker version；环境仓库使用 Terraform
选择 version、管理 traffic 并 reconcile Cloudflare infrastructure。Worker 独占 secret 只进入
Cloudflare Worker secret store，不复制到 Terraform state 或 Kubernetes Secret；确需由
Kubernetes 调用方和 Worker 验证方共同持有的跨运行时认证凭据，按 [Secret 投递](./2026-07-04-secret-delivery.md) 分别投递并作为同一
轮换单元。

本次分仓不重写现有私有源码历史。首次公开发布必须从单独审查的 sanitized snapshot 产生，并
通过 history-level secret 与 topology review。

## 未采用方案

### GitOps state 全部留在应用仓库

拒绝。该方案暴露私有拓扑，将开源发布绑定到环境清理，并混淆可复用源码与单一运维环境的
所有权。

### CI 直接生成 manifest，不使用环境仓库

拒绝。该方案失去可审查 desired state，并让 CI credential 代替 Argo CD reconciliation 成为
部署事实。

### 应用 CI 直接写环境仓库 `main`

拒绝。该方案绕过 review，并把一次成功 image build 直接变成未审查的 cluster change。

## 后果

- 应用仓库不再包含 `infra/gitops`、真实 environment overlay、Helm deployment value 或
  SealedSecret；
- 通用 Kustomize base 不创建 Namespace、不选择 environment ConfigMap 或 mutable image tag，
  也不注入 registry credential；
- 环境仓库负责选择候选版本并维护 rollout 与集群验收；具体 promotion 流程由发布架构和 runbook
  维护；
- source CI 证明源码与通用 base 质量，environment CI 与 Argo status 证明可部署性，双方不能
  代替对方；
- 其他机构可以 fork 源码仓库并提供自己的环境仓库，无需修改上游部署拓扑。
