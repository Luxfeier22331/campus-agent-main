---
doc_type: reference
status: active
created: 2026-04-20
updated: 2026-04-20
---

# Internal Notice PDF Chunk Tuning Sample-Set Contract

## 文档边界

本文冻结 `campus_notices/internal_notice` 在 `attachment_ocr_required` lane 上做 PDF chunk tuning 时的样本集 contract。

它回答的是：

- PDF chunk tuning 应冻结哪一层 truth
- raw PDF、provider response、`layout-elements.jsonl`、`document-units.jsonl` 各自扮演什么角色
- 样本集应落在哪个 operations 前缀
- `sample-set-manifest.json`、`sample-manifest.json` 与 query truth 应至少包含什么字段

它不负责：

- 规定最终最优 chunk size 数值
- 替代 `internal_notice` 的 parser/provider routing contract
- 替代 retrieval eval、release gate 或 serving rollout 文档
- 把 chunk tuning 输出提升成 canonical release truth

当前仍应优先尊重：

- `docs/reference/internal-notice-offline-preparation-strategy.md`
- `docs/reference/internal-notice-offline-preparation-quality-acceptance.md`
- `docs/architecture/data-plane-architecture.md`

## 适用范围

当前 contract 只冻结以下 scope：

- `corpus=campus_notices`
- `collection=internal_notice`
- `lane=attachment_ocr_required`
- `asset_family=pdf`

也就是说：

- 当前它服务的是 OCR/layout-aware PDF child document 的 chunk 参数评估
- 它不覆盖 `notice_body`
- 它不覆盖 `attachment_text_extractable`
- 它也不直接覆盖 `regulations/*` 的 target-side chunk tuning

## 核心原则

PDF chunk tuning 的主评测输入固定为：

- frozen pre-chunk canonical truth

在当前 repo 语义下，这表示：

- 主输入是 `document-units.jsonl`
- 人工复审和失败归因继续同时保留 `layout-elements.jsonl` 与 `canonical.md`
- raw PDF 继续保留，但它是上游真相和 parser 回归输入，不是 chunk 参数扫描的直接输入

固定禁止：

- 只冻结 raw PDF，就直接把 parser/OCR 波动和 chunk 策略混在一起评估
- 只冻结最终 chunks 或 embeddings，反向失去对 chunk 输入边界的控制
- 把某次 eval run 的 Qdrant / retrieval 结果缓存伪装成样本集本体

## 采样单位

样本集的基本单位固定为：

- 单个 materialized PDF child document

不是：

- parent notice
- raw attachment relation
- 一整批 mixed documents

每条样本必须可稳定回链到：

- `document_id`
- `parent_document_id`
- `attachment_ref_id`
- raw source asset provenance

## 必须冻结的层

每条样本至少冻结两层 truth。

### Raw Layer

必须包含：

- raw PDF bytes
- raw/source object key
- source provenance

这层的职责固定是：

- parser/provider 切换时的端到端回归
- 证明当前 sample 不是手工伪造文本
- 在 `document-units` contract 变化后重建新的 pre-chunk truth

### Pre-Chunk Layer

必须包含：

- `provider-response.jsonl`
- `layout-elements.jsonl`
- `canonical.md`
- `document-units.jsonl`

这层的职责固定是：

- 作为 chunk tuning 的直接实验输入
- 让 operator / agent 能区分“chunk 问题”与“parser / normalization 问题”
- 保持 PDF OCR lane 的结构边界、标题、段落、表格和 anchor 可复查

## 不冻结的层

以下内容不得写回 sample-set frozen truth：

- `chunks.jsonl`
- embeddings
- vector collection
- rerank cache
- retrieval response cache

这些都属于 eval/output truth，而不是 sample-set input truth。

## 对象存储前缀

sample set 固定属于 operations truth，不属于 documents truth，也不属于 releases truth。

推荐前缀：

- `campus_notices/operations/chunk-tuning-sample-sets/{sample_set_version}/internal_notice/attachment_ocr_required/`

其中：

- `{sample_set_version}` 是这批 frozen sample 的稳定版本号
- 当前 lane 已固定为 `attachment_ocr_required`，不再额外塞入 source-truth 或 release 语义

推荐对象布局：

