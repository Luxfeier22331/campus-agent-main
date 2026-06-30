---
doc_type: architecture
truth_scope: data
owner_boundary: domains/official-web
status: active
created: 2026-04-02
updated: 2026-05-04
---
# Official Web Architecture

## 文档边界

本文冻结 `official_web` source channel 的 repo-level supporting architecture。

它回答的是：

- collector、`app-api`、object storage、`ingestion-control` 如何分层
- crawl policy、source-truth contract 与 operator/control-plane surface 各自属于谁
- `official_web` 如何接入 shared product/runtime architecture
- `official_web` 如何执行 freshness / incremental crawling
- 官网稳定参考、时效新闻与历史新闻应如何拆分 serving surface

补充约束：

- 当前 merged truth 与 runtime opening posture 以
  `docs/architecture/current.md` 与 `.planning/` 为准
- 本文不维护 `fresh_news` / `news_archive` 的当前开放状态、单轮执行进度或 closeout 证据

## Core Topology

`external scheduler -> official-web collector -> object storage + app-api
official_web control plane -> app-api ledger/outbox/read model ->
ingestion-control task registry/executor -> release task state machine ->
document/chunk/index / structured projection ->
app-api operator-safe projection -> Operator Console`

关键边界：

- collector 负责 crawl / fetch / normalize / upload / report
- `apps/app-api` 负责 admission、crawl-run ledger、artifact refs、operator query 与
  ingestion-control task admission；它还接收 ingestion-control 上报的 redacted
  release task projection
- `apps/ingestion-control` 是 offline task control plane 与 registry-aware executor，负责
  release task claim / lease / retry / materialize / index / publish
- `apps/ingestion-worker` 只保留 Python extraction adapter island；official-web
  lifecycle 不回退到 Python collection CLI
- Operator Console 通过 `apps/app-api` 消费 `official_web` operator surfaces 与
  release task projection read model；当前 read-only implementation surface 是
  `operator-console-web`
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
- `configs/sources/official_web/muc_public/target-source-map.json`

允许的 retained consumer families：

- `academic_calendar_candidate`：只进入 `calendar/academic_calendar` 结构化投影
  offline-preparation source evidence；官方网页与校历图片只保留 source evidence，必须经
  人工/OCR 校验后的结构化 records 才可进入 calendar data asset
- `stable_reference_candidate`：只进入 `official_web/stable_reference` release gate
- `regulation_candidate`：只进入 `regulations/institutional_rules` release gate；
  不再把校级规章候选页混入 `official_web/stable_reference`
- `student_regulation_candidate`：只进入 `regulations/student_rules` release gate；
  用于信息公开学生工作栏目下的公开学生规章，不再把这类学生向规则硬塞进
  `regulations/institutional_rules`
- `notice_news_candidate`：只保留 inventory-only evidence；不得打开
  `fresh_news`、`news_archive` 或 notice/news runtime

边界：

- collector 只能附加 consumer match metadata 和 retained/rejected counters，不直接写
  downstream read model
- ingestion staging 负责 replay、candidate review report 与 release gate 证据；
  app-api 只暴露已入库 projection、release task operator-safe projection 与 stable-reference
  operator release gate command ledger
- selected write 必须有 source refs、matched evidence、review verdict 或等价的
  deterministic extraction evidence，并且只能写显式 `selected_write_target` 对应的
  structured projection
- listing pages 默认只作 discovery；除非自身命中 stable/regulation/calendar/notice
  denominator，否则不作为 answer-bearing source-truth
- target-first official-web source pack 不再产出 service-guide 或 contact-directory
  selected-write candidate；这类 wiki-maintained 内容不进入 repo runtime truth

### Target Source Map

`target-source-map.json` 是 consumer-driven collection 的定点采集地图。

它负责把下游会消费的 target 显式映射到：

- `consumer_family`
- `owner_surface`
- `selected_write_target`
- `source_hosts`
- `url_hints` / `title_hints`
- `required_evidence`
- `optional_evidence`
- `retention_policy`
- `review_policy`
- `materialization_policy`
- `inventory_only`

边界：

