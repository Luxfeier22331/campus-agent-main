---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0074
status: accepted
---
# ADR-0074 源码仓库与环境仓库边界

## 背景

应用仓库需要能够公开并被其他机构复用。此前仓库将可复用 Kubernetes workload base 与真实
staging Application、Helm value、machine overlay、network coordinate 和 encrypted secret
inventory 混在一起。加密只能保护 secret 值，不能隐藏环境拓扑、资源名或运维所有权；源码与
部署 desired state 的两份副本也可能漂移。

## 决策

应用源码与已部署 Kubernetes desired state 分仓管理。

应用源码仓库负责：

- application、job 与 package source；
- 稳定 runtime 与 secret-consumption contract；
- namespace-neutral first-party Kustomize base；
- image build、scan、SBOM 与 immutable SHA-tag publication；
- Cloudflare Worker build 与不改变 traffic 的 immutable version upload；
- 通过 pull request 提议环境变更的 promotion workflow。

每个部署环境仓库负责：

- Argo CD root 与 child Application；
- environment overlay、namespace、resource sizing 与 network coordinate；
- 固定版本的 third-party Helm chart 与 value；
- strict-scope SealedSecret 与 environment trust anchor；
- first-party image digest 与完整 source commit SHA；
- Cloudflare 非 secret 基础设施、Worker version selection 与 traffic；
- Terraform remote state 与从环境派生的 public GitHub variable；
- 环境专用 rollout 与 cluster verification。

环境仓库只通过完整 commit SHA 消费 source base，只通过 registry digest 消费 first-party image。
应用 CI 使用专用 GitHub App 创建幂等 promotion pull request，不能直接写入环境仓库 `main`。
Argo CD 通过只读 GitHub App credential 读取两个仓库，只有环境 pull request 合并后才进行
reconcile。

Cloudflare 不由 Argo CD 管理。应用仓库上传 immutable Worker version；环境仓库使用 Terraform
选择 version、管理 traffic 并 reconcile Cloudflare infrastructure。Worker secret 值只进入
Cloudflare Worker secret store，不复制到 Terraform state 或 Kubernetes Secret。

本次分仓不重写现有私有源码历史。首次公开发布必须从单独审查的 sanitized snapshot 产生，并
通过 history-level secret 与 topology review。

## 后果

- 应用仓库不再包含 `infra/gitops`、真实 environment overlay、Helm deployment value 或
  SealedSecret；
- 通用 Kustomize base 不创建 Namespace、不选择 environment ConfigMap 或 mutable image tag，
  也不注入 registry credential；
- 部署变更在环境仓库中接受审查，合并环境 pull request 是明确部署动作；
- 一个环境 pull request 可以选择同一 source commit 产生的 Kubernetes image digest 与
  Cloudflare Worker version；
- source CI 证明源码与通用 base 质量，environment CI 与 Argo status 证明可部署性，双方不能
  代替对方；
- 其他机构可以 fork 源码仓库并提供自己的环境仓库，无需修改上游部署拓扑。

## 未采用方案

### GitOps state 全部留在应用仓库

拒绝。该方案暴露私有拓扑，将开源发布绑定到环境清理，并混淆可复用源码与单一运维环境的
所有权。

### CI 直接生成 manifest，不使用环境仓库

拒绝。该方案失去可审查 desired state，并让 CI credential 代替 Argo CD reconciliation 成为
部署事实。

### 应用 CI 直接写环境仓库 `main`

拒绝。该方案绕过 review，并把一次成功 image build 直接变成未审查的 cluster change。
