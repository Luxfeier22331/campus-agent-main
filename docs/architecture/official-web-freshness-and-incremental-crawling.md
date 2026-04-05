---
doc_type: architecture
status: active
created: 2026-03-30
updated: 2026-04-04
---

# Official Web Freshness And Incremental Crawling

## 文档边界

本文冻结 `official_web` source channel 从“抽样 crawl”走向“全量常态 crawl + 高频增量 crawl + 变更触发下游处理”的长期设计。

它回答的是：

- `official_web` 应如何同时支持广覆盖基线采集与新闻公告类高频采集
- 页面新鲜度、变化判定与下游重处理应由谁持有
- scheduler、collector、`apps/app-api`、`apps/ingestion-worker` 分别承担什么职责
- 哪些信号可以用于增量优先级，哪些信号不能被误当成真相

它不负责：

- 单个 host 的 allowlist、深度、节流与 URL admission 细则
- browser provider、正文抽取器或某个 parser 的代码实现
- `app-api` 物理 schema、queue vendor 或某个 deployment 平台
- 下游 collection 的 document cleanup、chunking 与 serving 策略

对应文档：

- source channel 总边界：`docs/architecture/official-web-source-channel.md`
- crawl 规则：`docs/architecture/official-web-crawl-policy.md`
- source-truth contract：`docs/architecture/official-web-source-truth-contract.md`
- control-plane ownership：`docs/architecture/official-web-control-plane-on-app-api.md`
- serving / news retrieval 策略：`docs/architecture/official-web-serving-and-news-retrieval-strategy.md`
- 当前 news handoff truth：`docs/reference/official-web-fresh-news-surface-handoff.md`
- app-api HTTP seam：`docs/contracts/app-api-official-web-http.md`
- app-api run lifecycle：`docs/contracts/app-api-official-web-run-lifecycle.md`
- phase-1 数据平面不变量：`docs/architecture/phase1-ingestion-and-storage-architecture.md`

## 目标

`official_web` 的长期目标不是“偶尔跑一次全量爬虫”，而是建立可持续的新鲜度闭环：

- 维持站点 URL 空间的稳定覆盖
- 对新闻、公告、通知、列表页等高更新面提供更高频率采集
- 在页面真实变化时，尽快触发 offline ingestion，而不是等下次全量重建
- 避免把增量抓取、变化判定与下游重处理混成 collector 私有逻辑

## 核心结论

- `official_web` 必须同时具备 `baseline lane`、`hot lane`、`repair lane` 三类采集形态。
- 页面新鲜度与变化判定的 durable truth 归 `apps/app-api` control plane 所有，而不是只存在于 collector 进程内存。
- collector 当前通过 `POST /api/official-web/plans:resolve` 从 `app-api` materialize lane-aware dynamic workset，而不是只靠静态 seed/host scope 盲跑。
- 页面是否需要下游重处理，必须以 `new / changed / deleted` 这类 page-level observation 为边界，由 `app-api -> ingestion-worker` handoff 驱动。
- `ETag`、`Last-Modified`、HTTP `304` 是增量抓取的首选协议信号；sitemap `lastmod`、RSS/Atom 时间戳只用于 discovery 与优先级，不是变化真相。
- 列表页变化必须驱动 detail 页优先复抓；新闻公告类更新不能只靠全站基线 crawl 兜底。
- `hot lane` 的长期第一服务对象是 `fresh_news` serving surface；列表页变化优先服务“新闻 detail 及时可检索”，而不是只刷新导航页本身。
- 当前 `docs/reference/official-web-fresh-news-surface-handoff.md` 里那 `8` 条 `future_fresh_news_surface` 文档应被视为后续 hot-lane / fresh-news work 的 seed set，而不是当前 `muc_public_pages` release gate 的继续治理对象。
- `fetch_failed` 是 repair lane 的一等输入，但不是下游 ingestion 的变化触发条件。
- 动态壳页应走独立 browser-capable provider lane；不得为了少量动态页面污染主 HTML/cheerio crawl 路径。

## 长期运行形态

长期拓扑固定为：

`external scheduler -> collector Docker run -> object storage + app-api official_web control plane -> ingestion-worker incremental execution -> document registry -> chunk/index`

其中：

- scheduler 决定跑哪一种 lane、何时跑、带什么预算
- collector 决定本次 run 具体抓哪些 URL，并执行 fetch / normalize / artifact upload
- `app-api` 持有 run ledger、page/url freshness truth、handoff outbox 与 operator query
- `apps/ingestion-worker` 只消费变化集合，不拥有 crawl freshness 真相

## 采集 Lane

### Baseline Lane

`baseline lane` 负责广覆盖、低频兜底。

它的职责是：

