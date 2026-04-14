# Quick Task 260414-8sd Research

**Description:** 切换 regulation target 到 work-title identity，并把 projected/materialized title 收口到 display_title  
**Mode:** quick-full-research

## Repo Current Truth Before This Slice

- ADR-0040 已冻结 `work title / edition / display title` 三层模型。
- 上一条 quick task 已把 `regulation_work_title / regulation_edition_label / regulation_display_title / source_title_literal` 以 metadata 形式落地。
- 但在这条 slice 之前：
  - `document_id` 仍基于 `regulation_title_normalized`
  - projected/materialized `title` 仍未正式切到 `regulation_display_title`

## External Norms

### Dublin Core

- `title` 表达资源名称。
- `hasVersion` 表达某个版本、版次或改编资源。
- `issued` 表达正式发布日期。

这说明 title、version relation 与 issued date 应拆开，而不是把版次继续绑定到 work identity。

Sources:

- https://www.dublincore.org/specifications/dublin-core/dcmi-terms/terms/title/
- https://www.dublincore.org/specifications/dublin-core/dcmi-terms/terms/hasVersion/
- https://www.dublincore.org/specifications/dublin-core/dcmi-terms/terms/issued/

### DataCite

- versioning 指南允许 canonical resource 代表所有版本。
- 具体版本通过 `HasVersion` / `IsVersionOf` 挂到 canonical resource 上。

对本仓库的直接对应是：

- `document_id` 应绑定 work identity
- `version_id` 继续承担版本差异

Source:

- https://support.datacite.org/docs/versioning

## Implementation Inference

- `document_id <- regulation_work_title + issuing_org + semantic_scope`
- projected/materialized `title <- regulation_display_title`
- canonical markdown 继续保留原题名语义，不强制重写为斜杠显示格式
- `<work title> / <edition label>` 是 repo-local display convention

最后一条是基于 work/version 分层原则做出的产品内显示约定，不是外部规范原文。

## Out Of Scope

- replay / rematerialization
- chunk prep / embedding / Qdrant / release
- scoped_rules 或其他 collection 的并行改造