- target source map 是采集准入与运营评审提示，不是 current read model
- 它必须与 `consumer-denominator.json` 的 family / owner / selected-write target 保持一致
- `required_evidence` 表示 selected-write release-blocking denominator；
  `optional_evidence` 表示允许以 `source_not_provided` 暴露给 operator 的 source-backed
  optional denominator
- `hosts.json` / `seeds.json` 是 source reachability registry；target source map 才是
  target-first collection declaration
- 不在 target source map 中的 broad crawl 证据不得自动进入 projection drain、task
  admission 或 selected-write
- news / notice 类 target 当前保持 inventory-only，不打开 `fresh_news` 或 `news_archive`
- 服务信息扩面必须继续以具体 URL 为单位 admission；当前已 admission 的 support host
  包括 `met.muc.edu.cn`，但只用于信息化服务指南/联系方式等 target-first 页面，不代表恢复
  host-wide broad crawl。

### Legacy Broad Crawl Cleanup

旧契约下产生的 broad official-web crawl 不做物理硬删除。

清理形态固定为：

- collector 默认执行必须 fail closed：没有 `app-api` target workset admission 时，不得从
  `enabled hosts` 或 `hostFilter` 自行推导 collection scope
- `hostFilter` 只允许缩小已准入 target workset；它不是 target admission
- 不再允许显式 legacy/debug collector run；没有 `app-api` target workset admission 时必须
  fail closed
- `apps/app-api` 不再为 `official_web` 维护独立 run cleanup admission ledger
- projection drain 直接推进 admitted run 的 operator projection 与 ingestion-control task
  admission，不再读取 `legacy_contract_excluded` 之类的历史 cleanup decision
- 本地 `.tmp` / collector `.tmp` 证据目录可以删除；PG source ledger 与对象存储 source-truth 不因
  cleanup CLI 自动删除

## Policy And Contract Split

- crawl policy：`docs/policies/official-web-crawl-policy.md`
- source-truth
  contract：`docs/data/official-web.md`
- repo-level data-plane contract：`docs/architecture/system/data-plane.md`
- shared file asset loader：`docs/architecture/system/file-asset-loader.md`
- official-web freshness、serving split 与 news retrieval strategy：本文

## Control-Plane Ownership

`apps/app-api` 持续是 `official_web` control-plane owner。

它负责：

- crawl run admission
- lifecycle / heartbeat / finalize
- artifact refs
- operator list / detail query
- ingestion-control task admission dispatch
- release task operator-safe projection ingest/read

它不负责：

- collector 内部 frontier / parser 代码结构
- downstream document splitting / chunking 逻辑
- release task claim、lease、retry、dead-letter、publish 或 selected-write task mutation

## Operator Surface

`official_web` operator domain 当前属于 Operator Console：

`operator console surface -> app-api official_web APIs`

它不是：

- 新的 crawler-intake backend
- Operator Console 侧自建 aggregation backend
- 直接暴露 object storage 或 telemetry sink

## Runtime Opening Guardrail

`official_web` source channel 的存在，不等于 `fresh_news` / `news_archive` 已经进入默认产品回答面。

固定规则：

- `official_web/stable_reference` 才是默认 institutional reference surface
- `official_web/fresh_news` 只允许作为 intent-scoped、freshness-sensitive surface 单独开放
- `official_web/news_archive` 只允许服务显式历史查询、operator、评测或分析用途
- news surface 的 query opening policy 属于 serving/runtime contract，不属于 collector

## Freshness And Incremental Crawling

`official_web` 的长期目标不是偶发全量 crawl，而是可持续的新鲜度闭环：

- `baseline` lane：低频广覆盖，发现新栏目、结构变化、迁移、删除与长期静态页面变化。
- `hot` lane：高频窄范围，覆盖 listing pages、最近新发现 detail pages、
  feed/sitemap 最近变更信号与高变更页面。
- `repair` lane：失败恢复和异常复查，覆盖 timeout、5xx、parser failure、中断 run
  或 audit 要求复抓的页面。

长期运行形态固定为：

```text
external scheduler
-> collector Docker run
-> object storage + app-api official_web control plane
-> ingestion-control incremental execution
-> document registry / structured projection
```

