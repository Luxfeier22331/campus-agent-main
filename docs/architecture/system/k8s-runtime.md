---
doc_type: architecture
owner_boundary: temporal-worker-runtime
status: active
---
# Kubernetes 运行时

## 边界

本文定义源码仓拥有的 Temporal worker Kubernetes base 和与其直接相关的固定集群操作。
环境仓拥有 Argo CD Application、namespace、immutable image digest、Helm value、encrypted
Secret 和环境 patch。

## 运行时基础

`infra/k8s/execution-runtime/base` 和 `infra/k8s/ingestion-runtime/base` 分别提供 execution 与
ingestion API/service、Temporal `WorkerDeployment`、`Connection`、
`WorkerResourceTemplate`、ServiceAccount 和 NetworkPolicy。

ingestion base 还包含 `ingestion-schedule-sync` PostSync Job，用于对齐固定的内部门户认证维护
Schedule。source-collector 通过可选完整 Secret 卷读取 TGC；`infra/k8s/ops-web/base` 只为
Ops Web 增加固定 Secret 的资源名级 `get`、`patch` 权限，不提供通用集群管理权限。

具体资源清单以 Kustomize base 为准，不在架构文档复制。first-party base 不选择 namespace、
环境 Secret 或 mutable image tag。

## 平台前置条件

Temporal Server、Temporal Worker Controller、KEDA 和 cert-manager 必须使用相互兼容、支持
本仓库 CRD/API 的 pinned version。具体版本和 Helm value 由环境仓维护。

Worker Controller 及 apply `WorkerResourceTemplate` 的 principal 必须具备管理模板中 KEDA
`ScaledObject` 和 `PodDisruptionBudget` 的最小权限。

## Worker 版本

Worker Controller 根据 pod template 创建每个 build 的 Kubernetes Deployment，并注入：

- `TEMPORAL_DEPLOYMENT_NAME`
- `TEMPORAL_WORKER_BUILD_ID`

Go/TypeScript worker 要求两个变量同时存在，启用 Temporal Worker Deployment Versioning，
默认使用 `PINNED`。local worker 可以同时省略；只提供一个变量时启动失败。

rollout strategy 使用 `AllAtOnce`。旧 version 在 Temporal 判定 pinned work 已 drain 前保持
可用，再由 WorkerDeployment sunset policy 处理。Argo CD 不得独立 prune controller 创建的
version Deployment。具体时间值属于环境配置。

## 自动扩缩

`WorkerResourceTemplate` 为每个 active worker build 创建 `ScaledObject` 和 PDB，controller
注入 `scaleTargetRef`。KEDA 直接读取 Temporal backlog，不经过应用进程、数据库 projection
或 custom autoscaler。

新 build 必须能够先启动 poller、注册 Worker Deployment version 并成为 current；baseline
replica posture 和具体 trigger/threshold 由环境配置及所属 queue 需求决定。单 pod activity
并发由 SDK worker option 限制，fleet capacity 由 KEDA replica 扩展。

## Desired State 所有权

Argo CD 拥有：

- Connection、WorkerDeployment 和 WorkerResourceTemplate 期望状态；
- 不可变第一方镜像 digest；
- 环境 ConfigMap、Secret、schema job 和网络补丁；
- 平台 chart 版本和同步顺序。

Temporal 拥有 workflow/activity history 和 version routing；KEDA/HPA 拥有 replica count；
PostgreSQL 只保存产品或 ingestion projection。workflow 不得部署、重启或修改自己的 worker
resource。

## 网络与 Secret

repository base 默认拒绝 ingress/egress，只开放 DNS 以及必需的 Temporal、PostgreSQL、
object-store、OTLP、provider HTTPS 和 private-service traffic。环境 overlay 收窄 endpoint，
并增加 private connector/VPC binding。浏览器不得直连 Temporal、worker、PostgreSQL 或
object storage。

database、object-store、provider、telemetry、memory 和 internal API Secret 必须分离。
Worker Controller 注入的 version 变量是 runtime identity，不是用户管理 Secret。

内部门户 TGC 使用环境预创建的 `source-collector-internal-portal-auth`，key 固定为
`sso_tgc`。source-collector 只读完整卷投影；Ops Web 只能读取和 patch 该 Secret，不能
创建、列举、删除或操作其他 Secret。日常轮换不生成环境仓 Git 变更。

## Image 与发布

源码 CI 构建、测试、扫描并发布不可变 image candidate；环境 GitOps 通过 digest 选择实际
部署版本。mutable tag 不是部署事实。不同 runtime image 的内容和发布 lane 以 Dockerfile、
workflow 和环境消费者为准，不在本文维护动态 inventory。

## 验证

```bash
kubectl kustomize infra/k8s/execution-runtime/base
kubectl kustomize infra/k8s/ingestion-runtime/base
kubeconform -strict -ignore-missing-schemas rendered.yaml
```

cluster verification 应检查 WorkerDeployment status、current/target build id、
WorkerResourceTemplate、生成的 Deployment/ScaledObject/PDB、KEDA condition、Temporal poller
和 draining version。

## 禁止形态

- production Temporal worker 使用 static Deployment；
- static ScaledObject 绑定单一 worker Deployment；
- custom task-queue sampler 或 replica actuator；
- workflow code 调用 Kubernetes 或 Argo CD；
- 用户维护 Worker build id；
- 未版本化的 production poller。

## 相关文档

- `docs/decisions/adr-0078-worker-versioning.md`
- `docs/runbooks/temporal.md`
- `docs/architecture/system/durable-runtime.md`
- `docs/architecture/system/data-plane.md`
