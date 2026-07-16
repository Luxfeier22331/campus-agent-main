---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0078
status: accepted
---
# ADR-0078 Worker 版本管理

## 背景

每个 queue 使用一个 static Kubernetes Deployment 和长期 KEDA ScaledObject，无法在 image
rollout 期间保留 Temporal Worker Deployment version identity。原地更新 image 会让不兼容
workflow code 进入同一 unversioned poller set，绑定单个 Deployment 的 autoscaler 也无法
跟随 draining version。

## 决策

production Temporal worker 由 Temporal Worker Controller `WorkerDeployment` 管理。

- Temporal Server、Worker Controller 和 KEDA 必须使用相互兼容且支持本决策所需 API 的
  pinned version；具体版本由环境仓维护。
- 每个 SDK worker 启用 Worker Deployment Versioning，读取 controller 注入的
  `TEMPORAL_DEPLOYMENT_NAME` 和 `TEMPORAL_WORKER_BUILD_ID`，默认使用 `PINNED`。只提供其中
  一个变量时启动失败；local development 可以同时省略。
- rollout strategy 使用 `AllAtOnce`；已有执行由 Temporal routing 和 pinned workflow
  behavior 保护，不再增加应用级 rollout controller。
- 每个 worker version 通过 `WorkerResourceTemplate` 获得 KEDA `ScaledObject` 和
  `PodDisruptionBudget`。
- `scaleTargetRef`、selector 和 Worker Deployment/build identity 由 controller 注入，不在
  first-party manifest 中复制。
- baseline `minReplicaCount` 保证新 version 可以注册 poller 并成为 current；具体扩缩容参数
  属于环境配置。

Argo CD 拥有 `Connection`、`WorkerDeployment`、`WorkerResourceTemplate` desired state 和
immutable image digest selection。Temporal 拥有 workflow/activity execution 与 version
routing。KEDA/HPA 只拥有 replica count。任何一方都不把产品或 ingestion workflow truth
写入 PostgreSQL。

具体 WorkerDeployment 清单、controller/chart version 和环境参数属于环境仓，不在 ADR 中
冻结。

## 后果

- static worker Deployment 和 static per-Deployment ScaledObject 退出 production path。
- 每个 active/draining build 拥有自己的 autoscaler/PDB，并按 WorkerDeployment sunset
  policy 清理。
- worker image/config 变化产生显式 Temporal version。
- apply custom resource 前，环境必须先验证 controller、Temporal 和 KEDA 兼容性。

## 参考

- [Temporal Worker Controller](https://github.com/temporalio/temporal-worker-controller)
- [Temporal Worker Versioning](https://docs.temporal.io/production-deployment/worker-deployments/worker-versioning)
- [KEDA Temporal scaler](https://keda.sh/docs/latest/scalers/temporal/)
- `docs/architecture/system/k8s-runtime.md`
- `docs/runbooks/temporal.md`
