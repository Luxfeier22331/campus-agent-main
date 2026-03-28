---
doc_type: plan
status: active
created: 2026-03-29
updated: 2026-03-29
---

# Official Web App API Control-Plane Foundation 实施方案

**Goal:** 在不新增第二控制面后端的前提下，落地 `apps/app-api` 作为 `official_web` source channel 的 control-plane owner，并保持 `apps/ingestion-worker` 继续只是 offline executor。

**Architecture:** 本次实施固定采用 `external scheduler -> collector Docker -> object storage + app-api official_web APIs -> app-api ledger/outbox/read model -> ingestion-worker -> document/chunk/index`。`apps/app-api` 负责 crawl-run admission、artifact refs、operator query surface 与 ingestion handoff；collector 继续只负责 crawl/fetch/normalize/upload/report；`apps/ingestion-worker` 继续只负责 offline execution。

## 目标

这份方案只回答五个问题：

- `official_web` control plane 由谁拥有
- collector、`app-api`、`ingestion-worker` 与 panel 之间如何分层
- 第一版 HTTP contract、run lifecycle 与 schema 长什么样
- 面向 panel 的 `Official Web` operator domain 应如何扩展
- 实施应如何分波次推进，才能避免再长出第二中间层或临时兼容层

本轮明确不做：

- 不新增 crawler-intake backend
- 不让 `apps/ingestion-worker` 对 collector 暴露 admission HTTP surface
- 不让 panel 直读对象存储、队列、Qdrant、数据库或日志
- 不把 `apps/app-api` 扩成 crawl executor 或 ingestion orchestrator

## 设计输入

这份方案基于以下已冻结 truth：

- `docs/architecture/official-web-source-channel.md`
- `docs/architecture/official-web-source-truth-contract.md`
- `docs/architecture/official-web-control-plane-on-app-api.md`
- `docs/architecture/app-api-architecture.md`
- `docs/architecture/shared-app-api-and-worker-web-surfaces.md`
- `docs/contracts/app-api-official-web-http.md`
- `docs/contracts/app-api-official-web-run-lifecycle.md`
- `docs/data/app-api-official-web-schema.md`
- `docs/decisions/adr-0018-app-api-official-web-control-plane-ownership.md`
- `docs/architecture/protected-panel-runtime-shell.md`

## 波次拆分

### Wave 1. 文档与边界冻结

目标：

- 冻结 `official_web -> app-api` 的 accepted direction、HTTP seam、lifecycle、schema 与 panel expansion handoff

交付物：

- ADR、architecture、contract、data、plan 文档
- `docs/README.md` 索引更新
- `.planning/` 中 panel inventory / plan / state 对齐

验收：

- 不再把 `app-api` 写成 product-only backend
- 不再把 `Requests` 写成 blocked
- `official_web` control plane 的 owner、executor、panel read path 都有明确文档

当前状态：

- 本 wave 已于 2026-03-29 随这套文档落盘完成

### Wave 2. App API Persistence And Collector Command Surface

目标：

- 在 `apps/app-api` 内落地 `official_web.*` schema、service-principal admission 与 collector command endpoints

交付物：

- schema 与 migration
- `POST /api/official-web/runs`
- `POST /api/official-web/runs/:runId/heartbeats`
- `POST /api/official-web/runs/:runId/finalize`
- `official_web.run_outbox`
- command-side tests

必须做到：

- `siteId + schedulerRunKey` 幂等
- artifact refs 先 durable，再 handoff
- run truth 与 ingestion status 分开建模

### Wave 3. Handoff Consumer And Operator Projections

目标：

- 让 `official_web.run_outbox` 能驱动 ingestion handoff 与 panel-friendly projections

交付物：

- outbox consumer / queue publisher
- `operator.official_web_site_projection`
- `operator.official_web_run_projection`
- abandoned-run marking 机制
- query endpoints tests

必须做到：

- 不让 panel 直读 outbox 或底层 tables
- ingestion handoff 与 panel projection 都以 outbox 事实为上游

### Wave 4. Protected Panel Official Web Domain

目标：

- 在 `apps/protected-panel-web` 增加聚焦 `Official Web` operator domain

交付物：

- BFF adapters for `official_web` APIs
- `Official Web / Sites`
- `Official Web / Crawl Runs`
- `Run Detail`
- `Failures` / `Artifacts` detail sections

必须做到：

- browser 仍只打 panel-local `/api/*`
- 不引入 generic jobs console、object storage console 或 Qdrant console

### Wave 5. Collector Integration And End-To-End Verification

目标：

- 让 collector Docker 能按新 control-plane contract 跑通 start/heartbeat/finalize + ingestion handoff

交付物：

- collector service-credential wiring
- object-storage artifact refs wiring
- end-to-end smoke flow
- operator-visible sample run

必须做到：

- collector 不直接调用 `apps/ingestion-worker`
- ingestion worker 只从 handoff event 开始接力
- smoke evidence 能同时证明 crawl status 与 ingestion dispatch status

## 里程碑验收

这条方案完成时，至少必须满足：

- `apps/app-api` 已成为 `official_web` 的唯一 control-plane owner
- collector 已通过 app-owned contract 上报 run lifecycle
- `apps/ingestion-worker` 仍然只是 offline executor
- panel 可以查看 sites、runs 与 run detail
- 文档、代码与 planning 不再残留“第二控制面后端”或“generic ops console”倾向

## 非目标

- 不在此方案中决定所有 future source channels 都复用同一套 HTTP 细节
- 不在此方案中交付凭证化登录抓取的完整能力
- 不在此方案中把 `Jobs` / `Operations` 重开成 panel 第一波范围
