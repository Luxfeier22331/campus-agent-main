---
doc_type: data
truth_scope: data
owner_boundary: domains/campus-services
status: active
created: 2026-04-26
updated: 2026-04-26
---
# Campus Services Service Catalog Source-Truth Schema

## 文档边界

本文冻结 `campus_services/service_catalog` 第一版 structured projection 的 source-truth
消费与 artifact schema。

它回答：

- service catalog 如何由 service guide 与 contact directory projections 初始化
- service entry 如何保存别名、分类、入口、guide refs 与 contact refs
- `campus_services_service_catalog_projection.v1` 的生成、校验与发布边界

它不覆盖：

- `service_guide_lookup` 的最终回答 contract
- `contact_directory_lookup` 的 runtime contract
- query-serving opening gate
- 表单提交、预约、代办、支付、工单创建或任何业务状态变更

## Core Conclusion

`campus_services/service_catalog` 是校园服务发现与归一化索引的 semantic-owner
collection。第一版 current projection 由已经 normalized 的
`campus_services/service_guide` 与可选 `campus_services/contact_directory` projection
派生，不回读 raw PDF、portal HTML、notice HTML 或 generic retrieval chunk。

固定规则：

- service catalog 负责“有哪些服务、有哪些别名、属于哪个 category、关联哪些 guide/contact”
- service guide 负责办理说明、材料、入口、服务时间、适用范围
- contact directory 负责稳定联系方式事实
- service catalog 不替代 service guide 或 contact directory 的 source truth
- service catalog 当前保持 `offline_preparation`，不打开 query-serving

## Input Source Truth

第一版允许的 upstream family：

- canonical source-truth manifest:
  `configs/ingestion/campus_services/service_catalog/source-truth.v1.json`
  - 第一版固定期望 14 条 ready service entry，与
    `campus_services/service_guide` current projection 的 14 条 ready
    guide record 对齐
  - 该 manifest 只声明 upstream projection contract 与 release gate；
    构建时仍消费已经发布的 current projection 文件
- `campus_services/service_guide`
  - `campus_services_service_guide_projection.v1`
  - 是第一版 service entry 的主要来源
  - 每个 ready `service_guide_record` 生成一个 `service_entries[]` 记录
- `campus_services/contact_directory`
  - `campus_services_contact_directory_projection.v1`
  - 可选输入
  - 只用于把 guide 中的入口/联系人标签链接到稳定 contact record

不允许的 upstream：

- query-time browser scrape
- raw handbook/PDF/OCR fragment
- raw HTML without normalized source truth
- notice 中临时活动联系人冒充稳定服务联系人
- 用户自由文本提供的服务、入口或电话

## Projection Bundle

生成 artifact 固定为 `campus_services_service_catalog_projection.v1`。

顶层字段：

```text
schema_version
generated_at
source_families[]
service_entries[]
conflict_records[]
manual_review_sources[]
```

versioned artifact：

`campus_services/releases/service_catalog/{release_id}/service-catalog-projection.json`

current artifact：

`campus_services/releases/service_catalog/current/service-catalog-projection.json`

伴随 artifact：

- `validation-summary.json`
- `release-manifest.json`
- `manual-review-report.json`

## Service Entry

```text
ServiceCatalogEntry
- service_id: str
- display_name: str
- aliases[]: str
- category: str
- campus_scope: str
- audience[]: str
- owner_department: str
- guide_record_refs[]: str
- contact_record_refs[]: str
- entry_refs[]: ServiceCatalogEntryRef
- source_refs[]: str
- effective_from: RFC3339 datetime
- effective_until: RFC3339 datetime
- extraction_status:
  - ready
  - needs_manual_review
  - conflicted
  - incomplete
```

固定语义：

- `service_id` 复用 guide record 的 canonical service identity
- `aliases` 来源于 service guide record，不从用户 query 反推
- `guide_record_refs` 指向可消费的 guide record
- `contact_record_refs` 只链接 source-linked stable contact directory records
- `owner_department` 只在 contact directory 能稳定匹配时填写；不能用 category 推断
- `source_refs` 必须覆盖 guide facts 与已链接 contact facts 的 provenance
- `extraction_status != ready` 的 entry 不得发布为 current-ready record

## Entry Ref

```text
ServiceCatalogEntryRef
- label: str
- entry_type:
  - online_url
  - offline_location
  - phone
  - email
  - instructions_only
- url: str
- location_ref: str
- source_refs[]: str
```

固定语义：

- entry ref 是用户可见入口说明，不是可执行 transaction payload
- `online_url` 只能表示可见入口链接，不表示系统可自动提交
- `offline_location` 可后续由 navigation layer 解释，但 service catalog 不做路径规划

## Build And Update Flow

第一版持续更新规则：

```text
handbook / official-web / portal source truth
-> service_guide projection
-> contact_directory projection
-> service_catalog projection
```

在 `regulations/student_rules` raw ingestion 或 provider-response replay 成功后：

1. 发布 `contact_directory` current projection。
2. 发布 `service_guide` current projection。
3. 使用两者生成并发布 `service_catalog` current projection。

如果 contact directory 未生成，service catalog 仍可由 service guide 初始化，但
`contact_record_refs` 必须为空。不得靠 category、服务名称或用户问题推断联系人。

如果 normalized current projection 已存在，可通过 ingestion-control
`ts_control` projection task 定向重建 `service_catalog` release。该任务只消费
`service_guide` 与可选 `contact_directory` projection 文件，不改变
source-truth 边界。

## Validation

以下情况必须阻断发布：

- `schema_version` 不匹配
- `generated_at` 非 RFC3339
- current artifact 内存在重复 `service_id`
- ready entry 缺 `source_refs`
- ready entry 缺 `guide_record_refs`
- ready entry count 与 source-truth manifest 的 `expected_ready_records` 不一致
- entry ref 缺 source refs
- effective window 非法
- 存在 unresolved conflict
- 存在 manual review source

## Runtime Boundary

当前 artifact 是后续 service discovery / alias governance 的 source-ready 前置条件，不代表
能力已经上线。

打开任何 service catalog backed runtime 前仍需要：

- request/result contract
- Go structured query runtime
- campus_services thin adapter
- admission/eval/observability gate
- panel/operator 可见 release evidence

在此之前，服务发现问题不能回退为 generic RAG 或 query-time source scan。
