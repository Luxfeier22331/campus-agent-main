---
doc_type: contract
status: active
created: 2026-04-03
updated: 2026-04-25
---
# App API Operator Observability HTTP Contract

## 文档边界

这份文档冻结 `apps/app-api` 暴露给 `protected-panel-web` 的 operator observability query
contract。

它补充但不替代以下文档：

- browser-facing app contract：`docs/contracts/app-api-http.md`
- request lifecycle 与 request
  projection：`docs/contracts/app-api-request-lifecycle.md`
- eval benchmark ingress 与 publish
  correlation：`docs/contracts/app-api-eval-benchmark-http.md`
- product/control-plane
  ownership：`docs/architecture/system/product-runtime-architecture.md`
- operator observability supporting
  architecture：`docs/architecture/system/operator-observability-architecture.md`
- 领域导航：`docs/domains/operator-observability.md`
- ownership / sink participation 决策：`docs/decisions/adr-0023-operator-observabil
  ity-control-plane-and-sink-participation.md`
- 当前 merged-truth schema：`docs/data/app-api-schema.md`
- shared eval artifact
  contract：`docs/reference/eval-benchmark-artifact-contract.md`

这份文档不冻结：

- panel UI layout、卡片排列或交互细节
- telemetry sink vendor SDK 的逐字段接入方式
- 告警阈值、sampling ratio、retention 天数
- operator 写操作、acknowledge / resolve / override API
- raw log、raw trace、raw audit JSONL、raw grader payload 的直接查询能力

## 适用范围

长期 operator observability query path 固定为：

`operator browser -> protected-panel-web same-site /api/* -> app-api`

这里冻结的都是只读 query endpoints。

它们共享以下前提：

- operator principal admission 继续复用 shared `app-api` operator access model
- panel 继续只消费 runtime-owned projections / rollups
- `Sentry`、`Axiom`、sampled grading / eval tooling 继续只是 sink 或输入来源，不直接充当 query
  backend
- grader / sink 如果要让 panel 消费结果，必须先通过 `app-api` owned internal ingest seam 写入
  projection

## Contract 与实现范围说明

这份文档冻结的是 forward contract，不表示 `develop` 已经完整实现文中所有 endpoint。

判断当前已实现子集时：

- 当前已落地能力以 `docs/architecture/current-architecture.md` 和代码为准
- 当前 accepted direction 与长期边界以本文、supporting architecture 与相关 ADR 为准

## Cross-Cutting Rules

- JSON body 使用 `camelCase`
- 时间戳使用 ISO 8601 UTC 字符串
- enum / code value 使用小写语义值，例如
  `completed`、`citation_missing`、`projection_lag_spike`
- 所有错误响应继续使用 `docs/contracts/app-api-error-model.md` 中定义的统一 envelope
- `requestId` 是业务级 correlation id；`traceId` 是 runtime trace correlation id
- panel-facing sink backlink 只允许返回安全的 deep link / fingerprint，不返回 raw sink event
  blob
- token / model / retrieval / citation / ACL facts 必须来自 execution-side typed
  telemetry seam 或 app-owned runtime fact family，不得由 panel query path 反推
- 所有 summary / timeseries / queue 都必须由 `app-api` owned projection、rollup 或 grade
  projection 提供；panel 不得直接查询 sink

### Common Query Parameters

所有聚合与队列类 endpoints 默认支持以下公共参数：

- `window`
  - 允许值：`15m`、`1h`、`24h`、`7d`、`30d`
  - 默认：`24h`
- `surface`
- `selectedCapability`
- `requestedCapability`
- `principalType`
- `collection`
- `modelName`

timeseries endpoints 额外支持：

- `granularity`
  - 允许值：`5m`、`15m`、`1h`、`1d`

list endpoints 额外支持：

- `limit`
- `cursor`

规则：

- 非空但不在允许集合内的 `window` 或 `granularity` 返回 `400 validation_failed`
- `window` 与 `granularity` 的非法组合返回 `400 validation_failed`
- 未传 filter 时表示查询当前 operator 可见范围内的全量 app-owned aggregate
- 过滤只作用于 app-owned projection / rollup 维度，不隐式回源 raw sink
- `selectedCapability` 继续只表示 raw capability filter，不表示 forward family
  label，也不直接承担 localized display wording
- 如果 operator surface 需要 capability family 或 display wording，必须通过独立 projection
  field / mapping 提供；不得把 `knowledge`、`navigation` 之类派生标签直接写回
  `selectedCapability`

## Endpoint Summary

### Overview

- `GET /api/operator/overview`

### Requests

- `GET /api/operator/requests`
  - summary / detail shape 继续由 `docs/contracts/app-api-http.md` 冻结
- `GET /api/operator/requests/:requestId`
  - summary / detail shape 继续由 `docs/contracts/app-api-http.md` 冻结
- `GET /api/operator/requests/:requestId/observability`

### Quality

- `GET /api/operator/quality/summary`
- `GET /api/operator/quality/timeseries`
- `GET /api/operator/quality/badcases`
- `GET /api/operator/quality/eval-candidates`

### Intent Governance

- `GET /api/operator/intent/summary`
- `GET /api/operator/intent/timeseries`

### Safety/Authz

- `GET /api/operator/safety/summary`
- `GET /api/operator/safety/anomalies`

