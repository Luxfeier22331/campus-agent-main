---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0065
status: accepted
---
# ADR-0065 GitOps

## 背景

Kubernetes workload 源码、具体环境状态和第三方平台组件需要不同的维护方式。把所有
资源都包装成自研 Helm chart，或让应用 CI 直接修改集群，都会扩大维护面并绕过环境审查。

## 决策

- Argo CD 是 Kubernetes 环境 desired state 的 reconciler。
- 第一方 workload 默认提供 namespace-neutral Kustomize/raw YAML base；只有出现明确复用
  需求并经新决策接受后，才为其维护 Helm chart。
- 第三方平台组件使用环境仓固定版本的上游 Helm chart，不把供应商清单复制进源码仓。
- 源码仓的第一方 base 完整声明容器入口、标签、ServiceAccount、Secret key 消费、探针、默认资源、
  安全上下文、可写目录和应用级 NetworkPolicy；环境仓不得重新实现这些行为。
- 环境仓拥有 Argo CD Application、第三方 values、环境值、资源额度、网络目标、Secret 对象和
  具体镜像选择，只对源码 base 中明确开放的环境坐标做覆盖。
- Argo CD 不管理 Cloudflare。环境仓中的 Terraform 管理 Cloudflare infrastructure、
  Worker 版本选择和流量；应用 CI 只产出不可变版本并提出环境变更。
- Secret backend 由 ADR-0066 决定；workload 只依赖稳定 Kubernetes Secret 合同。

具体应用清单、chart 版本、环境名和同步状态属于环境仓，不写入本 ADR。

## 后果

- 合并源码不等于部署；环境变更需要独立 review 和 Argo CD reconcile。
- 第一方 Kustomize base 不选择 namespace、环境配置、可变镜像标签或真实 Secret。
- 强依赖数据库结构的 schema、迁移任务和 workload 位于同一个发布 Application。身份和授权按实际
  数据所有权与信任边界配置；同步顺序只在单个 Application 内表达，不把 root 中 child Application
  的 wave 当作跨应用事务。
- Helm 只解决成熟第三方组件交付，不成为第一方服务的默认包装层。

## 未采用方案

- **应用 CI 直接 apply 集群**：缺少可审查的环境 desired state。
- **所有资源都使用 Helm**：为当前第一方 workload 引入无收益的模板层。
- **复制第三方 YAML**：会把供应商升级和安全维护转移到本仓库。
- **由 Argo CD 管理 Cloudflare**：Cloudflare 不是 Kubernetes resource lifecycle。

## 相关文档

- `adr-0066-secret-delivery.md`
- `adr-0074-repository-boundary.md`
- `../architecture/system/k8s-runtime.md`
