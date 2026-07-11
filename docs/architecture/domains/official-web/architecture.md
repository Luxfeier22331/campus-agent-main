---
doc_type: architecture
truth_scope: data
owner_boundary: domains/official-web
status: active
created: 2026-04-02
updated: 2026-07-10
---
# Official Web Architecture

## 文档边界

本文冻结 `official_web` source channel 的 supporting architecture 与消费目标模型。

它回答：

- collector、source bucket、`apps/ingestion-control`、`apps/app-api` 的 owner 边界
- official-web 从采集到 indexed knowledge/structured projection 消费应分几步
- 哪些内容是当前已实现链路，哪些只是目标态
- `stable_reference`、`fresh_news`、regulations、calendar 等 target 如何分流
- 哪些配置文件只声明 profile / hint，不等于 query-serving 已发布

它不负责：

- page-level source-truth 字段细节；见 `docs/data/official-web.md`
- HTTP route DTO；见 `docs/contracts/app-api/official-web.md`
- shared Postgres 表形态；见 `docs/data/app-api/official-web.md`
- crawl URL 规则；见 `docs/policies/official-web-crawl-policy.md`
- chunking 细节；见 `docs/policies/official-web-chunking.md`
- release、staging 或某次 workstream 的 closeout 证据

## Current Implemented Shape

当前 official-web 主链路已经具备：

```text
source-collector official-web adapter
-> source bucket page/run artifacts
-> ingestion-control official_web collector control plane
-> crawl-run ledger / heartbeat / finalize / run outbox
-> source-truth ref verification task
-> operator-safe run/site/task projection
-> app-api operator query
```

当前还没有完整打通：

```text
source-truth
-> canonical document units
-> chunks
-> embedding / index build
-> release manifest
-> serving alias publish
```

因此，当前 `source_truth_materialize` 名称只能按“source-truth ref verification /
handoff”理解。它读取 run-level `source_truth_bundle`，校验 digest 与 page artifact
refs，并把 refs 作为 task closeout evidence 返回；它不生成 canonical document、
chunk、index 或 serving alias。

当前 operator surface 展示的是 crawl/run/freshness/target/release-gate/projection
状态，不证明 downstream serving 已发布。

Current status labels:

- implemented: capture, run ledger, source-truth ref verification, task closeout
  evidence and operator-safe projection.
- compatibility name: `source_truth_materialize` currently means source-truth
  ref verification / handoff only. Do not copy this name to new target lifecycle
  steps.
- accepted target, not implemented: canonical document units, chunk sets, index
  build, release manifest and serving alias publish.
- reserved / closed: `stable_reference` and `fresh_news` query-serving profiles
  exist as target configuration only until the full release path is proven.

## Target Consumption Model

official-web 的目标消费链路必须逐步成立，每一步只消费上一层明确产物：

1. `capture`
   - collector 抓取页面并写入 `capture/`、`provider/`、`source-truth/` artifacts。
2. `run_finalize`
   - `apps/ingestion-control` 持有 crawl-run terminal truth 与 run artifact refs。
3. `source_truth_verify`
   - ingestion task 读取 `official_web_source_truth_bundle.v1`，校验 bundle、
     page manifest 与 content blocks refs。
4. `target_admit`
   - 只允许命中 explicit target admission 的 pages 进入下游消费。
5. `document_materialize`
   - 按 selected target 生成 canonical document units 或 structured projection。
6. `document_units_validate`
   - 用 deterministic validator 校验 document units contract。
7. `chunk_prepare`
   - 仅对 query-serving target 生成 chunk set。
8. `index_build`
   - 仅对 query-serving target 建立 candidate vector/sparse/hybrid index。
9. `release_validate`
   - 校验 release manifest、chunk/index metadata、serving config identity 与必要
     eval gate。
10. `release_publish`
    - 只有 release gate 通过后，才切换 current pointer 或 serving alias。
11. `operator_project`
    - app-api 只接收 redacted projection 或读取 ingestion-control operator projection。

缺少任一步时，不能把该 target 描述成 query-ready 或 published。

## Owner Boundaries

### `apps/source-collector`

负责：

- crawl / fetch / parse / normalize
- source bucket artifact writes
- run lifecycle report to ingestion-control
- source-level consumer match metadata and audit counters

不负责：

- task admission
- source-truth mutation after capture
- document registry
- chunking / embedding / indexing
- Qdrant alias publish
- app-api operator ledger

### `apps/ingestion-control`

负责：

- collector service admission
- crawl-run ledger、heartbeat、finalize、artifact refs
- target workset resolution
- terminal outbox drain
- ingestion task admission and Temporal workflow start
- registry-aware task execution
- source-truth verification, document materialization, chunk/index/release execution
  when those handlers exist
- operator-safe ingestion projection exposed to app-api

不负责：

- browser product ingress
- Operator Console UI
- source adapter auth or crawl execution internals

### `apps/app-api`

负责：

- operator list/detail query
- stable-reference release gate command ledger
- redacted release task projection ingest/read
- proxying ingestion-control operator projection where explicitly contracted

不负责：

- collector write routes
- target workset resolution
- selected-write admission/task execution
- release publish execution
- object storage browser or source-truth replay

### Operator Console

Operator Console 只消费 app-api exposed operator surfaces。它不得直连 object
storage、Qdrant、Temporal、source bucket 或 ingestion-control admin routes。

## Target Admission

official-web 是 `source_channel`，不是一个默认知识库。是否进入下游消费由 target
admission 决定。

Target admission 的 canonical source 是 repo-tracked source config：

