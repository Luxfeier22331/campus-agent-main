---
doc_type: policy
truth_scope: ops
owner_boundary: domains/official-web
status: active
created: 2026-04-03
updated: 2026-04-04
---
# `official_web` Cleaning 与 Chunking 规则

## 目标

把当前 `official_web/muc_public_pages` 在当前 scope 下的清洗、structured-unit 产出、chunking 与
promote/release 约束冻结为 repo truth，避免后续继续从零散 helper、临时抽样和 release 失败结果反推规则。

本文覆盖：

- 当前 `official_web` page family 的 cleaning lane
- staged-only 与 promotable truth 的边界
- `document-units.jsonl -> chunk` 的 current-scope 目标形态
- official-web 专用 chunk policy 应满足的语义边界
- chunking / promote / release gate 的最低通过条件

本文不负责：

- collector 的 host allowlist、crawl frontier、robots 与 parser 细节
- `official_web` source-truth 字段级 schema
- future `fresh_news` / `news_archive` collection 的 runtime profile 具体 JSON 形状
- query-serving 是否开放

对应文档：

- source channel 边界：`docs/architecture/domains/official-web/architecture.md`
- serving / news retrieval
  语义：`docs/architecture/domains/official-web/serving-and-news-retrieval-strategy.md`
- projection / release lifecycle:
  `docs/runbooks/ingestion-control-clean-target-runbook.md`

## 适用范围

- corpus: `official_web`
- collection: `muc_public_pages`
- current serving stage: `offline_preparation`
- current work focus: improve current scope quality before any retrieval-opening
  discussion

当前 policy 的适用前提固定为：

- 不扩大 crawl scope
- 不把 `listing_page` 重新包装成主 evidence
- 不因为 replay 已能产出文档，就自动把所有文档视为可 promote truth

## 真相分层

`official_web` 当前必须显式区分两层 truth：

- `staged audit truth`
  - 用于 canonical 抽样、chunk audit、coverage gate、source-truth replay 验证
  - 允许保留 `listing_page` 和部分 `generic_content_page`
- `promotable truth`
  - 允许写入 registry current truth，并参与 release candidate 形成
  - 只接受高信号正文页

因此：

- “能 replay 出 document” 不等于 “能进入 promote/release”
- `listing_page`、portal-like `generic_content_page`、稀疏 link hub 与 shell family
  只能作为 staged audit truth
- 当前 scope 下，部分低价值 `article_detail` 也必须停留在 staged audit truth，而不是默认 promotable

## Page Family Cleaning Lane

### `article_detail` chunking

目标：保留标题、结构 heading、连续正文、联系方式和有效表格，使单篇详情页能够直接形成 answer-bearing chunk。

保留：

- page title
- section heading
- narrative paragraph
- contact-like lines
- semantic table content

剔除：

- 正文开始前的导航型 `link` / `list_item`
- portal/tab 样式短标签
- ellipsis teaser / 被截断摘要
- 明显工具入口、分页、quick link
- 讲座 / 通知正文尾部的低价值 CTA tail
  - 例如 `扫描二维码预约讲座信息`
  - 例如 `活动结束后累计参与者积分`

当前 scope 的额外收口规则：

- 招聘 / 采购 / 公示类 `article_detail` 如果主要承载低价值 public notice，而不是可长期消费的事实正文，必须标记为
  `serving_intent = audit_only`
- 这类页面当前固定使用 `promotion_block_reason = low_value_public_notice_audit_only`
- 它们允许进入 replay / validator / chunk audit，但不得进入 promote / release truth
- 当前已确认落在这条规则下的页面包括：
  - `中央民族大学公开招聘及公示信息`
  - `中央民族大学2020年公开招聘补充公告`
  - `中央民族大学海淀校区为新购置家具加装嵌入式插座项目采购谈判结果公示`

通过条件：

- 正文主体存在，且不能只剩 headline fragment
- section path 不能整体塌缩成单一 portal headline
- chunk audit 不得出现 `ellipsis_truncation`、`headline_only_fragments`

### `directory_page` chunking

目标：把目录、通讯录、师资名单、院系联系方式等页面转换成稳定参考页，而不是保留成整页导航聚合。

保留：

- 人名、机构名、职务、部门
- 电话、邮箱、地址、办公地点
- 语义完整的 roster / contact rows
- 表格中的实体键值

剔除：

- 页内栏目入口
- 与实体无关的导航标签
- 纯分页、工具按钮、portal badge

