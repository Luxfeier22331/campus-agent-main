---
doc_type: runbook
truth_scope: ops
owner_boundary: docs/runbooks
status: active
created: 2026-04-24
updated: 2026-06-13
---

# Execution Control Staging Operations

<!-- markdownlint-disable MD013 -->

## Document Boundary

This file is the stable staging operations index for execution-control. It
owns the current truth summary and links to executable procedure groups.

## Split Documents

- `execution-control-staging/deploy-and-ingress.md`
  - Deploy and ingress: checkout, secrets, install, proxy and startup steps
- `execution-control-staging/daily-operations-and-recovery.md`
  - Daily operations and recovery: health, cold start, logs and triage
- `execution-control-staging/durable-runtime-proof.md`
  - Durable runtime proof: durable proof and autoscaler dry-run evidence

## Index-Owned Baseline

## 文档边界

这份 runbook 只回答当前 canonical staging execution upstream 的运维真相：

- 当前 repo-owned staging execution runtime 是：
  - `otel-collector`
  - `execution-control`
  - `workflow-worker`
  - `activity-worker-context`
  - `agent-runtime`
  - `activity-worker-agent`
  - `activity-worker-knowledge-plan`
  - `activity-worker-knowledge-retrieval`
  - `activity-worker-knowledge-synthesis`
  - `activity-worker-finalization`
- 以下服务不是默认 serving startup，必须显式 opt-in：
  - `activity-worker-campus-services`
  - `activity-worker-notice`
  - `activity-worker-navigation`
  - `temporal-ui`
  - self-hosted Langfuse stack
- `worker-autoscaler`
  - explicit Docker Compose transitional autoscaler proof command
  - not part of default serving startup
- `execution-control` 不作为 public staging surface 存在；用户、浏览器、panel、docs
  与 chat 只进入 browser surface 或 `app-api`
- `execution-control` 是 app-api-only trusted machine upstream。当前 machine
  ingress 是 `https://execution-control-staging.mucwiki-edge.link`，由
  Cloudflare proxied DNS、Cloudflare Access service-token policy 与 VM origin
  reverse proxy 承接

它不覆盖 browser smoke 证据采集；那部分统一看
`execution-control-staging-smoke-runbook.md`。
它也不作为通用 Linux server 部署文档；server handoff 见
`execution-control-server-handoff.md`。

## 当前真相

- `apps/execution-control` staging deploy substrate 必须由 live env / ingress /
  projection evidence 证明；本文的 Compose runtime 是 local / transitional
  operations baseline，production target deploy substrate 已由 ADR-0056 收口为
  Kubernetes + KEDA
- `app-api` 是唯一 product/API gateway；`execution-control` 不进入用户可见 endpoint
  list，也不作为 QA public endpoint
- 当前 repo-owned staging execution runtime：
  - `infra/local/docker-compose.execution-control-runtime.yml`
  - `otel-collector`
    - repo-owned runtime telemetry fan-out
    - local OTLP ingress `4317/4318`
    - health check `13133`
  - `execution-control`
    - `trusted-worker`
    - `127.0.0.1:27051`
    - `/healthz` `/readyz` `/metrics`
    - Temporal-backed execution run command/query seam：
      `/internal/execution/runs`,
      `/internal/execution/runs/:runId`,
      `/internal/execution/runs/:runId/events`,
      `/internal/execution/runs/:runId/steps`,
      `/internal/execution/runs/:runId/cancel`
    - PG-backed sanitized projection store：run store、events、step projection
      artifacts for app-api / panel / eval reads
    - Temporal workflow/activity workers for execution scheduling and retry
  - `workflow-worker`
    - Temporal workflow task poller for `campus-agent.workflow`
  - `activity-worker-context`
    - Go-owned context activity poller for `campus-agent.activity.context`
    - owns capability-neutral memory recall before routing
  - `agent-runtime`
    - Node/TypeScript model-facing primary agent runtime based on OpenAI
      Agents SDK
    - exposes only internal `/internal/agent-runs` behind the bridge shared secret
  - `activity-worker-agent`
    - Go-owned primary agent activity poller for `campus-agent.activity.agent`
    - calls `agent-runtime` and projects SDK selected tools, typed tool
      success/fail-close results, usage and trace refs
  - `activity-worker-knowledge-plan`
    - Go-owned RAG planning / evidence selection / grounding poller for
      `campus-agent.activity.knowledge.plan`
  - `activity-worker-knowledge-retrieval`
    - Go-owned Qdrant / embedding lookup poller for
      `campus-agent.activity.knowledge.retrieval`
  - `activity-worker-knowledge-synthesis`
    - Go-owned provider synthesis poller for
      `campus-agent.activity.knowledge.synthesis`
  - `activity-worker-finalization`
    - Go-owned finalization activity poller for `campus-agent.activity.finalization`
  - `activity-worker-campus-services` / `activity-worker-notice` /
    `activity-worker-navigation`
    - Go-owned structured capability pollers behind the `structured-tools`
      Compose profile
    - not part of default staging serving while the corresponding product
      capabilities are not open in the staging runtime profile
  - `worker-autoscaler`
    - explicit Docker Compose dry-run / apply evidence producer behind the
      `ops-proof` Compose profile; it does not write workflow/run/step/event or
      terminal state, and it is not started by the normal staging serving
      command.
  - `temporal-task-queue-sampler`
    - explicit `ops-proof` evidence producer that samples Temporal task queues
      and updates bounded operator runtime current projections.
  - `temporal`
    - self-hosted Temporal frontend/history/matching/worker service
    - dedicated Temporal Postgres persistence / visibility store
  - `temporal-ui`
    - local-only operator UI
    - behind the `ui` Compose profile; not started by default
  - self-hosted Langfuse stack
    - optional eval / trace UI runtime
    - not part of default staging serving startup; start with
      `infra/local/staging/start-execution-control-staging.sh --with-langfuse`
      only when a session needs the self-host UI and ClickHouse-backed trace
      store
