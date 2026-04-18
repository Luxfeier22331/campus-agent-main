---
doc_type: runbook
status: active
created: 2026-04-19
updated: 2026-04-19
---

# Public Product-path Safety Ops Runbook

## Purpose

在 `app-api` 的 public/product-path 上执行最小安全运营闭环：确认 abuse throttle、查看 operator safety alerts，并把需要的事件回灌成 `incident_backfill`。

## Canonical Signal Sources

- `runtime.request_execution`
- `runtime.request_observability_fact`

不要把 Axiom、Sentry 或其他 sink 当作 canonical abuse-control truth。

## Fixed Thresholds

- request throttle:
  - same `safety_identifier` `> 8 requests / 60s`
  - same `safety_identifier` `> 30 requests / 10m`
- temporary throttle window:
  - any `rate_limit_exceeded` hit keeps the same `safety_identifier` throttled for `5m`
- safety alerts:
  - `safety.rate_limit_exceeded`: same `safety_identifier` reaches `>= 3` rate-limit hits in `15m`
  - `safety.remote_content_suspicion_spike`: same `safety_identifier` reaches `>= 3` suspicion-marked or `generation_blocked=true` requests in `15m`
  - `safety.provider_content_filter_spike`: same `safety_identifier` reaches `>= 3` provider `content_filter` outcomes in `15m`

## Operator Steps

1. Open `GET /api/operator/overview?window=24h` and inspect `alerts[]`.
2. If `code=safety.rate_limit_exceeded`:
   - confirm recent requests show `status=rejected` and `error_code=rate_limit_exceeded`
   - no automatic `incident_backfill` is required
   - keep the alert in abuse-monitoring notes only
3. If `code=safety.remote_content_suspicion_spike` or `code=safety.provider_content_filter_spike`:
   - inspect the recent request detail / observability entries tied to the same window
   - collect only sanitized request identifiers, trace identifiers, alert code, and observed diagnostics
   - open follow-up work in the golden governance lane as `incident_backfill`
4. Close the incident only after the `incident_backfill` target has been created and linked in operator notes.

## Evidence Boundaries

- Use `requestId`, `traceId`, alert code, and operator-visible diagnostics.
- Do not copy raw auth material, raw session secrets, or sink-side unowned payloads into the incident note.
- For remote-content incidents, use the sanitized suspicion summary rather than pasting remote raw text into the closeout record.
