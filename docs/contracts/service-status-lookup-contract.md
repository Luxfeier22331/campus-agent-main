---
doc_type: contract
status: active
created: 2026-04-23
updated: 2026-04-25
---
# Service Status Lookup Contract

## 文档边界

本文冻结 `service_status_lookup` 的 stable contract direction。

它覆盖：

- `packages/contracts` 内 `ServiceStatusLookupPayload / Result` 的稳定语义
- `apps/supervisor-agent-worker -> packages/campus_services` 的 handoff seam
- `campus_services -> thin tool adapter -> internal query service`
  的 request/result seam

它不覆盖：

- 具体 projection schema、collector、对象存储命名或 parser 实现
- browser-facing card payload
- `contact_directory_lookup` / `service_process_lookup` 的后续展开

## 当前 Rollout 状态

- `service_status_lookup` 已通过 `campus-services-product-path` opening gate，
  tool-level verdict 为 `open`（Phase 6，2026-04-27）。
- `service_status_lookup` 当前是 ToolSpec-admitted Agents SDK domain capability adapter
  tool；SDK 只承接 capability-side argument completion / single tool loop。projection-backed
  structured query、current/effective temporal policy、source provenance、Go
  admission 与 Go finalization 仍归 repo-owned runtime。
- 公开 answer / stream 入口对该 tool 走 Go-owned `single_step` bridge lane，不再使用
  Go typed-tool-runtime 快捷路径。内部 structured query endpoint 仍由 Go runtime 提供，
  作为 SDK tool adapter 的只读 backend。
- local gate 判定命令：
  `uv run --all-packages python -m scripts.eval_gate accept --profile
  campus-services-product-path --json`
- rollout flag 仍由 Go runtime 持有：
  `EXECUTION_CONTROL_OPEN_CAPABILITIES=campus_services`。
- 未设置该 flag 时，运行时仍应 fail-close，不得把
  “tool verdict 为 open”等价成“环境已开放”。

## Request Contract

```text
ServiceStatusLookupPayload
- subject_query: str
- temporal_query: TemporalQuery
- campus_scope: str
```

固定语义：

- `subject_query` 保留用户原问句，不得为空
- `temporal_query` 继续复用 repo-owned `TemporalQuery`
- `campus_scope` 只表达已知校区约束；不能替代 `subject_query`

## Result Contract

```text
ServiceStatusLookupResult
- subject_query: str
- outcome:
  - resolved_current
  - clarification_required
  - not_found
  - temporarily_unverifiable
- resolved_subject: str
- observed_status:
  - open
  - closed
  - temporarily_closed
  - limited_service
  - unknown
- queried_time_anchor: RFC3339 datetime
- effective_from: RFC3339 datetime
- effective_until: RFC3339 datetime
- override_source_refs[]: str
- related_notice_refs[]: str
- fail_close_reason:
  - current_state_unverifiable
  - source_truth_unavailable
  - temporal_scope_ambiguous
  - source_family_unavailable
  - source_conflict
```

固定语义：

- `resolved_current` 时必须给出 `resolved_subject`
- `temporarily_unverifiable` 时必须给出 `fail_close_reason`
- current/current-year/current-effective miss 不得自动返回历史记录；当前性不可证时必须
  `temporarily_unverifiable`

## Query-Time Rules

- 只读 projection-backed structured truth，不回扫 raw notice HTML 或 generic chunk
- `current/latest/effective` 由 code-owned temporal policy 解释
- 当前性不可证或 source truth 缺关键字段时必须 fail-close
- matched current record 如果缺 `observed_status`、`effective_from` 或必要 provenance，
  必须返回 `temporarily_unverifiable/current_state_unverifiable`
- 同一 subject、同一 current effective window 出现互相矛盾的 status / status note 时，必须返回
  `temporarily_unverifiable/source_conflict`，不得猜测或按读取顺序选择
- baseline 与临时 override 同时命中时，runtime 必须先按 query time 过滤 current effective
  window，再优先选择更晚 `effective_from` / 更窄 effective window 的临时记录
- matched record 的 effective window 已过期时，不得继续回答
  `resolved_current`；应返回 `temporarily_unverifiable/current_state_unverifiable`
- 需要 canonical notice 正文或公告发现时，应切到 `notice`

## Observability Summary

- supervisor execution finalizer 必须从 `related_notice_refs` / `override_source_refs`
  推导 low-cardinality `notice_source_family_summary`，用于 operator/runtime summary。
- `authenticated_notice:*` 与 `notice:muc_internal_portal:*` 均归入
  `internal_notice_restricted`。
- observability summary 只保留 selected tool、business outcome、fail-close reason、
  temporal posture 与 source family；不得把 raw notice id 当 metrics label 暴露。
