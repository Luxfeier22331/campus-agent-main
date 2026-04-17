# Quick Task 260414-96b Research

**Description:** 收口 `中央民族大学差旅费管理办法（民大校发〔2025〕104号）` 的 file-release owner recovery，并为 regulation 导入准备可执行入口  
**Mode:** quick-full-research

## Repo Current Truth

### 已完成的 regulation 导入部分

- Cohort A 的 `10` 条 regulation 已完成 formal local current-scope import。
- `中央民族大学关于学生使用人工智能的指导意见（2026版）` 已通过 attachment owner recovery + isolated replay，证明：
  - `attachment` owner 路径可成立
  - replay/rematerialization 已落到当前 title/version truth

### 当前真正剩余的 regulation blocker

- 只剩：
  - `中央民族大学差旅费管理办法（民大校发〔2025〕104号）`
- 当前 source 层实际形态是：
  - `notice` 正文里明确写了“见信息门户-文件发布，请自行下载参照执行”
  - `attachment-refs.jsonl` 为空
  - `discovered-links.jsonl` 为空
  - `notice_attachments` 为空
  - 因此它不是 attachment-backed owner missing，而是 `file_release_backed_regulation_body_missing`

### 应暂时排除出这条 quick task 的对象

- `中央民族大学新一轮本科教育教学审核评估应知应会手册`
  - 当前仍表现为 attachment-backed owner missing
  - 但从 collection strategy 看，它更像 handbook/manual family，不应和 finance regulation 的 file-release owner recovery 混成同一条执行任务

## External Norms

### Dublin Core

- `source`
  - related resource from which the described resource is derived
- `hasPart` / `isPartOf`
  - 用来表达资源之间物理或逻辑包含关系
- `hasVersion`
  - 用来表达 version / edition / adaptation
- `issued`
  - 用来表达正式发布日期

对 repo 当前 regulation lane 的直接约束是：

- `notice` 不能冒充 regulation body
- `file_release` 也不能被伪装成 `notice`
- promoted regulation 可以从 `file_release` owner body derivation 而来，但 relation/provenance 要显式保留

Sources:

- https://www.dublincore.org/specifications/dublin-core/dcmi-terms/terms/source/
- https://www.dublincore.org/specifications/dublin-core/dcmi-terms/terms/hasPart/
- https://www.dublincore.org/specifications/dublin-core/dcmi-terms/terms/isPartOf/
- https://www.dublincore.org/specifications/dublin-core/dcmi-terms/terms/hasVersion/
- https://www.dublincore.org/specifications/dublin-core/dcmi-terms/terms/issued/

### DataCite

- canonical resource 与 version-specific resource 应分开
- 对大改版可以给 version-specific identifier，并通过 relation 关联到 canonical resource

这继续支持：

- `中央民族大学差旅费管理办法`
  - 作为 work title
- `民大校发〔2025〕104号`
  - 更适合作为 edition / provenance / citation-level signal，而不是 wrapper notice identity

Source:

- https://support.datacite.org/docs/versioning

## Implementation Inference

- regulation lane 的下一步不应再是 replay/title/version 改造；这一部分已经完成。
- 下一步也不应直接扩大批次，因为当前真正的前向 blocker 是 source acquisition contract：
  - `notice` 已知有 owner document
  - 但 owner document 在 `file_release` surface，不在 `notice` attachment surface
- 因此最合理的 GSD 下一条 quick task是：
  - 单点打通 `中央民族大学差旅费管理办法（民大校发〔2025〕104号）`
  - 明确 `file_release` export 进入 regulation owner recovery 的 contract
  - 若本地无 source bytes，则 fail-close 到“等待认证窗口内 bounded export”

## Recommended Route

1. regulation-only，不扩题。
2. 先做 `351119 / 中央民族大学差旅费管理办法（民大校发〔2025〕104号）`。
3. 只有它完成后，才评估下一批 `file_release`-backed regulation family。
4. `应知应会手册` 暂不混入这条 quick task。
