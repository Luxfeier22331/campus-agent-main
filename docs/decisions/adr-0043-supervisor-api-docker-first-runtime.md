---
doc_type: decision
decision_id: ADR-0043
status: accepted
created: 2026-04-23
updated: 2026-04-23
---
# ADR-0043 Supervisor API Docker-First Runtime

## 状态

Accepted on 2026-04-23.

## 背景

`ADR-0012`、`ADR-0013` 与 `ADR-0017` 已经分别冻结了：

- `apps/app-api` 是 shared product/control-plane backend
- `apps/app-api` 的 runtime = Worker
- `apps/supervisor-api` 只是 internal execution engine
- `app-api -> supervisor-api` 是 canonical internal execution seam

但 `apps/supervisor-api` 的部署 substrate 一直没有正式冻结。

如果这件事继续悬空，后续实现很容易反复漂移为：

- 把 `campus-supervisor-api-dev` 误当成长期 deploy truth
- staging / production 各自使用不同的 ad-hoc origin，而没有明确前向部署姿势
- 在“还没定 runtime”的借口下，把 execution engine boundary 再次拖回产品后端或临时脚本模型

## 决策

1. `apps/supervisor-api` 的前向 deploy substrate 冻结为 Docker-first internal
   execution service。
1. 这项冻结表达的是部署 substrate，不等于冻结单一 Python/HTTP framework。
1. 这项冻结不要求 `apps/supervisor-api` 与 `apps/app-api` 使用同一 runtime，也不把
   `apps/supervisor-api` 改写成 Worker。
1. `app-api` 继续通过显式 `SUPERVISOR_API_BASE_URL` 调用一个真实可达的 execution origin；
   这项 ADR 不单独冻结 repo-level staging hostname。
1. `campus-supervisor-api-dev` 继续保留为 repo-local debug / smoke / staging compatibility
   bridge 入口，直到 repo-owned Docker packaging / automation 落地。

## 边界约束

这项决策同时冻结以下约束：

- `apps/supervisor-api` 继续只是 internal execution engine，不重新吸收产品层 auth/session/
  conversation 或 browser-facing API 责任
- `app-api -> supervisor-api` 的 typed execution contract 不因 Docker substrate
  freeze 而改写
- repo-local dev server、named tunnel 或其他兼容桥接姿势不能再被表述为长期 deploy
  truth
- Docker-first 是部署 substrate truth，不是容器编排平台、镜像仓库、发布平台或 hostname
  的一次性总冻结

## 结果

直接结果如下：

- repo 入口文档与 architecture docs 必须把 `apps/supervisor-api = Docker-first internal
  execution service` 作为 accepted truth
- runbook 必须显式区分“forward deploy truth”和“当前仍在使用的 compatibility bridge”
- 后续实现应补齐 repo-owned Docker packaging / automation，并在落地后收敛现有 dev-backed
  staging 兼容路径

## Complements

这项决策 complements：

- `docs/decisions/adr-0012-shared-app-api-and-worker-web-surfaces.md`
- `docs/decisions/adr-0013-app-api-worker-runtime.md`
- `docs/decisions/adr-0017-supervisor-internal-execution-admission.md`
