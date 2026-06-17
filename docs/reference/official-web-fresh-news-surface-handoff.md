---
doc_type: reference
truth_scope: product
owner_boundary: domains/official-web
status: active
created: 2026-04-04
updated: 2026-05-13
---
# Official Web Fresh News Surface Handoff

## 文档边界

本文冻结 `official_web/muc_public_pages` 与后续 `fresh_news` surface 之间的 handoff 基线。

它回答的是：

- 哪些页面只保留在 `muc_public_pages` 的 regression / audit inventory
- 哪些新闻页已经明确成为后续 `fresh_news` workstream 的 seed set

它不表示：

- `fresh_news` collection 已经实现
- mixed `muc_public_pages` collection 已经可以承担新闻 query-serving
- `retain_inventory_only` 页面会自动进入未来 fresh-news surface

对应 machine truth：

- fixture：`packages/evals/fixtures/official_web_muc_public_pages_current_truth_i
  nventory.json`
- helpers：`packages/evals/src/campus_evals/official_web_inventory.py`
- tests：`tests/evals/retrieval_benchmark_qrels_official_web_suite.py`

## Accepted Handoff Baseline

`official_web/muc_public_pages` 的 accepted mixed-bridge inventory 基线固定为 `21`
条文档：

- `retain_inventory_only = 13`
- `future_fresh_news_surface = 8`

固定解释：

- `retain_inventory_only`
  - 保留在 current truth，只服务 regression / audit / local validation
  - 不属于 stable-reference gate，也不属于 future fresh-news seed set
- `future_fresh_news_surface`
  - 当前保留在 current truth，只服务 regression / local validation
  - 后续如要开放官网新闻问答，必须在单独的 `fresh_news` / `news_archive` 语义下处理

## Mixed Inventory Boundary

`muc_public_pages` 不再持有当前默认 answer-quality gate。旧 bootstrap 中曾在 mixed bridge
里作为稳定说明页或新闻解释页验证的内容，统一降为 `retain_inventory_only`：

- `学校简介`
- `学校概况`
- `现任领导`
- `基金会简介`
- `校友会简介`
- `本科培养`
- `博士后`
- `研究生培养`
- `“民图一小时”信息素养讲座预告`
- `校长强世功接受“统战新语”专访 解读民族团结进步促进法`
- `访问学者`
- `干部人事`
- `学术名流`

其中只有已经出现在 `configs/ingestion/official_web/stable_reference/split-manifest.v1.json`
的页面，才属于当前 `official_web/stable_reference` 默认可消费面。其他页面继续保留为
source-backed inventory truth，不因出现在旧 mixed bridge 中自动进入文档站或 RAG。

## Inventory-Only Set

`retain_inventory_only` 固定为：

- `“民图一小时”信息素养讲座预告`
- `校长强世功接受“统战新语”专访 解读民族团结进步促进法`
- `本科培养`
- `博士后`
- `访问学者`
- `研究生培养`
- `学校概况`
- `现任领导`
- `干部人事`
- `学术名流`
- `学校简介`
- `基金会简介`
- `校友会简介`

固定解释：

- 它们继续保留在 current truth，方便 regression、inventory audit 与 local validation
- 它们不是 stable-reference gate 的延迟候选
- 它们也不是后续 `fresh_news` surface 的 seed set
- `学术名流` 只是一个暴露问题的样本；品牌历史 / 人物介绍、校友基金会介绍、旧培养说明、新闻解释和讲座预告
  都不得因为旧 mixed bridge 命中而进入默认 institutional reference answer surface。后续如需服务这些
  问法，必须显式开对应的 `brand_history`、`education_profile`、`fresh_news` 或其他 target surface。

## Future Fresh News Seed Set

`future_fresh_news_surface` 固定为 `8` 条新闻页：

- `西北四所高校图书馆同仁到我校丰台校区图书馆考察调研`
- `中央民族大学党委举办树立和践行正确政绩观学习教育读书班`
- `中央民族大学与北京丰台人才集团共建就业实习实践基地`
- `校领导拜会北京市委组织部领导交流高质量就业工作`
- `中央民族大学唐鑫团队在红外高光谱成像系统研究获重大突破`
- `外国语学院学子在2026中国大学生演讲与辩论锦标赛中喜获佳绩`
- `中央民族大学举办中国历史研究院2025年度重大招标项目开题论证会`
- `《学习时报》孔新峰：政德何以重要`

它们的角色固定为：

- current truth 中的 regression / local validation seed set
- future `fresh_news` surface 的 handoff input
- 不是 stable-reference gate 的隐藏待升格页面

## Repo-Tracked Helper Contract

后续如果代码需要消费这组 handoff truth，应优先通过 helper，而不是重复解析 fixture 结构：

- `official_web_future_fresh_news_doc_ids()`
- `official_web_future_fresh_news_titles()`
- `official_web_retain_inventory_only_doc_ids()`
- `official_web_retain_inventory_only_titles()`
- `official_web_inventory_only_doc_ids_by_disposition()`
- `official_web_inventory_only_titles_by_disposition()`

## `fresh_news` 在开放前仍需补齐的约束

`fresh_news` 不是把这 `8` 条页面直接换个 collection 名字即可。至少还要单独解决：

- freshness gate
  - `今天 / 最新 / 最近` 风格 query 的 freshness threshold 与 fail-close 条件
- serving surface
  - `fresh_news` 与 `news_archive` 的运行时边界
- metadata
  - `published_at`、`crawled_at`、`last_seen_at` 等时间语义如何进入 serving policy
- release gate
  - 新闻面自己的 retrieval / answer gate，而不是复用当前 stable-reference gate

## Guardrails

- 把这 `8` 条 news 页面重新塞回当前 default answer gate
- 把 `retain_inventory_only` 页面误写成 future fresh-news seed set
- 把 mixed `muc_public_pages` collection 直接包装成已具备新闻 query-serving 能力

## 解释口径

- `muc_public_pages` truth 与后续 `fresh_news` surface 之间已经有显式 handoff 边界
- stable-reference gate 只消费 `official_web/stable_reference` split manifest 与对应
  qrels/live gate
- future fresh-news 工作必须从这 `8` 条 seed set 出发，但不能跳过单独的 freshness / serving /
  release-gate 设计
- opening acceptance / handoff 统一看
  `docs/reference/official-web-news-surface-opening-checklist.md`
