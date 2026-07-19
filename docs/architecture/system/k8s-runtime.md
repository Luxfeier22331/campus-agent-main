---
doc_type: architecture
owner_boundary: temporal-worker-runtime
status: active
---

# Kubernetes 运行时

## 边界

本文定义源码仓中的 Temporal worker Kubernetes 基础资源及其平台职责。环境仓负责 Argo CD
Application、namespace、不可变镜像、环境配置、凭据和实际资源规格。

## 运行时基础

`infra/k8s/execution-runtime/base` 与 `infra/k8s/ingestion-runtime/base` 分别描述 execution 和
ingestion 运行时。精确资源、标签、探针和配置引用以 Kustomize base 为准，不在架构文档维护
副本。源码 base 不选择具体环境或可变镜像标签。

Temporal Server、Worker Controller、KEDA 与 cert-manager 属于平台前置条件。它们的版本和
配置由环境仓维护，并必须支持源码 base 使用的 API。

## Worker 版本

生产 worker 使用 Temporal Worker Deployment Versioning。Worker Controller 根据 worker 模板
创建构建版本，注入运行身份并管理版本路由；应用只读取该身份，不自行生成或覆盖。

新版本先启动 poller 并注册为可用构建，旧版本在已有任务完成前继续服务。版本切换、保留时间和
清理由 Temporal 与环境配置共同控制，Argo CD 不直接接管 controller 创建的版本 Deployment。

## 自动扩缩

Worker Controller 为活动构建物化 KEDA 扩缩资源。KEDA 读取 Temporal backlog，副本数不经过
应用进程、数据库投影或仓库自研扩缩器决定。

单个 worker 的并发由 SDK 配置限制，整个 worker 组的容量由 KEDA 调整。具体阈值、最小副本和
故障可用性要求属于环境配置。

## 状态职责

- Argo CD 选择源码声明的基础资源、不可变镜像和环境配置；
- Temporal 保存 workflow/activity history 并管理版本路由；
- KEDA/HPA 管理副本数；
- PostgreSQL 只保存产品或采集投影。

workflow 代码不得部署、重启或修改自己的 Kubernetes 资源。

## 网络与凭据

源码 base 默认最小化网络访问，环境 overlay 根据真实 endpoint 进一步限制。浏览器不能直连
Temporal、worker、数据库或对象存储。

环境仓为不同服务提供最小权限凭据，并满足源码声明的消费合同。运行身份、用户凭据和外部服务
凭据不能混用；精确 Secret、NetworkPolicy 和地址以 base 与环境配置为准。

第一方 workload 禁止使用 `envFrom.secretRef`。每个进程只通过显式
`env[].valueFrom.secretKeyRef` 引用实际读取的 key；多个进程需要同一逻辑凭据时引用同一 Secret
key，不创建按消费者复制的影子 Secret。非敏感 ConfigMap 不受此限制。

## 镜像与发布

源码 CI 生成并校验不可变候选物，环境仓通过 digest 选择部署版本。候选物存在不表示已部署；
实际状态由环境 revision 和 controller 状态确认。发布操作见 `docs/runbooks/release.md`。

## 不允许的形态

- production Temporal worker 使用不受版本控制的静态 Deployment；
- 为单一 worker Deployment 维护静态扩缩资源；
- 使用自研 task queue 采样器或副本执行器替代 Temporal 与 KEDA；
- workflow 调用 Kubernetes 或 Argo CD；
- 应用自行维护 worker build identity。

## 相关文档

- `docs/decisions/adr-0078-worker-versioning.md`
- `docs/runbooks/temporal.md`
- `docs/runbooks/release.md`
- `docs/architecture/system/durable-runtime.md`
- `docs/architecture/system/data-plane.md`
