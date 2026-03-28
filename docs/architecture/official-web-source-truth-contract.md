---
doc_type: architecture
status: active
created: 2026-03-28
updated: 2026-03-28
---

# Official Web Source-Truth Contract

## 文档边界

本文冻结 `official_web` source channel 的 canonical source-truth contract。

它回答的是：

- 网页来源在 `capture/`、`provider/`、`source-truth/` 三层分别保留什么
- 网页 source-truth 的 page-level 与 block-level canonical 字段是什么
- 哪些字段属于 source-truth，哪些字段明确不属于
- 网页 source-truth 如何与下游 projection / document / chunk / serving 边界解耦

它不负责：

- 哪些 URL 可以被抓取
- collector 的调度、部署与 registration protocol
- 某个站点的正文抽取算法实现
- 某个下游 collection 的 document splitting / chunking 规则

对应文档：

- source channel 边界：`docs/architecture/official-web-source-channel.md`
- crawl policy：`docs/architecture/official-web-crawl-policy.md`
- shared replay / rebuild boundary：`docs/architecture/source-truth-normalization-contract.md`

## 目标

网页 source-truth 的目标是把“某次 crawl 获取到的网页”稳定地吸收成可 replay、可 fan-out、可审计的 canonical upstream，而不是让 downstream 永远依赖某个 parser 的原始输出或直接反复回源抓取。

## 核心结论

- web source-truth 是 parser-agnostic 的页面内容与结构真相，不是浏览器 DOM dump，也不是 document/chunk truth。
- 同一页面的 retained snapshot 与 source-truth 只应对同一内容版本持久化一次；后续 projection / rebuild 不得返回原网页重新抓取。
- web source-truth 的 ownership 在 source asset，不在任何 collection。
- web source-truth 必须同时保留 URL identity、fetch provenance、page manifest 与 block rows。
- `official_web` source-truth 允许服务多个下游 collection / corpus，但不得提前携带 document、chunk、retrieval 或 serving 语义。

## Canonical 形态

`retained page snapshot -> parser-specific provider output -> web source-truth -> declared projections -> canonical document artifacts -> document-units -> chunks -> index`

## Artifact 分层

### Capture Layer

`capture/` 保存 retained page snapshot，而不是只保留一次请求日志或瞬时浏览器状态。

长期 canonical artifacts 固定为：

- `capture/response.html`
- `capture/response-headers.json`
- `capture/fetch-metadata.json`

说明：

- `response.html` 保存最终响应体快照
- `response-headers.json` 只保留后续 replay / audit 需要的 HTTP headers
- `fetch-metadata.json` 保留请求时间、状态码、redirect 链、content type、timing 等 fetch 事实

### Provider Layer

`provider/` 保存 parser-specific 输出，供排障、升级 parser 与重建 source-truth 使用。

长期 canonical 形态固定为：

- `provider/<parser_slug>/page-extraction.json`
- `provider/<parser_slug>/discovered-links.jsonl`

说明：

- `page-extraction.json` 可以包含 DOM-to-content extraction、boilerplate map、title extraction、main-content heuristic 等 provider 细节
- `discovered-links.jsonl` 保存本页发现的出链与 link context，供 frontier 审计与 replay 使用
- provider artifact 不得直接被下游 collection 当作长期 contract

### Source-Truth Layer

`source-truth/` 保存 parser-agnostic canonical upstream。

长期 canonical artifacts 固定为：

- `source-truth/page-manifest.json`
- `source-truth/content-blocks.jsonl`

说明：

- `page-manifest.json` 保存页面级 identity、fetch、canonicalization 与整体提取摘要
- `content-blocks.jsonl` 保存块级内容与结构真相

## Source Asset Identity

网页 source asset 的 identity 固定为“稳定页面资源”，而不是某次运行中的请求实例。

### `raw_asset_id`

`raw_asset_id` 必须稳定表达同一页面资源，推荐由以下信息派生：

- `site_id`
- `normalized_canonical_url`

### `raw_version_id`

`raw_version_id` 表达同一页面资源的内容版本。

它只应在以下内容发生实质变化时推进：

- retained snapshot 主体内容变化
- 页面声明的 canonical identity 发生稳定变化
- source-truth 关键 page/block 内容变化

以下变化单独不足以推进新 `raw_version_id`：

- 仅抓取时间不同
- 仅观测 metadata 不同
- 仅 transient header、trace id 或 timing 变化
- 仅因 tracking 参数不同命中同一 canonical 页面

### URL Identity Basis

为了避免 identity 漂移，页面必须显式记录：

- `requested_url`
- `final_url`
- `declared_canonical_url`
- `normalized_canonical_url`
- `url_identity_basis`

`url_identity_basis` 允许值固定为：

- `declared_canonical`
- `final_url`
- `requested_url`

## Page Manifest Canonical 字段

`page-manifest.json` 至少固定以下字段组。

### A. Source Identity

- `schema_version`
- `source_channel`
- `site_id`
- `host`
- `raw_asset_id`
- `raw_version_id`
- `requested_url`
- `final_url`
- `declared_canonical_url`
- `normalized_canonical_url`
- `url_identity_basis`

### B. Fetch Provenance

