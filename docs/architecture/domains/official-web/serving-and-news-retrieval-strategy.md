---
doc_type: architecture
status: active
created: 2026-04-02
updated: 2026-05-02
---
# Official Web Serving And News Retrieval Strategy

## 文档边界

本文冻结 `official_web` 在进入 document/chunk/index 之后的长期 serving 与 retrieval 策略。

它回答的是：

- `official_web` 是否应该直接作为单一官网知识库进入默认 RAG
- 官网稳定页面与新闻动态应如何拆成不同 serving surface
- `official_web` 与 `regulations/*`、`curriculum/*` 的 corpus 边界应如何划分
- `listing_page`、`article_detail`、`directory_page` 等 document family 在 retrieval
  中分别承担什么角色
- 对“最近”“最新”“今天”这类时效敏感问题，query path 应如何处理

它不负责：

- collector 的 host allowlist、crawl frontier、robots 与 parser 细节
- `official_web` source-truth 字段级 schema
- 当前某个 collection 的 runtime profile JSON 具体字段实现
- live search provider、browser provider 或具体第三方产品选型

对应文档：

- source channel 总边界：`docs/architecture/domains/official-web/architecture.md`
- freshness /
  增量采集：`docs/architecture/domains/official-web/freshness-and-incremental-crawling.md`
- 数据平面不变量：`docs/architecture/system/data-plane-architecture.md`
- retrieval runtime
  baseline：`docs/architecture/system/retrieval-serving-architecture.md`
- full agentic retrieval
  target：`docs/architecture/system/agentic-retrieval-architecture.md`
- 长期版本化 serving / 历史查询目标：`docs/decisions/adr-0014-versioned-document-serving-and
  -history-query.md`
- current-scope cleaning / chunking
  规则：`docs/policies/official-web-cleaning-and-chunking-policy.md`
- 当前 handoff 真相：`docs/reference/official-web-fresh-news-surface-handoff.md`

## Current Merged-Truth Constraint

当前 merged truth 下，`official_web` 仍处于：

`source-truth -> declared projections -> canonical document artifacts`

这意味着：

- `official_web/muc_public_pages` 当前仍主要用于 projection truth 与本地 quality gate
- 它尚未自动成为默认 query-serving collection
- 本文描述的是长期 target shape，而不是当前已经上线的 retrieval truth

当前已固定的 handoff truth 为：

- 当前 default stable-reference answer gate 只消费
  `configs/ingestion/official_web/stable_reference/split-manifest.v1.json`、
  对应 qrels 与 live gate；不再从 mixed `muc_public_pages` inventory 推导
- `muc_public_pages` 只保留 current truth / regression truth / audit truth，不是默认
  query-serving gate
- 当前 `8` 条新闻页已显式转入 future `fresh_news` handoff，而不是当前 stable-reference gate 的延迟候选

## 问题定义

`official_web` 的网页并不都属于同一种 retrieval 语义。

至少要区分两类：

- `stable reference` 例如机构介绍、办事说明、院系概况、联系方式、长期有效信息
- `fresh news` 例如新闻、公告、通知、活动、讲座、媒体报道

如果把两类内容直接并入一个默认官网知识库，会产生三类长期问题：

- 稳定制度类问答会被短期新闻噪音污染
- 新闻内容的时效风险会被误包装成“长期事实”
- “最新/今天”类问题会被本地旧索引误答

因此长期正确形态不是“一个 `official_web` collection 解决所有官网问答”，而是：

`统一 source channel + 分层 serving surface`

## 核心结论

- `official_web` 继续作为统一 source channel 存在，不因 serving 语义差异拆成多个采集系统。
- `official_web` 下游允许 fan-out 到多个 serving surface 与 tool-owned runtime
  surface，但具体 serving policy 不由 collector 决定。
- `official_web` 的长期收口不是继续冻结为单一 `muc_public_pages`，而是区分
  `official_web/stable_reference` 与面向时效内容治理的
  `official_web/fresh_news`、`official_web/news_archive`。
