---
doc_type: policy
status: active
created: 2026-03-25
updated: 2026-05-07
---
# `student_rules` Chunking 与 Validation 规则

## 目标

把 `regulations/student_rules` 当前已经验证通过的 chunking 运行真相固定下来，避免后续只能从代码和临时 sample
反推规则。

本文覆盖：

- `document-units.jsonl -> chunks` 的当前预算与切分策略
- token budget 的来源与变更门禁
- tokenizer 运行契约
- unit 级切分与 chunk 组装规则
- 短正文聚合与 header 组装规则
- handbook validation 的通过条件与诊断指标
- 何时允许继续调整预算

本文不重复 source-level OCR normalization 与 split-manifest 设计；这些内容以 [student-handbook
-normalization-strategy.md](../reference/student-handbook-normalization-strategy
.md) 为准。

## 适用范围

- corpus: `regulations`
- collection: `student_rules`
- chunk profile version: `student_rules_semantic_v3`
- tokenizer truth: `Qwen3-Embedding-4B`

当前 handbook 的 chunk budgeting 必须以 embedding tokenizer 为真相源，而不是正则近似 token 计数。

## Tokenizer 契约

当前 handbook v3 tokenizer 契约固定为：

- embedding model: `Qwen3-Embedding-4B`
- embedding dimensions: `2560`
- tokenizer repo: `Qwen/Qwen3-Embedding-4B`
- 运行时只允许使用本地已预取 tokenizer
- 主链路默认离线，不允许在 chunking 或 validation 过程中隐式联网下载 tokenizer

额外约束：

- handbook phase-1 必须显式请求 `Qwen3-Embedding-4B` 的 native `2560` 维向量
- 不允许依赖兼容 API 的默认维度推断；如果 provider 默认返回 `1024`，必须通过显式参数覆盖
- 当前项目的 provider reality 固定为：通过 `gitee` 官方 OpenAI-compatible embeddings 接口请求
  `Qwen3-Embedding-4B`
- `gitee` 路径下显式请求 `dimensions=2560` 已在本项目中验证通过；这里不再把 `2560` 视为待 provider 核验的假设
- handbook 的 token budget、Qdrant collection 规划和回放验证都以 `2560` 维运行契约为前提

字段边界：

- `model`、`dimensions` 属于 embedding request contract
- `document_id`、`chunk_id`、`corpus`、`collection`、`visibility_level`、`visibility_
  scope`、`entitlement_groups`、`policy_projection_version` 属于 Qdrant chunk/index
  schema
- 不允许把 embedding 请求字段和 retrieval payload schema 混为同一层设计
- handbook 已冻结的 `Qwen/Qwen3-Embedding-4B` tokenizer 只服务 chunk budgeting 与 dense
  embedding，不因 sparse index 路径引入而替换
- 如果后续为 sparse retrieval 引入 BM25 或其他 sparse analyzer，那是 sparse path 自己的内部
  tokenization，不改变 handbook 的 dense/chunking tokenizer truth

工程约束：

- 预取步骤应在受控环境中显式执行
- 运行与测试默认使用本地缓存
- 缺缓存时应显式报错并提示预取，而不是静默 fallback 到联网下载
- dev 环境需要显式维护 `Qwen/Qwen3-Embedding-4B` tokenizer 的本地 Hugging Face cache；这是
  chunk budgeting / dense path 的运行前置条件
- 上述本地 cache 约束不适用于 sparse `tokenizer=multilingual`；sparse tokenization 不复用
  handbook 的 HF tokenizer cache

因此 handbook v3 的 token 预算真相，不仅是“用 HF tokenizer”，还包括“先预取一次，本地复用，默认离线”。

## 当前运行真相

当前稳定输入链路：

`provider-response.jsonl -> layout-elements.jsonl -> split-manifest ->
canonical.md / document-units.jsonl -> chunks`

chunking 只消费单篇逻辑文档的 `document-units.jsonl`，不直接消费 provider payload、raw PDF 或整本
handbook markdown。

