---
doc_type: reference
status: active
created: 2026-04-06
updated: 2026-04-06
---

# Internal Notice Offline Preparation Strategy

## 文档边界

本文冻结 `campus_notices/internal_notice` 在 `source-truth replay -> document build -> split / cleanup / chunk -> verified chunk preparation` 这一段的 collection-specific strategy。

它回答的是：

- parent notice 与 attachment child document 应如何分 lane 处理
- 哪些内容属于 `chunk preparation`，哪些内容属于后续 `index release`
- 当前 runtime 默认预算与长期 collection strategy 是什么关系
- `internal_notice` 的 preparation artifacts 应落在哪个对象存储前缀

它不替代：

- `docs/architecture/authenticated-notice-source-architecture.md` 的 source-channel supporting architecture
- `docs/architecture/authenticated-notice-source-truth-contract.md` 的 source-truth schema
- `docs/architecture/data-plane-architecture.md` 的 repo 级 shared data-plane rules
- `docs/reference/internal-notice-offline-preparation-quality-acceptance.md` 的质量验收规则
- `docs/runbooks/authenticated-notice-source-truth-replay-runbook.md` 的 operator workflow

## 当前 Collection 姿态

- `source_channel=authenticated_notice_portal`
- `corpus/collection=campus_notices/internal_notice`
- `serving_stage=offline_preparation`
- `retrieval_enabled=false`
- `query_enabled_by_default=false`
- collection 默认按 `restricted institutional document` rollout 处理

当前语料特征固定按以下判断建模：

- notice 正文整体较干净，主问题不是 parent notice body
- 历史噪声主要集中在 attachments，尤其图片 OCR、脏表格和装饰性静态资源
- 因此 collection 默认优化目标是先保住 parent notice body 质量，而不是因为 attachment outlier 全局缩小分块或全局劣化正文策略

## Accepted Lane Model

`internal_notice` 的离线 preparation 固定按四类 lane 处理：

- `notice_body`
- `attachment_text_extractable`
- `attachment_ocr_required`
- terminal outcomes: `reference_only` / `no_extractable_text` / `unsupported_binary`

这四类 lane 都建立在既有“两层 projection”之上：

- parent notice document 只承载 notice 正文与正文结构单元
- attachment refs 留在 source-truth relation truth
- attachments 如需进入 document/chunk pipeline，必须先 materialize 为 repo-owned child documents

## Parent Notice Lane

parent notice lane 的固定规则：

- 只消费 notice 正文结构单元
- `attachment_ref` 结构单元必须显式跳过
- 默认按正文结构做 `structure-first` 聚合，保留 heading / section anchor
- 不把 attachment OCR、脏表格或 decorative asset 的问题反向投射为 parent notice 的全局分块策略
- notice body 中偶发的异常表格或噪声块，只能作为局部异常处理，不得驱动整个 collection 缩小 chunk

这条 lane 的目标是让内部通知正文保持较高语义完整度，而不是把所有 notice 正文预先切成更小的均匀窗口。

## Attachment Text-Extractable Lane

`attachment_text_extractable` 的固定规则：

- 先完成确定性的 native text extraction，再进入 cleanup / chunk
- chunking 以 attachment 自身结构为准，不复用 parent notice body 的 anchor 和分块策略
- 保留 page / section / heading 等 attachment 自身的定位线索
- 不把 attachment 文本重新拼回 parent notice 的正文 chunk

这条 lane 面向可稳定提取文本的 Office / PDF / 富文本附件，目标是保住附件本体结构，而不是把附件降格为 notice 正文的附属片段。

## Attachment OCR Lane

`attachment_ocr_required` 的固定规则：

- 先走 OCR / layout-aware extraction，再进入 cleanup / chunk
- 表格、图片区块、段落区块的边界应优先保留，不以 parent notice 的 chunk 预算直接套用
- OCR lane 的异常处理只在 lane 内收口，不得反向降低 `notice_body` lane 的默认质量
- materialized OCR child document 的 first-class derived artifacts 固定包含：provider response、`layout-elements.jsonl`、canonical markdown、`document-units.jsonl`
- OCR child document 的结构化单元固定优先表达为 `attachment_title`、`section_text`、`table`、`table_unit`，而不是把整份附件压平成单一 `attachment_body`
- provider 返回的 raw html / table markup 只允许停留在 lane-local `layout-elements.jsonl`，不得直接进入 canonical markdown 或最终 chunk text

这条 lane 的一等结果形态只有两类：

- `materialized_document`
- `no_extractable_text`

其中：

- 有非空标准化文本时，必须 materialize child document
- OCR 结果为空时，不得伪造空 child document，也不得把整条 notice 视为 source-truth 损坏

## Reference-Only And Failure Outcomes

以下结果不进入可检索 document/chunk truth：

- `reference_only`
- `no_extractable_text`

其中：