### Cost

- `GET /api/operator/cost/summary`
- `GET /api/operator/cost/timeseries`

### Eval Coverage

- `GET /api/operator/evals/coverage`
- `POST /api/internal/operator/evals/coverage-snapshots`
- `POST /api/internal/operator/evals/diagnostic-badcases`

### Audit

- `GET /api/operator/audit`
- `GET /api/operator/audit/:auditEventId`

第一版不冻结：

- operator acknowledge / resolve / retry / export API
- ad-hoc SQL / log / trace explorer
- sink query passthrough API
- custom dashboard composition API

## Response Shapes

### Window

```json
{
  "from": "2026-04-03T00:00:00.000Z",
  "to": "2026-04-03T23:59:59.999Z",
  "granularity": "15m"
}
```

### Trace Backlinks

```json
{
  "traceLink": "https://sentry.example/organizations/campus/traces/trace_01HQ",
  "issueLink": "https://sentry.example/organizations/campus/issues/123",
  "issueFingerprint": "timeout:execution-control"
}
```

规则：

- `traceLink`、`issueLink`、`issueFingerprint` 都是 panel-friendly backlink
- 没有关联对象时允许返回 `null`
- 不返回 sink 原始 payload 或 query 语句
- 当前 forward contract 接受这些字段最终由 `operator.trace_backlink_projection` 提供
- `app-api` 可以在 request lifecycle 中按
  `APP_API_OPERATOR_TRACE_LINK_TEMPLATE` / `APP_API_OPERATOR_ISSUE_LINK_TEMPLATE`
  自动写入 trace / issue backlink；模板只渲染 deep link，不查询 sink，不改变
  panel truth owner

### Metric Ratio

```json
{
  "value": 0.041,
  "count": 12,
  "eligibleCount": 290
}
```

规则：

- `count` 是命中数
- `eligibleCount` 是该指标合法分母；不适用时允许为 `null`

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

## Requests Observability Endpoint

### `GET /api/operator/requests/:requestId/observability`

返回 request detail 页的 observability / quality / safety 摘要。

响应：

```json
{
  "request": {
    "requestId": "req_01HQ",
    "traceId": "trace_01HQ",
    "conversationId": "conv_01HQ",
    "surface": "public_chat_web",
    "status": "completed",
    "requestedCapability": "knowledge",
    "requestedScope": null,
    "versionQuery": {
      "mode": "compare",
      "versionId": "v2024-student-rules",
      "compareToVersionId": "v2025-student-rules"
    },
    "resolvedScope": {
      "corpus": "curriculum",
      "collection": "curriculum_plan"
    },
    "selectedCapability": "knowledge",
    "startedAt": "2026-04-03T00:00:00.000Z",
    "completedAt": "2026-04-03T00:00:00.842Z"
  },
  "observability": {
    "durationMs": 842,
    "retrievalAttempted": true,
    "candidateCount": 18,
    "retrievedSourceCount": 4,
    "emptyRecall": false,
    "citationExpected": true,
    "citationCount": 2,
    "citationMissing": false,
    "refusalClass": null,
    "aclDecision": "allowed",
    "aclAnomalyCode": null,
    "failClosed": false,
    "retrievalAdequacyVerdict": "sufficient",
    "retrievalAdequacyReason": "sufficient",
    "versionQueryMode": "compare",
    "versionQuerySummary": "compare:v2024-student-rules->v2025-student-rules",
    "retrievalPlan": {
      "planId": "curriculum:curriculum_plan:current",
      "queryMode": "current",
      "replanCount": 0,
      "terminalState": "completed",
      "stepActivities": [
        {
          "stepId": "indexed-lookup",
          "stepType": "indexed_lookup",
          "corpus": "curriculum",
          "collection": "curriculum_plan",
          "status": "succeeded",
          "topK": 8,
          "latencyMs": 18,
          "candidateCount": 4,
          "referenceCount": 4,
          "failureKind": null
        }
      ]
    },
    "claimSupportSummary": {
      "totalClaims": 3,
      "supportedClaims": 1,
      "unsupportedClaims": 2,
      "unsupportedClaimTypes": [
        "audience_or_major_or_program_or_class_family",
        "offering_unit_or_owning_school"
      ],
      "unsupportedFields": [
        "audience_claims",
        "offering_unit_claims"
      ]
    },
    "model": {
      "provider": "openai",
      "name": "gpt-5.2-mini"
    },
    "prompt": {
      "id": "rag_answer_v1",
      "version": "v1",
      "templateSha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      "runtimeState": null,
      "runtimeDetail": null
    },
    "inputTokens": 812,
    "outputTokens": 229,
    "cachedInputTokens": 0,
    "estimatedCost": {
      "microusd": 3810,
      "currency": "USD"
    },
    "sourceTrace": {
      "retrieved": [
        {
          "docId": "curriculum:法学（民族实验班）本科人才培养方案",
          "chunkId": "chunk-raw-1",
          "score": 0.94,
          "collection": "curriculum_plan",
          "sourceTitle": "法学（民族实验班）本科人才培养方案",
          "canonicalSourceId": null,
          "canonicalSourceTitle": null,
          "sourceUnitKind": null,
          "sourceUnitKey": null
        }
      ],
      "supporting": [
        {
          "docId": "program_semester_facts:law:semester-4",
          "chunkId": "chunk-support-1",
          "score": 0.97,
          "collection": "program_semester_facts",
          "sourceTitle": "法学（民族实验班）本科人才培养方案 第四学期课程事实",
          "canonicalSourceId": "curriculum:法学（民族实验班）本科人才培养方案",
          "canonicalSourceTitle": null,
          "sourceUnitKind": "semester_course_list",
          "sourceUnitKey": "semester-4"
        }
      ]
    },
    "traceAvailable": true,
    "projectionLagMs": 420,
    "measuredAt": "2026-04-03T00:00:01.300Z"
  },
  "links": {
    "traceLink": "https://sentry.example/organizations/campus/traces/trace_01HQ",
    "issueLink": null,
    "issueFingerprint": null
  },
  "replay": {
    "context": {
      "principalType": "student",
      "entitlementSnapshotId": "ent_01HQ",
      "entitlementGroups": ["students"],
      "visibilityScope": "main",
      "applicabilityScope": "undergraduate",
      "policyProjectionVersion": "phase1-authorization-projection-v1"
    },
    "routing": {
      "requestedCapability": "knowledge",
      "requestedScope": null,
      "resolvedScope": {
        "corpus": "curriculum",
        "collection": "curriculum_plan"
      },
      "selectedCapability": "knowledge"
    },
    "execution": {
      "status": "completed",
      "errorCode": null,
      "semanticOutcome": null,
      "refusalClass": null,
      "scopeClass": null,
      "failClosed": false
    },
    "retrieval": {
      "retrievalAttempted": true,
      "candidateCount": 18,
      "retrievedSourceCount": 4,
      "emptyRecall": false,
      "adequacyVerdict": "sufficient",
      "adequacyReason": "sufficient",
      "plan": {
        "planId": "curriculum:curriculum_plan:current",
        "queryMode": "current",
        "replanCount": 0,
        "terminalState": "completed",
        "stepActivities": []
      },
      "sourceTraceCounts": {
        "retrieved": 1,
        "supporting": 1
      }
    },
    "answerQuality": {
      "citationExpected": true,
      "citationCount": 2,
      "citationMissing": false,
      "claimSupportSummary": null,
      "groundingVerdict": null,
      "groundingDowngraded": null,
      "freshnessFailClosed": null,
      "policyReason": null
    },
    "prompt": {
      "id": "rag_answer_v1",
      "version": "v1",
      "templateSha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      "runtimeState": null,
      "runtimeDetail": null
    }
  },
  "auditSummary": {
    "auditEventCount": 5,
    "latestTerminalCode": "completed"
  }
}
```

