---
doc_type: contract
status: active
created: 2026-04-23
updated: 2026-04-25
---
# Campus Notice Runtime Contract

## 文档边界

本文冻结 `campus_notice_discover` 与 `campus_notice_get` 的 stable runtime contract
direction。

这里的 `runtime` 只指 query-time tool execution seam，不指 internal_notice
留档、consumption projection 或 PG read-model 本身。

它覆盖：

- `packages/contracts` 内 notice runtime shared types
- `apps/supervisor-agent-worker -> packages/notice-agent` 的 handoff seam
- `notice-agent -> thin tool adapter -> internal query service` 的
  request/result seam

它不覆盖：

- authenticated notice source-truth / collector / ingestion contract
- browser-facing notice card 设计
- future public notice 与 restricted notice runtime 的 rollout 时序

## 当前 Rollout 状态

- 当前产品主路径尚未开放 `notice-agent`
- repo 已完成的是 gate-closed internal implementation：
  - notice discover/get shared contract
  - gate-closed structured-runtime pre-routing helper
  - session carrier `context.session.selected_notice_ref`
  - app-owned structured-runtime observability summary
  - Go `apps/supervisor-api` internal notice read-model backing query service
  - Go `apps/supervisor-api` derived bucket canonical markdown body adapter
  - Python `notice-agent` HTTP thin adapter
  - `supervisor-api` configured structured-query wiring to Go `apps/supervisor-api`

仍未开放：

- browser-facing notice API
- protected panel / chatbot notice entrypoint
- public notice source family runtime
- authenticated notice live collector/control-plane

## Discover Request

```text
CampusNoticeDiscoverPayload
- query_text: str
- temporal_query: TemporalQuery
- source_families[]:
  - official_web_public_notice
  - internal_notice_restricted
- target_surfaces[]:
  - notice_level_query
  - campus_services/service_status_candidate
- max_results: int
```

固定语义：

- `query_text` 保留用户原问句，不得为空
- `temporal_query` 继续复用 repo-owned `TemporalQuery`
- `source_families` 是上游已知约束，不是 query-time source scan 指令
- `target_surfaces` 是可选的 notice consumption facet；为空时读取所有 queryable
  notice read-model rows，指定时只读取对应 query surface。采购、讲座、活动、宣传和
  一般公告首期都通过 `notice_level_query` 返回 title/url card，不开放
  procurement-specific runtime surface。

## Internal Query HTTP Packet

`notice-agent -> Go apps/supervisor-api` 使用 private internal query route：

- `POST /internal/query/notices/discover`
- `POST /internal/query/notices/get`

固定 header：

- `x-supervisor-query-auth: <SUPERVISOR_STRUCTURED_QUERY_SHARED_SECRET>`

请求体固定为 envelope，不直接裸发 payload：

```json
{
  "payload": {
    "query_text": "家具采购",
    "source_families": ["internal_notice_restricted"],
    "target_surfaces": ["notice_level_query"],
    "max_results": 5
  },
  "access_context": {
    "actor": {
      "user_id": "student-001"
    },
    "authorization": {
      "principal_id": "principal-001",
      "entitlement_groups": ["students"],
      "retrieval_filter": {
        "entitlement_groups": ["students"],
        "visibility_level": "restricted"
      }
    }
  }
}
```

固定语义：

- Go `apps/supervisor-api` 是 PG read-model 与 S3-compatible derived bucket
  query-time runtime owner
- Python `notice-agent` 不再从 env 构造 PG/S3 runtime；它只序列化 query envelope、
  调用 Go `apps/supervisor-api`，并把 result 还原为 shared contract dataclass
- restricted `internal_notice_restricted` 必须带 `principal_id`、
  `entitlement_groups` 与 restricted `retrieval_filter`，否则 fail-close 为
  `source_family_unavailable`
- query-time 不允许回扫 raw notice/source bundle

## Get Request

```text
CampusNoticeGetPayload
- notice_id: str
- source_family:
  - official_web_public_notice
  - internal_notice_restricted
```

固定语义：

- `campus_notice_get` 不新增 top-level public request field
- 如果用户在 discover/select 之后继续问“这条通知”“通知原文”，supervisor 应优先消费
  `context.session.selected_notice_ref`
- `selected_notice_ref` 是 query-time internal carrier，不是 source-truth identity
  owner

## Result Contract

```text
CampusNoticeDiscoverResult
- query_text: str
- outcome:
  - resolved_current
  - resolved_historical_reference
  - clarification_required
  - not_found
  - temporarily_unverifiable
- source_families[]: same as request
- notice_cards[]: NoticeCard
  - notice_id: str
  - title: str
  - source_family: str
  - source_url: str
  - canonical_url: str
  - target_surface: str
  - published_at: str
- queried_time_anchor: RFC3339 datetime
- historical_downgrade_reason:
  - current_year_miss
  - current_effective_miss
- fail_close_reason:
  - current_state_unverifiable
  - source_truth_unavailable
  - temporal_scope_ambiguous
  - source_family_unavailable

CampusNoticeGetResult
- notice_id: str
- outcome: same as discover
- title: str
- source_family: same as request
- source_url: str
- canonical_url: str
- normalized_body: str
- reference_only: bool
- target_surface: str
- published_at: str
- effective_at: str
- attachment_refs[]: str
- provenance_refs[]: str
- historical_downgrade_reason: same as above
- fail_close_reason: same as above
```

固定语义：

- `resolved_current` / `resolved_historical_reference` 时必须返回 notice cards
  或 canonical body
- `temporarily_unverifiable` 时必须返回 `fail_close_reason`
- `resolved_historical_reference` 不强制要求 `historical_downgrade_reason`
  - 只有 current/current-year/current-effective miss 的历史降级才填写
  - 显式历史 / `as_of` 读取可以为空

## Observability Summary

当 `notice-agent` 返回 structured result 时，execution-side observability summary
应补齐：

- `selected_tool`
- `tool_business_outcome`
- `tool_fail_close_reason`
- `tool_historical_downgrade_reason`
- `notice_source_family_summary`
- `temporal_posture`

这些字段是 app-owned compact summary，不是 raw agent dump contract。