- 保持每个 enabled host 的 URL 空间可见
- 发现新栏目、新导航、站点结构变化与内容迁移
- 复查长期静态页面是否被删除、替换或重定向
- 为 `hot lane` 提供最新的列表页、详情页与分类页候选集合

它的特点是：

- 频率较低
- host 覆盖较广
- 每次 run 可接受较大的页面预算
- 允许更多 discovery 扩展，但仍必须遵守 host allowlist 与 URL admission

### Hot Lane

`hot lane` 负责高频、窄范围增量采集。

它优先覆盖：

- 新闻、公告、通知、学院动态、招生就业等 listing pages
- 最近新发现的 article/detail pages
- 有 feed、sitemap 最近变更信号或最近频繁变化记录的页面

它的特点是：

- 频率高于 baseline
- workset 明确受 freshness state 与启发式候选控制
- 默认优先使用条件请求，减少无意义重复下载
- 当 listing page 变化时，立即提升相关 detail pages 的抓取优先级

### Repair Lane

`repair lane` 负责失败恢复和异常复查。

它处理：

- 上次因超时、5xx、parser failure 失败的 URL
- `page_freshness.last_fetch_disposition=fetch_failed` 的页面
- heartbeat 中止或 run-level 中断后未确认终态的关键页面
- source-truth 或 quality audit 判定需要复抓的页面

它的目标不是扩大 coverage，而是缩短错误滞留时间。

## 新鲜度真相与页面状态

当前 `apps/app-api` 已落地 page-level freshness/readiness truth。

这里的 ownership 固定为 control plane，而不是：

- collector 本地缓存
- 对象存储目录扫描
- ingestion worker 内部 job 状态

推荐最小字段组：

- `site_id`
- `host`
- `normalized_canonical_url`
- `page_family`
- `discovered_from_url`
- `discovery_method`
- `last_fetch_status`
- `last_http_status`
- `etag`
- `last_modified`
- `response_body_hash`
- `main_content_hash`
- `last_seen_at`
- `last_changed_at`
- `last_not_modified_at`
- `cadence_class`
- `priority_score`
- `next_eligible_fetch_at`
- `last_successful_run_id`
- `last_change_reason`

字段语义固定如下：

- `response_body_hash`
  表示 retained response body 的内容指纹
- `main_content_hash`
  表示 source-truth 主体内容的稳定指纹；应优先作为下游是否重处理的判断依据
- `etag` / `last_modified`
  表示上游 HTTP freshness token；只用于条件请求与辅助变化判断
- `cadence_class`
  表示页面采集节奏，例如 `baseline_static`、`listing_hot`、`detail_recent`、`repair`
- `priority_score`
  表示当前调度优先级，不是文档价值分数

## 变化判定

### 可接受的变化信号

以下信号可用于判定页面可能变化：

- HTTP `200` 且 `ETag` 改变
- HTTP `200` 且 `Last-Modified` 推进
- `response_body_hash` 改变
- `main_content_hash` 改变
- listing page 的条目集合、目标链接或发布时间发生变化
- 页面返回 `404` / `410`

### 真正触发下游重处理的条件

下游 offline ingestion 不应因为“抓到了 200”就重跑。

应触发 handoff 的最小条件是：

- `new`
  第一次发现并成功规范化的页面
- `changed`
  `main_content_hash` 发生实质变化的页面
- `deleted`
  先前存在、现在稳定返回 `404` / `410` 或被显式判定移除的页面

下列情况默认不触发下游重处理：

- HTTP `304 Not Modified`
- 仅 `response_body_hash` 变化，但 `main_content_hash` 不变且变化只来自模板、时间戳、脚本或导航噪声
- 仅 fetch 时间、重定向链 metadata 或 provider hints 变化
- `fetch_failed`

## 条件请求规则

### HTTP Freshness

对已知 URL，collector 默认应按以下优先级执行条件请求：

1. `If-None-Match`
2. `If-Modified-Since`

规则固定为：

- 当 `ETag` 可用时，优先使用 `If-None-Match`
- 当只有 `Last-Modified` 可用时，回退到 `If-Modified-Since`
- 返回 `304` 时，不重新生成新的 source-truth 版本
- `304` 仍应更新 `last_seen_at`、`last_not_modified_at` 与本次 run observation

### Sitemap / Feed 信号

以下信号只作为 discovery 或优先级输入：

- sitemap `lastmod`
- RSS `pubDate` / `lastBuildDate`
- Atom `updated` / `published`

它们不能替代：

- HTTP 实际 fetch
- `response_body_hash`
- `main_content_hash`
- page-level canonical observation

## Listing-Detail 传播

列表页是 `official_web` 高频更新的核心枢纽。

因此固定要求：

