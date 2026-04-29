---
doc_type: phase_plan
phase: "H"
phase_name: "End-user Safety Traceability"
status: completed
created: 2026-04-19
updated: 2026-04-19
---

# Phase H Plan

## Objective

冻结终端用户在线问答的 canonical `safety_identifier` derivation、provider-side projection 与 app-owned persistence，使后续 abuse controls 和 operator observability 使用同一条匿名安全标识真相。

## Why This Phase Exists

当前 repo 已有：

- request execution / observability persistence
- telemetry sanitization
- prompt runtime payload builder

但还没有：

- provider-visible `safety_identifier`
- internal abuse-control key 与 provider traceability 的统一 identifier
- 明确的匿名化 derivation rule

这会导致后续 `Phase I` 如果直接做 abuse controls，就很容易再造一套不兼容的内部标识。

## Decisions To Freeze

1. canonical owner 固定为 `apps/app-api`。
2. `safety_identifier` 固定由 app-owned runtime 在调用 supervisor / prompt runtime 之前生成，不由前端或 provider 生成。
3. derivation source order 固定为：
   - current admitted end-user path: `principal:<principal_id>`
   - future explicitly admitted no-principal path: `session:<session_id>`，但只允许消费 `ResolvedAppPrincipal.session.sessionId`
   - 如果 `principal_id` 与 app-owned `session.sessionId` 都不存在，则 `safety_identifier` 保持 `null`
4. derivation 固定为 HMAC-SHA256 with `apps/app-api` Worker secret `APP_API_SAFETY_IDENTIFIER_HMAC_SECRET`。
5. 当前 public chat request path 继续是 `session_required`；因此 no-principal fallback 当前不是 active product lane，只为 future explicit anonymous admission 预留。
6. output format 固定为 hex string；不使用 raw principal id、email、session token 或 auth header。
7. same derived identifier 同时用于：
   - provider request traceability
   - app-owned request execution / observability persistence
   - later abuse controls
8. telemetry sink 可接收 `safety_identifier`，但不得接收 raw principal id、email、prompt、answer、auth secrets。
9. provider transport 若不支持 `safety_identifier`：
   - provider payload omits the field
   - internal persistence still keeps the same canonical identifier
10. `conversation_id` 继续只用于对话关联与 request observability；不再承担 abuse-control identity 语义。
11. `ResolvedAppPrincipal.session.sessionId` 是唯一允许进入 session fallback 的 canonical source；在当前 end-user path 上它对应 Better Auth session id。
12. secret rotation 固定为手动 epoch rotation：
   - 不做 dual-read / dual-write
   - 不承诺 rotation 前后 identifier 稳定可关联
   - 每次 rotation 都必须在 tracked runbook / workstream truth 记录触发时间与原因
13. canonical contract additions 固定为：
   - `RequestExecutionWrite.safetyIdentifier`
   - `RequestObservabilityFactWrite.safetyIdentifier`
   - prompt-runtime request support for optional `safety_identifier`

## Execution Slices

### Slice 1: Freeze Derivation Rule

- 定义 exact secret owner / env key 与 HMAC input shape
- 明确 principal path、session fallback path 与 null fallback path
- 锁定 output format

### Slice 2: Project Into Persistence

- request execution 和 observability fact 持久化同一 identifier
- operator-facing read model 暂不默认展示，但必须可用于 internal correlation

### Slice 3: Project Into Provider Runtime

- prompt runtime payload builder 接受 optional `safety_identifier`
- supervisor / prompt executors 透传该字段到 provider request

### Slice 4: Lock Privacy Boundary

- telemetry / logs 继续禁止 raw principal/auth data
- `safety_identifier` 成为唯一允许出站的匿名安全追踪键

### Slice 5: Freeze Regression Coverage

- same principal -> same identifier
- different principals -> different identifier
- no raw principal leakage in provider payload or telemetry payload
- unsupported transport still keeps internal identifier path stable

## Interfaces To Freeze

- `apps/app-api/src/modules/runtime-command/store.ts`
  - `RequestExecutionWrite.safetyIdentifier: string | null`
  - `RequestObservabilityFactWrite.safetyIdentifier: string | null`
- `packages/shared/src/campus_shared/prompt_runtime.py`
  - optional `safety_identifier` request field
- `apps/app-api/src/modules/telemetry/axiom.ts`
  - allow anonymous `safety_identifier`
  - continue forbidding raw user/auth fields

## Verification Matrix

- derivation regression：
  - authenticated requests are stable per principal
  - if a future no-principal path is admitted, anonymous requests are stable per app-owned session id
  - requests without principal and without app-owned session id keep `safety_identifier=null`
- provider payload regression：
  - `safety_identifier` is included only when supported
  - no raw principal, session, or secret fields are emitted
- app-api persistence regression：
  - execution and observability store the same identifier
- telemetry regression：
  - `safety_identifier` survives sanitization
  - raw prompt / answer / auth fields remain blocked

## Proposed Write Set

- `packages/shared/src/campus_shared/prompt_runtime.py`
- `apps/app-api/src/modules/runtime-command/store.ts`
- `apps/app-api/src/modules/request-observability.ts`
- `apps/app-api/src/modules/telemetry/axiom.ts`
- `apps/app-api/src/modules/runtime-command/service.ts`
- `apps/supervisor-api/src/campus_supervisor_api/prompt_executor.py`
- targeted regressions under `apps/app-api/test/`, `tests/shared/`, and `tests/api/`

## Exit Rule

Phase H 完成后，repo 应达到：

- `safety_identifier` 的 derivation、transport 和 persistence 已冻结
- provider traceability 与 app-owned observability 使用同一匿名 identifier
- `Phase I` 可以直接拿该 identifier 做 throttle / alert / incident correlation，不再补接口定义或回退到 conversation 粒度