规则：

- 这是 request-scoped observability summary，不是 raw execution dump
- 不返回 raw prompt、raw answer、raw transcript、raw auth material、raw retrieval
  payload
- `requestedScope` 反映 accept 时上游是否显式约束 scope，可为 `null`
- `request.versionQuery` 反映调用方显式提交的 raw version query；缺失时表示 caller 没有显式覆盖
  current
- `resolvedScope` 反映 execution side 最终命中的 serving surface，是 panel 侧 quality /
  collection 归因的真相源
- `observability.versionQueryMode` / `versionQuerySummary` 是 operator-safe
  摘要，用于区分 `current`、`historical`、`as_of`、`compare` 等请求形态；它们不是 raw planner trace
- `retrievalAttempted`、`citationExpected`、`aclDecision` 必须来自 typed execution
  seam 或 app-owned runtime fact family
- `sourceTrace.retrieved` 表示 bounded raw retrieval candidate
  trace；`sourceTrace.supporting` 表示最终 answer-facing support set
- `sourceTrace.*` 只允许返回 operator-safe compact identity fields，例如
  `docId`、`chunkId`、`score`、`collection`、canonical / source-unit identity；不得返回
  raw snippet dump
- `sourceTrace.supporting[*].canonicalSourceId` 与
  `sourceTrace.supporting[*].sourceUnitKey` 用于显式区分 canonical curriculum identity
  与物理 projection-unit hit
- `retrievalAdequacyVerdict` / `retrievalAdequacyReason` 用于区分 retrieval base 不足与
  post-generation grounding downgrade
- `retrievalPlan` 只暴露 compact plan / step execution summary，例如
  `planId`、`queryMode`、`replanCount`、`terminalState` 与 step-level `status` /
  `latencyMs` / `candidateCount`
- `retrievalPlan` 的来源固定为 request projection 中的
  `diagnosticsJson.retrievalPlanSummary`；它是 operator-safe typed projection，不是
  raw planner trace 或 provider debug payload
- `claimSupportSummary` 只返回 compact 的 claim-level 聚合：总 claim 数、unsupported claim
  type、unsupported field；不返回 raw `claim_supports`、support snippet 或
  provider-native citation/support blob
- `observability.prompt.*` 只暴露 prompt identity 与 typed runtime branch，不返回 raw
  prompt
- token / model 字段必须来自 execution-side typed telemetry seam，不从 sink query 反推
- `links.*` 必须来自 app-owned backlink projection，而不是 route-time sink query
- `replay` 是 operator-safe answer replay view，只重组 request projection、request
  observability fact、audit summary 与 trace backlink 中已有的 typed summary；它不是第二套 truth
