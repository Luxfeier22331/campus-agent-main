---
doc_type: contract
truth_scope: ops
owner_boundary: apps/app-api
status: active
created: 2026-04-03
updated: 2026-06-29
---

# App API Operator Observability Contract

## Boundary

This document freezes the `apps/app-api` operator observability HTTP contract.
It is the single owner contract for overview, runtime health, request detail,
quality, governance, safety, cost, audit and internal diagnostic ingest.

The long-term operator observability query path is:

`operator browser -> operator console protected surface -> app-api`

All browser-facing endpoints here are read-only query endpoints. Producers that
want Operator Console to consume grader, sink or runtime data must first publish
operator-safe projections through the internal ingest seams in this document.

## Shared Rules

- JSON body uses `camelCase`.
- Timestamps use ISO 8601 UTC strings.
- Enum/code values use lowercase semantic values such as `completed`,
  `citation_missing` and `projection_lag_spike`.
- All errors use `docs/contracts/app-api/error.md`.
- `requestId` is the business correlation id.
- `traceId` is the runtime trace correlation id.
- Summary, timeseries and queue endpoints read app-api-owned projections,
  rollups or grade projections; they do not query sinks at request time.
- Sink back-links may expose safe deep links or fingerprints only. They must not
  return raw sink events.
- Token, model, retrieval, citation and ACL facts must come from execution-side
  typed telemetry or app-owned runtime fact families, not from Operator Console
  inference.
- `selectedTool` is the raw tool filter. It is not a forward family label or
  localized display string.

Forbidden response material:

- raw prompt
- raw answer
- raw transcript
- raw auth material, JWT, cookie, secret or token
- raw retrieval payload or support snippet dump
- raw provider response
- raw sink event body
- raw Temporal history
- local artifact path
- object bucket/key unless a separate contract explicitly allows it

## Common Query Parameters

Aggregate and queue endpoints support:

- `window`: `15m`, `1h`, `24h`, `7d`, `30d`; default `24h`
- `surface`
- `selectedTool`
- `requestedTool`
- `principalType`
- `collection`
- `modelName`

Timeseries endpoints additionally support:

- `granularity`: `5m`, `15m`, `1h`, `1d`

List endpoints additionally support:

- `limit`
- `cursor`

Rules:

- Invalid `window` or `granularity` returns `400 validation_failed`.
- Illegal `window` / `granularity` combinations return `400 validation_failed`.
- Missing filters mean the current operator-visible full app-owned aggregate.
- Filters apply to projection / rollup dimensions, not raw sink backends.

## Endpoint Summary

Overview and runtime:

- `GET /api/operator/overview`
- `GET /api/operator/runtime/health`

Request detail:

- `GET /api/operator/requests/:requestId/observability`

Quality and eval intake:

- `GET /api/operator/quality/summary`
- `GET /api/operator/quality/timeseries`
- `GET /api/operator/quality/badcases`
- `GET /api/operator/quality/eval-candidates`

Governance, safety, cost and audit:

- `GET /api/operator/intent/summary`
- `GET /api/operator/intent/timeseries`
- `GET /api/operator/safety/summary`
- `GET /api/operator/safety/anomalies`
- `GET /api/operator/cost/summary`
- `GET /api/operator/cost/timeseries`
- `GET /api/operator/audit`
- `GET /api/operator/audit/:auditEventId`

Internal ingest and runtime projection:

- `POST /api/internal/operator/quality/grades`
- `POST /api/internal/operator/trace-backlinks`
- `POST /api/internal/execution/audit-events`
- `POST /api/internal/operator/runtime/temporal-task-queue-snapshots`
- `GET /api/internal/operator/runtime/temporal-task-queues`
- `GET /api/internal/operator/runtime/autoscaler/actuations`
- `GET /api/internal/operator/runtime/autoscaler/postures`
- `GET /api/internal/operator/runtime/autoscaler/decisions`

Non-goals:

- operator acknowledge / resolve / retry / export APIs
- ad-hoc SQL, log, trace or sink explorer APIs
- sink query passthrough
- custom dashboard composition APIs
- execution-control exposing operator observability HTTP surfaces
- Operator Console BFF querying DB, audit JSONL or sink data directly