固定 unit 集合：

- `article_body`
- `policy_page`
- `table`
- `table_unit`

`table` / `table_unit` 保持独立语义单元；短正文聚合只作用于 textual parent units，不跨表格单元。

## Chunk 预算

`student_rules_semantic_v3` 当前预算固定为：

- `chunk_size = 384`
- `max_chunk_size = 512`
- `overlap = 64`
- `min_chunk_size = 96`
- `safety_margin = 16`
- `final_text_aware = true`

这些值对应的是 handbook v3 profile，不是代码里的通用默认值。通用默认值仅供非 handbook 路径或显式 profile
缺省时使用，不能当作 handbook runtime truth。

预算对象是最终 contextualized chunk text：

- 先算 display text
- 再加 header/context
- 最终按 `max_chunk_size` 判定是否超限

因此 handbook 不允许只看裸正文 token 后再假定 header “大概放得下”。

## 预算来源

当前 `student_rules_semantic_v3` 预算不是从旧 `campusRAG` 机械照抄，而是基于下列约束冻结的：

1. 上限必须给 `title + section/article identity + policy_doc_no + 正文` 留出稳定空间。
1. 预算对象是最终 contextualized text，因此不能把 header 当作“免费 token”。
1. handbook 中存在大量短条文、附则和 `policy_page` 小节，预算过小会迫使结构碎裂，预算过大又会让多主题条文和流程页过胖。
1. 当前 embedding 模型长期固定为 `Qwen3-Embedding-4B`，预算必须围绕该 tokenizer 行为收敛，而不是围绕 regex
   近似或其他模型收敛。
1. 当前 live validation 目标不是“尽量减少 chunk 数”，而是同时满足：
   - 不产生 non-table oversize chunk
   - 不产生可合并但未回收的碎块
   - 不产生 header 压正文的问题

因此 v3 预算的角色可以概括为：

- `chunk_size = 384` 作为正常 display target，优先让多数正文在加上上下文后仍落在中等 chunk 区间
- `max_chunk_size = 512` 作为 final contextualized hard ceiling，允许较完整地保留一条制度语义片段
- `chunk_overlap = 64` 作为 token guardrail window 的连续性保护，而不是主切分手段
- `min_chunk_size = 96` 约束 token guardrail windows 不要过碎
- `safety_margin = 16` 给 final-text-aware 预算留出 tokenizer 与组装误差缓冲

当前没有证据表明 handbook 需要进一步放宽预算。预算变更只能由 embedding / retrieval / eval 结果驱动，不能由 sample
观感驱动。

## 切分顺序

当前 handbook 的切分顺序固定为：

1. 清理单个 unit 的结构文本
1. 先尝试 `structure_first` 拆分
1. 结构拆分无法满足预算时，再退化到 token windows
1. chunk text 组装时按 header 预算选择最短可接受 header
1. 对短 textual chunks 做相邻聚合

当前结构优先拆分主要针对：

- `article_body` 的 clause block
- `table_unit` 的 row window

`policy_page` 没有被建模为“默认无限细拆”的 heading tree；它仍然先以清洗后的文档级 unit 作为父边界，再在 chunking
阶段做有限聚合。

## 切分规则矩阵

### `article_body`

优先顺序：

1. 如果正文在 final budget 内，直接保留为单 chunk
1. 超预算时优先按结构边界拆分
1. 结构边界无法满足预算时，退化到 `token_guardrail`

结构优先的目标边界：

- `clause_block`
- 带前导语的条款组

不变量：

- 优先保留完整条款组，不为追求平均大小而随意切断条款
- `split_reason=structure_boundary` 优先于 `token_guardrail`
- 结构拆分后的后续 chunk 不允许只以裸枚举符开头；如果正文从 `(2)`、`2.`、`（二）` 之类子项续接，display text
  必须补回最近可稳定识别的父级条款上下文

### `policy_page`

优先顺序：