- 官网稳定页面与新闻动态不得默认并入同一个 institutional retrieval surface。
- `stable_reference` 可以进入默认 institutional knowledge RAG。
- `fresh_news` 必须作为时效内容 source family / tool-owned runtime surface 单独治理，而不是默认
  generic RAG collection。
- `fresh_news` 与未来 `notice-agent` / news runtime 是同一类时效内容 owner；讲座、活动、公示、结果等
  notice-like 内容应按 routing 进入 notice discovery / canonical notice
  reading，而不是自动并入 `rag-agent`。
- `regulations/*` 与 `curriculum/*` 继续是与 `official_web/*` 并列的正式语义 corpus，不应再派生出
  `official_web/regulation` 或 `official_web/curriculum` 这类镜像层。
- `listing_page` 默认不作为新闻主 evidence；它主要承担 discovery、freshness trigger、navigation
  hints。
- `article_detail` 才是新闻问答的默认主 evidence。
- 同一篇新闻如果在 `news`、`xxgk` 等多个官网 host 上重复发布，serving truth 必须收口为一个逻辑
  document/version；多 URL 差异保留在 provenance/source observations，而不是扩成多份 evidence。
- 对“最新”“今天”“最近”这类强时效 query，单靠本地 news index 不足以形成长期正确答案 contract；必须具备显式 freshness
  gate，并由 owning tool/runtime 执行 bounded live assist 或 fail-close，而不是落进
  `rag-agent` 默认回答面。
- 在当前 `muc_public_pages` workstream 中，`listing_page` 与 staged-only
  `generic_content_page` 仍允许存在于 replay/audit truth，但不得被重新包装成 promotable release
  truth。
- 当前 `future_fresh_news_surface` seed set 只定义后续 news surface handoff，不改变上面的长期
  serving 原则。

## Agentic Retrieval Alignment

对 `official_web` 而言，full agentic retrieval 的 generic vocabulary 不自动等于产品路由真相。

固定规则：

- `stable_reference` 仍可作为 `rag-agent` 的 `current` institutional reference
  surface
- “今天 / 最新 / 最近 / 刚刚”这类官网时效问题，不应被路由到 `rag-agent`
- `freshness_sensitive / live_assisted` 可以保留为 repo-level generic retrieval
  vocabulary，但对 `official_web` 的真实消费应由 tool/runtime path admission，而不是
  `rag-agent` 自动升级
- `listing_page` 即使在 tool-owned live path 中也默认不是 answer-bearing evidence

## Relationship To Structured Notice Runtime

长期上，`official_web/fresh_news` 应作为时效内容 source family 被 `notice-agent` / news
runtime 消费，而不是并行再开一条 `rag-agent` generic retrieval surface。

固定区分如下：

- `fresh_news`
  - 面向新闻、讲座、活动、公告等时效内容的 source family / projection owner
  - 默认通过 tool/runtime 路由消费，而不是 `rag-agent` generic retrieval
- `notice-agent`
  - 面向“帮我找通知/讲座/公示/结果”“把这条通知打开”这类显式 notice task
  - 通过 discover / get contract 返回 canonical notice metadata 与 normalized content
  - 可以作为 future public notice source family 被 structured runtime 消费，但这不自动决定
    restricted notice source 如何并入同一 runtime

这意味着：

- 同一 source channel 可以同时供给 `stable_reference` RAG surface 与时效 notice/news
  runtime
- opening `fresh_news` 不等于所有 notice-like 页面都必须默认进入 generic RAG
- 用户 intent 是“找 notice”或“问最近发生了什么/最新情况是什么”时，应先走 owning tool/runtime；若该 runtime
  不可用，则 fail-close，而不是误路由到 `rag-agent`
- public notice runtime 与 restricted notice runtime 是否共享同一个 `notice-agent`
  source matrix，必须由显式 contract 冻结，而不是由 `fresh_news` opening 或 source-channel
  命名隐式决定
