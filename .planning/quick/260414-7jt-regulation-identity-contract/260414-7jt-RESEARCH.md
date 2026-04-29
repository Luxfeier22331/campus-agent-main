# Quick Task 260414-7jt Research

**Description:** 冻结 regulation 文档标题/年份版本 双层 identity contract 并更新设计文档  
**Mode:** quick-full-research

## Repo Current Truth

- 当前 regulation lane 仍以 `regulation_title_normalized` 作为主标题字段。
- 当前 `document_id` 仍由 `regulation_title_normalized + issuing_org + semantic_scope` 派生。
- 当前 `version_id` 仍由 `content_hash + effective_date + revision_signal` 派生。
- 因此像 `中央民族大学关于学生使用人工智能的指导意见（2026版）` 这样的标题，当前会把 `2026版` 混入 work-level identity。

关键本地入口：

- `packages/ingestion-core/src/campus_ingestion_core/internal_notice_regulation_projection.py`
- `configs/ingestion/regulations/institutional_regulations/canonical-profile.json`
- `configs/ingestion/regulations/institutional_regulations/source-projections.v1.json`
- `docs/reference/institutional-regulations-promotion-quality-acceptance.md`

## External Norms

### 1. Dublin Core

- `title` 表示资源名称。
- `hasVersion` 表示该资源存在一个版本/版次/改编资源。
- `issued` 表示正式发布/颁布日期。

这说明标题、版本关系、发布时间应分开，而不是把版本标签揉进单一 title identity。

Sources:

- https://www.dublincore.org/specifications/dublin-core/dcmi-terms/terms/title/
- https://www.dublincore.org/specifications/dublin-core/dcmi-terms/terms/hasVersion/
- https://www.dublincore.org/specifications/dublin-core/dcmi-terms/terms/issued/

### 2. DataCite

- `Versioning` 文档明确把具体版本和 canonical resource 分开。
- 当一个资源需要代表多个具体版本时，可以存在 canonical identifier，再用 `HasVersion` / `IsVersionOf` 关联具体版本。
- 版本顺序变化可用 `IsNewVersionOf` / `IsPreviousVersionOf` 表达。

这与 repo 当前 `document_id` / `version_id` 双层结构相容，但要求 work identity 和具体版次分层。

Source:

- https://support.datacite.org/docs/versioning

### 3. Akoma Ntoso / FRBR

- FRBR 明确区分 `work`、`expression`、`manifestation`、`item`。
- 法律文书长期更适合按 work-level identity 建根，再按 expression/version 演进。

Source:

- https://docs.oasis-open.org/legaldocml/akn-core/v1.0/cos01/part1-vocabulary/akn-core-v1.0-cos01-part1-vocabulary.html

## Recommendation

建议把当前扁平 `regulation_title_normalized` 设计升级为：

- `regulation_work_title`
- `regulation_edition_label`
- `regulation_display_title`
- `source_title_literal`

并固定：

- `document_id <- regulation_work_title + issuing_org + semantic_scope`
- `version_id <- semantic_content_hash + effective_date + regulation_edition_label/revision_signal`

## Migration Risk

- 这是一条 contract change，不是展示小修。
- 当前 execution truth 仍依赖 `regulation_title_normalized`，不能直接把 acceptance doc 改写成“已经生效”。
- 先落 ADR / design doc 最稳；代码与 replay 迁移应单独作为下一 quick task。
