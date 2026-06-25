---
doc_type: architecture
truth_scope: execution
owner_boundary: execution-control
status: active
created: 2026-06-16
updated: 2026-06-16
---
# Kubernetes Execution Runtime Architecture

## Document Boundary

本文冻结 `campus-agent` execution-control / Temporal worker plane 的目标
Kubernetes deployment substrate 与 autoscaling boundary。

它回答的是：

- execution-control、Temporal、workflow worker 与 activity worker 在 K8s 中如何分层
- KEDA / HPA 与 Temporal task queue 指标如何参与 worker replica autoscaling
- Docker Compose `worker-autoscaler` 在目标态中的位置
- Operator Console / app-api 应消费什么运行证据

它不负责：

- 具体 Helm chart、Kustomize overlay、namespace 名称或集群供应商
- 当前 merged staging 是否已经迁移到 Kubernetes
- 每个 worker 的最终 CPU / memory request、node pool 或实际阈值
- Temporal Cloud 与 self-hosted Temporal 的最终商业选择

当前拓扑 truth 仍以 `../current-architecture.md` 为准；live substrate truth 必须由
applied resources、runtime env、projection 与 E2E evidence 证明。本文描述目标
deployment substrate 和 supporting architecture。

## Core Conclusion

execution-control production target substrate 收口为：

```text
app-api Worker
-> execution-control Kubernetes Service
-> Temporal Service / Temporal Cloud endpoint
-> workflow-worker Deployment
-> activity-worker-* Deployments
-> KEDA temporal ScaledObjects
-> Kubernetes HPA replica control
-> sanitized app-api runtime projection
```

核心规则：

- Temporal 仍拥有 workflow history、workflow / activity task queue、retry、timeout、
  heartbeat、signal、query 与 update。
- Kubernetes 只拥有 pod scheduling、resource requests / limits、rollout、readiness、
  liveness、service discovery 与 workload replica desired state。
- KEDA / HPA 只调整 worker Deployment replica count，不拥有 execution truth、
  product run projection、step projection 或 terminal state。
- `worker-autoscaler` 不再作为长期 production autoscaling controller；它只保留为
  local / Docker Compose transitional proof 和 evidence producer。
- Operator Console 不读取 Kubernetes API、Temporal history 或 raw KEDA metrics；它只读取
  app-api 物化的 operator-safe runtime projection。

## Target Runtime Topology

### Control Plane

`execution-control` 在 K8s 中是 internal-only Deployment + Service：

- 接收 `apps/app-api` 的 trusted machine command/query request。
- 拥有 workflow start / signal / cancel / query / update seam。
- 暴露 `/healthz`、`/readyz` 与 `/metrics`。
- 不作为 browser surface、public API 或 Operator Console query backend。

`apps/app-api` 仍是 product-layer owner：

- conversation / run creation
- auth/session/principal
- product projection
- operator-safe read model
- internal runtime projection ingest / query endpoints

`app-api -> execution-control` 的 transport 可通过 private network、service mesh、
internal ingress 或 Cloudflare-protected machine ingress 实现；transport 形态不得改变
owner boundary。

### Temporal Plane

Temporal 可以是：

- self-hosted Temporal in the same cluster；或
- Temporal Cloud / external Temporal endpoint。

二者对 repo architecture 等价：Temporal endpoint、namespace、TLS / API key / mTLS
secret 由 deploy environment 注入。repo 不把 Temporal persistence schema、Temporal
internal DB 或 Temporal UI 当成 product truth。

### Worker Plane

每个 worker pool 是独立 Deployment：

- `workflow-worker`
- `activity-worker-context`
- `activity-worker-agent`
- `activity-worker-knowledge-plan`
- `activity-worker-knowledge-retrieval`
- `activity-worker-knowledge-synthesis`
- `activity-worker-campus-services`
- `activity-worker-notice`
- `activity-worker-navigation`
- `activity-worker-finalization`

拆分原则：

- 每个 Deployment 只 poll 自己的 Temporal task queue。
- 每个 Deployment 独立设置 resource requests / limits、readiness、liveness、
  rollout strategy、PodDisruptionBudget 与 KEDA ScaledObject。
- `activity-worker-knowledge-retrieval` 与
  `activity-worker-knowledge-synthesis` 可使用更高 max replicas 与更高 resource
  request，因为它们分别承接 Qdrant / embedding 与 provider-heavy path。
- worker image 可以先复用同一 `apps/execution-control` image，通过 command / args
  选择 worker role；是否拆 image 是交付优化，不是架构边界。

## Autoscaling Model

### Source Metrics

