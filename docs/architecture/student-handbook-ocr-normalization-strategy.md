---
doc_type: architecture
status: active
created: 2026-03-22
updated: 2026-03-26
---

# `student_handbook` Collection OCR 归一化与拆分策略

## 目标

把 `student_handbook` collection 的输入边界固定为 source bucket 中的 OCR 产物 `provider-response.jsonl`，而不是原始 PDF；同时把 handbook 从“一份 source 对应一个 document”的错误建模，收敛为“asset 级 OCR 结果 -> 内部统一 structured source/source truth -> 多逻辑文档 -> 文档内 structured units / chunks”。长期知识域 corpus 采用 `regulations`，`student_handbook` 只表示该 corpus 下的一个 collection；raw asset 不按 corpus 前缀组织，因为同一份原始文件可能被多个 corpus 复用。

本文回答三个问题：

- 主流文档 AI / RAG 链路通常如何做归一化
- 旧 `campusRAG` 实际采用了什么 handbook 归一化策略
- `campus-agent` 在当前阶段应该如何设计 handbook 的 source-level normalization

本文只覆盖 chunking 上游 truth：

- provider 归一化
- document boundary projection
- document-level cleaning
- unit normalization

具体 token budget、tokenizer、切分与 chunk 组装规则以
[student-handbook-chunking-and-validation-policy.md](./student-handbook-chunking-and-validation-policy.md)
为准。

## 结论

- `student_handbook` collection 的主输入应是 processed 层 `provider-response.jsonl`，不是 raw PDF。
- handbook 必须保留一层 asset-level `layout-elements.jsonl`，不能直接从 provider payload 进入逻辑文档拆分。
- `doc_id`、`version_id`、canonical metadata 应在逻辑文档层生成，不应在 source-level normalization 阶段提前冻结。
- handbook 的长期逻辑 identity 应采用 `document_id + representation + version_id`，而不是绑到某个 PDF 文件名。
- 文档切分是 normalization 之后、chunking 之前的独立步骤。
- handbook 的 canonical consumption 模型是 `single source consumption + multi-projection fan-out`：先固化 source truth，再声明哪些 projection 产出 handbook 文档、service-like derived document 或 attachment-like derived document。
- `article_body`、`policy_page`、`table`、`table_row` 仍然是 handbook 的文档内结构单元，但它们属于 document-level cleaning / chunking 结果，不属于 source-level structured truth。
- 文号、标题变体、试行/暂行附记等 metadata-only 前导信息应保留在 document metadata 中，不应作为独立 retrieval chunk 落盘。
- chunk 用于 embedding / retrieval 的文本应从 unit text 加上文档级上下文组装，而不是依赖单独的标题块或文号块参与检索。

## 主流策略

主流做法不是“直接把 OCR provider 原始 JSON 切成 chunks”，而是先抽出一个 provider-agnostic 的结构层，再做下游 projection。

共同模式可以概括为 5 步：

1. 保留 provider 原始响应，作为 provenance、重放和排障输入。
2. 把 provider payload 归一化为内部统一结构，通常保留 page / block / heading / table / reading order 等信息。
3. 以内部结构层为输入，恢复父子关系或逻辑文档边界。
4. 在逻辑文档层做清洗、标题归一化、条款恢复、metadata 冻结。
5. 只在逻辑文档内部做 chunking，并把父级 metadata 继承到子级 chunk。

这类模式的核心不是“先清洗文本”，而是先把结构和 provenance 固定下来，再允许不同 corpus 在同一内部 contract 上做清洗和切分。

## 为什么要保留 `layout-elements.jsonl`

如果直接从 `provider-response.jsonl` 清洗并拆出若干子文档，会有四个长期问题：