结构要求：

- 最小 structured unit 应优先对应“一个人 / 一个办公室 / 一个联系方式实体组”
- 不允许把整页长名单压成单个巨型 unit
- portal-style homepage / site hub 即使被上游 source-truth 暂时分类成
  `directory_page`，也必须降到 staged-only / manual-review

### 稳定 `generic_content_page` chunking

目标：承接说明页、简介页、办事说明页等“不是新闻列表，也不是纯目录”的稳定正文。

允许进入 promotable truth 的前提：

- 主体是说明性内容，不是首页门户
- 主体不是稀疏 link hub
- 不是 headline-only fragment 聚合页

保留：

- 标题
- 说明性 section
- 联系方式 / 说明性表格

剔除：

- portal/tab 短标签
- teaser / 摘要截断行
- 正文主体后的 headline-only fragment

### `listing_page` chunking

目标：作为 staged audit / discovery / navigation truth 保留，而不是作为 release truth。

保留：

- 去噪后的 listing title/date line
- 必要的 section heading
- 能用于审计 listing quality 的最小导航条目

剔除：

- 分页 token
- utility link token
- short-label cluster
- ellipsis teaser / summary line
- teaser cluster
- 聚合 quick-link 行
- 被单条 headline 污染的上下文

固定约束：

- `listing_page` 继续写出 canonical / units，供本地 QC 与 replay 审计
- 但默认只能是 `audit_only`
- 不进入 promote/release candidate

### `dynamic_shell_page` / `structural_shell_page`

- 只允许 `manual_review`
- 不落正文文档
- 不进入 chunk/index/release truth

## Structured Unit 语义

`official_web` 的 structured unit 不应只表达“有一段文本”，而必须表达“这段文本为什么值得被 chunk / 检索 / 审计”。

当前 official-web unit 至少应能区分：

- `section_text`
  - article / explanatory generic 的正文 section
- `directory_entry`
  - directory/contact/roster 的单实体或单实体组
- `link_list`
  - listing/navigation 审计材料
- `table_unit`
  - 语义表格或表格窗口

所有 unit metadata 至少应包含：

- `title`
- `site_id`
- `host`
- `page_family`
- `projection_family`
- `document_kind`
- `declaration_id`

对 promotable truth，额外要求至少有：

- `serving_intent = promotable`
- `content_role`
- `semantic_content_hash`

对 staged-only truth，额外要求至少有：

- `serving_intent = audit_only`
- `promotion_block_reason`

推荐保留但允许为空：

- `published_at`
- `display_date`
- `entity_key`
- `entity_group`

对 `article_detail` / 稳定 `generic_content_page` 的 `content_role`，当前 repo truth
额外固定为：

- answer-bearing
  - `primary_content`
  - `reference_fact`
  - `notice_fact`
- support-only
  - `source_attribution`
  - `boilerplate`
  - `media_caption`

其中：

- `semantic_content_hash` 用于同一 scope 内跨 host 等价正文的逻辑归并
- 它必须只表达正文语义，不得把 host、canonical URL、`raw_version_id` 编进 hash
- 当前 `official_web/muc_public_pages` 的 release truth 不允许把 `news` / `xxgk` 同文扩成两份
  current document
- support-only role 可以保留在 structured-unit truth 中做审计与来源追溯，但：
  - 不进入 canonical markdown
  - 不计入 semantic hash 正文语义
  - 不进入 chunk / index
  - retrieval ranking 与 answer row selection 都必须把它们当作非可消费内容

## Chunking 目标

chunk 的目标不是“把文本切开”，而是“形成可单独消费的语义块”。

### `article_detail`

- 一个 chunk 应优先对应一个 section，或同一 `section_path` 下 1-3 个连续段落
- 禁止跨 heading 合并
- `notice_fact` 的主题 / 时间 / 地点 / 会议信息等事实组可以作为同一 grouped fact chunk 保留
- `source_attribution` / `boilerplate` / `media_caption` 不得形成 standalone chunk
- 需要保留 labeled `title + effective section_path` 上下文

### `directory_page`

- 一个 chunk 应优先对应一个人 / 一个办公室 / 一个部门联系方式组
- 允许在同 section 内合并多个过短 sibling entry，但不得跨实体乱并
- roster/contact page 的 chunk 不得主要由导航标签组成

### 稳定 `generic_content_page`

