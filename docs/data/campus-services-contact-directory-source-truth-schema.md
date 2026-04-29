---
doc_type: data
status: active
created: 2026-04-26
updated: 2026-04-27
---
# Campus Services Contact Directory Source-Truth Schema

## 文档边界

本文冻结 `campus_services/contact_directory` 第一版结构化 projection 的 source-truth
消费与 artifact schema。

它回答：

- handbook 电话页如何进入 contact directory normalized truth
- 联系人、部门电话、邮箱与位置引用如何建模
- `campus_services_contact_directory_projection.v1` 的生成、校验与发布边界

它不覆盖：

- `contact_directory_lookup` 的 runtime contract
- `service_guide_lookup` 的 contact focus 回答策略
- 电话拨打、预约、提交、代办或任何事务执行
- 产品主路径 opening gate

## Core Conclusion

`campus_services/contact_directory` 是联系方式事实的 semantic-owner
collection。handbook 电话页应先生成 normalized contact projection，再由后续
`contact_directory_lookup` 或 service guide contact refs 消费；不得在 query time
回扫 raw handbook table、公告 HTML 或 generic retrieval chunk。

当前阶段固定为 offline data-plane：

- collection runtime profile 仍是 `offline_preparation`
- `query_enabled=false`
- 不打开 `contact_directory_lookup`
- 不把 `service_guide_lookup` 改造成纯电话查询入口

## Input Source Truth

第一版允许的 upstream family：

- handbook-derived phone directory pages
  - canonical selector 位于
    `configs/ingestion/regulations/student_rules/source-projections.v1.json`
  - 当前 tracked source 为 `中央民族大学校内常用电话`，学生手册第 261 页
  - canonical 入口是 handbook/PDF raw ingestion 与 provider-response replay 的
    declared projection fan-out；生成 `campus_services/contact_directory`
    document artifacts 后，同一 ingestion/replay run 继续生成 structured projection
    release
  - worker CLI 只作为 debug/recovery shell，不能被当成 PDF 电话页的主消费路径
  - builder 消费 handbook cleanup 已生成的 `document-units.jsonl`
  - 只消费 `policy_page` phone semantic units；原始 table unit 仅作为可追溯证据
- future official-web contact directory pages
  - 稳定部门联系方式页、机构目录页
- future service portal contact metadata
  - 只作为联系方式来源，不生成事务 payload

不允许的 upstream：

- query-time browser scrape
- raw HTML without normalized source truth
- unreviewed OCR fragments without source refs
- notice 中临时活动联系人冒充稳定部门联系人
- 用户自由文本提供的电话或邮箱

## Projection Bundle

生成 artifact 固定为 `campus_services_contact_directory_projection.v1`。

顶层字段：

```text
schema_version
generated_at
source_families[]
source_documents[]
contact_records[]
conflict_records[]
manual_review_sources[]
```

versioned artifact：

`campus_services/releases/contact_directory/{release_id}/contact-directory-projection.json`

current artifact：

`campus_services/releases/contact_directory/current/contact-directory-projection.json`

伴随 artifact：

- `validation-summary.json`
- `release-manifest.json`
- `manual-review-report.json`

## Contact Record

```text
ContactRecord
- contact_id: str
- display_name: str
- aliases[]: str
- contact_group: str
- department: str
- phones[]: PhoneRecord
- emails[]: EmailRecord
- location_refs[]: str
- source_refs[]: str
- extraction_status:
  - ready
  - needs_manual_review
  - conflicted
  - incomplete
```

固定语义：

- `contact_id` 是 projection 内 canonical identity，不使用页面 URL 或电话本身作为长期
  ID
- `display_name` 是用户可见名称，例如 `研究生院(学位办)办公室`
- `contact_group` 保留 handbook cleanup 的语义分组，例如 `校级办公与公共服务`
- `department` 是可用于后续 entity grouping 的部门名
- `ready` record 必须至少有一个 phone 或 email
- `source_refs` 必须覆盖 record-level provenance
- `extraction_status != ready` 的 record 不得进入 current-ready release

## Phone Record

```text
PhoneRecord
- phone_id: str
- label: str
- number: str
- source_refs[]: str
```

固定语义：

- 电话号码必须来自 normalized source truth
- 不在 projection 阶段推断分机、办公时间或服务状态
- 同一 display name 下多个号码可作为多个 `phones[]` 保留

## Email Record

```text
EmailRecord
- email_id: str
- label: str
- address: str
- source_refs[]: str
```

固定语义：

- 邮箱必须来自 normalized source truth
- 不从 URL、联系人姓名或用户问题中推断邮箱

## Notice-Derived Contact Policy

authenticated notice 中出现的电话不默认进入稳定 contact directory：

- 节假日、临时开放或临时停诊电话属于 `service_status` / status candidate
- HPV、叶酸领取、体检等活动联系人属于 special service candidate
- 明确稳定的部门联系方式才可作为 contact directory candidate

这避免把临时活动联系人提升为长期部门电话。

## Validation

以下情况必须阻断发布：

- `schema_version` 不匹配
- `generated_at` 非 RFC3339
- current artifact 内存在重复 `contact_id`
- `ready` record 缺少 phone 与 email
- record 或 channel 缺 source refs
- 存在 unresolved conflict
- 存在 manual review source

## Runtime Boundary

当前 artifact 是后续 runtime 的 source-ready 前置条件，不代表能力已经上线。

打开 `contact_directory_lookup` 前还需要：

- `packages/contracts` 内的 request/result model implementation
- Go structured query runtime
- campus-services-agent thin adapter
- admission/eval/observability gate
- panel/operator 可见的 release evidence

forward runtime contract direction 见
`docs/contracts/contact-directory-lookup-contract.md`。该 contract 文档存在不代表产品主路径已
打开，也不代表 shared model / Go runtime / Python adapter 已实现。

在此之前，纯电话问题不应由 `service_guide_lookup` 冒充回答；service guide 只能在其
projection 已内嵌 source-linked contact refs 时展示这些 contact facts。
