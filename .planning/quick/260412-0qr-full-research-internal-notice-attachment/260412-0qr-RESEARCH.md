# Quick Research: internal_notice -> attachment -> regulation

**Researched:** 2026-04-12  
**Scope:** 明确 `internal_notice -> attachment -> regulation` 三层设计，并补一条“附件/文件发布壳通知” fail-close promotion 规则  
**Confidence:** HIGH for repo-local design, MEDIUM-HIGH for official pattern alignment

## Summary

当前 repo 的正确形态已经不是“从 notice 直接升格 regulation”，而是三层：

1. `internal_notice` 父 notice 作为 source-triage / restricted offline-preparation 层  
2. attachment 作为 derived child document 或 terminal outcome 层  
3. promoted canonical text 作为 semantic-owner collection 层

这条分层在本地文档、配置、代码和测试里都已经基本成立。最重要的 planning 结论是：**“关于发布/印发/修订 + 附件/文件下载”这种壳通知，父 notice 绝不能因为标题像制度名、正文里带几句摘要，就被直接 promote 成 canonical regulation。** 对这类 notice，promotion 必须 fail-close 到 “只允许 attachment child promote；父 notice 只保留在 `internal_notice`；附件链路不完整时进入 `manual_review_required`”。

官方最佳实践与这条设计并不冲突。Azure AI Search 当前官方文档明确建议：父文档和子文档/子块做 one-to-many 投影时，子索引必须重复父级 metadata，因为索引层不做 join；权限信息也要落到每个 child/chunk。Qdrant 官方文档也把 payload 当成一等过滤 metadata，并建议只在确实需要隔离时再拆 collection。对这个仓库来说，`internal_notice` 和 `regulations/*` 的分离是合理隔离；但 attachment lane 本身不应该再扩成更多“伪 semantic-owner collection”。

## Repo-Local Three-Layer Design

### Layer 1: `campus_notices/internal_notice` 父 notice

冻结事实：

- source-truth unit 是 `notice`，不是 crawl URL、collector row 或本地文件路径。
- 父 notice document 只承载 notice 正文结构单元。
- `attachment-refs.jsonl` 继续只是 relation truth，不并入父 notice chunk 输入。
- collection posture 仍是 `restricted + offline_preparation`，`retrieval_enabled=false`，`query_enabled_by_default=false`。

关键依据：

- `docs/architecture/authenticated-notice-source-architecture.md`
- `docs/reference/internal-notice-offline-preparation-strategy.md`
- `configs/ingestion/campus_notices/internal_notice/runtime-profile.json`

### Layer 2: attachment child document / terminal outcome

冻结事实：

- attachment 是执行分流主单位，不是整条 notice。
- 可进入文档链路的 attachment，必须先 materialize 成 repo-owned child document。
- child document identity 表达“notice 内稳定附件关系”；version 表达“附件内容 hash + extraction policy version”。
- child document 继承父 notice 的 `visibility_*`、`entitlement_groups`、`policy_projection_version`。
- terminal outcomes `reference_only` / `manual_review_required` / `no_extractable_text` 不是失败噪声，而是 canonical outcome truth。

当前 lane truth：

- `docx` 默认 `text_extractable`
- `pdf` 默认 `ocr_required`
- 空间关系主导图片固定 `manual_review_required`
- decorative / QR / 某些辅助图固定 `reference_only`

关键接缝：

- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_source_projections.py`
- `docs/decisions/adr-0031-authenticated-notice-attachment-typed-routing-and-spatial-review-boundary.md`
- `docs/decisions/adr-0033-internal-notice-pdf-cloud-ocr-default.md`

### Layer 3: promoted canonical documents

冻结事实：

- promotion boundary 是显式的、两段式的：
  - `build_internal_notice_regulation_promotion_manifest`
  - `materialize_*`
- promoted target document 的 `document_id` / `version_id` 已经明确脱离 `notice_id`。
- target metadata 会聚合 duplicate notice / duplicate attachment provenance，而不是把每条 wrapper notice 都变成一个 regulation。
- promoted text 现在已经分成两个 semantic-owner 目标：
  - `regulations/institutional_regulations`
  - `regulations/scoped_rules`

关键接缝：

- `packages/ingestion-core/src/campus_ingestion_core/internal_notice_regulation_promotion.py`
- `packages/ingestion-core/src/campus_ingestion_core/internal_notice_regulation_materialization.py`
- `packages/ingestion-core/src/campus_ingestion_core/internal_notice_scoped_rule_materialization.py`
- `packages/ingestion-core/src/campus_ingestion_core/internal_notice_regulation_projection.py`
- `docs/decisions/adr-0035-notice-derived-regulation-promotion-boundary.md`
- `docs/decisions/adr-0037-unified-scoped-rules-holding-collection.md`

## Official Pattern Check

当前官方资料支持的关键模式：

- **Parent/child one-to-many indexing should duplicate parent metadata onto children.** Azure AI Search 的 index projections 文档明确把 parent-to-child indexing 作为一等模式，并说明 chunk index 需要重复 parent fields，因为搜索索引不支持 join。  
  Source: https://learn.microsoft.com/en-us/azure/search/index-projections-concept-intro

- **Permissions belong on each indexed child/chunk, not only on the parent source row.** Azure AI Search 当前 ACL 文档明确说明访问控制信息会进入索引；在 chunking 情况下，权限 metadata 会落到 chunk 级记录上，并在权限变化时需要重新同步。  
  Source: https://learn.microsoft.com/en-us/azure/search/search-indexer-sharepoint-access-control-lists

- **Layout-preserving extraction is preferred over flattening mixed-format files into one generic text path.** Azure AI Search 的 semantic chunking/layout 文档把 PDF、Office、HTML 等结构提取和位置信息保留当成当前标准做法。  
  Source: https://learn.microsoft.com/en-us/azure/search/search-how-to-semantic-chunking

- **Metadata/payload should stay first-class, and collection splits should follow true isolation needs.** Qdrant 官方文档把 payload 作为过滤和附加语义的标准载体；多 collection 只在确实需要隔离时再拆。  
  Sources:
  - https://qdrant.tech/documentation/concepts/payload/
  - https://qdrant.tech/documentation/guides/multitenancy/

对本仓库的直接含义：

- `internal_notice` child docs 继续继承父级 ACL / provenance metadata 是对的。
- promotion 后的 target docs 继续聚合 `source_notice_ids` / `source_attachment_ref_ids` / duplicate provenance 也是对的。
- 但 promoted canonical regulation 不应继续只是 `internal_notice` 的子块视图；它已经跨到了新的 semantic owner，因此必须有独立 target identity。

## Recommended Fail-Close Rule For 附件/文件发布壳通知

### 规则

对 `parent_notice`，新增一条显式 fail-close promotion rule：

- 如果 notice 满足“wrapper/file-release shell”特征，则父 notice **永不** `promote_candidate`。
- 只有 attachment child document 才能成为 promotion candidate。
- 如果 attachment 链路不完整、没有 child candidate、或只落到 terminal outcome，则整条 notice 进入 `manual_review_required`，而不是回退为父正文 promotion。

### Shell 判定建议

满足任一即可视为 shell notice：

- 标题/正文仍有明显 wrapper 语义：
  - `关于发布`
  - `关于印发`
  - `关于修订`
  - `关于转发`
  - `附件`
  - `详见附件`
  - `请参照附件`
  - `下载附件`
- inventory 中存在任何需要 materialize 的 attachment plan：
  - `classification in {text_extractable, ocr_required}`
  - 或 `materialization_policy in {required_document, conditional_on_extracted_text}`
- 父 notice cleaned body 不具备稳定 standalone regulation structure，或仍残留明显 wrapper ending / file-release chrome

### 动作

- `shell + expected attachment child missing`  
  -> `manual_review_required`

- `shell + child exists but only terminal outcomes`  
  -> `manual_review_required`

- `shell + child candidate exists`  
  -> parent `hold_in_internal_notice`，child 才允许 promote

- `shell + parent body looks regulation-like only because quoted title / excerpt leaked into body`  
  -> 仍然禁止 parent promote

### 最适合落点

最合适的实现落点是：

- `packages/ingestion-core/src/campus_ingestion_core/internal_notice_regulation_promotion.py`

优先改这里：

- `_scan_document(...)`
- `_classify_document(...)`
- `extract_internal_notice_parent_regulation_body_preview(...)`
- `missing_materialized_attachment_refs` 之后的 parent routing

原因：

- 这里已经掌握 parent/attachment lineage、inventory、attachment plan、duplicate resolution、quality gates。
- 这里是 read-only manifest 判定层，最适合加 fail-close，而不是到 materialization 阶段再补救。

## Common Pitfalls

- **把 wrapper notice 摘要当 canonical regulation。** 这会把“关于发布/印发/修订”的外壳误写入 `regulations/*`。
- **用标题命中制度关键词替代 attachment adjudication。** 有 `办法/规定/细则/手册` 不等于父正文就是 canonical owner。
- **attachment terminal outcome 被静默吞掉。** `manual_review_required` / `no_extractable_text` / `reference_only` 必须保留为显式 outcome，而不是“不算数”。
- **duplicate attachment 按 notice 重复升格。** 当前代码已经用 `source_attachment_sha256 or record.content_hash` 做 duplicate resolution；新规则不能破坏这条去重。
- **把 ACL / provenance 只留在 parent。** 官方模式和本地实现都要求 child / promoted docs 自带授权和 provenance metadata。

## Integration Notes Before Planning

- `authenticated_notice_source_projections.py` 已经是父/子分层和 child metadata 继承的 owner，不要把 attachment 判定逻辑再搬到 promotion/materialization 层。
- `internal_notice_regulation_materialization.py` 已经负责把 duplicate notice provenance 聚合到 target metadata，并通过 scope refresh 重写 `regulations/institutional_regulations`。
- `internal_notice_scoped_rule_materialization.py` 已经存在，说明 `annual_cycle_rule` / `time_bound_operational_rule` 的下游 owner 现在是 `regulations/scoped_rules`，不是继续停在 source-side manual bucket。
- target-side provenance 扩展即使不改变 semantic content hash，也必须重写 target artifacts；不能偷复用旧 bytes。

## Repo Gotchas To Resolve Explicitly In The Plan

- `configs/ingestion/campus_notices/internal_notice/README.md` 里“annual/time-bound 在 source-side manifest 仍 manual review”的表述，和当前 `ADR-0037`、`internal_notice_scoped_rule_materialization.py`、以及对应测试并不完全一致。  
  Planning 时应以 **ADR-0037 + current code/tests** 为准，并把 README 漂移视为后续 docs cleanup。

- `configs/ingestion/campus_notices/internal_notice/promotion-routing.v1.json` 里写着 “not yet consumed by execution code”，但当前 `internal_notice_regulation_promotion.py` 实际已经在读取它。  
  这也是已知 docs drift。

- 当前 `tests/ingestion/test_internal_notice_regulation_promotion.py` 仍保留“annual/time-bound 可直接 promote into `institutional_regulations`”的断言；而 repo 新增的 `ADR-0037` 与 `materialize_scoped_rules_from_internal_notice_scope` 明确要求它们进入 `regulations/scoped_rules`。  
  这是 planning 前必须先统一的活跃冲突。

## Primary Recommendation

按以下口径计划：

- 固定三层：`internal_notice parent` -> `attachment child/terminal outcome` -> `semantic-owner target`
- 在 `promotion_manifest` 层新增“附件/文件发布壳通知” fail-close
- 明确只有 child attachment 才能代表文件发布类 notice 进入 canonical promotion
- 在开工前先统一 `annual_cycle/time_bound` 的当前真相，避免同时按两套 target collection 设计

## Sources

### Repo-local

- `docs/architecture/authenticated-notice-source-architecture.md`
- `docs/architecture/authenticated-notice-source-truth-contract.md`
- `docs/reference/internal-notice-offline-preparation-strategy.md`
- `docs/decisions/adr-0031-authenticated-notice-attachment-typed-routing-and-spatial-review-boundary.md`
- `docs/decisions/adr-0033-internal-notice-pdf-cloud-ocr-default.md`
- `docs/decisions/adr-0035-notice-derived-regulation-promotion-boundary.md`
- `docs/decisions/adr-0037-unified-scoped-rules-holding-collection.md`
- `configs/ingestion/campus_notices/internal_notice/runtime-profile.json`
- `configs/ingestion/campus_notices/internal_notice/chunk-profile.json`
- `configs/ingestion/campus_notices/internal_notice/promotion-routing.v1.json`
- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_source_projections.py`
- `packages/ingestion-core/src/campus_ingestion_core/internal_notice_regulation_promotion.py`
- `packages/ingestion-core/src/campus_ingestion_core/internal_notice_regulation_materialization.py`
- `packages/ingestion-core/src/campus_ingestion_core/internal_notice_scoped_rule_materialization.py`
- `tests/ingestion/test_internal_notice_regulation_promotion.py`
- `tests/ingestion/test_internal_notice_regulation_materialization.py`
- `tests/ingestion/test_internal_notice_scoped_rule_materialization.py`

### Official

- Azure AI Search index projections: https://learn.microsoft.com/en-us/azure/search/index-projections-concept-intro
- Azure AI Search ACL / chunk-level permission propagation: https://learn.microsoft.com/en-us/azure/search/search-indexer-sharepoint-access-control-lists
- Azure AI Search semantic chunking / layout extraction: https://learn.microsoft.com/en-us/azure/search/search-how-to-semantic-chunking
- Qdrant payload metadata: https://qdrant.tech/documentation/concepts/payload/
- Qdrant multitenancy / collection split guidance: https://qdrant.tech/documentation/guides/multitenancy/