- 下游逻辑会直接绑定 provider 私有字段，后续更换 OCR 服务时需要整体重写。
- split、标题校验、页码校验、回归测试都只能复用 provider payload，无法复用稳定内部 contract。
- 无法把“source-level 结构误差”和“document-level 清洗误差”分开排查。
- asset 级 OCR 结果无法稳定重放到不同 split manifest、不同 cleaning policy 或不同 chunk policy。

因此 `layout-elements.jsonl` 的职责不是“多存一份文本”，而是把 provider truth 和 document truth 隔开。

## `campusRAG` 旧策略

旧 `campusRAG` 在 handbook 上实际已经验证了“单 PDF 多逻辑文档”的模型，但它的归一化起点更靠后。

它的有效做法有三类：

- 文档身份归一化：
  - `doc_id = "handbook:" + sha1(normalized_title)`
  - `normalized_title` 采用 `NFKC + trim + whitespace collapse`
  - `version_id` 由 `doc_type + normalized(title + body)` 的 hash 生成
- canonical metadata 归一化：
  - handbook canonical front matter 只保留稳定字段
  - 典型字段包括 `title`、`source_doc`、`page_start`、`page_end`、`handbook_section`、`policy_doc_no`
  - 明确禁止把 `ocr_run_id`、`chunk_id`、`version_id`、`acl` 等运行态字段写进 canonical front matter
- 结构优先的文档内建模：
  - 先把标题、章、节、`第X条` 提升为稳定结构
  - 再生成 `article_body`、`policy_page`、`table`、`table_row`
  - 最后才在单文档内部做 token guardrail chunking

旧方案的局限也很明确：

- 它主要从已经拆好的 canonical markdown / clean markdown 出发。
- 它没有把 `provider-response.jsonl -> layout-elements.jsonl` 这一层正式建成 contract。
- 它默认“source asset 已经被人工或前置流程拆成逻辑文档”，不适合作为当前 raw-first ingestion 的 source-level truth。

## `campus-agent` 的 handbook 设计

当前阶段建议把 handbook 固定为下面这条链路：

`provider-response.jsonl -> layout-elements.jsonl -> split-manifest -> per-doc source rows -> source truth -> declared projections -> canonical.md / metadata -> document-units.jsonl -> chunks`

当前 source artifact 的讨论样例可直接按 object key 理解为：

`ocr/pdf_ocr/student-handbook/2018/{raw_version_id}/provider-response.jsonl`

对应的原始来源资产路径应位于 source bucket：

`pdf/student-handbook/2018/{raw_version_id}/{original_filename}`

其中每一层的职责分别是：

- `provider-response.jsonl`
  - 保存 provider 原始响应
  - 仅承担 provenance、审计、重放、排障
- `layout-elements.jsonl`
  - 保存 asset 级、provider-agnostic 的 source rows
  - 作为 split 和 cleanup 的唯一直接输入
- `source truth`
  - 表示 handbook source 在 provider payload 之后、document projection 之前的 canonical rebuild boundary
  - 后续 replay、attachment projection、service projection 都必须从这里继续，而不是重新读取 raw PDF
- `split-manifest.v1.json`
  - 保存 handbook 多逻辑文档的页段真相
  - 不承载 OCR 文本，不承载 chunk 规则
- per-doc source rows
  - 保存单篇制度文档对应的 source rows
  - 仍然保留页码、顺序、表格和标题线索
- `canonical.md` / metadata
  - 冻结标题、文号、章条结构、`doc_id`、`representation`、文档级 stable metadata
- document-level `document-units.jsonl`
  - 保存 `article_body`、`policy_page`、`table`、`table_row`
  - 作为 registry 和 chunking 的直接输入

其中 `source truth` 的 fan-out 必须由 repo-tracked projection declaration 驱动。后续如果 handbook 需要派生出 `campus_services/service_catalog` 的导航文档、电话目录、附件、附录、表单模板或 navigation-like leaf，不允许为这些下游结果再开一条独立 raw-consumption lane。

## Source Truth Fan-Out Contract