- future public notice runtime 的 query seam 必须继续是 projection-backed：
  - `campus_notice_discover` 读取 notice card / summary projection
  - internal selected notice resolve（`payload_kind=campus_notice_get`）只读取
    selected notice card / bounded context projection 与 display policy，不作为
    body-serving tool
  - `article_detail` 继续是正文主 owner，`listing_page` 只提供 discovery / recency signal
  - 不得直接把 `fresh_news` collection alias 当成 discover/get 的 runtime query seam

## Corpus Boundary

`source channel`、`corpus`、`collection` 在 `official_web` 场景中不是同一层。

固定边界如下：

- `official_web` 继续表示统一网页来源的 source channel
- `official_web/*` 下游 retrieval collection 只承接“官网 public-web 语义”本身
- 正式规章制度、手册、培养方案等强语义文档，继续进入与 `official_web` 并列的专用 corpus

因此长期目标不是：

- `official_web/muc_public_pages`
- `official_web/regulation`
- `official_web/curriculum`

而是：

- `official_web/stable_reference`
- `official_web/fresh_news`
- `official_web/news_archive`
- 与之并列的 `regulations/*`
- 与之并列的 `curriculum/*`

固定解释：

- `official_web/stable_reference`
  - 承接官网公开说明页、机构介绍、联系方式、院系概况、办事说明、培养概览等稳定参考内容
- `official_web/fresh_news`
  - 承接新闻、公告、活动、讲座、媒体报道等时效内容
- `official_web/news_archive`
  - 承接脱离 freshness window 的历史新闻
- `regulations/*`
  - 承接正式规章、制度、手册、办法、细则等规范性文档
- `curriculum/*`
  - 承接正式培养方案、毕业要求、课程结构、学分要求等课程培养文档

这意味着：

- 官网页面如果只是对制度或培养体系的公开介绍、摘要说明、招生/培养概览，它仍可留在 `official_web/stable_reference`
- 官网页面如果承载的是正式规章正文、正式培养方案正文或等价的规范性事实，下游应归入 `regulations/*` 或 `curriculum/*`
- 官网页面如果主要是品牌历史、校史人物、名人传记或宣传性荣誉展示，默认只保留 source /
  inventory audit truth，不进入当前 `official_web/stable_reference` 默认回答面；后续如果产品明确要服务校史人物类查询，必须开显式
  `brand_history` / 校史人物类 surface。
- 不要因为来源 URL 在官网 host 下，就把所有内容都留在 `official_web/*`
- 也不要为了“来源来自官网”再复制一套 `official_web/regulation` 或 `official_web/curriculum`
- 如果后续 direct contact-fact query 被提升为 `contact_directory_lookup` 这类 structured
  runtime tool，则 public contact page 可以继续留在 `stable_reference` 作为 public-web
  reference / provenance 上游，但不再长期充当 canonical contact runtime owner
- 如果后续 direct service-process query 被提升为 `service_process_lookup` 这类 structured
  runtime tool，则 public service-entry / 办事说明页可以继续留在 `stable_reference` 作为
  public-web reference / provenance 上游，但不再长期充当 canonical process runtime owner

当前 `official_web/muc_public_pages` 只承担 mixed current-truth bridge：

- 它是 replay、QC、import/release candidate 与 forced validation 的过渡 collection
- 它不是长期最终 corpus split
- 后续 runtime/config 拆分应从它演进到上面的长期 collection 形态，而不是继续扩大 mixed collection 的职责

## Serving Surface 分层

### Stable Reference

`stable_reference` 面向长期有效、制度性或说明性内容。

适合纳入这类 surface 的页面包括：

- `directory_page`
- 稳定的 `generic_content_page`
- 经 projection 后具有稳定语义的说明类 `article_detail`

它的长期特点是：

- 可以进入默认 institutional RAG 面
- `current_only` 可以更强
- 更关注事实准确率、去重、主来源归并与证据回链
- 不需要因为“今天有没有更新”而改变答案 contract

### Fresh News

`fresh_news` 面向官网新闻、公告、活动、讲座、媒体报道等时间敏感内容。

它的长期特点是：