目标态使用成熟 substrate 的双层 autoscaling：

1. Temporal / worker metrics supply demand and saturation signals.
2. KEDA / HPA controls Kubernetes Deployment replicas.

KEDA Temporal scaler 的主输入：

- `namespace`
- `taskQueue`
- `queueTypes`: `workflow` / `activity`
- `targetQueueSize`
- `activationTargetQueueSize`
- Temporal `endpoint`
- Temporal auth: API key or mTLS where required
- optional Temporal Worker Deployment version selectors:
  `workerDeploymentName` + `workerDeploymentBuildId`

Temporal SDK worker tuning / poller autoscaling 只调整单个 worker 进程内部的 task
poller / slot 行为；它不是 Deployment replica autoscaling 的替代品。

### Replica Policy

默认 production policy：

| Worker | Queue type | Min replicas | Max replicas | Target queue size |
| --- | ---: | ---: | ---: | ---: |
| `workflow-worker` | workflow | 1 | 3 | 8 |
| `activity-worker-context` | activity | 1 | 3 | 8 |
| `activity-worker-agent` | activity | 1 | 3 | 8 |
| `activity-worker-knowledge-plan` | activity | 1 | 3 | 8 |
| `activity-worker-knowledge-retrieval` | activity | 1 | 5 | 8 |
| `activity-worker-knowledge-synthesis` | activity | 1 | 5 | 8 |
| `activity-worker-campus-services` | activity | 1 | 3 | 8 |
| `activity-worker-notice` | activity | 1 | 3 | 8 |
| `activity-worker-navigation` | activity | 1 | 3 | 8 |
| `activity-worker-finalization` | activity | 1 | 3 | 8 |

These values mirror the current Docker Compose autoscaler policy as the first
K8s target baseline. They are not permanent capacity promises; production tuning
must use observed schedule-to-start latency, backlog, worker slot metrics,
provider latency, Qdrant latency and app-api run SLO.

Scale-to-zero is not the default for online answer workers. `minReplicaCount`
stays `1` unless a worker pool is proven cold, non-critical and safe to cold
start without affecting user-visible latency.

### HPA Behavior

KEDA owns event-source polling and exposes external metrics to HPA. HPA owns
1-to-N replica calculation and applies stabilization / rate policies.

Required HPA behavior:

- scale up can be faster than scale down
- scale down uses a stabilization window
- scale down must not race in-flight long-running Temporal activities
- manual pause must use KEDA pause annotations or deployment freeze, not deletion
  of ScaledObject history

KEDA `fallback` must not hide source metric failure as success. If Temporal
metric collection fails, runtime evidence must mark autoscaling posture as
degraded and fail closed for release closeout.

### Committed Staging Manifest Shape

First-stage staging manifests live at:

```text
infra/k8s/execution-runtime/base
infra/k8s/execution-runtime/overlays/staging
```

They use Kustomize/raw YAML and intentionally exclude `campus-web`,
`operator-console-web` and `app-api`, which remain Cloudflare Worker surfaces.
The staging overlay creates the internal execution plane only:

- self-hosted Temporal and Temporal Postgres
- `execution-control` internal Service / Deployment
- `agent-runtime`
- Hindsight API and Hindsight Postgres
- OTel collector
- workflow/activity worker Deployments
- Temporal task queue sampler
- KEDA/HPA posture collector
- one KEDA `ScaledObject` per worker Deployment

The example below is the committed baseline shape:

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: activity-worker-knowledge-retrieval
spec:
  scaleTargetRef:
    name: activity-worker-knowledge-retrieval
  pollingInterval: 15
  cooldownPeriod: 180
  minReplicaCount: 1
  maxReplicaCount: 5
  advanced:
    horizontalPodAutoscalerConfig:
      behavior:
        scaleDown:
          stabilizationWindowSeconds: 300
  triggers:
    - type: temporal
      metadata:
        namespace: default
        taskQueue: campus-agent.activity.knowledge.retrieval
        queueTypes: activity
        targetQueueSize: "8"
        activationTargetQueueSize: "0"
        endpoint: temporal-frontend.temporal.svc.cluster.local:7233
      authenticationRef:
        name: temporal-worker-scaler-auth
