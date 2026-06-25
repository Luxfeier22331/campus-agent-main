---
doc_type: contract
truth_scope: ops
owner_boundary: apps/app-api
status: active
created: 2026-06-13
updated: 2026-06-13
---

# App API Operator Observability Internal Ingest HTTP

<!-- markdownlint-disable MD013 -->

Split from the former mega-doc during documentation SoT cleanup. This file
owns this section group; the original path remains the stable index.

## Internal Ingest Endpoints

以下 endpoint 是 app-owned internal command seam，不是 browser-facing panel API：

- `POST /api/internal/operator/quality/grades`
- `POST /api/internal/operator/trace-backlinks`
- `POST /api/internal/execution/audit-events`
- `POST /api/internal/operator/evals/coverage-snapshots`
- `POST /api/internal/operator/evals/diagnostic-badcases`
- `POST /api/internal/operator/runtime/temporal-task-queue-snapshots`
- `GET /api/internal/operator/runtime/temporal-task-queues`
- `GET /api/internal/operator/runtime/autoscaler/actuations`
- `GET /api/internal/operator/runtime/autoscaler/postures`
- `GET /api/internal/operator/runtime/autoscaler/decisions`

适用前提：

- 调用方必须携带 `x-app-internal-auth`
- 这是 internal producer（grader worker / sink reconciliation worker）写入 projection
  的入口
- 这些 endpoint 不向 panel 暴露，不支持 ad-hoc query
- runtime query endpoints 只供 execution-control 读取 sanitized projection，不暴露
  raw Temporal response、Docker output 或 app-api database rows
- 对于 app-api 自己掌握的 request lifecycle，runtime 内置 recorder 可以直接写入同一
  `operator.trace_backlink_projection`；internal endpoint 仍保留给 external sink
  reconciliation worker / grader worker

### Runtime Task Queue / Autoscaler Projection

`execution-control` publishes sanitized runtime observations through:

- `POST /api/internal/operator/runtime/temporal-task-queue-snapshots`

`execution-control` reads sanitized runtime projections through:

- `GET /api/internal/operator/runtime/temporal-task-queues`
- `GET /api/internal/operator/runtime/autoscaler/actuations`
- `GET /api/internal/operator/runtime/autoscaler/postures`

Rules:

- task queue snapshots and autoscaler projections use
  `temporal_task_queue_metrics_snapshot.v1`
- default ingest updates bounded current projections:
  `operator.temporal_task_queue_current` and
  `operator.worker_autoscaler_decision_current`
- history rows in `operator.temporal_task_queue_snapshot` and
  `operator.worker_autoscaler_decision` are written only when the producer calls
  `POST /api/internal/operator/runtime/temporal-task-queue-snapshots?history=1`
  during an explicit proof run
- autoscaler cooldown reads recent `worker_autoscaler_actuation.v1` projection
  through the internal actuation query endpoint
- K8s closeout reads `worker_autoscaler_posture.v1` projection through the
  internal posture query endpoint
- operator/runtime task queue and autoscaler decision query endpoints read the
  bounded current projection by default
- query responses are operator-safe projections only; they must not include raw
  Temporal responses, raw Docker Compose output, provider traces, credentials,
  cookies or tokens
- runtime projection query endpoints require `x-app-internal-auth`

### `POST /api/internal/operator/evals/coverage-snapshots`

请求体：

```json
{
  "schemaVersion": "eval_coverage_snapshot.v1",
  "snapshotId": "eval_coverage:20260521T090000Z",
  "generatedAt": "2026-05-21T09:00:00.000Z",
  "sourceGitHead": "git-main",
  "sourceReportSchema": "eval_coverage_snapshot.v1",
  "denominatorSurfaces": [
    "regulations/student_rules",
    "regulations/institutional_rules",
    "curriculum/curriculum_plan",
    "official_web/stable_reference"
  ],
  "surfaces": [],
  "excludedSurfaces": []
}
```

规则：

- payload 语义由 `docs/reference/eval-benchmark-artifact-contract.md` 的
  `eval_coverage_snapshot.v1` 冻结
- ingest 只写 `operator.eval_coverage_snapshot`，panel 只通过
  `GET /api/operator/evals/coverage` 读取 latest projection
- 不接受 local artifact path、object store key、raw prompt、raw answer、transcript、
  auth material、cookie 或 token
- RAGAS diagnostic 只能影响 coverage snapshot 的 diagnostic attention 展示，不替代
  deterministic release gate

### `POST /api/internal/operator/evals/diagnostic-badcases`

请求体：