- `reference_only` 继续只保留 source-truth relation truth
- `no_extractable_text` 必须作为 attachment outcome 被显式记录，供 verifier / operator 审计

以下结果直接 fast-fail：

- `unsupported_binary`

固定禁止：

- 不把 decorative asset 误判成 OCR candidate 后再静默降级
- 不把 `unsupported_binary` 伪装成空文档或 reference-only 成功

## Current Runtime Defaults vs Long-Term Strategy

当前 repo-tracked `chunk-profile.json` 仍保留一组 generic runtime defaults：

- `chunk_size=220`
- `max_chunk_size=320`
- `chunk_overlap=32`
- `min_chunk_size=32`

这组数值当前只应解读为：

- `internal_notice` 的 chunk-preparation admission baseline
- generic structured-unit pipeline 的运行时默认值

它不应被误读为：

- `internal_notice` 已经完成 lane-specific semantic chunking
- parent notice 与 attachments 共享同一长期最优策略
- 只要继续调这组全局预算，就能替代 collection-specific lane design

因此本 collection 的 accepted direction 固定为：

- runtime default 可以暂时存在
- 但长期 truth 是 lane-specific semantic strategy，而不是单一 generic budget

## Chunk Preparation Boundary

`chunk preparation` 在 `internal_notice` 上固定只负责：

- 读取 registry current truth 下的 parent / child documents
- 执行 split / cleanup / chunk
- 生成 validation summary 与 document reports
- 产出一个可被后续 release gate 验证的 preparation manifest

`chunk preparation` 明确不负责：

- embedding
- Qdrant upsert
- alias publish
- attachment extraction / cleanup / chunk quality acceptance

对 `internal_notice`，`chunk preparation` 与 `index release` 必须是两个显式阶段，不能再把它们揉成单个 black-box 命令。

额外固定规则：

- `prepare_registry_scope_chunks` 的结构通过不等于 `internal_notice` 质量通过
- 质量验收固定由 `docs/reference/internal-notice-offline-preparation-quality-acceptance.md` 定义

## Preparation Artifacts

`internal_notice` 的 preparation truth 固定落在 operations prefix，而不是 release prefix：

- `campus_notices/operations/registry-scope-chunk-preparation/{preparation_run_id}/internal_notice/chunk-preparation.json`
- `campus_notices/operations/registry-scope-chunk-preparation/{preparation_run_id}/internal_notice/validation-summary.json`
- `campus_notices/operations/registry-scope-chunk-preparation/{preparation_run_id}/internal_notice/document-reports.jsonl`

其中：

- `chunk-preparation.json` 是 current scope 的 frozen preparation truth
- `validation-summary.json` 记录这次 preparation 的 admission verdict
- `document-reports.jsonl` 用于按 document 审计失败和异常

attachment child document 的 derived artifacts 继续落在 documents prefix，但固定补充以下路径规则：

- artifact directory 必须由完整 `document_id` 派生稳定 identity，而不是只看最后一级附件 ref
- 当 `document_id` 较长时，目录短标签可以退化成稳定 hash；但不同 notice 下的同名 attachment ref 不得落进同一路径
- 这条规则用于避免 `notice_attachment:<site>:<notice_id>:attachment-0001` 这类 historical corpus 在 derived bucket 中发生 key collision

固定禁止：

- 把 preparation artifacts 写进 `campus_notices/releases/...`
- 把 preparation 结果当成已经完成 embedding / indexing 的 release truth

## Release Gate

`internal_notice` 的后续 `index release` 固定受 preparation gate 约束：

- release 必须显式引用一个成功的 `preparation_run_id`
- release 前必须验证 preparation manifest 与 current registry scope hash 一致
- release 与 preparation 之间不存在“默认自动继续”的隐式跳转

因此对当前 collection posture，最自然的可验证停点是：

- verified chunk preparation

而不是：

- source-truth replay 完成就视为可以直接写 embedding / Qdrant

## Forbidden Shapes

- 不把 attachment 文本重新并回 parent notice body
- 不因为 attachment lane 的脏表格或 OCR 噪声，全局缩小 parent notice chunk
- 不把 `220/320/32/32` 这组 generic runtime defaults 当成最终 collection strategy
- 不让 `chunk preparation` 产生 embedding / Qdrant side effects
- 不跳过 verified preparation，直接从 replay 进入 index release

## 相关稳定文档

- `docs/architecture/authenticated-notice-source-architecture.md`
- `docs/architecture/authenticated-notice-source-truth-contract.md`
- `docs/architecture/data-plane-architecture.md`
- `docs/reference/internal-notice-offline-preparation-quality-acceptance.md`
- `docs/reference/runtime-serving-and-index-terms.md`
- `docs/runbooks/authenticated-notice-source-truth-replay-runbook.md`
- `configs/ingestion/campus_notices/internal_notice/README.md`