handbook 的 canonical rebuild contract 固定如下：

- raw asset 只消费一次
- `provider-response.jsonl -> layout-elements.jsonl -> split-manifest -> per-doc source rows` 共同构成 persisted source truth
- declared projections 显式列出从该 source truth 派生出的 document family
- replay from source truth，而不是返回 raw

因此：

- handbook 自身的 `canonical.md` / `document-units.jsonl` 是一类 projection
- handbook-derived `campus_services` service/navigation document 是另一类 projection
- attachment-bearing、appendix-bearing、form-like、navigation-like leaf 只要具备独立下游价值，也应作为 explicit derived document projection

禁止做法：

- 不允许 handbook-only replay 继续作为长期唯一 replay 语义
- 不允许 later collection work 在 canonical source truth 已存在时返回 raw PDF 重新消费；do not return to raw
- 不允许继续把 `campus_services` handbook output 维持成独立 migration worldview
- 不允许把 attachment semantics 永久困在 handbook cleanup 内部而不生成 stable derived document

## 推荐的归一化层次

建议把 handbook 归一化分成四层，而不是把所有“清洗”混成一步。

### 1. Provider 归一化

目标是把 OCR provider 的私有响应投影成统一 source rows。

这一层应该做：

- 统一换行、空白、Unicode 兼容形态
- 统一页码语义为 1-based `page_start/page_end`
- 统一 block 类型到内部枚举，例如 `heading`、`paragraph`、`table`、`image`、`header`、`footer`、`page_number`、`unknown`
- 保留 reading order、bbox、provider page id、provider block id、置信度和原始 payload 引用
- 同时保留 `text_raw` 和轻量 `text_normalized`

这一层不应该做：

- 不生成 `doc_id` / `version_id`
- 不做跨页合并
- 不把 table 直接抹平成普通正文
- 不提前删除疑似页眉页脚
- 不把 provider 运行态字段写进 canonical metadata

### 2. Document Boundary Projection

目标是从整本 handbook 的 source rows 中恢复逻辑文档边界。

这一层应以 `split-manifest.v1.json` 为真相，并补充：

- 文档候选标题核对
- `page_start/page_end` 覆盖校验
- OCR 首屏标题与 manifest title 的比对
- 无法稳定匹配时的 import report，而不是静默并文

这一层同时承担 projection planning 的输入职责：

- handbook 主文档 projection 使用显式 split truth 产出 regulations 文档
- attachment / appendix / form / navigation-like leaf 的 projection 也必须从同一 source truth 选段，而不是单独重新 OCR 或单独回 raw
- handbook-derived `campus_services` document 应共享同一 parent/source provenance 约定

### 3. Document-Level Cleaning

目标是把单篇制度文档清洗为稳定 canonical 文本和 metadata。

这一层负责：

- 标题归一化
- 文号归一化
- 章 / 节 / 条恢复
- 重复页眉页脚和页码噪声清理
- 表格与正文分离
- `doc_id`、`version_id`、文档级 metadata 冻结

### 3.1 清洗规则矩阵

Document-level cleaning 当前应固定遵循以下规则：

- 标题行：
  - 使用 `NFKC + trim + whitespace collapse`
  - 允许去除纯版式空格差异
  - 不允许把标题语义改写成更短摘要
- 文号行：
  - 只在可稳定识别时写入 `policy_doc_no`
  - 不稳定或 OCR 缺损时宁缺毋滥
  - 不把文号单独落成 retrieval chunk
- metadata-only 前导信息：
  - 进入 document metadata / contextualization 输入
  - 不单独生成 `policy_page`
  - 不应阻断后续相邻条文聚合
- 页眉、页脚、页码、重复制表信息：
  - 在 document cleaning 阶段清除
  - 不应残留进 canonical body
  - 不应污染 `section_path`
- 章、节、部分、条款标识：
  - 作为结构恢复线索保留
  - 不把纯结构 heading 误当正文句子