## Overview And Runtime Health

### `GET /api/operator/overview`

Returns the minimal operator overview snapshot.

Response blocks:

- `window`
- `overview.requestVolume`
- `overview.latency`
- `overview.failureRate`
- `overview.emptyRecallRate`
- `overview.citationMissRate`
- `overview.refusalRate`
- `overview.aclAnomalyRate`
- `overview.estimatedCost`
- `overview.sinkHealth`
- `alerts`
- `asOf`

Rules:

- This is an app-owned overview snapshot, not a sink dashboard embed.
- `alerts` is a curated operator summary and does not need a one-to-one mapping
  to a vendor alert system.
- `emptyRecallRate` counts only requests where `retrievalAttempted=true`.
- `citationMissRate` counts only requests where `citationExpected=true`.
- Projection and outbox health come from app-owned projection outbox health, not
  sink query.
- Supported first-version `safety` alert codes:
  `safety.rate_limit_exceeded`, `safety.remote_content_suspicion_spike` and
  `safety.provider_content_filter_spike`.

### `GET /api/operator/runtime/health`

Returns operator-safe execution runtime health projection for the Operator
Console Overview runtime card.

Response blocks:

- `asOf`
- `status`
- `executionRuntime`
- `runProjectionStore`
- `temporalRuntime`

Rules:

- This endpoint is app-api operator API, not Temporal UI, raw Temporal history,
  Prometheus or a metrics explorer.
- Operator Console consumes only sanitized projection from this endpoint.
- `status=degraded` means execution-control `/readyz` returned a structured
  degraded payload; the endpoint still returns the operator-safe projection.
- Network errors, missing execution-control config, auth failures or non-readyz
  responses fail closed through the standard error envelope; they are not
  wrapped as `degraded`.
- `executionRuntime.checks.*` may be only `ready`, `not_ready` or
  `not_reported`.
- `executionRuntime.blockers` contains reason-code summaries only.
- `temporalRuntime.taskQueuePollers` exposes task queue name, type, poller count
  and health; it is not a complete Temporal visibility API.

## Request Detail

### `GET /api/operator/requests/:requestId/observability`

Returns request detail observability, quality and safety summary.

Response blocks:

- `request`
- `observability`
- `runtimeRun`
- `links`
- `replay`
- `auditSummary`

Rules:

- This is request-scoped observability summary, not raw execution dump.
- `requestedScope` reflects whether the caller constrained scope at admission.
- `request.versionQuery` reflects caller-provided raw version query; missing
  means no explicit current override.
- `resolvedScope` is execution-side serving-surface truth for quality and
  collection attribution.
- `observability.versionQueryMode` and `versionQuerySummary` are safe summaries
  for current, historical, as-of or compare requests.
- `retrievalAttempted`, `citationExpected` and `aclDecision` come from typed
  execution seams or app-owned runtime fact families.
- `sourceTrace.retrieved` is bounded raw retrieval candidate identity.
- `sourceTrace.supporting` is the final answer-facing support set identity.
- Source traces may expose compact identity fields such as `docId`, `chunkId`,
  `score`, `collection`, canonical id/title and source-unit identity.
- `retrievalPlan` exposes compact plan / step execution summary only. Its source
  is request projection `diagnosticsJson.retrievalPlanSummary`, not raw planner
  trace or provider debug payload.
- `runtimeRun.operatorStepTrajectory` is the canonical execution diagnostic
  export. It is materialized by app-api from execution-control step projections
  and app-owned projection state, not inferred by the panel.
- Missing required run / step / attempt / result projection state returns a
  typed route error or diagnostic gap. The route must not synthesize a
  successful trajectory.
- `claimSupportSummary` is compact claim aggregation only.
- `observability.prompt.*` exposes prompt identity and typed runtime branch, not
  raw prompt text.
- `links.*` comes from app-owned backlink projection.
- `replay` is an operator-safe view assembled from existing typed summaries; it
  is not a second source of truth.

## Quality And Eval Intake

### `GET /api/operator/quality/summary`

Returns runtime quality and sampled grade summaries.

Response blocks:

- `window`
- `runtime`
- `sampledGrades`
- `asOf`

Rules:

