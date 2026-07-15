---
doc_type: decision
truth_scope: repository
owner_boundary: docs/decisions
decision_id: ADR-0040
status: accepted
created: 2026-04-14
updated: 2026-07-08
---
# ADR-0040 Regulation Work Title And Edition Separation

## 状态

Accepted on 2026-04-14.

## 背景

`internal_notice -> regulations/institutional_rules` 这条 regulation promotion
线已经冻结了以下边界：

- `notice`、`attachment`、`regulation` 是不同层级
- wrapper notice 继续留在 `campus_notices/internal_notice`
- promoted regulation 只收可独立消费的制度正文
- regulation identity 不得从 `notice_id` 派生

但当前 regulation target 的标题与身份建模仍然过于扁平：

- `regulation_title_normalized` 既承担“制度作品标题”，又承担“展示标题”
- `（2026版）`、`最新版`、`修订版` 这类版本信号当前仍可能直接混入标题本体
- 这会让同一制度的不同版本更容易被错误建成不同 document 根，而不是同一 work 的不同 version

这类扁平建模与外部元数据/法律文本规范不一致：

- Dublin Core 把 `title`、`hasVersion/isVersionOf`、`issued`、`valid` 分开建模
- DataCite 把 `Version` 与 `HasVersion` / `IsVersionOf`、`IsNewVersionOf` /
  `IsPreviousVersionOf` 分开建模，并允许 canonical resource 持有多个具体版本
- Akoma Ntoso / FRBR 明确区分 `work`、`expression`、`manifestation`、`item`

对 repo 当前 regulation lane，更合理的对应关系是：

- `document_id`
  - 表达稳定的 work identity
- `version_id`
  - 表达同一 work 下的具体版本

## 决策

### 决策 1：regulation 标题固定拆成 work / edition / display 三层

对 `regulations/institutional_rules`，长期正确的标题字段固定拆为：

- `regulation_work_title`
  - 制度作品标题，不包含年份版次、最新版等版本标签
- `regulation_edition_label`
  - 版本标签，例如 `2026版`、`修订版`、`第2版`
- `regulation_display_title`
  - 面向 operator / retrieval metadata / UI 的展示标题
  - 默认格式为：`<regulation_work_title> / <regulation_edition_label>`
- `source_title_literal`
  - 来源原题名，保留原文表达，例如 `示例大学关于学生使用人工智能的指导意见（2026版）`

`regulation_display_title` 的固定规则补充：

- `edition_label` 必须保留完整语义标签，不得压成裸年份
- 因此：
  - `示例大学关于学生使用人工智能的指导意见 / 2026版`
  - 是允许格式
  - `示例大学关于学生使用人工智能的指导意见 / 2026`
  - 不是当前接受格式
- 同理：
  - `示例大学实验室安全管理规定 / 2026年修订`
  - 不得压成 `... / 2026`
- 如果后续 operator 确实需要 machine-friendly 排序或 facet，再单独引入派生字段，例如
  `regulation_edition_year`
- 该派生字段不能替代 `regulation_edition_label` 或 `regulation_display_title`

### 决策 2：`document_id` 只绑定 work identity

`document_id` 的长期 identity 输入固定为：

- `regulation_work_title`
- `issuing_org`
- `semantic_scope`

固定禁止：

- 把 `notice_id` 作为 regulation identity 输入
- 把 `source_notice_release_time` 作为 work identity 输入
- 把 `regulation_display_title` 作为 work identity 输入

含义是：

- `示例大学关于学生使用人工智能的指导意见`
- `示例大学关于学生使用人工智能的指导意见 / 2026版`

应共享同一个 work-level `document_id`，而不是被拆成两个不同 document 根。

### 决策 3：`version_id` 承担版本区分，而不是标题本体

`version_id` 的长期 identity 输入固定为：

- `semantic_content_hash`
- `effective_date`（若正文明确给出）
- `regulation_edition_label` 或可等价落到版本维度的 `revision_signal`

固定规则：

- `effective_date` 缺失允许为 `null`
- 不得用 `source_notice_release_time` 静默顶替 `effective_date`
- `revision_signal` 可以继续存在，但它不再承担“展示标题里的全部版本表达”