- `fetched_at`
- `http_status`
- `content_type`
- `etag`
- `last_modified`
- `redirect_chain`
- `response_body_hash`
- `retained_snapshot_hash`
- `fetcher_name`
- `fetcher_version`
- `parser_name`
- `parser_version`

### C. Page-Level Content Summary

- `page_title_raw`
- `page_title_normalized`
- `language_hint`
- `main_content_hash`
- `block_count`
- `main_content_block_count`
- `navigation_block_count`
- `boilerplate_block_count`

### D. Crawl Context

- `discovered_from_url`
- `discovery_method`
- `crawl_run_id`
- `host_policy_version`
- `crawl_policy_version`
- `credentials_mode`

`discovery_method` 允许值固定为：

- `seed`
- `robots_sitemap`
- `configured_sitemap`
- `navigation`
- `manual_requeue`

`credentials_mode` 允许值固定为：

- `public`
- `authenticated`

## Block Rows Canonical 字段

`content-blocks.jsonl` 中每一行至少固定以下字段组。

### A. Block Identity

- `schema_version`
- `raw_asset_id`
- `raw_version_id`
- `row_id`
- `row_index`
- `block_order`

### B. Structural Position

- `block_role`
- `heading_level`
- `dom_path`
- `parent_heading_path`
- `list_level`
- `table_id`
- `table_row_index`
- `table_col_index`

### C. Content Payload

- `text_raw`
- `text_normalized`
- `html_fragment`
- `link_target`
- `link_text`
- `table_html`
- `table_cells`

### D. Source-Level Hints

- `is_navigation`
- `is_boilerplate`
- `is_main_content`
- `is_repeated_candidate`
- `main_content_score`
- `title_candidate_score`
- `section_hint`
- `classification_confidence`
- `classification_reason`
- `parent_heading_hint`

`block_role` 推荐值包括：

- `title`
- `heading`
- `paragraph`
- `list_item`
- `table`
- `table_row`
- `table_cell`
- `link`
- `navigation`
- `footer`
- `metadata`

## Collection Extension Fields

某个下游 collection 若确有 source-level 需求，可以在 web source-truth 上补 extension fields，但必须满足：

- 不能污染 core schema
- 不能引入 document/chunk 层语义
- 必须在 collection-specific README 或 strategy doc 中显式记录

## 明确禁止的字段

以下字段不属于 web source-truth contract：

- `document_id`
- `doc_id`
- `version_id`
- `revision_track`
- `chunk_id`
- `chunk_order`
- `clean_text`
- `embedding`
- sparse / dense vector payload
- `canonical_url`
- `latest_url`
- `is_current`
- serving metadata
- ACL metadata
- query-serving gate metadata
- registry-only metadata
- collection runtime profile flags

这些字段如果需要，必须在 projection、document-level cleaning、chunking 或 serving 阶段生成。

## URL 与来源字段命名

为避免与 serving 层混淆，命名固定如下：

- `requested_url`
  crawler 发起请求的 URL
- `final_url`
  redirect 后最终返回内容的 URL
- `declared_canonical_url`
  页面通过 HTML 或 HTTP header 声明的 canonical URL
- `normalized_canonical_url`
  按 crawl policy 规范化后用于 source identity 的 URL

禁止在 source-truth 层直接使用：

- `latest_url`
- retrieval payload 中的 `canonical_url`

它们属于 serving / evidence shaping 语义，不属于 source-truth schema。

## 质量语义

以下字段仅表示 source extraction 内部信号：

- `main_content_score`
- `is_boilerplate`
- `is_navigation`
- `classification_confidence`

它们不表示：

- 最终 document 语义正确率
- retrieval relevance
- answer quality
- serving confidence

因此这些字段只能服务：

- source-truth 质量回归
- parser 升级对比
- projection / cleanup hint
- 排障与审计

## Replay / Rebuild Boundary

当 canonical web source-truth 已存在时：

- projection / rebuild 必须从 `source-truth/page-manifest.json` 与 `source-truth/content-blocks.jsonl` 开始
- later projection 不得返回原网页重新抓取
- provider artifact 只作为排障与 source-truth 重建输入，不作为长期下游 contract

## 与 document truth 的关系

web source-truth 不等于逻辑文档真相。

因此这里固定：

- 页面 source-truth 可以投影成一个 document，也可以投影成多个 document
- 多个网页 source-truth 也可以被清洗为同一逻辑 document family
- 文档边界、`document_id`、`revision_track`、`version_id` 由下游 projection / document registry 决定

## 非目标

- 不在本文冻结正文抽取算法
- 不在本文冻结 boilerplate stripping 的实现细则
- 不在本文定义 collection-specific projection
- 不在本文定义 chunking 或 index release 策略

## 与其他文档的关系

- source channel 运行边界：`docs/architecture/official-web-source-channel.md`
- crawl scope 与 URL policy：`docs/architecture/official-web-crawl-policy.md`
- shared source-truth principles：`docs/architecture/source-truth-normalization-contract.md`
- object storage key 约定：`docs/decisions/adr-0002-local-minio-conventions.md`

## 参考

- Google canonical URL guidance: https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls
- Google crawl budget guidance: https://developers.google.com/search/docs/crawling-indexing/large-site-managing-crawl-budget
- RFC 9309 Robots Exclusion Protocol: https://www.rfc-editor.org/rfc/rfc9309
