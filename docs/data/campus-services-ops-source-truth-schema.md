---
doc_type: data
truth_scope: data
owner_boundary: domains/campus-services
status: active
created: 2026-06-11
updated: 2026-06-11
---
# Campus Services Ops Source-Truth Schema

## 文档边界

本文冻结 `campus_services` 人工校对 source channel 与 app-api ops store 的数据边界。

它回答：

- 为什么人工确认可以作为合法 upstream
- `campus_services_ops.*` 保存哪些事实
- release snapshot 如何成为后续 structured runtime 的输入
- 哪些内容禁止进入 ops store

它不覆盖：

- 自动 notice 抽取成熟度
- execution-control typed lookup read model 的最终表结构
- ops 前端编辑体验
- raw evidence retention / object storage policy

## Core Conclusion

`campus_services` 第一版必须承认大量真实服务变更来自人工可校对渠道，例如导员口头通知、
群消息、现场确认和电话确认。这些来源没有足够成熟的自动通知消费证据链时，不应伪装成
notice candidate review，也不应绕过治理直接改 serving read model。

固定形态是：

```text
operator manual attestation
-> bounded transport override draft
-> app-api preview
-> app-api publish release snapshot
-> structured runtime typed consumption
```

## Logical Schema

app-api Drizzle-owned schema：`campus_services_ops`

### `campus_services_ops.source_attestations`

用途：保存人工校对来源的 operator-safe 摘要。

最小列：

- `attestation_id`
- `source_type`
- `summary`
- `operator_notes`
- `confirmed_at`
- `status`
- `created_at`
- `created_by_json`

`source_type` 第一版允许：

- `counselor_notice`
- `group_message`
- `phone_confirmation`
- `onsite_confirmation`
- `operator_curated`
- `official_web_candidate`
- `authenticated_notice_candidate`

规则：

- `summary` 是事实摘要，不是 raw evidence。
- `operator_notes` 是校对说明，不保存聊天截图、附件原文、OCR payload 或对象存储 locator。
- 真实 evidence 如需长期保存，必须由对应 source-channel/retention policy 拥有，不进入
  ops HTTP response。

### `campus_services_ops.transport_overrides`

用途：保存班车/接驳服务临时 override。

最小列：

- `override_id`
- `route_id`
- `display_name`
- `service_status`
- `message`
- `effective_from`
- `effective_until`
- `source_attestation_ids_json`
- `review_state`
- `created_at`
- `created_by_json`
- `updated_at`
- `updated_by_json`

规则：

- 时间窗必须 bounded，`effective_until` 必须晚于 `effective_from`。
- `source_attestation_ids_json` 只能引用已存在 attestation。
- 只有 `review_state=ready_for_publish` 且当前时间落入时间窗的记录进入
  current-effective release snapshot。
- `route_id` 必须指向 structured transport runtime 能识别的 route identity；当前
  app-api ops store 不做路线规划。

### `campus_services_ops.releases`

用途：保存 operator publish 的 current-effective snapshot。

最小列：

- `release_id`
- `status`
- `notes`
- `item_count`
- `current_effective_json`
- `created_at`
- `created_by_json`
- `published_at`
- `published_by_json`

规则：

- `current_effective_json` 是 release 时刻的 transport override summary。
- app-api publish 必须原子写入 release 与 audit event。
- 接入 execution-control 的环境必须至少发布一个空或非空 `published`
  current-effective release；没有任何 published release 表示 ops overlay
  currentness 不可证明，不等同于“没有 override”。
- runtime lookup 不得 query-time 扫描 attestation 或 raw source；runtime consumption
  必须显式读取 release/projection/read model。

### `campus_services_ops.audit_events`

用途：保存 operator-safe 变更审计。

最小列：

- `audit_event_id`
- `action`
- `object_type`
- `object_id`
- `summary`
- `before_json`
- `after_json`
- `actor_json`
- `occurred_at`

规则：

- `before_json` / `after_json` 只保存 sanitized summary。
- 禁止保存 raw chat、截图、附件字节、bucket、object key、OCR payload、provider raw
  response 或 sink raw event。

## Runtime Boundary

本 schema 是 `campus_services` P1 功能基底的一部分：它补齐人工校对和 release 基底，不声明
自动 notice 消费已经成熟。execution-control typed transport runtime 可以读取最新 published
release 的 `current_effective_json`，并在 query time 重新校验 bounded effective window；
过期、冲突或当前状态不可证明时 fail closed。transport override 只作为已有 route /
schedule projection 上的服务状态 overlay，不生成路线、站点或班次事实。

后续接入 runtime 时必须保持：

- typed tool 只读 projection-backed structured truth 或已发布 release snapshot
- 不在 query time 回扫 source attestation / notice / chat content
- 不把 ops store 当作 generic RAG collection
- 不通过 app-api loopback HTTP 充当 internal query seam
