# Quick Task 260414-81f Research

**Description:** 为 regulation 文档标题/年份版本分离落地 non-breaking split metadata，并补 planning/docs 验收真相  
**Mode:** quick-full-research

## Repo Current Truth

- ADR-0040 已冻结 `work title / edition / display title` 三层设计。
- 当前 execution truth 仍未切换 `document_id`：
  - `document_id <- regulation_title_normalized + issuing_org + semantic_scope`
- 但 regulation lane 已需要先把标题/version 拆分能力落到当前 promotion/projection/materialization metadata。

本轮相关本地入口：

- `packages/ingestion-core/src/campus_ingestion_core/internal_notice_regulation_promotion.py`
- `packages/ingestion-core/src/campus_ingestion_core/internal_notice_regulation_projection.py`
- `configs/ingestion/regulations/institutional_regulations/source-projections.v1.json`
- `configs/ingestion/campus_notices/internal_notice/promotion-routing.v1.json`
- `tests/ingestion/test_internal_notice_regulation_promotion.py`
- `tests/ingestion/test_internal_notice_regulation_projection.py`

## External Norms

### Dublin Core

- `title`: 资源名称。
- `hasVersion`: 被描述资源的某个版本、版次或改编资源。
- `issued`: 资源正式发布的日期。

对本仓库 regulation lane 的含义是：标题、版本关系、发布时间应拆开，不该继续由一个扁平标题字段同时承担。

Sources:

- https://www.dublincore.org/specifications/dublin-core/dcmi-terms/terms/title/
- https://www.dublincore.org/specifications/dublin-core/dcmi-terms/terms/hasVersion/
- https://www.dublincore.org/specifications/dublin-core/dcmi-terms/terms/issued/

### DataCite

- Versioning 指南明确允许一个 canonical resource 代表所有版本。
- 具体版本与 canonical resource 通过 `HasVersion` / `IsVersionOf` 关联。
- 版本之间还可以通过 `IsNewVersionOf` / `IsPreviousVersionOf` 表达顺序。

这与 repo 当前想要收口到 `document_id(work)` / `version_id(version)` 的方向一致。

Source:

- https://support.datacite.org/docs/versioning

## Recommendation

本轮只做 non-breaking implementation slice：

- promotion report / candidate artifact 增加：
  - `regulation_work_title`
  - `regulation_edition_label`
  - `regulation_display_title`
  - `source_title_literal`
- projection/materialization metadata 透传这些字段
- docs / planning 明确：
  - 当前 metadata 已落地
  - 当前 identity 尚未切换

## Not In Scope

- 切换 `document_id` 输入
- replay / rematerialization
- chunking / embedding / Qdrant / release / alias