1. 如果正文在 final budget 内，作为单 chunk 保留
1. 超预算时优先按可识别名单行、枚举块、流程块拆分
1. 结构仍不满足预算时，进入 `token_guardrail` hard-budget window

不变量：

- 不把所有 `policy_page` 递归切成极细 heading tree
- 允许后续在同父层级下做短正文聚合

### `table_unit`

优先顺序：

1. 保留 caption / header / note
1. 按 row window 滚动切分

不变量：

- 不产生 header-only table chunk
- 不保留 generic table label
- 表格预算单独按表格窗口处理，不沿用 textual 碎块逻辑

### Token Guardrail

所有 unit 的最后 hard-budget 机制都是 `token_guardrail`，但它只在结构边界无法满足预算时才允许触发。
`token_guardrail` 是显式预算保护机制，不是 handbook 的主切分策略。

## Chunk 组装规则

chunk 组装必须严格区分三层：

- `clean_text` 正文真相，只来自 unit text
- `anchor` 结构定位真相，例如 `section_path`、`article_label`
- `metadata` 文档级上下文真相，例如 `title`、`policy_doc_no`、`preface_text`

当前组装规则：

1. 先从 `clean_text` 生成 display text
1. 再根据 `anchor + metadata` 生成 context plan
1. 在可放入预算的 header variant 中选择最短可接受 variant
1. 最终把 `header + display_text` 组装成 chunk text

### Header variant 语义

- `full_path` 标题 + 完整章节路径 + 条款身份 + 文号
- `compact_path` 标题 + 紧凑路径 + 文号
- `compact_identity` 标题 + 末级结构身份 + 条款身份 + 文号
- `title_only` 只保留标题级上下文
- `required` 当其他 variant 都不满足时的最低必要上下文

### 组装不变量

- textual chunk 只要存在 document title，就必须 contextualized
- header 不能替代正文；正文仍以 display text 为主
- 聚合后必须保留成员可追溯 metadata
- 聚合后 anchor 应收敛到公共结构路径，而不是随便继承第一个成员的深层路径
- `policy_page` 聚合后若缺少显式 `article_label`，display text 必须补回成员小节标签

### Answer-ready 语义片段

`student_rules_semantic_v3` 的在线检索目标不是只生成“不过长的结构块”，还必须生成可被
retrieval/rerank/answer synthesis 直接使用的 answer-ready evidence。该 evidence contract
是 regulation-family 通用 contract；学生手册只是当前完整落地的 handbook profile。

当前 student rules 的 regulation-aware chunking 会在正文结构识别后补充：

- `answer_role=eligibility_intro`：条件组前导语，默认不是独立答案证据
- `answer_role=eligibility_condition`：资格、对象、申请条件等可直接回答的条件条款
- `answer_role=exception_rule`：例外、特殊条件或排名例外等判断条款
- `answer_role=exclusion_rule`：不得、不能、不予、取消资格等负向条款
- `answer_role=procedure_step`：申请、审核、审批、公示、报送等流程条款
- `answer_role=example_evidence`：条件条款下的示例、证明材料或具体表现项
- `answer_role=category_overview`：由 `query-planning.json` 中 policy category registry
  生成的类别概览

这些 answer-ready chunks 必须同时携带 retrieval-facing evidence contract metadata：

- `evidence_contract_version=answer_ready_evidence.v3`
- `parent_unit_id`
- `condition_subject`，用于排名阈值、论文/发表、材料、截止时间、受众范围、处分解除限制等判断证据
- `condition_polarity`
- `procedure_step_index`、`procedure_actor`、`procedure_action`，以及可选
  `procedure_materials` / `procedure_next_actor`
- `category_id`、`category_audience`、`category_member_document_ids`、
  `category_member_titles`

当前 query-serving handbook target path 还必须满足 legacy quarantine 约束：

