# Quick Research: Internal Notice Regulation Owner Metadata

**Researched:** 2026-04-12
**Question:** 对 `internal_notice -> attachment -> regulation`，是否应使用显式 owner metadata 承载 source provenance 与 fail-close contract，而不是在后续阶段再从 parent notice wrapper 反推？
**Confidence:** HIGH

## Conclusion

是。当前官方实践更接近“metadata-first + child-level propagation”，不是“query/chunk 阶段再从 parent wrapper 回推 owner”。

- `semantic_owner_kind` 应显式存在，并继续传播到 promoted document metadata 与每个 chunk row metadata。
- `owner_source_missing_reason` 也应显式存在，但它主要服务于 fail-close / manual review 结果；不应依赖后续从 wrapper notice 再猜。对成功 promote 的 target doc，它通常不需要出现，因为这类记录按 contract 本就不该在 owner 缺失时进入 target collection。

## Why This Matches Official Practice

### 1. Parent metadata 应复制到 child/chunk，而不是留待后置推断

Azure AI Search 的 index projections 当前官方文档明确把 one-to-many indexing 的推荐形态写成：

- 在单一 child/chunk index 中重复 parent fields
- 显式映射 child side 的每个字段
- 不依赖 query-time join；官方直接说明这在 classic search 中不支持

对本问题的直接含义：

- semantic owner / provenance 如果是后续检索、过滤、审计要用到的语义，就应该和 child/chunk 一起落盘
- 不应期待“先只保留 parent wrapper，等 retrieval 或 chunk-prep 时再回头推断”

Source:
- https://learn.microsoft.com/en-us/azure/search/search-how-to-define-index-projections

### 2. 可过滤/可查询语义必须是显式索引字段，不是运行时临时猜测

Azure AI Search 的建索引文档明确说明：

- 字段是否能参与 query expression 取决于 schema attribution
- 没有被设置成可搜索/可过滤/可排序/可分面的字段，不能在查询表达式里引用

对本问题的直接含义：

- `semantic_owner_kind` 这类 owner 语义如果要参与后续过滤、审计、routing，就必须显式建模成 metadata
- “以后根据 parent wrapper 再推一次”不符合 metadata-first 索引思路

Source:
- https://learn.microsoft.com/en-us/azure/search/search-how-to-create-search-index

### 3. Chunk 级操作默认依赖 chunk 自带 metadata

Pinecone 当前官方 data modeling 文档建议：

- chunk 使用 structured IDs
- 每个 record/chunk 携带 comprehensive metadata
- 通过 metadata 完成 query-time filtering、traceability、document updates/deletes

对本问题的直接含义：

- promoted regulation chunk 应自带 owner/provenance metadata
- 如果 owner 信息不跟 chunk 走，后续过滤、审计、删除、重建都会退化成外围拼接逻辑

Source:
- https://docs.pinecone.io/guides/index-data/data-modeling

## Repo Fit

当前 repo 设计本身已经和这个方向一致：

- 架构文档已冻结 `semantic owner` 解析，并要求 owner 缺失时 fail-close 到 `manual_review_required`，不能直接把 wrapper notice body promote 成 regulation
  - `docs/architecture/authenticated-notice-source-architecture.md`
- promotion report 已显式记录 `semantic_owner_kind` 与 `owner_source_missing_reason`
  - `packages/ingestion-core/src/campus_ingestion_core/internal_notice_regulation_promotion.py`
- candidate artifact 已显式保留 `semantic_owner_kind`
  - `packages/ingestion-core/src/campus_ingestion_core/internal_notice_regulation_promotion.py`
- target projection metadata 已显式保留 `semantic_owner_kind`，并且每个 row/chunk 都通过 `metadata={**metadata, ...}` 复制 document-level metadata
  - `packages/ingestion-core/src/campus_ingestion_core/internal_notice_regulation_projection.py`

当前更细的实现观察：

- `semantic_owner_kind` 已经传播到 promoted target doc / chunk
- `owner_source_missing_reason` 目前停留在 promotion report / fail-close 结果层，没有继续进入 promoted target projection

这点本身不构成违背官方实践，因为：

- `owner_source_missing_reason` 对应的是“owner 未恢复完成”的 fail-close 语义
- 按当前 contract，这类记录不该进入 promoted target doc/chunk

## Recommendation

- 继续把 `semantic_owner_kind` 当作必须显式保留并向后传播的 owner metadata，覆盖：
  - promotion manifest/report
  - candidate artifact
  - promoted target document metadata
  - promoted chunk row metadata
- 继续把 `owner_source_missing_reason` 当作 fail-close contract 字段，显式保留在：
  - promotion report
  - manual-review artifact / review queue（如果后续新增）
- 不要把 owner 解析延后到 retrieval、chunk-prep 或 query 阶段再从 parent notice wrapper 推断。

## Bottom Line

“显式 owner metadata + child/chunk 级传播 + owner 缺失时 fail-close”符合当前官方 parent-child / metadata-first 索引实践。

“只保留 parent wrapper，后面再推断 owner”不符合。