- `replay.context` 只返回 principal / entitlement / policy projection 的安全摘要，不返回 raw
  JWT、cookie 或 memory 原文
- `replay.retrieval.sourceTraceCounts` 只给出 replay drill-down 的计数线索；需要具体 source identity
  时继续读取 `observability.sourceTrace.*`

## Quality Endpoints

### `GET /api/operator/quality/summary`

响应：

```json
{
  "window": {
    "from": "2026-04-02T00:00:00.000Z",
    "to": "2026-04-03T00:00:00.000Z",
    "granularity": "15m"
  },
  "runtime": {
    "requestCount": 1248,
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
    "feedback": {
      "feedbackCount": 82,
      "coverageRate": {
        "value": 0.0657,
        "count": 82,
        "eligibleCount": 1248
      },
      "helpfulRate": {
        "value": 0.7561,
        "count": 62,
        "eligibleCount": 82
      },
      "unhelpfulRate": {
        "value": 0.2439,
        "count": 20,
        "eligibleCount": 82
      },
      "noAnswerUnhelpfulRate": {
        "value": 0.1311,
        "count": 8,
        "eligibleCount": 61
      },
      "distributions": {
        "surface": [{ "value": "public_chat_web", "count": 82 }],
        "answerKind": [
          { "value": "answer", "count": 56 },
          { "value": "no_answer", "count": 18 },
          { "value": "clarification", "count": 8 }
        ],
        "capability": [{ "value": "knowledge", "count": 64 }],
        "citationPosture": [
          { "value": "citation_present", "count": 48 },
          { "value": "citation_missing", "count": 8 },
          { "value": "citation_not_expected", "count": 26 }
        ],
        "reasonCode": [{ "value": "wrong_intent", "count": 7 }],
        "vote": [
          { "value": "helpful", "count": 62 },
          { "value": "unhelpful", "count": 20 }
        ]
      }
    },
    "refusalDistribution": {
      "noAnswer": 61,
      "needsClarification": 48,
      "approvalRequired": 9,
      "rejected": 21
    }
  },
  "sampledGrades": {
    "coverageRate": {
      "value": 0.0368,
      "count": 46,
      "eligibleCount": 1248
    },
    "groundingPassRate": {
      "value": 0.913,
      "count": 42,
      "eligibleCount": 46
    },
    "citationPassRate": {
      "value": 0.869,
      "count": 40,
      "eligibleCount": 46
    },
    "policyPassRate": {
      "value": 0.978,
      "count": 45,
      "eligibleCount": 46
    },
    "intentPassRate": {
      "value": 0.95,
      "count": 19,
      "eligibleCount": 20
    },
    "badcaseOpenCount": 7
  },
  "asOf": "2026-04-03T00:00:10.000Z"
}
```

规则：

- `runtime` 与 `sampledGrades` 必须分块返回，不混成单一 truth
- `runtime.feedback` 来自 `chat.message_feedback.request_id` 与
  `runtime.request_observability_fact.request_id` 的 app-api owned join；时间窗、surface、
  selected capability、capability、principal、collection 与 model 过滤均以 request observability
  fact 为准，不以 feedback `updatedAt` 重新定义窗口
- `runtime.feedback.coverageRate.eligibleCount` 只统计可投票 assistant answer：`completed`、
  `needs_clarification` 与 `no_answer`；`error`、`rejected`、`approval_required` 不进入分母
- `runtime.feedback.helpfulRate` 与 `runtime.feedback.unhelpfulRate` 的分母是当前窗口内已收到
  feedback 的 eligible answer 数
- `runtime.feedback.noAnswerUnhelpfulRate` 的分母是当前窗口内 `status=no_answer` 的 eligible
  answer 数
- `runtime.feedback.distributions` 只基于已收到 feedback 且可 join 到 eligible answer 的记录；
  reason code 缺失时允许返回 `unspecified`
- sampled grading 缺失时，`sampledGrades` 允许为空块或 `null` 值，不得用 runtime 指标冒充 grader 结果
- 当前已冻结的第一版 contract 返回 `sampledGrades: null`
- forward contract 上，`sampledGrades` 的上游固定为 `operator.quality_grade_projection`
- `sampledGrades.intentPassRate` 只来自 `gradeDomain=intent` 的人工复核或 sampled
  grader，不得由最终 answer quality 反推

### `GET /api/operator/quality/timeseries`

响应：

```json
{
  "window": {
    "from": "2026-04-02T00:00:00.000Z",
    "to": "2026-04-03T00:00:00.000Z",
    "granularity": "1h"
  },
  "series": [
    {
      "bucketStart": "2026-04-02T00:00:00.000Z",
      "bucketEnd": "2026-04-02T01:00:00.000Z",
      "requestCount": 52,
      "emptyRecallRate": 0.096,
      "citationMissRate": 0.044,
      "noAnswerRate": 0.058,
      "needsClarificationRate": 0.019,
      "feedbackEligibleAnswerCount": 52,
      "feedbackCount": 4,
      "feedbackCoverageRate": 0.0769,
      "feedbackHelpfulCount": 3,
      "feedbackHelpfulRate": 0.75,
      "feedbackUnhelpfulCount": 1,
      "feedbackUnhelpfulRate": 0.25,
      "feedbackNoAnswerEligibleCount": 3,
      "feedbackNoAnswerUnhelpfulCount": 1,
      "feedbackNoAnswerUnhelpfulRate": 0.3333,
      "sampledGroundingPassRate": 0.9
    }
  ],
  "asOf": "2026-04-03T00:00:10.000Z"
}
```

