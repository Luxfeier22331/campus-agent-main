---
doc_type: contract
truth_scope: ops
owner_boundary: apps/app-api
status: active
created: 2026-06-13
updated: 2026-06-13
---

# App API Operator Observability Eval And Overview HTTP

<!-- markdownlint-disable MD013 -->

Split from the former mega-doc during documentation SoT cleanup. This file
owns this section group; the original path remains the stable index.

## Eval Coverage Endpoint

### `GET /api/operator/evals/coverage`

返回当前发布到 app-api operator projection 的 eval coverage snapshot。

响应：

```json
{
  "schemaVersion": "eval_coverage_snapshot.v1",
  "snapshotId": "eval_coverage:20260521T090000Z",
  "generatedAt": "2026-05-21T09:00:00.000Z",
  "sourceGitHead": "git-main",
  "sourceReportSchema": "rag-eval-coverage-report.v1",
  "denominatorSurfaces": [
    "regulations/student_rules",
    "regulations/institutional_rules",
    "curriculum/curriculum_plan",
    "official_web/stable_reference"
  ],
  "surfaces": [
    {
      "surfaceKey": "regulations/student_rules",
      "profileId": "handbook",
      "profileArtifactKind": "release_acceptance",
      "qrelsCaseCount": 52,
      "uniqueExpectedDocCount": 28,
      "releaseAcceptanceCaseCount": 25,
      "answerQualityCaseCount": 18,
      "goldenQrelsCaseCount": 52,
      "knownGapCaseCount": 4,
      "maturityStatus": "ready",
      "coverageGaps": [],
      "maturityGaps": [],
      "ragasDiagnostic": {
        "status": "diagnostic_attention",
        "caseCount": 2,
        "completedCaseCount": 2,
        "failedCaseCount": 0,
        "lowScoreCases": [
          {
            "caseId": "student-case",
            "metricName": "answer_relevancy",
            "score": 0.7
          }
        ],
        "metrics": []
      },
      "lastGate": {
        "artifactId": "student-rules-release-gate",
        "artifactKind": "formal_final_summary",
        "profileId": "handbook",
        "surfaceKey": "regulations/student_rules",
        "status": "passed",
        "caseCount": 25,
        "passedCount": 25,
        "failedCount": 0,
        "gitHead": "git-main",
        "reasons": []
      },
      "readiness": {
        "status": "diagnostic_attention",
        "reasons": []
      }
    }
  ],
  "excludedSurfaces": [
    {
      "surfaceKey": "official_web/fresh_news",
      "reason": "excluded from current RAG consumption denominator"
    }
  ]
}
```

规则：

- 该 endpoint 只读 `operator.eval_coverage_snapshot` 的最新 projection
- 如果尚未发布快照，返回 `404 eval_coverage_snapshot_not_found`
- deterministic readiness 由 qrels coverage、maturity gaps 与 last gate 决定
- `ragasDiagnostic` 是 supplemental diagnostic，不替代 deterministic release gate
- snapshot 不得包含 local artifact path、object store key、raw prompt、raw answer、transcript、
  auth material、cookie 或 token
- 该 endpoint 不读取 `.tmp`、`.planning`、eval artifact 目录或对象存储；这些来源只能先通过
  internal publish seam 写入 projection

## Overview Endpoint

### `GET /api/operator/overview`

返回 operator overview 所需的最小控制面快照。

响应：

```json
{
  "window": {
    "from": "2026-04-02T00:00:00.000Z",
    "to": "2026-04-03T00:00:00.000Z",
    "granularity": "15m"
  },
  "overview": {
    "requestVolume": {
      "accepted": 1248,
      "completed": 1219,
      "errored": 17
    },
    "latency": {
      "p50Ms": 820,
      "p95Ms": 2440,
      "p99Ms": 6890
    },
    "failureRate": {
      "value": 0.0136,
      "count": 17,
      "eligibleCount": 1248
    },
    "emptyRecallRate": {
      "value": 0.0831,
      "count": 27,
      "eligibleCount": 325
    },
    "citationMissRate": {
      "value": 0.0413,
      "count": 12,
      "eligibleCount": 290
    },
    "refusalRate": {
      "value": 0.1114,
      "count": 139,
      "eligibleCount": 1248
    },
    "aclAnomalyRate": {
      "value": 0.0016,
      "count": 2,
      "eligibleCount": 1248
    },
    "estimatedCost": {
      "microusd": 4823100,
      "currency": "USD"
    },
    "sinkHealth": {
      "missingTraceRate": {
        "value": 0.0072,
        "count": 9,
        "eligibleCount": 1248
      },
      "projectionFailureCount": 1,
      "outboxPendingCount": 4,
      "outboxRetryCount": 2,
      "outboxStaleCount": 1
    }
  },
  "alerts": [
    {
      "alertId": "opalert_01HQ",
      "domain": "safety",
      "severity": "high",
      "code": "safety.remote_content_suspicion_spike",
      "status": "open",
      "startedAt": "2026-04-02T12:00:00.000Z",
      "requestCount": 3,
      "incidentBackfill": {
        "required": true,
        "mode": "incident_backfill"
      }
    }
  ],
  "asOf": "2026-04-03T00:00:10.000Z"
}
```

`alerts[]` 当前固定支持的最小 `safety` codes：

- `safety.rate_limit_exceeded`
- `safety.remote_content_suspicion_spike`
- `safety.provider_content_filter_spike`

规则：

- `requestCount` 表示同一 `safety_identifier` 在告警窗口内的命中请求数
- `incidentBackfill.required=true` 表示 operator closeout 不能停在 dashboard
  annotation，必须回灌 golden governance 的 `incident_backfill`
- `incidentBackfill.mode=null` 表示这是纯产品侧 abuse control 告警，不自动要求 eval backfill

规则：

- 这是 app-owned overview snapshot，不是 sink dashboard embed
- `alerts` 是 operator-facing curated summary，不要求与任一 vendor 告警系统一一对应
- `emptyRecallRate` 只对 `retrievalAttempted=true` 的请求计数
- `citationMissRate` 只对 `citationExpected=true` 的请求计数
- `sinkHealth.projectionFailureCount`、`outboxPendingCount`、`outboxRetryCount` 与
  `outboxStaleCount` 来自 app-owned projection outbox health，不来自 sink query
