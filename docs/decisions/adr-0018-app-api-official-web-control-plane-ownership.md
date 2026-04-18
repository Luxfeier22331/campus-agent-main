---
doc_type: decision
decision_id: ADR-0018
status: accepted
created: 2026-03-29
updated: 2026-03-29
---

# ADR-0018 App API Official Web Control-Plane Ownership

适用范围：`official_web` source channel 的 crawl-run 控制面、collector 上报入口、operator 查询面与 ingestion handoff ownership

## 背景

当前仓库已经具备以下事实：

- `official_web` 已被接受为 repo 级一级 `source_channel`
- `apps/ingestion-worker` 是离线 ingestion/data-plane executor
- `apps/protected-panel-web` 已冻结为 `runtime APIs only` 的 protected Worker shell
- shared `apps/app-api` 已落地为 Worker runtime，并拥有产品层 admission、durable ledger/outbox 与 operator read-model 形态

但对于 `official_web` 仍缺一条长期清晰规则：

- collector Docker 的 run admission、heartbeat、finalize、operator read-model 与 ingestion handoff 应由谁拥有

如果这条规则不冻结，后续很容易长出四类腐烂路径：

- 再建一个只服务 crawler 的第二控制面后端
- 让 collector 直接调用 `apps/ingestion-worker` 或直写下游真相
- 让 panel 直接读对象存储、队列、日志或 Qdrant 来拼状态页
- 让 `apps/ingestion-worker` 同时承担 crawler control plane 与 data-plane executor 两种职责

## 决策 1：`official_web` control plane 的第一 owner 固定为 `apps/app-api`

结论：

- `official_web` control plane 的第一 owner 固定为 `apps/app-api`
- 它负责：
  - collector start / heartbeat / finalize 的 admission
  - crawl-run durable ledger
  - artifact reference registration
  - outbox / queue handoff
  - operator-facing list / detail runtime APIs

原因：

- `apps/app-api` 已经是共享 application boundary，并且已证明适合承接 admission、durable truth、outbox 和 operator read model
- 复用同一 control owner，可以避免为了 crawler 再造一条平行后端

## 决策 2：`apps/app-api` 的定位扩展为 shared application/control-plane backend

结论：

- `apps/app-api` 不再只用“shared product backend”理解
- 它的长期定位扩展为 shared application/control-plane backend
- 这次扩展不改变它不是 execution engine 的事实

原因：

- `official_web` control plane 仍属于 app/runtime-owned control-plane concern，而不是 ingestion execution concern
- 这类职责与现有 `request_execution + projection_outbox + operator read model` 形态一致

## 决策 3：collector 仍只负责 crawl / normalize / object-storage artifacts，不直接写下游 serving truth

结论：

- collector 继续只负责：
  - crawl / fetch / normalize
  - 上传 `capture/`、`provider/`、`source-truth/` 与 run artifacts
  - 向 `apps/app-api` 上报 run lifecycle 与 artifact refs
- collector 不负责：
  - document registry
  - chunking / embedding / indexing
  - Qdrant release / alias
  - query-serving metadata

原因：

- `official_web` source channel 的长期边界仍然是 “上游 source observations 与 source-truth”
- 下游 data plane 继续由中心 ingestion/runtime 负责

## 决策 4：`apps/ingestion-worker` 继续是 offline executor，而不是 crawler control-plane host

结论：

- `apps/ingestion-worker` 继续只负责消费 app-owned handoff，并执行 raw-asset registration、projection、document/chunk/index 相关工作
- 它不直接暴露 collector-facing control-plane admission surface

原因：

- 这能保持 online control plane 与 offline execution plane 分层清晰
- 避免 ingestion worker 扩张成第二个对外 backend

## 决策 5：protected panel 只扩成聚焦 `Official Web` 域，不扩成通用运维控制台

结论：

- panel 对 `official_web` 的第一波扩展固定为聚焦 operator domain：
  - `Official Web / Sites`
  - `Official Web / Crawl Runs`
  - `Run Detail`
  - `Failures` / `Artifacts` 详情区块
- 不默认引入对象存储控制台、队列控制台、Qdrant 控制台或 generic jobs console

原因：

- panel 已冻结为受控 operator control plane，而不是万能内部平台
- `official_web` 的第一需求是让 operator 看懂 site/run/failure/artifact，而不是暴露底层基础设施

## 后果

直接结果：

- 需要新增 `app-api` 下的 `official_web` HTTP contract、run lifecycle 与 schema 文档
- `official_web` source-channel 文档必须明确 `app-api` 是 control-plane owner
- panel 规划必须从“generic Jobs/Operations”转向聚焦 `Official Web` domain

明确不做：

- 不新增第二个 crawler-intake backend
- 不让 collector 直接调用 `apps/ingestion-worker`
- 不让 panel 直读对象存储、队列、日志、Qdrant 或数据库
- 不把 `apps/app-api` 扩成 crawl executor 或 ingestion orchestrator

当前状态说明：

- 本 ADR 只冻结 accepted direction
- 它不表示 `official_web` control plane 已经在代码中全部实现

## 相关文档

- `docs/architecture/official-web-architecture.md`
- `docs/architecture/official-web-architecture.md`
- `docs/contracts/app-api-official-web-http.md`
- `docs/contracts/app-api-official-web-run-lifecycle.md`
- `docs/data/app-api-official-web-schema.md`
- `docs/architecture/official-web-architecture.md`
