# Quick Task 260411-vk3 Summary

## Outcome

- 已把 `internal_notice -> institutional_regulations` 的 post-release consumption 从“只有 scaffold/plan”推进成 repo-owned executable truth。
- 新增 target materialization path：
  - `campus_ingestion_core.internal_notice_regulation_materialization`
  - `campus_ingestion_worker.materialize_internal_notice_regulation_candidates`
- 当前实现固定消费既有 `build_internal_notice_regulation_promotion_manifest` 结果，不再重复发明第二套 classification。

## What Changed

- target collection 现在可以从 `internal_notice` 的 `promote_candidate` canonical text 生成：
  - target `document_id` 由 `regulation_title_normalized + issuing_org + semantic scope` 派生
  - target `version_id` 由 canonical semantic content + effective date + revision signal 派生
- duplicate notice 不再需要多个 promoted target documents：
  - 一个 primary promoted document
  - duplicate provenance 聚合到 target metadata
- target scope refresh 现在显式替换 `regulations/institutional_regulations`
- source `campus_notices/internal_notice` rows 继续保持不变

## Docs / Contract Refresh

- `configs/ingestion/regulations/institutional_regulations/source-projections.v1.json`
  - 补齐实际落地的 aggregated provenance fields
- `configs/ingestion/regulations/institutional_regulations/README.md`
  - 从纯 scaffold 改成“已有 materialization path，但仍停在 offline_preparation”
- `configs/ingestion/campus_notices/internal_notice/README.md`
  - 新增 target materialization worker truth
- `docs/runbooks/internal-notice-policy-regulation-promotion-runbook.md`
  - 新增 operator runbook
- `docs/reference/institutional-regulations-promotion-quality-acceptance.md`
  - 新增当前 acceptance truth
- `docs/plans/*` 与 `.planning/STATE.md`
  - 不再把这条线描述成“待实现 promotion materialization”

## Boundary

- No target chunk preparation
- No embedding
- No Qdrant write
- No release
- No alias publish

## External Rationale

Qdrant 官方文档当前仍建议用 versioned physical collections + alias 作为 release-managed index posture，而不是把每一步 materialization 都直接等同于 serving publish。

参考：

- <https://qdrant.tech/documentation/concepts/collections/>
- <https://api.qdrant.tech/api-reference/aliases/update-aliases>

对当前 repo，这意味着：

- `institutional_regulations` materialization 先停在 registry/object-store truth 是合理边界
- target chunk prep / release / alias publish 仍应作为后续独立 wave 处理
