---
doc_type: architecture
status: active
created: 2026-04-02
updated: 2026-05-01
---
# Official Web Architecture

## 文档边界

本文冻结 `official_web` source channel 的 repo-level supporting architecture。

它回答的是：

- collector、`app-api`、object storage、`ingestion-worker` 如何分层
- crawl policy、source-truth contract 与 operator/control-plane surface 各自属于谁
- `official_web` 如何接入 shared product/runtime architecture

补充约束：

- 当前 merged truth 与 runtime opening posture 以
  `docs/architecture/current-architecture.md`、`docs/domains/official-web.md` 与
  `.planning/` 为准
- 本文不维护 `fresh_news` / `news_archive` 的当前开放状态、单轮执行进度或 closeout 证据
- `fresh_news` / `news_archive` 的长期 opening criteria、default consumer posture 与
  freshness gate 统一看
  `docs/architecture/domains/official-web/serving-and-news-retrieval-strategy.md`
- repo-level opening contract 与 artifact checklist 统一看
  `docs/reference/official-web-news-surface-opening-checklist.md`

## Core Topology

`external scheduler -> official-web collector -> object storage + app-api
official_web control plane -> app-api ledger/outbox/read model ->
ingestion-worker -> document/chunk/index`

关键边界：

- collector 负责 crawl / fetch / normalize / upload / report
- `apps/app-api` 负责 admission、crawl-run ledger、artifact refs、operator query 与
  ingestion handoff
- `apps/ingestion-worker` 继续只是 offline executor
- protected panel 通过 `apps/app-api` 消费 `official_web` operator surfaces
- collector 写入 source bucket 的对象同时包含 page-level
  `capture/`、`provider/`、`source-truth/` artifacts；如后续 materialize source-side
  projection artifact，则继续写入同一 source prefix 下的
  `projection/<projection_name>/...`；此外还会写
  `official_web/{site_id}/runs/{run_id}/...` run artifacts

## Source Channel Rules

- `official_web` 是一级 `source_channel`，不是某个 collection 私有脚本
- crawl scope 的长期规则留在 policy 文档
- page-level source-truth schema 留在 contract 文档
- recovery 阶段默认使用 repo-tracked consumer denominator 决定 retained
  source-truth；host/page allowlist 只说明“可以抓”，不等于“应该进入下游消费”
- downstream serving / retrieval 继续只消费 document / chunk / registry truth
- downloaded file-like assets 不属于 page-level source-truth parser 的长期 owner；如果
  downstream 要消费它们，必须进入 shared file asset loader contract

## Consumer-Denominator Recovery

official-web recovery 的当前默认形态是 consumer-driven collection。

配置入口：

- `configs/sources/official_web/muc_public/consumer-denominator.json`

允许的 retained consumer families：

- `contact_directory_candidate`：只进入 contact directory selected-write candidate；
  需要 review 或 deterministic extraction 后才可写 current read model
- `service_guide_candidate`：只进入 service guide selected-write candidate；需要
  review 或 deterministic extraction 后才可写 current read model
- `stable_reference_candidate`：只进入 `official_web/stable_reference` release gate
- `notice_news_candidate`：只保留 inventory-only evidence；不得打开
  `fresh_news`、`news_archive` 或 notice/news runtime

边界：

- collector 只能附加 consumer match metadata 和 retained/rejected counters，不直接写
  downstream read model
- ingestion staging 负责 replay、candidate review report、selected-write dry-run
  gate 与 no-promotion proof
- selected write 必须有 source refs、matched evidence、review verdict 或等价的
  deterministic extraction evidence
- listing pages 默认只作 discovery；除非自身命中 stable/contact/service denominator，否则不作为
  answer-bearing source-truth

## Policy And Contract Split

- crawl policy：`docs/policies/official-web-crawl-policy.md`
- source-truth
  contract：`docs/data/official-web-source-truth-schema.md`
- repo-level data-plane contract：`docs/architecture/system/data-plane-architecture.md`
- shared file asset loader：`docs/architecture/system/file-asset-loader-architecture.md`
- serving split / news retrieval strategy：`docs/architecture/domains/official-web/serving-and-news-retrieval-strategy.md`
- freshness / incremental crawling strategy：`docs/architecture/domains/official-web/freshness-and-incremental-crawling.md`

## Control-Plane Ownership

`apps/app-api` 持续是 `official_web` control-plane owner。

它负责：

- crawl run admission
- lifecycle / heartbeat / finalize
- artifact refs
- operator list / detail query
- ingestion handoff dispatch

它不负责：

- collector 内部 frontier / parser 代码结构
- downstream document splitting / chunking 逻辑

## Operator Surface

`official_web` operator domain 当前属于：

`protected-panel-web -> app-api official_web APIs`

它不是：

- 新的 crawler-intake backend
- panel 侧自建 aggregation backend
- 直接暴露 object storage 或 telemetry sink

## Runtime Opening Guardrail

`official_web` source channel 的存在，不等于 `fresh_news` / `news_archive` 已经进入默认产品回答面。

固定规则：

- `official_web/stable_reference` 才是默认 institutional reference surface
- `official_web/fresh_news` 只允许作为 intent-scoped、freshness-sensitive surface 单独开放
- `official_web/news_archive` 只允许服务显式历史查询、operator、评测或分析用途
- news surface 的 query opening policy 属于 serving/runtime contract，不属于 collector

## Forbidden Shapes

- 不把 collector 内嵌进 `apps/ingestion-worker`
- 不把 `official_web` control plane 拆成第二个产品 backend
- 不让 collector 直接写 document registry、query-serving runtime 或 retrieval index
- 不把 crawl policy、page schema、collection projection 语义混写成一篇文档

## 相关稳定文档

- `docs/architecture/current-architecture.md`
- `docs/domains/official-web.md`
- `docs/contracts/app-api-official-web-http.md`
- `docs/contracts/app-api-official-web-run-lifecycle.md`
- `docs/data/app-api-official-web-schema.md`
- `docs/decisions/adr-0018-app-api-official-web-control-plane-ownership.md`