- `campus_notices/operations/chunk-tuning-sample-sets/{sample_set_version}/internal_notice/attachment_ocr_required/sample-set-manifest.json`
- `campus_notices/operations/chunk-tuning-sample-sets/{sample_set_version}/internal_notice/attachment_ocr_required/queries.jsonl`
- `campus_notices/operations/chunk-tuning-sample-sets/{sample_set_version}/internal_notice/attachment_ocr_required/samples/{sample_id}/sample-manifest.json`
- `campus_notices/operations/chunk-tuning-sample-sets/{sample_set_version}/internal_notice/attachment_ocr_required/samples/{sample_id}/raw.pdf`
- `campus_notices/operations/chunk-tuning-sample-sets/{sample_set_version}/internal_notice/attachment_ocr_required/samples/{sample_id}/provider-response.jsonl`
- `campus_notices/operations/chunk-tuning-sample-sets/{sample_set_version}/internal_notice/attachment_ocr_required/samples/{sample_id}/layout-elements.jsonl`
- `campus_notices/operations/chunk-tuning-sample-sets/{sample_set_version}/internal_notice/attachment_ocr_required/samples/{sample_id}/canonical.md`
- `campus_notices/operations/chunk-tuning-sample-sets/{sample_set_version}/internal_notice/attachment_ocr_required/samples/{sample_id}/document-units.jsonl`

固定禁止：

- 把 sample-set files 混写进 `campus_notices/documents/internal_notice/...`
- 把 sample-set files 混写进 `campus_notices/releases/...`
- 用 `.planning/quick/` 目录代替对象存储中的长期 sample-set truth

## `sample-set-manifest.json`

`sample-set-manifest.json` 是这批 sample 的总索引。

最小字段建议：

```json
{
  "sample_set_version": "2026-04-20-pdf-ocr-v1",
  "corpus": "campus_notices",
  "collection": "internal_notice",
  "lane": "attachment_ocr_required",
  "asset_family": "pdf",
  "status": "frozen",
  "sample_count": 64,
  "query_count": 192,
  "parser_provider_family": ["mineru_api", "paddleocr_async_jobs"],
  "document_units_schema_version": "authenticated_notice_projection_v1",
  "chunk_input_truth": "document-units.jsonl",
  "prefix": "campus_notices/operations/chunk-tuning-sample-sets/2026-04-20-pdf-ocr-v1/internal_notice/attachment_ocr_required/",
  "frozen_at": "2026-04-20T12:00:00+08:00"
}
```

固定规则：

- manifest 只描述这批 sample 的 frozen input truth
- 它不记录某次 chunk 参数试验的胜负结果
- 如果 parser/provider、`document-units` schema 或 lane semantics 变更到会影响 chunk 输入边界，必须产生新的 `sample_set_version`

## `sample-manifest.json`

每个 `sample_id` 必须有自己的 `sample-manifest.json`。

最小字段建议：

```json
{
  "sample_id": "pdf-ocr-0001",
  "corpus": "campus_notices",
  "collection": "internal_notice",
  "lane": "attachment_ocr_required",
  "asset_family": "pdf",
  "document_id": "notice_attachment:muc:351907:attachment-0001",
  "parent_document_id": "notice:muc:351907",
  "attachment_ref_id": "attachment-0001",
  "title": "新闻与传播学院推荐2026届本科生免试攻读研究生工作实施细则",
  "document_class": "policy_regulation_pdf",
  "risk_bucket": "long_policy_pdf",
  "raw_pdf_object_key": "authenticated_notice_portal/351907/2025/sha256/.../capture/raw.pdf",
  "provider_response_object_key": "campus_notices/operations/chunk-tuning-sample-sets/2026-04-20-pdf-ocr-v1/internal_notice/attachment_ocr_required/samples/pdf-ocr-0001/provider-response.jsonl",
  "layout_elements_object_key": "campus_notices/operations/chunk-tuning-sample-sets/2026-04-20-pdf-ocr-v1/internal_notice/attachment_ocr_required/samples/pdf-ocr-0001/layout-elements.jsonl",
  "canonical_markdown_object_key": "campus_notices/operations/chunk-tuning-sample-sets/2026-04-20-pdf-ocr-v1/internal_notice/attachment_ocr_required/samples/pdf-ocr-0001/canonical.md",
  "document_units_object_key": "campus_notices/operations/chunk-tuning-sample-sets/2026-04-20-pdf-ocr-v1/internal_notice/attachment_ocr_required/samples/pdf-ocr-0001/document-units.jsonl",
  "parser_provider": "mineru_api",
  "parser_version": "mineru_adapted_parser_v1",
  "normalization_version": "authenticated_notice_projection_v1",
  "frozen_at": "2026-04-20T12:00:00+08:00"
}
```

