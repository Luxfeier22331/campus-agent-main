---
doc_type: decision
truth_scope: repository
owner_boundary: docs/decisions
decision_id: ADR-0018
status: accepted
created: 2026-03-29
updated: 2026-06-30
---
# ADR-0018 App API Official Web Control-Plane Ownership

适用范围：`official_web` source channel 的 crawl-run 控制面、collector 上报入口、operator 查询面与
ingestion-control task admission ownership

## 当前边界说明

本 ADR 的 app-api official-web control-plane ownership 仍然有效；其中把
`apps/ingestion-worker` 描述为 offline executor / release task runtime 的段落已由
ADR-0054 局部 supersede。当前 release task runtime owner 是
`apps/ingestion-control`；`apps/ingestion-worker` 只保留 Python extraction adapter
island。

2026-06-30 后，official-web 不再保留 app-api 专用 terminal handoff receiver。
`apps/app-api` 的 projection drain 直接从 terminal run outbox 与
`source_truth_bundle` artifact ref admission ingestion-control task。历史文档中的
“ingestion handoff”只应理解为 outbox-driven task admission，不表示还存在
`official_web_*_handoff.v1` wrapper contract。

## 背景

当前仓库已经具备以下事实：

- `official_web` 已被接受为 repo 级一级 `source_channel`
- `apps/ingestion-worker` 是离线 ingestion/data-plane executor
- Operator Console 的当前 read-only implementation surface 是 `apps/operator-console-web`，并已冻结为
  `runtime APIs only` 的 protected Worker shell
- shared `apps/app-api` 已落地为 Worker runtime，并拥有产品层 admission、durable
  ledger/outbox 与 operator read-model 形态

但对于 `official_web` 仍缺一条长期清晰规则：

- collector Docker 的 run admission、heartbeat、finalize、operator read-model 与
  ingestion handoff 应由谁拥有

如果这条规则不冻结，后续很容易长出四类腐烂路径：

- 再建一个只服务 crawler 的第二控制面后端
- 让 collector 直接调用 `apps/ingestion-worker` 或直写下游真相
- 让 Operator Console 直接读对象存储、队列、日志或 Qdrant 来拼状态页
- 让 `apps/ingestion-worker` 同时承担 crawler control plane 与 data-plane executor
  两种职责

## 决策 1：`official_web` control plane 的第一 owner 固定为 `apps/app-api`

结论：

- `official_web` control plane 的第一 owner 固定为 `apps/app-api`
- 它负责：
  - collector start / heartbeat / finalize 的 admission
  - crawl-run durable ledger
  - artifact reference registration
  - outbox / queue handoff
  - operator-facing list / detail runtime APIs
  - `official_web/stable_reference` target release gate 的 operator approve/reject
    command ledger
- 它不负责：
  - release task claim / lease / retry / dead-letter / publish 状态机
  - ingestion executor read / callback route
  - contact/service selected-write admission、task truth 或 intervention mutation

原因：

- `apps/app-api` 已经是共享 application boundary，并且已证明适合承接 admission、durable
  truth、outbox 和 operator read model
- 复用同一 control owner，可以避免为了 crawler 再造一条平行后端

## 决策 2：`apps/app-api` 的定位扩展为 shared application/control-plane backend

结论：

- `apps/app-api` 不再只用“shared product backend”理解
- 它的长期定位扩展为 shared application/control-plane backend
- 这次扩展不改变它不是 execution engine 的事实

原因：

- `official_web` control plane 仍属于
  app/runtime-owned control-plane concern，而不是 ingestion execution concern
- 这类职责与现有 `request_execution + projection_outbox + operator read model` 形态一致

## 决策 3：collector 只负责 crawl / normalize / artifacts

结论：

- collector 继续只负责：
  - crawl / fetch / normalize
  - 上传 `capture/`、`provider/`、`source-truth/`；如需要 source-side persisted
    projection artifact，则继续上传同一 source prefix 下的
    `projection/<projection_name>/...`；并上传 run artifacts
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

- `apps/ingestion-worker` 继续只负责消费 app-owned handoff，并执行 raw-asset
  registration、projection、document/chunk/index 相关工作
- 它不直接暴露 collector-facing control-plane admission surface
- `packages/ingestion-core` / `apps/ingestion-worker` 拥有 official-web release task
  state machine，包括 claim、lease、retry、dead-letter、materialize、publish 与失败状态
- contact/service selected-write 的 machine admission 与 task 推进属于 ingestion data
  plane，不属于 `apps/app-api`

原因：

- 这能保持 online control plane 与 offline execution plane 分层清晰
- 避免 ingestion worker 扩张成第二个对外 backend