页面新鲜度与变化判定的 durable truth 归 `apps/app-api` control plane 所有，不归：

- collector 本地缓存
- object storage 目录扫描
- `apps/ingestion-control` 内部 task 状态

collector 通过 `POST /api/official-web/plans:resolve` 从 `app-api` materialize
lane-aware dynamic workset。`hostFilter` 只允许缩小已准入的 target workset，不能替代
target admission。

下游 ingestion-control task admission 只由 terminal run outbox 和
`source_truth_bundle` artifact refs 驱动。HTTP `304`、仅 body hash 变化、仅 fetch
metadata 变化或 `fetch_failed` 不触发独立 page-change handoff object。条件请求、
sitemap/RSS hint 和 listing diff 只服务 discovery / priority / observation，不替代变化真相。

责任边界：

- scheduler 决定 lane、时间与预算；collector 不内置 cron。
- collector 执行 fetch / normalize / artifact upload，产出 `new / changed / deleted /
  not_modified / fetch_failed` 摘要。
- `app-api` 持有 run ledger、page/url freshness state、dynamic planner、observation
  truth、terminal outbox 与 operator query surface。
- `ingestion-control` 消费 app-api admission 的 `source_truth_bundle` task，不扫描对象存储
  反推 freshness，也不消费 official-web 专用 terminal handoff wrapper。
- 少量动态壳页走独立 browser-capable provider lane，不污染主 HTML crawl lane。

## Serving And News Retrieval

`official_web` 是统一 source channel，不是单一默认官网知识库。下游 serving 必须按语义拆分：

- `official_web/stable_reference`
- `official_web/fresh_news`
- `official_web/news_archive`

核心规则：

- `stable_reference` 可进入默认 institutional knowledge RAG。
- `fresh_news` 面向新闻、公告、活动、讲座、媒体报道等时效内容，默认通过 owning
  tool/runtime policy 消费，不作为 `knowledge` 自动升级面。
- `news_archive` 只服务显式历史查询、operator、评测或分析用途，不参与 recent-news 默认回填。
- 官网页面如果承载正式规章、制度、手册、培养方案正文或等价规范性事实，下游应进入
  `regulations/*` 或 `curriculum/*`，不得复制成 `official_web/regulation` /
  `official_web/curriculum`。
- contact、办事指南与流程说明当前不提升为 repo-owned service/process/contact runtime；只能作为
  `stable_reference` 或 wiki 上游来源。

时效 query 的固定策略：

- “今天 / 最新 / 最近 / 刚刚”不能只凭本地 `is_current=true` 回答。
- 如果 local freshness 满足阈值，可以回答。
- 如果 local freshness 不满足阈值，应由 owning tool/runtime 执行 bounded live assist 或
  fail-close。
- bounded live assist 只能命中 admitted `official_web` source channel；target selection
  必须显式冻结。
- 不允许用旧新闻、`latest_url`、listing snippet 或措辞润色伪装成当前事实。

opening guardrails：

- 不把 `official_web/*` 整体开放为默认 query-serving。
- 不把 `fresh_news` 开成 `knowledge` 默认消费面。
- 不把 `listing_page` projection 当成正式新闻问答证据。
- 不用 seed import、单次 qrels、hot-lane crawl 频率或本地回答样例证明 runtime opening。
- `fresh_news` 需要 article-detail evidence、freshness gate、routing split 与 stale
  fail-close 共同成立。
- `news_archive` 必须 `query_enabled_by_default=false`，只服务 explicit historical /
  operator / analysis / eval 场景。

## Forbidden Shapes

- 不把 collector 内嵌进 `apps/ingestion-control` 或 Python adapter worker
- 不把 `official_web` control plane 拆成第二个产品 backend
- 不让 collector 直接写 document registry、query-serving runtime 或 retrieval index
- 不把 crawl policy、page schema、collection projection 语义混写成一篇文档

## 相关稳定文档

- `docs/architecture/current.md`
- `docs/contracts/app-api/official-web.md`
- `docs/data/app-api/official-web.md`
- `docs/decisions/adr-0018-app-api-official-web-control-plane-ownership.md`
