---
doc_type: contract
truth_scope: eval
owner_boundary: apps/app-api
status: active
created: 2026-04-23
updated: 2026-04-23
---
# App API Eval Benchmark HTTP Contract

## 文档边界

这份文档冻结 `packages/evals` 与其他 trusted automation 进入 `apps/app-api` 的 internal eval
ingress seam。

它补充但不替代以下文档：

- browser-facing app contract：`docs/contracts/app-api-http.md`
- request lifecycle：`docs/contracts/app-api-request-lifecycle.md`
- `app-api -> execution-control`
  内部执行契约：`docs/contracts/capability-execution.md`
- operator observability ingest/query
  seam：`docs/contracts/app-api-operator-observability-http.md`
- eval artifact truth：`docs/reference/eval-benchmark-artifact-contract.md`

它不冻结：

- browser-facing `/api/chat/*` contract
- Operator Console query contract
- live benchmark case denominator
- provider/runtime threshold

## 适用范围

长期 internal eval 调用形态固定为：

`packages/evals / trusted automation -> POST /api/internal/evals/chat/requests
-> app-api -> supervisor path`

这里的目标是：

- 通过真实 `app-api` command path 执行 accepted eval request
- 返回 canonical `requestId` / `traceId`
- 可选返回 `supervisor` payload 供 eval trace / deterministic gate 消费
- 不创建 browser-facing BFF 或 same-site contract

## Admission Rules

- 调用方必须提供 `x-app-internal-auth`
- `x-app-internal-auth` 必须与 `APP_API_INTERNAL_SHARED_SECRET` 严格匹配
- 缺少或不匹配时固定返回 `401 service_credential_required`
- internal eval request 不调度 request projection drain；它只返回 command-path
  correlation truth
- request `surface` 固定写成 `eval_benchmark`

## Request Contract

### Endpoint

- `POST /api/internal/evals/chat/requests`

### Headers

必须：

- `content-type: application/json`
- `x-app-internal-auth`
- `x-eval-user-email`

可选 identity / actor 投影：

- `x-eval-user-id`
- `x-eval-user-name`
- `x-eval-principal-type`
- `x-eval-major`
- `x-eval-program`
- `x-eval-cohort`
- `x-eval-actor-roles`
- `x-eval-departments`
- `x-eval-entitlement-groups`
- `x-eval-entitlement-snapshot-id`
- `x-eval-visibility-level`
- `x-eval-visibility-scope`
- `x-eval-applicability-scope`
- `x-eval-ownership-scopes`

补充约束：

- `major` / `program` 等非 ASCII 值允许使用 `b64:<base64-utf8>` 形式传入
- `x-eval-principal-type` 只允许 `campus_member`、`student`、`staff`、`faculty`
- CSV header 继续按 shared parser 解析，例如 roles / departments / entitlement groups

### Body

最小 body：

```json
{
  "prompt": "图书馆开放到几点？"
}
```

带 scope 的 body：

```json
{
  "prompt": "图书馆开放到几点？",
  "requestedScope": {
    "corpus": "regulations",
    "collection": "student_rules"
  },
  "versionQuery": {
    "mode": "historical",
    "versionId": "v2024-student-rules"
  }
}
```

多轮 follow-up 时允许继续带：

- `conversationId`
- `versionQuery`

请求体语义继续复用 `POST /api/chat/requests` 的 command payload；这里只额外固定：

- `surface = eval_benchmark`
- identity 取自 internal eval headers，而不是 session principal
- 非 `current` 的 eval case 现在通过同一条 `app-api` command path 进入 supervisor，不再走
  legacy shortcut

## Success Response

成功时固定返回：

- `200 OK`
- headers:
  - `x-request-id`
  - `x-trace-id`

response body：