- listing page 进入 `hot lane`
- listing page 每次变化后，都要执行条目 diff
- diff 出的新 detail URL 必须进入更高优先级的待抓集合
- 最近新发现的 detail page 在短窗口内应保持较高复抓频率，随后再降回 baseline cadence

这条规则尤其适用于：

- 新闻动态
- 通知公告
- 学院新闻
- 招生就业
- 活动讲座

## 调度模型

调度是外部 scheduler 的职责，但长期应明确三类 run intent：

- `baseline`
- `hot`
- `repair`

这三类 intent 可以通过 `triggerType`、run metadata 或 scheduler policy 承载，但约束不变：

- collector 仍然是一次性 Docker run
- 不在容器内内置 cron
- `siteId + schedulerRunKey + run_intent` 应构成更稳妥的幂等边界

当前已落地的 planner 解析顺序是：

1. scheduler 选择本轮 `runIntent`
2. collector 向 `app-api` 申请 `runId`
3. collector 调用 `POST /api/official-web/plans:resolve`
4. `app-api` 基于 `page_freshness` 的 `next_eligible_fetch_at`、`cadence_class`、`last_fetch_disposition` 返回 `duePages`
5. collector 在静态 host allowlist 内把 `duePages` 与 seeds/导航扩展合并成最终 frontier

推荐调度思路：

- `baseline`
  每日或每周运行，覆盖全部 enabled hosts
- `hot`
  每 5 至 30 分钟运行，只覆盖热点 listing 与最近活跃详情页
- `repair`
  低延迟补偿运行，只覆盖失败或待确认终态的 URL

## Collector Responsibilities

当前 collector 已具备以下能力：

- 从 repo-tracked site config 加载静态 scope truth
- 从 `app-api` freshness state 拉取动态 workset
- 对不同 lane 执行不同页面预算和优先级策略
- 对已知 URL 默认启用条件请求
- 在 finalize artifacts 中显式产出 `new / changed / deleted / not_modified / fetch_failed` 摘要
- 把 listing diff 结果和 page-level observation 一并上报给 control plane
- 对 `fetch_failed` 页面保留 repair-friendly observation，而不是静默吞掉

collector 仍然不负责：

- 决定 document registry 真相
- 直接触发 chunking、embedding、indexing
- 直接写 Qdrant 或 serving alias

## App API Responsibilities

`apps/app-api` 是这套新鲜度闭环的 owner。

它应承担：

- crawl-run ledger
- page/url freshness state
- lane-aware run admission
- collector-facing dynamic planner resolve
- page-level observation durable truth
- `new / changed / deleted / not_modified` 的 handoff 边界
- `fetch_failed -> repair lane` 的归档与再调度
- operator-facing site/run/page freshness query surface

它不应退化成：

- 真正执行爬虫的 runtime
- source-truth 内容主存储
- ingestion-worker 的内部 job runner

## Ingestion Worker Responsibilities

`apps/ingestion-worker` 只消费变化集合。

它的长期执行边界应是：

- 读取 terminal run 的 artifact refs
- 只对 `new / changed / deleted` 页面执行 raw/source-truth 投影与文档版本推进
- 对 `not_modified` 页面直接跳过
- 把删除同步到 document registry 与 index 删除路径

它不负责：

- 自己扫描对象存储判断 freshness
- 自己决定哪些 URL 属于热点页面
- 反向拥有 crawl scheduler 或 page cadence truth

## Browser-Capable Provider Lane

少量站点会暴露：

- 动态壳首页
- CSR/JS 主导内容
- 需要浏览器执行后才能看到正文的页面

长期要求是单独引入 browser-capable provider lane，而不是：

- 为这类页面放宽整个主 crawl policy
- 把所有 host 一起切换到浏览器抓取
- 在 source-truth contract 中混入浏览器运行时私有字段

主 HTML crawl lane 与 browser lane 必须共享同一 page freshness truth 和 source-truth 上游边界。

## Operator Surface

panel 的 `Official Web` freshness/operator 视图已开始落地，但仍然只通过 `app-api` query surface 读取。

当前已落地的第一批视图：

- lane 维度的最近 run 状态
- run detail 中的 `runIntent`、`pageChangeSummary`、`pageChanges`
- site detail 中的 `freshnessSummary`
- site detail 中的最近 run 与最近 page change 列表

后续仍应补齐：

- 最近连续失败页面列表的独立筛选面
- listing page 触发的 detail discovery 摘要

仍然不允许：

- panel 直读对象存储
- panel 直连 ingestion worker
- panel 把底层队列或数据库表当成查询面

## 非目标

- 不在本文冻结具体 cron 表达式或某个平台的 scheduler 配置
- 不在本文授权 collector 直接写 document registry 或 Qdrant
- 不在本文把 sitemap / feed 信号升级为 source-truth
- 不在本文让 `app-api` 变成第二个 ingestion executor
