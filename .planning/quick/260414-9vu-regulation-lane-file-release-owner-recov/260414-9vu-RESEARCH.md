# Quick Task 260414-9vu Research

**Description:** 为 regulation lane 补 file_release owner-recovery readiness contract 与 matching tests  
**Mode:** quick-full-research

## Repo Facts

- collector 侧已经冻结 `file_release` export contract：
  - `apps/authenticated-notice-collector/src/types.ts`
  - `docs/reference/authenticated-notice-file-release-export-contract.md`
- regulation lane 当前对 `351119` 已能保留：
  - `owner_kind=file_release_document`
  - `relation_type=file_release_ref`
  - `owner_title_hint=中央民族大学差旅费管理办法`
- promotion 当前仍正确 fail-close 到：
  - `file_release_backed_regulation_body_missing`

## External Anchors

- DCMI `source`
  - <https://www.dublincore.org/specifications/dublin-core/dcmi-terms/terms/source/>
- DCMI `hasPart`
  - <https://www.dublincore.org/specifications/dublin-core/dcmi-terms/terms/hasPart/>
- DCMI `isPartOf`
  - <https://www.dublincore.org/specifications/dublin-core/dcmi-terms/terms/isPartOf/>
- DataCite Versioning
  - <https://support.datacite.org/docs/versioning>

这些外部锚点支持当前 repo 的固定解释：

- `notice`、`file_release`、`regulation` 必须保持分层
- readiness 只回答“来源是否可恢复”，不回答“正文是否已恢复”
- 在 owner 未恢复前，不允许把 wrapper notice 正文冒充 regulation body

## Decision

当前正确的下一条非认证任务不是放宽 promotion，也不是直接接 OCR，而是先补一个 bounded readiness consumer：

1. 读取 `file_release` bundle / manifest
2. 用 `owner_title_hint` 与 `filename/upfilename/original_filename` 做 bounded match
3. 输出 `ready / missing_capture / missing_source_bytes / ambiguous_match`

这能把下一次 auth window 的 capture 结果立即变成 repo-local 可消费的 readiness truth，但不会越权进入正文恢复。