规则：

- timeseries bucket 只返回 app-owned aggregate，不内嵌 raw request rows
- feedback timeseries 字段使用同 summary 相同的 eligible answer、feedback count、helpful /
  unhelpful 与 no-answer-unhelpful 分母口径；它们随 bucket 展示 denominator 字段，避免前端推算
- sampled grade 相关曲线允许出现 `null`，表示该 bucket 没有足够样本
- 当前已冻结的第一版 contract 由 `operator.metric_rollup` 重建 `requestCount`、`emptyRecallRa
  te`、`citationMissRate`、`noAnswerRate`、`needsClarificationRate`
- 当前已冻结的第一版 contract 中，`sampledGroundingPassRate` 固定为 `null`
- forward contract 上，`sampledGroundingPassRate` 的上游固定为
  `operator.quality_grade_projection` 与 request bucket join

### `GET /api/operator/quality/badcases`

查询参数：

- `limit`
- `cursor`
- `status`
- `causeClass`
- `detectedBy`

响应：

```json
{
  "badcases": [
    {
      "badcaseId": "qbad_01HQ",
      "requestId": "req_01HQ",
      "traceId": "trace_01HQ",
      "surface": "public_chat_web",
      "selectedCapability": "knowledge",
      "status": "open",
      "causeClass": "citation_missing",
      "detectedBy": "runtime_monitor",
      "openedAt": "2026-04-03T00:10:00.000Z",
      "summary": "citationExpected=true 但 citationCount=0",
      "grade": {
        "result": "fail",
        "score": 0.42,
        "graderVersion": "grader@2026-04-02"
      },
      "links": {
        "traceLink": "https://sentry.example/organizations/campus/traces/trace_01HQ",
        "issueLink": null,
        "issueFingerprint": null
      }
    }
  ],
  "page": {
    "nextCursor": null
  }
}
```

规则：

- 这是 app-owned badcase queue，不是 grader 原始输出列表
- `summary` 必须是安全摘要，不暴露 raw prompt / answer
- 当前已冻结的第一版 contract 只支持 `status` / `causeClass` / `detectedBy` 过滤，不按 sink
  backlink 或 grader 结果过滤
- 当前已冻结的第一版 contract 中，`detectedBy` 固定来自 `runtime_monitor`
- 当前已冻结的第一版 contract 中，`causeClass` 已落地
  `citation_missing`、`empty_recall`、`grounding_failed`、
  `unsupported_by_evidence`、`policy_failed`、`authz_suspected` 与
  `freshness_fail_close`
- `grade` 与 `links` 允许全部为 `null`；当 request lifecycle 或 internal producer
  已写入 app-owned projection 时，panel 返回对应的 safe backlink
- forward contract 上，`grade` 的上游固定为
  `operator.quality_grade_projection`，`links.*` 的上游固定为
  `operator.trace_backlink_projection`

### `GET /api/operator/quality/eval-candidates`

查询参数与 `quality/badcases` 相同，并允许用 `detectedBy=negative_feedback` 只看用户负反馈候选，
或用 `detectedBy=ragas_diagnostic` 只看 RAGAS diagnostic low-score 候选：

- `limit`
- `cursor`
- `status`
- `causeClass`
- `detectedBy`

响应：