- 一个 chunk 应优先对应说明性 section
- 禁止把 headline-only fragment 当正文 chunk
- 表格或联系信息可以独立成 chunk

### `listing_page`

- 只允许生成 audit chunk
- chunk 主要用于检查 cleaning 是否还有残留噪音
- 不得作为 promotable truth 参与 release

## Chunk Header 与 Context 规则

official-web chunk context 的最低目标是：让 chunk 脱离原页面后仍知道自己来自哪一页、哪一节、什么页面族。

当前 promotable official-web header contract 固定为：

1. 如果 `section_path` 在 title-dedupe 之后仍有有效 leaf，header 必须保留 `标题：... | 章节：...`
1. 如果 `section_path` 在 title-dedupe 之后塌缩为空，允许退化到 `标题：...`
1. `compact_identity` 只允许留给非 promotable / 非 official-web 主路径，不得重新回到当前 promotable
   chunk path

固定约束：

- 不得让冗长 section path 吞掉正文预算
- 不得让 listing headline 污染整页 chunk identity
- `listing_page` 的 header 只服务 audit，可弱化，不应把某条头条包装成整页 identity
- 短 promotable chunk 也不得为了省 token 退回未标记的 slash identity

## Audit / Gate 约束

当前 official-web cleaning + chunking audit 至少要拦截：

- `collapsed_section_path`
- `stacked_short_label_lines`
- `ellipsis_truncation`
- `headline_only_fragments`
- `teaser_cluster_lines`
- `listing_context_pollution`
- `row_id_mismatch_after_cleaning`
- `article_section_over_aggregation`
- `source_only_chunk`
- `terminal_boilerplate_chunk`
- `header_context_drift`

额外固定约束：

- promotable 文档不得带 `audit_only` serving intent
- release candidate 不得包含 `listing_page`
- release candidate 不得包含 portal-like / sparse-link-hub generic output
- `notice_fact` 允许保持 4-5 行事实组，不得仅因 grouped fact line 数较多就被误报成 over-aggregation

## Inventory-Only Triage

`inventory_only` 不表示“以后统一再看”，而必须继续分成机器可检查的三类：

- `retain_inventory_only`
  - 保留在 current truth / audit truth 中，但当前 scope 下不再尝试升格 release gate
- `current_scope_follow_up_candidate`
  - 仍留在 `inventory_only`，但允许在当前 `muc_public_pages` scope 内继续做 cleaning /
    chunking / answer-compression 治理
- `future_fresh_news_surface`
  - 当前保留在 current truth 仅用于 regression / audit / local validation，不进入当前
    stable-reference gate
  - 后续如要开放 query-serving，应转到 `fresh_news` / `news_archive` 语义下处理，而不是继续塞回当前 gate

当前 repo-tracked triage 固定为：

- `retain_inventory_only`
  - `访问学者`
  - `干部人事`
  - `学术名流`
- `current_scope_follow_up_candidate`
  - 当前为空
- `future_fresh_news_surface`
  - 当前 `8` 条 news 页面，包括 `中央民族大学与北京丰台人才集团共建就业实习实践基地` 这类已用于 cross-host regression
    的新闻页

对应 machine-checkable fixture：

- `packages/evals/fixtures/official_web_muc_public_pages_current_truth_inventory
  .json`

## Promote / Release Truth

`muc_public_pages` 当前 promote / release 的最低真相要求固定为：

- document set 主要由高信号正文页组成
- `listing_page` 与 staged-only generic 不进入 current truth
- 低价值 recruitment / procurement / public-notice `article_detail` 不进入 current
  truth
- `future_fresh_news_surface` 文档不得绕回当前 stable-reference release gate
- 只有显式标记为 `current_scope_follow_up_candidate` 的 `inventory_only` 页面，才允许进入下一轮
  current-scope gate 评估
- chunk 质量通过 official-web chunk audit
- current release 不得再表现为“headline fragment 主导”的 dataset

因此当前 repo 明确拒绝以下路径：

- “listing 已经清理干净，所以可以 promote”
- “generic_content_page 只要能出 chunk 就可以 release”
- “先把 audit 材料一起放进 release，以后再清”

## 当前不做

本文不把以下事项假装成已完成：

- `official_web` 已开放 retrieval
- `fresh_news` / `news_archive` 已独立落 collection
- collector 已稳定抽出所有 `published_at`
- 所有 `directory_page` 都已按实体切分完成
- repo 当前并未承诺本文目标已一次性全部完成
