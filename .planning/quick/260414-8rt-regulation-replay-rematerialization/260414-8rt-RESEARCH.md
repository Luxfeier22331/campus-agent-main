# Quick Task 260414-8rt Research

**Description:** 完成 regulation lane 的定向 replay/rematerialization，并把 ADR-0040 的 title/version identity 真正落到本地 regulation target  
**Mode:** quick-full-research

## Repo Current Truth Before Replay

- ADR-0040 已冻结：
  - `regulation_work_title`
  - `regulation_edition_label`
  - `regulation_display_title`
  - `source_title_literal`
- 当前代码执行 truth 已切到：
  - `document_id <- regulation_work_title + issuing_org + semantic_scope`
  - projected/materialized `title <- regulation_display_title`
- 但上一条 quick task只做了 code/doc cutover，没有重跑 replay/rematerialization。
- 当前 formal local current-scope regulation import 仍固定按 Cohort A vetted notice-id 白名单执行，不能对整个 `internal_notice` current scope 做 unfiltered replace。

## External Norms

### Dublin Core

- `title`: resource 的名称。
- `hasVersion`: related resource that is a version, edition, or adaptation。
- `issued`: formal issuance date。

这说明：

- 标题、版本关系、发布时间应该分开建模
- 不能把 `2026版` 这类 version label 继续混进 work identity

Sources:

- https://www.dublincore.org/specifications/dublin-core/dcmi-terms/terms/title/
- https://www.dublincore.org/specifications/dublin-core/dcmi-terms/terms/hasVersion/
- https://www.dublincore.org/specifications/dublin-core/dcmi-terms/terms/issued/

### DataCite

- 同一个 canonical resource 可以表示 “all versions of a resource”
- 具体版本通过 `HasVersion` / `IsVersionOf` 关联
- 小版本可更新 metadata；重大变化可分配新的 version-specific DOI

对 repo regulation lane 的直接对应是：

- `document_id` 应绑定 work identity
- `version_id` 应承担具体版本差异

Source:

- https://support.datacite.org/docs/versioning

### Akoma Ntoso

- 法律文档建模继续区分 `FRBR Work / Expression / Manifestation`

这进一步支持 regulation lane 不把 notice wrapper、owner regulation body、materialized target row 混成一个层级。

Source:

- https://docs.oasis-open.org/legaldocml/akn-core/v1.0/cos01/part1-vocabulary/akn-core-v1.0-cos01-part1-vocabulary.html

## Implementation Inference

- 这次应该做 replay/rematerialization，而不是再改 title/version 设计本身。
- formal current-scope replay 必须继续限定在 vetted notice-id 白名单。
- `355282` 是本轮最关键的隔离 sample，因为它能真实证明：
  - `regulation_work_title = 中央民族大学关于学生使用人工智能的指导意见`
  - `regulation_edition_label = 2026版`
  - `regulation_display_title = 中央民族大学关于学生使用人工智能的指导意见 / 2026版`
- Cohort A formal refresh 的价值不在于引入更多版本化样本，而在于把本地 regulation target 实际重刷到当前 execution truth，并验证没有 scope leakage。

## Out Of Scope

- chunk prep
- embedding / Qdrant
- release / alias publish
- `notice` / `attachment` / `regulation` 层级重构
- unfiltered internal_notice full-scope materialization
