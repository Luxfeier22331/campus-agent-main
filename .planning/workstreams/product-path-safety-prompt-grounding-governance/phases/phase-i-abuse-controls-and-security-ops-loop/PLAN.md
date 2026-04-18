---
doc_type: phase_plan
phase: "I"
phase_name: "Abuse Controls And Security Ops Loop"
status: completed
created: 2026-04-19
updated: 2026-04-19
---

# Phase I Plan

## Objective

在不扩成厂商级安全平台的前提下，为 public/product-path 冻结最小 abuse control set、operator alert derivation 与 incident backfill hook。

## Why This Phase Exists

当前 repo 有 observability、telemetry、operator query 和 `incident_backfill` vocabulary，但没有真正的产品侧安全运营闭环：

- 没有 canonical abuse-control key
- operator query `alerts` 仍为空数组占位
- incident signals 还没有稳定回灌回 release gate

`Phase H` 已冻结 `safety_identifier` 后，这一步应把最小控制集正式收口。

## Decisions To Freeze

1. scope 固定为 public/product-path 在线问答，不覆盖 operator/internal admin surfaces。
2. canonical abuse-control key 固定为 `Phase H` 的 `safety_identifier`。
3. canonical owner 固定为 `apps/app-api` 与 app-owned shared Postgres truth；不把 throttle / alert canonical truth 外包给 Axiom、Sentry 或外部安全服务。
4. 最小 control set 固定为：
   - per-`safety_identifier` throttle / rate limit
   - suspicious signal counters
   - operator-visible alerts
   - incident backfill hook
5. throttle / alert derivation 的 canonical signal source 固定为：
   - `runtime.request_execution`
   - `runtime.request_observability_fact`
   - `operator-query` 只消费派生后的 `alerts[]`
6. throttled request 仍然必须形成 request-scoped durable truth：
   - durable write `runtime.request_execution`
   - durable write matching `runtime.request_observability_fact`
   - canonical request status: `rejected`
   - canonical error code: `rate_limit_exceeded`
   - chat-visible result: existing `error` kind
7. 当前 phase 不做：
   - account suspension
   - user reputation system
   - case management console
   - cross-product safety platform
8. canonical alert derivation 复用现有 `operator-query` 的 `alerts` slice，不新建独立 alert domain。
9. 最小 alert codes 固定为：
   - `safety.rate_limit_exceeded`
   - `safety.remote_content_suspicion_spike`
   - `safety.provider_content_filter_spike`
10. suspicious signal 来源固定为：
   - `remote_content_suspicion_summary`
   - provider `content_filter`
   - repeated rate-limit hits
11. initial thresholds 固定为：
   - request throttle: same `safety_identifier` over `8 requests / 60s` or `30 requests / 10m`
   - temporary throttle window: `5m`
   - `safety.rate_limit_exceeded`: same `safety_identifier` hits throttle `>=3` times in `15m`
   - `safety.remote_content_suspicion_spike`: same `safety_identifier` accumulates `>=3` requests with suspicion labels or `generation_blocked=true` in `15m`
   - `safety.provider_content_filter_spike`: same `safety_identifier` accumulates `>=3` `content_filter` outcomes in `15m`
12. incident closeout 必须回灌现有 eval/golden governance：
   - 进入 `incident_backfill`
   - 不允许只停在 dashboard / alert annotation

## Execution Slices

### Slice 1: Add Minimal Throttle

- 在 public/product-path request entry 增加 per-`safety_identifier` throttle
- throttle window 从 app-owned request truth 计算，不走 in-memory only shortcut，也不从 sink query 反推
- fail-closed semantics 限定为短时限流，不改变 current policy taxonomy

### Slice 2: Derive Alerts

- 在 operator query overview 内填充 `alerts[]`
- 基于现有 request execution / observability fact 派生最小安全告警

### Slice 3: Add Incident Backfill Hook

- 把 alert / incident closeout 固定接回 existing eval governance
- 明确哪些 incident class 必须补成 regression case

### Slice 4: Lock Threshold Policy

- 冻结 initial thresholds 只服务最小 control set，并以当前 plan 中的常量表作为唯一初始真相
- 阈值可后续调参，但不再重开 alert code / signal source 命名

## Interfaces To Freeze

- `apps/app-api/src/modules/operator-query/service.ts`
  - existing `alerts[]` becomes real, not placeholder
- `apps/app-api/src/modules/operator-query/store.ts`
  - derives safety alerts from request execution / observability facts
- `runtime.request_execution` / `runtime.request_observability_fact`
  - become the only canonical app-owned signal sources for abuse controls
- public/product runtime path
  - throttle keyed by `safety_identifier`

## Verification Matrix

- throttle regression：
  - repeated requests by same `safety_identifier` can trigger bounded throttle
  - throttled requests still produce durable app-owned request truth with `status=rejected` and `error_code=rate_limit_exceeded`
- operator query regression：
  - `alerts[]` is populated for safety incidents
- signal regression：
  - rate-limit spike produces the correct alert code
  - remote-content suspicion spike produces the correct alert code
  - provider content-filter spike produces the correct alert code
- incident backfill regression：
  - alert closeout path identifies required `incident_backfill` work

## Proposed Write Set

- `apps/app-api/src/modules/runtime-command/service.ts`
- `apps/app-api/src/modules/runtime-command/store.ts`
- `apps/app-api/src/modules/operator-query/store.ts`
- `apps/app-api/src/modules/operator-query/service.ts`
- targeted docs / runbook updates for incident backfill handling
- targeted regressions under `apps/app-api/test/` and `tests/evals/`

## Exit Rule

Phase I 完成后，repo 应达到：

- public/product-path 已具备最小可用的 abuse throttle
- throttle / alert truth 已固定在 `app-api` 与 app-owned shared Postgres facts，而不是 sink side inference
- operator query 的 `alerts[]` 不再是空壳
- 安全 incident 能稳定回灌到 eval / golden governance，而不是停在运维口径
- `Phase J/K` 若被 trigger，不再需要重建基础 ops loop
