---
doc_type: runbook
truth_scope: ops
owner_boundary: docs/runbooks
status: active
created: 2026-04-19
updated: 2026-04-19
---
# Public Product-path Safety Ops Runbook

## Purpose

在 `app-api` 的 public/product-path 上执行最小安全运营闭环：确认 abuse throttle，
并用受控请求事实定位需要人工跟进的异常模式。

本 runbook 不定义 Operator Console 的安全 dashboard、alert 页面或独立 safety read
model；当前 Operator Console 只展示最小 Ops Index。

## Canonical Signal Sources

- `runtime.request_execution`
- `runtime.request_observability_fact`

不要把 Axiom、Sentry 或其他 sink 当作 canonical abuse-control truth。

## Fixed Thresholds

- request throttle:
  - same `safety_identifier` `> 8 requests / 60s`
  - same `safety_identifier` `> 30 requests / 10m`
- temporary throttle window:
  - any `rate_limit_exceeded` hit keeps the same `safety_identifier` throttled
    for `5m`
- safety event patterns:
  - `safety.rate_limit_exceeded`: same `safety_identifier` reaches `>= 3`
    rate-limit hits in `15m`
  - `safety.remote_content_suspicion_spike`: same `safety_identifier` reaches
    `>= 3` suspicion-marked or `generation_blocked=true` requests in `15m`
  - `safety.provider_content_filter_spike`: same `safety_identifier` reaches `>=
    3` provider `content_filter` outcomes in `15m`

## Operator Steps

1. Open Operator Console Requests and filter recent failed / rejected requests.
   Use `/api/operator/overview` only for minimal request/runtime summary.
1. If `code=safety.rate_limit_exceeded`:
   - confirm recent requests show `status=rejected` and
     `error_code=rate_limit_exceeded`
   - no automatic `incident_backfill` is required
   - keep the pattern in abuse-monitoring notes only
1. If `code=safety.remote_content_suspicion_spike` or
   `code=safety.provider_content_filter_spike`:
   - inspect recent request detail tied to the same window
   - collect only sanitized request identifiers, trace identifiers, pattern code,
     and observed diagnostics
   - open follow-up work in the golden governance lane as `incident_backfill`
1. Close the incident only after the `incident_backfill` target has been created
   and linked in operator notes.

## Evidence Boundaries

- Use `requestId`, `traceId`, pattern code, and operator-visible diagnostics.
- Do not copy raw auth material, raw session secrets, or sink-side unowned
  payloads into the incident note.
- For remote-content incidents, use the sanitized suspicion summary rather than
  pasting remote raw text into the closeout record.