- 与 `stable_reference` 分离治理
- query 进入条件由 intent routing 与 owning tool/runtime admission 决定
- 强依赖 `published_at`、`crawled_at`、`last_seen_at` 等时间元数据
- consuming runtime 可以带时间过滤、时间排序或 recency bias
- 当 freshness 不满足阈值时，不得继续伪装成“最新事实”，也不得退回 `rag-agent` 继续回答旧索引

### News Archive

对历史新闻，长期允许保留 archive surface，但它不等于默认在线回答面。

它主要服务：

- operator 回溯
- 运营分析
- 评测
- 未来显式历史查询

在默认回答路径里，`news_archive` 不应与 `fresh_news` 混为一体。

## Opening Posture And Criteria

长期上，`fresh_news` / `news_archive` 的 opening posture 固定遵循“默认关闭，满足条件后按窄 intent
开放”。

`fresh_news` 只有在以下条件同时成立时，才允许进入真实 tool/runtime 消费面：

- `article_detail` 已成为新闻问答主 evidence，而不是继续依赖 `listing_page`
- `published_at`、`crawled_at`、`last_seen_at` 等时间元数据覆盖达到可路由、可排序、可判 stale 的程度
- cross-host duplicate news 已在逻辑 document/version 层归并，不再把同一条新闻扩成多份 competing
  evidence
- query routing 已能把“校园新闻/近期活动/讲座/通知”和“稳定说明类问题”显式分流
- freshness gate 已接到 owning runtime；当 freshness 不足时，系统会执行 bounded live assist 或
  fail-close，而不是继续回答旧索引

`news_archive` 的 opening 条件更严格：

- 默认不进入公开默认回答面
- 只在显式历史查询、operator 回溯、评测或分析场景下开放
- 不与 `fresh_news` 共用一个“最近新闻” surface，也不参与默认 RAG 混检

因此：

- `fresh_news` 的 seed baseline、local import/release、离线 qrels 或 eval 命中率，不自动等于
  runtime opening approval
- `news_archive` 的存在只证明 repo 已保留历史语义，不证明当前产品应默认消费它

## Document Family 语义

长期上，`official_web` document family 在 retrieval 中的角色固定如下：

- `article_detail`
  - 新闻、公告、活动类问答的默认主 evidence
  - 如果需要 query-enable 新闻面，应优先从这类 detail 文档进入
- `listing_page`
  - 主要承担 discovery、listing-diff、priority propagation 与 navigation hints
  - 默认不作为新闻问答主 evidence
  - 只有业务显式接受“导航级证据”时，才允许作为独立 navigation evidence surface
  - 在当前 `muc_public_pages` scope 中，它只应作为 staged audit truth 保留，不应进入 promoted
    current truth
- `directory_page`
  - 适合进入 `stable_reference`
  - 仅限 roster / contact / department-directory 一类稳定参考页
  - homepage / portal-style `directory_page` 只保留 staged audit truth，不进入 promoted
    current truth
- `generic_content_page`
  - 必须按内容语义再分流
  - 不能因为 family 名称泛化，就自动进入同一个 serving surface
  - 当前 portal-like / sparse-link-hub generic 页应继续停留在 staged-only / manual-review
    lane
- `dynamic_shell_page` / `structural_shell_page`
  - 不进入正文 serving；仍停留在 manual review 或独立 browser-capable source lane

## Freshness Policy

`fresh_news` 的长期正确性依赖“current truth + freshness truth”共同成立。

固定原则如下：

- `is_current` / `revision_track` 仍由 `DocumentRegistry` 表达
- “够不够新”不能只由 `is_current=true` 推断
- `fresh_news` 需要额外的 freshness gate，例如：
  - 最大允许文档年龄
  - 最近一次 crawl 成功时间
  - 最近一次 listing/detail 变化确认时间
- 当 query 明确要求“今天”“最新”“最近”时：
  - 如果本地 freshness 满足阈值，可以回答
  - 如果本地 freshness 不满足阈值，应由 owning tool/runtime 执行 bounded live assist 或
    fail-close
