# Quick Task 260414-regulation-owner-recovery-pilot Research

## Repo-Local Findings

- `internal_notice_regulation_promotion.py` 已经明确区分：
  - `attachment_document`
  - `file_release_document`
  - `notice_body`
- current current-scope manual-review 里：
  - `355282` 的 blocker 是 `attachment_backed_regulation_body_missing`
  - `351119` 的 blocker 是 `file_release_backed_regulation_body_missing`

- 本地 notice bundle 已经包含 `355282` 的附件 capture metadata 与 object key：
  - bundle path: `.tmp/auth-sso-tgc-20260412/exports/notices-bundle-20260411T222916.520Z.json`
  - attachment filename: `附件：中央民族大学关于学生使用人工智能的指导意见（2026版）.docx`

- 本地当前 source-truth 却仍显示：
  - `355282` attachment refs 缺失
  - `351119` attachment refs / owner expectations 也缺失

这说明下一步最值得验证的不是再改 promotion，而是验证已有 bundle/source bytes 能不能恢复 owner document。

## External Alignment

- W3C PROV-DM:
  - https://www.w3.org/TR/prov-dm/
- Azure AI Search index projections:
  - https://learn.microsoft.com/en-us/azure/search/search-how-to-define-index-projections

基于这些资料做出的工程推断：

- attachment child document 必须保留可回溯到 upstream source unit 的 provenance key，不能只在 projection 过程中临时可见。
- child projection 缺失 provenance 字段时，应优先从 canonical source-truth ref 层回填，而不是在 regulation layer 猜测生成。
- 已抓到但尚未投影的 owner file 应先在 source/projection 层补齐，再决定是否 promote。
- 没抓到的 owner file 必须继续显式停在 manual-review / recovery contract，不能让 regulation layer 猜测补全。