- rebuilt `student_rules` target alias 只能消费 `answer_ready_evidence.v3` 主路径证据
- 如果某个 answer-bearing 命中 chunk 缺少 `answer_ready_evidence.v3` 必需 contract 字段，
  它只能留在显式 `legacy_old_index_compatibility` 诊断/历史路径中，不能进入 target
  serving pass

语义切分不变量：

- 条件组前导语不应和具体条件项合成同一个 answer-bearing chunk
- 排名例外、不得参评、流程步骤等判断条款不应和后续“具体表现如下”示例列表合成同一个 chunk
- 示例项可以保留父条款上下文，但不应把 sibling 示例项无差别混入同一个 answer clause
- category/list discovery 问法应优先命中 `category_overview` / `policy_list` 证据，而不是靠窄条件条款或流程条款充当制度描述
- `procedure_step`、`eligibility_condition`、`exception_rule`、`exclusion_rule`、
  `example_evidence` 这类原子 answer-ready evidence 不参与相邻短正文聚合。短 chunk
  回收不能以牺牲可直接回答的证据边界为代价。

## Header 规则

handbook chunk 必须带最小必要上下文，但不允许让冗长路径压过正文。

当前 header 选择原则：

- display 较长时，优先保留完整路径上下文
- display 较短时，优先使用更紧凑的 header
- 对短 display，不默认优先 `full_path`

短 display 下的 header 优先顺序为：

1. `compact_identity`
1. `compact_path`
1. `full_path`
1. `title_only`
1. `required`

`compact_identity` 的目标是只保留回答与检索真正需要的最小身份信息，通常包含：

- 标题
- 最末级 section 标识
- `article_label` / `provision_label` / table label
- 文号

## 短正文聚合规则

短正文聚合是 handbook v3 的稳定组成部分，不是临时补丁。

当前短正文候选规则：

- `display_token_count < 72`
- 或 `header_ratio >= 0.4`

当前短正文聚合目标：

- 优先聚合到 `display_token_count >= 120`
- 单轮默认最多 4 个 member
- 尾部短 chunk 允许二次回收，不受首轮 4-member 限制

聚合仅在相邻且兼容时发生。兼容条件包括：

- `unit_type` 相同
- 授权投影一致（`visibility_level`、`visibility_scope`、`entitlement_groups`）
- `title` / `policy_doc_no` 一致
- 未触发结构拆分或多 segment

路径兼容规则：

- `article_body` 默认要求同一 `section_path`
- `policy_page` 允许在同一父层级或稳定父子层级下聚合
- 聚合后 anchor 收敛到公共 `section_path`

额外约束：

- 不跨 `table_unit` 聚合
- 不跨文档聚合
- 不因为首条存在 `preface_text` 就阻断同章相邻条文聚合
- 不聚合原子 answer-ready evidence；相邻短文本聚合只服务低风险上下文压缩，不用于合并不同
  evidence contract 的答案证据

聚合后的文本必须保留成员可追溯性：

- `member_unit_count`
- `member_root_unit_ids`
- `member_source_chunk_ids`
- `member_article_labels` / `member_provision_labels`

对 `policy_page` 聚合，如果成员本身没有 `article_label`，display text 会补回末级 section
label，避免合并后失去结构辨识度。

## Validation 规则

handbook validation 的职责是卡住“仍然明显错误的 chunking 结果”，不是把所有天然较短的制度条文都视为失败。

当前 validation 入口：

- `python -m campus_ingestion_worker.validate_student_handbook_chunking`

当前核心指标：

- `non_table_oversize_chunk_count`
- `header_only_table_chunk_count`
- `generic_table_label_chunk_count`
- `polluted_section_path_count`
- `missing_contextualization_count`
- `tiny_textual_chunk_count`
- `header_dominant_chunk_count`
- `small_unaggregated_chunk_count`
- retrieval chunk quality eval gate 中的 answer-ready semantic checks

其中语义如下：

- `tiny_textual_chunk_count` 统计 `final_token_count < 80` 的 textual
  chunks；它是诊断指标，不单独决定 fail
