---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0078
status: accepted
---
# ADR-0078 Worker 版本管理

## 背景

Temporal worker 发布必须同时处理工作流代码兼容性、任务路由和按版本扩缩容。只对 Kubernetes
Deployment 原地更新镜像，不能表达 Temporal 的 worker version，也不能让旧版本在已有工作完成前
保持正确的 poller 与容量。

## 决策

production Temporal worker 由 Temporal Worker Controller 管理，并启用 Temporal Worker
Deployment Versioning。每个 active worker version 获得独立的 Kubernetes workload、自动扩缩器
和中断保护；Temporal 决定任务的版本路由，KEDA/HPA 只决定副本数，Argo CD 只维护声明式平台与
worker 模板。

应用不自建版本路由或发布控制器，也不把 worker 版本状态复制进 PostgreSQL。当前 CRD、运行时
身份、发布策略和扩缩容边界由 Kubernetes 运行时架构维护；具体平台版本、资源参数和不可变镜像
由环境仓维护。

## 后果

- worker 镜像或兼容性相关配置变化产生显式 Temporal version。
- 活跃版本和仍承载已有工作的版本可以分别保持 poller 与容量。
- 环境必须验证 Temporal、Worker Controller 与 KEDA 的版本和 API 兼容性。

## 未采用方案

- **原地更新静态 Deployment**：无法表达 Temporal 版本路由和旧版本排空。
- **应用自建发布控制器**：会复制 Temporal 与 Kubernetes controller 的职责。
- **把版本路由写入 PostgreSQL**：会产生第二份工作流执行状态。

## 参考

- [Temporal Worker Controller](https://github.com/temporalio/temporal-worker-controller)
- [Temporal Worker Versioning](https://docs.temporal.io/production-deployment/worker-deployments/worker-versioning)
- [KEDA Temporal scaler](https://keda.sh/docs/latest/scalers/temporal/)
- `docs/architecture/system/k8s-runtime.md`
- `docs/runbooks/temporal.md`