## 决策 5：Official Web 只扩成聚焦 operator domain，不扩成通用 infra console

结论：

- Operator Console 对 `official_web` 的第一波扩展固定为聚焦 operator domain：
  - `Official Web / Sites`
  - `Official Web / Crawl Runs`
  - `Run Detail`
  - `Failures` / `Artifacts` 详情区块
- 不默认引入对象存储控制台、队列控制台、Qdrant 控制台或 generic jobs console
- Operator Console 不调用 release task mutation route；selected-write / release 进度只能通过
  `apps/app-api` 暴露的 operator-safe projection 或 ingestion 投影后的 read model 展示

原因：

- Operator Console 已冻结为受控 operator control plane，而不是万能内部平台
- `official_web` 的第一需求是让 operator 看懂 site/run/failure/artifact，而不是暴露底层基础设施

## 后果

直接结果：

- 需要新增 `app-api` 下的 `official_web` HTTP contract、run lifecycle 与 schema 文档
- `official_web` source-channel 文档必须明确 `app-api` 是 control-plane owner
- Operator Console 里的 official-web 规划必须从“generic Jobs/Operations”转向聚焦
  `Official Web` domain

明确不做：

- 不新增第二个 crawler-intake backend
- 不让 collector 直接调用 `apps/ingestion-worker`
- 不让 Operator Console 直读对象存储、队列、日志、Qdrant 或数据库
- 不把 `apps/app-api` 扩成 crawl executor 或 ingestion orchestrator
- 不把 selected-write / release task claim、retry、publish 状态放进 `apps/app-api`

## 2026-05-02 边界修订：Release Task Ownership

本 ADR 的 “app-api owns official-web control plane” 不包括 offline release task 状态机。

固定边界：

- `apps/app-api` 可以记录 operator command ledger 与 operator-safe projection
- `apps/app-api` 可以接收 ingestion worker 上报的 redacted release task projection
  snapshot，并把它作为 operator read model 暴露给 panel
- `apps/app-api` 不提供 selected-write admission/task routes，也不提供 release
  executor read/callback routes
- `official_web.target_release_gates` 只表达 stable-reference 的 approve/reject
  ledger，不表达 executor running/materialized/indexed/published/failed 进度
- `packages/ingestion-core` 定义 release task contract 与状态推进
- `apps/ingestion-worker` 执行 release task，并把结果写入 canonical projection /
  document/index release path，同时上报 operator-safe projection snapshot
- Operator Console 只消费投影，不直接干预 release task；当前 read-only 实现 surface 是
  `apps/operator-console-web`

实施说明：

- 本 ADR 只冻结 accepted direction
- 它不表示 `official_web` control plane 已经在代码中全部实现

## 2026-06-12 边界修订：Ingestion-Control 接管 Release Task Runtime

ADR-0050 接受 `apps/ingestion-control` 作为 ingestion task control plane 与
registry-aware executor。自该边界生效后，本 ADR 中由 `apps/ingestion-worker` 承担
offline executor / release task runtime 的表述只作为历史背景保留。

更新后的固定边界：

- `apps/app-api` 仍只拥有 official-web control plane、operator command ledger 与
  operator-safe projection read model
- `apps/ingestion-control` 拥有 ingestion task admission、claim / lease、retry、
  dead-letter、materialize、publish、closeout 与 operator-safe projection snapshot
- `packages/ingestion-core` 保留 canonical data-plane contract 与 collection strategy，
  不再通过 Python collection CLI 或 worker facade 定义 task lifecycle
- `apps/ingestion-worker` 只保留 Python extraction adapter island；official-web
  lifecycle 不回退到 Python worker command

## 2026-06-30 边界修订：Official-Web Terminal Handoff 退出

固定边界：

- `apps/app-api` 保留 crawl-run ledger、artifact refs、terminal outbox 与
  operator-safe projection ownership
- terminal run 不再生成或发布 `official_web_*_handoff.v1` wrapper
- app-api projection drain 直接构造 `ingestion_task_envelope.v1`，以
  `source_truth_bundle` 的 `s3://...` object-store ref 作为 `input_ref`
- `ingestion_dispatch_ref` 保存 ingestion-control task id；字段名是历史 schema
  命名，不代表仍有独立 official-web handoff object
- `apps/ingestion-control` 的 official-web `source_truth_materialize` handler
  读取 `official_web_source_truth_bundle.v1`，验证 referenced page source-truth
  objects，并以 artifact refs close out

## 相关文档

- `docs/architecture/domains/official-web/architecture.md`
- `docs/contracts/app-api/official-web.md`
- `docs/data/app-api/official-web.md`
