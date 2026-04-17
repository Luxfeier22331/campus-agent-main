# Quick Task 260414-regulation-effective-date-and-355282-materialization Research

## External Alignment

- DCMI Terms:
  - https://www.dublincore.org/specifications/dublin-core/dcmi-terms/
- W3C PROV-DM:
  - https://www.w3.org/TR/prov-dm/
- Azure AI Search index projections:
  - https://learn.microsoft.com/en-us/azure/search/search-how-to-define-index-projections

## Repo-Local Findings

- regulation promotion 当前真正的硬门槛是：
  - canonical owner text
  - wrapper removal
  - attachment/file-release provenance completeness
- `effective_date` 当前不会阻断 materialization，但仍挂在 `required_promotion_metadata`，会持续制造伪缺口。
- `355282` 已通过 owner recovery，下一步应该是 isolated materialization，而不是继续停在 promotion-only。

## Decision

- `source_notice_release_time` 保留为 notice-issued provenance metadata。
- `effective_date` 继续保留，但仅作为 optional regulation metadata。
- `355282` 进入 isolated target materialization 验证。
