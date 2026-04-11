---
doc_type: reference
status: historical
created: 2026-04-03
updated: 2026-04-12
---

# Official Web MUC Public Pages Page QC Inventory (2026-04-03)

## 文档边界

本文把 `official_web/muc_public_pages` 当前 `21` 条 promotable current truth 文档按页面语义和 answer-gate 优先级分组，作为当前 scope 的 page-level QC 台账。

它回答的是：

- 当前 `21` 条 current truth 文档分别属于哪一类页面
- 哪些页面已经进入 `release_gate_required`
- 哪些页面只是 current truth 保留项，但还未进入 answer-quality gate
- 哪 `3` 条低价值 public notice 页面已明确停留在 `audit_only`

它不表示：

- `official_web/muc_public_pages` 已开放 retrieval/query serving
- 当前 `21` 条文档都已经达到同等可消费质量
- 后续应该继续扩采集范围

machine-checkable fixture：

- `packages/evals/fixtures/official_web_muc_public_pages_current_truth_inventory.json`
- future handoff note：`docs/reference/official-web-fresh-news-surface-handoff.md`

## 当前分组

- `stable_reference_core`：`5`
  - `学校简介`
  - `学校概况`
  - `现任领导`
  - `基金会简介`
  - `校友会简介`
- `notice`：`1`
  - `“民图一小时”信息素养讲座预告`
- `news_interpretation`：`1`
  - `校长强世功接受“统战新语”专访 解读民族团结进步促进法`
- `stable_reference_extended`：`6`
  - `本科培养`
  - `博士后`
  - `访问学者`
  - `研究生培养`
  - `学术名流`
  - `干部人事`
- `news`：`8`
  - `西北四所高校图书馆同仁到我校丰台校区图书馆考察调研`
  - `中央民族大学党委举办树立和践行正确政绩观学习教育读书班`
  - `中央民族大学与北京丰台人才集团共建就业实习实践基地`
  - `校领导拜会北京市委组织部领导交流高质量就业工作`
  - `中央民族大学唐鑫团队在红外高光谱成像系统研究获重大突破`
  - `外国语学院学子在2026中国大学生演讲与辩论锦标赛中喜获佳绩`
  - `中央民族大学举办中国历史研究院2025年度重大招标项目开题论证会`
  - `《学习时报》孔新峰：政德何以重要`

## 当前 Gate 优先级

当前 `release_gate_required` 固定为 `11` 条：

- `学校简介`
- `学校概况`
- `现任领导`
- `基金会简介`
- `校友会简介`
- `本科培养`
- `博士后`
- `研究生培养`
- `学术名流`
- `“民图一小时”信息素养讲座预告`
- `校长强世功接受“统战新语”专访 解读民族团结进步促进法`

当前 `follow_up_candidate` 已清空，上一轮 `stable_reference_extended` 候选页里已有 `4` 条升格进入 release gate。

当前 `inventory_only` 固定为 `10` 条：

- `访问学者`
- `干部人事`
- 其余 `8` 条 news 页面

## Inventory-Only Triage

当前 `inventory_only` 已进一步分成三类：

- `retain_inventory_only = 2`
  - `访问学者`
  - `干部人事`
- `current_scope_follow_up_candidate = 0`
- `future_fresh_news_surface = 8`
  - 当前全部 `news` 页面

对应判断依据：

- `访问学者` 更接近教师国际化 / 公派访学项目说明，不是当前终端问答面的通用 reference 页
- `干部人事` 当前是信息公开栏目 landing page，正文只给出“干部工作 / 人事制度 / 岗位聘任”等目录型说明，不是直接答案页
- `学术名流` 已完成 biography/entity 级压缩与 same-doc support 收口，当前已升格进入 `release_gate_required`
- `8` 条 news 页面保留在 current truth 主要为了 regression 与本地验证；后续若开放 query-serving，应转到 `fresh_news` / `news_archive` 语义，而不是继续塞入当前 stable-reference gate
- 这 `8` 条页面的后续边界已单独冻结在 `docs/reference/official-web-fresh-news-surface-handoff.md`，不再作为当前 scope 的隐藏 follow-up queue

## 当前结论

- 这份 inventory 把 `21` 条 current truth 明确切成“必须 answer-gate”与“暂不 answer-gate”两层，避免继续把所有 promotable 文档视为同等可消费。
- `stable_reference_extended` 中的 `本科培养 / 博士后 / 研究生培养 / 学术名流` 已完成 answer gate 提升，当前剩余未升格项主要是 `访问学者 / 干部人事`。
- `访问学者` 已明确降为 `inventory_only`，因为它更接近教师国际化/公派访学项目说明，不适合作为当前终端问答面里的稳定 reference gate。
- `学术名流` 已从 current-scope follow-up 候选升格进入 release gate；当前 `inventory_only` 不再保留 stable reference follow-up 候选。
- `news` 页面目前保留在 current truth，但它们已经明确归到 `future_fresh_news_surface` 方向，不应被误读为已经具备稳定 query-serving 质量。

## Audit-Only 排除项

当前固定排除的 `3` 条 low-value public notice 页面：

- `中央民族大学公开招聘及公示信息`
- `中央民族大学2020年公开招聘补充公告`
- `中央民族大学海淀校区为新购置家具加装嵌入式插座项目采购谈判结果公示`

它们继续保留在 staged audit truth，不进入 current truth，也不进入 release gate。