```json
{
  "candidates": [
    {
      "candidateId": "eval_candidate:req_01HQ:unsupported_by_evidence",
      "requestId": "req_01HQ",
      "traceId": "trace_01HQ",
      "surface": "public_chat_web",
      "selectedCapability": "knowledge",
      "causeClass": "unsupported_by_evidence",
      "summary": "semanticOutcome=unsupported_by_evidence 或存在 unsupported claims",
      "grade": {
        "result": "fail",
        "score": 0.25,
        "graderVersion": "grader@2026-04-03"
      },
      "links": {
        "traceLink": "https://sentry.example/organizations/campus/traces/trace_01HQ",
        "issueLink": null,
        "issueFingerprint": "unsupported-by-evidence"
      },
      "intake": {
        "source": "operator_badcase",
        "status": "pending_review",
        "suggestedEvalFamily": "grounding",
        "createdAt": "2026-04-03T00:10:00.000Z"
      }
    },
    {
      "candidateId": "eval_candidate:negative_feedback:feedback_01HQ",
      "requestId": "req_01HQ",
      "traceId": "trace_01HQ",
      "surface": "public_chat_web",
      "selectedCapability": "knowledge",
      "causeClass": "wrong_intent",
      "summary": "Negative answer feedback for answer: wrong_intent.",
      "grade": null,
      "links": {
        "traceLink": "https://sentry.example/organizations/campus/traces/trace_01HQ",
        "issueLink": null,
        "issueFingerprint": null
      },
      "correlation": {
        "conversationId": "conv_01HQ",
        "assistantMessageId": "msg_assistant_01HQ",
        "answerKind": "answer",
        "citationPosture": "citation_missing",
        "intent": {
          "capability": "knowledge",
          "taskKind": "knowledge_lookup",
          "launchState": "open",
          "nextAction": "delegate",
          "scopeClass": "in_scope",
          "classifierVersion": "intent-classifier@2026-04-20"
        }
      },
      "feedback": {
        "feedbackId": "feedback_01HQ",
        "vote": "unhelpful",
        "reasonCodes": ["wrong_intent"],
        "updatedAt": "2026-04-03T00:12:00.000Z"
      },
      "review": {
        "suggestedLabels": ["wrong_intent"]
      },
      "privacy": {
        "rawTranscriptIncluded": false,
        "rawAuthMaterialIncluded": false,
        "providerRawResponseIncluded": false
      },
      "intake": {
        "source": "negative_feedback",
        "status": "pending_review",
        "suggestedEvalFamily": "intent",
        "createdAt": "2026-04-03T00:12:00.000Z"
      }
    },
    {
      "candidateId": "eval_candidate:ragas_diagnostic:student-scholarship-condition:faithfulness",
      "requestId": null,
      "traceId": null,
      "surface": "regulations/student_rules",
      "selectedCapability": null,
      "causeClass": "evidence_selection_failed",
      "summary": "RAGAS faithfulness=0.31 below 0.80 at evidence_selection.",
      "grade": {
        "result": "fail",
        "score": 0.31,
        "graderVersion": "ragas-diagnostic-combined-report.v1"
      },
      "links": {
        "traceLink": null,
        "issueLink": null,
        "issueFingerprint": null
      },
      "diagnostic": {
        "caseId": "student-scholarship-condition",
        "metricName": "faithfulness",
        "score": 0.31,
        "threshold": 0.8,
        "failureStage": "evidence_selection",
        "metricFailureReason": "evidence_selection",
        "expectedDocIds": ["doc:scholarship"],
        "retrievedContextIds": ["chunk:wrong", "chunk:scholarship"],
        "retrievedDocIds": ["doc:wrong", "doc:scholarship"],
        "supportingDocIds": ["doc:wrong"],
        "answerShape": "eligibility_judgment",
        "presentationKind": "condition_table"
      },
      "intake": {
        "source": "ragas_diagnostic",
        "status": "pending_review",
        "suggestedEvalFamily": "grounding",
        "createdAt": "2026-05-21T09:00:00.000Z"
      }
    }
  ],
  "page": {
    "nextCursor": null
  }
}
```

规则：

- 这是 app-api-owned badcase-to-eval intake export seam，不是 eval golden set
  admission API
- `candidateId` 对 badcase 稳定派生自 `badcaseId`；对 negative feedback 稳定派生自
  `feedbackId`；对 RAGAS diagnostic 稳定派生自 `badcaseId`，便于后续 eval tooling 做幂等 intake
- `intake.source` 当前允许 `operator_badcase`、`negative_feedback` 或
  `ragas_diagnostic`
- `suggestedEvalFamily` 只表达 app-api 基于 `causeClass` 的初始归类；eval review / golden set
  admission 仍由 eval layer 决定
- `suggestedEvalFamily` 当前取值为 `citation`、`grounding`、`intent`、`policy` 或 `unknown`
- negative feedback candidate 的 manual review label 当前允许：
  `false_positive`、`false_negative`、`wrong_intent`、`stale_missing_evidence`、
  `answer_style_issue`
- negative feedback candidate 只返回 request/message correlation、intent summary、
  citation/source posture、reason codes 与 trace backlink；不得返回 raw transcript、
  raw auth material、provider raw response、raw prompt 或 retrieval payload
- RAGAS diagnostic candidate 不携带 runtime request / trace correlation；`requestId`、
  `traceId`、`selectedCapability` 和 `links.*` 固定允许为 `null`，panel 不得把它渲染成运行时
  request 链接
- RAGAS diagnostic candidate 只返回 case / metric / failure stage / doc id 摘要；
  不得返回 raw answer、raw prompt、transcript、local artifact path、bucket / object key、
  auth material 或 provider raw response
- `packages/evals` 的 eval admission manifest 只能把这些 candidate 包装成
  `pending_review`，不能直接把它们写成 golden truth
- endpoint 不写入 eval truth，不生成 benchmark artifact，不创建 fix task

## Intent Governance Endpoints

### `GET /api/operator/intent/summary`

返回入口意图治理摘要，用于发现 classifier、schema 与 context resolution drift。

响应：

```json
{
  "window": {
    "from": "2026-04-02T00:00:00.000Z",
    "to": "2026-04-03T00:00:00.000Z",
    "granularity": "15m"
  },
  "runtime": {
    "requestCount": 248,
    "lowConfidenceRate": {
      "value": 0.0403,
      "count": 10,
      "eligibleCount": 248
    },
    "ambiguityRate": {
      "value": 0.0605,
      "count": 15,
      "eligibleCount": 248
    },
    "contextUnresolvedRate": {
      "value": 0.0121,
      "count": 3,
      "eligibleCount": 248
    },
    "distributions": {
      "capability": [{ "value": "knowledge", "count": 180 }],
      "taskKind": [{ "value": "knowledge_lookup", "count": 170 }],
      "launchState": [{ "value": "open", "count": 210 }],
      "nextAction": [{ "value": "delegate", "count": 205 }],
      "scopeClass": [{ "value": "in_scope", "count": 232 }],
      "classifierVersion": [
        { "value": "intent-classifier@2026-04-20", "count": 248 }
      ],
      "schemaVersion": [{ "value": "intent-schema-1.0.0", "count": 248 }]
    }
  },
  "sampledGrades": {
    "coverageRate": {
      "value": 0.121,
      "count": 30,
      "eligibleCount": 248
    },
    "intentPassRate": {
      "value": 0.9,
      "count": 27,
      "eligibleCount": 30
    }
  },
  "asOf": "2026-04-03T00:00:10.000Z"
}
```