```json
{
  "answer": {
    "conversation": {
      "id": "conv_eval_01HQ",
      "title": "图书馆开放时间",
      "createdAt": "2026-03-28T07:59:00.000Z",
      "updatedAt": "2026-03-28T08:00:01.000Z",
      "messages": []
    },
    "result": {
      "kind": "answer",
      "requestId": "req_eval_01HQ",
      "text": "图书馆开放到 22:00。",
      "traceId": "trace_eval_01HQ"
    }
  },
  "supervisor": {
    "status": "completed",
    "selectedCapability": "knowledge",
    "traceId": "trace_eval_01HQ",
    "answerText": "图书馆开放到 22:00。",
    "followUpQuestion": "",
    "error": null,
    "observability": {
      "retrievalAttempted": true,
      "retrievedSourceCount": 1,
      "citationCount": 1,
      "citationExpected": true,
      "citationMissing": false,
      "failClosed": false
    },
    "result": {
      "evidence": {
        "corpus": "regulations",
        "collection": "student_rules",
        "query_text": "图书馆开放到几点？",
        "sources": []
      }
    }
  }
}
```

补充约束：

- `answer` 与 browser-facing contract 保持同一 shape
- `supervisor` 是 eval-only internal payload；browser-facing app contract 不默认暴露它
- `requestId` / `traceId` 是 eval artifact 后续 publish / backflow 的 canonical
  correlation truth

## Error Contract

- body validation 仍使用 shared error envelope：
  - `unsupported_media_type`
  - `invalid_json`
  - `validation_failed`
- internal auth 失败固定返回：
  - `service_credential_required`
- route/service-level 错误使用 route-error correlation 生成诊断用 `requestId` /
  `traceId`

## Lifecycle Notes

- internal eval ingress 通过真实 `app-api` command path 执行，不是直接调用 agent /
  supervisor shortcut
- 它服务 live benchmark、request correlation、operator publish backflow 与
  deterministic trace observation
- 它不替代 accepted benchmark artifact contract；artifact 布局与 accept/publish 入口见
  `docs/reference/eval-benchmark-artifact-contract.md`

## Eval Coverage Projection Publish

Eval coverage snapshot 不是 chat request ingress。它由 `packages/evals` 在本地或 CI
汇总 current denominator 后，经 operator observability internal seam 发布到 app-api：

- `POST /api/internal/operator/evals/coverage-snapshots`
- admission：`x-app-internal-auth`
- request body：`eval_coverage_snapshot.v1`
- success response：

```json
{
  "accepted": 1,
  "snapshotId": "eval_coverage:20260521T090000Z"
}
```

规则：

- app-api 必须校验 current denominator surface 顺序：
  `regulations/student_rules`、`regulations/institutional_rules`、
  `curriculum/curriculum_plan`、`official_web/stable_reference`
- app-api 必须拒绝 local artifact path、raw prompt、raw answer、transcript、auth material、
  cookie 或 token 等字段
- 该 publish seam 只写 operator projection，不改变 deterministic gate verdict，也不把 RAGAS
  diagnostic 升级为 release blocker
- Operator Console 只通过 `GET /api/operator/evals/coverage` 读取已发布 projection

## Eval Diagnostic Badcase Projection Publish

Eval diagnostic badcase projection 不是 chat request ingress，也不是 release acceptance
artifact。它把 RAGAS diagnostic combined report 中的 low-score case 投影为
operator-safe review candidate：

- `POST /api/internal/operator/evals/diagnostic-badcases`
- admission：`x-app-internal-auth`
- request body：`eval_diagnostic_badcases.v1`
- success response：

```json
{
  "accepted": 1,
  "snapshotId": "eval_diagnostic_badcases:20260521T090000Z"
}
```

最小 payload 形状：

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

- app-api 必须拒绝 local artifact path、bucket / object key、raw prompt、raw answer、
  transcript、auth material、cookie 或 token 等字段
- `failureStage` 固定允许 `retrieval`、`rerank`、`selection`、
  `evidence_selection`、`synthesis`、`grounding` 与 `diagnostic`
- `trajectoryAttribution` 固定来自 `operator_step_trajectory.v1`；缺失或无法归因必须显式写成
  `trajectory_missing` / `attribution_missing`，不得从 workflow summary 猜测
- RAGAS diagnostic badcase 不携带 runtime `requestId` / `traceId`，app-api 不得为它生成或
  猜测 request correlation
- 该 publish seam 只写 `operator.eval_diagnostic_badcase_projection`，不改变 deterministic
  gate verdict，不生成 benchmark artifact，不创建 fix task
- Operator Console 只通过 `GET /api/operator/quality/eval-candidates` 读取已发布 projection；
  返回的 `intake.source` 固定为 `ragas_diagnostic`
