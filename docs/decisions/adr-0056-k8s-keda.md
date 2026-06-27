---
doc_type: decision
truth_scope: repository
owner_boundary: docs/decisions
decision_id: ADR-0056
status: accepted
created: 2026-06-16
updated: 2026-06-16
supersedes:
  - adr-0043-docker-runtime.md
---
# ADR-0056 Kubernetes + KEDA Execution Runtime

## 状态

Accepted on 2026-06-16.

本文 supersedes ADR-0043 对长期 production execution-control deployment
substrate 的 Docker-first 决策。ADR-0043 仍保留为 current Docker Compose / local /
staging baseline 的历史与过渡依据，直到 `current.md` 明确切到 K8s
merged truth。

## 背景

ADR-0048 已冻结 Temporal 作为 canonical execution plane。当前实现已经进入
`app-api -> execution-control -> Temporal -> workflow / activity worker pools`
的 durable execution model。

此前 Docker-first runtime 解决了一个阶段性问题：快速把 Go `execution-control`、
Temporal、split workers 与 autoscaler 从 dev-backed / Python bridge 模式中解耦出来。
但 Docker Compose 不应继续承担 production-grade workload scheduling 与 autoscaling
职责。继续自研 `worker-autoscaler` 会把 repo 拉回通用控制器、cooldown、rollout safety、
metric failure、leader election 与 scale event recovery 的维护成本。

Kubernetes + KEDA 已经提供更成熟的 execution worker substrate：

- Kubernetes Deployment / Service / HPA 承接 pod scheduling、rollout、readiness、
  liveness 与 horizontal replica control。
- KEDA Temporal scaler 可以基于 Temporal task queue backlog 驱动 worker Deployment
  autoscaling。
- Temporal 继续拥有 workflow history、task queue、retry、timeout、heartbeat、signal、
  query 与 update。

## 决策

`campus-agent` 接受 Kubernetes + KEDA 作为 execution-control production target
deployment substrate。

长期 production target 固定为：

```text
app-api Worker
-> execution-control Kubernetes Service
-> Temporal
-> workflow-worker / activity-worker Deployments
-> KEDA Temporal ScaledObject
-> Kubernetes HPA
-> app-api operator-safe runtime projection
```

## 决策细节

### 决策 1：K8s 是 production deployment substrate

K8s owns：

- execution-control pod scheduling
- worker pod scheduling
- Services and internal discovery
- resource requests / limits
- rollout / rollback mechanics
- liveness / readiness probes
- HPA-controlled replica desired state

K8s does not own：

- workflow history
- Temporal task queue truth
- product conversation / run projection
- step / attempt / result projection
- final answer terminal state
- tool admission / policy
- Operator Console canonical read model

### 决策 2：KEDA / HPA 替代自研 production worker autoscaler

Production worker replica autoscaling 由 KEDA Temporal scaler + Kubernetes HPA
承接。

`worker-autoscaler` 不再是长期 production autoscaling controller。它只能保留为：

- Docker Compose local smoke / transitional staging proof
- comparison evidence producer
- migration fallback while K8s staging is not yet serving

一旦 K8s staging / production worker Deployment 由 KEDA/HPA 管理，不得再并行运行
Docker Compose `worker-autoscaler` 控制同一 worker pool。

### 决策 3：worker pool 必须按 Temporal task queue 独立部署与扩缩容

每个 target worker pool 对应独立 Deployment 与 ScaledObject：

- `workflow-worker`
- `activity-worker-core`
- `activity-worker-agent`
- `activity-worker-knowledge`

每个 ScaledObject 必须显式配置：

- Temporal namespace
- Temporal task queue
- `queueTypes`
- `targetQueueSize`
- `minReplicaCount`
- `maxReplicaCount`
- polling interval
- cooldown / HPA scale-down behavior
- Temporal endpoint and auth binding

### 决策 4：online answer workers 不默认 scale-to-zero

默认 `minReplicaCount=1`。

scale-to-zero 只允许在满足以下条件后单独接受：

- worker pool 不在 user-visible hot path；或 cold start latency 已被证明可接受
- in-flight Temporal tasks 不会被 premature scale-down 破坏
- KEDA activation behavior、cooldown 与 HPA scale-down behavior 有 release evidence
- app-api operator runtime projection 能暴露 paused / fallback / metric-stale 状态

### 决策 5：Temporal worker tuning 与 fleet autoscaling 分层

Temporal SDK poller autoscaling / worker tuners 用于单个 worker process 内部的 poller /
slot tuning。

KEDA/HPA 用于 worker fleet replica autoscaling。

二者互补，不得互相替代。

### 决策 6：operator runtime projection 继续属于 app-api

KEDA/HPA 产生 scaling truth，但 Operator Console 不直接读取 Kubernetes API、HPA API、
KEDA API 或 Temporal history。

app-api 继续拥有 operator-safe runtime projection：

- task queue metrics snapshot
- worker autoscaler decision summary
- worker autoscaler actuation / scale event summary
- scaler health / metric freshness / paused / fallback posture

projection producer 可以从 execution-control 迁到 K8s/KEDA collector，但写入仍必须经
app-api internal HTTP seam。

## 结果

- `docs/architecture/system/k8s-runtime.md` 成为
  execution-control K8s / KEDA target supporting architecture。
- `docs/architecture/system/durable-agent-runtime-architecture.md` 的 autoscaling
  boundary 必须解释 KEDA/HPA 是目标 production controller。
- `docs/contracts/operator-runtime.md` 必须允许
  `actuatorKind=keda_hpa` 的 target projection，同时保留 Docker Compose actuation 为当前
  transitional shape。
- `docs/architecture/current.md` 不应继续把 Docker-first 写成高置信
  live substrate truth；不得提前宣称 production K8s 已实现，live takeover 必须由
  applied resources、runtime env、projection 与 E2E evidence 证明。
- Docker Compose runbook 可以继续作为 local / staging transitional baseline，但不得被写成
  production target。

## 非目标

本 ADR 不决定：

- Kubernetes provider / cluster vendor
- Helm vs Kustomize vs raw manifests
- Temporal Cloud vs self-hosted Temporal
- exact namespace / service account / secret names
- final CPU / memory requests
- final KEDA thresholds after production tuning
- immediate deletion of Docker Compose local runtime

## 参考

- [KEDA Temporal scaler](https://keda.sh/docs/latest/scalers/temporal/)
- [KEDA scaling Deployments](https://keda.sh/docs/latest/concepts/scaling-deployments/)
- [Kubernetes autoscaling](https://kubernetes.io/docs/concepts/workloads/autoscaling/)
- [Temporal Worker performance](https://docs.temporal.io/develop/worker-performance)