- 表格：
  - 先与正文分离
  - 表头、行、注释在 unit 化阶段继续可追溯
  - 不把 HTML 表格原样泄漏到最终 chunk text

### 3.2 输出不变量

Document-level cleaning 之后必须满足：

- `canonical.md` 可作为人工对照真相
- `document-units.jsonl` 只包含单篇逻辑文档内容
- `doc_id`、`version_id` 与 document registry 一致
- `page_start/page_end` 保持来源可追溯
- 不保留运行态 chunk 字段，例如 `segment_index`、`chunk_id`、embedding payload
- 不允许把整句正文错误写进 `section_path` 尾部

### 4. Unit Normalization

目标是把 canonical 文档映射成 handbook 语义单元。

固定单元继续采用：

- `article_body`
- `policy_page`
- `table`
- `table_row`

只有这一层之后，才进入 chunking。

### 4.1 Unit 化判定规则

当前 handbook unit 化应固定为：

- `article_body`
  - 适用于存在稳定 `第X条` 条款身份的正文
  - `anchor` 中应尽量保留 `article_label`
- `policy_page`
  - 适用于没有稳定条文编号、但仍有页面级或小节级语义的正文
  - 常见于通知式制度、步骤说明、评审流程、名单式规则页
- `table`
  - 仅保留为父级表格语义容器，不直接参与 handbook retrieval chunking
- `table_row`
  - 适用于仍需保留逐行语义的 provider 表格
- `table_unit`
  - 适用于清洗后可直接进入 chunking 的表格表达

### 4.2 Unit 化边界

Unit normalization 必须满足以下边界：

- 不跨逻辑文档生成 unit
- 不因为 OCR 版式碎裂就把每一行都降成独立 `policy_page`
- 不把标题、文号、解释性前导语单独生成为检索 unit
- 不把表格重新抹平成普通 `article_body`
- 不把电话目录等非 regulations 语义内容继续保留在 `regulations/student_handbook`

### 4.3 下游契约

`document-units.jsonl` 作为 chunking 直接输入时，至少应稳定提供：

- `doc_id`
- `version_id`
- `unit_type`
- `root_unit_id`
- `anchor`
- `clean_text`
- `metadata`

其中：

- `anchor` 负责页码、section_path、article_label 等定位信息
- `metadata` 负责标题、文号、前导语等文档级上下文
- `clean_text` 是 chunk display text 的唯一正文来源

如果这三者边界混乱，后续 chunking 会退化成“正文、路径、header 三套信息相互覆盖”的 patchwork 行为。

## 推荐的 `layout-elements.jsonl` 最小字段

`layout-elements.jsonl` 应代表 asset 级 source rows，而不是 document-level chunks。建议最小字段分成五组：

### A. Source Identity

- `schema_version`
- `corpus`
- `source_artifact_id`
- `source_pdf`
- `page_start`
- `page_end`
- `row_id`
- `row_index`

### B. Provider Provenance

- `ocr_provider`
- `ocr_model`
- `provider_page_id`
- `provider_block_id`
- `provider_payload_ref`
- `confidence`

### C. Structural Semantics

- `row_type`
- `block_role`
- `heading_level`
- `reading_order`
- `bbox`

### D. Text Payload

- `text_raw`
- `text_normalized`
- `html`
- `table_cells`

### E. Downstream Hints

- `is_blank`
- `is_repeated_candidate`
- `title_candidate_score`
- `section_hint`

其中 `text_normalized` 应只承担轻量归一化，例如换行、空白、NFKC；不要在这里做语义重写。真正面向检索的 `clean_text` 仍然应在 document-level cleaning 之后生成。

## 推荐的 document-level 归一化策略

在 handbook 被切成单篇制度文档后，建议固定以下规则：