- tool-owned live assist 不是任意 live fetch：
  - 只能命中 admitted `official_web` source channel
  - live target selection 必须由 owning tool/runtime 显式冻结
  - 若 target 尚未进入可执行 posture，则继续 fail-close，而不是隐式扩成 browse

长期上，repo 不接受以下错误路径：

- 旧新闻被默认当成当前事实
- 命中历史内容后仅靠 `latest_url` 或措辞润色伪装成当前结果
- 用 `listing_page` 的导航片段替代 detail 证据来回答时效问题
- 把当前 `docs/reference/official-web-fresh-news-surface-handoff.md` 中的 seed set
  误读成“当前 mixed `muc_public_pages` 已经是 fresh-news serving surface”

## Query Routing Policy

长期上，supervisor / agent 对 `official_web` 至少要区分三种 query intent：

- 稳定制度 / 说明 / 联系方式
  - 优先走 `stable_reference`
- 明确的部门电话 / 邮箱 / 办公地点 / 联系人联系方式查询
  - 在 `contact_directory_lookup` later-wave admission 完成后，应优先走
    `campus_services/contact_directory` 的 structured runtime seam
  - admission 完成前，不应把该能力伪装成 contact directory；只能走已开放的 stable-reference
    answer contract，或明确返回未开放
- 明确的办理步骤 / 材料 / 入口 / 适用人群查询
  - 在 `service_process_lookup` later-wave admission 完成后，应优先走
    `campus_services/service_catalog` 的 structured runtime seam
  - admission 完成前，不应把该能力伪装成 service process；只能走已开放的 stable-reference
    answer contract，或明确返回未开放
- 校园新闻 / 近期活动 / 某学院近况
  - 走 `fresh_news` 对应的 tool/runtime surface
- “今天 / 最新 / 刚刚 / 最近”
  - 先进入 owning runtime 的 freshness gate
  - 不满足时执行 bounded live assist 或 fail-close

默认不接受的消费方式：

- 把 `fresh_news` 与 `stable_reference` 混成单一默认 institutional surface
- 把 `news_archive` 作为 fresh-news 的回填库，在用户未显式要求历史信息时一并召回
- 因为语料质量波动，就让 `listing_page` 或 inventory-only 页面顶替 `article_detail` 成为主 evidence

这里冻结的关键规则是：

- 是否命中 `fresh_news` 属于 routing / serving policy，不属于 collector
- 是否允许 bounded live assist 属于 owning runtime policy，不属于 ingestion cleanup
- personalization hint 可以帮助决定“问的是哪个学院/栏目”，但不能绕过 freshness gate

## Evidence Policy

`fresh_news` 不需要另一套完全不同的 evidence / retrieval stack。

如果 owning runtime 需要证据召回与引用，长期上仍可复用 repo 的 retrieval baseline：

`metadata pre-filter -> dense + sparse -> RRF -> registry-backed evidence
shaping`

但这不等于把 `fresh_news` 重新开放成 `rag-agent` 的 query-serving collection；它需要的是
collection-specific tool/runtime policy：

- 默认启用时间相关 metadata filter
- 默认允许 recency bias
- 默认显式区分 `fresh_news` 与 `news_archive`
- 默认不与 `stable_reference` 混成一个 query-serving collection
- 对低信号 query 必须允许 fail-close；例如学校名裸问、无锚点生活服务问法，不应强行返回随机旧新闻

如果后续推进 full agentic retrieval，这条线可复用的 generic building blocks 仍包括：

- query-mode-aware planning
- freshness gate step
- admitted `live_assisted` step
- supporting evidence selection

换句话说，变化的是 owning runtime、query mode、plan/execution policy，而不是放弃 repo 的
retrieval/evidence contract。

## Evidence Contract

新闻类 evidence 的长期回答 contract 必须比稳定知识更严格。

至少应返回：

- 来源标题
- 来源 URL
- 发布时间或可回链的时间字段
- 必要时返回抓取时间

当回答建立在新闻语料之上时：