- `runtime` and `sampledGrades` are separate truth blocks.
- Runtime feedback joins `chat.message_feedback.request_id` to
  `runtime.request_observability_fact.request_id`; request observability fact
  defines time window and filters.
- Feedback coverage denominator includes only eligible assistant answers:
  `completed`, `needs_clarification` and `no_answer`.
- `sampledGrades` may be empty or `null`; runtime metrics must not impersonate
  grader results.
- Forward sampled grade truth comes from `operator.quality_grade_projection`.
- `intentPassRate` comes only from `gradeDomain=intent` human review or sampled
  grader output.

### `GET /api/operator/quality/timeseries`

Returns quality rollups by bucket.

Rules:

- Buckets return app-owned aggregate only, not raw request rows.
- Feedback timeseries fields use the same denominator rules as quality summary.
- Sampled grade curves may return `null` for buckets without enough samples.
- First-version `sampledGroundingPassRate` is `null`; forward truth comes from
  `operator.quality_grade_projection` joined to request buckets.

### `GET /api/operator/quality/badcases`

Supported filters:

- `limit`
- `cursor`
- `status`
- `causeClass`
- `detectedBy`

Rules:

- This is an app-owned badcase queue, not a raw grader output list.
- `summary` is safe text and must not expose raw prompt or answer.
- First-version filters are `status`, `causeClass` and `detectedBy`.
- First-version `detectedBy` comes from `runtime_monitor`.
- Landed `causeClass` values include `citation_missing`, `empty_recall`,
  `grounding_failed`, `unsupported_by_evidence`, `policy_failed`,
  `authz_suspected` and `freshness_fail_close`.
- `grade` and `links` may be `null`. When projections exist, the panel receives
  safe backlinks and grade summaries from app-owned projections.

### `GET /api/operator/quality/eval-candidates`

Returns app-api-owned badcase-to-eval intake candidates.

Supported filters match `quality/badcases` and `detectedBy` may select
`negative_feedback` or `ragas_diagnostic`.

Rules:

- This endpoint is not eval golden set admission.
- `candidateId` is stable and derived from badcase id, feedback id or RAGAS
  diagnostic badcase id.
- `intake.source` may be `operator_badcase`, `negative_feedback` or
  `ragas_diagnostic`.
- `suggestedEvalFamily` may be `citation`, `grounding`, `intent`, `policy` or
  `unknown`.
- Negative feedback candidates return request/message correlation, intent
  summary, citation/source posture, reason codes and trace backlink only.
- RAGAS diagnostic candidates do not have runtime request / trace correlation;
  `requestId`, `traceId`, `selectedTool` and `links.*` may be `null`.
- RAGAS diagnostic candidates expose only case, metric, failure stage and doc id
  summaries.
- Eval tooling can package candidates as `pending_review` only. This endpoint
  does not write eval truth, generate benchmark artifacts or create fix tasks.

## Governance, Safety, Cost And Audit

### `GET /api/operator/intent/summary`

Returns entrance intent governance summary for classifier, schema and context
resolution drift.

Rules:

- `runtime.*` comes from typed intent summary in
  `runtime.request_observability_fact`.
- `sampledGrades.*` comes from `operator.quality_grade_projection` where
  `gradeDomain=intent`.
- Distributions contain operator-safe code / version / count only.

### `GET /api/operator/intent/timeseries`

Returns intent governance trend by bucket. It follows the common timeseries
parameter rules.

### `GET /api/operator/safety/summary`

Returns safety and authorization summary.

Rules:

- `decisionDistribution` is based on app-owned authz projection / request
  observability fact.
- `aclAnomalyRate` counts explicit anomaly codes only. The query path does not
  infer anomalies.

### `GET /api/operator/safety/anomalies`

Supported filters:

- `limit`
- `cursor`
- `severity`
- `status`
- `anomalyCode`

Rules:

- This is a curated operator queue, not raw audit or sink exception output.
- It must not directly expose sensitive restricted document content. Use safe
  summary or controlled doc id when needed.

### `GET /api/operator/cost/summary`

Returns near-real-time estimated cost summary.

Rules:

- First version returns request-scoped estimated cost.
- Provider reconciled cost can later be added as a separate aggregate block, but
  must not override request-scoped runtime estimated cost.

