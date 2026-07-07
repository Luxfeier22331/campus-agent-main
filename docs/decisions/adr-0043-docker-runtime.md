---
doc_type: decision
truth_scope: repository
owner_boundary: docs/decisions
decision_id: ADR-0043
status: superseded
created: 2026-04-23
updated: 2026-06-16
superseded_by:
  - adr-0056-k8s-keda.md
---
# ADR-0043 Execution Control Docker-First Runtime

## 状态

Accepted on 2026-04-23. Superseded on 2026-06-16 by
`adr-0056-k8s-keda.md` for long-term production
deployment substrate.

Docker-first execution-control substrate 仍作为 current Docker Compose / local /
transitional staging baseline 的历史依据保留，但不再代表 production target
deployment substrate。本文早期把 Python `apps/supervisor-agent-worker` 作为 private
semantic worker 的运行时描述已由 ADR-0048、current architecture 与
`python-boundaries` 局部 supersede：Python supervisor worker 已从 active
workspace 删除，当前 online answer path 由 Go `apps/execution-control`、Temporal、
`agent-runtime` 与 typed activity workers 承接。

## 背景

`ADR-0012`、`ADR-0013` 与 `ADR-0017` 已经分别冻结了：

- `apps/app-api` 是 shared product/control-plane backend
- `apps/app-api` 的 runtime = Worker
- `apps/execution-control` 只是 internal execution engine
- `app-api -> execution-control` 是 canonical internal execution seam

但 `apps/execution-control` 的部署 substrate 一直没有正式冻结。

如果这件事继续悬空，后续实现很容易反复漂移为：

- 把 repo-local Python public dev entry 误当成长期 deploy truth
- staging / production 各自使用不同的 ad-hoc origin，而没有明确前向部署姿势
- 在“还没定 runtime”的借口下，把 execution engine boundary 再次拖回产品后端或临时脚本模型

## 决策

1. `apps/execution-control` 的前向 deploy substrate 冻结为 Docker-first internal
   execution service。
1. 这项冻结表达的是部署 substrate，不等于冻结单一 Python/HTTP framework。
1. 这项冻结不要求 `apps/execution-control` 与 `apps/app-api` 使用同一 runtime，也不把
   `apps/execution-control` 改写成 Worker。
1. `app-api` 继续通过显式 `EXECUTION_CONTROL_BASE_URL` 调用一个真实可达的 execution origin；
   这项 ADR 不单独冻结 repo-level staging hostname。
1. Go `execution-control` packaging / automation 落地后，repo-local Python public
   execution entry 已移除；后续也不得恢复 Python supervisor bridge worker。
1. Docker-first execution service 的 runtime control plane 由 Go `apps/execution-control`
   承担；semantic routing / planning / finalization 通过 Temporal-visible typed steps、
   `agent-runtime` 与 typed activity workers 表达。

## 边界约束

这项决策同时冻结以下约束：

- `apps/execution-control` 继续只是 internal execution engine，不重新吸收产品层 auth/session/
  conversation 或 browser-facing API 责任
- `app-api -> execution-control` 的 typed execution contract 不因 Docker substrate
  freeze 而改写
- repo-local dev server、named tunnel 或其他兼容桥接姿势不能再被表述为长期 deploy
  truth
- Docker-first 是部署 substrate truth，不是容器编排平台、镜像仓库、发布平台或 hostname
  的一次性总冻结

## 结果

直接结果如下：

- repo 入口文档与 architecture docs 必须把 `apps/execution-control = Docker-first internal
  execution service` 作为 accepted truth
- runbook 必须把当前 execution runtime truth 写成：
  `execution-control + Temporal + workflow-worker + activity-worker-core +
  agent-runtime + activity-worker-agent + activity-worker-knowledge +
  worker-autoscaler`
- dev-backed staging 兼容路径已退出 active runbook / script surface
- Go `apps/execution-control` 是当前 Docker execution ingress，拥有 execution transport、
  admission、queue、timeout、readiness、metrics 与 graceful drain
- 后续 Go 迁移优先吸收 deterministic execution runtime kernel：request
  lifecycle、cancel、per-lane budget、audit writer、runtime observability、
  fail-close envelope 与 projection-backed tool read model dispatch
- Go runtime 扩张不得把 product-layer auth/session/conversation、browser-facing
  tool policy、ingestion/OCR/indexing、RAG retrieval planning 或 agent semantic
  reasoning 拉进 Go `apps/execution-control`

## Complements

这项决策 complements：

- `docs/decisions/adr-0012-shared-app-api-and-worker-web-surfaces.md`
- `docs/decisions/adr-0013-app-api-worker-runtime.md`
- `docs/decisions/adr-0017-supervisor-internal-execution-admission.md`