- `configs/sources/official_web/<site_id>/target-source-map.json`
- `configs/sources/official_web/<site_id>/consumer-denominator.json`
- `configs/sources/official_web/<site_id>/target-inventory.json`

这些文件当前有重叠字段。Current fact: 这是 transition state，不是目标设计。设计目标是保留
一个 canonical target admission truth，其他文件只做 operator 展示、source-pack 或校验输入，
不再重复定义 owner、selected-write target 和 materialization policy。

固定规则：

- `hosts.json` / `seeds.json` 只说明 source reachability，不打开 downstream target。
- `projection-declarations.json` 只能作为 target admission 后的 page-family action
  hint；它不得独立把 broad crawl 页面 fan out 到 `stable_reference`。
- listing pages 默认 discovery-only。只有页面本身命中 target denominator 时，才可成为
  answer-bearing source。
- 未命中 target-source-map 的 broad crawl evidence 不得进入 projection drain、task
  admission 或 selected-write。
- selected write 必须携带 source refs、matched evidence、review verdict 或等价 deterministic
  extraction evidence。

## Target Surfaces

### `official_web/stable_reference`

用途：

- 长期稳定的学校官网参考信息，例如学校概况、机构设置、长期说明性页面。

边界：

- 目标态可以成为 institutional `knowledge_search` target；当前未完成发布闭环前
  不得进入 query-serving admission。
- 不承接正式规章、制度、培养方案；这些进入 `regulations/*` 或 `curriculum/*`。
- 不承接新闻、通知、活动、讲座类时效问答。
- query-serving config 存在不等于 index / alias 已发布；发布必须有 document、
  chunk、index、release manifest 和 alias publish evidence。

### `official_web/fresh_news`

用途：

- 新闻、通知、活动、讲座、媒体报道等 freshness-sensitive content 的候选 target。

当前治理结论：

- source config 中 notice/news target 仍是 `inventory_only`。
- `fresh_news` 的 serving config / runtime scope 只能视为 reserved profile。
- 没有 explicit source admission、freshness gate、document/chunk/index/release/publish
  闭环前，不得描述为 query-ready。
- “今天 / 最新 / 最近 / 刚刚”类问题不得只凭本地旧 index 回答。

### Regulations / Curriculum / Calendar

官网页面如果承载正式规章、制度、手册、培养方案或校历事实，下游 target 是对应 owner：

- `regulations/institutional_rules`
- `regulations/student_rules`
- `curriculum/*`
- `calendar/academic_calendar`，其 owner 是 `docs/architecture/domains/calendar/architecture.md`

不得为了保留 URL 来源，把这些内容复制成 `official_web/regulation`、
`official_web/curriculum` 或 `official_web/calendar`。

### Historical News / Archive

historical-news/archive 不是当前 official-web 默认 product surface。它只能在明确的
historical/operator/eval/analysis target 被设计并完成 release path 后打开。

## Freshness And Incremental Crawling

长期运行目标是 lane-aware incremental crawling：

- `baseline`
  - 低频广覆盖，发现栏目结构、迁移、删除与静态页面变化。
- `hot`
  - 高频窄范围，覆盖 listing pages、最近 detail pages、feed/sitemap 信号与高变更页面。
- `repair`
  - 失败恢复，覆盖 timeout、5xx、parser failure、中断 run 或 audit 复抓。

责任边界：

- scheduler 决定 lane、时间与预算；collector 不内置 cron。
- collector 执行 fetch / normalize / artifact upload。
- `apps/ingestion-control` 持有 page/url freshness state、dynamic planner、
  observation truth、terminal outbox 与 task admission。
- `hostFilter` 只能缩小已准入 workset，不能替代 target admission。
- HTTP `304`、仅 fetch metadata 变化、仅 body hash 变化或 `fetch_failed` 不单独
  触发 page-change handoff object。

## Config Semantics

配置文件分层如下：

- `configs/sources/official_web/*`
  - source reachability、scheduler、target admission、source-pack、operator inventory。
- `configs/ingestion/official_web/*`
  - collection profile、split/chunk profile、task registry、serving config declaration。
- `configs/runtime/query-serving-scopes.v3.json`
  - runtime query admission policy。

这些配置只声明 policy/profile/registry。它们不证明：

- source-truth 已 materialize 成 canonical documents
- chunks 已生成
- Qdrant collection 已建
- serving alias 已发布
- freshness gate 已证明

## Forbidden Shapes

- 不把 `official_web` 整体打开成默认 query-serving。
- 不把 config existence 当成 published serving truth。
- 不让 collector 直接写 document registry、query-serving runtime、Qdrant index 或 alias。
- 不让 app-api 恢复 collector write routes 或 ingestion executor callback。
- 不让 `projection-declarations.json` 重新变成 broad crawl fan-out owner。
- 不把 listing snippets 当成正式 news / notice answer evidence。
- 不允许在线搜索结果反向写入 source truth、release manifest 或 index。
- 不恢复 Python app-level ingestion worker 或旧 collection CLI 作为 serving fallback。

## Related Documents

- Current merged architecture: `docs/architecture/current.md`
- Data-plane architecture: `docs/architecture/system/data-plane.md`
- Retrieval serving: `docs/architecture/system/retrieval-serving.md`
- Source-truth schema: `docs/data/official-web.md`
- Shared schema: `docs/data/app-api/official-web.md`
- App-api HTTP contract: `docs/contracts/app-api/official-web.md`
- Crawl policy: `docs/policies/official-web-crawl-policy.md`
- Chunking policy: `docs/policies/official-web-chunking.md`
- Decision record: `docs/decisions/adr-0070-official-web-target-first-consumption.md`