规则：

- `runtime.*` 来自 `runtime.request_observability_fact` 中的 typed intent summary
- `sampledGrades.*` 来自 `operator.quality_grade_projection` 的 `gradeDomain=intent`
- distributions 只返回 operator-safe code / version / count，不返回 raw prompt、raw user
  transcript 或 raw classifier payload

### `GET /api/operator/intent/timeseries`

返回 intent governance trend。

响应：

```json
{
  "window": {
    "from": "2026-04-02T00:00:00.000Z",
    "to": "2026-04-03T00:00:00.000Z",
    "granularity": "15m"
  },
  "series": [
    {
      "bucketStart": "2026-04-02T00:00:00.000Z",
      "bucketEnd": "2026-04-02T00:15:00.000Z",
      "requestCount": 42,
      "lowConfidenceRate": 0.0476,
      "ambiguityRate": 0.0714,
      "contextUnresolvedRate": 0.0238,
      "sampledIntentPassRate": 0.875
    }
  ],
  "asOf": "2026-04-03T00:00:10.000Z"
}
```

## Safety/Authz Endpoints

### `GET /api/operator/safety/summary`

响应：

```json
{
  "window": {
    "from": "2026-04-02T00:00:00.000Z",
    "to": "2026-04-03T00:00:00.000Z",
    "granularity": "15m"
  },
  "summary": {
    "decisionDistribution": {
      "allowed": 1178,
      "approvalRequired": 22,
      "denied": 37,
      "failClosed": 11
    },
    "aclAnomalyRate": {
      "value": 0.0016,
      "count": 2,
      "eligibleCount": 1248
    },
    "restrictedDenyRate": {
      "value": 0.0296,
      "count": 37,
      "eligibleCount": 1248
    },
    "failClosedRate": {
      "value": 0.0088,
      "count": 11,
      "eligibleCount": 1248
    }
  },
  "asOf": "2026-04-03T00:00:10.000Z"
}
```

规则：

- `decisionDistribution` 基于 app-owned authz projection / request observability
  fact
- `aclAnomalyRate` 只计入显式 anomaly code，不用 query path 推测

### `GET /api/operator/safety/anomalies`

查询参数：

- `limit`
- `cursor`
- `severity`
- `status`
- `anomalyCode`

响应：

```json
{
  "anomalies": [
    {
      "anomalyId": "aclanom_01HQ",
      "requestId": "req_01HQ",
      "traceId": "trace_01HQ",
      "surface": "protected_panel_web",
      "principalType": "operator",
      "selectedCapability": "knowledge",
      "anomalyCode": "projection_missing",
      "severity": "high",
      "status": "open",
      "summary": "request finalized 但缺少 policy projection version",
      "detectedAt": "2026-04-03T00:12:00.000Z",
      "links": {
        "traceLink": "https://sentry.example/organizations/campus/traces/trace_01HQ",
        "issueLink": "https://sentry.example/organizations/campus/issues/123",
        "issueFingerprint": "projection-missing"
      }
    }
  ],
  "page": {
    "nextCursor": null
  }
}
```

规则：

- anomaly queue 是 curated operator queue，不等于 raw audit 或 raw sink exception list
- 不直接返回 restricted document identifier 的敏感原文；必要时只返回安全摘要或受控 doc id

## Cost Endpoints

### `GET /api/operator/cost/summary`

响应：

```json
{
  "window": {
    "from": "2026-04-02T00:00:00.000Z",
    "to": "2026-04-03T00:00:00.000Z",
    "granularity": "15m"
  },
  "summary": {
    "tokens": {
      "input": 1320440,
      "output": 481220,
      "cachedInput": 92100
    },
    "estimatedCost": {
      "microusd": 4823100,
      "currency": "USD"
    },
    "byModel": [
      {
        "modelName": "gpt-5.2-mini",
        "requestCount": 1180,
        "estimatedCostMicrousd": 4011200
      }
    ],
    "bySurface": [
      {
        "surface": "public_chat_web",
        "requestCount": 1098,
        "estimatedCostMicrousd": 4325000
      }
    ]
  },
  "asOf": "2026-04-03T00:00:10.000Z"
}
```

规则：

- 第一版返回 near-real-time estimated cost
- provider reconciled cost 可以后续作为独立 aggregate block 加入，但不得覆盖 request-scoped
  runtime estimated cost

### `GET /api/operator/cost/timeseries`

响应：