### 决策 4：年份版次与状态限定词分开处理

以下信号不得混为同一字段：

- 年份/版次
  - `2026版`
  - `2025修订版`
  - `第2版`
- 状态限定词
  - `暂行`
  - `试行`
  - `试行稿`

因此可选再拆：

- `regulation_edition_year`
- `regulation_status_qualifier`

固定禁止把：

- `暂行`
- `试行`
- `民大校发〔2025〕104号`

直接当成 `regulation_edition_label`。

同样固定禁止把：

- `2026届`
- `2021级`
- 仅仅因为字符串里出现年份就压成裸年份 display title

误当成 `regulation_edition_label` 或 `display_title` 后缀。

### 决策 5：当前执行 truth 与批准迁移目标必须显式区分

在迁移真正落地前，当前 execution truth 允许继续保留：

- `regulation_title_normalized`

但它只代表当前实现中的过渡字段，不再代表长期正确 contract。

固定要求：

- acceptance / runbook / config README 必须显式区分：
  - `current execution truth`
  - `approved migration target`
- 不得把未来 contract 写成“当前已经生效的 materialization truth”

## 规范化示例

输入示例：

- `示例大学关于学生使用人工智能的指导意见（2026版）`

规范化结果：

- `regulation_work_title`
  - `示例大学关于学生使用人工智能的指导意见`
- `regulation_edition_label`
  - `2026版`
- `regulation_display_title`
  - `示例大学关于学生使用人工智能的指导意见 / 2026版`
- `source_title_literal`
  - `示例大学关于学生使用人工智能的指导意见（2026版）`

对比示例：

- `示例大学实验室安全管理规定（2026年修订）`
  - `regulation_work_title` - `示例大学实验室安全管理规定`
  - `regulation_edition_label` - `2026年修订`
  - `regulation_display_title` - `示例大学实验室安全管理规定 / 2026年修订`
- `示例大学丰台校区就医管理办法（暂行）`
  - `regulation_work_title` - `示例大学丰台校区就医管理办法（暂行）`
  - `regulation_edition_label` - `null`
  - `regulation_display_title` - `示例大学丰台校区就医管理办法（暂行）`

## 结果

这条决策带来以下直接结果：

- regulation collection 的长期 identity 语义由“标题扁平值”收口为 “work + version”
- 年份版次不再继续污染 work-level identity
- retrieval / operator / future serving 可统一消费 `display_title`
- attachment-backed regulation 与 notice-body regulation 可以使用同一套标题/version
  语义，不再依赖 source channel 差异

当前不在本 ADR 范围内的内容：

- 具体 parser 何时开始从 `regulation_title_normalized` 拆出新字段
- 历史 target rows 如何批量 replay
- chunk / embedding / release 如何受新字段影响

这些属于后续 implementation quick task，不属于本轮 design freeze。

## Related Docs

- `docs/decisions/adr-0035-notice-derived-regulation-promotion-boundary.md`
- `docs/architecture/domains/authenticated-notice/architecture.md`
- `docs/reference/institutional-rules-promotion.md`
- `configs/ingestion/regulations/institutional_rules/canonical-profile.json`
- `configs/ingestion/regulations/institutional_rules/canonical-profile.json`

## External References

- DCMI Terms: Title
  <<https://www.dublincore.org/specifications/dublin-core/dcmi->
  terms/terms/title/>
- DCMI Terms: Has Version
  <<https://www.dublincore.org/specifications/dublin-core>
  /dcmi-terms/terms/hasVersion/>
- DCMI Terms: Date Issued
  <<https://www.dublincore.org/specifications/dublin-core>
  /dcmi-terms/terms/issued/>
- DataCite Support: Versioning <https://support.datacite.org/docs/versioning>
- Akoma Ntoso Version 1.0 Part 1: XML Vocabulary
  <<https://docs.oasis-open.org/le>
  galdocml/akn-core/v1.0/cos01/part1-vocabulary/akn-core-v1.0-cos01-part1-vocabu
  lary.html>