- `small_unaggregated_chunk_count` 只统计“既短、又未聚合、而且左右存在真实可合并邻居”的 chunk；这是 gate 指标
- `header_dominant_chunk_count` 只统计冗长 header 模式下 `header_ratio >= 0.4` 的
  chunk；当前只对 `full_path`、`compact_path`、`required` 生效

当前 pass gate 固定为：

- 不能有 registry / object store 读失败
- 不能有 empty document
- 不能有非表格 oversize chunk
- 不能有 header-only table chunk
- 不能有 generic table label
- 不能有 polluted section path
- 不能缺少 contextualization
- `small_unaggregated_chunk_count == 0`
- `header_dominant_chunk_count == 0`
- `policy_list` / `category_overview` chunk 必须带 `answer_role=category_overview`
- query-serving regulation-family answer-ready chunks 必须通过
  `answer_ready_evidence.v3` contract quality gate；缺 `answer_role`、
  `parent_unit_id`、`condition_subject`、typed procedure fields 或 category member
  metadata 时 fail closed
- `eligibility` / `exception_rule` chunk 不得同时包含“具体表现如下”等示例列表标记和多个
  枚举示例项

因此：

- “天然很短但没有可合并邻居”的闭合条款允许存在
- `compact_identity` 下的短附则条款不再被当作 header 设计失败

## 当前稳定结论

截至本文更新时，handbook live validation 已满足：

- `passed = true`
- `header_dominant_chunk_count = 0`
- `small_unaggregated_chunk_count = 0`
- `heading_body_glue_count = 0`
- `chunk_failures = []`

2026-03-26 的真实复核额外确认了两类 handbook v3 不变量已经稳定：

- `policy_page` 的 closing provisions 在聚合后会脱离旧的深层 `section_path`，anchor
  收敛到真实公共父路径，而不是继续挂在前文流程章节下
- `article_body` 的 structure-first 后续 chunk 会补回父级条款上下文，不再出现只从裸 `(2)` 或类似子项编号起跳的
  display text

这说明当前主要问题已经不再是：

- header 过长压正文
- 大量可合并短块未被回收

仍存在少量 `tiny_textual_chunk_count`
是预期现象，因为部分制度末尾附则、解释条款、单条定义本来就天然较短，继续强行放宽预算或跨语义边界合并，收益通常低于噪声代价。

## 预算变更门禁

当前不应因为“看起来还有一些短 chunk”就直接放宽预算。

允许调整 handbook chunk 预算的前提必须是：

1. 已完成 embedding
1. 已完成 retrieval / eval 抽样验证
1. 有明确证据表明现有预算造成召回、排序或回答质量下降

不允许作为单独理由的情况：

- 仅凭 sample 观感觉得 chunk 偏短
- 仅因为还存在诊断级 `tiny_textual_chunk_count`
- 仅因为想和旧 `campusRAG` 参数保持一致

如果未来需要继续调参，必须同时更新：

- 本文
- `configs/ingestion/regulations/student_rules/chunk-profile.json`
- 对应 validation / processing tests

## 相关真相源

- [configs/ingestion/regulations/student_rules/runtime-profile.json](../../confi
  gs/ingestion/regulations/student_rules/runtime-profile.json)
- [configs/ingestion/regulations/student_rules/chunk-profile.json](../../configs
  /ingestion/regulations/student_rules/chunk-profile.json)
- [docs/reference/student-handbook-normalization-strategy.md](../reference/stude
  nt-handbook-normalization-strategy.md)
- [packages/ingestion-core/src/campus_ingestion_core/chunking.py](../../packages
  /ingestion-core/src/campus_ingestion_core/chunking.py)
- [packages/ingestion-core/src/campus_ingestion_core/process.py](../../packages/
  ingestion-core/src/campus_ingestion_core/process.py)
- [packages/ingestion-core/src/campus_ingestion_core/handbook_chunking_validatio
  n.py](../../packages/ingestion-core/src/campus_ingestion_core/handbook_chunkin
  g_validation.py)