固定规则：

- `sample_id` 是 sample-set 内稳定主键，不依赖 document title slug
- `risk_bucket` 用于确保分桶覆盖，不替代 document semantics
- `raw_pdf_object_key` 继续回指真实上游对象；sample-set 内复制的 `raw.pdf` 只是调参与回归的 frozen mirror

## `queries.jsonl`

chunk tuning 不能只看 chunk 文本外观，必须同时冻结 query truth。

`queries.jsonl` 每行表示一个 query case，最小字段建议：

```json
{
  "query_id": "pdf-ocr-0001-q1",
  "sample_id": "pdf-ocr-0001",
  "question": "2026届推免申请的成绩构成是什么？",
  "expected_answer_type": "factoid",
  "gold_evidence": [
    {
      "page": 3,
      "section_path": ["第三章", "推荐条件"],
      "match_text": "由学业成绩和综合素质成绩两部分组成"
    }
  ],
  "must_not_retrieve": [
    "封面页",
    "目录页"
  ]
}
```

固定规则：

- `gold_evidence` 应尽量引用 page / section / snippet，而不是只写抽象答案
- `must_not_retrieve` 用于暴露 header-dominant、封面页抢占、目录页抢占等常见 PDF 失败形态
- 如果 query 集发生语义级扩面，应显式 bump `sample_set_version` 或为同一 sample set 补一个新的 query-set version

## 样本分桶

sample set 不接受“纯随机抓取 PDF”。

至少应显式覆盖以下 risk buckets：

- `clean_text_pdf`
- `ocr_noisy_pdf`
- `table_dense_pdf`
- `long_policy_pdf`
- `mixed_layout_pdf`

如果当前批次已经明确服务 annual / time-bound scoped rule 类 PDF，可额外补：

- `annual_rule_pdf`
- `time_bound_rule_pdf`

固定原则：

- bucket 用于保证分布覆盖，不等于 retrieval tag
- 同一个 sample 可以同时携带文档语义标签和 layout 风险标签，但 manifest 中必须有一个稳定主 bucket

## 版本刷新规则

以下变化发生时，必须新建 `sample_set_version`：

- PDF parser/provider 主路由变化
- provider canonical payload shape 变化
- `layout-elements.jsonl` contract 变化到会影响 chunk 输入语义
- `document-units.jsonl` schema 或 unit typing 变化
- chunk header/context 逻辑变化到会改变 pre-chunk truth 的输入边界

以下变化通常不需要重冻 sample set：

- 只调整 `chunk_size`
- 只调整 `max_chunk_size`
- 只调整 `chunk_overlap`
- 只调整 post-chunk eval ranking 逻辑

换句话说：

- sample set 冻结的是 chunk input truth
- 不是 chunk policy 本身

## Eval Output Boundary

对同一批 frozen sample 反复跑参数实验时，实验输出应落在独立 operations 前缀。

推荐前缀：

- `campus_notices/operations/chunk-tuning-evals/{eval_run_id}/internal_notice/attachment_ocr_required/`

这里允许写入：

- 候选参数组
- 生成后的 chunks
- retrieval metrics
- error analysis
- best-run summary

固定禁止：

- 把某个 eval run 的 chunks 回写成 sample-set frozen truth
- 因为某一轮参数表现更好，就地覆盖 `document-units.jsonl`

## 与当前 `internal_notice` posture 的关系

这份 contract 只服务：

- `offline_preparation` 阶段的 PDF chunk tuning

它不表示：

- `internal_notice` 已经开放 query-serving
- current PDF chunk profile 已经是最终最优值
- retrieval / rerank / citation 全链路已经闭环完成

因此当前最自然的使用方式固定是：

- 先冻结真实 PDF sample set
- 再基于 frozen `document-units.jsonl` 做 chunk 参数对比
- 最后把通过的参数回写到 collection chunk profile 或后续 acceptance evidence

## 相关稳定文档

- `docs/reference/internal-notice-offline-preparation-strategy.md`
- `docs/reference/internal-notice-offline-preparation-quality-acceptance.md`
- `docs/reference/restricted-document-center-artifact-contract.md`
- `docs/reference/runtime-serving-and-index-terms.md`
- `docs/architecture/data-plane-architecture.md`