- 不得省略时间语义
- 不得把旧报道改写成当前状态断言
- 若命中的只是 listing/navigation 证据，应明确标注为“导航级线索”，而不是正文事实证据
- admitted live evidence 如果进入最终回答，也必须显式保留时间语义与来源语义

## Metadata And Runtime Profile Requirements

长期上，如果 `official_web` 要开放 news-serving，至少需要以下 metadata 进入 registry / payload /
runtime policy：

- `published_at`
- `crawled_at`
- `last_seen_at`
- `host`
- `page_family`
- `section`
- `news_kind`
- `is_current`

对应 runtime profile 长期至少要能表达：

- 是否 query-enable
- surface 类型：`stable_reference` / `fresh_news` / `news_archive`
- `current_only`
- `serving_revision_tracks`
- `required_metadata_fields`
- `primary_evidence_page_families`
- `listing_page_role`
- `requires_freshness_gate`
- `requires_explicit_history_intent`
- `duplicate_collapse_required`
- 时间过滤窗口 / stale 阈值
- 是否允许 live-search expansion

当前 repo 已把这些 shape 固定进 `runtime-profile.json`：

- `configs/ingestion/official_web/stable_reference/runtime-profile.json`
- `configs/ingestion/official_web/fresh_news/runtime-profile.json`
- `configs/ingestion/official_web/news_archive/runtime-profile.json`

固定解释：

- `fresh_news` 的 profile 即使仍是 `offline_preparation`，也必须先表达 detail-only
  主证据、必需时间元数据、duplicate collapse 与 freshness gate
- `news_archive` 的 profile 必须先表达 detail-only 主证据、必需时间元数据与 explicit-history gate
- `stable_reference` 的 profile 保持默认 query-enabled，但不携带新闻面 freshness / history 语义
- `fresh_news` / `news_archive` 的 profile 只表达 source-side readiness 与分类
  truth，不自动开放 `rag-agent` 消费

## Opening Contract

repo 当前只冻结长期 policy truth 与 runtime-profile contract，不直接把 `fresh_news` /
`news_archive` 自动写成已开放 surface。

任何一次 opening decision 都必须满足统一 contract：

- opening criteria checklist
- metadata coverage summary
- duplicate-collapse posture
- recent / stale / historical / archive-no-backfill eval artifact
- promote prerequisites

统一口径见：

- `docs/reference/official-web-news-surface-opening-checklist.md`

## 当前不做

本文明确不把以下事项假装成已完成：

- `official_web/*` 已经整体进入默认 query-serving
- `fresh_news` 已经进入 query-serving
- `fresh_news` 已经作为 `rag-agent` 消费面开放
- 新闻发布日期抽取已经 repo-wide 稳定
- 仅凭当前 `listing_page` projection 就足以支撑正式新闻问答

## 与现有文档关系

- `official-web-architecture.md` 冻结 source-channel 边界，不负责 serving 分层
- `official_web-freshness-and-incremental-crawling.md` 冻结 crawl freshness
  与增量采集，不负责 query 路由
- `data-plane-architecture.md` 冻结跨 collection 数据平面不变量，不负责 `official_web` 的
  collection-specific serving policy
- `retrieval-serving-architecture.md` 冻结 retrieval baseline，不复制 `official_web`
  新闻语义细节

## External References

- Google Cloud Vertex AI Search website metadata / filtering / boosting:
  <https://cloud.google.com/generative-ai-app-builder/docs/add-website-metadata>
  <https://cloud.google.com/generative-ai-app-builder/docs/filter-website-search>
  <https://cloud.google.com/generative-ai-app-builder/docs/boost-search-results>
- Azure AI Search scoring profiles with freshness:
  <https://learn.microsoft.com/en-us/azure/search/index-add-scoring-profiles>
- Elasticsearch date-aware ranking:
  <https://www.elastic.co/guide/en/elasticsearch/reference/current/query-dsl-distance-feature-query.html>
- Haystack metadata routing:
  <https://docs.haystack.deepset.ai/docs/metadatarouter>
