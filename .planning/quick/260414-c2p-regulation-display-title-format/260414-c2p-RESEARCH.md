# Quick Task 260414-c2p Research

**Description:** 冻结 regulation display-title 的完整版次标签格式，并补回归测试锁住 `版次/修订/暂行/届别/文号` 边界  
**Mode:** quick-full-research

## Repo Current Truth

- regulation lane 当前已完成：
  - `document_id <- regulation_work_title + issuing_org + semantic_scope`
  - projected/materialized `title <- regulation_display_title`
- 当前已知真实样本同时包含：
  - `中央民族大学关于学生使用人工智能的指导意见（2026版）`
  - `中央民族大学实验室安全管理规定（2026年修订）`
  - `中央民族大学丰台校区就医管理办法（暂行）`
  - `新闻与传播学院推荐2026届本科生免试攻读研究生工作实施细则`
  - `中央民族大学差旅费管理办法（民大校发〔2025〕104号）`

这说明 regulation 标题里的“年份”并不只表达一个语义：

- 有些是版本标签：
  - `2026版`
  - `2026年修订`
- 有些是标题本体：
  - `2026届`
- 有些是状态限定词：
  - `暂行`
- 有些是引用/发文字号：
  - `民大校发〔2025〕104号`

如果把 display-title 压成裸年份，例如 `... / 2026`，会直接丢失版本语义，并且更难与 `2026届` 这类正文标题成分区分。

## External Norms

### Dublin Core

- `title` 表达资源名称。
- `hasVersion` 表达相关版本资源。
- `issued` 表达正式发布日期。

对 repo 当前 regulation lane 的直接含义是：

- 标题与版本关系应分开建模；
- 版本标签本身不应被再压缩成一个更弱的年份占位符。

Sources:

- https://www.dublincore.org/specifications/dublin-core/dcmi-terms/terms/title/
- https://www.dublincore.org/specifications/dublin-core/dcmi-terms/terms/hasVersion/
- https://www.dublincore.org/specifications/dublin-core/dcmi-terms/terms/issued/

### DataCite

- versioning 指南把 canonical resource 与具体版本分开。
- 具体版本通过 relation 挂到 canonical resource，而不是要求把 version 退化成一个 bare-year title suffix。

对本仓库的直接含义是：

- `edition_label` 应保留足够语义，继续表达 `2026版`、`2026年修订` 这类可区分版本；
- 如果未来要做排序/筛选，可以另加派生字段，但不应重写当前 display-title。

Source:

- https://support.datacite.org/docs/versioning

### Akoma Ntoso / FRBR

- 法律/制度文书更适合以 work-level identity 建根，再以 version/expression 承担具体版本差异。

这支持 repo 当前做法：

- `work_title` 保持稳定 identity；
- `display_title` 只做 repo-local 展示，但仍应保留足够版本语义。

Source:

- https://docs.oasis-open.org/legaldocml/akn-core/v1.0/cos01/part1-vocabulary/akn-core-v1.0-cos01-part1-vocabulary.html

## Recommendation

- 当前 display-title 接受格式保持：
  - `<work title> / <edition label>`
- `edition_label` 保留完整标签：
  - `2026版`
  - `2026年修订`
- 当前不接受：
  - `... / 2026`
- 如果未来需要 operator facet / sort：
  - 单独加 `regulation_edition_year`
  - 但不替代 `regulation_edition_label`

## Out Of Scope

- replay / rematerialization
- file-release recovery
- chunk / embedding / release