```json
{
  "window": {
    "from": "2026-04-02T00:00:00.000Z",
    "to": "2026-04-03T00:00:00.000Z",
    "granularity": "1h"
  },
  "series": [
    {
      "bucketStart": "2026-04-02T00:00:00.000Z",
      "bucketEnd": "2026-04-02T01:00:00.000Z",
      "inputTokens": 52210,
      "outputTokens": 18300,
      "cachedInputTokens": 4100,
      "estimatedCostMicrousd": 181200
    }
  ],
  "asOf": "2026-04-03T00:00:10.000Z"
}
```

规则：

- cost timeseries 使用 app-owned rollup，不从 `Axiom` 或 provider billing API 现查

## Audit Endpoints

### `GET /api/operator/audit`

查询参数：

- `limit`
- `cursor`
- `requestId`
- `traceId`
- `principalType`
- `surface`
- `selectedCapability`
- `eventType`
- `status`

响应：

```json
{
  "events": [
    {
      "auditEventId": "aevt_01HQ",
      "requestId": "req_01HQ",
      "traceId": "trace_01HQ",
      "occurredAt": "2026-04-03T00:00:00.500Z",
      "eventType": "authz.decision",
      "surface": "public_chat_web",
      "principalType": "campus_member",
      "selectedCapability": "knowledge",
      "status": "allowed",
      "summary": "student_rules 请求通过 authz check"
    }
  ],
  "page": {
    "nextCursor": null
  }
}
```

规则：

- 返回 curated audit timeline summary，不是 raw JSONL replay
- `summary` 必须是 governance-safe 文本，不回显 raw auth material 或 raw answer
- 当前已冻结的第一版 contract 事件类型先以 request lifecycle 为主，例如 `request.accepted`、`request.
  completed`、`request.no_answer`、`request.needs_clarification`、`request.error`、`
  request.approval_required`、`request.rejected`、`request.cancelled`
- execution runtime kernel event 可以通过 `app-api` internal ingest 进入同一 audit
  projection；第一版只允许 `execution.admission_rejected`、`execution.cancel_requested`、
  `execution.cancelled`、`execution.bridge_failed`、`execution.timed_out`
- 更细粒度的 `authz.decision`、`retrieval.summary`、`operator.action` 后续可以在不破坏 owner
  模型的前提下追加，但不能回退成 raw log query

### `GET /api/operator/audit/:auditEventId`

响应：

```json
{
  "event": {
    "auditEventId": "aevt_01HQ",
    "requestId": "req_01HQ",
    "traceId": "trace_01HQ",
    "occurredAt": "2026-04-03T00:00:00.500Z",
    "eventType": "authz.decision",
    "surface": "public_chat_web",
    "principalType": "campus_member",
    "entitlementSnapshotId": "ent_01HQ",
    "policyProjectionVersion": "2026-04-02",
    "requestedCapability": "knowledge",
    "selectedCapability": "knowledge",
    "status": "allowed",
    "terminalCode": "completed",
    "summary": "student_rules 请求通过 authz check",
    "diagnostics": {
      "failClosed": false,
      "aclAnomalyCode": null,
      "sourceDocIds": ["handbook:library-hours"]
    }
  },
  "links": {
    "traceLink": "https://sentry.example/organizations/campus/traces/trace_01HQ",
    "issueLink": null,
    "issueFingerprint": null
  }
}
```

规则：

- detail 允许比 list 多出
  `entitlementSnapshotId`、`policyProjectionVersion`、`diagnostics`
- 仍不返回 raw JWT、raw cookies、raw prompt、raw answer、raw retrieval payload
- `links` 允许全部为 `null`；配置了 app-owned backlink recorder 或 external internal
  producer 后才返回 safe deep link / fingerprint
- `links.*` 必须继续经过 app-owned projection，不允许 detail route 直接查询 sink

## Internal Ingest Endpoints

以下 endpoint 是 app-owned internal command seam，不是 browser-facing panel API：

- `POST /api/internal/operator/quality/grades`
- `POST /api/internal/operator/trace-backlinks`
- `POST /api/internal/execution/audit-events`
- `POST /api/internal/operator/evals/coverage-snapshots`
- `POST /api/internal/operator/evals/diagnostic-badcases`

适用前提：

- 调用方必须携带 `x-app-internal-auth`
- 这是 internal producer（grader worker / sink reconciliation worker）写入 projection
  的入口
- 这些 endpoint 不向 panel 暴露，不支持 ad-hoc query
- 对于 app-api 自己掌握的 request lifecycle，runtime 内置 recorder 可以直接写入同一
  `operator.trace_backlink_projection`；internal endpoint 仍保留给 external sink
  reconciliation worker / grader worker

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
      "presentationKind": "condition_table"
    }
  ]
}
```

规则：

- payload schema 固定为 `eval_diagnostic_badcases.v1`，source report schema 固定来自
  `ragas-diagnostic-combined-report.v1`
- `failureStage` 只允许 `retrieval`、`rerank`、`selection`、
  `evidence_selection`、`synthesis`、`grounding` 与 `diagnostic`
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

## Explicit Non-Goals

- 不把 `Sentry`、`Axiom`、OpenAI trace / eval tooling 提升成 panel canonical query
  backend
- 不让 `apps/execution-control` 暴露 operator observability HTTP surface
- 不让 panel BFF 查询数据库、audit JSONL 或 sink 后再自己拼 aggregate
- 不把 request observability detail 退化成 raw execution / trace dump