- `document_id` 继续采用稳定标题哈希策略，但不再把短期来源名编码为长期前缀；canonical object key 对外展示使用 `title_slug--{docid8}`
- `representation` 作为语义文本表示线固定存档；第一阶段 OCR ingest / replay 默认写 `source-faithful`
- `version_id` 由规范化后的 `title + body` 生成，不绑定 source asset 文件名或 provider job
- `source_channel` 显式记录来源渠道；第一阶段 OCR ingest / replay 默认写 `pdf_ocr`
- `is_current` 表示该表示线是否是当前对外生效线；source-faithful handbook 默认 `false`
- `policy_doc_no` 仅在可稳定识别时保留
- metadata-only 前导信息只进入 canonical metadata / contextualization 输入，不单独生成 `policy_page` unit
- `page_start/page_end` 属于文档真相，不应由 chunking 事后回推
- `document-units.jsonl` 必须写 `doc_id`、`version_id`、`unit_type`、`anchor`、`clean_text`
- `chunk_id`、embedding、Qdrant payload 仍然是更下游派生物，不回写 canonical markdown

## 与现有仓库边界的对应关系

- source bucket 的 `pdf/{source_asset_slug}/{year}/{raw_version_id}/...` 保存 corpus-agnostic 的原始来源资产
- source bucket 的 `ocr/{source_channel}/{source_asset_slug}/{year}/{raw_version_id}/...` 保留 source 级 `provider-response.jsonl`
- source bucket 的 `source-truth/{source_channel}/{source_asset_slug}/{year}/{raw_version_id}/...` 保留 source 级 `layout-elements.jsonl`
- document registry 只登记逻辑文档，不登记整本 handbook PDF 作为单一 document truth
- `regulations/documents/student_handbook/.../document-units.jsonl` 继续作为 `packages/ingestion-core` 的规章导向 chunking 输入
- 当前 query-serving 默认范围应表述为 `regulations` corpus 下的 `student_handbook` collection
- 对外展示或清洗效果对照应优先消费 `canonical.md`，不要直接拿 chunk 文本代替
- handbook 中的电话目录页不再保留在 `regulations/student_handbook` 的 split truth；后续应作为 declared projection 派生进入 `campus_services/contact_directory`
- handbook 中有独立下游价值的附录、表单、导航页或附件叶子节点，应通过 derived document projection 落入目标 collection，并显式保留 `projection_name`、`derived_from_*` 与 `parent_document_id`

## Representation 规则

逻辑文档 identity 固定拆成三层：

- `document_id`: 脱离 PDF / 网页载体的逻辑制度身份
- `representation`: 并行文本表示线，例如 `source-faithful`、`current-effective`、`editorial`
- `version_id`: 该表示线内的具体内容版本

第一阶段固定约束：

- handbook OCR ingest / replay 一律写入 `representation=source-faithful`
- `source_channel` 一律写入 `pdf_ocr`
- `is_current=false`
- 后续如果引入官网对照更新后的制度正文，应新增 `current-effective` representation，而不是覆盖 `source-faithful`

## 参考

外部主流实践参考：

- Azure AI Search: structure-aware semantic chunking with Document Layout and index projections
  https://learn.microsoft.com/en-us/azure/search/search-how-to-semantic-chunking
- Google Cloud Document AI Layout Parser: layout-first parsing and chunking guidance
  https://cloud.google.com/document-ai/docs/layout-parse-chunk
- LlamaIndex: `Document -> Node` parsing and metadata inheritance model
  https://docs.llamaindex.ai/en/stable/module_guides/loading/node_parsers/

本地参考：

- `docs/architecture/phase1-ingestion-and-storage-architecture.md`
- `docs/plans/2026-03-22-student-handbook-cleaning-reconstruction.md`
- `/home/reptilian/code/campusRag/docs/rag/student-handbook-canonical-schema.md`
- `/home/reptilian/code/campusRag/packages/rag-core/src/campusrag/pipelines/ingest/build_structured_from_clean_markdown.py`
