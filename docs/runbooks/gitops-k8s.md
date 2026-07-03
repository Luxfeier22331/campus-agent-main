---
doc_type: runbook
truth_scope: ops
owner_boundary: docs/runbooks
status: active
created: 2026-07-03
updated: 2026-07-04
---
# K8s GitOps Runbook

## Boundary

This runbook is the operational entry for the target K8s GitOps skeleton. It
does not replace the current Docker staging runbooks until K8s staging is
actually serving traffic and has E2E evidence.

## Preflight

Before applying any Argo CD Application:

```bash
pnpm repo:static
kubectl kustomize infra/k8s/execution-runtime/overlays/staging
kubectl kustomize infra/k8s/dining-sync/overlays/staging
```

The GitOps static check must pass before using `infra/gitops/apps/*.yaml`.

The first K8s staging profile is non-HA by default. Do not use this skeleton as
production evidence until a separate production overlay or Application set has
accepted HA sizing, backup, ingress, Access and release gates.

## nc-arm-6c Slim Staging

`nc-arm-6c` 的第一阶段 K8s proof 使用 slim overlay：

```bash
kubectl kustomize infra/k8s/execution-runtime/overlays/nc-arm-6c-staging
```

该 overlay 只运行 `execution-control`、`agent-runtime` 与四个 Temporal
worker。Temporal、Hindsight、Qdrant、projection DB 与 OTel collector 继续由
Docker 承载，并通过 K8s selector-less Service 指向宿主机 `10.42.0.1`。
`execution-control` 同时通过 `172.20.0.1:27051` 的 host-only bind 暴露给
现有 Docker Traefik；Traefik 的 `execution-control-staging.mucwiki-edge.link`
动态路由应指向 `http://172.20.0.1:27051`。不要改成 `0.0.0.0`
NodePort 或公开端口。因为单节点 hostPort 不能同时运行两个
`execution-control` pod，该 overlay 对 `execution-control` 使用 `Recreate`
strategy；其它 runtime worker 仍保持滚动更新。

启动 Docker 依赖时必须额外加入 host-bind override：

```bash
export EXECUTION_CONTROL_STAGING_COMPOSE_FILES="\
/srv/apps/campus-agent/infra/local/docker-compose.execution-control-runtime.yml:\
/srv/apps/campus-agent/infra/local/docker-compose.execution-control-runtime.staging.yml:\
/srv/apps/campus-agent/infra/local/docker-compose.execution-control-runtime.k8s-host.yml"

export EXECUTION_CONTROL_STAGING_POSTGRES_COMPOSE_FILE="\
/srv/apps/campus-agent/infra/local/docker-compose.postgres.yml"
export EXECUTION_CONTROL_STAGING_QDRANT_COMPOSE_FILE="\
/srv/apps/campus-agent/infra/local/docker-compose.qdrant-single-node.yml"
```

Qdrant 和 Postgres 的 K8s host bind override 需要通过对应 compose command
显式叠加：

```bash
docker compose \
  -f infra/local/docker-compose.postgres.yml \
  -f infra/local/docker-compose.postgres-k8s-host.yml \
  up -d postgres

docker compose \
  -f infra/local/docker-compose.qdrant-single-node.yml \
  -f infra/local/docker-compose.qdrant-k8s-host.yml \
  up -d qdrant
```

应用 K8s 前必须通过 bridge preflight：

```bash
infra/local/staging/preflight-execution-runtime-k8s-docker-bridge.sh
```

该 preflight 要求 `10.42.0.1` 存在，并确认 `5432`、`6333`、`7233`、
`8888`、`4318` 只在 K8s host-bind 地址上可达，不允许 stateful dependency
暴露到 `0.0.0.0`。

K8s Secret 由远端 ops-owned env / artifact 生成，不提交到 repo。必须通过
staging env loader 渲染，不能直接从原始 env file 创建 Secret；否则会漏掉
provider projection、runtime release 与 runtime-generated secret：

```bash
infra/local/staging/render-execution-runtime-k8s-secrets.sh | kubectl apply -f -
```

渲染前必须确认 `CAMPUS_PROVIDER_CONFIG_SNAPSHOT_HOST_PATH` 与
`QDRANT_TLS_CA_CERT_PATH` 指向真实文件。渲染结果必须包含真实
`EXECUTION_CONTROL_RUNTIME_RELEASE`，例如 `execution-control@<sha>`，不得使用占位值。

在 apply slim overlay 前，必须停止 Docker 中会重复消费 Temporal queue 的
`execution-control`、`agent-runtime` 和 worker 容器；Temporal、Hindsight、
Qdrant、Postgres 与 OTel 保持运行。

```bash
kubectl apply -k infra/k8s/execution-runtime/overlays/nc-arm-6c-staging
```

Rollback 固定为删除 slim overlay 后恢复 Docker runtime：

```bash
kubectl delete -k infra/k8s/execution-runtime/overlays/nc-arm-6c-staging
docker compose \
  -f infra/local/docker-compose.execution-control-runtime.yml \
  -f infra/local/docker-compose.execution-control-runtime.staging.yml \
  up -d execution-control agent-runtime workflow-worker \
    activity-worker-core activity-worker-agent activity-worker-knowledge
```

## Bootstrap

1. Install Argo CD into the target cluster namespace `argocd`.
2. Apply `infra/gitops/apps/platform-external-secrets.yaml`.
3. Wait for External Secrets Operator CRDs and controller pods to become ready.
4. Apply `infra/gitops/apps/platform-keda.yaml`.
5. Wait for KEDA CRDs and controller pods to become ready.
6. Add reviewed `ExternalSecret` / `SecretStore` references under
   `infra/gitops/secrets/` after the backend is selected.
7. Apply `infra/gitops/apps/execution-runtime-staging.yaml` and
   `infra/gitops/apps/dining-sync-staging.yaml`.

Do not use `helm install` or `helm upgrade` directly for KEDA or External
Secrets after Argo CD owns the Applications. The chart inputs live in Git; Argo
CD renders Helm and owns lifecycle, sync and drift detection.

This runbook intentionally does not prescribe the concrete external secret
backend. The workload contract is stable Kubernetes Secret names; the backend
selection can be added later without changing first-party Deployment/CronJob
consumption.

## Ownership Checks

- Argo CD Applications must point only to tracked repo paths or pinned
  third-party Helm charts.
- Helm values must be non-secret deployment parameters.
- `infra/gitops/secrets/` may contain external secret references only after
  backend selection; it must not contain secret values.
- External provider active profiles must be configured through app-api
  provider-config, then exported as explicit runtime projections.
- Worker secrets must be checked with Worker deploy/preflight tooling, not
  mirrored into K8s.

## Promotion Rule

Do not describe K8s/Argo CD as live staging truth until these are all true:

- Argo CD is installed in the target cluster.
- `platform-keda` and `platform-external-secrets` sync successfully.
- `execution-runtime-staging` syncs and all pods pass readiness.
- app-api staging points to the K8s execution-control ingress/service.
- A real staging chat proof and runtime projection evidence have passed.
