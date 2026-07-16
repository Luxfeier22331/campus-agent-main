---
doc_type: runbook
owner_boundary: temporal-platform
status: active
---
# Temporal 自托管运维

## 边界

本文说明 Temporal Server、Worker Controller、WorkerDeployment 与 KEDA 的稳定运维规则。具体
chart/controller 版本、Helm value、namespace、endpoint 和资源尺寸由环境仓库拥有，不在本
文复制。

环境选择的版本必须满足 source manifest 使用的 CRD/API，并通过环境仓库 render 与兼容性
检查。Worker Controller 必须先于 WorkerDeployment 可用；若 WorkerResourceTemplate 生成
KEDA `ScaledObject` 或 `PodDisruptionBudget`，controller 与 GitOps principal 必须具备对应
allowlist 和 RBAC。

## 所有权

- Argo CD：platform chart、Connection、WorkerDeployment、WorkerResourceTemplate、ConfigMap、
  Secret、image digest 与 sync order；
- Temporal：workflow history、task routing、retry、timeout、heartbeat、cancellation 与 Worker
  Deployment version routing；
- KEDA/HPA：每个 active worker build 的 replica；
- application：确定性 workflow/activity code 与有界投影。

workflow 不调用 Argo CD 或 Kubernetes；deployment 不改写 workflow history 或产品投影。

## 变更步骤

1. 在环境仓库确认 Temporal、KEDA、Worker Controller 与 CRD 兼容；
1. render source base 与 environment overlay，并执行 schema/policy 检查；
1. 通过环境 pull request 选择 immutable image digest；
1. 合并后由 Argo CD 更新父级 WorkerDeployment template；
1. 确认目标 build 注册 poller 并按声明策略成为 current；
1. 观察旧 build drain，并按环境 sunset policy 清理 controller 生成资源。

不得直接 patch controller 创建的 version Deployment，也不得为不兼容 workflow code 复用
Build ID。

## 状态检查

按环境仓库提供的 context/namespace 执行：

```bash
kubectl get connection
kubectl get workerdeployment -o wide
kubectl get workerresourcetemplate
kubectl get deployment,scaledobject,poddisruptionbudget
```

逐个 WorkerDeployment 检查 condition、target/current Build ID、task queue/poller、生成
Deployment、ScaledObject/HPA、PDB 与旧 build drain 状态。

## 常见故障

### `WaitingForPollers`

- 检查 worker startup 与 version env；
- 检查 SDK versioning、task queue 与 Temporal namespace；
- 检查 bootstrap replica 策略是否允许首个 poller 启动。

### WorkerResourceTemplate 被拒绝

- 检查 controller allowlist、webhook TLS/cert-manager 与 RBAC；
- controller-owned target/selector 字段保持由 controller 填充。

### KEDA metric 失败

- 检查环境选定 KEDA 版本是否支持当前 Temporal scaler contract；
- 检查 Temporal endpoint、namespace、task queue、queue type 与从 pod env 解析的 deployment
  字段。

### 旧版本无法 drain

- 检查仍绑定旧 build 的 workflow 与 task queue；
- workflow 未完成时不得强制删除旧 Deployment；
- 只按产品或 ingestion policy cancel/terminate workflow。

## 回滚与持久化

回滚通过环境 GitOps 选择已知可用 image/config template。Worker Controller 创建或选择对应
build，Temporal 按声明 rollout 路由新工作；不得在 controller 之外手工修改 Temporal routing。

Temporal persistence 与 visibility database 是 platform data。backup、restore、schema upgrade
与 retention 使用 Temporal/database platform 流程，不复用 application schema migration job。

## 相关文档

- `../decisions/adr-0048-temporal.md`
- `../decisions/adr-0078-worker-versioning.md`
- `../architecture/system/k8s-runtime.md`