```json
{
  "schemaVersion": "eval_diagnostic_badcases.v1",
  "evalRunId": "ragas_diagnostic_combined",
  "snapshotId": "eval_diagnostic_badcases:20260521T090000Z",
  "generatedAt": "2026-05-21T09:00:00.000Z",
  "sourceGitHead": "git-main",
  "sourceReportSchema": "ragas-diagnostic-combined-report.v1",
  "badcases": [
    {
      "badcaseId": "ragas_diagnostic:student-scholarship-condition:faithfulness",
      "caseId": "student-scholarship-condition",
      "surfaceKey": "regulations/student_rules",
      "metricName": "faithfulness",
      "score": 0.31,
      "threshold": 0.8,
      "failureStage": "evidence_selection",
      "causeClass": "evidence_selection_failed",
      "metricFailureReason": "evidence_selection",
      "queryPreview": "奖学金要满足什么条件",
      "expectedDocIds": ["doc:scholarship"],
      "retrievedContextIds": ["chunk:wrong", "chunk:scholarship"],
      "retrievedDocIds": ["doc:wrong", "doc:scholarship"],
      "supportingDocIds": ["doc:wrong"],
      "supportingChunkIds": ["chunk:wrong"],
      "answerShape": "eligibility_judgment",
      "presentationKind": "condition_table",
      "trajectoryAttribution": {
        "status": "attributed",
        "stepId": "evidence.selection",
        "stepKind": "selection",
        "capability": "knowledge",
        "toolName": null,
        "stepStatus": "completed",
        "outcome": {
          "failCloseReason": null,
          "terminalReason": null,
          "replanReason": null,
          "cancelOutcome": "not_requested",
          "timeoutOutcome": "not_timed_out",
          "lateCompletionOutcome": "not_late"
        },
        "projectionRefs": ["projection://runs/run_01HQ/evidence-selection"]
      }
    }
  ]
}
```

规则：

- payload schema 固定为 `eval_diagnostic_badcases.v1`，source report schema 固定来自
  `ragas-diagnostic-combined-report.v1`
- `failureStage` 只允许 `routing`、`primary_agent`、`agent`、`tool`、
  `typed_tool`、`retrieval`、`rerank`、`selection`、`evidence_selection`、
  `synthesis`、`grounding`、`finalization`、`replan` 与 `diagnostic`
- `trajectoryAttribution` 必须来自 `operator_step_trajectory.v1` 的 operator-safe projection；
  缺少 trajectory 时显式写入 `trajectory_missing`，阶段无法归因时显式写入
  `attribution_missing`，不得从 workflow summary 或 request link 推断
- ingest 只写 `operator.eval_diagnostic_badcase_projection`；query path 会把这些行并入
  `GET /api/operator/quality/eval-candidates`
- 这些 candidate 没有 runtime `requestId` / `traceId`，app-api 不为它们生成或猜测
  request correlation
- 不接受 local artifact path、bucket / object key、raw prompt、raw answer、transcript、
  auth material、cookie、token 或 provider raw response
- 该 endpoint 不改变 deterministic gate verdict，不生成 benchmark artifact，不创建 fix task

### `POST /api/internal/execution/audit-events`

请求体：

```json
{
  "events": [
    {
      "event_id": "execution-control:req_01HQ:execution.bridge_failed",
      "request_id": "req_01HQ",
      "trace_id": "trace_01HQ",
      "event_type": "execution.bridge_failed",
      "occurred_at": "2026-04-24T10:00:00.000Z",
      "lane": "rag",
      "requested_capability": "knowledge",
      "decision": null,
      "failure_kind": "timeout",
      "http_status": 504,
      "retryable": true,
      "duration_ms": 35012,
      "queue_wait_ms": 12,
      "bridge_duration_ms": 35000
    }
  ]
}
```

规则：

- `request_id` 必须已存在于 app-owned request truth，`trace_id` 必须匹配该请求
- `event_id` 由 producer 按 `execution-control:<request_id>:<event_type>` 生成，重复 ingest
  必须幂等
- 只接受 allowlist execution event type；不接受 raw prompt、raw answer、raw
  transcript、auth material、retrieval payload 或 provider raw response
- ingest 写入 app-owned outbox 后会调度 request-scoped projection drain，让 panel
  尽快看到 curated audit timeline；cron drain 只承担周期性一致性检查
- panel 仍只读取投影后的 audit endpoint，不直接读取 outbox 或 telemetry sink

### `POST /api/internal/operator/quality/grades`

请求体：

```json
{
  "grades": [
    {
      "requestId": "req_01HQ",
      "traceId": "trace_01HQ",
      "gradeSource": "openai_trace_grader",
      "gradeDomain": "grounding",
      "verdict": "pass",
      "score": 0.913,
      "graderVersion": "grader@2026-04-03",
      "sampledAt": "2026-04-03T00:10:00.000Z",
      "rationaleSummary": "grounded to cited handbook passages"
    }
  ]
}
```

规则：

- `requestId` 必须已存在于 app-owned request truth
- `gradeDomain` 固定允许 `grounding`、`citation`、`policy`、`intent`
- 调用时允许只传最小 grading payload；route/service 可以通过 app-owned request fact family 回填
  `surface`、`collection`、`modelName` 等维度
- 不接受 raw grader transcript、raw prompt、raw answer、raw span payload

### `POST /api/internal/operator/trace-backlinks`

请求体：

```json
{
  "backlinks": [
    {
      "requestId": "req_01HQ",
      "traceId": "trace_01HQ",
      "traceLink": "https://sentry.example/organizations/campus/traces/trace_01HQ",
      "issueLink": "https://sentry.example/organizations/campus/issues/123",
      "issueFingerprint": "timeout:execution-control"
    }
  ]
}
```

规则：

- payload 只允许 panel-safe deep link / fingerprint
- 不接受 raw issue body、raw trace body、sink query 语句
- `requestId` 与 `traceId` 必须保持 request-scoped correlation
- app-api 内置 recorder 支持用
  `APP_API_OPERATOR_TRACE_LINK_TEMPLATE` / `APP_API_OPERATOR_ISSUE_LINK_TEMPLATE`
  生成同等 payload；支持的 placeholder 为 `{requestId}`、`{traceId}`、
  `{errorCode}`、`{selectedCapability}`、`{surface}`、`{status}`