### `GET /api/operator/cost/timeseries`

Returns cost rollups by bucket.

Rule: cost timeseries uses app-owned rollup and does not query Axiom or provider
billing API at request time.

### `GET /api/operator/audit`

Supported filters:

- `limit`
- `cursor`
- `requestId`
- `traceId`
- `principalType`
- `surface`
- `selectedTool`
- `eventType`
- `status`

Rules:

- Returns curated audit timeline summary, not raw JSONL replay.
- `summary` is governance-safe text.
- First-version event types are request lifecycle events such as
  `request.accepted`, `request.completed`, `request.no_answer`,
  `request.needs_clarification`, `request.error`,
  `request.approval_required`, `request.rejected` and `request.cancelled`.
- Execution runtime kernel events may enter the same projection through
  internal ingest. First-version allowed kernel events are
  `execution.admission_rejected`, `execution.cancel_requested`,
  `execution.cancelled`, `execution.activity_failed` and `execution.timed_out`.

### `GET /api/operator/audit/:auditEventId`

Returns one audit event with optional `entitlementSnapshotId`,
`policyProjectionVersion`, diagnostics and safe links.

Rules:

- Detail still excludes raw JWT, cookies, prompt, answer and retrieval payload.
- `links` may be `null`.
- Links come from app-owned projection and cannot be resolved by route-time sink
  query.

## Internal Ingest

Internal ingest endpoints are app-owned internal command seams, not
browser-facing panel APIs.

Rules:

- Callers must provide `x-app-internal-auth`.
- These endpoints are for internal producers such as grader workers,
  sink-reconciliation workers and execution-control runtime projection
  publishers.
- They do not support ad-hoc panel query.

### Runtime Task Queue / Autoscaler Projection

`execution-control` publishes sanitized runtime observations through:

- `POST /api/internal/operator/runtime/temporal-task-queue-snapshots`

`execution-control` reads sanitized runtime projections through:

- `GET /api/internal/operator/runtime/temporal-task-queues`
- `GET /api/internal/operator/runtime/autoscaler/actuations`
- `GET /api/internal/operator/runtime/autoscaler/postures`
- `GET /api/internal/operator/runtime/autoscaler/decisions`

Rules:

- Task queue snapshots and autoscaler projections use
  `temporal_task_queue_metrics_snapshot.v1`.
- Default ingest updates bounded current projections:
  `operator.temporal_task_queue_current` and
  `operator.worker_autoscaler_decision_current`.
- History rows are written only when the producer calls
  `POST /api/internal/operator/runtime/temporal-task-queue-snapshots?history=1`
  during an explicit proof run.
- Autoscaler cooldown reads recent `worker_autoscaler_actuation.v1`.
- K8s closeout reads `worker_autoscaler_posture.v1`.
- Query responses are operator-safe projections only.
- Runtime projection query endpoints require `x-app-internal-auth`.

### `POST /api/internal/execution/audit-events`

Publishes execution kernel events into app-owned audit projection flow.

Rules:

- `request_id` must exist in app-owned request truth.
- `trace_id` must match the request.
- `event_id` is producer-generated and idempotent.
- Only allowlisted execution event types are accepted.
- Ingest writes app-owned outbox and schedules request-scoped projection drain.
- Panel still reads audit endpoints, not outbox or telemetry sinks.

### `POST /api/internal/operator/quality/grades`

Publishes safe grading summaries.

Rules:

- `requestId` must exist in app-owned request truth.
- `gradeDomain` may be `grounding`, `citation`, `policy` or `intent`.
- Route/service may enrich dimensions from app-owned request facts.
- Raw grader transcript, prompt, answer and span payload are rejected.

### `POST /api/internal/operator/trace-backlinks`

Publishes panel-safe trace/issue backlinks.

Rules:

- Payload includes safe deep link or fingerprint only.
- Raw issue body, raw trace body and sink query text are rejected.
- `requestId` and `traceId` must preserve request-scoped correlation.
- The app-api built-in recorder may generate equivalent payload with
  `APP_API_OPERATOR_TRACE_LINK_TEMPLATE` /
  `APP_API_OPERATOR_ISSUE_LINK_TEMPLATE`.
