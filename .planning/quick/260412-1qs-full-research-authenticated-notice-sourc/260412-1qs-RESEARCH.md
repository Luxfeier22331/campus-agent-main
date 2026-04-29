# Quick Research: Authenticated Notice Owner Expectation Recovery

**Researched:** 2026-04-12  
**Question:** 当 authenticated notice 正文明确声明“附件正文”或“文件发布正文”存在，但 collector bundle 没有保留下游可用 relation 时，source-truth/import 应如何保留这层 owner signal，才能既不污染 attachment truth，又不把 regulation promotion 误导成 wrapper body promote？  
**Confidence:** HIGH

## Conclusion

应采用 metadata-first 的 source-level extension，而不是伪造 attachment rows。

- `source-truth/attachment-refs.jsonl` 只保留真实恢复出的 attachment relation。
- 当 relation 缺失但 notice 正文明确给出 owner 指向时，在 `notice-manifest.json` 中补 `owner_expectations`。
- inventory `parent_snapshot` 继续透传这层 metadata，promotion 优先消费显式 expectation，再决定 fail-close / manual review。

## Why This Matches Current Official Practice

### 1. Parent metadata 应显式复制到 child/chunk side

Azure AI Search 官方 index projections 文档当前明确要求 one-to-many indexing 时把 parent fields 显式映射到 child records，而不是依赖查询期 join 或后置回推。

这直接对应本仓库当前问题：

- owner provenance 是后续 promotion / audit 要消费的 metadata。
- 因此它应在 source-truth/import 阶段显式保留下来，而不是等 chunk/query 阶段再猜。

Source:
- https://learn.microsoft.com/en-us/azure/search/search-how-to-define-index-projections

### 2. Chunk/record 级 filtering 依赖显式 metadata

Pinecone 官方 data modeling 文档当前也建议每个 record/chunk 带完整 metadata，用于 filtering、traceability、update/delete orchestration。

这意味着：

- `semantic_owner_kind` 与 owner expectation 这类 provenance metadata 应显式携带。
- 不应把关键 owner 判断留到运行时临时回推。

Source:
- https://docs.pinecone.io/guides/index-data/data-modeling

## Repo Fit

当前 repo 已经在 `internal_notice -> regulation promotion` 层采用：

- `semantic_owner_kind`
- `owner_source_missing_reason`
- owner missing fail-close

因此剩余缺口不是 promotion 思路，而是 source-truth/import upstream seam：

- 当 `notice_attachments=[]` 且 `attachments=[]` 时，当前 source-truth 会把“制度正文应存在”这层事实丢掉。
- 补 `owner_expectations` 正好填的是这条接缝，而且不会伪造 attachment identity。

## Recommendation

- 在 `notice-manifest.json` 固定补：
  - `owner_expectation_count`
  - `owner_expectations`
- `owner_expectations[*]` 只允许表达：
  - `attachment_document`
  - `file_release_document`
- 禁止在这层伪造：
  - `object_key`
  - `content_sha256`
  - `byte_size`
  - 其他 attachment identity 字段

## Bottom Line

source-truth 应保留“owner 应存在”的显式信号，但不能把缺失 relation 冒充成真实 attachment truth。`owner_expectations` 是当前这条链路最小且正确的落点。