```

The baseline sets `minReplicaCount=1`, `targetQueueSize="8"`,
`pollingInterval=15`, `cooldownPeriod=180` and HPA scale-down stabilization to
`300` seconds. `activity-worker-knowledge-retrieval` and
`activity-worker-knowledge-synthesis` use `maxReplicaCount=5`; other worker
pools use `maxReplicaCount=3`.

## Runtime Projection And Operator Evidence

KEDA / HPA become the actuation owner, but app-api remains the operator-safe
runtime projection owner.

Target projection families:

- `temporal_task_queue_metrics_snapshot.v1`
  - sampled from Temporal or metrics pipeline
  - captures task queue backlog, oldest task age, schedule-to-start where available,
    poller / worker health
- `worker_autoscaler_decision.v1`
  - records KEDA/HPA desired-vs-current state or a normalized decision summary
  - may be produced by a projection collector rather than execution-control
- `worker_autoscaler_actuation.v1`
  - records KEDA/HPA scale events / Kubernetes workload replica changes
  - actuator kind becomes `keda_hpa`
- `worker_autoscaler_posture.v1`
  - aggregate for release closeout: scaler health, metric freshness, paused
    state, degraded state and last scale event
  - produced in K8s by `keda-hpa-posture-collector`, which reads only
    Deployment, HPA and KEDA ScaledObject status in the execution namespace and
    publishes sanitized records through app-api internal ingest

Operator Console reads only app-api operator endpoints. It does not call the
Kubernetes API server, KEDA API, HPA API or Temporal history APIs directly.

## Release And Readiness Gates

Production readiness for K8s execution runtime requires:

- `execution-control` Service is reachable only by trusted internal callers.
- `/healthz`, `/readyz` and `/metrics` are reachable by cluster probes / monitoring.
- Every worker Deployment has readiness / liveness probes and resource requests.
- Every Temporal task queue in the admitted worker policy has exactly one owner
  Deployment and one ScaledObject.
- Every ScaledObject has explicit min/max replicas, target queue size, polling
  interval and cooldown / HPA scale-down behavior.
- KEDA operator and metrics server are healthy.
- HPA objects are present and not reporting metric fetch failures.
- app-api operator runtime projection contains fresh queue metrics and
  `worker_autoscaler_posture.v1` scaler evidence.
- Release E2E evidence can show a task queue backlog increase causes HPA desired
  replicas to rise, and idle stabilization causes scale down without failed
  in-flight activities.

## Migration Boundary

The staged migration is:

1. Keep Docker Compose runtime as local / transitional smoke path while live
   staging takeover remains unverified.
2. Add K8s Kustomize overlays for execution-control, Temporal, agent-runtime,
   Hindsight, OTel, workflow-worker and all activity-worker Deployments.
3. Add KEDA ScaledObjects for all worker pools with no scale-to-zero.
4. Add projection collector for KEDA/HPA posture evidence into app-api operator
   runtime projection.
5. Run staging shadow validation: KEDA computes desired replicas while Docker
   runtime still serves, or a dedicated K8s staging namespace serves non-production
   traffic.
6. Cut `app-api` staging `EXECUTION_CONTROL_BASE_URL` to the K8s internal
   execution-control Service / ingress.
7. Retire Docker Compose `worker-autoscaler` from staging/prod runbooks; keep it
   only for local compose smoke unless local K8s becomes the default dev runtime.

## Forbidden Shapes

- Do not let KEDA/HPA write workflow state, run projection, step projection,
  terminal state or capability policy.
- Do not let Operator Console query Kubernetes / Temporal directly.
- Do not scale all worker pools from one global backlog metric.
- Do not use CPU-only HPA as the primary Temporal worker autoscaling signal.
- Do not enable scale-to-zero for online answer workers without explicit cold-start
  and in-flight task evidence.
- Do not preserve Docker Compose autoscaler as a parallel production controller
  once KEDA/HPA owns the worker Deployment.
- Do not use KEDA fallback replicas as a silent success path for release closeout.

## External Capability Basis

This architecture relies on these current upstream capabilities:

- KEDA Temporal scaler can scale Kubernetes workloads from Temporal task queue
  backlog using `namespace`, `taskQueue`, `targetQueueSize`, `queueTypes` and
  Temporal endpoint/auth settings.
- KEDA monitors event sources and feeds metrics to Kubernetes HPA for Deployment
  / StatefulSet scaling.
- Kubernetes HPA is the native controller for horizontal workload replica
  autoscaling.
- Temporal worker performance guidance separates worker process tuning / poller
  autoscaling from fleet-level replica scaling.

## Related Documents

- `docs/architecture/target-architecture.md`
- `docs/architecture/system/durable-agent-runtime-architecture.md`
- `docs/architecture/system/runtime-delivery-and-release-hardening-architecture.md`
- `docs/contracts/operator-runtime-observability-contract.md`
- `docs/decisions/adr-0056-kubernetes-keda-execution-runtime.md`