- machine ingress：
  - hostname: `execution-control-staging.mucwiki-edge.link`
  - Cloudflare DNS: proxied A/AAAA/CNAME 指向 staging VM
  - Cloudflare Access application: only service-token policy
  - VM reverse proxy: `443` -> `127.0.0.1:27051`
  - app-api 调用时同时带 Cloudflare Access service token 与
    `x-worker-origin-auth` shared secret；两者缺任一都必须 fail closed
- shared staging `app-api`：
  - `<https://api-staging.mucwiki-edge.link`>
- canonical staging host：`nc-arm-6c`, repo path `/srv/apps/campus-agent`
- 常驻机制：
  - Docker Compose runtime: `infra/local/staging/start-execution-control-staging.sh`
  - strict health check:
    `infra/local/staging/status-execution-control-staging.sh --check`
  - lifecycle lock: `.tmp/execution-control-staging/lifecycle.lock`

默认启动只拉起主问答 serving runtime。按需入口：

```bash
# 主链路 serving runtime
infra/local/staging/start-execution-control-staging.sh

# 同时打开 Temporal UI
infra/local/staging/start-execution-control-staging.sh --with-ui

# 同时打开 closed structured capability workers
infra/local/staging/start-execution-control-staging.sh --with-structured-capabilities

# 同时打开 self-hosted Langfuse stack
infra/local/staging/start-execution-control-staging.sh --with-langfuse

# 只停止 Langfuse 重服务，保留 volumes 和主链路
infra/local/staging/stop-execution-control-langfuse.sh
```

以上是当前 `nc-arm-6c` staging host 特定形态，不代表 production substrate。

当前 staging execution runtime 口径：

- staging 必须证明 Temporal-backed execution path、run projection store、
  workflow worker、primary agent runtime/worker、RAG activity worker、finalization
  activity worker 与 app-api execution runtime ready。
- staging 不再使用 PG lease worker loop / recovery loop 作为 online serving path；旧 lease
  表只允许作为 historical migration artifact 存在。
- ADR-0047 时代的 scheduler / recovery / lane worker label 只作为历史 target role
  label 存在；target execution substrate 已由 ADR-0048 收口为
  `execution-control` + Temporal workflow/activity worker pools。
- staging 的 Docker Compose、origin reverse proxy、Cloudflare DNS 与 Cloudflare Access
  只负责部署与连接；不拥有 workflow history、task queue、run projection、event 或
  terminal truth。
- Temporal task queue sampler 与 worker autoscaler 是显式 ops proof，不是常驻
  serving loop。需要采集 proof 时运行
  `infra/local/staging/run-execution-control-ops-proof.sh`；默认
  `start-execution-control-staging.sh` 不启动它们。
- K8s/KEDA target runtime 的 deployment 和 autoscaling 设计见
  `../architecture/system/kubernetes-execution-runtime-architecture.md`；本 runbook 在
  切换前继续描述当前 Docker Compose staging baseline。
- Redis 不参与 canonical execution queue。若以后用于 wakeup / fanout / cache，丢失或重启不得影响
  execution workflow / run projection / step projection / event truth。
